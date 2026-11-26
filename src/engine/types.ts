// Shared interfaces for Steady's wallet engine. Adapters read Solana mainnet only; they never sign or send.

export type PositionKind = "token" | "stake" | "lend" | "borrow" | "lp" | "perp" | "delegation";

/** Where a number came from, so every figure in a memo can be traced. */
export interface Source {
  kind: "chain" | "protocol_api" | "price_api";
  /** RPC method or URL used (never include API keys in this string). */
  ref: string;
  /** Solana slot of the read when kind is "chain". */
  slot?: number;
  fetchedAt: string; // ISO time
}

export interface Position {
  protocol: string; // e.g. "wallet", "jito", "kamino", "marginfi", "save", "orca", "raydium", "meteora", "drift", "jupiter-perps"
  kind: PositionKind;
  account?: string; // the on chain account that holds the position
  mint?: string;
  symbol?: string;
  amount: number; // UI amount (decimals applied)
  usd?: number; // value in USD if priced
  /** Protocol specific facts, e.g. LP range, perp leverage, delegate program. */
  extra?: Record<string, unknown>;
  sources: Source[];
}

export interface LoanLeg {
  mint: string;
  symbol: string;
  amount: number;
  usd: number;
  /** Collateral: liquidation threshold as a fraction (e.g. 0.85). Borrow: borrow factor (1 if none). */
  factor: number;
}

/** A lending obligation (Kamino obligation, marginfi account, Save obligation). */
export interface LoanAccount {
  protocol: string;
  account: string;
  collaterals: LoanLeg[];
  borrows: LoanLeg[];
  /** What the protocol itself reports (its API or UI math), used to test our own math. */
  protocolReported?: { healthFactor?: number; ltv?: number; liquidationLtv?: number };
  sources: Source[];
}

export interface AdapterContext {
  heliusRpcUrl: string; // https://mainnet.helius-rpc.com/?api-key=...
  fetch: typeof fetch;
  now: () => Date;
}

export interface AdapterResult {
  positions: Position[];
  loans: LoanAccount[];
  /** Any part the adapter could not read, stated plainly (never guessed). */
  gaps: string[];
}

export interface Adapter {
  id: string;
  read(wallet: string, ctx: AdapterContext): Promise<AdapterResult>;
}
