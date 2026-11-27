// Early fire: when a guarded loan is near its line, Steady buys the market price of each leg from independent
// Telegraph price miners (CRYPTO_PRICE_USD, three miners, they must agree within 1%) and recomputes health at those
// prices. If the market already puts the loan at the line, the guard fires now instead of waiting for the oracle and
// the next check. Every decision keeps the miners' signal hashes, so anyone can see which answers moved it.
import type { LoanAccount, LoanLeg } from "../engine/types.js";
import { quorum, type QuorumResult } from "../telegraph/client.js";

/** Symbols the price miners quote directly, and the base each leg is priced from. */
const BASE: Record<string, string> = {
  SOL: "SOL", WSOL: "SOL", USDC: "USDC", USDT: "USDT", PYUSD: "PYUSD", USDS: "USDS",
  BTC: "BTC", WBTC: "BTC", CBBTC: "BTC", TBTC: "BTC", ETH: "ETH", WETH: "ETH", WHETH: "ETH",
};
/** Liquid staking tokens: priced as SOL times the exchange rate the oracle already implies. */
const LST = new Set(["JITOSOL", "MSOL", "JUPSOL", "BSOL", "INF", "BBSOL", "HSOL", "VSOL", "DSOL", "BNSOL"]);

export const NEAR_LINE = 1.08; // ask only when health is within 8% of the line
export const ASK_EVERY_MS = 2 * 60_000;

export interface PriceCheck { symbol: string; oracle: number; market?: number | undefined; agreed: boolean; signals: string[]; costUsd: number }
export interface EarlyDecision { projected: number; fire: boolean; checks: PriceCheck[]; reason?: string | undefined; costUsd: number }

export type PriceAsk = (symbol: string) => Promise<QuorumResult<number>>;

export const askPrice: PriceAsk = (symbol) =>
  quorum<number>({
    intent: "CRYPTO_PRICE_USD",
    params: { symbol },
    extract: (r) => { const v = (r as { price_usd?: unknown }).price_usd; return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined; },
    valid: (v) => (Number.isFinite(v) && v > 0 ? undefined : "not a price"),
    same: (a, b) => Math.abs(a - b) / Math.max(a, b) < 0.01,
    need: 2,
  });

const oraclePrice = (l: LoanLeg) => (l.amount > 0 ? l.usd / l.amount : 0);
const baseOf = (symbol: string) => { const s = symbol.toUpperCase(); return BASE[s] ?? (LST.has(s) ? "SOL" : undefined); };

/** Health with each covered leg repriced at the agreed market price; uncovered legs keep the oracle price. */
export async function projectHealth(loan: LoanAccount, ask: PriceAsk = askPrice, solOracle?: number): Promise<EarlyDecision & { line?: number }> {
  const legs = [...loan.collaterals, ...loan.borrows];
  const bases = [...new Set(legs.map((l) => baseOf(l.symbol)).filter((b): b is string => !!b))];
  const market = new Map<string, QuorumResult<number>>();
  await Promise.all(bases.map(async (b) => market.set(b, await ask(b))));
  // SOL oracle price, to turn an LST oracle price into its exchange rate.
  const solLeg = legs.find((l) => baseOf(l.symbol) === "SOL" && !LST.has(l.symbol.toUpperCase()));
  const solO = solLeg ? oraclePrice(solLeg) : solOracle;
  const checks: PriceCheck[] = [];
  const reprice = (l: LoanLeg): number => {
    const b = baseOf(l.symbol); const o = oraclePrice(l);
    const q = b ? market.get(b) : undefined;
    const signals = (q?.answers ?? []).filter((a) => a.used && a.signalHash).map((a) => a.signalHash!);
    if (!b || !q || !q.agreed || q.value === undefined) { checks.push({ symbol: l.symbol, oracle: o, agreed: false, signals, costUsd: q?.costUsd ?? 0 }); return l.usd; }
    let m = q.value;
    if (LST.has(l.symbol.toUpperCase())) { if (!solO) { checks.push({ symbol: l.symbol, oracle: o, agreed: false, signals, costUsd: 0 }); return l.usd; } m = q.value * (o / solO); }
    checks.push({ symbol: l.symbol, oracle: o, market: m, agreed: true, signals, costUsd: q.costUsd });
    return l.amount * m;
  };
  const coll = loan.collaterals.reduce((s, l) => s + reprice(l) * l.factor, 0);
  const debt = loan.borrows.reduce((s, l) => s + reprice(l) * (l.factor || 1), 0);
  const costUsd = [...market.values()].reduce((s, q) => s + q.costUsd, 0);
  return { projected: debt > 0 ? coll / debt : Infinity, fire: false, checks, costUsd };
}

/** Decide whether to fire early. Only a projection built from agreed market prices can fire. */
export async function decideEarly(loan: LoanAccount, health: number, line: number, ask: PriceAsk = askPrice): Promise<EarlyDecision> {
  if (health > line * NEAR_LINE) return { projected: health, fire: false, checks: [], costUsd: 0 };
  const p = await projectHealth(loan, ask);
  const moved = p.checks.filter((c) => c.agreed && c.market !== undefined && Math.abs(c.market - c.oracle) / c.oracle > 0.001);
  const fire = moved.length > 0 && p.projected <= line;
  const detail = moved.map((c) => `${c.symbol} ${c.market!.toPrecision(5)} on the market vs ${c.oracle.toPrecision(5)} on the oracle`).join("; ");
  return {
    ...p, fire,
    reason: fire ? `Independent Telegraph price miners agree the market already puts health at ${p.projected.toFixed(3)}, at or below the line ${line} (${detail}). Signals ${p.checks.flatMap((c) => c.signals).map((s) => s.slice(0, 10)).join(", ")}.` : undefined,
  };
}
