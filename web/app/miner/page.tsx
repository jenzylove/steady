"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { MINER_BASE } from "@/lib/api";
import { short, usd } from "@/lib/format";
import { useStats, ago } from "@/lib/stats";
import type { KnownPool } from "@/lib/pools";

const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const REG_TX = "0x5b5ecaabba244b5242070d27473956ad8bae6ef87c4c93d41238fb3ad943af81";
const SUBMITTER = "0xFaEd7d2fD90a4095FF7D52809330ECBe1D9c2e2E";
const NODE = "https://devnode.telegraphprotocol.com";
const REFRESH = 30;

interface Answer {
  pool_name?: string; pool_address: string; dex: string; liquidity_usd: number; slot: number; answer: string; fetched_at: string;
  token_a: { symbol?: string; mint: string }; token_b: { symbol?: string; mint: string }; amount_a: number; amount_b: number; price_a: number | null; price_b: number | null;
}
interface Row { pool: KnownPool; status: number; ms: number; body: any }

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 });

function useClock(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export default function MinerPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [readAt, setReadAt] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { s } = useStats(60_000);
  const now = useClock();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch("/api/miner/board", { cache: "no-store" })).json();
      setRows(j.rows); setReadAt(Date.now()); setErr("");
    } catch { setErr("The miner did not answer this time. Trying again shortly."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, REFRESH * 1000); return () => clearInterval(t); }, [load]);

  const total = (rows ?? []).reduce((sum, r) => sum + (r.status === 200 ? (r.body as Answer).liquidity_usd : 0), 0);
  const orca = rows?.find((r) => r.pool.address === "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
  const orcaUsd = orca?.status === 200 ? (orca.body as Answer).liquidity_usd : null;
  const next = readAt ? Math.max(0, REFRESH - Math.floor((now - readAt) / 1000)) : REFRESH;
  const node = s?.node.ok && s.node.found ? s.node : null;
  const miner = s?.miner.ok ? s.miner : null;
  const ev = s?.evaluator.ok ? s.evaluator : null;

  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="kicker">Telegraph miner · registration 6203 · miner id 7420317</span>
        <h1 className="display page-title">How deep is this pool, really?</h1>
        <p className="ink2 big">Steady runs a miner on Telegraph. When any app asks how many dollars sit in a Solana pool, Steady reads the pool&apos;s own two vaults on chain at one slot, prices them, and answers with the slot it read. No third party index in between, and it refuses rather than guess.</p>
      </div>

      <div className="mstat">
        <div><span className="kicker">On Telegraph</span><span className="mstat-v">{node ? (node.status === "active" ? "Active" : node.status) : s ? "Not listed" : "…"}</span><span className="mute">{node?.registeredAt ? `since ${new Date(node.registeredAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "checking the node"}</span></div>
        <div><span className="kicker">Paid requests via Telegraph</span><span className="mstat-v">{node ? num(node.requestsServed) : "…"}</span><span className="mute">{node ? (node.requestsServed ? "as the node counts them" : "none routed to it yet") : ""}</span></div>
        <div><span className="kicker">Score on this intent</span><span className="mstat-v">{node ? (node.scored && node.rank != null ? `#${node.rank}` : "Not yet") : "…"}</span><span className="mute">{node ? `${node.scored && node.score != null ? `score ${node.score}, ` : "Telegraph scores each epoch; "}${node.rivals} miners on this intent` : ""}</span></div>
        <div><span className="kicker">Answers to other callers</span><span className="mstat-v">{miner ? num(miner.answers) : "…"}</span><span className="mute">{miner ? `since the miner restarted ${ago(miner.since)}; this page is not counted` : ""}</span></div>
      </div>
      {s && <p className="mute mono" style={{ fontSize: 12, marginTop: 10, overflowWrap: "anywhere" }}>Node figures read {ago(s.node.at)} from {NODE}/api/miners. Answers counted by the miner since it last restarted.</p>}

      <section style={{ marginTop: 72 }}>
        <div className="board-head">
          <div>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)" }}>Read live, every {REFRESH} seconds</h2>
            <p className="ink2" style={{ marginTop: 10 }}>Every pool the miner knows by name, asked just now. Tap a row for the exact answer an app receives.</p>
          </div>
          <div className="board-meta mono">
            <span><span className="live-dot" /> {loading ? "reading" : readAt ? `next read in ${next}s` : "first read"}</span>
            {rows && <span>{usd(total)} across {rows.filter((r) => r.status === 200).length} pools</span>}
          </div>
        </div>
        {err && <p style={{ color: "var(--risk)", marginTop: 12 }}>{err}</p>}
        <div className="scroll-x">
          <table className="plain board">
            <thead><tr><th>Pool</th><th className="r">Liquidity</th><th className="r hide-s">Reserves</th><th className="r hide-s">Slot</th><th className="r">Read</th></tr></thead>
            <tbody>
              {(rows ?? []).map((r) => {
                const a: Answer | null = r.status === 200 ? r.body : null;
                const isOpen = open === r.pool.address;
                return (
                  <Fragment key={r.pool.address}>
                    <tr className={`brow ${isOpen ? "on" : ""}`} onClick={() => setOpen(isOpen ? null : r.pool.address)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : r.pool.address); } }} aria-expanded={isOpen} aria-label={`${r.pool.dex} ${r.pool.pair} ${r.pool.fee}, show the answer`}>
                      <td><span style={{ fontWeight: 600 }}>{r.pool.dex} {r.pool.pair}</span> <span className="mute mono" style={{ fontSize: 12 }}>{r.pool.fee}{r.pool.kind ? ` ${r.pool.kind}` : ""}</span></td>
                      <td className="r mono">{a ? usd(a.liquidity_usd, 0) : <span className="tag risk">{r.body?.error ?? "no answer"}</span>}</td>
                      <td className="r mono hide-s" style={{ fontSize: 13 }}>{a ? <>{num(a.amount_a)} {a.token_a.symbol}<br />{num(a.amount_b)} {a.token_b.symbol}</> : ""}</td>
                      <td className="r mono hide-s" style={{ fontSize: 13 }}>{a?.slot?.toLocaleString("en-US") ?? ""}</td>
                      <td className="r mono mute" style={{ fontSize: 12 }}>{a ? ago(a.fetched_at, now) : ""}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bjson"><td colSpan={5}>
                        <p className="mono mute" style={{ fontSize: 12, marginBottom: 8, overflowWrap: "anywhere" }}>GET {MINER_BASE}/liquidity?pool={r.pool.address}&amp;chain=solana · HTTP {r.status} · {(r.ms / 1000).toFixed(1)} s</p>
                        <pre className="logs">{JSON.stringify(r.body, null, 2)}</pre>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows && <tr><td colSpan={5} className="mute"><span className="live-dot" /> Asking the live miner about {9} pools</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="case" style={{ marginTop: 72 }}>
        <span className="kicker">Why this miner exists</span>
        <div className="versus">
          <div><span className="mute" style={{ fontSize: 14 }}>A paid Telegraph miner answered, Nov 25 2026</span><p className="num-xl"><span className="strike">$3.5M</span></p><p className="ink2">for Orca SOL/USDC (<span className="mono">{short("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", 5, 5)}</span>). Read again on Nov 27 2026, the pool holds about $18M. An app planning an exit on that number misjudges how much it can sell by five times.</p></div>
          <div><span className="mute" style={{ fontSize: 14 }}>Steady&apos;s miner, right now</span><p className="num-xl vial-text">{orcaUsd != null ? usd(orcaUsd) : "…"}</p><p className="ink2">read from that pool&apos;s own vaults {orca?.status === 200 ? ago((orca.body as Answer).fetched_at, now) : ""}. On Nov 26 2026 it matched each DEX&apos;s own figure within 0.12% (table below).</p></div>
        </div>
      </section>

      <section className="sec" style={{ marginTop: 40 }}>
        <div className="two" style={{ marginTop: 0 }}>
          <div>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 16 }}>How it answers</h2>
            <ol className="how">
              <li><span className="mono mute">01</span> <span>Telegraph routes a <span className="mono" style={{ fontSize: 13, padding: 0 }}>LIQUIDITY_DEPTH_VERIFY_GENERAL</span> question to it and the app pays per answer.</span></li>
              <li><span className="mono mute">02</span> <span>It finds the pool&apos;s two vault token accounts on Orca, Raydium or Meteora and reads both at one slot.</span></li>
              <li><span className="mono mute">03</span> <span>It prices each side in dollars and returns the total, both reserves, the prices and the slot.</span></li>
              <li><span className="mono mute">04</span> <span>Unknown pool, other chain, or a token with no price: it says no, with the reason.</span></li>
            </ol>
            <h3 className="display" style={{ fontSize: 28, margin: "40px 0 14px" }}>Checked against each DEX</h3>
            <p className="ink2" style={{ marginBottom: 16, fontSize: 15 }}>Answers compared with each exchange&apos;s own figure, fetched right after, on Nov 26 2026.</p>
            <div className="scroll-x">
              <table className="plain">
                <thead><tr><th>Pool</th><th>Miner</th><th>DEX&apos;s own</th><th>Gap</th></tr></thead>
                <tbody className="mono">
                  <tr><td>Orca SOL/USDC</td><td>$17,911,664</td><td>$17,914,004</td><td>0.01%</td></tr>
                  <tr><td>Raydium SOL/USDC</td><td>$14,479,106</td><td>$14,476,070</td><td>0.02%</td></tr>
                  <tr><td>Meteora SOL/USDC</td><td>$2,405,682</td><td>$2,402,832</td><td>0.12%</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 48px)", marginBottom: 16 }}>Registered on Telegraph</h2>
            <dl className="facts">
              <dt>Registration</dt><dd>6203</dd>
              <dt>Telegraph miner id</dt><dd><a className="hash" href={`${NODE}/api/miners?limit=5000`} target="_blank" rel="noreferrer">7420317</a></dd>
              <dt>Serves</dt><dd>LIQUIDITY_DEPTH_VERIFY_GENERAL</dd>
              <dt>Registry</dt><dd><a className="hash" href={`https://sepolia.etherscan.io/address/${DIAMOND}`} target="_blank" rel="noreferrer">Ethereum Sepolia Diamond {short(DIAMOND, 6, 4)}</a></dd>
              <dt>Registration tx</dt><dd><a className="hash" href={`https://sepolia.etherscan.io/tx/${REG_TX}`} target="_blank" rel="noreferrer">{short(REG_TX, 10, 6)}</a></dd>
              <dt>Manifest</dt><dd><a className="hash" href={`${MINER_BASE}/steady-liquidity.yaml`} target="_blank" rel="noreferrer">steady-liquidity.yaml</a></dd>
              <dt>Live at</dt><dd><a className="hash" href={`${MINER_BASE}/liquidity?pool=Orca%20SOL/USDC&chain=solana`} target="_blank" rel="noreferrer">{MINER_BASE.replace("https://", "")}</a></dd>
              <dt>Request</dt><dd>GET /liquidity?pool=&lt;name or address&gt;&amp;chain=solana</dd>
            </dl>

            <h3 className="display" style={{ fontSize: 28, margin: "40px 0 14px" }}>Teaching the network</h3>
            <p className="ink2" style={{ fontSize: 15 }}>
              Steady also wrote evaluation rows for Telegraph: questions where the better answer is the chain truth at a stated slot, and the worse answer is a mistake a paid miner really made, like the $3.5M above.
            </p>
            <p className="big" style={{ marginTop: 16 }}>
              {ev ? <><span className="mono vial-text">{ev.eligible}</span> of <span className="mono">{ev.rows}</span> rows eligible</> : "…"}
            </p>
            {ev && <p className="mono mute" style={{ fontSize: 12, marginTop: 6 }}>{Object.entries(ev.byIntent).map(([k, n]) => `${k.replace(/_GENERAL$/, "").toLowerCase().replace(/_/g, " ")} ${n}`).join(" · ")} · read {ago(ev.at)}</p>}
            <p style={{ marginTop: 12, fontSize: 14 }}><a className="hash" href={`${NODE}/api/evalpool/submissions/mine?submitter=${SUBMITTER}`} target="_blank" rel="noreferrer">See the node&apos;s own record</a></p>
          </div>
        </div>
      </section>
    </div>
  );
}
