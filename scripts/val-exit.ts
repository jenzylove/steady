import { makeContext } from "../src/engine/context.js";
import { exitCost } from "../src/engine/risk/exit.js";
const ctx = makeContext();
const SOL = "So11111111111111111111111111111111111111112";
const cases: [string, string, number][] = [
  ["Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", SOL, 1000],
  ["Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", SOL, 100000],
  ["58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", SOL, 1000],
  ["58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", SOL, 20000],
  ["8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", SOL, 500],
  ["BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y", SOL, 2000],
];
for (const [p, t, a] of cases) {
  try {
    const r = await exitCost(ctx, p, t, a);
    console.log(p.slice(0, 6), a, "headline", r.impactPct.toFixed(4) + "%", "out", r.expectedOut.toFixed(2), "| pool", r.inPool?.method, r.inPool?.impactPct.toFixed(4), "| best", r.bestRoute?.impactPct.toFixed(4), "jupReported", r.bestRoute?.jupiterReportedImpactPct?.toFixed(4), r.gaps.join(";"));
  } catch (e) { console.log(p.slice(0, 6), a, "ERR", String(e).replace(/api-key=[^&\s]+/g, "")); }
}
