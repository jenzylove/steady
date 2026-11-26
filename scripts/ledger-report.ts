// Usage: tsx scripts/ledger-report.ts [--json]
import { Ledger } from "../src/ledger/store.js";
import { formatReport, summarize } from "../src/ledger/report.js";

const s = summarize(new Ledger().load());
console.log(process.argv.includes("--json") ? JSON.stringify(s, null, 2) : formatReport(s, new Date()));
