// poolLiquidityUsd: TVL of an Orca, Raydium or Meteora pool from chain (vault balances times Jupiter prices).
import type { AdapterContext, Source } from "../types.js";
import { apiSource, chainSource, getMintMeta, getMultiple, getPrices, getSymbols, JUP_PRICE_URL, pk, u64, type RawAccount } from "../adapters/lib.js";
import { decodeWhirlpool, WHIRLPOOL_PROGRAM } from "../adapters/orca.js";
import { decodeAmmV4, decodeClmmPool, decodeCpmm, RAYDIUM_AMM_V4, RAYDIUM_CLMM, RAYDIUM_CPMM } from "../adapters/raydium.js";

export const METEORA_DLMM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

export type PoolDex = "orca-whirlpool" | "raydium-clmm" | "raydium-amm-v4" | "raydium-cpmm" | "meteora-dlmm";

export interface PoolSide {
  mint: string;
  symbol: string;
  vault: string;
  amount: number; // UI units held by the pool (withheld fees removed where the program tracks them)
  usd: number | null;
}
export interface PoolLiquidity {
  pool: string;
  dex: PoolDex;
  /** Sum of both sides; null when a side could not be priced (never a partial guess). */
  usd: number | null;
  tokenA: PoolSide;
  tokenB: PoolSide;
  sources: Source[];
  gaps: string[];
}

interface Layout {
  dex: PoolDex;
  mintA: string;
  mintB: string;
  vaultA: string;
  vaultB: string;
  withheldA?: bigint;
  withheldB?: bigint;
}

export function parsePool(owner: string, data: Buffer): Layout | null {
  if (owner === WHIRLPOOL_PROGRAM) {
    const p = decodeWhirlpool("", data);
    return { dex: "orca-whirlpool", mintA: p.mintA, mintB: p.mintB, vaultA: p.vaultA, vaultB: p.vaultB };
  }
  if (owner === RAYDIUM_CLMM) {
    const p = decodeClmmPool("", data);
    return { dex: "raydium-clmm", mintA: p.mint0, mintB: p.mint1, vaultA: pk(data, 137), vaultB: pk(data, 169) };
  }
  if (owner === RAYDIUM_AMM_V4) {
    const p = decodeAmmV4(data);
    return { dex: "raydium-amm-v4", mintA: p.baseMint, mintB: p.quoteMint, vaultA: p.baseVault, vaultB: p.quoteVault };
  }
  if (owner === RAYDIUM_CPMM) {
    const p = decodeCpmm(data);
    return { dex: "raydium-cpmm", mintA: p.mint0, mintB: p.mint1, vaultA: p.vault0, vaultB: p.vault1, withheldA: p.withheld0, withheldB: p.withheld1 };
  }
  if (owner === METEORA_DLMM) {
    return { dex: "meteora-dlmm", mintA: pk(data, 88), mintB: pk(data, 120), vaultA: pk(data, 152), vaultB: pk(data, 184) };
  }
  return null;
}

/** Read a pool account and return its two token reserves with USD values. Throws if the account is not a supported pool. */
export async function poolLiquidity(ctx: AdapterContext, pool: string): Promise<PoolLiquidity> {
  const gaps: string[] = [];
  const { accounts: [acc], slot: s1 } = await getMultiple(ctx, [pool]);
  if (!acc) throw new Error(`pool ${pool} not found`);
  const layout = parsePool(acc.owner, acc.data);
  if (!layout) throw new Error(`pool ${pool} is owned by ${acc.owner}, not an Orca, Raydium or Meteora pool`);

  const { accounts: vaults, slot: s2 } = await getMultiple(ctx, [layout.vaultA, layout.vaultB]);
  const bal = (a: RawAccount | null, withheld = 0n): bigint | null => (a && a.data.length >= 72 ? u64(a.data, 64) - withheld : null);
  const rawA = bal(vaults[0] ?? null, layout.withheldA), rawB = bal(vaults[1] ?? null, layout.withheldB);
  if (rawA == null || rawB == null) throw new Error(`vaults of pool ${pool} unreadable`);

  const mints = [layout.mintA, layout.mintB];
  const [{ meta }, prices, symbols] = await Promise.all([getMintMeta(ctx, mints), getPrices(ctx, mints), getSymbols(ctx, mints)]);
  const dA = meta.get(layout.mintA)?.decimals, dB = meta.get(layout.mintB)?.decimals;
  if (dA == null || dB == null) throw new Error(`decimals of pool ${pool} tokens unreadable`);
  const amtA = Number(rawA) / 10 ** dA, amtB = Number(rawB) / 10 ** dB;
  const pA = prices.get(layout.mintA), pB = prices.get(layout.mintB);
  if (pA == null) gaps.push(`no USD price for ${layout.mintA}`);
  if (pB == null) gaps.push(`no USD price for ${layout.mintB}`);
  const usdA = pA != null ? amtA * pA : null, usdB = pB != null ? amtB * pB : null;
  return {
    pool,
    dex: layout.dex,
    usd: usdA != null && usdB != null ? usdA + usdB : null,
    tokenA: { mint: layout.mintA, symbol: symbols.get(layout.mintA)!, vault: layout.vaultA, amount: amtA, usd: usdA },
    tokenB: { mint: layout.mintB, symbol: symbols.get(layout.mintB)!, vault: layout.vaultB, amount: amtB, usd: usdB },
    sources: [chainSource(ctx, "getMultipleAccounts", Math.max(s1, s2)), apiSource(ctx, "price_api", JUP_PRICE_URL)],
    gaps,
  };
}

/** Pool TVL in USD, or null if it cannot be priced. */
export async function poolLiquidityUsd(ctx: AdapterContext, pool: string): Promise<number | null> {
  return (await poolLiquidity(ctx, pool)).usd;
}
