// exitCost: what it costs to sell `amount` of a token into a pool, and through the best Jupiter route.
// Used to say whether an LP or a perp position can really be closed at its size.
import type { AdapterContext, Source } from "../types.js";
import { apiSource, chainSource, getMintMeta, getMultiple, u64 } from "../adapters/lib.js";
import { parsePool, type PoolDex } from "../pools/liquidity.js";

export const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
// Jupiter's names for the DEX of each supported pool type, used to keep the quote on that venue.
const JUP_DEX_LABEL: Record<PoolDex, string> = {
  "orca-whirlpool": "Orca V2",
  "raydium-clmm": "Raydium CLMM",
  "raydium-amm-v4": "Raydium",
  "raydium-cpmm": "Raydium CP",
  "meteora-dlmm": "Meteora DLMM",
};
const AMM_V4_FEE = 0.0025;

export interface RouteEstimate {
  method: "constant-product" | "jupiter-same-dex" | "jupiter-best-route";
  /** Tokens received, UI units. */
  expectedOut: number;
  /** Price paid versus the price of a tiny trade on the same route, in percent (fees cancel out). */
  impactPct: number;
  executionPrice: number; // out per in
  spotPrice: number; // out per in for a tiny trade
  /** Jupiter's own priceImpactPct (percent) when the route is a Jupiter quote. */
  jupiterReportedImpactPct?: number;
  route?: string[];
}
export interface ExitCost {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  /** The headline: the pool's own route when we can price it, else the best Jupiter route. */
  impactPct: number;
  expectedOut: number;
  inPool: RouteEstimate | null;
  bestRoute: RouteEstimate | null;
  sources: Source[];
  gaps: string[];
}

async function jupQuote(
  ctx: AdapterContext, inMint: string, outMint: string, rawIn: bigint, extra = "",
): Promise<{ out: bigint; reported: number; route: string[] } | null> {
  if (rawIn <= 0n) return null;
  const url = `${JUPITER_QUOTE_URL}?inputMint=${inMint}&outputMint=${outMint}&amount=${rawIn}&slippageBps=50${extra}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await ctx.fetch(url);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); continue; }
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j.outAmount) return null;
    return {
      out: BigInt(j.outAmount),
      reported: Number(j.priceImpactPct) * 100,
      route: (j.routePlan ?? []).map((r: any) => `${r.swapInfo?.label}:${r.percent}%`),
    };
  }
  return null;
}

async function jupEstimate(
  ctx: AdapterContext, inMint: string, outMint: string, rawIn: bigint, decIn: number, decOut: number, method: RouteEstimate["method"], extra = "",
): Promise<RouteEstimate | null> {
  const big = await jupQuote(ctx, inMint, outMint, rawIn, extra);
  const small = await jupQuote(ctx, inMint, outMint, rawIn / 1000n > 0n ? rawIn / 1000n : 1n, extra);
  if (!big || !small) return null;
  const rawSmallIn = rawIn / 1000n > 0n ? rawIn / 1000n : 1n;
  const exec = Number(big.out) / Number(rawIn), spot = Number(small.out) / Number(rawSmallIn);
  const scale = 10 ** (decIn - decOut);
  return {
    method,
    expectedOut: Number(big.out) / 10 ** decOut,
    impactPct: Math.max(0, (1 - exec / spot) * 100),
    executionPrice: exec * scale,
    spotPrice: spot * scale,
    jupiterReportedImpactPct: big.reported,
    route: big.route,
  };
}

/** Constant product swap with the pool fee taken from the input. */
export function constantProductOut(reserveIn: number, reserveOut: number, amountIn: number, fee: number): number {
  const inAfterFee = amountIn * (1 - fee);
  return (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
}

/**
 * Cost of selling `amount` (UI units) of `tokenIn` into `pool`. Raydium standard and CPMM pools are simulated exactly from
 * their reserves; Orca, Raydium CLMM and Meteora pools are priced through Jupiter restricted to that DEX. The best unrestricted
 * Jupiter route is always returned too, since that is what a real exit would use.
 */
export async function exitCost(ctx: AdapterContext, pool: string, tokenIn: string, amount: number): Promise<ExitCost> {
  const gaps: string[] = [];
  const sources: Source[] = [];
  const { accounts: [acc], slot } = await getMultiple(ctx, [pool]);
  if (!acc) throw new Error(`pool ${pool} not found`);
  const layout = parsePool(acc.owner, acc.data);
  if (!layout) throw new Error(`pool ${pool} is not an Orca, Raydium or Meteora pool`);
  if (tokenIn !== layout.mintA && tokenIn !== layout.mintB) throw new Error(`token ${tokenIn} is not in pool ${pool}`);
  const tokenOut = tokenIn === layout.mintA ? layout.mintB : layout.mintA;
  sources.push(chainSource(ctx, "getMultipleAccounts", slot));

  const { meta } = await getMintMeta(ctx, [tokenIn, tokenOut]);
  const decIn = meta.get(tokenIn)?.decimals, decOut = meta.get(tokenOut)?.decimals;
  if (decIn == null || decOut == null) throw new Error("token decimals unreadable");
  const rawIn = BigInt(Math.round(amount * 10 ** decIn));

  let inPool: RouteEstimate | null = null;
  if (layout.dex === "raydium-amm-v4" || layout.dex === "raydium-cpmm") {
    const { accounts: vs, slot: s2 } = await getMultiple(ctx, [layout.vaultA, layout.vaultB, ...(layout.dex === "raydium-cpmm" ? [(await import("../adapters/lib.js")).pk(acc.data, 8)] : [])]);
    sources.push(chainSource(ctx, "getMultipleAccounts", s2));
    if (vs[0] && vs[1]) {
      const rA = Number(u64(vs[0].data, 64) - (layout.withheldA ?? 0n)), rB = Number(u64(vs[1].data, 64) - (layout.withheldB ?? 0n));
      const inIsA = tokenIn === layout.mintA;
      const resIn = (inIsA ? rA : rB) / 10 ** decIn, resOut = (inIsA ? rB : rA) / 10 ** decOut;
      let fee = AMM_V4_FEE;
      if (layout.dex === "raydium-cpmm") {
        // trade_fee_rate (u64, 1e6 denominator) sits at offset 12 of the AmmConfig referenced by the pool
        const cfg = vs[2];
        if (cfg && cfg.data.length >= 20) fee = Number(u64(cfg.data, 12)) / 1e6;
        else gaps.push("pool fee rate unreadable; fee assumed 0.25%");
      }
      const out = constantProductOut(resIn, resOut, amount, fee);
      const spotOut = amount * (1 - fee) * (resOut / resIn);
      inPool = {
        method: "constant-product", expectedOut: out, impactPct: Math.max(0, (1 - out / spotOut) * 100),
        executionPrice: out / amount, spotPrice: (resOut / resIn) * (1 - fee),
      };
    } else gaps.push("pool vaults unreadable");
  } else {
    inPool = await jupEstimate(ctx, tokenIn, tokenOut, rawIn, decIn, decOut, "jupiter-same-dex", `&dexes=${encodeURIComponent(JUP_DEX_LABEL[layout.dex])}`);
    if (!inPool) gaps.push(`Jupiter had no ${JUP_DEX_LABEL[layout.dex]} route for this pair and size`);
    else sources.push(apiSource(ctx, "protocol_api", JUPITER_QUOTE_URL));
  }

  const bestRoute = await jupEstimate(ctx, tokenIn, tokenOut, rawIn, decIn, decOut, "jupiter-best-route");
  if (bestRoute) sources.push(apiSource(ctx, "protocol_api", JUPITER_QUOTE_URL));
  else gaps.push("Jupiter had no route for this pair and size");

  const head = inPool ?? bestRoute;
  if (!head) throw new Error(`no exit estimate available for ${amount} of ${tokenIn} in pool ${pool}: ${gaps.join("; ")}`);
  return { pool, tokenIn, tokenOut, amountIn: amount, impactPct: head.impactPct, expectedOut: head.expectedOut, inPool, bestRoute, sources, gaps };
}
