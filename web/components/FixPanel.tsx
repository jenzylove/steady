"use client";
import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { post, SOLSCAN_TX, type BuiltFix, type FixSpec, type Signed } from "@/lib/api";
import { short } from "@/lib/format";
import { usePhantom } from "./Nav";
import Memo from "./Memo";

const VERB: Record<string, string> = { repay: "Repay", deposit: "Deposit", withdraw: "Withdraw", revoke: "Revoke", swap: "Swap", move: "Move" };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function plainError(err: string): string {
  if (/InsufficientFunds|insufficient/i.test(err)) return "the wallet does not hold enough of the token to do this right now";
  if (/AccountNotFound/i.test(err)) return "an account this needs does not exist yet (often the wallet has no SOL for fees)";
  if (/BlockhashNotFound/i.test(err)) return "the network moved on before it could be tried; prepare it again";
  return err;
}

/** True when the API has a builder for this fix (see src/fix/build.ts). Others are shown as advice only. */
export function hasBuilder(fix: FixSpec): boolean {
  if (fix.protocol === "kamino" && (fix.action === "repay" || fix.action === "withdraw" || fix.action === "deposit")) return true;
  if (fix.action === "revoke" && !!fix.account) return true;
  if (fix.action === "swap" && !!fix.mintIn && !!fix.mintOut) return true;
  return false;
}

export default function FixPanel({ wallet, fix, adviceMemo }: { wallet: string; fix: FixSpec; adviceMemo?: Signed<unknown> }) {
  const [state, setState] = useState<"idle" | "building" | "built" | "error">("idle");
  const [built, setBuilt] = useState<BuiltFix | null>(null);
  const [memo, setMemo] = useState<Signed<unknown> | null>(null);
  const [memoNote, setMemoNote] = useState("");
  const [err, setErr] = useState("");
  const [sig, setSig] = useState("");
  const [signing, setSigning] = useState(false);
  const [signErr, setSignErr] = useState("");
  const w = usePhantom();
  const { connection } = useConnection();

  const prepare = async () => {
    setState("building"); setErr(""); setSig(""); setSignErr("");
    try {
      const r = await post<{ built: BuiltFix; memo: Signed<unknown> | null; memoNote?: string }>("/fix", { wallet, fix, adviceMemo }, 150_000);
      setBuilt(r.built); setMemo(r.memo); setMemoNote(r.memo ? "" : r.memoNote ?? ""); setState("built");
    } catch (e) { setErr((e as Error).message); setState("error"); }
  };

  const signer = w.publicKey?.toBase58();
  const sign = async () => {
    if (!built?.transaction) return;
    setSignErr("");
    if (!w.connected) { w.connectPhantom(); return; }
    if (signer !== wallet) { setSignErr(`This fix is built for ${short(wallet)}. Phantom is connected to ${short(signer ?? "")}. Switch accounts in Phantom and connect again.`); return; }
    setSigning(true);
    try {
      const tx = VersionedTransaction.deserialize(b64ToBytes(built.transaction));
      const s = await w.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
      setSig(s);
    } catch (e) {
      const m = (e as Error).message || String(e);
      setSignErr(/reject|cancel|declin/i.test(m) ? "You declined in Phantom. Nothing was sent." : `Phantom could not send it: ${m}`);
    } finally { setSigning(false); }
  };

  const sim = built?.simulation;
  const buildable = hasBuilder(fix);
  return (
    <div className="fix">
      <div className="fix-head">
        <div>
          <span className="kicker">The fix</span>
          <p style={{ fontSize: 18, marginTop: 4 }}>{fix.reason}</p>
          {fix.expected && (
            <p className="mono ink2" style={{ fontSize: 14, marginTop: 4 }}>
              {fix.expected.metric} {fix.expected.before} <span className="vial-text">→ {fix.expected.after}</span>
            </p>
          )}
        </div>
        {!buildable && <span className="tag">Advice only</span>}
        {buildable && state !== "built" && (
          <button className="btn" onClick={prepare} disabled={state === "building"}>
            <span className="bub" /> {state === "building" ? "Building and simulating" : state === "error" ? "Try again" : `Prepare fix`}
          </button>
        )}
      </div>

      {!buildable && <p className="mute" style={{ fontSize: 14 }}>Steady cannot build this one for you yet. You can do it in {fix.protocol}&apos;s own app.</p>}
      {state === "building" && <p className="mute" style={{ fontSize: 14 }}><span className="live-dot" /> Steady rereads the wallet, builds the {VERB[fix.action]?.toLowerCase() ?? fix.action} for it, and runs it on mainnet without sending. This takes about half a minute.</p>}
      {state === "error" && <p style={{ color: "var(--risk)" }}>{err}</p>}

      {state === "built" && built && (
        <div className="fix-result">
          {built.unsupported ? (
            <p><span className="tag warn">Not built</span> Steady could not prepare this one: {built.unsupported}</p>
          ) : sim?.ok ? (
            <p style={{ fontSize: 18 }}><span className="tag solid">Simulated</span> Run on Solana mainnet just now without sending: <strong>it would succeed.</strong>{sim.unitsConsumed ? <span className="mute mono" style={{ fontSize: 13 }}> {sim.unitsConsumed.toLocaleString("en-US")} compute units</span> : null}</p>
          ) : sim ? (
            <p style={{ fontSize: 18 }}><span className="tag risk">Would fail</span> Run on mainnet just now: it would not go through, because {plainError(sim.err ?? "of an unknown error")}.</p>
          ) : (
            <p className="mute">Built, but no simulation came back.</p>
          )}

          {built.summary && !built.unsupported && <p style={{ fontSize: 16, marginTop: 8 }}>{built.summary}</p>}

          {sim && sim.logsTail.length > 0 && (
            <details className="drawer" style={{ marginTop: 12 }}>
              <summary>What the program said</summary>
              <pre className="logs">{sim.logsTail.join("\n")}</pre>
            </details>
          )}

          {built.transaction && (
            <div className="sign-row">
              {sig ? (
                <p style={{ fontSize: 18 }}><span className="tag solid">Sent</span> Signed in Phantom and sent. <a href={SOLSCAN_TX(sig)} target="_blank" rel="noreferrer" className="hash">See it on Solscan {short(sig, 6, 6)}</a></p>
              ) : (
                <>
                  <button className="btn" onClick={sign} disabled={signing || !sim?.ok}>
                    <span className="bub" /> {signing ? "Waiting for Phantom" : !w.connected ? (w.installed ? "Connect Phantom to sign" : "Get Phantom to sign") : "Sign in Phantom"}
                  </button>
                  <span className="mute" style={{ fontSize: 14 }}>
                    {!sim?.ok ? "Signing is off because the simulation says it would fail." : "Phantom shows you the transaction to approve. Nothing moves until you do."}
                  </span>
                </>
              )}
              {signErr && <p style={{ color: "var(--risk)", width: "100%", fontSize: 14 }}>{signErr}</p>}
            </div>
          )}
          <button className="linkbtn" style={{ fontSize: 14, marginTop: 14 }} onClick={prepare}>Prepare it again with fresh numbers</button>
          {!memo && memoNote && <p className="mute" style={{ fontSize: 13, marginTop: 12 }}>No signed memo for this one: {memoNote}.</p>}
          {memo && <details className="drawer" style={{ marginTop: 16 }}><summary>The signed memo for this fix</summary><div style={{ marginTop: 14 }}><Memo memo={memo} title="Fix memo" /></div></details>}
        </div>
      )}
    </div>
  );
}
