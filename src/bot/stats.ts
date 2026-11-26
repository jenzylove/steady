// Counts only, for the site's "running now" strip: never wallet addresses or chat ids.
import { snapshot } from "../stats/counters.js";
import { loadWatch, type WatchState } from "./watch.js";

export function botStats(state: WatchState = loadWatch()) {
  const lists = Object.values(state);
  const c = snapshot();
  return {
    chats: lists.filter((l) => l.length > 0).length,
    walletsWatched: new Set(lists.flat().map((w) => w.address)).size,
    sweepEveryMin: Number(process.env.WATCH_INTERVAL_MIN) || 15,
    lastSweepAt: c.marks.lastSweepAt ?? null,
    lastSweepStartedAt: c.marks.lastSweepStartedAt ?? null,
    sweeps: c.counts.sweeps ?? 0,
    walletsSwept: c.counts.walletsSwept ?? 0,
    alertsSent: c.counts.alertsSent ?? 0,
    reportsSent: c.counts.reportsSent ?? 0,
    telegraphPurchases: c.counts.telegraphPurchases ?? 0,
    telegraphSpendUsd: c.counts.telegraphSpendUsd ?? 0,
    countingSince: c.since,
  };
}
