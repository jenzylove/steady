import type { AdapterContext, Source } from "../types.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

export const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3";
export const JUP_TAG_URL = "https://lite-api.jup.ag/tokens/v2/tag?query=lst";

/** Remove any api-key query value so the string is safe to store in Source.ref or a gap. */
export function scrub(s: string): string {
  return s.replace(/api-key=[^&\s"']*/gi, "api-key=<redacted>");
}

/** GET/POST with a few retries on 429 and 503 (Jupiter lite API rate limits aggressively). */
export async function fetchRetry(ctx: AdapterContext, url: string, init?: RequestInit, tries = 4): Promise<Response> {
  let last: Response | undefined;
  for (let i = 0; i < tries; i++) {
    last = await ctx.fetch(url, init);
    if (last.status !== 429 && last.status !== 503) return last;
    await new Promise((r) => setTimeout(r, 600 * 2 ** i));
  }
  return last!;
}

export class RpcError extends Error {}

export async function rpc<T>(
  ctx: AdapterContext,
  method: string,
  params: unknown[] | Record<string, unknown>,
): Promise<{ result: T; slot?: number }> {
  let res: Response;
  try {
    res = await fetchRetry(ctx, ctx.heliusRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (e) {
    throw new RpcError(`${method} failed: ${scrub(String((e as Error).message ?? e))}`);
  }
  if (!res.ok) throw new RpcError(`${method} failed: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: any; error?: { message?: string } };
  if (j.error || j.result === undefined) throw new RpcError(`${method} failed: ${scrub(j.error?.message ?? "no result")}`);
  const r = j.result;
  const slot = r && typeof r === "object" && r.context && typeof r.context.slot === "number" ? (r.context.slot as number) : undefined;
  return slot === undefined ? { result: r as T } : { result: r as T, slot };
}

export function chainSource(ctx: AdapterContext, method: string, slot?: number): Source {
  return { kind: "chain", ref: method, ...(slot !== undefined ? { slot } : {}), fetchedAt: ctx.now().toISOString() };
}

export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

export interface TokenAccount {
  account: string;
  mint: string;
  owner: string;
  program: "spl-token" | "token-2022";
  amount: number; // UI
  rawAmount: string;
  decimals: number;
  delegate?: string;
  delegatedAmount?: number; // UI
  state?: string;
}

export interface TokenAccountsRead {
  accounts: TokenAccount[];
  gaps: string[];
  sources: Source[];
}

/** All SPL + Token-2022 token accounts of a wallet. */
export async function readTokenAccounts(wallet: string, ctx: AdapterContext): Promise<TokenAccountsRead> {
  const accounts: TokenAccount[] = [];
  const gaps: string[] = [];
  const sources: Source[] = [];
  for (const [pid, label] of [
    [TOKEN_PROGRAM, "spl-token"],
    [TOKEN_2022_PROGRAM, "token-2022"],
  ] as const) {
    try {
      const { result, slot } = await rpc<{ value: any[] }>(ctx, "getTokenAccountsByOwner", [
        wallet,
        { programId: pid },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      sources.push(chainSource(ctx, `getTokenAccountsByOwner(${label})`, slot));
      for (const v of result.value) {
        const info = v.account?.data?.parsed?.info;
        if (!info?.mint || !info.tokenAmount) continue;
        const ta = info.tokenAmount;
        const t: TokenAccount = {
          account: v.pubkey,
          mint: info.mint,
          owner: info.owner ?? wallet,
          program: label,
          amount: Number(ta.uiAmountString ?? ta.uiAmount ?? 0),
          rawAmount: String(ta.amount),
          decimals: Number(ta.decimals),
          state: info.state,
        };
        if (info.delegate) {
          t.delegate = info.delegate;
          const da = info.delegatedAmount;
          t.delegatedAmount = da ? Number(da.uiAmountString ?? da.uiAmount ?? 0) : 0;
        }
        accounts.push(t);
      }
    } catch (e) {
      gaps.push(`Could not read ${label} token accounts: ${(e as Error).message}`);
    }
  }
  return { accounts, gaps, sources };
}

/** Prices in USD by mint via Jupiter price v3. Missing mints are simply absent. */
export async function readPrices(
  mints: string[],
  ctx: AdapterContext,
): Promise<{ prices: Map<string, number>; gaps: string[]; sources: Source[] }> {
  const prices = new Map<string, number>();
  const gaps: string[] = [];
  const sources: Source[] = [];
  for (const part of chunk([...new Set(mints)], 50)) {
    const url = `${JUP_PRICE_URL}?ids=${part.join(",")}`;
    try {
      const res = await fetchRetry(ctx, url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as Record<string, { usdPrice?: number } | null>;
      for (const m of part) {
        const p = j[m]?.usdPrice;
        if (typeof p === "number" && Number.isFinite(p)) prices.set(m, p);
      }
      sources.push({ kind: "price_api", ref: JUP_PRICE_URL, fetchedAt: ctx.now().toISOString() });
    } catch (e) {
      gaps.push(`Jupiter price lookup failed for ${part.length} mints: ${(e as Error).message}`);
    }
  }
  return { prices, gaps, sources };
}

export interface AssetMeta {
  symbol?: string;
  name?: string;
}

/** Symbols via Helius DAS getAssetBatch. */
export async function readSymbols(mints: string[], ctx: AdapterContext): Promise<{ meta: Map<string, AssetMeta>; gaps: string[] }> {
  const meta = new Map<string, AssetMeta>();
  const gaps: string[] = [];
  for (const part of chunk([...new Set(mints)], 500)) {
    try {
      const { result } = await rpc<any[]>(ctx, "getAssetBatch", { ids: part });
      for (const a of result) {
        if (!a?.id) continue;
        const symbol = a.content?.metadata?.symbol || a.token_info?.symbol;
        const name = a.content?.metadata?.name;
        meta.set(a.id, { ...(symbol ? { symbol } : {}), ...(name ? { name } : {}) });
      }
    } catch (e) {
      gaps.push(`Token symbols unavailable for ${part.length} mints: ${(e as Error).message}`);
    }
  }
  return { meta, gaps };
}
