"use client";
import Link from "next/link";
import { useStats, ago, type Stats } from "@/lib/stats";
import { usd } from "@/lib/format";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const n = (x: number) => x.toLocaleString("en-US");

interface Cell { k: string; v: string; d: string; href?: string }

function cells(s: Stats, full: boolean): Cell[] {
  const out: Cell[] = [];
  const b = s.bot.ok ? s.bot : null;
  out.push(b
    ? { k: "Wallets watched", v: n(b.walletsWatched), d: `swept every ${b.sweepEveryMin} min, last ${ago(b.lastSweepAt)}` }
    : { k: "Wallets watched", v: "?", d: "the bot did not answer just now" });
  if (b) out.push({ k: "Telegram alerts sent", v: n(b.alertsSent), d: `since ${day(b.countingSince)}, plus ${n(b.reportsSent)} reports` });
  const buys = s.api.telegraphPurchases + (b?.telegraphPurchases ?? 0);
  const spent = s.api.telegraphSpendUsd + (b?.telegraphSpendUsd ?? 0);
  out.push({ k: "Telegraph answers bought", v: n(buys), d: `${usd(spent, 2)} paid over x402 since ${day(s.api.countingSince)}` });
  const l = s.ledger.ok ? s.ledger : null;
  if (l) {
    out.push(l.settled
      ? { k: "Ledger score", v: `${l.steadyHits}/${l.settled}`, d: `Steady right; frontier model ${l.frontierHits}/${l.frontierSettled}. ${l.open} open`, href: "/proof" }
      : { k: "Calls waiting on the chain", v: n(l.open), d: l.nextSettleAt ? `first settles ${ago(l.nextSettleAt)}, none settled yet` : "none settled yet", href: "/proof" });
  }
  out.push({ k: "Memos signed", v: n(s.api.memosSigned), d: `since ${day(s.api.countingSince)}${l ? `, plus ${n(l.signedMemos)} in the ledger` : ""}` });
  const node = s.node.ok && s.node.found ? s.node : null;
  const m = s.miner.ok ? s.miner : null;
  out.push({ k: "Miner answers", v: m ? n(m.answers) : "?", d: m ? `to outside callers since its restart ${ago(m.since)}${node ? `; ${n(node.requestsServed)} routed by Telegraph so far` : ""}` : "the miner did not answer just now", href: "/miner" });
  if (full || !b) {
    const e = s.evaluator.ok ? s.evaluator : null;
    if (e) out.push({ k: "Evaluation rows admitted", v: `${e.admitted}/${e.rows}`, d: `on the Telegraph node, read ${ago(e.at)}`, href: "/miner" });
  }
  if (full) {
    out.push({ k: "Wallets read", v: n(s.api.walletChecks), d: `full reads since ${day(s.api.countingSince)}` });
    out.push({ k: "Transactions checked", v: n(s.api.txChecks), d: `before signing, since ${day(s.api.countingSince)}`, href: "/check" });
  }
  return out;
}

export default function RunningNow({ full = false }: { full?: boolean }) {
  const { s, err } = useStats(30_000);
  return (
    <section className={`running ${full ? "full" : ""}`} aria-label="What Steady is doing right now">
      <div className="running-head">
        <span className="kicker" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><span className="live-dot" /> Running now</span>
        <span className="mono mute" style={{ fontSize: 12 }}>{s ? `live, read ${ago(s.at)} · refreshes every 30 s` : err ? "the live numbers did not load" : "loading live numbers"}</span>
      </div>
      <div className="running-grid">
        {s ? cells(s, full).map((c) => {
          const body = (<><span className="kicker">{c.k}</span><span className="running-v">{c.v}</span><span className="running-d">{c.d}</span></>);
          return c.href ? <Link key={c.k} href={c.href} className="running-c">{body}</Link> : <div key={c.k} className="running-c">{body}</div>;
        }) : Array.from({ length: full ? 9 : 6 }, (_, k) => <div key={k} className="running-c"><span className="kicker">&nbsp;</span><span className="running-v mute">…</span></div>)}
      </div>
    </section>
  );
}
