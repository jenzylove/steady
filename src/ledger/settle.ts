// Settle due predictions from fresh mainnet reads and score both records (hit or miss, absolute error on value).
import type { Prediction } from "../engine/advice/types.js";
import type { AdapterContext, Source } from "../engine/types.js";
import { exitCost } from "../engine/risk/exit.js";
import { healthFactor } from "../engine/risk/health.js";
import { KAMINO_API } from "../engine/adapters/kamino.js";
import { getPrices } from "../engine/adapters/lib.js";
import { Ledger, type Outcome, type Score, type SettlementBody } from "./store.js";
import { KAMINO_MAIN_MARKET, readKaminoMetrics, readLoan } from "./make.js";

export function isDue(p: Prediction, now: Date): boolean {
  return !p.outcome && new Date(p.settleAt).getTime() <= now.getTime();
}

const num = (p: Prediction, k: string): number => {
  const v = p.params[k];
  if (typeof v !== "number") throw new Error(`prediction ${p.id} has no numeric param ${k}`);
  return v;
};
const str = (p: Prediction, k: string): string => {
  const v = p.params[k];
  if (typeof v !== "string") throw new Error(`prediction ${p.id} has no string param ${k}`);
  return v;
};

/** The truth of the claim given the settled value. Pure, so it is tested without a network. */
export function judge(p: Prediction, value: number): boolean {
  switch (p.kind) {
    case "rate_drift":
    case "peg_band":
      return value >= num(p, "lo") && value <= num(p, "hi");
    case "exit_at_size":
      return value < num(p, "maxImpactPct");
    case "liquidation_distance":
      return value > num(p, "minHealth");
  }
}

export function outcomeFrom(p: Prediction, value: number, source: Source, settledAt: Date): Outcome {
  return { verdict: judge(p, value), value, settledAt: settledAt.toISOString(), source };
}

export function scoreOne(record: { verdict: boolean; value?: number | undefined }, outcome: Outcome): Score {
  return { hit: record.verdict === outcome.verdict, ...(record.value !== undefined ? { absError: Math.abs(record.value - outcome.value) } : {}) };
}

export function scoreBoth(p: Prediction, outcome: Outcome): SettlementBody["score"] {
  return {
    steady: scoreOne(p.steady, outcome),
    ...(p.frontier ? { frontier: scoreOne(p.frontier, outcome) } : {}),
    ...(p.frontierInformed ? { frontierInformed: scoreOne(p.frontierInformed, outcome) } : {}),
  };
}

/** Largest health value stored; a loan with no debt left has infinite health. */
export const HEALTH_CAP = 999;

/** Fresh read of the quantity each kind is about. Throws when the read is not possible (the prediction then stays open). */
export async function readOutcome(ctx: AdapterContext, p: Prediction): Promise<{ value: number; source: Source }> {
  const fetchedAt = ctx.now().toISOString();
  switch (p.kind) {
    case "rate_drift": {
      const m = (await readKaminoMetrics(ctx, str(p, "market"))).find((r) => r.reserve === p.subject);
      if (!m) throw new Error(`reserve ${p.subject} not in Kamino metrics`);
      return { value: Number(m.supplyApy) * 100, source: { kind: "protocol_api", ref: `${KAMINO_API}/kamino-market/${str(p, "market") || KAMINO_MAIN_MARKET}/reserves/metrics`, fetchedAt } };
    }
    case "peg_band": {
      const price = (await getPrices(ctx, [p.subject])).get(p.subject);
      if (price == null) throw new Error(`no Jupiter price for ${p.subject}`);
      return { value: price, source: { kind: "price_api", ref: "https://lite-api.jup.ag/price/v3", fetchedAt } };
    }
    case "exit_at_size": {
      const c = await exitCost(ctx, p.subject, str(p, "tokenIn"), num(p, "amount"));
      if (!c.bestRoute) throw new Error(`no Jupiter route for ${p.subject}`);
      return { value: c.bestRoute.impactPct, source: c.sources.find((s) => s.ref.includes("jup.ag")) ?? { kind: "protocol_api", ref: "https://lite-api.jup.ag/swap/v1/quote", fetchedAt } };
    }
    case "liquidation_distance": {
      if (!p.wallet) throw new Error(`prediction ${p.id} has no wallet`);
      const loan = await readLoan(ctx, p.wallet, p.subject);
      if (!loan) throw new Error(`obligation ${p.subject} not found (closed or emptied); left open`);
      const h = healthFactor(loan);
      return { value: Number.isFinite(h) ? Math.min(h, HEALTH_CAP) : HEALTH_CAP, source: loan.sources[0] ?? { kind: "chain", ref: "getProgramAccounts", fetchedAt } };
    }
  }
}

export interface SettleReport { settled: string[]; failed: { id: string; error: string }[]; notDue: number }

export async function settleDue(ledger: Ledger, ctx: AdapterContext, now: Date = ctx.now(), read: typeof readOutcome = readOutcome): Promise<SettleReport> {
  const rep: SettleReport = { settled: [], failed: [], notDue: 0 };
  for (const e of ledger.load()) {
    if (e.settlement) continue;
    if (!isDue(e.prediction, now)) { rep.notDue++; continue; }
    try {
      const r = await read(ctx, e.prediction);
      const outcome = outcomeFrom(e.prediction, r.value, r.source, now);
      await ledger.settle(e.prediction.id, outcome, scoreBoth(e.prediction, outcome));
      rep.settled.push(e.prediction.id);
    } catch (err) { rep.failed.push({ id: e.prediction.id, error: (err as Error).message }); }
  }
  return rep;
}
