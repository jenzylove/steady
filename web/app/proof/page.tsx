"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { call, type LedgerEntry, type PredictionKind } from "@/lib/api";
import { relative, short, usd, when } from "@/lib/format";
import Reveal from "@/components/Reveal";
import RunningNow from "@/components/RunningNow";

interface Anchor { batch: string; root: string; count: number; txHash: string; chain: string; at: string }
interface EdgeLoan { obligation: string; owner: string; firstSeenAt: string; firstHealth: number; debtUsd: number; liquidated?: { at: string; signature: string } }
interface Edge { tracked: number; trackedDebtUsd: number; liquidated: number; liquidatedDebtUsd: number; since: string | null; loans: EdgeLoan[] }
type Entry = LedgerEntry & { firstMemo?: { digest: string } };

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
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [err, setErr] = useState("");
  const [edge, setEdge] = useState<Edge | null>(null);
  const [filter, setFilter] = useState<PredictionKind | "all">("all");
  useEffect(() => { call<{ entries: Entry[]; anchors?: Anchor[]; edge?: Edge }>("/ledger", { timeoutMs: 20000 }).then((d) => { setRows(d.entries); setAnchors(d.anchors ?? []); setEdge(d.edge ?? null); }).catch((e) => setErr(e.message)); }, []);

  const stats = useMemo(() => {
    type Side = { n: number; hits: number; err: number; errN: number };
    const side = (): Side => ({ n: 0, hits: 0, err: 0, errN: 0 });
    const out = {} as Record<PredictionKind, { n: number; settled: number; stake: number; s: Side; f: Side; i: Side }>;
    for (const k of Object.keys(KINDS) as PredictionKind[]) out[k] = { n: 0, settled: 0, stake: 0, s: side(), f: side(), i: side() };
    const add = (sd: Side, r: { verdict: boolean; value?: number } | undefined, o: { verdict: boolean; value: number }) => {
      if (!r) return;
      sd.n++; if (r.verdict === o.verdict) sd.hits++;
      if (typeof r.value === "number") { sd.err += Math.abs(r.value - o.value); sd.errN++; }
    };
    for (const e of rows ?? []) {
      const s = out[e.prediction.kind]; if (!s) continue;
      const p = e.prediction;
      s.n++; s.stake += p.usdAtStake ?? 0;
      if (p.outcome) { s.settled++; add(s.s, p.steady, p.outcome); add(s.f, p.frontier, p.outcome); add(s.i, p.frontierInformed, p.outcome); }
    }
    return out;
  }, [rows]);
  const off = (sd: { err: number; errN: number }) => (sd.errN ? (sd.err / sd.errN).toPrecision(2) : "n/a");

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
        <p className="ink2 big">Steady makes short calls about real positions before the outcome is known, signs them, and settles them later from its own mainnet reads. A frontier model answers the same questions twice, once blind and once with the numbers Steady read. Every miss stays on this page, Steady&apos;s included.</p>
      </div>

      <RunningNow full />

      {edge && edge.tracked > 0 && (
        <section style={{ marginTop: 56 }}>
          <span className="kicker">Loans at the edge</span>
          <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginTop: 8 }}>{edge.tracked} Kamino loans within reach of liquidation, {usd(edge.trackedDebtUsd)} of debt</h2>
          <p className="ink2" style={{ marginTop: 10, maxWidth: 820 }}>Every 3 hours Steady sweeps the Kamino main market for loans with health under 1.12, notes when it first saw each one, then checks the chain for a liquidation of that loan. {edge.liquidated ? `${edge.liquidated} were liquidated after Steady flagged them, ${usd(edge.liquidatedDebtUsd)} of debt. Had a guard been armed on them, it would have tried to send the rescue before that.` : "None has been liquidated since Steady first saw it."} Tracking since {edge.since ? when(edge.since) : "now"}.</p>
          {edge.loans.filter((l) => l.liquidated).length > 0 && (
            <ul className="reasons" style={{ marginTop: 16 }}>
              {edge.loans.filter((l) => l.liquidated).sort((a, b) => b.debtUsd - a.debtUsd).slice(0, 12).map((l) => (
                <li key={l.obligation}>{usd(l.debtUsd)} loan at health {l.firstHealth} when flagged {when(l.firstSeenAt)}, liquidated {when(l.liquidated!.at)}. <a className="hash" href={`https://solscan.io/tx/${l.liquidated!.signature}`} target="_blank" rel="noreferrer">liquidation</a> · <Link className="linkbtn" href={`/app?wallet=${l.owner}`}>the wallet</Link></li>
              ))}
            </ul>
          )}
          <p className="mute" style={{ marginTop: 14, fontSize: 14 }}>Closest when Steady first saw them: {edge.loans.filter((l) => !l.liquidated).sort((a, b) => a.firstHealth - b.firstHealth).slice(0, 3).map((l, i) => <span key={l.obligation}>{i ? ", " : ""}<Link className="linkbtn" href={`/app?wallet=${l.owner}`}>{usd(l.debtUsd)} at {l.firstHealth}</Link></span>)}. Open any of them to see the fix Steady would prepare.</p>
        </section>
      )}
      <div style={{ height: 56 }} />
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
                  <span className="num-xl" style={{ fontSize: "clamp(40px, 5vw, 64px)" }}>{s.settled ? `${s.s.hits}/${s.settled}` : s.n}</span>
                  <span className="ink2" style={{ fontSize: 14 }}>
                    {s.settled ? `Steady right on ${s.s.hits} of ${s.settled} settled` : `${s.n} calls open, none settled yet`}
                    {s.f.n ? `. Blind model ${s.f.hits} of ${s.f.n}` : ""}
                    {s.i.n ? `, informed model ${s.i.hits} of ${s.i.n}.` : s.f.n ? "." : ""}
                  </span>
                  {s.s.errN > 0 && (
                    <span className="mute mono" style={{ fontSize: 12 }}>
                      average miss on the number: Steady {off(s.s)} · blind {off(s.f)} · informed {off(s.i)}
                    </span>
                  )}
                  {s.stake > 0 && <span className="mute mono" style={{ fontSize: 12 }}>{usd(s.stake)} in loans watched</span>}
                </div>
              );
            })}
          </Reveal>

          <p className="ink2" style={{ marginTop: 48, maxWidth: 820 }}>
            {rows.length} calls in total, {settled.length} settled.{" "}
            {firstSettle && !settled.length ? `The first ones settle ${when(firstSettle)}, ${relative(firstSettle)}. ` : ""}
            {withFrontier ? `The frontier model has answered ${withFrontier} of them.` : "The frontier model's blind answers are not in yet; each call shows that plainly until they are."}
          </p>

          <div className="two" style={{ marginTop: 48 }}>
            <div>
              <span className="kicker">What each side was given</span>
              <p className="ink2" style={{ marginTop: 10 }}><strong style={{ color: "var(--ink)" }}>Steady:</strong> live reads of the chain and the protocols, plus seven days of history for each subject.</p>
              <p className="ink2" style={{ marginTop: 8 }}><strong style={{ color: "var(--ink)" }}>Blind model:</strong> the same question and today&apos;s date only. No tools, no chain reads.</p>
              <p className="ink2" style={{ marginTop: 8 }}><strong style={{ color: "var(--ink)" }}>Informed model:</strong> the same model, given the same numbers Steady read when it made the call.</p>
              <p className="ink2" style={{ marginTop: 8 }}>Each side gives a yes or no and a number. The yes or no is scored as a hit or miss; the number is scored by how far it landed from the chain.</p>
              <p className="mute" style={{ marginTop: 8, fontSize: 14 }}>The outcome is settled by Steady&apos;s own mainnet read at the stated time, and the settlement is a second signed memo.</p>
            </div>
            <div>
              <span className="kicker">Written on chain before the outcome</span>
              {anchors.length ? anchors.map((a) => {
                const batch = rows.filter((e) => e.prediction.madeAt.slice(0, 16) === a.batch);
                const firstSettled = batch.map((e) => e.prediction.outcome?.settledAt).filter(Boolean).sort()[0];
                const before = !firstSettled || a.at < firstSettled;
                return (
                  <div key={a.batch} className="anchor">
                    <p style={{ marginTop: 10 }}>{a.count} calls made {when(a.batch + ":00Z")}. Their digests were hashed into one root and written to Ethereum Sepolia {when(a.at)}{before ? ", before any of them settled." : "."}</p>
                    <p className="mono" style={{ fontSize: 12, marginTop: 6 }}><a className="hash" href={`https://sepolia.etherscan.io/tx/${a.txHash}`} target="_blank" rel="noreferrer">tx {short(a.txHash, 10, 6)}</a> <span className="mute">root {short(a.root, 8, 6)}</span></p>
                  </div>
                );
              }) : <p className="mute" style={{ marginTop: 10 }}>No batch has been written on chain yet.</p>}
              <p className="mute" style={{ marginTop: 10, fontSize: 13 }}>The root is the SHA256 of the original call digests, sorted and joined by new lines. New daily batches are written within 15 minutes.</p>
            </div>
          </div>

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
                        <p className="mute mono" style={{ fontSize: 12, marginTop: 6 }}>made {when(p.madeAt)} · settles {when(p.settleAt)}{p.usdAtStake ? ` · ${usd(p.usdAtStake)} loan size` : ""}</p>
                      </div>
                      <div className="pred-calls">
                        <Verdict v={p.steady.verdict} label="Steady" />
                        <Verdict v={p.frontier?.verdict} label="Blind" />
                        <Verdict v={p.frontierInformed?.verdict} label="Informed" />
                        {p.outcome ? <span className={`tag ${hit ? "solid" : "risk"}`}>{hit ? "Hit" : "Miss"}</span> : <span className="tag">Open, {relative(p.settleAt)}</span>}
                      </div>
                    </summary>
                    <div className="pred-body">
                      <div><span className="kicker">Steady&apos;s reasoning</span><p style={{ marginTop: 8 }}>{p.steady.why}</p></div>
                      <div>
                        <span className="kicker">Blind model</span><p style={{ marginTop: 8 }}>{p.frontier ? `${p.frontier.model}: ${p.frontier.why}${p.frontier.value !== undefined ? ` (said ${p.frontier.value})` : ""}` : "Not answered yet."}</p>
                        <span className="kicker" style={{ display: "block", marginTop: 14 }}>Informed model</span><p style={{ marginTop: 8 }}>{p.frontierInformed ? `${p.frontierInformed.why}${p.frontierInformed.value !== undefined ? ` (said ${p.frontierInformed.value})` : ""}` : "Not answered yet."}</p>
                      </div>
                      <div>
                        <span className="kicker">Outcome</span>
                        <p style={{ marginTop: 8 }}>{p.outcome ? `Settled ${when(p.outcome.settledAt)} at ${p.outcome.value}. The claim was ${p.outcome.verdict ? "true" : "false"}.` : "Not settled yet."}</p>
                        {e.firstMemo && e.firstMemo.digest !== e.memo.digest && <p className="mono mute" style={{ fontSize: 12, marginTop: 10 }}>original call {short(e.firstMemo.digest, 8, 6)}</p>}
                        <p className="mono mute" style={{ fontSize: 12, marginTop: e.firstMemo && e.firstMemo.digest !== e.memo.digest ? 4 : 10 }}>{e.firstMemo && e.firstMemo.digest !== e.memo.digest ? "latest version" : "memo"} {short(e.memo.digest, 8, 6)} signed by {short(e.memo.signer, 6, 4)}</p>
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
                {misses.map((e) => <li key={e.prediction.id}><span style={{ color: "var(--ink)" }}>{e.prediction.claim}. Steady said {e.prediction.steady.verdict ? "yes" : "no"}{e.prediction.steady.value !== undefined ? ` (health ${e.prediction.steady.value})` : ""}; the chain said {e.prediction.outcome!.verdict ? "yes" : "no"} ({e.prediction.outcome!.value}).</span></li>)}
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
            <div><span className="mute" style={{ fontSize: 14 }}>The chain says, read Nov 27</span><p className="num-xl vial-text">$18M</p><p className="ink2">read from the pool&apos;s own vaults, within 0.01% of Orca&apos;s own figure. Steady&apos;s <Link href="/miner" className="linkbtn">miner</Link> answers this for anyone.</p></div>
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
