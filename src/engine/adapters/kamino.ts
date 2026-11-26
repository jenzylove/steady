// Kamino Lend (klend) obligations. Decoded straight from chain accounts (layouts taken from the klend IDL in
// @kamino-finance/klend-sdk 14), with Kamino's own API used only for what Kamino itself reports (protocolReported).
import type { Adapter, AdapterContext, AdapterResult, LoanAccount, LoanLeg, Position, Source } from "../types.js";
import { apiSource, chainSource, getMultiple, getSymbols, pk, u128 } from "./lib.js";
import { div, getJson, getProgramAccounts } from "./lend-lib.js";

export const KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const KAMINO_API = "https://api.kamino.finance";
const OBLIGATION_SIZE = 3344;
const SF = 1n << 60n; // Kamino "Sf" fixed point: 60 fractional bits
/** A reserve not refreshed for this many slots (about 11 hours) cannot price a leg. */
export const STALE_RESERVE_SLOTS = 100_000;
const ZERO_KEY = "11111111111111111111111111111111";

export interface KaminoObligationState {
  address: string;
  lendingMarket: string;
  owner: string;
  lastUpdateSlot: number;
  elevationGroup: number;
  deposits: { reserve: string; cTokens: bigint; marketValue: number }[];
  borrows: { reserve: string; cumRate: bigint; amountSf: bigint; marketValue: number }[];
  depositedValue: number;
  borrowFactorAdjustedDebt: number;
  borrowedValue: number;
  unhealthyBorrowValue: number;
}

function bigFraction(b: Buffer, o: number): bigint {
  // 4 little endian u64 limbs, 60 fractional bits (the API shows the same limbs)
  return b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n) + (b.readBigUInt64LE(o + 16) << 128n) + (b.readBigUInt64LE(o + 24) << 192n);
}

export function decodeObligation(address: string, b: Buffer): KaminoObligationState {
  const deposits: KaminoObligationState["deposits"] = [];
  for (let i = 0; i < 8; i++) {
    const o = 96 + i * 136;
    const reserve = pk(b, o);
    if (reserve === ZERO_KEY) continue;
    deposits.push({ reserve, cTokens: b.readBigUInt64LE(o + 32), marketValue: div(u128(b, o + 40), SF) });
  }
  const borrows: KaminoObligationState["borrows"] = [];
  for (let i = 0; i < 5; i++) {
    const o = 1208 + i * 200;
    const reserve = pk(b, o);
    if (reserve === ZERO_KEY) continue;
    borrows.push({ reserve, cumRate: bigFraction(b, o + 32), amountSf: u128(b, o + 88), marketValue: div(u128(b, o + 104), SF) });
  }
  return {
    address,
    lendingMarket: pk(b, 32),
    owner: pk(b, 64),
    lastUpdateSlot: Number(b.readBigUInt64LE(16)),
    elevationGroup: b[2285] ?? 0,
    deposits,
    borrows,
    depositedValue: div(u128(b, 1192), SF),
    borrowFactorAdjustedDebt: div(u128(b, 2208), SF),
    borrowedValue: div(u128(b, 2224), SF),
    unhealthyBorrowValue: div(u128(b, 2256), SF),
  };
}

export interface KaminoReserve {
  address: string;
  mint: string;
  decimals: number;
  lastUpdateSlot: number;
  priceUsd: number;
  priceUpdatedTs: number;
  /** liquidity units per cToken */
  exchangeRate: number;
  cumulativeBorrowRate: bigint;
  liquidationThreshold: number; // fraction
  borrowFactor: number; // multiplier, 1 = none
  elevationGroups: number[]; // non zero ids this reserve belongs to
}

export function decodeReserve(address: string, b: Buffer): KaminoReserve {
  const available = b.readBigUInt64LE(224);
  const borrowedSf = u128(b, 232);
  const fees = u128(b, 344) + u128(b, 360) + u128(b, 376);
  const totalLiqSf = (available << 60n) + borrowedSf - fees;
  const supply = b.readBigUInt64LE(2592);
  const exchangeRate = supply === 0n ? 1 : div(totalLiqSf, SF) / Number(supply);
  const egs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const g = b[5480 + i] ?? 0;
    if (g !== 0) egs.push(g);
  }
  return {
    address,
    mint: pk(b, 128),
    decimals: Number(b.readBigUInt64LE(272)),
    lastUpdateSlot: Number(b.readBigUInt64LE(16)),
    priceUsd: div(u128(b, 248), SF),
    priceUpdatedTs: Number(b.readBigUInt64LE(264)),
    exchangeRate,
    cumulativeBorrowRate: bigFraction(b, 296),
    liquidationThreshold: (b[4873] ?? 0) / 100,
    borrowFactor: Number(b.readBigUInt64LE(5008)) / 100,
    elevationGroups: egs,
  };
}

export interface ElevationGroup {
  id: number;
  ltvPct: number;
  liquidationThresholdPct: number;
}

/** LendingMarket account: the 32 elevation groups start at byte 200, 72 bytes each. */
export function decodeElevationGroups(b: Buffer): Map<number, ElevationGroup> {
  const out = new Map<number, ElevationGroup>();
  for (let i = 0; i < 32; i++) {
    const o = 200 + i * 72;
    const id = b[o + 2] ?? 0;
    if (id === 0) continue;
    out.set(id, { id, ltvPct: b[o + 3] ?? 0, liquidationThresholdPct: b[o + 4] ?? 0 });
  }
  return out;
}

interface ApiObligation {
  obligationAddress: string;
  refreshedStats?: {
    borrowLiquidationLimit: string;
    userTotalBorrowBorrowFactorAdjusted: string;
    loanToValue: string;
    liquidationLtv: string;
  };
}

export function obligationsUrl(market: string, wallet: string): string {
  return `${KAMINO_API}/kamino-market/${market}/users/${wallet}/obligations`;
}

export function reportedFromApi(o: ApiObligation | undefined): LoanAccount["protocolReported"] | undefined {
  const s = o?.refreshedStats;
  if (!s) return undefined;
  const debt = Number(s.userTotalBorrowBorrowFactorAdjusted);
  const out: NonNullable<LoanAccount["protocolReported"]> = {
    ltv: Number(s.loanToValue),
    liquidationLtv: Number(s.liquidationLtv),
  };
  if (debt > 0) out.healthFactor = Number(s.borrowLiquidationLimit) / debt;
  return out;
}

export function buildKaminoLoan(
  ob: KaminoObligationState,
  reserves: Map<string, KaminoReserve>,
  groups: Map<number, ElevationGroup>,
  symbols: Map<string, string>,
  reported: LoanAccount["protocolReported"] | undefined,
  sources: Source[],
  gaps: string[],
  currentSlot: number,
): { loan: LoanAccount; positions: Position[] } {
  const collaterals: LoanLeg[] = [];
  const borrows: LoanLeg[] = [];
  const positions: Position[] = [];
  const eg = ob.elevationGroup;
  const group = eg !== 0 ? groups.get(eg) : undefined;
  if (eg !== 0 && !group) gaps.push(`kamino: obligation ${ob.address} uses elevation group ${eg} but the market elevation group could not be read`);
  // one stale reserve makes live prices inconsistent with the rest, so the whole obligation then uses its stored values
  const staleReserve = [...ob.deposits, ...ob.borrows].map((x) => reserves.get(x.reserve)).find((r) => r && currentSlot - r.lastUpdateSlot > STALE_RESERVE_SLOTS);
  if (staleReserve) gaps.push(`kamino: reserve ${staleReserve.address} was last refreshed at slot ${staleReserve.lastUpdateSlot}; obligation ${ob.address} is valued from its own stored values, not live prices`);
  const stale = (_r: KaminoReserve) => staleReserve !== undefined;

  for (const d of ob.deposits) {
    const r = reserves.get(d.reserve);
    if (!r) {
      gaps.push(`kamino: reserve ${d.reserve} of obligation ${ob.address} could not be read`);
      continue;
    }
    const st = stale(r);
    const amount = st ? 0 : (Number(d.cTokens) * r.exchangeRate) / 10 ** r.decimals;
    const usd = st ? d.marketValue : amount * r.priceUsd;
    // in an elevation group the group threshold replaces the reserve one for member reserves
    const inGroup = group !== undefined && r.elevationGroups.includes(eg);
    const factor = inGroup ? group!.liquidationThresholdPct / 100 : r.liquidationThreshold;
    const sym = symbols.get(r.mint) ?? r.mint.slice(0, 4);
    collaterals.push({ mint: r.mint, symbol: sym, amount, usd, factor });
    positions.push({ protocol: "kamino", kind: "lend", account: ob.address, mint: r.mint, symbol: sym, amount, usd, extra: { reserve: r.address, market: ob.lendingMarket, ...(st ? { staleValueFromObligation: true } : {}) }, sources });
  }
  for (const bo of ob.borrows) {
    const r = reserves.get(bo.reserve);
    if (!r) {
      gaps.push(`kamino: reserve ${bo.reserve} of obligation ${ob.address} could not be read`);
      continue;
    }
    const st = stale(r);
    const accrued = bo.cumRate === 0n ? bo.amountSf : (bo.amountSf * r.cumulativeBorrowRate) / bo.cumRate;
    const amount = st ? 0 : div(accrued, SF) / 10 ** r.decimals;
    const usd = st ? bo.marketValue : amount * r.priceUsd;
    // inside an elevation group the borrow factor is waived
    const factor = group ? 1 : r.borrowFactor;
    const sym = symbols.get(r.mint) ?? r.mint.slice(0, 4);
    borrows.push({ mint: r.mint, symbol: sym, amount, usd, factor });
    positions.push({ protocol: "kamino", kind: "borrow", account: ob.address, mint: r.mint, symbol: sym, amount, usd, extra: { reserve: r.address, market: ob.lendingMarket, ...(st ? { staleValueFromObligation: true } : {}) }, sources });
  }
  const loan: LoanAccount = { protocol: "kamino", account: ob.address, collaterals, borrows, sources, ...(reported ? { protocolReported: reported } : {}) };
  return { loan, positions };
}

export const kaminoAdapter: Adapter = {
  id: "kamino",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const loans: LoanAccount[] = [];
    let found;
    try {
      found = await getProgramAccounts(ctx, KLEND_PROGRAM, [{ dataSize: OBLIGATION_SIZE }, { memcmp: { offset: 64, bytes: wallet } }]);
    } catch (e) {
      return { positions, loans, gaps: [`kamino: could not read obligations: ${(e as Error).message}`] };
    }
    const obs = found.accounts.map((a) => decodeObligation(a.pubkey, a.data)).filter((o) => o.deposits.length + o.borrows.length > 0);
    if (obs.length === 0) return { positions, loans, gaps };

    const reserveKeys = [...new Set(obs.flatMap((o) => [...o.deposits.map((d) => d.reserve), ...o.borrows.map((b) => b.reserve)]))];
    const marketKeys = [...new Set(obs.filter((o) => o.elevationGroup !== 0).map((o) => o.lendingMarket))];
    const reserves = new Map<string, KaminoReserve>();
    const groupsByMarket = new Map<string, Map<number, ElevationGroup>>();
    let accountsSlot = found.slot;
    try {
      const got = await getMultiple(ctx, [...reserveKeys, ...marketKeys]);
      accountsSlot = got.slot;
      reserveKeys.forEach((k, i) => {
        const a = got.accounts[i];
        if (a) reserves.set(k, decodeReserve(k, a.data));
      });
      marketKeys.forEach((k, i) => {
        const a = got.accounts[reserveKeys.length + i];
        if (a) groupsByMarket.set(k, decodeElevationGroups(a.data));
      });
    } catch (e) {
      return { positions, loans, gaps: [`kamino: could not read reserves: ${(e as Error).message}`] };
    }
    const symbols = await getSymbols(ctx, [...new Set([...reserves.values()].map((r) => r.mint))]).catch(() => new Map<string, string>());

    const apiByObligation = new Map<string, ApiObligation>();
    for (const m of new Set(obs.map((o) => o.lendingMarket))) {
      try {
        const list = await getJson<ApiObligation[]>(ctx, obligationsUrl(m, wallet));
        for (const o of list) apiByObligation.set(o.obligationAddress, o);
      } catch (e) {
        gaps.push(`kamino: Kamino API health numbers unavailable for market ${m}: ${(e as Error).message}`);
      }
    }
    for (const ob of obs) {
      const sources: Source[] = [chainSource(ctx, "getProgramAccounts", found.slot), chainSource(ctx, "getMultipleAccounts", accountsSlot)];
      const apiO = apiByObligation.get(ob.address);
      if (apiO) sources.push(apiSource(ctx, "protocol_api", `${KAMINO_API}/kamino-market/${ob.lendingMarket}/users/<wallet>/obligations`));
      const r = buildKaminoLoan(ob, reserves, groupsByMarket.get(ob.lendingMarket) ?? new Map(), symbols, reportedFromApi(apiO), sources, gaps, accountsSlot);
      loans.push(r.loan);
      positions.push(...r.positions);
    }
    return { positions, loans, gaps };
  },
};

