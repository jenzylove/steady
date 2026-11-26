// Generators for the four prediction kinds. Pure builders (tested with fixtures) are separate from the live readers.
// Every verdict, value and why is computed by code from a mainnet read; no model is involved here.
import type { Prediction } from "../engine/advice/types.js";
import type { AdapterContext, LoanAccount } from "../engine/types.js";
import { exitCost } from "../engine/risk/exit.js";
import { healthFactor } from "../engine/risk/health.js";
import { kaminoAdapter, KAMINO_API } from "../engine/adapters/kamino.js";
import { getProgramAccounts, getJson } from "../engine/adapters/lend-lib.js";
import { getMultiple, getPrices, u128, pk } from "../engine/adapters/lib.js";

export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const HOUR = 3600_000;
export const HORIZON_HOURS = { rate_drift: 72, peg_band: 24, exit_at_size: 24, liquidation_distance: 24 } as const;

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 1e2) / 1e2;
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 13); // 20261126T10

function base(kind: Prediction["kind"], subject: string, now: Date) {
  const madeAt = now.toISOString();
  const settleAt = new Date(now.getTime() + HORIZON_HOURS[kind] * HOUR).toISOString();
  return { madeAt, settleAt, idPrefix: `${kind}:${subject.slice(0, 8)}`, tag: stamp(now) };
}

// ---------- rate_drift ----------
export interface RateInput {
  symbol: string;
  mint: string;
  reserve: string;
  market: string;
  apyPct: number; // current supply APY in percent
  historyPct: number[]; // hourly supply APY in percent, oldest first
}

/** Band half width in percentage points: 20% of the rate, never narrower than 0.5 points. */
export function rateBand(apyPct: number): { lo: number; hi: number; width: number } {
  const width = Math.max(0.5, apyPct * 0.2);
  return { lo: Math.max(0, apyPct - width), hi: apyPct + width, width };
}

/** Share of past windows (one per hour) in which the rate sat inside the band built around the window start `hours` later. */
export function rateStability(history: number[], hours: number): { stable: number; windows: number } {
  let stable = 0, windows = 0;
  for (let i = 0; i + hours < history.length; i++) {
    const b = rateBand(history[i]!);
    windows++;
    const end = history[i + hours]!;
    if (end >= b.lo && end <= b.hi) stable++;
  }
  return { stable, windows };
}

export function buildRateDrift(x: RateInput, now: Date): Prediction {
  const { madeAt, settleAt, idPrefix, tag } = base("rate_drift", x.reserve, now);
  const b = rateBand(x.apyPct);
  const lo = r2(b.lo), hi = r2(b.hi);
  const st = rateStability(x.historyPct, HORIZON_HOURS.rate_drift);
  const share = st.windows ? st.stable / st.windows : 0;
  const verdict = st.windows >= 24 && share >= 0.5;
  const claim = `${x.symbol} supply APY on Kamino main is between ${lo}% and ${hi}% at settle time, 72 hours from now`;
  const question = `On Kamino Lend (Solana, main market), will the ${x.symbol} supply APY be between ${lo}% and ${hi}% on ${settleAt}? Set "value" to your estimate of the supply APY in percent at that time.`;
  return {
    id: `${idPrefix}:${tag}`, kind: "rate_drift", subject: x.reserve, claim, madeAt, settleAt,
    params: { symbol: x.symbol, mint: x.mint, market: x.market, lo, hi, horizonHours: 72, currentApyPct: r4(x.apyPct), source: `${KAMINO_API}/kamino-market/<market>/reserves/metrics (supplyApy)`, question },
    steady: {
      verdict, value: r4(x.apyPct),
      why: `Current supply APY is ${r2(x.apyPct)}%. In ${st.stable} of ${st.windows} hourly windows over the last 7 days the rate was still inside the same band 72 hours later (${r2(share * 100)}%); the call is ${verdict ? "stays inside" : "leaves the band"}. Value is the current rate carried forward.`,
    },
  };
}

// ---------- peg_band ----------
export interface PegInput { symbol: string; mint: string; price: number }
export const PEG_LO = 0.995, PEG_HI = 1.005;

export function buildPegBand(x: PegInput, now: Date): Prediction {
  const { madeAt, settleAt, idPrefix, tag } = base("peg_band", x.mint, now);
  const dev = Math.abs(x.price - 1);
  const verdict = x.price >= PEG_LO && x.price <= PEG_HI && dev <= 0.003;
  const claim = `${x.symbol} Jupiter price is between $${PEG_LO} and $${PEG_HI} at settle time, 24 hours from now`;
  const question = `Will the Jupiter price of ${x.symbol} on Solana (mint ${x.mint}) be between $${PEG_LO} and $${PEG_HI} on ${settleAt}? Set "value" to your estimate of its USD price at that time.`;
  return {
    id: `${idPrefix}:${tag}`, kind: "peg_band", subject: x.mint, claim, madeAt, settleAt,
    params: { symbol: x.symbol, lo: PEG_LO, hi: PEG_HI, horizonHours: 24, currentPrice: r4(x.price), source: "https://lite-api.jup.ag/price/v3", question },
    steady: {
      verdict, value: r4(x.price),
      why: `Jupiter prices ${x.symbol} at $${x.price.toFixed(4)}, ${(dev * 100).toFixed(2)}% from $1. The call holds when the price is inside the band and within 0.3% of $1 now; value is the current price carried forward.`,
    },
  };
}

// ---------- exit_at_size ----------
export interface ExitInput {
  pool: string;
  poolLabel: string;
  tokenIn: string;
  symbol: string;
  amount: number; // UI units
  usd: number;
  impactPct: number; // best Jupiter route right now
}
export const IMPACT_TIERS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

/** Smallest tier at least 1.3 times the current impact. */
export function impactCeiling(impactPct: number): number {
  return IMPACT_TIERS.find((t) => t >= impactPct * 1.3) ?? 100;
}

export function buildExitAtSize(x: ExitInput, now: Date): Prediction {
  const { madeAt, settleAt, idPrefix, tag } = base("exit_at_size", x.pool, now);
  const y = impactCeiling(x.impactPct);
  const size = `${x.amount.toFixed(x.amount < 1 ? 4 : 2)} ${x.symbol} (about $${Math.round(x.usd).toLocaleString("en-US")})`;
  const claim = `Selling ${size} through the best Jupiter route costs under ${y}% price impact at settle time, 24 hours from now`;
  const question = `On Solana, will selling ${size} for USDC through the best Jupiter swap route cost less than ${y}% price impact on ${settleAt}? Set "value" to your estimate of the price impact in percent.`;
  const verdict = x.impactPct < y;
  return {
    id: `${idPrefix}:${Math.round(x.usd / 1000)}k:${tag}`, kind: "exit_at_size", subject: x.pool, claim, madeAt, settleAt,
    params: { symbol: x.symbol, tokenIn: x.tokenIn, amount: r4(x.amount), usd: Math.round(x.usd), maxImpactPct: y, pool: x.poolLabel, horizonHours: 24, currentImpactPct: r4(x.impactPct), source: "https://lite-api.jup.ag/swap/v1/quote via exitCost", question },
    steady: {
      verdict, value: r4(x.impactPct),
      why: `exitCost prices this sale at ${x.impactPct.toFixed(3)}% impact on the best Jupiter route right now (pool ${x.poolLabel}). The ceiling ${y}% is the smallest tier at least 1.3 times that, so the call is impact stays under it.`,
    },
    usdAtStake: Math.round(x.usd),
  };
}

// ---------- liquidation_distance ----------
export interface LiqInput {
  account: string;
  owner: string;
  health: number;
  debtUsd: number;
  collateralUsd: number;
}
/** Collateral value must fall by at least this share (all other prices fixed) before the loan is called at risk within a day. */
export const SAFE_DROP = 0.06;

export function buildLiquidationDistance(x: LiqInput, now: Date): Prediction {
  const { madeAt, settleAt, idPrefix, tag } = base("liquidation_distance", x.account, now);
  const drop = x.health > 0 ? 1 - 1 / x.health : 0;
  const verdict = drop >= SAFE_DROP;
  const claim = `Kamino loan ${x.account.slice(0, 8)} has health above 1.0 (not liquidatable) at settle time, 24 hours from now`;
  const question = `A Kamino Lend (Solana, main market) loan with obligation account ${x.account} has debt. Will its health factor be above 1.0 (not liquidatable) on ${settleAt}? Set "value" to your estimate of its health factor then.`;
  return {
    id: `${idPrefix}:${tag}`, kind: "liquidation_distance", wallet: x.owner, subject: x.account, claim, madeAt, settleAt,
    params: { minHealth: 1, horizonHours: 24, currentHealth: r4(x.health), dropToLiquidation: r4(drop), safeDrop: SAFE_DROP, debtUsd: Math.round(x.debtUsd), collateralUsd: Math.round(x.collateralUsd), source: "Solana mainnet klend obligation and reserves via kaminoAdapter", question },
    steady: {
      verdict, value: r4(x.health),
      why: `Health is ${x.health.toFixed(4)}: collateral would have to lose ${(drop * 100).toFixed(1)}% of its value (other prices fixed) to reach 1.0. The call is safe when that distance is at least ${SAFE_DROP * 100}%; value is the current health carried forward.`,
    },
    usdAtStake: Math.round(x.debtUsd),
  };
}

// ---------- live readers ----------
interface ReserveMetric { reserve: string; liquidityToken: string; liquidityTokenMint: string; supplyApy: string; totalSupplyUsd: string }

export async function readKaminoMetrics(ctx: AdapterContext, market = KAMINO_MAIN_MARKET): Promise<ReserveMetric[]> {
  return getJson<ReserveMetric[]>(ctx, `${KAMINO_API}/kamino-market/${market}/reserves/metrics`);
}

export async function readApyHistory(ctx: AdapterContext, reserve: string, market = KAMINO_MAIN_MARKET): Promise<number[]> {
  const end = ctx.now(), start = new Date(end.getTime() - 7 * 24 * HOUR);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const j = await getJson<{ history: { timestamp: string; metrics: { supplyInterestAPY?: number | string } }[] }>(
    ctx, `${KAMINO_API}/kamino-market/${market}/reserves/${reserve}/metrics/history?start=${d(start)}&end=${d(new Date(end.getTime() + 24 * HOUR))}&frequency=hour`);
  return j.history.filter((h) => h.metrics.supplyInterestAPY != null).map((h) => Number(h.metrics.supplyInterestAPY) * 100);
}

export const RATE_MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  SOL: "So11111111111111111111111111111111111111112",
  JitoSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

export async function makeRateDrift(ctx: AdapterContext): Promise<Prediction[]> {
  const metrics = await readKaminoMetrics(ctx);
  const out: Prediction[] = [];
  for (const [symbol, mint] of Object.entries(RATE_MINTS)) {
    const m = metrics.filter((r) => r.liquidityTokenMint === mint).sort((a, b) => Number(b.totalSupplyUsd) - Number(a.totalSupplyUsd))[0];
    if (!m) continue;
    const historyPct = await readApyHistory(ctx, m.reserve);
    out.push(buildRateDrift({ symbol, mint, reserve: m.reserve, market: KAMINO_MAIN_MARKET, apyPct: Number(m.supplyApy) * 100, historyPct }, ctx.now()));
  }
  return out;
}

export const STABLES: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  USDe: "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT",
  USDS: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
};

export async function makePegBand(ctx: AdapterContext): Promise<Prediction[]> {
  const prices = await getPrices(ctx, Object.values(STABLES));
  return Object.entries(STABLES).flatMap(([symbol, mint]) => {
    const price = prices.get(mint);
    return price == null ? [] : [buildPegBand({ symbol, mint, price }, ctx.now())];
  });
}

export interface PoolSpec { pool: string; label: string; tokenIn: string; symbol: string; usd: number }
const SOL = "So11111111111111111111111111111111111111112";
export const EXIT_POOLS: PoolSpec[] = [
  { pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", label: "Orca SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 100_000 },
  { pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", label: "Orca SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 1_000_000 },
  { pool: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", label: "Raydium CLMM SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 100_000 },
  { pool: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", label: "Raydium CLMM SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 1_000_000 },
  { pool: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y", label: "Meteora DLMM SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 100_000 },
  { pool: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", label: "Raydium AMM SOL/USDC", tokenIn: SOL, symbol: "SOL", usd: 100_000 },
];

export async function makeExitAtSize(ctx: AdapterContext, pools: PoolSpec[] = EXIT_POOLS): Promise<{ predictions: Prediction[]; gaps: string[] }> {
  const prices = await getPrices(ctx, pools.map((p) => p.tokenIn));
  const predictions: Prediction[] = [], gaps: string[] = [];
  for (const p of pools) {
    const px = prices.get(p.tokenIn);
    if (!px) { gaps.push(`exit_at_size: no price for ${p.symbol}`); continue; }
    const amount = p.usd / px;
    try {
      const c = await exitCost(ctx, p.pool, p.tokenIn, amount);
      const impact = c.bestRoute?.impactPct;
      if (impact == null) { gaps.push(`exit_at_size: no Jupiter route for ${p.label} at $${p.usd}`); continue; }
      predictions.push(buildExitAtSize({ pool: p.pool, poolLabel: p.label, tokenIn: p.tokenIn, symbol: p.symbol, amount, usd: p.usd, impactPct: impact }, ctx.now()));
    } catch (e) { gaps.push(`exit_at_size: ${p.label} $${p.usd}: ${(e as Error).message}`); }
  }
  return { predictions, gaps };
}

export interface ObligationCandidate { address: string; health: number; debtUsd: number }

/** Scan main market obligations through a 64 byte slice (debt and liquidation limit) and keep real loans near the edge. */
export async function findObligations(ctx: AdapterContext, minDebt = 5_000, maxDebt = 5_000_000, hMin = 1.02, hMax = 1.5): Promise<ObligationCandidate[]> {
  const SF = 2 ** 60;
  const { accounts } = await getProgramAccounts(ctx, KLEND_PROGRAM, [{ dataSize: 3344 }, { memcmp: { offset: 32, bytes: KAMINO_MAIN_MARKET } }], { offset: 2208, length: 64 });
  const out: ObligationCandidate[] = [];
  for (const a of accounts) {
    const adjusted = Number(u128(a.data, 0)) / SF, debt = Number(u128(a.data, 16)) / SF, unhealthy = Number(u128(a.data, 48)) / SF;
    if (adjusted <= 0 || debt < minDebt || debt > maxDebt) continue;
    const h = unhealthy / adjusted;
    if (h >= hMin && h <= hMax) out.push({ address: a.pubkey, health: h, debtUsd: debt });
  }
  return out;
}

/** Spread picks across a sorted list so the set mixes sizes and health levels. */
export function spreadPick<T>(sorted: T[], n: number): T[] {
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.floor((i * sorted.length) / n)]!);
}

export async function readLoan(ctx: AdapterContext, owner: string, account: string): Promise<LoanAccount | undefined> {
  const r = await kaminoAdapter.read(owner, ctx);
  return r.loans.find((l) => l.account === account);
}

export async function makeLiquidationDistance(ctx: AdapterContext, n = 8): Promise<{ predictions: Prediction[]; gaps: string[] }> {
  const cands = (await findObligations(ctx)).sort((a, b) => b.debtUsd - a.debtUsd);
  const picks = spreadPick(cands, n * 3);
  const predictions: Prediction[] = [], gaps: string[] = [];
  const owners = await getMultiple(ctx, picks.map((p) => p.address));
  const seen = new Set<string>();
  for (let i = 0; i < picks.length && predictions.length < n; i++) {
    const acc = owners.accounts[i];
    if (!acc) continue;
    const owner = pk(acc.data, 64);
    if (seen.has(owner)) continue;
    try {
      const loan = await readLoan(ctx, owner, picks[i]!.address);
      if (!loan || loan.borrows.length === 0) continue;
      const h = healthFactor(loan);
      const debt = loan.borrows.reduce((s, l) => s + l.usd, 0), coll = loan.collaterals.reduce((s, l) => s + l.usd, 0);
      if (!Number.isFinite(h) || h <= 1 || h > 2 || debt < 1000) continue;
      seen.add(owner);
      predictions.push(buildLiquidationDistance({ account: loan.account, owner, health: h, debtUsd: debt, collateralUsd: coll }, ctx.now()));
    } catch (e) { gaps.push(`liquidation_distance: ${picks[i]!.address}: ${(e as Error).message}`); }
  }
  return { predictions, gaps };
}

export async function makeAll(ctx: AdapterContext): Promise<{ predictions: Prediction[]; gaps: string[] }> {
  const gaps: string[] = [];
  const predictions: Prediction[] = [];
  const run = async (name: string, f: () => Promise<Prediction[] | { predictions: Prediction[]; gaps: string[] }>) => {
    try {
      const r = await f();
      if (Array.isArray(r)) predictions.push(...r);
      else { predictions.push(...r.predictions); gaps.push(...r.gaps); }
    } catch (e) { gaps.push(`${name}: ${(e as Error).message}`); }
  };
  await run("rate_drift", () => makeRateDrift(ctx));
  await run("peg_band", () => makePegBand(ctx));
  await run("exit_at_size", () => makeExitAtSize(ctx));
  await run("liquidation_distance", () => makeLiquidationDistance(ctx));
  return { predictions, gaps };
}
