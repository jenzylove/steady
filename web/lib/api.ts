// Client for the Steady API. Shapes mirror src/engine/advice/types.ts and src/presign/check.ts.
export const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8788").replace(/\/$/, "");
export const MINER_BASE = "https://steady-miner-production.up.railway.app";
export const SIGNAL_URL = (h: string) => `https://devnode.telegraphprotocol.com/engine/v1/signal/${h}`;
export const SOLSCAN_TX = (s: string) => `https://solscan.io/tx/${s}`;
export const SOLSCAN_ACCOUNT = (a: string) => `https://solscan.io/account/${a}`;
export const SAMPLE_WALLET = "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";

export interface Source { kind: "chain" | "protocol_api" | "price_api"; ref: string; slot?: number; fetchedAt: string }
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export interface Evidence {
  intent: string; minerId?: string; minerName?: string; role?: "answer" | "verify" | "compare";
  used: boolean; rejectReason?: string; signalHash?: string; receiptHash?: string; costUsd?: number; summary: string;
}
export type FixAction = "repay" | "deposit" | "withdraw" | "revoke" | "swap" | "move";
export interface FixSpec {
  action: FixAction; protocol: string; account?: string; mintIn?: string; mintOut?: string; amount: number; reason: string;
  expected?: { metric: string; before: number; after: number };
}
export interface Finding {
  id: string; kind: "risk" | "opportunity"; code: string; severity: Severity; title: string;
  numbers: Record<string, number | string>; sources: Source[]; evidence: Evidence[]; fix?: FixSpec;
}
export interface Advice { wallet: string; at: string; totalUsd: number; findings: Finding[]; gaps: string[]; costUsd: number; checks?: Evidence[]; reusedAnswers?: number }
export interface Signed<T> { body: T; digest: string; signer: string; signature: string }
export interface Simulation { ok: boolean; err?: string; unitsConsumed?: number; logsTail: string[] }
export interface BuiltFix { fix: FixSpec; transaction?: string; simulation?: Simulation; unsupported?: string; builder: string; summary?: string }
export interface BalanceChange { mint: string; symbol?: string; delta: number }
export interface PresignResult {
  verdict: "ok" | "caution" | "block"; reasons: string[];
  simulation: { ok: boolean; err?: string; logsTail: string[] };
  signerChanges: BalanceChange[]; ownerChanges: string[]; programs: string[]; recipients: string[]; evidence: Evidence[];
}
export type PredictionKind = "liquidation_distance" | "rate_drift" | "peg_band" | "exit_at_size";
export interface Prediction {
  id: string; kind: PredictionKind; wallet?: string; subject: string; claim: string;
  params: Record<string, number | string>; madeAt: string; settleAt: string;
  steady: { verdict: boolean; value: number; why: string };
  frontier?: { model: string; verdict: boolean; value?: number; why: string };
  frontierInformed?: { model: string; verdict: boolean; value?: number; why: string };
  outcome?: { verdict: boolean; value: number; settledAt: string; source: Source };
  usdAtStake?: number;
}
export interface LedgerEntry {
  prediction: Prediction; memo: Signed<Prediction>;
  settlement?: Signed<{ predictionId: string; predictionDigest: string; settledAt: string; outcome: Prediction["outcome"]; score: { steady: { hit: boolean; absError?: number }; frontier?: { hit: boolean; absError?: number } } }>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Fetch JSON from the Steady API with a plain words error for every failure. */
export async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, signal: ctrl.signal, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch (e) {
    clearTimeout(t);
    if ((e as Error).name === "AbortError") throw new ApiError("Steady took too long to answer. Try again in a moment.", 0);
    throw new ApiError(`Steady's API did not answer at ${API}. It may be offline.`, 0);
  }
  clearTimeout(t);
  let data: any = null;
  try { data = await res.json(); } catch { /* non JSON */ }
  if (!res.ok) {
    const msg = data?.error ? String(data.error) : `HTTP ${res.status}`;
    if (res.status === 429) throw new ApiError(`You have used today's free checks (${msg}). Come back tomorrow.`, 429);
    if (res.status === 400) throw new ApiError(msg === "not a Solana address" ? "That is not a Solana wallet address." : msg, 400);
    throw new ApiError(`Steady hit a problem: ${msg}`, res.status);
  }
  return data as T;
}

export const post = <T,>(path: string, body: unknown, timeoutMs?: number) => call<T>(path, { method: "POST", body: JSON.stringify(body), timeoutMs });

export function isLikelyAddress(s: string): boolean { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim()); }

// Steady Guard (src/guard/guard.ts). The API never returns the signed bytes, only a flag.
export interface GuardCheck { symbol: string; oracle: number; market?: number; agreed: boolean; signals: string[] }
export interface GuardEvent { at: string; kind: string; note: string; signature?: string }
export interface GuardInfo {
  wallet: string; obligation: string; line: number; status: "prepared" | "armed" | "fired" | "failed" | "stale" | "cancelled";
  summary: string; lastHealth?: number; lastCheckedAt?: string; firedSignature?: string; events: GuardEvent[];
  lastEarly?: { at: string; chainHealth: number; projected: number; fire: boolean; costUsd: number; checks: GuardCheck[] };
}
