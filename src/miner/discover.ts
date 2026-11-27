// Finds Solana pools for a token pair from DexScreener's public pair list, so a pair name that is
// not in the small table (for example "BONK/USDC" or "JLP SOL") can still be answered.
// Tokens must be well known symbols or mint addresses: DexScreener lists look alike tokens
// with fake liquidity, so the match is on mint address, never on the displayed symbol.

export const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  JLP: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  CBBTC: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
  WBTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A token as written in a pool name: a known symbol or a mint address. */
export function tokenMint(t: string): string | undefined {
  const s = t.replace(/^\$/, "");
  if (BASE58.test(s)) return s;
  return TOKEN_MINTS[s.toUpperCase()];
}

interface DsPair { dexId?: string; pairAddress?: string; baseToken?: { address?: string }; quoteToken?: { address?: string }; liquidity?: { usd?: number } }
export type GetJson = (url: string) => Promise<unknown>;

const defaultGet: GetJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`pool list answered ${r.status}`);
  return r.json();
};

/** Pool addresses on Orca, Raydium and Meteora holding every given mint, deepest first (at most 6). */
export async function discoverPools(mints: string[], dex: string | undefined, get: GetJson = defaultGet): Promise<string[]> {
  const lists = await Promise.all(mints.map(async (m) => {
    try { const j = await get(`https://api.dexscreener.com/token-pairs/v1/solana/${m}`); return Array.isArray(j) ? (j as DsPair[]) : []; } catch { return [] as DsPair[]; }
  }));
  const seen = new Map<string, DsPair>();
  for (const p of lists.flat()) if (p.pairAddress) seen.set(p.pairAddress, p);
  const ok = (p: DsPair) => {
    const id = (p.dexId ?? "").toLowerCase();
    if (!["orca", "raydium", "meteora"].includes(id) || (dex && id !== dex)) return false;
    const held = [p.baseToken?.address, p.quoteToken?.address];
    return mints.every((m) => held.includes(m));
  };
  return [...seen.values()].filter(ok).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)).slice(0, 6).map((p) => p.pairAddress!);
}
