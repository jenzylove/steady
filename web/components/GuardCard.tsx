"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { call, post, SOLSCAN_TX, type GuardInfo } from "@/lib/api";
import { short } from "@/lib/format";
import { ago } from "@/lib/stats";
import { usePhantom } from "./Nav";
import { watchLink } from "./WatchCta";

// Symbols Telegraph's price miners quote (src/guard/early.ts): SOL, BTC, ETH, USDC, USDT and liquid staking SOL tokens.
const COVERED = new Set(["SOL", "WSOL", "USDC", "USDT", "PYUSD", "USDS", "BTC", "WBTC", "CBBTC", "TBTC", "ETH", "WETH", "WHETH",
  "JITOSOL", "MSOL", "JUPSOL", "BSOL", "INF", "BBSOL", "HSOL", "VSOL", "DSOL", "BNSOL"]);

const MIN_LINE = 1.03, MAX_LINE = 1.3;
const fx = (n: number) => n.toFixed(2);

type Step = { step: "create-nonce"; transaction: string; note: string } | { step: "sign-rescue"; transaction: string; guard: GuardInfo };

const b64ToBytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const bytesToB64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const declined = (m: string) => /reject|cancel|declin|denied/i.test(m);

function useNow(ms: number) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

export default function GuardCard({ wallet, obligation, health, collateral }: { wallet: string; obligation: string; health: number; collateral: string }) {
  const w = usePhantom();
  const { connection } = useConnection();
  const now = useNow(5_000);
  const signer = w.publicKey?.toBase58();
  const isOwner = w.connected && signer === wallet;

  const [guard, setGuard] = useState<GuardInfo | null>(null);
  const [nonceAccount, setNonceAccount] = useState("");
  const [needNonce, setNeedNonce] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const max = Math.min(MAX_LINE, Math.floor((health - 0.01) * 100) / 100);
  const dflt = Math.min(Math.max(1 + (health - 1) / 3, MIN_LINE), max);
  const [line, setLine] = useState(() => Math.round(dflt * 100) / 100);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) setLine(Math.round(dflt * 100) / 100); }, [dflt]);

  const [phase, setPhase] = useState<"idle" | "preparing" | "nonce" | "rescue">("idle");
  const [busy, setBusy] = useState("");
  const [prepared, setPrepared] = useState<Extract<Step, { step: "sign-rescue" }> | null>(null);
  const [nonceNote, setNonceNote] = useState("");
  const [err, setErr] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call<{ guards: GuardInfo[]; nonceAccount: string }>(`/guard?wallet=${wallet}`, { timeoutMs: 30_000 });
      setNonceAccount(r.nonceAccount);
      const mine = r.guards.filter((g) => g.obligation === obligation && g.status !== "cancelled");
      setGuard(mine.at(-1) ?? null);
      setLoadErr(""); setLoaded(true);
    } catch (e) { setLoadErr((e as Error).message); setLoaded(true); }
  }, [wallet, obligation]);

  useEffect(() => { load(); }, [load]);
  const armedNow = guard?.status === "armed";
  useEffect(() => { if (!armedNow) return; const t = setInterval(load, 30_000); return () => clearInterval(t); }, [armedNow, load]);

  // Does the guard's nonce account exist yet? Decides whether step 1 is needed.
  const checkNonce = useCallback(async () => {
    if (!nonceAccount) return;
    try { const a = await connection.getAccountInfo(new PublicKey(nonceAccount), "confirmed"); setNeedNonce(!a); } catch { setNeedNonce(null); }
  }, [nonceAccount, connection]);
  useEffect(() => { checkNonce(); }, [checkNonce]);

  const confirm = async (sig: string) => {
    for (let i = 0; i < 40; i++) {
      const s = (await connection.getSignatureStatuses([sig])).value[0];
      if (s?.err) throw new Error("the transaction failed on chain");
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("the network is slow; wait a minute and try again");
  };

  const sendLegacy = async (b64: string) => {
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    const sig = await w.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 3 });
    await confirm(sig);
  };

  const phantomErr = (e: unknown, what: string) => {
    const m = (e as Error).message || String(e);
    return declined(m) ? "You declined in Phantom. Nothing was sent." : `${what}: ${m}`;
  };

  const prepare = async () => {
    setErr(""); setPhase("preparing");
    try {
      const r = await post<Step>("/guard/prepare", { wallet, obligation, line }, 150_000);
      if (r.step === "create-nonce") { setNonceNote(r.note); setNeedNonce(true); setPhase("nonce"); }
      else { setPrepared(r); setNeedNonce(false); setPhase("rescue"); }
    } catch (e) { setErr((e as Error).message); setPhase("idle"); }
  };

  const createNonce = async () => {
    setErr("");
    if (!isOwner) return;
    setBusy("Waiting for Phantom");
    try {
      const r = await post<Step>("/guard/prepare", { wallet, obligation, line }, 150_000);
      if (r.step === "sign-rescue") { setPrepared(r); setNeedNonce(false); setPhase("rescue"); return; }
      await sendLegacy(r.transaction);
      setBusy("Confirming on Solana");
      const next = await post<Step>("/guard/prepare", { wallet, obligation, line }, 150_000);
      if (next.step === "sign-rescue") { setPrepared(next); setNeedNonce(false); setPhase("rescue"); }
      else setErr("The guard account is not visible yet. Wait a few seconds and press the button again.");
    } catch (e) { setErr(phantomErr(e, "Could not create the guard account")); }
    finally { setBusy(""); }
  };

  const signRescue = async () => {
    if (!prepared || !isOwner || !w.signTransaction) return;
    setErr(""); setBusy("Waiting for Phantom");
    try {
      const tx = VersionedTransaction.deserialize(b64ToBytes(prepared.transaction));
      const signed = await w.signTransaction(tx);
      setBusy("Arming");
      await post("/guard/arm", { wallet, obligation, signed: bytesToB64(signed.serialize()) }, 60_000);
      setPrepared(null); setPhase("idle");
      await load();
    } catch (e) {
      const m = (e as Error).message || String(e);
      setErr(declined(m) ? "You declined in Phantom. Nothing was sent." : m);
    } finally { setBusy(""); }
  };

  const cancel = async () => {
    if (!isOwner) return;
    setErr(""); setCancelling(true);
    try {
      const r = await post<{ transaction?: string; cancelled?: boolean }>("/guard/cancel", { wallet });
      if (r.transaction) {
        await sendLegacy(r.transaction);
        await post("/guard/cancel", { wallet });
      }
      await load(); await checkNonce();
    } catch (e) { setErr(phantomErr(e, "Could not cancel")); }
    finally { setCancelling(false); }
  };

  const covered = COVERED.has(collateral.toUpperCase());
  const coverageNote = covered
    ? `Early fire is on: Telegraph's price miners quote ${collateral}. When the miners agree the market price already puts the loan at your line, Steady sends the rescue sooner.`
    : `Early fire is off for ${collateral}: Telegraph's price miners do not quote it yet. The guard still fires at your line.`;

  const connectNote = !isOwner ? (
    <div className="g-note">
      <p>Connect this wallet to arm a guard.{w.connected && signer ? ` Phantom is connected to ${short(signer)}, not ${short(wallet)}. Switch accounts in Phantom.` : ""}</p>
      {!w.connected && <button className="btn btn-ghost btn-sm" onClick={() => w.connectPhantom()}>{w.installed ? "Connect Phantom" : "Get Phantom"}</button>}
    </div>
  ) : null;

  // ---------- armed, fired, failed or stale ----------
  if (guard && (guard.status === "armed" || guard.status === "fired" || guard.status === "failed" || guard.status === "stale")) {
    const e = guard.lastEarly;
    const armed = guard.status === "armed";
    const kindWord: Record<string, string> = { armed: "Armed", fired: "Rescue sent", failed: "Send failed", stale: "Needs a refresh", cancelled: "Cancelled", early: "Early fire" };
    const agreed = e ? e.checks.filter((c) => c.agreed && c.market !== undefined) : [];
    const unagreed = e ? e.checks.filter((c) => !c.agreed) : [];
    return (
      <div className="guard" data-testid="guard-armed">
        <div className="g-head">
          <span className="kicker" style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>{armed && <span className="live-dot" />} Steady Guard</span>
          <span className={`tag ${armed ? "solid" : guard.status === "fired" ? "vial" : "warn"}`}>{armed ? "Armed" : guard.status === "fired" ? "Rescue sent" : guard.status === "stale" ? "Needs a refresh" : "Failed"}</span>
        </div>
        <h3 className="g-title">{armed ? `Armed at line ${fx(guard.line)}` : guard.status === "fired" ? `The rescue was sent at line ${fx(guard.line)}` : `Line ${fx(guard.line)}`}</h3>
        {guard.lastHealth !== undefined && (
          <p className="mono ink2" style={{ fontSize: 15 }}>Health now {guard.lastHealth.toFixed(2)}{guard.lastCheckedAt ? `, checked ${ago(guard.lastCheckedAt, now)}` : ""}</p>
        )}
        <p className="ink2" style={{ fontSize: 16, marginTop: 8 }}>{guard.summary}</p>
        {guard.status === "stale" && <p style={{ color: "var(--warn)", fontSize: 15, marginTop: 8 }}>The loan changed since you signed, so the signed rescue no longer fits. Cancel this guard and arm a new one.</p>}
        {guard.status === "failed" && <p style={{ color: "var(--risk)", fontSize: 15, marginTop: 8 }}>Steady tried to send the rescue and it did not go through. See the timeline below.</p>}
        {guard.firedSignature && <p style={{ marginTop: 8 }}><a className="hash" href={SOLSCAN_TX(guard.firedSignature)} target="_blank" rel="noreferrer">See the rescue on Solscan {short(guard.firedSignature, 6, 6)}</a></p>}

        {e && e.checks.length > 0 && (
          <div className="g-sub">
            <span className="kicker">Telegraph price miners, {ago(e.at, now)}</span>
            {agreed.map((c) => (
              <p key={c.symbol} style={{ fontSize: 15, marginTop: 6 }}>
                {c.symbol} ${c.market!.toFixed(2)} on the market vs ${c.oracle.toFixed(2)} on the oracle
                {c.signals.length > 0 && <span className="mono mute" style={{ fontSize: 12 }}> {c.signals.slice(0, 3).map((s) => short(s, 6, 4)).join(" ")}</span>}
              </p>
            ))}
            {unagreed.length > 0 && <p className="mute" style={{ fontSize: 14, marginTop: 6 }}>No agreed market price for {unagreed.map((c) => c.symbol).join(", ")}. Steady used the oracle price for {unagreed.length === 1 ? "it" : "them"}.</p>}
            <p className="mono ink2" style={{ fontSize: 14, marginTop: 6 }}>Health at market prices {e.projected.toFixed(2)}</p>
          </div>
        )}
        {!covered && <p className="mute" style={{ fontSize: 14, marginTop: 12 }}>{coverageNote}</p>}

        {guard.events.length > 0 && (
          <details className="drawer" style={{ marginTop: 16 }}>
            <summary>Timeline, {guard.events.length} event{guard.events.length === 1 ? "" : "s"}</summary>
            <ul className="g-events">
              {[...guard.events].reverse().map((ev, k) => (
                <li key={k}>
                  <span className="mono mute" style={{ fontSize: 12 }}>{new Date(ev.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span><strong>{kindWord[ev.kind] ?? ev.kind}.</strong> {ev.note}{ev.signature && <> <a className="hash" href={SOLSCAN_TX(ev.signature)} target="_blank" rel="noreferrer">{short(ev.signature, 6, 6)}</a></>}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="sign-row">
          <a className="btn btn-ghost btn-sm" href={watchLink(wallet)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Watch on Telegram</a>
          {isOwner && guard.status !== "fired" && <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={cancelling}>{cancelling ? "Cancelling" : "Cancel guard"}</button>}
        </div>
        {!isOwner && guard.status !== "fired" && <p className="mute" style={{ fontSize: 14, marginTop: 10 }}>Connect this wallet to cancel the guard.</p>}
        {err && <p style={{ color: "var(--risk)", fontSize: 14, marginTop: 10 }}>{err}</p>}
        {guard.status !== "fired" && <p className="mute" style={{ fontSize: 13, marginTop: 14 }}>Cancel by signing one transaction. It closes the guard account, so the signed rescue can never be sent, and returns the rent.</p>}
      </div>
    );
  }

  // ---------- arm flow ----------
  if (max < MIN_LINE) {
    return (
      <div className="guard" data-testid="guard-close">
        <span className="kicker">Steady Guard</span>
        <p className="ink2" style={{ marginTop: 8 }}>Health is {health.toFixed(2)}, too close to set a line above it. Use the fix below now instead.</p>
      </div>
    );
  }

  const step1 = needNonce === false ? "done" : phase === "nonce" ? "now" : needNonce === true ? "todo" : "maybe";
  const step2 = phase === "rescue" ? "now" : "todo";
  const mark = (s: string) => s === "done" ? "Done" : s === "now" ? "Now" : s === "maybe" ? "If needed" : "Next";
  return (
    <div className="guard" data-testid="guard-arm">
      <div className="g-head">
        <span className="kicker">Steady Guard</span>
        <span className="tag vial">Sign once</span>
      </div>
      <h3 className="g-title">Guard this loan</h3>
      <p className="mono ink2" style={{ fontSize: 15 }}>Health now {health.toFixed(2)}</p>

      <label className="g-line" htmlFor={`line-${obligation}`}>
        <span>Fire the rescue when health falls to <strong className="mono">{fx(line)}</strong></span>
        <input id={`line-${obligation}`} type="range" min={MIN_LINE} max={max} step={0.01} value={line} disabled={phase === "nonce" || phase === "rescue" || !!busy}
          onChange={(e) => { touched.current = true; setLine(Number(e.target.value)); }} aria-label="Health line" />
        <span className="g-scale mono mute"><span>{fx(MIN_LINE)} closer to liquidation</span><span>{fx(max)} safer</span></span>
      </label>

      <p className="ink2" style={{ fontSize: 16, marginTop: 12 }}>
        {prepared ? prepared.guard.summary : `When health falls to ${fx(line)}, Steady sends the rescue you signed today. It sells some of your ${collateral} to repay part of the debt, so the loan stays out of liquidation. You can cancel any time.`}
      </p>
      <p className="mute" style={{ fontSize: 14, marginTop: 8 }}>Steady never holds a key. The rescue you sign can only repay your own debt from this loan&apos;s own collateral.</p>
      <p className="mute" style={{ fontSize: 14, marginTop: 6 }}>{coverageNote}</p>

      <ol className="g-steps">
        <li className={step1}><span className="mono">1</span><span><strong>Create your guard account</strong> <span className="mute">{needNonce === false ? "Already exists." : "Only if needed. About 0.0015 SOL rent, returned when you cancel."}</span></span><span className="tag">{mark(step1)}</span></li>
        <li className={step2}><span className="mono">2</span><span><strong>Sign the rescue</strong> <span className="mute">Phantom will not send it. Steady keeps it and sends it only at your line.</span></span><span className="tag">{mark(step2)}</span></li>
      </ol>

      {!loaded ? <p className="mute" style={{ fontSize: 14 }}><span className="live-dot" /> Checking for an existing guard</p> : (
        isOwner ? (
          <div className="sign-row">
            {phase === "idle" || phase === "preparing" ? (
              <button className="btn" onClick={prepare} disabled={phase === "preparing"}><span className="bub" /> {phase === "preparing" ? "Preparing the rescue" : "Set up my guard"}</button>
            ) : phase === "nonce" ? (
              <button className="btn" onClick={createNonce} disabled={!!busy}><span className="bub" /> {busy || "Create guard account in Phantom"}</button>
            ) : (
              <button className="btn" onClick={signRescue} disabled={!!busy}><span className="bub" /> {busy || "Sign the rescue in Phantom"}</button>
            )}
            {phase === "nonce" && <span className="mute" style={{ fontSize: 14 }}>{nonceNote || "Phantom sends this one."}</span>}
            {phase === "rescue" && !busy && <span className="mute" style={{ fontSize: 14 }}>Phantom will not send it. You can cancel any time.</span>}
            {phase === "preparing" && <span className="mute" style={{ fontSize: 14 }}>Steady builds and tests the rescue on mainnet. About half a minute.</span>}
          </div>
        ) : connectNote
      )}
      {err && <p style={{ color: "var(--risk)", fontSize: 14, marginTop: 12 }}>{err}</p>}
      {loadErr && <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>Could not read guard status: {loadErr}</p>}
    </div>
  );
}
