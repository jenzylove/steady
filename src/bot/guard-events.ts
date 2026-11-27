// Relays Guard events from the API to every chat that watches the guarded wallet: armed, fired early, fired, stale, cancelled.
import type { WatchState } from "./watch.js";

export interface GuardEventRow { wallet: string; obligation: string; line: number; at: string; kind: string; note: string; signature?: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function formatGuardEvent(e: GuardEventRow, site = "https://steady.jdollar.site"): string {
  const head: Record<string, string> = {
    armed: "🛡 Guard armed",
    early: "⚡ Guard firing early",
    fired: "✅ Guard rescued your loan",
    failed: "⚠️ Guard rescue did not confirm",
    stale: "⚠️ Guard rescue needs a refresh",
    cancelled: "Guard stood down",
  };
  const lines = [`<b>${head[e.kind] ?? `Guard: ${e.kind}`}</b> for wallet <code>${short(e.wallet)}</code> (line ${e.line})`, esc(e.note)];
  if (e.signature) lines.push(`<a href="https://solscan.io/tx/${e.signature}">See it on Solscan</a>`);
  if (e.kind === "stale" || e.kind === "failed") lines.push(`<a href="${site}/app?wallet=${e.wallet}">Open the fix now</a>`);
  return lines.join("\n");
}

/** Chats to notify for a wallet. */
export function chatsFor(state: WatchState, wallet: string): string[] {
  return Object.entries(state).filter(([, ws]) => ws.some((w) => w.address === wallet)).map(([chat]) => chat);
}

export function startGuardRelay(state: WatchState, send: (chat: string, text: string) => Promise<unknown>, api = process.env.STEADY_API_URL ?? "https://steady-api-production-df2c081e.up.railway.app", everyMs = 30_000): void {
  let after = new Date().toISOString();
  setInterval(async () => {
    try {
      const r = (await (await fetch(`${api}/guard/events?after=${encodeURIComponent(after)}`)).json()) as { events?: GuardEventRow[] };
      for (const e of r.events ?? []) {
        after = e.at > after ? e.at : after;
        for (const chat of chatsFor(state, e.wallet)) await send(chat, formatGuardEvent(e)).catch(() => {});
      }
    } catch (e) { console.error("guard relay", String(e).slice(0, 120)); }
  }, everyMs);
}
