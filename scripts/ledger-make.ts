// Usage: tsx scripts/ledger-make.ts [--no-frontier | --frontier-only]
// Default: read live mainnet state, write signed predictions to data/ledger.jsonl, then ask the frontier model blind.
// --frontier-only: do not make anything; ask the frontier model for every open prediction that has no answer yet
// (a new signed version is appended, never before settlement is skipped).
import { makeContext } from "../src/engine/context.js";
import { Ledger } from "../src/ledger/store.js";
import { makeAll } from "../src/ledger/make.js";
import { askFrontier } from "../src/ledger/frontier.js";

const ctx = makeContext();
const ledger = new Ledger();
const gaps: string[] = [];

if (process.argv.includes("--frontier-only")) {
  let n = 0;
  for (const e of ledger.load()) {
    if (e.settlement || e.prediction.frontier) continue;
    try {
      const frontier = await askFrontier(e.prediction, ctx.now());
      await ledger.update(e.prediction.id, { frontier });
      n++;
    } catch (err) { gaps.push(`frontier ${e.prediction.id}: ${(err as Error).message.slice(0, 160)}`); }
  }
  console.log(`added ${n} frontier answers`);
} else {
  const made = await makeAll(ctx);
  gaps.push(...made.gaps);
  const skip = process.argv.includes("--no-frontier");
  const counts: Record<string, number> = {};
  for (const p of made.predictions) {
    if (!skip) {
      try { p.frontier = await askFrontier(p, ctx.now()); } catch (e) { gaps.push(`frontier ${p.id}: ${(e as Error).message.slice(0, 160)}`); }
    }
    await ledger.append(p);
    counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  }
  console.log(`made ${made.predictions.length} predictions`, counts);
}
for (const g of gaps.slice(0, 5)) console.log("gap:", g);
if (gaps.length > 5) console.log(`... and ${gaps.length - 5} more gaps`);
