"use client";
import { SIGNAL_URL, type Evidence, type Source } from "@/lib/api";
import { short, usd } from "@/lib/format";

const ROLE: Record<string, string> = { answer: "Answer", verify: "Verify", compare: "Compare" };
const INTENT = (s: string) => s.replace(/_GENERAL$/, "").replace(/_/g, " ").toLowerCase();

export function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items.length) return <p className="mute" style={{ fontSize: 14 }}>No Telegraph answers were needed for this one. Every number came from the chain and the protocol itself.</p>;
  return (
    <ul className="ev">
      {items.map((e, k) => (
        <li key={`${e.signalHash ?? k}-${k}`}>
          <div className="ev-head">
            <span className={`tag ${e.used ? "vial" : "risk"}`}>{e.used ? "Used" : "Rejected"}</span>
            {e.role && <span className="tag">{ROLE[e.role] ?? e.role}</span>}
            <span style={{ fontWeight: 600 }}>{(e.minerName ?? (e.minerId ? `Miner ${e.minerId}` : "Unknown miner")).replace(/\s*[—–]\s*/g, ": ")}</span>
            <span className="mute" style={{ fontSize: 13 }}>asked about {INTENT(e.intent)}</span>
          </div>
          {!e.used && e.rejectReason && <p style={{ color: "var(--risk)", fontSize: 14, marginTop: 6 }}>Why rejected: {e.rejectReason}</p>}
          <p className={`ink2 ${e.used ? "" : "dim"}`} style={{ fontSize: 14, marginTop: 6 }}>{e.summary.length > 260 ? e.summary.slice(0, 260) + "…" : e.summary}</p>
          <div className="ev-meta">
            {e.signalHash && <a className="hash" href={SIGNAL_URL(e.signalHash)} target="_blank" rel="noreferrer">signal {short(e.signalHash, 6, 4)}</a>}
            {e.receiptHash && <span className="mono mute" style={{ fontSize: 12 }}>receipt {short(e.receiptHash, 6, 4)}</span>}
            {typeof e.costUsd === "number" && <span className="mono mute" style={{ fontSize: 12 }}>cost {usd(e.costUsd)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const KIND: Record<string, string> = { chain: "Solana mainnet", protocol_api: "Protocol's own API", price_api: "Price source" };

export function SourceList({ items }: { items: Source[] }) {
  return (
    <ul className="src">
      {items.map((s, k) => (
        <li key={k}>
          <span className="tag">{KIND[s.kind] ?? s.kind}</span>
          <span className="mono" style={{ fontSize: 12, wordBreak: "break-all" }}>{s.ref}</span>
          {s.slot ? <span className="mono mute" style={{ fontSize: 12 }}>slot {s.slot.toLocaleString("en-US")}</span> : null}
        </li>
      ))}
    </ul>
  );
}
