"use client";
import { useEffect, useRef, useState } from "react";
import { post, isLikelyAddress, SAMPLE_WALLET, type PresignResult, type Signed } from "@/lib/api";
import { short } from "@/lib/format";
import { usePhantom } from "@/components/Nav";
import { useIdentity } from "@/lib/identity";
import { EvidenceList } from "@/components/Evidence";
import Memo from "@/components/Memo";
import { buildAccountHandover, buildHiddenApproval, buildSend, buildWalletTakeover, FRIEND, LOOKALIKE, TOKENS, type TokenName } from "@/lib/txbuild";

const VERDICT = {
  ok: { word: "OK", line: "No takeover, drain or hidden approval found. Still sign only what you meant to do.", color: "var(--vial-ink)" },
  caution: { word: "Caution", line: "It would go through, but read the reasons before you sign.", color: "var(--warn)" },
  block: { word: "Block", line: "Do not sign this.", color: "var(--risk)" },
} as const;

const HISTORY_KEY = "steady-sent-to";
function readHistory(): string[] { try { const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : []; } catch { return []; } }
function addHistory(xs: string[]) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...new Set([...xs, ...readHistory()])].slice(0, 50))); } catch {} }

const BAD: { id: string; name: string; what: string; build: (w: string) => { tx: string; history?: string[] } }[] = [
  { id: "approval", name: "A hidden approval", what: "Looks like an airdrop claim with a small fee. Tucked inside: unlimited permission for a stranger to move your USDC whenever they like.", build: (w: string) => ({ tx: buildHiddenApproval(w) }) },
  { id: "lookalike", name: "A lookalike address", what: `Say you often pay ${short(FRIEND, 5, 5)}. A scammer sends you dust from ${short(LOOKALIKE, 5, 5)}, hoping you copy it from your history next time.`, build: (w: string) => ({ tx: buildSend(w, LOOKALIKE, "SOL", "0.01").tx, history: [FRIEND] }) },
  { id: "handover", name: "A token account handover", what: "One instruction that makes a stranger the owner of your USDC account. Everything in it, now and later, is theirs.", build: (w: string) => ({ tx: buildAccountHandover(w) }) },
  { id: "takeover", name: "A whole wallet takeover", what: "Reassigns your wallet account to a program someone else controls. After this, the wallet is not yours.", build: (w: string) => ({ tx: buildWalletTakeover(w) }) },
];

type Res = { result: PresignResult; memo: Signed<unknown>; label: string; wallet: string };

function amount(n: number) { const a = Math.abs(n); return a >= 1 ? a.toLocaleString("en-US", { maximumFractionDigits: 4 }) : a.toPrecision(3); }

export default function CheckPage() {
  const w = usePhantom();
  const id = useIdentity();
  const [mode, setMode] = useState<"send" | "bad">("send");
  const [to, setTo] = useState("");
  const [token, setToken] = useState<TokenName>("SOL");
  const [amt, setAmt] = useState("0.01");
  const [from, setFrom] = useState("");
  const [raw, setRaw] = useState("");
  const [rawWallet, setRawWallet] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ where: string; msg: string } | null>(null);
  const [res, setRes] = useState<Res | null>(null);
  const out = useRef<HTMLDivElement>(null);

  const sender = id.wallet ?? (isLikelyAddress(from) ? from.trim() : "");
  useEffect(() => { if (id.wallet && !rawWallet) setRawWallet(id.wallet); }, [id.wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (where: string, label: string, wallet: string, tx: string, history: string[], after?: (r: PresignResult) => void) => {
    setErr(null); setRes(null); setBusy(where);
    try {
      const r = await post<{ result: PresignResult; memo: Signed<unknown> }>("/presign", { wallet, transaction: tx, history }, 90_000);
      setRes({ ...r, label, wallet }); after?.(r.result);
      setTimeout(() => out.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) { setErr({ where, msg: (e as Error).message }); }
    finally { setBusy(""); }
  };

  const checkSend = () => {
    if (!sender) return setErr({ where: "send", msg: "Add the wallet that sends it first." });
    if (!isLikelyAddress(to)) return setErr({ where: "send", msg: "The recipient is not a Solana address." });
    if (!(Number(amt) > 0)) return setErr({ where: "send", msg: "Enter an amount above zero." });
    let built: ReturnType<typeof buildSend>;
    try { built = buildSend(sender, to.trim(), token, amt); } catch { return setErr({ where: "send", msg: "Steady could not build that send. Check both addresses." }); }
    if (!id.wallet && isLikelyAddress(from)) id.remember(from.trim());
    run("send", `Send ${amt} ${token} to ${short(to.trim(), 5, 5)}`, sender, built.tx, readHistory(), (r) => { if (r.verdict !== "block") addHistory(built.touches); });
  };
  const checkBad = (b: (typeof BAD)[number]) => {
    const built = b.build(SAMPLE_WALLET);
    run(b.id, b.name, SAMPLE_WALLET, built.tx, built.history ?? []);
  };
  const checkRaw = () => {
    if (!isLikelyAddress(rawWallet)) return setErr({ where: "raw", msg: "Add the wallet that would sign it." });
    if (!raw.trim()) return setErr({ where: "raw", msg: "Paste the transaction the site gave you." });
    run("raw", "A pasted transaction", rawWallet.trim(), raw.trim(), readHistory());
  };

  const r = res?.result;
  const v = r ? VERDICT[r.verdict] : null;
  const errAt = (where: string) => err?.where === where ? <p style={{ color: "var(--risk)", fontSize: 15 }}>{err.msg}</p> : null;
  const working = (where: string) => busy === where ? <p className="mute" style={{ fontSize: 14 }}><span className="live-dot" /> Running it on mainnet without sending, and screening who it pays with Telegraph sanctions miners. Usually a few seconds.</p> : null;

  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="kicker">Check before you sign</span>
        <h1 className="display page-title">Will this hurt me?</h1>
        <p className="ink2 big">Steady runs a transaction against Solana mainnet without sending it and tells you in plain words what would leave your wallet, who would gain control, and whether the address is a lookalike.</p>
      </div>

      <div className="modes" role="tablist" aria-label="What do you want to check">
        <button role="tab" aria-selected={mode === "send"} className={`mode ${mode === "send" ? "on" : ""}`} onClick={() => setMode("send")}>
          <span className="mono mute">01</span><span className="mode-t">Send tokens</span><span className="mute mode-d">Check a send before you make it</span>
        </button>
        <button role="tab" aria-selected={mode === "bad"} className={`mode ${mode === "bad" ? "on" : ""}`} onClick={() => setMode("bad")}>
          <span className="mono mute">02</span><span className="mode-t">See Steady block a bad one</span><span className="mute mode-d">Four real drainer tricks, one click each</span>
        </button>
      </div>

      {mode === "send" && (
        <div className="form-grid settle-in" style={{ marginTop: 34 }}>
          <div>
            <span className="kicker">From</span>
            {id.wallet ? (
              <p className="mono" style={{ marginTop: 10, fontSize: 15, wordBreak: "break-all" }}>{id.wallet} <span className="mute" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>{id.source === "phantom" ? "your Phantom wallet" : "your wallet, change it from the top bar"}</span></p>
            ) : (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <input className="field" style={{ flex: 1, minWidth: 240 }} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Your Solana wallet address" aria-label="Your wallet" spellCheck={false} />
                <button className="btn btn-ghost btn-sm" onClick={() => w.connectPhantom()}>{w.installed ? "Use Phantom" : "Get Phantom"}</button>
              </div>
            )}
          </div>
          <div>
            <label className="kicker" htmlFor="to">To</label>
            <input id="to" className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="The address you are sending to" spellCheck={false} autoComplete="off" />
          </div>
          <div className="send-row">
            <div>
              <span className="kicker">Token</span>
              <div className="chips" role="radiogroup" aria-label="Token">
                {(Object.keys(TOKENS) as TokenName[]).map((t) => <button key={t} role="radio" aria-checked={token === t} className={`chip ${token === t ? "on" : ""}`} onClick={() => setToken(t)}>{t}</button>)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="kicker" htmlFor="amt">Amount</label>
              <input id="amt" className="field" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn" onClick={checkSend} disabled={!!busy}><span className="bub" /> {busy === "send" ? "Running it on mainnet" : "Check this send"}</button>
            <span className="mute" style={{ fontSize: 14 }}>Steady builds the send, runs it, and never signs or sends it.</span>
          </div>
          {working("send")}{errAt("send")}
          <p className="mute" style={{ fontSize: 13 }}>Steady remembers who you send to in this browser, so next time it can spot an address made to look like one of them.</p>
        </div>
      )}

      {mode === "bad" && (
        <div className="settle-in" style={{ marginTop: 34 }}>
          <p className="ink2" style={{ maxWidth: 760, marginBottom: 18 }}>Each one is built the way drainers build them and run on a real public wallet (<span className="mono">{short(SAMPLE_WALLET, 4, 4)}</span>). Nothing is signed or sent.</p>
          <ul className="bad">
            {BAD.map((b) => (
              <li key={b.id}>
                <div>
                  <h3 style={{ fontSize: 19, fontWeight: 600 }}>{b.name}</h3>
                  <p className="ink2" style={{ fontSize: 15, marginTop: 4 }}>{b.what}</p>
                  {working(b.id)}{errAt(b.id)}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => checkBad(b)} disabled={!!busy} aria-label={`Run ${b.name}`}><span className="bub" /> {busy === b.id ? "Running" : "Run it"}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="row" style={{ marginTop: 48, maxWidth: 900 }}>
        <summary><span><span style={{ fontSize: 18, fontWeight: 500 }}>Advanced: paste a transaction from a site</span> <span className="mute" style={{ fontSize: 14 }}>for when a dApp hands you one to sign</span></span><span className="chev" /></summary>
        <div className="body form-grid" style={{ maxWidth: 900 }}>
          <div>
            <label className="kicker" htmlFor="rw">The wallet that would sign</label>
            <input id="rw" className="field" value={rawWallet} onChange={(e) => setRawWallet(e.target.value)} placeholder="Solana wallet address" spellCheck={false} />
          </div>
          <div>
            <label className="kicker" htmlFor="t">The transaction (base64, as the site or wallet shows it)</label>
            <textarea id="t" className="field mono" style={{ marginTop: 10 }} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="AQAAAAAAAAAA…" spellCheck={false} />
          </div>
          <div><button className="btn" onClick={checkRaw} disabled={!!busy}><span className="bub" /> {busy === "raw" ? "Running it on mainnet" : "Check it"}</button></div>
          {working("raw")}{errAt("raw")}
        </div>
      </details>

      {r && v && res && (
        <div ref={out} style={{ marginTop: 80, paddingTop: 50, borderTop: "1px solid var(--line)", scrollMarginTop: 100 }}>
          <span className="kicker" style={{ display: "block" }}>{res.label} · from {short(res.wallet, 4, 4)}</span>
          <div className="display verdict-big" style={{ color: v.color, marginTop: 10 }}>{v.word}</div>
          <p className="big" style={{ marginTop: 18, maxWidth: 720 }}>{v.line}</p>

          <div className="two">
            <div>
              <span className="kicker">What changes in your wallet</span>
              {r.signerChanges.length ? (
                <ul className="changes" style={{ marginTop: 12 }}>
                  {r.signerChanges.map((c, k) => (
                    <li key={k}>
                      <span>{c.delta < 0 ? "You send" : "You receive"} <strong className="mono">{amount(c.delta)}</strong> {c.symbol ?? <span className="mono" title={c.mint}>{short(c.mint)}</span>}</span>
                      <span className="mono" style={{ color: c.delta < 0 ? "var(--risk)" : "var(--vial-ink)", fontSize: 15 }}>{c.delta < 0 ? "−" : "+"}{amount(c.delta)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="ink2" style={{ marginTop: 12 }}>No balance in your wallet would change{r.simulation.ok ? "." : ", because it would fail."}</p>}
              {r.signerChanges.some((c) => c.mint === "SOL") && <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>The small network fee is not included.</p>}

              <span className="kicker" style={{ display: "block", marginTop: 40 }}>Why</span>
              {r.reasons.length ? (
                <ul className="reasons" style={{ marginTop: 10, color: v.color }}>
                  {r.reasons.map((x) => <li key={x}><span style={{ color: "var(--ink)" }}>{x}</span></li>)}
                </ul>
              ) : <p className="ink2" style={{ marginTop: 10 }}>It runs cleanly, hands no control of your tokens or wallet to anyone, calls only programs Steady knows, and no recipient is on a sanctions list or imitates an address you have sent to here.</p>}
            </div>
            <div>
              <span className="kicker">Programs it calls</span>
              <ul className="src" style={{ marginTop: 8 }}>{r.programs.map((p) => <li key={p}><span className="mono" style={{ fontSize: 14 }}>{p.length > 30 ? short(p, 6, 6) : p}</span>{p.length > 30 && <span className="tag warn">Unknown</span>}</li>)}</ul>
              <span className="kicker" style={{ display: "block", marginTop: 32 }}>Who it pays or touches</span>
              {r.recipients.length ? <ul className="src" style={{ marginTop: 8 }}>{r.recipients.map((p) => <li key={p}><a className="hash" href={`https://solscan.io/account/${p}`} target="_blank" rel="noreferrer" aria-label={`Open ${p} on Solscan`}>{short(p, 6, 6)}</a></li>)}</ul> : <p className="mute" style={{ marginTop: 8 }}>No one besides you.</p>}
              <span className="kicker" style={{ display: "block", marginTop: 32 }}>Simulation</span>
              <p style={{ marginTop: 8 }}>{r.simulation.ok ? "It would succeed on mainnet right now." : `It would fail: ${r.simulation.err}`}</p>
              {r.simulation.logsTail.length > 0 && <details className="drawer" style={{ marginTop: 10 }}><summary>Program logs</summary><pre className="logs">{r.simulation.logsTail.join("\n")}</pre></details>}
            </div>
          </div>

          <div style={{ marginTop: 56 }}>
            <details className="row">
              <summary><span style={{ fontSize: 19, fontWeight: 500 }}>Telegraph evidence <span className="mute mono" style={{ fontSize: 14 }}>{r.evidence.length}</span></span><span className="chev" /></summary>
              <div className="body" style={{ maxWidth: "none" }}><EvidenceList items={r.evidence} /></div>
            </details>
            <details className="row">
              <summary><span style={{ fontSize: 19, fontWeight: 500 }}>The signed memo for this check</span><span className="chev" /></summary>
              <div className="body" style={{ maxWidth: "none" }}><Memo memo={res.memo} /></div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
