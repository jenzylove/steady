// Orca Whirlpool positions: position NFTs (classic and Token-2022) and position bundles, decoded from chain.
import type { Adapter, AdapterContext, AdapterResult, Position, Source } from "../types.js";
import {
  chainSource, apiSource, getTokenHoldings, getMultiple, getMintMeta, getPrices, getSymbols, pda,
  pk, u16, u64, u128, i32, clmmAmounts, priceFromSqrt, tickToPrice, JUP_PRICE_URL,
} from "./lib.js";
import { PublicKey } from "@solana/web3.js";

export const WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const POSITION_SIZE = 216;

export interface WhirlpoolPosition {
  address: string;
  whirlpool: string;
  positionMint: string;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  feeOwedA: bigint;
  feeOwedB: bigint;
  viaBundle?: string;
}
export interface WhirlpoolState {
  address: string;
  tickSpacing: number;
  feeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrent: number;
  mintA: string;
  vaultA: string;
  mintB: string;
  vaultB: string;
}

export function decodePosition(address: string, d: Buffer): WhirlpoolPosition {
  return {
    address,
    whirlpool: pk(d, 8),
    positionMint: pk(d, 40),
    liquidity: u128(d, 72),
    tickLower: i32(d, 88),
    tickUpper: i32(d, 92),
    feeOwedA: u64(d, 112),
    feeOwedB: u64(d, 136),
  };
}
export function decodeWhirlpool(address: string, d: Buffer): WhirlpoolState {
  return {
    address,
    tickSpacing: u16(d, 41),
    feeRate: u16(d, 45),
    liquidity: u128(d, 49),
    sqrtPrice: u128(d, 65),
    tickCurrent: i32(d, 81),
    mintA: pk(d, 101),
    vaultA: pk(d, 133),
    mintB: pk(d, 181),
    vaultB: pk(d, 213),
  };
}

export function positionPda(mint: string): string {
  return pda([Buffer.from("position"), new PublicKey(mint).toBuffer()], WHIRLPOOL_PROGRAM);
}
export function bundlePda(mint: string): string {
  return pda([Buffer.from("position_bundle"), new PublicKey(mint).toBuffer()], WHIRLPOOL_PROGRAM);
}
export function bundledPositionPda(bundleMint: string, index: number): string {
  return pda([Buffer.from("bundled_position"), new PublicKey(bundleMint).toBuffer(), Buffer.from(String(index))], WHIRLPOOL_PROGRAM);
}

export const orcaAdapter: Adapter = {
  id: "orca",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const { tokens, slot: tSlot } = await getTokenHoldings(ctx, wallet);

    // Position NFTs and bundle NFTs are 1 of 1 tokens with 0 decimals.
    const nfts = tokens.filter((t) => t.decimals === 0 && t.rawAmount === 1n);
    if (nfts.length === 0) return { positions, loans: [], gaps };

    const posKeys = nfts.map((n) => positionPda(n.mint));
    const bundleKeys = nfts.map((n) => bundlePda(n.mint));
    const { accounts: all, slot } = await getMultiple(ctx, [...posKeys, ...bundleKeys]);
    const found: WhirlpoolPosition[] = [];
    all.slice(0, nfts.length).forEach((a, i) => {
      if (a && a.owner === WHIRLPOOL_PROGRAM && a.data.length === POSITION_SIZE) found.push(decodePosition(posKeys[i]!, a.data));
    });

    // Position bundles: 256 bit bitmap at offset 40 says which bundled positions are open.
    const bundledKeys: { key: string; bundle: string }[] = [];
    all.slice(nfts.length).forEach((a, i) => {
      if (!a || a.owner !== WHIRLPOOL_PROGRAM) return;
      const bundleMint = nfts[i]!.mint;
      const bitmap = a.data.subarray(40, 72);
      for (let idx = 0; idx < 256; idx++) if (bitmap[idx >> 3]! & (1 << (idx & 7))) bundledKeys.push({ key: bundledPositionPda(bundleMint, idx), bundle: bundleMint });
    });
    if (bundledKeys.length) {
      const { accounts: bp } = await getMultiple(ctx, bundledKeys.map((b) => b.key));
      bp.forEach((a, i) => {
        if (a && a.owner === WHIRLPOOL_PROGRAM && a.data.length === POSITION_SIZE) {
          const p = decodePosition(bundledKeys[i]!.key, a.data);
          p.viaBundle = bundledKeys[i]!.bundle;
          found.push(p);
        }
      });
    }
    if (found.length === 0) return { positions, loans: [], gaps };

    const poolKeys = [...new Set(found.map((p) => p.whirlpool))];
    const { accounts: poolAccs, slot: poolSlot } = await getMultiple(ctx, poolKeys);
    const pools = new Map<string, WhirlpoolState>();
    poolAccs.forEach((a, i) => {
      if (a && a.owner === WHIRLPOOL_PROGRAM) pools.set(poolKeys[i]!, decodeWhirlpool(poolKeys[i]!, a.data));
      else gaps.push(`orca: whirlpool ${poolKeys[i]} could not be read`);
    });

    const mints = [...new Set([...pools.values()].flatMap((p) => [p.mintA, p.mintB]))];
    const [{ meta }, prices, symbols] = await Promise.all([getMintMeta(ctx, mints), getPrices(ctx, mints), getSymbols(ctx, mints)]);
    const priceSrc = apiSource(ctx, "price_api", JUP_PRICE_URL);

    for (const p of found) {
      const pool = pools.get(p.whirlpool);
      if (!pool) continue;
      if (p.liquidity === 0n && p.feeOwedA === 0n && p.feeOwedB === 0n) continue; // emptied position, nothing in it
      const mA = meta.get(pool.mintA), mB = meta.get(pool.mintB);
      if (!mA || !mB) {
        gaps.push(`orca: decimals for ${p.address} pool tokens unreadable`);
        continue;
      }
      const amt = clmmAmounts(p.liquidity, pool.sqrtPrice, p.tickLower, p.tickUpper, pool.tickCurrent);
      const amountA = amt.amountA / 10 ** mA.decimals;
      const amountB = amt.amountB / 10 ** mB.decimals;
      const feesA = Number(p.feeOwedA) / 10 ** mA.decimals;
      const feesB = Number(p.feeOwedB) / 10 ** mB.decimals;
      const pa = prices.get(pool.mintA), pb = prices.get(pool.mintB);
      const sources: Source[] = [chainSource(ctx, "getTokenAccountsByOwner", tSlot), chainSource(ctx, "getMultipleAccounts", Math.max(slot, poolSlot))];
      let usd: number | undefined;
      if (pa != null && pb != null) {
        usd = amountA * pa + amountB * pb;
        sources.push(priceSrc);
      } else if (p.liquidity === 0n) usd = 0;
      else gaps.push(`orca: no USD price for ${!pa ? pool.mintA : pool.mintB}; position ${p.address} left unvalued`);
      const sA = symbols.get(pool.mintA)!, sB = symbols.get(pool.mintB)!;
      positions.push({
        protocol: "orca",
        kind: "lp",
        account: p.address,
        mint: p.positionMint,
        symbol: `${sA}/${sB}`,
        amount: Number(p.liquidity),
        ...(usd !== undefined ? { usd } : {}),
        extra: {
          pool: pool.address,
          positionMint: p.positionMint,
          bundle: p.viaBundle,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          tickCurrent: pool.tickCurrent,
          priceLower: tickToPrice(p.tickLower, mA.decimals, mB.decimals),
          priceUpper: tickToPrice(p.tickUpper, mA.decimals, mB.decimals),
          priceCurrent: priceFromSqrt(pool.sqrtPrice, mA.decimals, mB.decimals),
          inRange: amt.inRange,
          liquidity: p.liquidity.toString(),
          tokenA: { mint: pool.mintA, symbol: sA, amount: amountA, uncollectedFees: feesA },
          tokenB: { mint: pool.mintB, symbol: sB, amount: amountB, uncollectedFees: feesB },
          feeRate: pool.feeRate / 1_000_000,
          note: "uncollectedFees is the last checkpointed owed amount; fees accrued since the last update are not included",
        },
        sources,
      });
    }
    return { positions, loans: [], gaps };
  },
};
