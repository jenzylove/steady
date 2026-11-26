"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { call, type LedgerEntry } from "@/lib/api";
import { relative, when } from "@/lib/format";

export default function LedgerPreview() {
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    call<{ entries: LedgerEntry[] }>("/ledger", { timeoutMs: 20000 }).then((d) => setRows(d.entries)).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="mute">The ledger could not load right now: {err}</p>;
  if (!rows) return <p className="mute"><span className="live-dot" /> Loading the ledger</p>;
  if (!rows.length) return <p className="mute">No predictions have been made yet.</p>;
  const settled = rows.filter((r) => r.prediction.outcome).length;
  const pick = [...rows].sort((a, b) => a.prediction.settleAt.localeCompare(b.prediction.settleAt)).filter((_, k, arr) => k % Math.max(1, Math.floor(arr.length / 4)) === 0).slice(0, 4);
  return (
    <div>
      <p className="ink2" style={{ marginBottom: 20 }}>
        <span className="mono" style={{ color: "var(--ink)" }}>{rows.length}</span> signed calls made before the outcome. <span className="mono" style={{ color: "var(--ink)" }}>{settled}</span> settled so far.
      </p>
      <ul className="ledger-mini">
        {pick.map((e) => (
          <li key={e.prediction.id}>
            <span className={`tag ${e.prediction.steady.verdict ? "vial" : "warn"}`}>{e.prediction.steady.verdict ? "Steady: yes" : "Steady: no"}</span>
            <span className="claim">{e.prediction.claim}</span>
            <span className="mono mute when">{e.prediction.outcome ? `settled ${when(e.prediction.outcome.settledAt)}` : `settles ${relative(e.prediction.settleAt)}`}</span>
          </li>
        ))}
      </ul>
      <Link href="/proof" className="btn btn-ghost" style={{ marginTop: 28, textDecoration: "none" }}><span className="bub" /> Open the whole ledger</Link>
    </div>
  );
}
