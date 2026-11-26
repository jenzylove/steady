// Kamino repay and withdraw built with Kamino's own SDK, so it works for every obligation type (vanilla, multiply, leverage).
// When the wallet lacks the debt token, repay with collateral: a flash loan repays the debt, part of the collateral is
// withdrawn and sold on Jupiter, and the flash loan is paid back, all in one transaction. Never signs or sends.
import {
  address, createSolanaRpcFromTransport, createNoopSigner, pipe, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, compressTransactionMessageUsingAddressLookupTables, AccountRole, none,
  type Address, type Instruction,
} from "@solana/kit";
import { fetchAllAddressLookupTable } from "@solana-program/address-lookup-table";
import { KaminoMarket, KaminoAction, getCurrentLedgerInstant, getRepayWithCollIxs } from "@kamino-finance/klend-sdk";
import { Decimal } from "decimal.js";
import type { AdapterContext, Position } from "../engine/types.js";

const JUP = "https://lite-api.jup.ag/swap/v1";
const MAX_TX = 1232;

export interface KaminoBuilt { transaction?: string; summary?: string; unsupported?: string; route: "repay" | "repay-with-collateral" | "withdraw" }

type JupIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
const toIx = (i: JupIx): Instruction => ({
  programAddress: address(i.programId),
  accounts: i.accounts.map((a) => ({ address: address(a.pubkey), role: a.isSigner ? (a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY })),
  data: new Uint8Array(Buffer.from(i.data, "base64")),
});

const markets = new Map<string, { at: number; m: KaminoMarket }>();
const lutCache = new Map<string, { at: number; luts: Address[] }>();

// Helius rate limits bursts: market loads fan out many reads, so cap concurrency and send every call through
// ctx.fetch, which waits and retries on HTTP 429.
let active = 0; const waiting: (() => void)[] = [];
const rpcs = new Map<string, ReturnType<typeof createSolanaRpcFromTransport>>();
function rpcFor(ctx: AdapterContext) {
  const hit = rpcs.get(ctx.heliusRpcUrl); if (hit) return hit;
  const transport = (async ({ payload, signal }: { payload: unknown; signal?: AbortSignal }) => {
    if (active >= 4) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      const res = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), signal: signal ?? null });
      if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
      return await res.json();
    } finally { active--; waiting.shift()?.(); }
  }) as never;
  const rpc = createSolanaRpcFromTransport(transport);
  rpcs.set(ctx.heliusRpcUrl, rpc);
  return rpc;
}

async function loadMarket(ctx: AdapterContext, market: string): Promise<KaminoMarket> {
  const hit = markets.get(market);
  if (hit && Date.now() - hit.at < 60_000) return hit.m;
  const m = await KaminoMarket.load(rpcFor(ctx) as never, address(market), 400);
  if (!m) throw new Error(`Kamino market ${market} not found`);
  markets.set(market, { at: Date.now(), m });
  return m;
}

async function jrpc<T>(ctx: AdapterContext, method: string, params: unknown[]): Promise<T> {
  const r = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** Lookup tables Kamino's own app uses on this market, read from recent successful transactions on its reserves. */
async function marketLuts(ctx: AdapterContext, reserves: string[]): Promise<Address[]> {
  const key = [...reserves].sort().join(",");
  const hit = lutCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.luts;
  const count = new Map<string, number>();
  for (const r of reserves) {
    const sigs = await jrpc<{ signature: string; err: unknown }[]>(ctx, "getSignaturesForAddress", [r, { limit: 12 }]);
    const txs = await Promise.all(sigs.filter((s) => !s.err).slice(0, 10).map((s) =>
      jrpc<{ transaction?: { message?: { addressTableLookups?: { accountKey: string }[] } } } | null>(ctx, "getTransaction", [s.signature, { maxSupportedTransactionVersion: 0, encoding: "json" }]).catch(() => null)));
    for (const t of txs) for (const l of t?.transaction?.message?.addressTableLookups ?? []) count.set(l.accountKey, (count.get(l.accountKey) ?? 0) + 1);
  }
  const luts = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => address(k));
  lutCache.set(key, { at: Date.now(), luts });
  return luts;
}

async function compile(ctx: AdapterContext, wallet: string, ixs: Instruction[], luts: Address[], extra: { address: Address; data: { addresses: Address[] } }[] = []): Promise<string> {
  const rpc = rpcFor(ctx);
  const tables = luts.length ? await fetchAllAddressLookupTable(rpc as never, luts) : [];
  const map: Record<string, Address[]> = {};
  for (const t of [...tables, ...extra]) map[t.address] = t.data.addresses as Address[];
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(wallet), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, map as never),
  );
  const b64 = getBase64EncodedWireTransaction(compileTransaction(msg));
  const size = Buffer.from(b64, "base64").length;
  if (size > MAX_TX) throw new Error(`transaction is ${size} bytes, over Solana's ${MAX_TX} byte limit`);
  return b64;
}

function walletBalance(positions: Position[], mint: string): number {
  return positions.filter((p) => p.kind === "token" && p.mint === mint).reduce((s, p) => s + p.amount, 0);
}

async function jupQuote(ctx: AdapterContext, inputMint: string, outputMint: string, amount: string, maxAccounts: number, direct: boolean) {
  const q = (await (await ctx.fetch(`${JUP}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&maxAccounts=${maxAccounts}${direct ? "&onlyDirectRoutes=true" : ""}`)).json()) as { inAmount?: string; outAmount?: string; error?: string };
  if (!q.outAmount || !q.inAmount) throw new Error(`Jupiter quote failed: ${q.error ?? "no route"}`);
  return q as { inAmount: string; outAmount: string };
}

export async function kaminoRepay(ctx: AdapterContext, wallet: string, obligationAddr: string, debtReserveAddr: string, debtMint: string, symbol: string, amount: number, positions: Position[]): Promise<KaminoBuilt> {
  const marketAddr = positions.find((p) => p.account === obligationAddr)?.extra?.market as string | undefined;
  if (!marketAddr) return { route: "repay", unsupported: "loan not found in this read" };
  const market = await loadMarket(ctx, marketAddr);
  const ob = await market.getObligationByAddress(address(obligationAddr));
  if (!ob) return { route: "repay", unsupported: "obligation not found on chain" };
  const reserve = market.getReserveByAddress(address(debtReserveAddr));
  if (!reserve) return { route: "repay", unsupported: "debt reserve not found in this market" };
  const owner = createNoopSigner(address(wallet));
  const rpc = rpcFor(ctx);
  const legs = positions.filter((p) => p.account === obligationAddr);
  const reserves = [...new Set(legs.map((p) => p.extra?.reserve as string).filter(Boolean))];
  const luts = await marketLuts(ctx, reserves);

  if (walletBalance(positions, debtMint) >= amount) {
    const action = await KaminoAction.buildRepayTxns({
      kaminoMarket: market, amount: String(Math.round(amount * 10 ** reserve.stats.decimals)), reserveAddress: reserve.address, owner, obligation: ob,
      useV2Ixs: true, scopeRefreshConfig: undefined, currentLedgerInstant: await getCurrentLedgerInstant(rpc as never), includeAtaIxs: true,
    });
    return { route: "repay", transaction: await compile(ctx, wallet, KaminoAction.actionToIxs(action), luts), summary: `Repays ${+amount.toFixed(4)} ${symbol} from your wallet.` };
  }

  // Not enough of the debt token in the wallet: pay it from the largest collateral in the same loan.
  const coll = legs.filter((p) => p.kind === "lend").sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
  if (!coll) return { route: "repay-with-collateral", unsupported: `wallet holds ${walletBalance(positions, debtMint)} ${symbol} and the loan has no collateral to sell` };
  // Shorter Jupiter routes on each retry until the whole transaction fits in one Solana transaction.
  let cap = (klend: Address[]) => Math.max(20, 60 - klend.length), direct = false;
  const quote = async (inputs: { inputAmountLamports: Decimal; inputMint: Address; outputMint: Address }, klend: Address[]) =>
    jupQuote(ctx, inputs.inputMint, inputs.outputMint, inputs.inputAmountLamports.floor().toString(), cap(klend), direct);
  // priceAInB is whole token B per whole token A, so scale the raw Jupiter amounts by each mint's decimals.
  const collReserve = market.getReserveByAddress(address(coll.extra!.reserve as string));
  const dec = new Map<string, number>([[reserve.getLiquidityMint(), reserve.stats.decimals], ...(collReserve ? [[collReserve.getLiquidityMint(), collReserve.stats.decimals] as [string, number]] : [])]);
  const price = (q: { inAmount: string; outAmount: string }, inMint: string, outMint: string) => {
    const di = dec.get(inMint), dout = dec.get(outMint);
    if (di == null || dout == null) throw new Error("unknown decimals for swap mints");
    return new Decimal(q.outAmount).div(new Decimal(10).pow(dout)).div(new Decimal(q.inAmount).div(new Decimal(10).pow(di)));
  };
  const quoter = async (inputs: { inputAmountLamports: Decimal; inputMint: Address; outputMint: Address }, klend: Address[]) => {
    const q = await quote(inputs, klend);
    return { priceAInB: price(q, inputs.inputMint, inputs.outputMint), quoteResponse: q };
  };
  const swapper = async (inputs: { inputAmountLamports: Decimal; inputMint: Address; outputMint: Address }, klend: Address[]) => {
    const q = await quote(inputs, klend);
    const r = (await (await ctx.fetch(`${JUP}/swap-instructions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteResponse: q, userPublicKey: wallet, wrapAndUnwrapSol: false, useSharedAccounts: true }) })).json()) as { swapInstruction?: JupIx; setupInstructions?: JupIx[]; addressLookupTableAddresses?: string[]; error?: string };
    if (!r.swapInstruction) throw new Error(`Jupiter swap failed: ${r.error ?? "no instruction"}`);
    const tables = await fetchAllAddressLookupTable(rpc as never, (r.addressLookupTableAddresses ?? []).map((a) => address(a)));
    return [{ preActionIxs: (r.setupInstructions ?? []).map(toIx), swapIxs: [toIx(r.swapInstruction)], lookupTables: tables, quote: { priceAInB: price(q, inputs.inputMint, inputs.outputMint), quoteResponse: q } }];
  };
  const tries: [(k: Address[]) => number, boolean][] = [[(k) => Math.max(20, 60 - k.length), false], [() => 24, false], [() => 16, false], [() => 16, true], [() => 12, false], [() => 10, true]];
  let built: { tx: string; sell: string } | undefined, lastErr = "no swap route from collateral to debt";
  for (const [c, d] of tries) {
    cap = c; direct = d;
    try {
      const res = await getRepayWithCollIxs({
        repayAmount: new Decimal(amount), isClosingPosition: false, collReserveAddress: address(coll.extra!.reserve as string), debtReserveAddress: reserve.address,
        currentLedgerInstant: await getCurrentLedgerInstant(rpc as never), kaminoMarket: market, owner, obligation: ob, quoter, swapper,
        referrer: none(), scopeRefreshIx: [], useV2Ixs: true, slippagePct: new Decimal(0.5), logger: () => {},
      } as never) as { ixs: Instruction[]; lookupTables: { address: Address; data: { addresses: Address[] } }[]; swapInputs: { inputAmountLamports: Decimal } }[];
      const best = res[0];
      if (!best) continue;
      const sell = best.swapInputs.inputAmountLamports.div(new Decimal(10).pow(collReserve?.stats.decimals ?? 6)).toDecimalPlaces(4).toString();
      built = { tx: await compile(ctx, wallet, best.ixs, luts, best.lookupTables), sell };
      break;
    } catch (e) { lastErr = String((e as Error).message ?? e).slice(0, 200); if (!/byte limit|no route|Jupiter/.test(lastErr)) break; }
  }
  if (!built) return { route: "repay-with-collateral", unsupported: lastErr };
  const { tx, sell } = built;
  return {
    route: "repay-with-collateral",
    transaction: tx,
    summary: `Your wallet holds ${walletBalance(positions, debtMint).toFixed(2)} ${symbol}, so this sells about ${sell} ${coll.symbol} from the loan's own collateral to repay ${+amount.toFixed(4)} ${symbol}. No spare ${symbol} needed.`,
  };
}

export async function kaminoWithdraw(ctx: AdapterContext, wallet: string, obligationAddr: string, reserveAddr: string, symbol: string, amount: number, positions: Position[]): Promise<KaminoBuilt> {
  const marketAddr = positions.find((p) => p.account === obligationAddr)?.extra?.market as string | undefined;
  if (!marketAddr) return { route: "withdraw", unsupported: "loan not found in this read" };
  const market = await loadMarket(ctx, marketAddr);
  const ob = await market.getObligationByAddress(address(obligationAddr));
  const reserve = market.getReserveByAddress(address(reserveAddr));
  if (!ob || !reserve) return { route: "withdraw", unsupported: "obligation or reserve not found on chain" };
  const legs = positions.filter((p) => p.account === obligationAddr);
  const luts = await marketLuts(ctx, [...new Set(legs.map((p) => p.extra?.reserve as string).filter(Boolean))]);
  const action = await KaminoAction.buildWithdrawTxns({
    kaminoMarket: market, amount: String(Math.round(amount * 10 ** reserve.stats.decimals)), reserveAddress: reserve.address, owner: createNoopSigner(address(wallet)), obligation: ob,
    useV2Ixs: true, scopeRefreshConfig: undefined, currentLedgerInstant: await getCurrentLedgerInstant(rpcFor(ctx) as never), includeAtaIxs: true,
  } as never);
  return { route: "withdraw", transaction: await compile(ctx, wallet, KaminoAction.actionToIxs(action), luts), summary: `Withdraws ${+amount.toFixed(4)} ${symbol} to your wallet.` };
}
