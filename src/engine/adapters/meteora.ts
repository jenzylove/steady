// Meteora DLMM positions via the Meteora SDK reading chain state; DAMM v2 NFTs are detected and reported as a gap.
import { Connection, PublicKey } from "@solana/web3.js";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
import type { Adapter, AdapterContext, AdapterResult, Position } from "../types.js";
import { chainSource, apiSource, getTokenHoldings, getMultiple, getMintMeta, getPrices, getSymbols, pda, rpc, JUP_PRICE_URL } from "./lib.js";

// The package is CommonJS with a default export; under ESM interop the class sits at .default or .default.default.
function dlmmClass(): any {
  const m: any = nodeRequire("@meteora-ag/dlmm");
  for (const c of [m, m.default, m.default?.default, m.DLMM]) if (c && typeof c.getAllLbPairPositionsByUser === "function") return c;
  throw new Error("meteora: DLMM class not found in @meteora-ag/dlmm");
}

export const METEORA_DAMM_V2 = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

export function binPrice(binId: number, binStep: number, decX: number, decY: number): number {
  return Math.pow(1 + binStep / 10000, binId) * 10 ** (decX - decY);
}

export const meteoraAdapter: Adapter = {
  id: "meteora",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const conn = new Connection(ctx.heliusRpcUrl, { commitment: "confirmed", fetch: ctx.fetch as any });
    const { slot } = await rpc(ctx, "getSlot", []).then((r) => ({ slot: Number(r.result) }));
    const map = await dlmmClass().getAllLbPairPositionsByUser(conn, new PublicKey(wallet));

    const mints = new Set<string>();
    for (const info of (map as Map<string, any>).values()) { mints.add(info.lbPair.tokenXMint.toBase58()); mints.add(info.lbPair.tokenYMint.toBase58()); }
    const mintList = [...mints];
    const [{ meta }, prices, symbols] = mintList.length
      ? await Promise.all([getMintMeta(ctx, mintList), getPrices(ctx, mintList), getSymbols(ctx, mintList)])
      : [{ meta: new Map<string, { decimals: number; program: string }>() }, new Map<string, number>(), new Map<string, string>()];
    const priceSrc = apiSource(ctx, "price_api", JUP_PRICE_URL);

    for (const [pair, info] of map as Map<string, any>) {
      const mx = info.lbPair.tokenXMint.toBase58(), my = info.lbPair.tokenYMint.toBase58();
      const dx = meta.get(mx), dy = meta.get(my);
      if (!dx || !dy) { gaps.push(`meteora: decimals for pool ${pair} tokens unreadable`); continue; }
      const px = prices.get(mx), py = prices.get(my);
      const sx = symbols.get(mx)!, sy = symbols.get(my)!;
      const active = info.lbPair.activeId;
      const binStep = info.lbPair.binStep;
      for (const lp of info.lbPairPositionsData) {
        const d = lp.positionData;
        const ax = Number(d.totalXAmount) / 10 ** dx.decimals;
        const ay = Number(d.totalYAmount) / 10 ** dy.decimals;
        const fx = Number(d.feeX.toString()) / 10 ** dx.decimals;
        const fy = Number(d.feeY.toString()) / 10 ** dy.decimals;
        if (ax === 0 && ay === 0 && fx === 0 && fy === 0) continue; // emptied position, nothing in it
        const sources = [chainSource(ctx, "getProgramAccounts", slot), chainSource(ctx, "getMultipleAccounts", slot)];
        let usd: number | undefined;
        if (px != null && py != null) { usd = ax * px + ay * py; sources.push(priceSrc); }
        else if (ax === 0 && ay === 0) usd = 0;
        else gaps.push(`meteora: no USD price for ${px == null ? mx : my}; position ${lp.publicKey.toBase58()} left unvalued`);
        positions.push({
          protocol: "meteora", kind: "lp", account: lp.publicKey.toBase58(), symbol: `${sx}/${sy}`,
          amount: ax,
          ...(usd !== undefined ? { usd } : {}),
          extra: {
            pool: pair, binStep, activeBinId: active, lowerBinId: d.lowerBinId, upperBinId: d.upperBinId,
            priceLower: binPrice(d.lowerBinId, binStep, dx.decimals, dy.decimals),
            priceUpper: binPrice(d.upperBinId, binStep, dx.decimals, dy.decimals),
            priceCurrent: binPrice(active, binStep, dx.decimals, dy.decimals),
            inRange: active >= d.lowerBinId && active <= d.upperBinId,
            tokenX: { mint: mx, symbol: sx, amount: ax, uncollectedFees: fx },
            tokenY: { mint: my, symbol: sy, amount: ay, uncollectedFees: fy },
            amountNote: "position.amount is the token X amount; value both sides from extra.tokenX and extra.tokenY",
          },
          sources,
        });
      }
    }

    // DAMM v2 positions are NFTs; we detect them but do not value them yet.
    try {
      const { tokens } = await getTokenHoldings(ctx, wallet);
      const nfts = tokens.filter((t) => t.decimals === 0 && t.rawAmount === 1n);
      if (nfts.length) {
        const keys = nfts.map((n) => pda([Buffer.from("position"), new PublicKey(n.mint).toBuffer()], METEORA_DAMM_V2));
        const { accounts } = await getMultiple(ctx, keys);
        const n = accounts.filter((a) => a && a.owner === METEORA_DAMM_V2).length;
        if (n) gaps.push(`meteora: ${n} DAMM v2 position(s) found but not valued (DAMM is not read yet)`);
      }
    } catch (e) {
      gaps.push(`meteora: DAMM v2 check failed (${(e as Error).message.replace(/api-key=[^&\s]+/g, "api-key=***")})`);
    }
    return { positions, loans: [], gaps };
  },
};
