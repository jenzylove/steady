// Raydium: CLMM personal positions (position NFTs, classic or Token-2022) and standard AMM / CPMM LP tokens, read from chain.
import { PublicKey } from "@solana/web3.js";
import type { Adapter, AdapterContext, AdapterResult, Position, Source } from "../types.js";
import {
  chainSource, apiSource, getTokenHoldings, getMultiple, getMintMeta, getPrices, getSymbols, pda,
  pk, u8, u16, u64, u128, i32, clmmAmounts, priceFromSqrt, tickToPrice, JUP_PRICE_URL,
} from "./lib.js";

export const RAYDIUM_CLMM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
export const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
export const RAYDIUM_CPMM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
// PDAs that are the mint authority of LP tokens: this is how an LP mint is recognised on chain.
const AMM_V4_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const CPMM_AUTHORITY = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";
const RAYDIUM_LPS_API = "https://api-v3.raydium.io/pools/info/lps";

export function personalPositionPda(nftMint: string): string {
  return pda([Buffer.from("position"), new PublicKey(nftMint).toBuffer()], RAYDIUM_CLMM);
}

export interface ClmmPersonalPosition {
  address: string;
  nftMint: string;
  pool: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feesOwed0: bigint;
  feesOwed1: bigint;
}
export interface ClmmPool {
  address: string;
  mint0: string;
  mint1: string;
  decimals0: number;
  decimals1: number;
  tickSpacing: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrent: number;
}
export function decodePersonalPosition(address: string, d: Buffer): ClmmPersonalPosition {
  return {
    address,
    nftMint: pk(d, 9),
    pool: pk(d, 41),
    tickLower: i32(d, 73),
    tickUpper: i32(d, 77),
    liquidity: u128(d, 81),
    feesOwed0: u64(d, 129),
    feesOwed1: u64(d, 137),
  };
}
export function decodeClmmPool(address: string, d: Buffer): ClmmPool {
  return {
    address,
    mint0: pk(d, 73),
    mint1: pk(d, 105),
    decimals0: u8(d, 233),
    decimals1: u8(d, 234),
    tickSpacing: u16(d, 235),
    liquidity: u128(d, 237),
    sqrtPrice: u128(d, 253),
    tickCurrent: i32(d, 269),
  };
}

/** Standard AMM v4 pool: vaults, mints, lp mint. */
export function decodeAmmV4(d: Buffer) {
  return { baseVault: pk(d, 336), quoteVault: pk(d, 368), baseMint: pk(d, 400), quoteMint: pk(d, 432), lpMint: pk(d, 464) };
}
/** CPMM pool: vaults, mints, fees withheld from reserves, lp supply. */
export function decodeCpmm(d: Buffer) {
  return {
    vault0: pk(d, 72), vault1: pk(d, 104), lpMint: pk(d, 136), mint0: pk(d, 168), mint1: pk(d, 200),
    dec0: u8(d, 331), dec1: u8(d, 332), lpSupply: u64(d, 333),
    withheld0: u64(d, 341) + u64(d, 357), withheld1: u64(d, 349) + u64(d, 365),
  };
}

export const raydiumAdapter: Adapter = {
  id: "raydium",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const { tokens, slot: tSlot } = await getTokenHoldings(ctx, wallet);
    const tokSrc = chainSource(ctx, "getTokenAccountsByOwner", tSlot);

    // ---------- CLMM ----------
    const nfts = tokens.filter((t) => t.decimals === 0 && t.rawAmount === 1n);
    const clmm: ClmmPersonalPosition[] = [];
    if (nfts.length) {
      const keys = nfts.map((n) => personalPositionPda(n.mint));
      const { accounts } = await getMultiple(ctx, keys);
      accounts.forEach((a, i) => {
        if (a && a.owner === RAYDIUM_CLMM && a.data.length >= 145) clmm.push(decodePersonalPosition(keys[i]!, a.data));
      });
    }
    const fungible = tokens.filter((t) => t.decimals > 0);

    // ---------- LP token candidates: mint authority is the Raydium pool authority ----------
    const { accounts: mintAccs, slot: mSlot } = await getMultiple(ctx, fungible.map((t) => t.mint));
    const lpHeld: { tok: (typeof fungible)[number]; kind: "amm" | "cpmm"; supply: bigint }[] = [];
    mintAccs.forEach((a, i) => {
      if (!a || a.data.length < 82 || a.data.readUInt32LE(0) !== 1) return;
      const auth = pk(a.data, 4);
      if (auth === AMM_V4_AUTHORITY) lpHeld.push({ tok: fungible[i]!, kind: "amm", supply: u64(a.data, 36) });
      else if (auth === CPMM_AUTHORITY) lpHeld.push({ tok: fungible[i]!, kind: "cpmm", supply: u64(a.data, 36) });
    });

    // ---------- pool reads ----------
    const clmmPoolKeys = [...new Set(clmm.map((p) => p.pool))];
    const { accounts: cpAcc, slot: cpSlot } = await getMultiple(ctx, clmmPoolKeys);
    const pools = new Map<string, ClmmPool>();
    cpAcc.forEach((a, i) => {
      if (a && a.owner === RAYDIUM_CLMM) pools.set(clmmPoolKeys[i]!, decodeClmmPool(clmmPoolKeys[i]!, a.data));
      else gaps.push(`raydium: CLMM pool ${clmmPoolKeys[i]} unreadable`);
    });

    // LP mint -> pool address through Raydium's public index (only LP mints are sent, never the wallet).
    const lpPool = new Map<string, string>();
    if (lpHeld.length) {
      try {
        const res = await ctx.fetch(`${RAYDIUM_LPS_API}?lps=${lpHeld.map((l) => l.tok.mint).join(",")}`);
        const j: any = await res.json();
        for (const p of j.data ?? []) if (p?.lpMint?.address) lpPool.set(p.lpMint.address, p.id);
      } catch (e) {
        gaps.push(`raydium: LP mint to pool lookup failed (${(e as Error).message})`);
      }
    }
    const lpPoolKeys = lpHeld.map((l) => lpPool.get(l.tok.mint)).filter((x): x is string => !!x);
    for (const l of lpHeld) if (!lpPool.has(l.tok.mint)) gaps.push(`raydium: pool for LP mint ${l.tok.mint} not found`);
    const { accounts: lpAcc, slot: lpSlot } = await getMultiple(ctx, lpPoolKeys);
    const lpPoolData = new Map(lpPoolKeys.map((k, i) => [k, lpAcc[i]] as const));

    // vaults for standard pools
    const vaultKeys: string[] = [];
    for (const l of lpHeld) {
      const acc = lpPoolData.get(lpPool.get(l.tok.mint) ?? "");
      if (!acc) continue;
      if (l.kind === "amm") { const p = decodeAmmV4(acc.data); vaultKeys.push(p.baseVault, p.quoteVault); }
      else { const p = decodeCpmm(acc.data); vaultKeys.push(p.vault0, p.vault1); }
    }
    const { accounts: vaultAccs, slot: vSlot } = await getMultiple(ctx, vaultKeys);
    const vaultBal = new Map(vaultKeys.map((k, i) => [k, vaultAccs[i] ? u64(vaultAccs[i]!.data, 64) : null] as const));

    // ---------- pricing ----------
    const allMints = new Set<string>();
    pools.forEach((p) => { allMints.add(p.mint0); allMints.add(p.mint1); });
    for (const l of lpHeld) {
      const acc = lpPoolData.get(lpPool.get(l.tok.mint) ?? "");
      if (!acc) continue;
      if (l.kind === "amm") { const p = decodeAmmV4(acc.data); allMints.add(p.baseMint); allMints.add(p.quoteMint); }
      else { const p = decodeCpmm(acc.data); allMints.add(p.mint0); allMints.add(p.mint1); }
    }
    const mintList = [...allMints];
    const [prices, symbols, { meta }] = await Promise.all([getPrices(ctx, mintList), getSymbols(ctx, mintList), getMintMeta(ctx, mintList)]);
    const priceSrc = apiSource(ctx, "price_api", JUP_PRICE_URL);

    // ---------- CLMM positions ----------
    for (const p of clmm) {
      const pool = pools.get(p.pool);
      if (!pool) continue;
      if (p.liquidity === 0n && p.feesOwed0 === 0n && p.feesOwed1 === 0n) continue; // emptied position, nothing in it
      const amt = clmmAmounts(p.liquidity, pool.sqrtPrice, p.tickLower, p.tickUpper, pool.tickCurrent);
      const a0 = amt.amountA / 10 ** pool.decimals0, a1 = amt.amountB / 10 ** pool.decimals1;
      const p0 = prices.get(pool.mint0), p1 = prices.get(pool.mint1);
      const sources: Source[] = [tokSrc, chainSource(ctx, "getMultipleAccounts", Math.max(cpSlot, mSlot))];
      let usd: number | undefined;
      if (p0 != null && p1 != null) { usd = a0 * p0 + a1 * p1; sources.push(priceSrc); }
      else if (p.liquidity === 0n) usd = 0;
      else gaps.push(`raydium: no USD price for ${p0 == null ? pool.mint0 : pool.mint1}; CLMM position ${p.address} left unvalued`);
      const s0 = symbols.get(pool.mint0)!, s1 = symbols.get(pool.mint1)!;
      positions.push({
        protocol: "raydium", kind: "lp", account: p.address, mint: p.nftMint, symbol: `${s0}/${s1}`,
        amount: Number(p.liquidity), ...(usd !== undefined ? { usd } : {}),
        extra: {
          type: "clmm", pool: pool.address, positionMint: p.nftMint,
          tickLower: p.tickLower, tickUpper: p.tickUpper, tickCurrent: pool.tickCurrent,
          priceLower: tickToPrice(p.tickLower, pool.decimals0, pool.decimals1),
          priceUpper: tickToPrice(p.tickUpper, pool.decimals0, pool.decimals1),
          priceCurrent: priceFromSqrt(pool.sqrtPrice, pool.decimals0, pool.decimals1),
          inRange: amt.inRange, liquidity: p.liquidity.toString(),
          token0: { mint: pool.mint0, symbol: s0, amount: a0, uncollectedFees: Number(p.feesOwed0) / 10 ** pool.decimals0 },
          token1: { mint: pool.mint1, symbol: s1, amount: a1, uncollectedFees: Number(p.feesOwed1) / 10 ** pool.decimals1 },
          note: "uncollectedFees is the last checkpointed owed amount; fees accrued since the last update are not included",
        },
        sources,
      });
    }

    // ---------- standard LP tokens ----------
    for (const l of lpHeld) {
      const poolKey = lpPool.get(l.tok.mint);
      const acc = poolKey ? lpPoolData.get(poolKey) : null;
      if (!poolKey || !acc) continue;
      let mintX: string, mintY: string, vx: string, vy: string, withheldX = 0n, withheldY = 0n;
      if (l.kind === "amm") { const p = decodeAmmV4(acc.data); mintX = p.baseMint; mintY = p.quoteMint; vx = p.baseVault; vy = p.quoteVault; }
      else { const p = decodeCpmm(acc.data); mintX = p.mint0; mintY = p.mint1; vx = p.vault0; vy = p.vault1; withheldX = p.withheld0; withheldY = p.withheld1; }
      const bx = vaultBal.get(vx), by = vaultBal.get(vy);
      const mX = meta.get(mintX), mY = meta.get(mintY);
      if (bx == null || by == null || !mX || !mY || l.supply === 0n) { gaps.push(`raydium: reserves of pool ${poolKey} unreadable`); continue; }
      const share = Number(l.tok.rawAmount) / Number(l.supply);
      const ax = (Number(bx - withheldX) * share) / 10 ** mX.decimals;
      const ay = (Number(by - withheldY) * share) / 10 ** mY.decimals;
      const px = prices.get(mintX), py = prices.get(mintY);
      const sources: Source[] = [tokSrc, chainSource(ctx, "getMultipleAccounts", Math.max(lpSlot, vSlot, mSlot))];
      let usd: number | undefined;
      if (px != null && py != null) { usd = ax * px + ay * py; sources.push(priceSrc); }
      else gaps.push(`raydium: no USD price for ${px == null ? mintX : mintY}; LP ${l.tok.mint} left unvalued`);
      const sx = symbols.get(mintX)!, sy = symbols.get(mintY)!;
      positions.push({
        protocol: "raydium", kind: "lp", account: l.tok.tokenAccount, mint: l.tok.mint, symbol: `${sx}/${sy}`,
        amount: l.tok.uiAmount, ...(usd !== undefined ? { usd } : {}),
        extra: {
          type: l.kind === "amm" ? "standard-amm-v4" : "cpmm", pool: poolKey,
          shareOfPool: share,
          tokenX: { mint: mintX, symbol: sx, amount: ax }, tokenY: { mint: mintY, symbol: sy, amount: ay },
          note: l.kind === "amm" ? "amounts use vault balances; funds parked in the pool's OpenBook orders are not counted" : undefined,
        },
        sources,
      });
    }
    return { positions, loans: [], gaps };
  },
};
