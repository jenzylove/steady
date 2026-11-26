"use client";
import { useStats, ago } from "@/lib/stats";

export const BOT = "steadysol_bot";
export const watchLink = (wallet: string) => `https://t.me/${BOT}?start=${encodeURIComponent(wallet)}`;

/** The second loop: hand the wallet to the bot, which rereads it on a timer and alerts on Telegram. */
export default function WatchCta({ wallet }: { wallet: string }) {
  const { s } = useStats(60_000);
  const bot = s?.bot.ok ? s.bot : null;
  return (
    <div className="watch">
      <div>
        <span className="kicker" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><span className="live-dot" /> Keep it steady</span>
        <h2 className="display watch-h">Watch this wallet on Telegram.</h2>
        <p className="ink2" style={{ maxWidth: 560 }}>
          Steady rereads it every {bot?.sweepEveryMin ?? 15} minutes and messages you only when a risk is new or gets worse, with the fix ready to sign. Read only. It never asks for keys.
        </p>
        {bot && (
          <p className="mono mute" style={{ fontSize: 12, marginTop: 10 }}>
            Now: {bot.walletsWatched} wallet{bot.walletsWatched === 1 ? "" : "s"} watched · last sweep {ago(bot.lastSweepAt)} · {bot.alertsSent} alert{bot.alertsSent === 1 ? "" : "s"} sent since {new Date(bot.countingSince).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </p>
        )}
      </div>
      <a className="btn" href={watchLink(wallet)} target="_blank" rel="noreferrer" aria-label="Watch this wallet with the Steady Telegram bot"><span className="bub" /> Watch this wallet</a>
    </div>
  );
}
