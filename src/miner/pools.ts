// Pool resolution for the miner: a base58 address, or a name from a small table of the top Solana pools.
// Names that are not in the table are refused; the miner never guesses which pool was meant.

export interface KnownPool {
  address: string;
  dex: "Orca" | "Raydium" | "Meteora";
  /** Display pair, e.g. "SOL/USDC". */
  pair: string;
  /** Fee tier as written by the DEX, e.g. "0.04%". */
  fee: string;
  /** The default pool for "<dex> <pair>" when no fee tier is given. */
  primary?: boolean;
  /** Raydium only: which program. */
  kind?: string;
}

/** Top Solana pools by TVL on 2026-11-26, from each DEX's own API. */
export const KNOWN_POOLS: KnownPool[] = [
  { address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", dex: "Orca", pair: "SOL/USDC", fee: "0.04%", primary: true },
  { address: "Hp53XEtt4S8SvPCXarsLSdGfZBuUr5mMmZmX2DRNXQKp", dex: "Orca", pair: "SOL/JITOSOL", fee: "0.01%", primary: true },
  { address: "CeaZcxBNLpJWtxzt58qQmfMBtJY8pQLvursXTJYGQpbN", dex: "Orca", pair: "SOL/CBBTC", fee: "0.16%", primary: true },
  { address: "HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM", dex: "Orca", pair: "CBBTC/USDC", fee: "0.04%", primary: true },
  { address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", dex: "Raydium", pair: "SOL/USDC", fee: "0.25%", primary: true, kind: "amm" },
  { address: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", dex: "Raydium", pair: "SOL/USDC", fee: "0.04%", kind: "clmm" },
  { address: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6", dex: "Meteora", pair: "SOL/USDC", fee: "0.04%" },
  { address: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y", dex: "Meteora", pair: "SOL/USDC", fee: "0.1%", primary: true },
  { address: "BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh", dex: "Meteora", pair: "SOL/USDC", fee: "0.2%" },
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEXES = ["orca", "raydium", "meteora"] as const;

export type Resolved =
  | { ok: true; address: string; name?: string }
  | { ok: false; status: 400 | 404; reason: string };

/** Lowercase, WSOL counts as SOL, separators between the two tokens become "/". */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bwsol\b/g, "sol")
    .replace(/\bwrapped sol\b/g, "sol")
    .replace(/[\s_\-:,]+/g, " ")
    .replace(/\s*[\/\\]\s*/g, "/")
    .trim();
}

export function listPoolNames(): string[] {
  return KNOWN_POOLS.map((p) => `${p.dex} ${p.pair} ${p.fee}${p.kind ? ` (${p.kind})` : ""}`);
}

export function resolvePool(input: string): Resolved {
  const raw = input.trim();
  if (!raw) return { ok: false, status: 400, reason: "pool is empty; pass a Solana pool address or a name such as 'Orca SOL/USDC'" };
  if (raw.length > 256) return { ok: false, status: 400, reason: "pool is longer than 256 characters" };
  if (BASE58.test(raw)) {
    const known = KNOWN_POOLS.find((p) => p.address === raw);
    return { ok: true, address: raw, ...(known ? { name: `${known.dex} ${known.pair} ${known.fee}` } : {}) };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    return { ok: false, status: 400, reason: "that is an EVM address; this miner only reads Solana pools" };
  }
  let t = normalizeText(raw);
  const dex = DEXES.find((d) => t.includes(d));
  if (dex) t = t.replace(dex, "").trim();
  const fee = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (fee) t = t.replace(fee[0], "").trim();
  t = t.replace(/\b(pool|pair|lp|liquidity|amm|clmm|whirlpool|dlmm|cpmm)\b/g, "").replace(/\s+/g, " ").trim();
  const pair = t.replace(/ /g, "/").toUpperCase();
  const pairKey = pair.replace(/WSOL/g, "SOL");
  const flip = pairKey.split("/").reverse().join("/");
  let cands = KNOWN_POOLS.filter((p) => p.pair === pairKey || p.pair === flip);
  if (cands.length === 0) {
    return { ok: false, status: 404, reason: `unknown pool name '${raw}'; pass the pool address, or one of: ${listPoolNames().join("; ")}` };
  }
  if (dex) cands = cands.filter((p) => p.dex.toLowerCase() === dex);
  if (fee) cands = cands.filter((p) => Number(p.fee.replace("%", "")) === Number(fee[1]));
  if (cands.length === 1) return { ok: true, address: cands[0]!.address, name: `${cands[0]!.dex} ${cands[0]!.pair} ${cands[0]!.fee}` };
  if (cands.length === 0) {
    return { ok: false, status: 404, reason: `no known '${raw}' pool; known: ${listPoolNames().join("; ")}` };
  }
  // Several pools. A DEX was named without a fee tier: use that DEX's primary pool. A bare pair is ambiguous.
  if (dex && !fee) {
    const primary = cands.filter((p) => p.primary);
    if (primary.length === 1) return { ok: true, address: primary[0]!.address, name: `${primary[0]!.dex} ${primary[0]!.pair} ${primary[0]!.fee}` };
  }
  return {
    ok: false,
    status: 400,
    reason: `'${raw}' matches more than one pool; name the DEX and fee tier or pass the address: ${cands.map((p) => `${p.dex} ${p.pair} ${p.fee} ${p.address}`).join("; ")}`,
  };
}

/** Splits a pool name into its DEX, fee tier and token words, for the live pair search. Case is kept so mint addresses survive. */
export function parseAsk(input: string): { dex?: string; fee?: string; tokens: string[] } {
  let t = input.trim();
  const dex = DEXES.find((d) => t.toLowerCase().includes(d));
  if (dex) t = t.replace(new RegExp(dex, "i"), " ");
  const fee = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (fee) t = t.replace(fee[0], " ");
  const noise = new Set(["pool", "pair", "lp", "liquidity", "amm", "clmm", "whirlpool", "dlmm", "cpmm", "on", "solana", "of", "the", "and", "v2", "v3"]);
  const tokens = t.split(/[\s\/\_\-:,]+/).map((x) => x.replace(/^\$/, "")).filter((x) => x && !noise.has(x.toLowerCase())).map((x) => (/^wsol$/i.test(x) ? "SOL" : x));
  return { ...(dex ? { dex } : {}), ...(fee ? { fee: fee[1]! } : {}), tokens: [...new Set(tokens)] };
}

const SOLANA_NAMES = new Set(["solana", "sol", "solana-mainnet", "solana mainnet", "mainnet-beta", "solana-mainnet-beta", "solana mainnet-beta"]);
export function isSolanaChain(chain: string): boolean {
  return SOLANA_NAMES.has(chain.trim().toLowerCase());
}
