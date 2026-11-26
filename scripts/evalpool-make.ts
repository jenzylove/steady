// Builds Telegraph evaluation material (Track 02) from Steady's own Solana mainnet reads.
// Each row is a real question with a better answer (the chain truth at a stated slot) and a worse answer
// (a failure mode seen from paid miners: wrong magnitude, TVL read as depth, wrong chain, lamports as SOL).
// Rows are written OUTSIDE the repo: evaluation material stays private so the hidden half stays hidden.
// Usage: npx tsx -r dotenv/config scripts/evalpool-make.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { makeContext } from "../src/engine/context.js";
import { poolLiquidity, type PoolLiquidity } from "../src/engine/pools/liquidity.js";
import { KNOWN_POOLS } from "../src/miner/pools.js";

const OUT = process.argv[2] ?? "C:/Users/LENOVO/steady-launch/evalpool";
const ctx = makeContext();
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_DEX: Record<string, string> = { Orca: "Whirlpool", Raydium: "Raydium", Meteora: "Meteora DLMM" };

type Row = { prompt: string; chosen: string; rejected: string; label_kind: "preference_pair"; provenance: { source_kind: string; source_url: string } };
const rows: Record<string, Row[]> = { LIQUIDITY_DEPTH_VERIFY_GENERAL: [], TVL_LOOKUP_GENERAL: [], WALLET_BALANCE_CHECK_GENERAL: [] };
const add = (intent: string, prompt: string, chosen: string, rejected: string, url: string) =>
  rows[intent]!.push({ prompt, chosen, rejected, label_kind: "preference_pair", provenance: { source_kind: "solana_mainnet_read", source_url: url } });

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const amt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const slotOf = (p: PoolLiquidity) => p.sources.find((s) => s.kind === "chain")?.slot ?? null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = new Date();
const stamp = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";

async function quote(dex: string, inMint: string, outMint: string, raw: bigint) {
  const u = `${JUP}?inputMint=${inMint}&outputMint=${outMint}&amount=${raw}&slippageBps=50&onlyDirectRoutes=true&dexes=${encodeURIComponent(dex)}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u);
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    const j: any = await r.json();
    if (!j.outAmount) return null;
    return { out: Number(j.outAmount), impactPct: Number(j.priceImpactPct) * 100, ammKey: j.routePlan?.[0]?.swapInfo?.ammKey as string, label: j.routePlan?.[0]?.swapInfo?.label as string, url: u };
  }
  return null;
}

// Each pool gets its own wording so no two prompts are near duplicates (the node rejects 85% similar prompts).
const DEPTH_ASK = [
  (n: string, a: string) => `As of ${stamp}, how much liquidity sits in the ${n} pool on Solana (address ${a})? Give the token amounts in its vaults and the USD value.`,
  (n: string, a: string) => `I am about to trade through Solana pool ${a}, which should be ${n}. What does it actually hold right now (${stamp}) in each token, and what is that worth in dollars?`,
  (n: string, a: string) => `Check the depth of ${n} on Solana mainnet, pool account ${a}. Report both reserves and the total USD liquidity at the time of reading, ${stamp}.`,
  (n: string, a: string) => `Pool ${a} on solana (${n}): what are its current token balances and total liquidity in USD? Time of the question: ${stamp}.`,
  (n: string, a: string) => `Before I route a swap, verify the liquidity of the ${n} pool at ${a} on Solana. How many of each token does it hold and what is the USD total? (${stamp})`,
  (n: string, a: string) => `For risk limits I need the on chain reserves of ${n} (Solana pool ${a}) as of ${stamp}: amount of each token and combined USD value.`,
  (n: string, a: string) => `Give me the liquidity_usd for Solana pool ${a} (${n}) right now, ${stamp}, with the vault balances you used to get it.`,
  (n: string, a: string) => `How deep is ${n}? Pool address ${a}, chain solana, question asked ${stamp}. I want reserves per token and the dollar total, not the DEX wide TVL.`,
  (n: string, a: string) => `Read the vaults of Solana liquidity pool ${a} (${n}) and tell me what they contain and their USD worth at ${stamp}.`,
];

const TVL_ASK = [
  (n: string, a: string) => `What is the total value locked in the ${n} pool on Solana, pool ${a}, as of ${stamp}?`,
  (n: string, a: string) => `TVL check for one Solana pool: ${n} at ${a}. What is it in USD at ${stamp}, and what is that number made of?`,
  (n: string, a: string) => `How many dollars are deposited in Solana pool ${a} (${n}) right now (${stamp})?`,
];

async function pools() {
  const read: { p: (typeof KNOWN_POOLS)[number]; liq: PoolLiquidity }[] = [];
  for (const p of KNOWN_POOLS) {
    try { const liq = await poolLiquidity(ctx, p.address); if (liq.usd != null) read.push({ p, liq }); }
    catch (e) { console.error("skip", p.address, String(e).slice(0, 120)); }
  }
  read.forEach(({ p, liq }, i) => {
    const name = `${p.dex} ${p.pair} ${p.fee}${p.kind ? ` ${p.kind}` : ""}`;
    const slot = slotOf(liq);
    const a = liq.tokenA, b = liq.tokenB;
    const url = `https://solscan.io/account/${p.address}`;
    const truth = `At slot ${slot} (${stamp}) the ${name} pool ${p.address} holds ${amt(a.amount)} ${a.symbol} (${usd(a.usd ?? 0)}) and ${amt(b.amount)} ${b.symbol} (${usd(b.usd ?? 0)}) in its two vaults, ${a.vault} and ${b.vault}. Total liquidity is about ${usd(liq.usd!)}. Read directly from the vault token accounts on Solana mainnet; withheld protocol fees are excluded.`;
    // Worse answers, rotated: the real paid miner answer for the Orca SOL/USDC pool, then the failure modes we saw.
    let worse: string;
    if (p.address === "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE") worse = `The pool has about $3,500,000 of liquidity.`; // real paid answer, Nov 25 2026
    else {
      const mode = i % 4;
      if (mode === 0) worse = `Liquidity is roughly ${usd(liq.usd! * 0.21)}. Reserves: ${amt(a.amount * 0.21)} ${a.symbol} and ${amt(b.amount * 0.21)} ${b.symbol}.`;
      else if (mode === 1) worse = `I could not find this pool on Ethereum or Base, so its liquidity is 0 USD.`;
      else if (mode === 2) worse = `This pool holds ${amt(a.amount * 1e3, 0)} ${a.symbol} and ${amt(b.amount * 1e3, 0)} ${b.symbol}, about ${usd(liq.usd! * 1e3)} in total.`;
      else worse = `${p.dex} has more than $500,000,000 locked across its Solana pools, so liquidity here is effectively unlimited for any normal trade.`;
    }
    add("LIQUIDITY_DEPTH_VERIFY_GENERAL", DEPTH_ASK[i % DEPTH_ASK.length]!(name, p.address), truth, worse, url);
    if (i < TVL_ASK.length) {
      add("TVL_LOOKUP_GENERAL", TVL_ASK[i]!(name, p.address),
        `The ${name} pool (${p.address}) has about ${usd(liq.usd!)} locked as of slot ${slot}: ${amt(a.amount)} ${a.symbol} plus ${amt(b.amount)} ${b.symbol}, valued at current USD prices. This is the pool's own TVL, not ${p.dex}'s protocol wide TVL.`,
        i === 0 ? `${p.dex} TVL on Solana is about $480,000,000.` : `Around ${usd(liq.usd! * 4.7)} according to the last snapshot I have.`, url);
    }
  });
  return read;
}

// Depth at a size: Jupiter direct route restricted to one DEX, so the slippage is that venue's own book.
const SIZE_ASK = [
  (dex: string, n: number) => `What slippage would a sale of ${n} SOL into USDC take on ${dex} on Solana right now (${stamp}), using only that venue's pools and a single hop?`,
  (dex: string, n: number) => `If I dump ${n} SOL for USDC on ${dex} alone (Solana, direct route, ${stamp}), how many USDC do I get and what is the price impact?`,
  (dex: string, n: number) => `Is ${dex} deep enough on Solana to absorb a ${n} SOL market sell into USDC without moving the price more than 1%? Answer for ${stamp}.`,
  (dex: string, n: number) => `Expected execution for ${n} SOL to USDC through ${dex} pools only on solana, at ${stamp}: output amount, effective price and impact.`,
  (dex: string, n: number) => `Depth at size question. Venue: ${dex}, chain Solana, trade: sell ${n} SOL for USDC in one hop, time ${stamp}. What is the cumulative slippage?`,
  (dex: string, n: number) => `How much price impact does a ${n} SOL sell have on ${dex}'s SOL/USDC liquidity on Solana as of ${stamp}?`,
];
async function sizes(solUsd: number) {
  let k = 0;
  for (const dex of ["Orca", "Raydium", "Meteora"]) {
    for (const n of [250, 5000]) {
      const q = await quote(JUP_DEX[dex]!, SOL, USDC, BigInt(n) * 1_000_000_000n);
      await sleep(800);
      if (!q) { console.error("no quote", dex, n); continue; }
      const outUsdc = q.out / 1e6, eff = outUsdc / n;
      const truth = `Selling ${n} SOL through ${dex} only (best single hop, pool ${q.ammKey}, ${q.label}) returns about ${amt(outUsdc)} USDC, an effective price of ${amt(eff, 4)} USDC per SOL against a reference of ${amt(solUsd, 4)}. Quoted price impact is ${amt(q.impactPct, 3)}%, which is ${q.impactPct < 1 ? "under" : "over"} 1%. Quoted ${stamp} from on chain pool state.`;
      const badPct = Math.max(q.impactPct * 9, 2.5);
      const worse = k % 2 === 0
        ? `${dex} holds hundreds of millions in TVL, so ${n} SOL will fill at the market price with no meaningful slippage.`
        : `Expect about ${amt(n * solUsd * (1 - badPct / 100))} USDC, roughly ${amt(badPct, 1)}% slippage, since ${dex} SOL/USDC pools are thin.`;
      add("LIQUIDITY_DEPTH_VERIFY_GENERAL", SIZE_ASK[k % SIZE_ASK.length]!(dex, n), truth, worse, q.url);
      k++;
    }
  }
}

// Wallet balances read at one slot: native SOL and USDC.
const WALLETS = ["44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS", "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"];
const WALLET_ASK = [
  (w: string) => `What is the SOL balance of ${w} on solana right now (${stamp})?`,
  (w: string) => `How much USDC and how much native SOL does Solana address ${w} hold as of ${stamp}?`,
  (w: string) => `Check wallet ${w} on Solana mainnet at ${stamp}: give its native SOL balance and its USDC balance across all its token accounts.`,
];
async function rpc(method: string, params: unknown[]) {
  const r = await ctx.fetch(ctx.heliusRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
async function wallets() {
  for (const [i, w] of WALLETS.entries()) {
    const bal = await rpc("getBalance", [w, { commitment: "confirmed" }]);
    const toks = await rpc("getTokenAccountsByOwner", [w, { mint: USDC }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const sol = bal.value / 1e9;
    const usdc = toks.value.reduce((s: number, a: any) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
    const slot = bal.context.slot;
    const url = `https://solscan.io/account/${w}`;
    const chosen = i === 0
      ? `At slot ${slot} (${stamp}) ${w} holds ${amt(sol, 6)} SOL (${bal.value.toLocaleString("en-US")} lamports). Read with getBalance on Solana mainnet. Staked SOL and SOL inside DeFi positions are not part of this balance.`
      : `At slot ${slot} (${stamp}) ${w} holds ${amt(sol, 4)} SOL and ${amt(usdc, 2)} USDC (mint EPjFWdd5…Dt1v, summed over ${toks.value.length} token account${toks.value.length === 1 ? "" : "s"}). Read on Solana mainnet with getBalance and getTokenAccountsByOwner.`;
    const rejected = i === 0 ? `The wallet holds ${bal.value.toLocaleString("en-US")} SOL.`
      : i === 1 ? `This address has no balance: it is not a valid Ethereum address.`
      : `It holds ${amt(sol, 4)} SOL. No USDC was found because USDC is not native to Solana.`;
    add("WALLET_BALANCE_CHECK_GENERAL", WALLET_ASK[i]!(w), chosen, rejected, url);
  }
}

const read = await pools();
const solSide = read.map((r) => r.liq).flatMap((l) => [l.tokenA, l.tokenB]).find((s) => s.mint === SOL && s.usd && s.amount);
await sizes(solSide ? solSide.usd! / solSide.amount : 0);
await wallets();
mkdirSync(OUT, { recursive: true });
for (const [intent, list] of Object.entries(rows)) {
  writeFileSync(`${OUT}/${intent}.jsonl`, list.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(intent, list.length, "rows");
}
