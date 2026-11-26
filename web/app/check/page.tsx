"use client";
import { useState } from "react";
import { Keypair, LAMPORTS_PER_SOL, MessageV0, PublicKey, SystemProgram, VersionedTransaction } from "@solana/web3.js";
import { post, isLikelyAddress, SAMPLE_WALLET, type PresignResult, type Signed } from "@/lib/api";
import { short } from "@/lib/format";
import { usePhantom } from "@/components/Nav";
import { EvidenceList } from "@/components/Evidence";
import Memo from "@/components/Memo";

const VERDICT = {
  ok: { word: "OK", line: "Nothing Steady checks for turned up. It looks safe to sign.", color: "var(--vial-ink)" },
  caution: { word: "Caution", line: "It would go through, but read the reasons before you sign.", color: "var(--warn)" },
  block: { word: "Block", line: "Do not sign this.", color: "var(--risk)" },
} as const;

function toB64(bytes: Uint8Array): string { let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }

/** A real, unsigned transfer from the wallet to a fresh random address. The API simulates with a fresh blockhash. */
function sampleTransfer(wallet: string): string {
  const from = new PublicKey(wallet);
  const msg = MessageV0.compile({
    payerKey: from,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: Keypair.generate().publicKey, lamports: 0.01 * LAMPORTS_PER_SOL })],
  });
  return toB64(new VersionedTransaction(msg).serialize());
}

function amount(n: number) { const a = Math.abs(n); return a >= 1 ? a.toLocaleString("en-US", { maximumFractionDigits: 4 }) : a.toPrecision(3); }

export default function CheckPage() {
  const w = usePhantom();
  const [wallet, setWallet] = useState("");
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<{ result: PresignResult; memo: Signed<unknown> } | null>(null);
  const [note, setNote] = useState("");

  const useConnected = () => { if (w.publicKey) setWallet(w.publicKey.toBase58()); else w.connectPhantom(); };
  const sample = () => {
    const who = isLikelyAddress(wallet) ? wallet.trim() : SAMPLE_WALLET;
    setWallet(who);
    try { setTx(sampleTransfer(who)); setNote(`A sample: send 0.01 SOL from ${short(who)} to a brand new random address. Nothing is signed or sent.`); setErr(""); }
    catch { setErr("That wallet address is not valid, so the sample could not be built."); }
  };
  const run = async () => {
    setErr(""); setRes(null);
    if (!isLikelyAddress(wallet)) return setErr("Add the wallet that would sign it.");
    if (!tx.trim()) return setErr("Paste the transaction first (base64), or build the sample.");
    setBusy(true);
    try { setRes(await post("/presign", { wallet: wallet.trim(), transaction: tx.trim() }, 90_000)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const r = res?.result;
  const v = r ? VERDICT[r.verdict] : null;
  return (
    <div className="wrap page">
      <div className="page-head">
        <span className="kicker">Check before you sign</span>
        <h1 className="display page-title">Will this hurt me?</h1>
        <p className="ink2 big">Paste a transaction a site or a person wants you to sign. Steady runs it against Solana mainnet without sending it and tells you, in plain words, what would happen to your wallet.</p>
      </div>

      <div className="form-grid">
        <div>
          <label className="kicker" htmlFor="w">The wallet that would sign</label>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <input id="w" className="field" style={{ flex: 1, minWidth: 240 }} value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Solana wallet address" spellCheck={false} />
            <button className="btn btn-ghost btn-sm" onClick={useConnected}>{w.connected ? "Use my Phantom wallet" : "Connect Phantom"}</button>
          </div>
        </div>
        <div>
          <label className="kicker" htmlFor="t">The transaction, base64</label>
          <textarea id="t" className="field mono" style={{ marginTop: 10 }} value={tx} onChange={(e) => { setTx(e.target.value); setNote(""); }} placeholder="AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB..." spellCheck={false} />
          {note && <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>{note}</p>}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={run} disabled={busy}><span className="bub" /> {busy ? "Running it on mainnet" : "Check it"}</button>
          <button className="linkbtn" onClick={sample}>No transaction handy? Build a sample transfer</button>
        </div>
        {busy && <p className="mute" style={{ fontSize: 14 }}><span className="live-dot" /> Simulating on mainnet and screening every recipient with Telegraph sanctions miners. Usually a few seconds.</p>}
        {err && <p style={{ color: "var(--risk)" }}>{err}</p>}
      </div>

      {r && v && (
        <div style={{ marginTop: 90, paddingTop: 50, borderTop: "1px solid var(--line)" }}>
          <span className="kicker" style={{ display: "block" }}>Verdict</span>
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
              ) : <p className="ink2" style={{ marginTop: 10 }}>It runs cleanly, hands no control of your tokens to anyone, calls only programs Steady knows, and no recipient is on a sanctions list or imitates your history.</p>}
            </div>
            <div>
              <span className="kicker">Programs it calls</span>
              <ul className="src" style={{ marginTop: 8 }}>{r.programs.map((p) => <li key={p}><span className="mono" style={{ fontSize: 14 }}>{p.length > 30 ? short(p, 6, 6) : p}</span>{p.length > 30 && <span className="tag warn">Unknown</span>}</li>)}</ul>
              <span className="kicker" style={{ display: "block", marginTop: 32 }}>Who it pays or touches</span>
              {r.recipients.length ? <ul className="src" style={{ marginTop: 8 }}>{r.recipients.map((p) => <li key={p}><a className="hash" href={`https://solscan.io/account/${p}`} target="_blank" rel="noreferrer">{short(p, 6, 6)}</a></li>)}</ul> : <p className="mute" style={{ marginTop: 8 }}>No one besides you.</p>}
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
              <div className="body" style={{ maxWidth: "none" }}><Memo memo={res!.memo} /></div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
