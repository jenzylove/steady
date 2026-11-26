// Shared helpers for the LP and perp adapters: raw JSON-RPC, Jupiter prices, binary readers, Source builders.
import { PublicKey } from "@solana/web3.js";
import type { AdapterContext, Source } from "../types.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const JUP_PRICE_URL = "https://lite-api.jup.ag/price/v3";

export interface RpcOut<T> {
  result: T;
  slot: number;
}

/** JSON-RPC call with retry on 429/5xx. Returns result plus the slot of the read when the node reports it. */
export async function rpc<T = any>(ctx: AdapterContext, method: string, params: unknown[]): Promise<RpcOut<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await ctx.fetch(ctx.heliusRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`rpc ${method} http ${res.status}`);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      const j: any = await res.json();
      if (j.error && /overloaded|try again|timed out/i.test(String(j.error.message))) {
        lastErr = new Error(`rpc ${method}: ${j.error.message}`);
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      if (j.error) throw new Error(`rpc ${method}: ${j.error.message ?? JSON.stringify(j.error)}`);
      const slot = j.result?.context?.slot ?? 0;
      return { result: j.result as T, slot };
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).startsWith(`rpc ${method}:`)) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function chainSource(ctx: AdapterContext, method: string, slot: number): Source {
  return { kind: "chain", ref: method, slot, fetchedAt: ctx.now().toISOString() };
}
export function apiSource(ctx: AdapterContext, kind: "protocol_api" | "price_api", ref: string): Source {
  return { kind, ref, fetchedAt: ctx.now().toISOString() };
}

export interface RawAccount {
  pubkey: string;
  owner: string;
  data: Buffer;
  lamports: number;
}

/** getMultipleAccounts in chunks of 100. Missing accounts come back as null. */
export async function getMultiple(
  ctx: AdapterContext,
  keys: string[],
): Promise<{ accounts: (RawAccount | null)[]; slot: number }> {
  const accounts: (RawAccount | null)[] = [];
  let slot = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const { result, slot: s } = await rpc<any>(ctx, "getMultipleAccounts", [chunk, { encoding: "base64", commitment: "confirmed" }]);
    slot = Math.max(slot, s);
    result.value.forEach((v: any, j: number) => {
      accounts.push(
        v ? { pubkey: chunk[j]!, owner: v.owner, data: Buffer.from(v.data[0], "base64"), lamports: v.lamports } : null,
      );
    });
  }
  return { accounts, slot };
}

export interface HeldToken {
  tokenAccount: string;
  mint: string;
  program: string;
  rawAmount: bigint;
  decimals: number;
  uiAmount: number;
}

/** All SPL token accounts (classic and Token-2022) of an owner with a non zero balance. */
export async function getTokenHoldings(ctx: AdapterContext, owner: string): Promise<{ tokens: HeldToken[]; slot: number }> {
  const tokens: HeldToken[] = [];
  let slot = 0;
  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const { result, slot: s } = await rpc<any>(ctx, "getTokenAccountsByOwner", [
      owner,
      { programId: program },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);
    slot = Math.max(slot, s);
    for (const v of result.value) {
      const info = v.account.data.parsed.info;
      const raw = BigInt(info.tokenAmount.amount);
      if (raw === 0n) continue;
      tokens.push({
        tokenAccount: v.pubkey,
        mint: info.mint,
        program,
        rawAmount: raw,
        decimals: info.tokenAmount.decimals,
        uiAmount: Number(raw) / 10 ** info.tokenAmount.decimals,
      });
    }
  }
  return { tokens, slot };
}

/** Jupiter lite price v3. Mints it does not price are absent from the map (caller reports a gap). */
export async function getPrices(ctx: AdapterContext, mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(mints)];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50);
    try {
      let res = await ctx.fetch(`${JUP_PRICE_URL}?ids=${chunk.join(",")}`);
      for (let a = 0; a < 4 && res.status === 429; a++) {
        await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
        res = await ctx.fetch(`${JUP_PRICE_URL}?ids=${chunk.join(",")}`);
      }
      if (!res.ok) continue;
      const j: any = await res.json();
      for (const m of chunk) if (j[m]?.usdPrice != null) out.set(m, Number(j[m].usdPrice));
    } catch {
      /* priced later as a gap */
    }
  }
  return out;
}

export async function getMintMeta(
  ctx: AdapterContext,
  mints: string[],
): Promise<{ meta: Map<string, { decimals: number; program: string }>; slot: number }> {
  const { accounts, slot } = await getMultiple(ctx, mints);
  const meta = new Map<string, { decimals: number; program: string }>();
  accounts.forEach((a, i) => {
    if (a && a.data.length >= 45) meta.set(mints[i]!, { decimals: a.data[44]!, program: a.owner });
  });
  return { meta, slot };
}

/** Symbols come from the Jupiter token search (optional; falls back to a short mint). */
const symbolCache = new Map<string, string>();
export async function getSymbols(ctx: AdapterContext, mints: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need = [...new Set(mints)].filter((m) => !symbolCache.has(m));
  for (let i = 0; i < need.length; i += 90) {
    const chunk = need.slice(i, i + 90);
    try {
      const res = await ctx.fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${chunk.join(",")}`);
      if (res.ok) {
        const arr: any[] = await res.json();
        for (const t of arr) if (t.id && t.symbol) symbolCache.set(t.id, t.symbol);
      }
    } catch {
      /* ignore */
    }
  }
  for (const m of mints) out.set(m, symbolCache.get(m) ?? m.slice(0, 4));
  return out;
}

// ---- binary readers (little endian) ----
export const u8 = (b: Buffer, o: number) => b.readUInt8(o);
export const u16 = (b: Buffer, o: number) => b.readUInt16LE(o);
export const i32 = (b: Buffer, o: number) => b.readInt32LE(o);
export const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(o);
export const i64 = (b: Buffer, o: number) => b.readBigInt64LE(o);
export function u128(b: Buffer, o: number): bigint {
  return b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n);
}
export const pk = (b: Buffer, o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();

export function pda(seeds: (Buffer | Uint8Array)[], program: string): string {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
}

// ---- concentrated liquidity math (Q64.64 sqrt prices, shared by Orca and Raydium CLMM) ----
const Q64 = 1n << 64n;
export function sqrtPriceOfTick(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}
export interface ClmmAmounts {
  amountA: number; // raw units
  amountB: number; // raw units
  inRange: boolean;
}
export function clmmAmounts(liquidity: bigint, sqrtCurrent: bigint, tickLower: number, tickUpper: number, tickCurrent: number): ClmmAmounts {
  const sa = sqrtPriceOfTick(tickLower);
  const sb = sqrtPriceOfTick(tickUpper);
  const sc = Number(sqrtCurrent) / Number(Q64);
  const L = Number(liquidity);
  const inRange = tickCurrent >= tickLower && tickCurrent < tickUpper;
  if (tickCurrent < tickLower) return { amountA: (L * (sb - sa)) / (sa * sb), amountB: 0, inRange };
  if (tickCurrent >= tickUpper) return { amountA: 0, amountB: L * (sb - sa), inRange };
  return { amountA: (L * (sb - sc)) / (sc * sb), amountB: L * (sc - sa), inRange };
}

export function priceFromSqrt(sqrtX64: bigint, decA: number, decB: number): number {
  const s = Number(sqrtX64) / Number(Q64);
  return s * s * 10 ** (decA - decB);
}
export function tickToPrice(tick: number, decA: number, decB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decA - decB);
}

/** Run async tasks with a concurrency limit. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}
