import type { Adapter, AdapterContext, AdapterResult, LoanAccount, LoanLeg, Position, Source } from "../types.js";
import { apiSource, chainSource, pk, u128 } from "./lib.js";
import { div, getJson, getProgramAccounts } from "./lend-lib.js";

export const SAVE_PROGRAM = "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo";
const OBLIGATION_SIZE = 1300;
const WAD = 10n ** 18n;
export const SAVE_API = "https://api.solend.fi/v1";
export const SAVE_RESERVES_URL = `${SAVE_API}/reserves?scope=all`;
export const SAVE_CONFIGS_URL = `${SAVE_API}/markets/configs?scope=all`;

/** A reserve not refreshed on chain for this many slots (about 11 hours) has a price and rate we do not trust. */
export const STALE_RESERVE_SLOTS = 100_000;

interface ApiReserve {
  reserve: {
    lastUpdate?: { slot: string };
    liquidity: { mintDecimals: number; availableAmount: string; borrowedAmountWads: string; cumulativeBorrowRateWads: string; marketPrice: string; mintPubkey: string };
    collateral: { mintTotalSupply: string };
    config: { liquidationThreshold: number; borrowWeight?: string; addedBorrowWeightBPS?: string };
    address?: string;
    pubkey?: string;
  };
}
interface ApiMarketCfg {
  reserves: { address: string; liquidityToken: { mint: string; symbol: string } }[];
}

export interface SaveReserve {
  address: string;
  mint: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
  liquidationThreshold: number; // fraction
  borrowWeight: number;
  /** liquidity units per cToken */
  exchangeRate: number;
  cumulativeBorrowRateWads: bigint;
  lastUpdateSlot: number;
}

export async function loadSaveReserves(ctx: AdapterContext): Promise<Map<string, SaveReserve>> {
  const [res, cfgs] = await Promise.all([
    getJson<{ results: ApiReserve[] }>(ctx, SAVE_RESERVES_URL),
    getJson<ApiMarketCfg[]>(ctx, SAVE_CONFIGS_URL),
  ]);
  const sym = new Map<string, string>();
  for (const m of cfgs) for (const r of m.reserves) sym.set(r.address, r.liquidityToken.symbol);
  const out = new Map<string, SaveReserve>();
  for (const { reserve: r } of res.results) {
    const addr = r.address ?? r.pubkey;
    if (!addr) continue;
    const supply = BigInt(r.collateral.mintTotalSupply);
    const totalLiq = BigInt(r.liquidity.availableAmount) * WAD + BigInt(r.liquidity.borrowedAmountWads);
    const exchangeRate = supply === 0n ? 1 : div(totalLiq, WAD) / Number(supply);
    const added = Number(r.config.addedBorrowWeightBPS ?? "0") / 10000;
    out.set(addr, {
      address: addr,
      mint: r.liquidity.mintPubkey,
      symbol: sym.get(addr) ?? "?",
      decimals: r.liquidity.mintDecimals,
      priceUsd: div(BigInt(r.liquidity.marketPrice), WAD),
      liquidationThreshold: r.config.liquidationThreshold / 100,
      borrowWeight: Math.max(Number(r.config.borrowWeight ?? "1"), 1 + added),
      exchangeRate,
      cumulativeBorrowRateWads: BigInt(r.liquidity.cumulativeBorrowRateWads),
      lastUpdateSlot: Number(r.lastUpdate?.slot ?? 0),
    });
  }
  return out;
}

export interface DecodedObligation {
  lendingMarket: string;
  owner: string;
  depositedValue: number;
  borrowedValue: number;
  allowedBorrowValue: number;
  unhealthyBorrowValue: number;
  deposits: { reserve: string; cTokens: bigint; marketValue: number }[];
  borrows: { reserve: string; cumRateWads: bigint; borrowedWads: bigint; marketValue: number }[];
}

/** Decode a Save (Solend) obligation account. Wad values are 1e18 scaled USD. */
export function decodeObligation(b: Buffer): DecodedObligation {
  const depositsLen = b[202] ?? 0;
  const borrowsLen = b[203] ?? 0;
  let o = 204;
  const deposits: DecodedObligation["deposits"] = [];
  for (let i = 0; i < depositsLen; i++, o += 88) deposits.push({ reserve: pk(b, o), cTokens: b.readBigUInt64LE(o + 32), marketValue: div(u128(b, o + 40), WAD) });
  const borrows: DecodedObligation["borrows"] = [];
  for (let i = 0; i < borrowsLen; i++, o += 112)
    borrows.push({ reserve: pk(b, o), cumRateWads: u128(b, o + 32), borrowedWads: u128(b, o + 48), marketValue: div(u128(b, o + 64), WAD) });
  return {
    lendingMarket: pk(b, 10),
    owner: pk(b, 42),
    depositedValue: div(u128(b, 74), WAD),
    borrowedValue: div(u128(b, 90), WAD),
    allowedBorrowValue: div(u128(b, 106), WAD),
    unhealthyBorrowValue: div(u128(b, 122), WAD),
    deposits,
    borrows,
  };
}

/** Build the engine objects from a decoded obligation and live reserve data. */
export function buildSaveLoan(
  account: string,
  ob: DecodedObligation,
  reserves: Map<string, SaveReserve>,
  sources: Source[],
  gaps: string[],
  currentSlot: number,
): { loan: LoanAccount; positions: Position[] } {
  const collaterals: LoanLeg[] = [];
  const borrows: LoanLeg[] = [];
  const positions: Position[] = [];
  // one stale reserve makes live prices inconsistent with the rest, so the whole obligation then uses its stored values
  const staleReserve = [...ob.deposits, ...ob.borrows].map((x) => reserves.get(x.reserve)).find((r) => r && currentSlot - r.lastUpdateSlot > STALE_RESERVE_SLOTS);
  if (staleReserve) gaps.push(`save: ${staleReserve.symbol} reserve ${staleReserve.address} was last refreshed on chain at slot ${staleReserve.lastUpdateSlot}; obligation ${account} is valued from its own stored values, not live prices`);
  for (const d of ob.deposits) {
    const r = reserves.get(d.reserve);
    if (!r) {
      gaps.push(`save: reserve ${d.reserve} of obligation ${account} not found in the Save API`);
      continue;
    }
    const stale = staleReserve !== undefined;
    const amount = (Number(d.cTokens) * r.exchangeRate) / 10 ** r.decimals;
    // a stale reserve cannot price the leg, so the obligation own stored value (as of its last refresh) is used and flagged
    const usd = stale ? d.marketValue : amount * r.priceUsd;
    const leg: LoanLeg = { mint: r.mint, symbol: r.symbol, amount: stale ? 0 : amount, usd, factor: r.liquidationThreshold };
    collaterals.push(leg);
    positions.push({ protocol: "save", kind: "lend", account, mint: r.mint, symbol: r.symbol, amount: leg.amount, usd, extra: { reserve: r.address, ...(stale ? { staleValueFromObligation: true, reserveLastUpdateSlot: r.lastUpdateSlot } : {}) }, sources });
  }
  for (const bo of ob.borrows) {
    const r = reserves.get(bo.reserve);
    if (!r) {
      gaps.push(`save: reserve ${bo.reserve} of obligation ${account} not found in the Save API`);
      continue;
    }
    // accrue interest from the obligation snapshot of the cumulative rate to the reserve current one
    const stale = staleReserve !== undefined;
    const wads = bo.cumRateWads === 0n ? bo.borrowedWads : (bo.borrowedWads * r.cumulativeBorrowRateWads) / bo.cumRateWads;
    const amount = div(wads, WAD) / 10 ** r.decimals;
    const usd = stale ? bo.marketValue : amount * r.priceUsd;
    const leg: LoanLeg = { mint: r.mint, symbol: r.symbol, amount: stale ? 0 : amount, usd, factor: r.borrowWeight };
    borrows.push(leg);
    positions.push({ protocol: "save", kind: "borrow", account, mint: r.mint, symbol: r.symbol, amount: leg.amount, usd, extra: { reserve: r.address, ...(stale ? { staleValueFromObligation: true, reserveLastUpdateSlot: r.lastUpdateSlot } : {}) }, sources });
  }
  const reported: NonNullable<LoanAccount["protocolReported"]> = {};
  if (ob.borrowedValue > 0) reported.healthFactor = ob.unhealthyBorrowValue / ob.borrowedValue;
  if (ob.depositedValue > 0) {
    reported.ltv = ob.borrowedValue / ob.depositedValue;
    reported.liquidationLtv = ob.unhealthyBorrowValue / ob.depositedValue;
  }
  return { positions, loan: { protocol: "save", account, collaterals, borrows, protocolReported: reported, sources } };
}

export const saveAdapter: Adapter = {
  id: "save",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const loans: LoanAccount[] = [];
    let found;
    try {
      found = await getProgramAccounts(ctx, SAVE_PROGRAM, [{ dataSize: OBLIGATION_SIZE }, { memcmp: { offset: 42, bytes: wallet } }]);
    } catch (e) {
      return { positions, loans, gaps: [`save: could not read obligations: ${(e as Error).message}`] };
    }
    const decoded = found.accounts.map((a) => ({ a, ob: decodeObligation(a.data) })).filter((x) => x.ob.deposits.length + x.ob.borrows.length > 0);
    if (decoded.length === 0) return { positions, loans, gaps };
    let reserves: Map<string, SaveReserve>;
    try {
      reserves = await loadSaveReserves(ctx);
    } catch (e) {
      return { positions, loans, gaps: [`save: could not read reserves from the Save API: ${(e as Error).message}`] };
    }
    for (const { a, ob } of decoded) {
      const sources = [chainSource(ctx, "getProgramAccounts", found.slot), apiSource(ctx, "protocol_api", SAVE_RESERVES_URL)];
      const r = buildSaveLoan(a.pubkey, ob, reserves, sources, gaps, found.slot);
      loans.push(r.loan);
      positions.push(...r.positions);
    }
    return { positions, loans, gaps };
  },
};

/** The same health formula applied to the values stored in the obligation itself (one consistent snapshot). */
export function snapshotLoan(account: string, ob: DecodedObligation, reserves: Map<string, SaveReserve>): LoanAccount {
  const leg = (reserve: string, usd: number, factorOf: (r: SaveReserve) => number): LoanLeg => {
    const r = reserves.get(reserve);
    return { mint: r?.mint ?? reserve, symbol: r?.symbol ?? "?", amount: 0, usd, factor: r ? factorOf(r) : 0 };
  };
  return {
    protocol: "save",
    account,
    collaterals: ob.deposits.map((d) => leg(d.reserve, d.marketValue, (r) => r.liquidationThreshold)),
    borrows: ob.borrows.map((b) => leg(b.reserve, b.marketValue, (r) => r.borrowWeight)),
    sources: [],
  };
}
