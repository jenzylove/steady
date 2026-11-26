// Usage: tsx scripts/ledger-settle.ts [ISO time to treat as now]
import { makeContext } from "../src/engine/context.js";
import { Ledger } from "../src/ledger/store.js";
import { settleDue } from "../src/ledger/settle.js";

const ctx = makeContext();
const now = process.argv[2] ? new Date(process.argv[2]) : ctx.now();
const rep = await settleDue(new Ledger(), ctx, now);
console.log(`settled ${rep.settled.length}, not due ${rep.notDue}, failed ${rep.failed.length}`);
for (const f of rep.failed) console.log("failed:", f.id, f.error);
