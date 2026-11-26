// Watch list persisted in data/watch.json plus the diff that decides what is worth an alert.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Finding, Severity } from "../engine/advice/types.js";
import { sevRank } from "./report.js";

export interface WatchedWallet { address: string; seen: Record<string, Severity> }
export type WatchState = Record<string, WatchedWallet[]>; // chatId -> wallets

export const WATCH_FILE = "data/watch.json";
const ALERT_AT: Severity = "high";

export function loadWatch(file = WATCH_FILE): WatchState {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as WatchState) : {}; } catch { return {}; }
}
export function saveWatch(s: WatchState, file = WATCH_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 1));
}
export function addWallet(s: WatchState, chat: string, address: string): boolean {
  const list = (s[chat] ??= []);
  if (list.some((w) => w.address === address)) return false;
  list.push({ address, seen: {} });
  return true;
}
export function removeWallet(s: WatchState, chat: string, address: string): boolean {
  const list = s[chat] ?? [];
  const next = list.filter((w) => w.address !== address);
  if (next.length === 0) delete s[chat]; else s[chat] = next;
  return next.length !== list.length;
}
export function isAlertable(sev: Severity): boolean { return sevRank(sev) <= sevRank(ALERT_AT); }

export interface Diff { alerts: Finding[]; worsened: string[]; added: string[]; seen: Record<string, Severity> }

/** Alert only on findings of high or critical severity that are new, or worse than last time. Unchanged ones stay quiet. */
export function diffFindings(prev: Record<string, Severity>, findings: Finding[]): Diff {
  const alerts: Finding[] = [], worsened: string[] = [], added: string[] = [];
  const seen: Record<string, Severity> = {};
  for (const f of findings) {
    seen[f.id] = f.severity;
    if (!isAlertable(f.severity)) continue;
    const before = prev[f.id];
    if (before === undefined) { alerts.push(f); added.push(f.id); }
    else if (sevRank(f.severity) < sevRank(before)) { alerts.push(f); worsened.push(f.id); }
  }
  return { alerts, worsened, added, seen };
}
