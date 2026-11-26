import { makeContext } from "../src/engine/context.js";
import { readPortfolio } from "../src/engine/portfolio.js";
import { buildFix } from "../src/fix/build.js";
const W = process.argv[2]!; const ctx = makeContext();
const p = await readPortfolio(W, ctx);
const b = p.positions.find((x) => x.protocol === "kamino" && x.kind === "borrow" && x.symbol === (process.argv[3] ?? "JitoSOL"))!;
const out = await buildFix(ctx, W, { action: "repay", protocol: "kamino", account: b.account!, mintIn: b.mint!, amount: Number(process.argv[4] ?? 0.01), reason: "test" }, p.positions);
console.log(JSON.stringify({ builder: out.builder, summary: out.summary, unsupported: out.unsupported, hasTx: !!out.transaction, simulation: out.simulation }, null, 1));
