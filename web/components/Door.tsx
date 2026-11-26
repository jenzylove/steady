"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { isLikelyAddress, SAMPLE_WALLET } from "@/lib/api";

export default function Door({ cta = "Check this wallet", autoFocus = false }: { cta?: string; autoFocus?: boolean }) {
  const r = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const go = (w: string) => {
    const s = w.trim();
    if (!isLikelyAddress(s)) { setErr("That does not look like a Solana wallet address."); return; }
    r.push(`/app?wallet=${encodeURIComponent(s)}`);
  };
  return (
    <div>
      <form className="door" onSubmit={(e) => { e.preventDefault(); go(v); }}>
        <input value={v} onChange={(e) => { setV(e.target.value); setErr(""); }} placeholder="Paste a Solana wallet address" aria-label="Solana wallet address" spellCheck={false} autoComplete="off" autoFocus={autoFocus} />
        <button className="btn" type="submit"><span className="bub" /> {cta}</button>
      </form>
      <p style={{ fontSize: 14, marginTop: 14 }} className="mute">
        {err ? <span style={{ color: "var(--risk)" }}>{err}</span> : <>No wallet handy? <button type="button" onClick={() => go(SAMPLE_WALLET)} className="linkbtn">Try a real public wallet with a Kamino loan</button></>}
      </p>
    </div>
  );
}
