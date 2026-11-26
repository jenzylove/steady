// Build the exact transaction for a fix and simulate it on mainnet before anyone signs. Never signs or sends.
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createRevokeInstruction, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { AdapterContext, Position } from "../engine/types.js";
import type { FixSpec } from "../engine/advice/types.js";
import { kaminoRepay, kaminoWithdraw } from "./kamino-sdk.js";

const KTX = "https://api.kamino.finance/ktx/klend";
const JUP = "https://lite-api.jup.ag/swap/v1";

export interface Simulation { ok: boolean; err?: string | undefined; unitsConsumed?: number | undefined; logsTail: string[] }
export interface BuiltFix { fix: FixSpec; transaction?: string | undefined; simulation?: Simulation | undefined; unsupported?: string | undefined; builder: string; summary?: string | undefined }

async function rpc<T>(ctx: AdapterContext, method: string, params: unknown[]): Promise<T> {
  const res = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

export async function simulate(ctx: AdapterContext, txBase64: string): Promise<Simulation> {
  const r = await rpc<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>(ctx, "simulateTransaction", [txBase64, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
  const logs = r.value.logs ?? [];
  return { ok: r.value.err === null, err: r.value.err === null ? undefined : JSON.stringify(r.value.err), unitsConsumed: r.value.unitsConsumed, logsTail: logs.slice(-6) };
}

async function kaminoTx(ctx: AdapterContext, action: "repay" | "deposit" | "withdraw", wallet: string, market: string, reserve: string, amount: number): Promise<{ tx?: string; error?: string }> {
  const res = await ctx.fetch(`${KTX}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, market, reserve, amount: String(amount) }) });
  const j = (await res.json()) as { transaction?: string; message?: string; code?: string };
  return j.transaction ? { tx: j.transaction } : { error: `${j.code ?? res.status}: ${j.message ?? "no transaction"}` };
}

const KAMINO_MAIN = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";

/** Main market reserve for a mint, from Kamino's public reserve list. */
async function kaminoReserveFor(ctx: AdapterContext, mint: string): Promise<string | undefined> {
  const res = await ctx.fetch(`https://api.kamino.finance/kamino-market/${KAMINO_MAIN}/reserves/metrics`);
  const list = (await res.json()) as { reserve: string; liquidityTokenMint: string }[];
  return list.find((r) => r.liquidityTokenMint === mint)?.reserve;
}

export async function buildFix(ctx: AdapterContext, wallet: string, fix: FixSpec, positions: Position[]): Promise<BuiltFix> {
  try {
    if (fix.protocol === "kamino" && (fix.action === "repay" || fix.action === "withdraw")) {
      const leg = positions.find((p) => p.protocol === "kamino" && p.account === fix.account && p.mint === fix.mintIn && p.kind === (fix.action === "repay" ? "borrow" : "lend"));
      const market = leg?.extra?.market as string | undefined, reserve = leg?.extra?.reserve as string | undefined;
      if (!leg || !market || !reserve || !fix.account || !fix.mintIn) return { fix, builder: "kamino sdk", unsupported: "position not found in this read" };
      const k = fix.action === "repay"
        ? await kaminoRepay(ctx, wallet, fix.account, reserve, fix.mintIn, leg.symbol ?? "tokens", fix.amount, positions)
        : await kaminoWithdraw(ctx, wallet, fix.account, reserve, leg.symbol ?? "tokens", fix.amount, positions);
      if (!k.transaction) return { fix, builder: `kamino sdk ${k.route}`, unsupported: k.unsupported };
      return { fix, builder: `kamino sdk ${k.route}`, summary: k.summary, transaction: k.transaction, simulation: await simulate(ctx, k.transaction) };
    }
    if (fix.protocol === "kamino" && fix.action === "deposit" && fix.mintIn) {
      const reserve = await kaminoReserveFor(ctx, fix.mintIn);
      if (!reserve) return { fix, builder: "kamino ktx", unsupported: "no Kamino main market reserve for this token" };
      const r = await kaminoTx(ctx, "deposit", wallet, KAMINO_MAIN, reserve, fix.amount);
      if (!r.tx) return { fix, builder: "kamino ktx", unsupported: `Kamino's builder cannot prepare this one (${r.error})` };
      return { fix, builder: "kamino ktx", transaction: r.tx, simulation: await simulate(ctx, r.tx) };
    }
    if (fix.action === "revoke" && fix.account) {
      const acct = await rpc<{ value: { owner: string } | null }>(ctx, "getAccountInfo", [fix.account, { encoding: "base64" }]);
      const programId = acct.value?.owner === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const { value } = await rpc<{ value: { blockhash: string } }>(ctx, "getLatestBlockhash", [{ commitment: "confirmed" }]);
      const ix = createRevokeInstruction(new PublicKey(fix.account), new PublicKey(wallet), [], programId);
      const msg = new TransactionMessage({ payerKey: new PublicKey(wallet), recentBlockhash: value.blockhash, instructions: [ix] }).compileToV0Message();
      const tx = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
      return { fix, builder: "spl-token revoke", transaction: tx, simulation: await simulate(ctx, tx) };
    }
    if (fix.action === "swap" && fix.mintIn && fix.mintOut) {
      const dec = await rpc<{ value: { decimals: number } }>(ctx, "getTokenSupply", [fix.mintIn]);
      const raw = Math.floor(fix.amount * 10 ** dec.value.decimals);
      const quote = await (await ctx.fetch(`${JUP}/quote?inputMint=${fix.mintIn}&outputMint=${fix.mintOut}&amount=${raw}&slippageBps=50`)).json();
      const sw = (await (await ctx.fetch(`${JUP}/swap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet, dynamicComputeUnitLimit: true }) })).json()) as { swapTransaction?: string; error?: string };
      if (!sw.swapTransaction) return { fix, builder: "jupiter", unsupported: sw.error ?? "no swap transaction" };
      return { fix, builder: "jupiter", transaction: sw.swapTransaction, simulation: await simulate(ctx, sw.swapTransaction) };
    }
    return { fix, builder: "none", unsupported: `no builder yet for ${fix.action} on ${fix.protocol}` };
  } catch (e) {
    return { fix, builder: "error", unsupported: String(e).slice(0, 200) };
  }
}
