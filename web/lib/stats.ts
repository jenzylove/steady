"use client";
import { useEffect, useState } from "react";
import { call } from "./api";

type Down = { ok: false; error: string; at: string };
export interface Stats {
  at: string;
  registration: number;
  ledger: ({ ok: true; at: string; predictions: number; open: number; settled: number; overdue: number; nextSettleAt: string | null; lastMadeAt: string | null; steadyHits: number; frontierAnswered: number; frontierSettled: number; frontierHits: number; signedMemos: number }) | Down;
  api: { ok: true; at: string; countingSince: string; bootedAt: string; memosSigned: number; telegraphPurchases: number; telegraphSpendUsd: number; walletChecks: number; txChecks: number; fixesBuilt: number; spendTodayUsd: number; capTodayUsd: number };
  bot: ({ ok: true; at: string; chats: number; walletsWatched: number; sweepEveryMin: number; lastSweepAt: string | null; sweeps: number; walletsSwept: number; alertsSent: number; reportsSent: number; telegraphPurchases: number; telegraphSpendUsd: number; countingSince: string }) | Down;
  miner: ({ ok: true; at: string; since: string; answers: number; refused: number; boardReads: number; lastAnswerAt: string | null }) | Down;
  node: ({ ok: true; at: string; found: true; id: string; status: string; registeredAt: string | null; requestsServed: number; scored: boolean; rank: number | null; score: number | null; epoch: number | null; rivals: number } | { ok: true; at: string; found: false; rivals: number }) | Down;
  evaluator: ({ ok: true; at: string; rows: number; eligible: number; byIntent: Record<string, number>; lastAt: string | null }) | Down;
}

/** Live /stats, refreshed every `everyMs`. */
export function useStats(everyMs = 30_000) {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => call<Stats>("/stats", { timeoutMs: 30_000 }).then((d) => { if (alive) { setS(d); setErr(""); } }).catch((e) => alive && setErr((e as Error).message));
    load();
    const t = setInterval(load, everyMs);
    return () => { alive = false; clearInterval(t); };
  }, [everyMs]);
  return { s, err };
}

/** "4 min ago", "in 3 h": short, for times next to live numbers. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "not yet";
  const ms = now - Date.parse(iso);
  if (ms < 0 && ms > -120_000) return "just now"; // server clock a little ahead of this device
  const a = Math.abs(ms);
  const label = a < 60_000 ? `${Math.max(1, Math.round(a / 1000))} s` : a < 3.6e6 ? `${Math.round(a / 60_000)} min` : a < 172.8e6 ? `${Math.round(a / 3.6e6)} h` : `${Math.round(a / 86.4e6)} days`;
  return ms >= 0 ? `${label} ago` : `in ${label}`;
}
