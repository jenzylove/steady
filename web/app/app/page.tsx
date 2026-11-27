"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { post, ApiError, isLikelyAddress, SOLSCAN_ACCOUNT, type Advice, type Finding, type Signed } from "@/lib/api";
import { label, value, sentence, short, usd, SEV_ORDER, sevClass, sevWord, when } from "@/lib/format";
import Level, { levelFromDistance } from "@/components/Level";
import Door from "@/components/Door";
import FixPanel from "@/components/FixPanel";
import GuardCard from "@/components/GuardCard";
import Memo from "@/components/Memo";
import { EvidenceList, SourceList } from "@/components/Evidence";
import WatchCta from "@/components/WatchCta";
import { useIdentity } from "@/lib/identity";

// What one advise run does on the server. The API answers once at the end, so these are the work, not a progress bar.
const WORK = [
  "Reading every token and staked SOL from Solana mainnet",
  "Reading loans on Kamino, marginfi and Save",
  "Reading pools on Orca, Raydium and Meteora, and perps on Drift and Jupiter",
  "Asking Telegraph miners about the protocols this wallet uses",
  "Checking each miner answer against the chain and the others",
  "Comparing idle stablecoins with public lending rates, cross checked by Telegraph miners",
  "Signing the memo",
];

function Waiting({ wallet }: { wallet: string }) {
  const [t, setT] = useState(0);
  useEffect(() => { const s = Date.now(); const i = setInterval(() => setT(Math.floor((Date.now() - s) / 1000)), 250); return () => clearInterval(i); }, []);
  const focus = Math.floor(t / 4) % WORK.length;
  const wobble = 0.5 + Math.sin(t * 1.3) * 0.18;
  return (
    <div className="waiting">
      <div className="w-top">
        <span className="kicker">Checking <span className="mono" style={{ color: "var(--ink)" }}>{short(wallet, 6, 6)}</span></span>
        <span className="mono" style={{ fontSize: 14 }}><span className="live-dot" /> {t}s</span>
      </div>
      <h1 className="display" style={{ fontSize: "clamp(34px, 5vw, 64px)", margin: "18px 0 36px" }}>Levelling your wallet.</h1>
      <Level pos={wobble} height={54} danger="" safe="" showLabels={false} />
      <ul className="work">
        {WORK.map((w, k) => (
          <li key={w} className={k === focus ? "now" : ""}><span className="mono mute">0{k + 1}</span> {w}</li>
        ))}
      </ul>
      <p className="mute" style={{ fontSize: 14, marginTop: 22 }}>Steady runs all of this at once and answers when every check is back. Usually under a minute. The clock is real; there is no fake progress bar.</p>
    </div>
  );
}

function FindingRow({ f, wallet, idx, memo }: { f: Finding; wallet: string; idx: number; memo: Signed<Advice> }) {
  const n = f.numbers;
  const isLoan = f.code === "liquidation_near" && typeof n.distancePct === "number";
  const isKamino = isLoan && f.title.toLowerCase().startsWith("kamino") && f.id.split(":").length >= 3;
  const keys = Object.keys(n).filter((k) => !(k === "protocolHealth" && n.health === n.protocolHealth));
  const used = f.evidence.filter((e) => e.used).length;
  const rejected = f.evidence.length - used;
  return (
    <li className="finding" style={{ animationDelay: `${idx * 90}ms` }}>
      <div className="f-side">
        <span className={`tag ${f.kind === "opportunity" ? "vial" : sevClass(f.severity)}`}>{f.kind === "opportunity" ? "Money on the table" : sevWord[f.severity] ?? f.severity}</span>
      </div>
      <div className="f-main">
        <h3 className="f-title">{sentence(f.title)}</h3>
        {isLoan && (
          <div style={{ maxWidth: 560, margin: "18px 0 6px" }}>
            <Level pos={levelFromDistance(Number(n.distancePct))} height={34} danger={`Liquidated at $${n.liquidationPrice}`} safe={`${n.mainCollateral} now $${n.price}`} />
          </div>
        )}
        {isKamino && typeof n.health === "number" && <GuardCard wallet={wallet} obligation={f.id.split(":")[2] ?? ""} health={n.health} collateral={String(n.mainCollateral ?? "")} />}
        <dl className="kv" style={{ marginTop: 12 }}>
          {keys.map((k) => (
            <div key={k}><dt>{label(k)}</dt><dd>{value(k, n[k]!)}</dd></div>
          ))}
        </dl>
        {typeof n.protocolHealth === "number" && n.protocolHealth === n.health && (
          <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>Matches the health {f.id.includes("kamino") || f.title.toLowerCase().includes("kamino") ? "Kamino" : "the protocol"} itself shows.</p>
        )}
        {f.fix && <FixPanel wallet={wallet} fix={f.fix} adviceMemo={memo} />}
        <details className="drawer" style={{ marginTop: 18 }}>
          <summary>Evidence: {f.sources.length} reads{f.evidence.length ? `, ${used} miner answer${used === 1 ? "" : "s"} used, ${rejected} rejected` : ""}</summary>
          <div className="drawer-body">
            <span className="kicker">Telegraph answers</span>
            <EvidenceList items={f.evidence} />
            <span className="kicker" style={{ display: "block", marginTop: 22 }}>Where the numbers came from</span>
            <SourceList items={f.sources} />
          </div>
        </details>
      </div>
    </li>
  );
}

function Result({ advice, memo }: { advice: Advice; memo: Signed<Advice> }) {
  const sorted = [...advice.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.kind === "risk" ? -1 : 1));
  const risks = sorted.filter((f) => f.kind === "risk" && f.severity !== "info").length;
  const opps = sorted.filter((f) => f.kind === "opportunity").length;
  const checks = advice.checks ?? [];
  const headline = risks ? `${risks} thing${risks === 1 ? "" : "s"} could hurt this wallet.` : "Nothing here is close to hurting this wallet.";
  return (
    <div className="result">
      <div className="r-top">
        <div>
          <span className="kicker">Wallet <a href={SOLSCAN_ACCOUNT(advice.wallet)} target="_blank" rel="noreferrer" className="hash">{short(advice.wallet, 6, 6)}</a> read {when(advice.at)}</span>
          <h1 className="display r-head">{headline}{opps ? <span className="vial-text"> {opps} way{opps === 1 ? "" : "s"} to earn more.</span> : null}</h1>
        </div>
        <div className="r-total">
          <span className="kicker">Net worth after debt</span>
          <span className="num-xl">{usd(advice.totalUsd, 2)}</span>
          <span className="mute" style={{ fontSize: 13 }}>{advice.costUsd > 0 ? `${usd(advice.costUsd, 2)} spent on Telegraph answers for this check${advice.reusedAnswers ? `, plus ${advice.reusedAnswers} reused` : ""}` : advice.reusedAnswers ? `${advice.reusedAnswers} Telegraph answer${advice.reusedAnswers === 1 ? "" : "s"} bought earlier and reused for up to 3 hours, ${(advice.checks ?? []).filter((c) => c.used).length} judged usable` : "No Telegraph answers were needed for this check"}</span>
        </div>
      </div>

      {sorted.length ? (
        <ol className="findings">{sorted.map((f, k) => <FindingRow key={f.id} f={f} wallet={advice.wallet} idx={k} memo={memo} />)}</ol>
      ) : (
        <p className="big ink2" style={{ padding: "40px 0", borderTop: "1px solid var(--line)" }}>Steady found no loans near liquidation, no risky delegations, no depegs and no idle stablecoins worth moving. Nothing to fix.</p>
      )}

      <WatchCta wallet={advice.wallet} />

      <div className="r-more">
        {checks.length > 0 && (
          <details className="row">
            <summary><span><span style={{ fontSize: 19, fontWeight: 500 }}>Other Telegraph checks in this run</span> <span className="mute mono" style={{ fontSize: 14 }}>{checks.length}</span></span><span className="chev" /></summary>
            <div className="body"><EvidenceList items={checks} /></div>
          </details>
        )}
        {advice.gaps.length > 0 && (
          <details className="row">
            <summary><span><span style={{ fontSize: 19, fontWeight: 500 }}>What Steady could not read</span> <span className="mute mono" style={{ fontSize: 14 }}>{advice.gaps.length}</span></span><span className="chev" /></summary>
            <div className="body">
              <p style={{ marginBottom: 10 }}>Steady leaves these out rather than guess. The total above is a floor.</p>
              <ul className="gaps">{advice.gaps.map((g) => <li key={g}>{sentence(g)}</li>)}</ul>
            </div>
          </details>
        )}
        <details className="row">
          <summary><span style={{ fontSize: 19, fontWeight: 500 }}>The signed memo for this check</span><span className="chev" /></summary>
          <div className="body" style={{ maxWidth: "none" }}><Memo memo={memo} /></div>
        </details>
      </div>
    </div>
  );
}

function AppInner() {
  const params = useSearchParams();
  const router = useRouter();
  const id = useIdentity();
  const wallet = (params.get("wallet") ?? "").trim();
  // No wallet in the link: use the one for this visit (Phantom or remembered), so nobody pastes it twice.
  useEffect(() => { if (!wallet && id.ready && id.wallet) router.replace(`/app?wallet=${id.wallet}`); }, [wallet, id.ready, id.wallet, router]);
  useEffect(() => { if (wallet && isLikelyAddress(wallet) && id.source !== "phantom") id.remember(wallet); }, [wallet]); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<{ advice: Advice; memo: Signed<Advice> } | null>(null);
  const [err, setErr] = useState<{ msg: string; status: number } | null>(null);
  const [run, setRun] = useState(0);
  const started = useRef("");
  useEffect(() => {
    if (!wallet) return;
    const key = `${wallet}:${run}`;
    if (started.current === key) return;
    started.current = key;
    setData(null); setErr(null);
    post<{ advice: Advice; memo: Signed<Advice> }>("/advise", { wallet }, 150_000)
      .then(setData)
      .catch((e: ApiError) => setErr({ msg: e.message, status: e.status }));
  }, [wallet, run]);

  if (!wallet && (!id.ready || id.wallet)) return <p className="mute" style={{ paddingTop: 40 }}><span className="live-dot" /> Opening your wallet</p>;
  if (!wallet) {
    return (
      <div className="app-empty">
        <span className="kicker">Step 1 of 3</span>
        <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 84px)", margin: "16px 0 14px" }}>Which wallet?</h1>
        <p className="ink2" style={{ maxWidth: 560, marginBottom: 36 }}>Paste any Solana address. Steady reads it, tells you what could hurt it, and prepares fixes you can sign in Phantom.</p>
        <Door autoFocus />
        <ol className="steps3">
          <li className="on"><span className="mono">01</span> Paste a wallet</li>
          <li><span className="mono">02</span> Read what Steady found</li>
          <li><span className="mono">03</span> Prepare a fix and sign it</li>
        </ol>
      </div>
    );
  }
  if (err) {
    return (
      <div className="app-empty">
        <span className="tag risk">Could not check</span>
        <h1 className="display" style={{ fontSize: "clamp(34px, 5vw, 64px)", margin: "18px 0" }}>{err.status === 400 ? "That address did not work." : "The check did not finish."}</h1>
        <p className="ink2" style={{ maxWidth: 620 }}>{err.msg}</p>
        <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
          {err.status !== 400 && err.status !== 429 && <button className="btn" onClick={() => setRun((r) => r + 1)}><span className="bub" /> Try again</button>}
          <Link href="/app" className="btn btn-ghost" style={{ textDecoration: "none" }}>Check another wallet</Link>
        </div>
      </div>
    );
  }
  if (!data) return <Waiting wallet={wallet} />;
  return (
    <>
      <Result advice={data.advice} memo={data.memo} />
      <div className="again">
        <span className="kicker">Check another</span>
        <Door cta="Check it" />
      </div>
    </>
  );
}

export default function AppPage() {
  return (
    <div className="wrap app">
      <Suspense fallback={<p className="mute">Loading</p>}>
        <AppInner />
      </Suspense>
    </div>
  );
}
