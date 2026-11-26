// Summary per kind: counts, hit rates of Steady and the blind frontier model, misses, and USD at stake.
import type { Prediction, PredictionKind } from "../engine/advice/types.js";
import type { LedgerEntry } from "./store.js";

export interface RateStat { scored: number; hits: number; rate: number | null; meanAbsError: number | null }
export interface Miss { id: string; who: "steady" | "frontier"; claim: string; said: boolean; actual: boolean; said_value?: number | undefined; actual_value: number }
export interface KindSummary {
  kind: PredictionKind;
  total: number;
  settled: number;
  open: number;
  steady: RateStat;
  frontier: RateStat;
  misses: Miss[];
  usdAtStake: number | null;
}

const KINDS: PredictionKind[] = ["rate_drift", "peg_band", "exit_at_size", "liquidation_distance"];
const USD_KINDS = new Set<PredictionKind>(["liquidation_distance", "exit_at_size"]);

function stat(items: { hit: boolean; absError?: number | undefined }[]): RateStat {
  const errs = items.map((i) => i.absError).filter((x): x is number => x !== undefined);
  return {
    scored: items.length,
    hits: items.filter((i) => i.hit).length,
    rate: items.length ? items.filter((i) => i.hit).length / items.length : null,
    meanAbsError: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
  };
}

export function summarize(entries: LedgerEntry[]): KindSummary[] {
  return KINDS.map((kind) => {
    const es = entries.filter((e) => e.prediction.kind === kind);
    const done = es.filter((e) => e.settlement);
    const misses: Miss[] = [];
    for (const e of done) {
      const s = e.settlement!.body, p: Prediction = e.prediction;
      if (!s.score.steady.hit) misses.push({ id: p.id, who: "steady", claim: p.claim, said: p.steady.verdict, actual: s.outcome.verdict, said_value: p.steady.value, actual_value: s.outcome.value });
      if (p.frontier && s.score.frontier && !s.score.frontier.hit) misses.push({ id: p.id, who: "frontier", claim: p.claim, said: p.frontier.verdict, actual: s.outcome.verdict, said_value: p.frontier.value, actual_value: s.outcome.value });
    }
    const usd = USD_KINDS.has(kind) ? es.reduce((a, e) => a + (e.prediction.usdAtStake ?? 0), 0) : null;
    return {
      kind, total: es.length, settled: done.length, open: es.length - done.length,
      steady: stat(done.map((e) => e.settlement!.body.score.steady)),
      frontier: stat(done.flatMap((e) => (e.settlement!.body.score.frontier ? [e.settlement!.body.score.frontier] : []))),
      misses, usdAtStake: usd,
    };
  });
}

const pct = (r: RateStat) => (r.rate === null ? "n/a" : `${r.hits}/${r.scored} (${(r.rate * 100).toFixed(0)}%)`);
const f = (x: number | null) => (x === null ? "n/a" : x.toPrecision(3));

export function formatReport(summary: KindSummary[], now: Date): string {
  const out: string[] = [`Steady forward ledger, ${now.toISOString()}`, ""];
  for (const s of summary) {
    out.push(`${s.kind}: ${s.total} predictions, ${s.settled} settled, ${s.open} open${s.usdAtStake !== null ? `, $${s.usdAtStake.toLocaleString("en-US")} at stake` : ""}`);
    if (s.settled > 0) {
      out.push(`  Steady hit rate ${pct(s.steady)}, mean abs error ${f(s.steady.meanAbsError)}`);
      out.push(`  Frontier hit rate ${pct(s.frontier)}, mean abs error ${f(s.frontier.meanAbsError)}`);
      for (const m of s.misses) out.push(`  miss (${m.who}): ${m.claim}; said ${m.said} (${m.said_value ?? "no value"}), actual ${m.actual} (${m.actual_value})`);
    }
  }
  const all = summary.reduce((a, s) => a + s.total, 0), settled = summary.reduce((a, s) => a + s.settled, 0);
  out.push("", `Total ${all} predictions, ${settled} settled.`);
  return out.join("\n");
}
