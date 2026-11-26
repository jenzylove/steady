import { makeContext } from "../src/engine/context.js";
import { advise } from "../src/engine/advice/advise.js";
const w = process.argv[2]!; const t0 = Date.now();
const a = await advise(w, makeContext(), { telegraph: process.argv[3] !== "--no-telegraph" });
console.log(JSON.stringify({ ms: Date.now() - t0, totalUsd: a.totalUsd, costUsd: a.costUsd, checks: (a.checks ?? []).map((e) => `${e.minerName} ${e.used ? "USED" : "REJECTED " + e.rejectReason}`), findings: a.findings.map((f) => ({ sev: f.severity, code: f.code, title: f.title, fix: f.fix?.reason, evidence: f.evidence.map((e) => `${e.role ?? ""} ${e.minerName ?? ""} ${e.used ? "USED" : "REJECTED " + (e.rejectReason ?? "")} | ${e.summary}`.slice(0, 160)) })), gaps: a.gaps.length }, null, 1));
