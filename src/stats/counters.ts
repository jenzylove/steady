// Small persisted counters for the "running now" numbers. One JSON file per service, next to the ledger
// (the API volume at /data) or in data/ (the bot volume). Counts only: never addresses, chat ids or secrets.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface Counters { since: string; counts: Record<string, number>; marks: Record<string, string> }

export function countersPath(): string {
  if (process.env.COUNTERS_PATH) return process.env.COUNTERS_PATH;
  const ledger = process.env.LEDGER_PATH ?? resolve(process.cwd(), "data", "ledger.jsonl");
  return resolve(dirname(ledger), "counters.json");
}

let state: Counters | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): Counters {
  if (state) return state;
  try {
    const p = countersPath();
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as Partial<Counters>;
      state = { since: j.since ?? new Date().toISOString(), counts: j.counts ?? {}, marks: j.marks ?? {} };
      return state;
    }
  } catch { /* start fresh on a bad file */ }
  state = { since: new Date().toISOString(), counts: {}, marks: {} };
  return state;
}

function flush(): void {
  if (!state) return;
  try { const p = countersPath(); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(state)); } catch { /* counters never break the caller */ }
}
function later(): void { if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 1000); timer.unref?.(); }

/** Add n to a named counter. Never throws. */
export function bump(name: string, n = 1): void {
  try { const s = load(); s.counts[name] = Math.round(((s.counts[name] ?? 0) + n) * 1e6) / 1e6; later(); } catch { /* ignore */ }
}
/** Record a time (ISO) under a name, for example the last sweep. */
export function mark(name: string, at: Date | string = new Date()): void {
  try { const s = load(); s.marks[name] = typeof at === "string" ? at : at.toISOString(); later(); } catch { /* ignore */ }
}
export function snapshot(): Counters { const s = load(); return { since: s.since, counts: { ...s.counts }, marks: { ...s.marks } }; }

/** For tests: forget the in memory state. */
export function resetCounters(): void { state = null; if (timer) { clearTimeout(timer); timer = null; } }
