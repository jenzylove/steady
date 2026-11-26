// Contracts for phase 2: findings (risks and opportunities), fixes, predictions. Code decides; a model only phrases.
import type { Source } from "../types.js";

export type FindingKind = "risk" | "opportunity";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** A paid Telegraph answer kept as evidence (from src/telegraph/client.ts Answer). */
export interface Evidence {
  intent: string;
  minerId?: string | undefined;
  minerName?: string | undefined;
  role?: "answer" | "verify" | "compare" | undefined;
  used: boolean;
  rejectReason?: string | undefined;
  signalHash?: string | undefined;
  receiptHash?: string | undefined;
  costUsd?: number | undefined;
  summary: string; // one line of what it said
}

export type FixAction = "repay" | "deposit" | "withdraw" | "revoke" | "swap" | "move";

export interface FixSpec {
  action: FixAction;
  protocol: string; // "kamino", "marginfi", "save", "wallet", "jupiter"
  account?: string; // obligation or token account
  mintIn?: string;
  mintOut?: string;
  amount: number; // UI amount of mintIn (or of the token being repaid or deposited)
  reason: string;
  /** Health or other key metric before and after, from simulation when available. */
  expected?: { metric: string; before: number; after: number };
}

export interface Finding {
  id: string; // stable: `${kind}:${code}:${account or mint}`
  kind: FindingKind;
  code: string; // e.g. "liquidation_near", "depeg", "concentration", "live_delegation", "protocol_alert", "exit_thin", "better_rate", "stale_protocol"
  severity: Severity;
  title: string; // short, plain words
  numbers: Record<string, number | string>; // the computed figures behind the finding
  sources: Source[]; // chain and API reads
  evidence: Evidence[]; // Telegraph answers used or rejected
  fix?: FixSpec | undefined;
}

export interface Advice {
  wallet: string;
  at: string; // ISO
  totalUsd: number;
  findings: Finding[];
  gaps: string[];
  costUsd: number; // Telegraph spend for this run
  /** Every Telegraph answer bought that did not become a finding, used or rejected, kept as evidence. */
  checks?: Evidence[] | undefined;
}

/** A short horizon call that settles from Steady's own mainnet reads. */
export type PredictionKind = "liquidation_distance" | "rate_drift" | "peg_band" | "exit_at_size";

export interface Prediction {
  id: string;
  kind: PredictionKind;
  wallet?: string | undefined;
  subject: string; // obligation, reserve, mint or pool
  claim: string; // plain words, e.g. "USDC supply APY on Kamino main stays between 4.0% and 6.0% for 72 hours"
  params: Record<string, number | string>; // band, size, threshold
  madeAt: string; // ISO
  settleAt: string; // ISO
  steady: { verdict: boolean; value: number; why: string };
  frontier?: { model: string; verdict: boolean; value?: number | undefined; why: string } | undefined;
  /** Second control: the same model given the same numbers Steady read at call time (not Steady's verdict or history). */
  frontierInformed?: { model: string; verdict: boolean; value?: number | undefined; why: string } | undefined;
  outcome?: { verdict: boolean; value: number; settledAt: string; source: Source } | undefined;
  usdAtStake?: number | undefined;
}
