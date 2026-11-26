"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { call, type LedgerEntry, type PredictionKind } from "@/lib/api";
import { relative, short, usd, when } from "@/lib/format";
import Reveal from "@/components/Reveal";

const KINDS: Record<PredictionKind, { name: string; ask: string }> = {
  liquidation_distance: { name: "Loans stay safe", ask: "Will this loan still be above liquidation in 24 hours?" },
  rate_drift: { name: "Rates hold", ask: "Will this lending rate stay in its band for 72 hours?" },
  peg_band: { name: "Stablecoins hold", ask: "Will this stablecoin stay within half a cent of a dollar?" },
  exit_at_size: { name: "Big sales stay cheap", ask: "Can a large SOL sale still get out at a low price impact?" },
};

// From docs/spikes/lending-adapters.md: Steady's health against Kamino's own API on 14 real loans, Nov 26 2026.
const KAMINO: [string, string, number, number, string][] = [
  ["6gJxiBgU", "ALj6Fh4C", 1.4619, 1.4619, "0.00%"], ["6YTv68wC", "38ngpSHV", 1.61, 1.612, "0.12%"], ["6YTv68wC", "4FS8Viec", 1.2752, 1.2753, "0.01%"],
  ["44tDHrCk", "3rvEWj7K", 1.137, 1.1371, "0.01%"], ["44tDHrCk", "5LTv3Prk", 3.0011, 3.0011, "0.00%"], ["BpcJeRic", "9iGfgvxk", 1.1351, 1.1352, "0.00%"],
  ["98CjCSKJ", "FS8vwj3Y", 1.2826, 1.2827, "0.00%"], ["2ihhvuPJ", "6Co3of6S", 46.8745, 46.66, "0.46%"], ["2ihhvuPJ", "A5Luo6eC", 1.0543, 1.0543, "0.00%"],
  ["32MBYy9M", "rpJ6SUVp", 2.2973, 2.2973, "0.00%"], ["32MBYy9M", "DZKg9WFf", 1.3473, 1.3508, "0.26%"], ["8HhZCE1L", "3wtkdLhS", 1.1854, 1.1854, "0.00%"],
  ["8HhZCE1L", "4DCuzQga", 1.3009, 1.3011, "0.01%"], ["De1e9rbr", "DwwcRy6w", 1.1426, 1.1426, "0.00%"],
];

function Verdict({ v, label }: { v: boolean | undefined; label: string }) {
  if (v === undefined) return <span className="tag">{label}: not yet</span>;
  return <span className={`tag ${v ? "vial" : "warn"}`}>{label}: {v ? "yes" : "no"}</span>;
}

export default function ProofPage() {
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<PredictionKind | "all">("all");
  useEffect(() => { call<{ entries: LedgerEntry[] }>("/ledger", { timeoutMs: 20000 }).then((d) => setRows(d.entries)).catch((e) => setErr(e.message)); }, []);

  const stats = useMemo(() => {
    const out = {} as Record<PredictionKind, { n: number; settled: number; hits: number; fHits: number; fN: number; stake: number }>;
    for (const k of Object.keys(KINDS) as PredictionKind[]) out[k] = { n: 0, settled: 0, hits: 0, fHits: 0, fN: 0, stake: 0 };
    for (const e of rows ?? []) {
      const s = out[e.prediction.kind]; if (!s) continue;
      s.n++; s.stake += e.prediction.usdAtStake ?? 0;
      if (e.prediction.outcome) {
        s.settled++;
        if (e.prediction.steady.verdict === e.prediction.outcome.verdict) s.hits++;
        if (e.prediction.frontier) { s.fN++; if (e.prediction.frontier.verdict === e.prediction.outcome.verdict) s.fHits++; }
      }
    }
    return out;
  }, [rows]);

  const list = (rows ?? []).filter((e) => filter === "all" || e.prediction.kind === filter).sort((a, b) => a.prediction.settleAt.localeCompare(b.prediction.settleAt));
  const settled = (rows ?? []).filter((e) => e.prediction.outcome);
  const misses = settled.filter((e) => e.prediction.steady.verdict !== e.prediction.outcome!.verdict);
  const firstSettle = (rows ?? []).filter((e) => !e.prediction.outcome).map((e) => e.prediction.settleAt).sort()[0];
  const withFrontier = (rows ?? []).filter((e) => e.prediction.frontier).length;

  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="kicker">Proof</span>
        <h1 className="display page-title">Signed first. Settled by the chain.</h1>
        <p className="ink2 big">Steady makes short calls about real positions before the outcome is known, signs them, and settles them later from its own mainnet reads. A frontier model answers the same questions blind. Every miss stays on this page.</p>
      </div>

      {err && <p style={{ color: "var(--risk)" }}>The ledger could not load: {err}</p>}
      {!rows && !err && <p className="mute"><span className="live-dot" /> Loading the ledger</p>}

      {rows && (
        <>
          <Reveal className="kinds">
            {(Object.keys(KINDS) as PredictionKind[]).map((k) => {
              const s = stats[k];
              return (
                <div key={k}>
                  <span className="kicker">{KINDS[k].name}</span>
                  <span className="num-xl" style={{ fontSize: "clamp(40px, 5vw, 64px)" }}>{s.settled ? `${s.hits}/${s.settled}` : s.n}</span>
                  <span className="ink2" style={{ fontSize: 14 }}>
                    {s.settled ? `Steady right on ${s.hits} of ${s.settled} settled` : `${s.n} calls open, none settled yet`}
                    {s.fN ? `. Frontier model right on ${s.fHits} of ${s.fN}.` : ""}
                  </span>
                  {s.stake > 0 && <span className="mute mono" style={{ fontSize: 12 }}>{usd(s.stake)} at stake</span>}
                </div>
              );
            })}
          </Reveal>

          <p className="ink2" style={{ marginTop: 48, maxWidth: 820 }}>
            {rows.length} calls in total, {settled.length} settled.{" "}
            {firstSettle && !settled.length ? `The first ones settle ${when(firstSettle)}, ${relative(firstSettle)}. ` : ""}
            {withFrontier ? `The frontier model has answered ${withFrontier} of them.` : "The frontier model's blind answers are not in yet; each call shows that plainly until they are."}
          </p>

          <section style={{ marginTop: 64 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
              <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)" }}>Every call</h2>
              <div className="chips" style={{ marginTop: 0 }}>
                <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>All {rows.length}</button>
                {(Object.keys(KINDS) as PredictionKind[]).map((k) => <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{KINDS[k].name} {stats[k].n}</button>)}
              </div>
            </div>
            {filter !== "all" && <p className="mute" style={{ marginBottom: 12 }}>{KINDS[filter].ask}</p>}
            <div>
              {list.map((e) => {
                const p = e.prediction;
                const hit = p.outcome ? p.steady.verdict === p.outcome.verdict : undefined;
                return (
                  <details key={p.id} className="pred">
                    <summary>
                      <div>
                        <p style={{ fontSize: 17 }}>{p.claim}</p>
                        <p className="mute mono" style={{ fontSize: 12, marginTop: 6 }}>made {when(p.madeAt)} · settles {when(p.settleAt)}{p.usdAtStake ? ` · ${usd(p.usdAtStake)} at stake` : ""}</p>
                      </div>
                      <div className="pred-calls">
                        <Verdict v={p.steady.verdict} label="Steady" />
                        <Verdict v={p.frontier?.verdict} label="Frontier" />
                        {p.outcome ? <span className={`tag ${hit ? "solid" : "risk"}`}>{hit ? "Hit" : "Miss"}</span> : <span className="tag">Open, {relative(p.settleAt)}</span>}
                      </div>
                    </summary>
                    <div className="pred-body">
                      <div><span className="kicker">Steady&apos;s reasoning</span><p style={{ marginTop: 8 }}>{p.steady.why}</p></div>
                      <div><span className="kicker">Frontier model</span><p style={{ marginTop: 8 }}>{p.frontier ? `${p.frontier.model}: ${p.frontier.why}` : "Not answered yet."}</p></div>
                      <div>
                        <span className="kicker">Outcome</span>
                        <p style={{ marginTop: 8 }}>{p.outcome ? `Settled ${when(p.outcome.settledAt)} at ${p.outcome.value}. The claim was ${p.outcome.verdict ? "true" : "false"}.` : "Not settled yet."}</p>
                        <p className="mono mute" style={{ fontSize: 12, marginTop: 10 }}>memo {short(e.memo.digest, 8, 6)} signed by {short(e.memo.signer, 6, 4)}</p>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>

          <section style={{ marginTop: 80 }}>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 14 }}>Misses</h2>
            {misses.length ? (
              <ul className="reasons" style={{ color: "var(--risk)" }}>
                {misses.map((e) => <li key={e.prediction.id}><span style={{ color: "var(--ink)" }}>{e.prediction.claim}. Steady said {e.prediction.steady.verdict ? "yes" : "no"}; the chain said {e.prediction.outcome!.verdict ? "yes" : "no"} ({e.prediction.outcome!.value}).</span></li>)}
              </ul>
            ) : (
              <p className="ink2">{settled.length ? "No misses among the settled calls so far." : "Nothing has settled yet, so there is nothing to count. Misses will be listed here the moment they happen, not hidden."}</p>
            )}
          </section>
        </>
      )}

      <section className="sec" style={{ marginTop: 100 }}>
        <div className="sec-head" style={{ marginBottom: 30 }}>
          <span className="sec-num">Quorum</span>
          <h2 className="display sec-title" style={{ fontSize: "clamp(32px, 4.4vw, 60px)" }}>One miner versus several</h2>
        </div>
        <p className="ink2 big" style={{ maxWidth: 820 }}>In Steady&apos;s own paid Telegraph tests on Nov 25 2026, single miners gave numbers that would have moved real money the wrong way. Steady asks several miners in roles and checks them against the chain.</p>
        <div className="case">
          <span className="kicker">A lending rate</span>
          <div className="versus">
            <div><span className="mute" style={{ fontSize: 14 }}>One miner said</span><p className="num-xl"><span className="strike">330%</span></p><p className="ink2">marginfi pays on USDC. Act on it and you move savings chasing a rate that does not exist.</p></div>
            <div><span className="mute" style={{ fontSize: 14 }}>With a quorum</span><p className="num-xl vial-text">Rejected</p><p className="ink2">An answer outside any plausible range, or far from the public rate the protocol itself reports, is struck out and kept as evidence.</p></div>
          </div>
        </div>
        <div className="case">
          <span className="kicker">A pool&apos;s depth</span>
          <div className="versus">
            <div><span className="mute" style={{ fontSize: 14 }}>One miner said</span><p className="num-xl"><span className="strike">$3.5M</span></p><p className="ink2">for the Orca SOL/USDC pool. Plan an exit on that and you misjudge how much you can sell.</p></div>
            <div><span className="mute" style={{ fontSize: 14 }}>The chain says</span><p className="num-xl vial-text">$17.9M</p><p className="ink2">read from the pool&apos;s own vaults, within 0.01% of Orca&apos;s own figure. Steady&apos;s <Link href="/miner" className="linkbtn">miner</Link> answers this for anyone.</p></div>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 10 }}>Health, checked against Kamino</h2>
        <p className="ink2" style={{ maxWidth: 760, marginBottom: 24 }}>Steady computes loan health from the chain itself. On 14 real Kamino loans it matched Kamino&apos;s own number within 0.46% at worst. marginfi matched within 0.41% on 12 loans.</p>
        <div className="scroll-x">
          <table className="plain mono">
            <thead><tr><th>Wallet</th><th>Loan</th><th>Steady</th><th>Kamino</th><th>Gap</th></tr></thead>
            <tbody>{KAMINO.map((r) => <tr key={r[1]}><td>{r[0]}…</td><td>{r[1]}…</td><td>{r[2]}</td><td>{r[3]}</td><td>{r[4]}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
