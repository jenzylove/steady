// Jupiter Perpetuals: open positions of a wallet read from chain (Position accounts), liquidation price from Jupiter's own API.
import type { Adapter, AdapterContext, AdapterResult, Position } from "../types.js";
import { apiSource, chainSource, getMintMeta, getMultiple, getPrices, getSymbols, JUP_PRICE_URL, i64, pk, rpc, u64, u8 } from "./lib.js";

export const JUPITER_PERPS_PROGRAM = "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu";
export const JUPITER_PERPS_API = "https://perps-api.jup.ag/v1/positions";
/** sha256("account:Position")[0..8] as base58 */
const POSITION_DISCRIMINATOR_B58 = "VZMoMoKgZQb";
const POSITION_SIZE = 216;
const USD = 1e6;

export interface PerpPositionAccount {
  address: string;
  owner: string;
  pool: string;
  custody: string;
  collateralCustody: string;
  openTime: number;
  updateTime: number;
  side: "long" | "short" | "none";
  entryPrice: number;
  sizeUsd: number;
  collateralUsd: number;
  realisedPnlUsd: number;
}

export function decodePerpPosition(address: string, d: Buffer): PerpPositionAccount {
  const side = u8(d, 152);
  return {
    address,
    owner: pk(d, 8),
    pool: pk(d, 40),
    custody: pk(d, 72),
    collateralCustody: pk(d, 104),
    openTime: Number(i64(d, 136)),
    updateTime: Number(i64(d, 144)),
    side: side === 1 ? "long" : side === 2 ? "short" : "none",
    entryPrice: Number(u64(d, 153)) / USD,
    sizeUsd: Number(u64(d, 161)) / USD,
    collateralUsd: Number(u64(d, 169)) / USD,
    realisedPnlUsd: Number(i64(d, 177)) / USD,
  };
}

export const jupiterPerpsAdapter: Adapter = {
  id: "jupiter-perps",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const gpa = await rpc<any>(ctx, "getProgramAccounts", [
      JUPITER_PERPS_PROGRAM,
      {
        encoding: "base64", commitment: "confirmed", withContext: true,
        filters: [{ dataSize: POSITION_SIZE }, { memcmp: { offset: 0, bytes: POSITION_DISCRIMINATOR_B58 } }, { memcmp: { offset: 8, bytes: wallet } }],
      },
    ]);
    const slot = gpa.result.context?.slot ?? gpa.slot;
    const open = (gpa.result.value ?? gpa.result)
      .map((x: any) => decodePerpPosition(x.pubkey, Buffer.from(x.account.data[0], "base64")))
      .filter((p: PerpPositionAccount) => p.sizeUsd > 0 && p.side !== "none");
    if (open.length === 0) return { positions, loans: [], gaps };

    // custody accounts give the traded token (offset 40 is the mint)
    const custodyKeys = [...new Set(open.flatMap((p: PerpPositionAccount) => [p.custody, p.collateralCustody]))] as string[];
    const { accounts: custAccs } = await getMultiple(ctx, custodyKeys);
    const custodyMint = new Map<string, string>();
    custAccs.forEach((a, i) => { if (a) custodyMint.set(custodyKeys[i]!, pk(a.data, 40)); });
    const mints = [...new Set([...custodyMint.values()])];
    const [prices, symbols, { meta }] = await Promise.all([getPrices(ctx, mints), getSymbols(ctx, mints), getMintMeta(ctx, mints)]);
    void meta;

    // Jupiter's own liquidation price, leverage and fee-adjusted PnL for the same positions
    const api = new Map<string, any>();
    try {
      const res = await ctx.fetch(`${JUPITER_PERPS_API}?walletAddress=${wallet}`);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const j: any = await res.json();
      for (const p of j.dataList ?? []) api.set(p.positionPubkey, p);
    } catch (e) {
      gaps.push(`jupiter-perps: Jupiter's liquidation prices unavailable (${(e as Error).message})`);
    }
    const apiSrc = apiSource(ctx, "protocol_api", JUPITER_PERPS_API);
    const priceSrc = apiSource(ctx, "price_api", JUP_PRICE_URL);

    for (const p of open as PerpPositionAccount[]) {
      const mint = custodyMint.get(p.custody);
      const collMint = custodyMint.get(p.collateralCustody);
      if (!mint) { gaps.push(`jupiter-perps: custody ${p.custody} of position ${p.address} unreadable`); continue; }
      const mark = prices.get(mint);
      const tokens = p.entryPrice > 0 ? p.sizeUsd / p.entryPrice : 0;
      const sources = [chainSource(ctx, "getProgramAccounts", slot)];
      const a = api.get(p.address);
      let pnl: number | undefined, notional: number | undefined;
      if (mark != null) {
        pnl = p.side === "long" ? (p.sizeUsd * (mark - p.entryPrice)) / p.entryPrice : (p.sizeUsd * (p.entryPrice - mark)) / p.entryPrice;
        notional = tokens * mark;
        sources.push(priceSrc);
      } else gaps.push(`jupiter-perps: no mark price for ${mint}; PnL of ${p.address} not computed`);
      if (a) sources.push(apiSrc);
      else if (api.size || gaps.length === 0) gaps.push(`jupiter-perps: position ${p.address} missing from Jupiter's API; liquidation price not given`);
      const sym = symbols.get(mint)!;
      positions.push({
        protocol: "jupiter-perps", kind: "perp", account: p.address, mint, symbol: `${sym}-${p.side}`,
        amount: p.side === "long" ? tokens : -tokens,
        ...(notional !== undefined ? { usd: notional } : {}),
        extra: {
          side: p.side, market: sym, sizeUsd: p.sizeUsd, entryPrice: p.entryPrice, markPrice: mark ?? null,
          collateralUsd: p.collateralUsd, collateralMint: collMint ?? null, collateralSymbol: collMint ? symbols.get(collMint) : null,
          unrealizedPnlUsd: pnl ?? null, leverage: p.collateralUsd > 0 ? p.sizeUsd / p.collateralUsd : null,
          liquidationPrice: a?.liquidationPrice != null ? Number(a.liquidationPrice) : null,
          jupiterReported: a ? { leverage: Number(a.leverage), pnlAfterFeesUsd: Number(a.pnlAfterFeesUsd), totalFeesUsd: Number(a.totalFeesUsd), netValueUsd: Number(a.value), markPrice: Number(a.markPrice) } : null,
          openedAt: new Date(p.openTime * 1000).toISOString(),
          usdMeaning: "position notional at the mark price; netValueUsd under jupiterReported is collateral plus PnL after fees",
        },
        sources,
      });
    }
    return { positions, loans: [], gaps };
  },
};
