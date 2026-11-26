import { makeContext } from "../src/engine/context.js";
import { readPortfolio } from "../src/engine/portfolio.js";
const w = process.argv[2]!;
const t0 = Date.now();
const p = await readPortfolio(w, makeContext());
console.log(JSON.stringify({ ms: Date.now() - t0, positions: p.positions.length, loans: p.loans.length, byProtocol: p.positions.reduce((a: any, x) => (a[x.protocol] = (a[x.protocol] || 0) + 1, a), {}), gaps: p.gaps.slice(0, 8) }, null, 1));
