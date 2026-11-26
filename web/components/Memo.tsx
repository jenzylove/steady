"use client";
import { useState } from "react";
import { API, type Signed } from "@/lib/api";
import { short } from "@/lib/format";

export default function Memo({ memo, title = "The signed memo" }: { memo: Signed<unknown>; title?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "bad" | "none" | "err">("idle");
  const [copied, setCopied] = useState("");
  const verify = async () => {
    setState("busy");
    try {
      const r = await fetch(`${API}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memo }) });
      if (r.status === 404) return setState("none");
      const j = await r.json().catch(() => ({}));
      setState(j?.ok === true || j?.valid === true ? "ok" : r.ok ? "bad" : "err");
    } catch { setState("err"); }
  };
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1400); }).catch(() => {}); };
  const download = () => {
    const blob = new Blob([JSON.stringify(memo, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `steady-memo-${memo.digest.slice(0, 8)}.json`; a.click();
  };
  const rows: [string, string, string][] = [["digest", "Digest (sha256)", memo.digest], ["signer", "Signed by", memo.signer], ["signature", "Signature", memo.signature]];
  return (
    <div className="memo">
      <div className="memo-head">
        <span className="kicker">{title}</span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={download}>Download memo</button>
          <button className="btn btn-sm" onClick={verify} disabled={state === "busy"}><span className="bub" /> {state === "busy" ? "Checking" : "Verify"}</button>
        </div>
      </div>
      <dl className="memo-rows">
        {rows.map(([k, l, v]) => (
          <div key={k}>
            <dt className="mute">{l}</dt>
            <dd className="mono"><span className="memo-full">{v}</span><span className="memo-short">{short(v, 10, 8)}</span>
              <button className="copy" onClick={() => copy(k, v)}>{copied === k ? "copied" : "copy"}</button></dd>
          </div>
        ))}
      </dl>
      {state === "ok" && <p style={{ color: "var(--vial-ink)" }}>The signature is valid for this memo and this signer.</p>}
      {state === "bad" && <p style={{ color: "var(--risk)" }}>The check failed: this memo does not match its signature.</p>}
      {state === "err" && <p style={{ color: "var(--risk)" }}>The verify service did not answer. You can still check it yourself, below.</p>}
      {(state === "none" || state === "err") && (
        <div className="offline">
          <p style={{ marginBottom: 8 }}>This API has no verify service yet, so check it yourself. Steady never asks you to trust its own screen:</p>
          <ol>
            <li>Download the memo. Take its <span className="mono">body</span>, sort every key at every level, and write it as JSON with no spaces.</li>
            <li>The SHA256 of that text must equal the digest above.</li>
            <li>Recover the signer of the message <span className="mono">Steady memo sha256:&lt;digest&gt;</span> from the signature (Ethereum personal sign, EIP-191). It must equal <span className="mono">{short(memo.signer, 6, 4)}</span>.</li>
          </ol>
          <p className="mute" style={{ fontSize: 13, marginTop: 8 }}>In the repo, <span className="mono">verify()</span> in src/memo/memo.ts does exactly this.</p>
        </div>
      )}
    </div>
  );
}
