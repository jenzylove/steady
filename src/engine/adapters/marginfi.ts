// marginfi v2 (now Project 0, program MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA, same program id after the rebrand).
// Accounts and banks are decoded from chain (layouts from the marginfi 0.1.8 IDL shipped in @mrgnlabs/marginfi-client-v2 6.4.2).
// Prices come from the bank's own cached oracle price. What marginfi itself reports comes from the health_cache
// the program writes into every account (maintenance asset value over maintenance liability value).
import { ComputeBudgetProgram, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { Adapter, AdapterContext, AdapterResult, LoanAccount, LoanLeg, Position, Source } from "../types.js";
import { chainSource, getMultiple, getSymbols, pk, rpc } from "./lib.js";
import { getProgramAccounts } from "./lend-lib.js";

export const MARGINFI_PROGRAM = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";
const ACCOUNT_SIZE = 2312;
const BALANCES_OFFSET = 72;
const BALANCE_SIZE = 104;
const MAX_BALANCES = 16;
const HEALTH_CACHE_OFFSET = 1840;
/** A bank price older than this many seconds is not used (a gap instead). */
export const MAX_PRICE_AGE_SECS = 6 * 3600;

/** Signed 128 bit fixed point with 48 fractional bits (marginfi WrappedI80F48), little endian. */
export function i80f48(b: Buffer, o: number): number {
  const lo = b.readBigUInt64LE(o);
  const hi = b.readBigInt64LE(o + 8);
  const v = (hi << 64n) + lo;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const n = Number(a >> 48n) + Number(a & ((1n << 48n) - 1n)) / 2 ** 48;
  return neg ? -n : n;
}

export interface MarginfiBalance {
  bank: string;
  assetShares: number;
  liabilityShares: number;
}

export interface MarginfiAccountState {
  address: string;
  group: string;
  authority: string;
  balances: MarginfiBalance[];
  health: { assetValueMaint: number; liabilityValueMaint: number; timestamp: number; flags: number };
}

export function decodeAccount(address: string, b: Buffer): MarginfiAccountState {
  const balances: MarginfiBalance[] = [];
  for (let i = 0; i < MAX_BALANCES; i++) {
    const o = BALANCES_OFFSET + i * BALANCE_SIZE;
    if ((b[o] ?? 0) !== 1) continue;
    balances.push({ bank: pk(b, o + 1), assetShares: i80f48(b, o + 40), liabilityShares: i80f48(b, o + 56) });
  }
  const h = HEALTH_CACHE_OFFSET;
  return {
    address,
    group: pk(b, 8),
    authority: pk(b, 40),
    balances,
    health: {
      assetValueMaint: i80f48(b, h + 32),
      liabilityValueMaint: i80f48(b, h + 48),
      timestamp: Number(b.readBigInt64LE(h + 96)),
      flags: b.readUInt32LE(h + 104),
    },
  };
}

export interface MarginfiBank {
  address: string;
  mint: string;
  decimals: number;
  assetShareValue: number;
  liabilityShareValue: number;
  assetWeightMaint: number;
  liabilityWeightMaint: number;
  priceUsd: number;
  priceTimestamp: number;
  /** e-mode tag of this bank as collateral (0 = none) */
  emodeTag: number;
  /** e-mode entries when this bank is the liability: collateral tag to maintenance asset weight */
  emodeEntries: { tag: number; assetWeightMaint: number }[];
  /** oracle (and integration) accounts the risk engine expects after the bank, in order */
  oracleAccounts: string[];
}

const ZERO_KEY = "11111111111111111111111111111111";

export function decodeBank(address: string, b: Buffer): MarginfiBank {
  const setup = b[609] ?? 0;
  const oracleAccounts: string[] = [];
  for (let k = 0; k < 5; k++) {
    const key = pk(b, 610 + 32 * k);
    if (key !== ZERO_KEY) oracleAccounts.push(key);
  }
  // oracle setups after FixedJuplend (17) are the newer wrapped oracles; they also read the integration accounts
  if (setup >= 18) for (const o of [1560, 1592, 1624]) {
    const key = pk(b, o);
    if (key !== ZERO_KEY) oracleAccounts.push(key);
  }
  const emodeEntries: { tag: number; assetWeightMaint: number }[] = [];
  for (let k = 0; k < 10; k++) {
    const o = 944 + k * 40;
    const tag = b.readUInt16LE(o);
    if (tag !== 0) emodeEntries.push({ tag, assetWeightMaint: i80f48(b, o + 24) });
  }
  return {
    emodeTag: b.readUInt16LE(920),
    emodeEntries,
    oracleAccounts,
    address,
    mint: pk(b, 8),
    decimals: b[40] ?? 0,
    assetShareValue: i80f48(b, 80),
    liabilityShareValue: i80f48(b, 96),
    assetWeightMaint: i80f48(b, 312),
    liabilityWeightMaint: i80f48(b, 344),
    priceUsd: i80f48(b, 1408),
    priceTimestamp: Number(b.readBigInt64LE(1424)),
  };
}

/** A funded system account used only as the fee payer of a simulation. It never signs. */
const SIM_FEE_PAYER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PULSE_HEALTH = Buffer.from([186, 52, 117, 97, 34, 74, 39, 253]);

export interface MarginfiHealth {
  assetValueMaint: number;
  liabilityValueMaint: number;
  assetValueInit: number;
  liabilityValueInit: number;
  slot: number;
}

/**
 * What marginfi itself computes: simulate the permissionless lending_account_pulse_health instruction and read the
 * health_cache it writes into the account. Nothing is sent to the chain.
 */
export async function simulatePulseHealth(
  ctx: AdapterContext,
  acc: MarginfiAccountState,
  banks: Map<string, MarginfiBank>,
): Promise<MarginfiHealth> {
  const keys = [
    { pubkey: new PublicKey(acc.address), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(acc.group), isSigner: false, isWritable: false },
  ];
  for (const bal of acc.balances) {
    const bank = banks.get(bal.bank);
    if (!bank) throw new Error(`bank ${bal.bank} not read`);
    keys.push({ pubkey: new PublicKey(bank.address), isSigner: false, isWritable: false });
    for (const o of bank.oracleAccounts) keys.push({ pubkey: new PublicKey(o), isSigner: false, isWritable: false });
  }
  const ix = new TransactionInstruction({ programId: new PublicKey(MARGINFI_PROGRAM), keys, data: PULSE_HEALTH });
  const tx = new Transaction({ feePayer: new PublicKey(SIM_FEE_PAYER), recentBlockhash: ZERO_KEY }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix);
  const ser = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const { result, slot } = await rpc<{ value: { err: unknown; accounts?: ({ data: [string, string] } | null)[] } }>(ctx, "simulateTransaction", [
    ser,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [acc.address] } },
  ]);
  const v = result.value;
  if (v.err) throw new Error(`pulse health simulation failed: ${JSON.stringify(v.err)}`);
  const data = v.accounts?.[0]?.data[0];
  if (!data) throw new Error("pulse health simulation returned no account");
  const b = Buffer.from(data, "base64");
  const h = HEALTH_CACHE_OFFSET;
  const mrgnErr = b.readUInt32LE(h + 108);
  if (mrgnErr !== 0) throw new Error(`marginfi risk engine could not load the account (error ${mrgnErr})`);
  return { assetValueInit: i80f48(b, h), liabilityValueInit: i80f48(b, h + 16), assetValueMaint: i80f48(b, h + 32), liabilityValueMaint: i80f48(b, h + 48), slot };
}

/**
 * Maintenance weight of a collateral bank for this account. With e-mode, every liability bank of the account must list
 * the collateral e-mode tag; the lowest listed weight then replaces the bank own weight when it is higher.
 */
export function collateralWeight(bank: MarginfiBank, liabBanks: (MarginfiBank | undefined)[]): number {
  if (bank.emodeTag === 0 || liabBanks.length === 0 || liabBanks.some((l) => !l)) return bank.assetWeightMaint;
  let min = Infinity;
  for (const l of liabBanks) {
    const e = l!.emodeEntries.find((x) => x.tag === bank.emodeTag);
    if (!e) return bank.assetWeightMaint;
    min = Math.min(min, e.assetWeightMaint);
  }
  return Math.max(min, bank.assetWeightMaint);
}

export function buildMarginfiLoan(
  acc: MarginfiAccountState,
  banks: Map<string, MarginfiBank>,
  symbols: Map<string, string>,
  sources: Source[],
  gaps: string[],
  nowSecs: number,
  health?: MarginfiHealth,
): { loan: LoanAccount; positions: Position[] } {
  const collaterals: LoanLeg[] = [];
  const borrows: LoanLeg[] = [];
  const positions: Position[] = [];
  const liabBanks = acc.balances.filter((x) => x.liabilityShares > 0).map((x) => banks.get(x.bank));
  for (const bal of acc.balances) {
    const bank = banks.get(bal.bank);
    if (!bank) {
      gaps.push(`marginfi: bank ${bal.bank} of account ${acc.address} could not be read`);
      continue;
    }
    const age = nowSecs - bank.priceTimestamp;
    const priced = bank.priceUsd > 0 && bank.priceTimestamp > 0 && age <= MAX_PRICE_AGE_SECS;
    if (!priced) {
      gaps.push(`marginfi: bank ${bal.bank} has no recent cached oracle price (age ${bank.priceTimestamp > 0 ? Math.round(age / 3600) + "h" : "unknown"}); its legs in ${acc.address} are unpriced`);
    }
    const sym = symbols.get(bank.mint) ?? bank.mint.slice(0, 4);
    const unit = 10 ** bank.decimals;
    if (bal.assetShares > 0) {
      const amount = (bal.assetShares * bank.assetShareValue) / unit;
      const usd = priced ? amount * bank.priceUsd : undefined;
      if (usd !== undefined) collaterals.push({ mint: bank.mint, symbol: sym, amount, usd, factor: collateralWeight(bank, liabBanks) });
      positions.push({ protocol: "marginfi", kind: "lend", account: acc.address, mint: bank.mint, symbol: sym, amount, ...(usd !== undefined ? { usd } : {}), extra: { bank: bank.address, group: acc.group }, sources });
    }
    if (bal.liabilityShares > 0) {
      const amount = (bal.liabilityShares * bank.liabilityShareValue) / unit;
      const usd = priced ? amount * bank.priceUsd : undefined;
      if (usd !== undefined) borrows.push({ mint: bank.mint, symbol: sym, amount, usd, factor: bank.liabilityWeightMaint });
      positions.push({ protocol: "marginfi", kind: "borrow", account: acc.address, mint: bank.mint, symbol: sym, amount, ...(usd !== undefined ? { usd } : {}), extra: { bank: bank.address, group: acc.group }, sources });
    }
  }
  const reported: NonNullable<LoanAccount["protocolReported"]> = {};
  if (health && health.liabilityValueMaint > 0) {
    reported.healthFactor = health.assetValueMaint / health.liabilityValueMaint;
    // marginfi reports maintenance asset and liability value; LTV as liability over asset weighted by nothing
    // is not what its UI shows, so only the maintenance ratio is filled in
  }
  return { positions, loan: { protocol: "marginfi", account: acc.address, collaterals, borrows, protocolReported: reported, sources } };
}

export const marginfiAdapter: Adapter = {
  id: "marginfi",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const loans: LoanAccount[] = [];
    let found;
    try {
      found = await getProgramAccounts(ctx, MARGINFI_PROGRAM, [{ dataSize: ACCOUNT_SIZE }, { memcmp: { offset: 40, bytes: wallet } }]);
    } catch (e) {
      return { positions, loans, gaps: [`marginfi: could not read accounts: ${(e as Error).message}`] };
    }
    const accounts = found.accounts.map((a) => decodeAccount(a.pubkey, a.data)).filter((a) => a.balances.length > 0);
    if (accounts.length === 0) return { positions, loans, gaps };
    const bankKeys = [...new Set(accounts.flatMap((a) => a.balances.map((b) => b.bank)))];
    const banks = new Map<string, MarginfiBank>();
    let slot = found.slot;
    try {
      const got = await getMultiple(ctx, bankKeys);
      slot = got.slot;
      bankKeys.forEach((k, i) => {
        const a = got.accounts[i];
        if (a) banks.set(k, decodeBank(k, a.data));
      });
    } catch (e) {
      return { positions, loans, gaps: [`marginfi: could not read banks: ${(e as Error).message}`] };
    }
    const symbols = await getSymbols(ctx, [...new Set([...banks.values()].map((b) => b.mint))]).catch(() => new Map<string, string>());
    const nowSecs = Math.floor(ctx.now().getTime() / 1000);
    for (const acc of accounts) {
      const sources = [chainSource(ctx, "getProgramAccounts", found.slot), chainSource(ctx, "getMultipleAccounts", slot)];
      let health: MarginfiHealth | undefined;
      try {
        health = await simulatePulseHealth(ctx, acc, banks);
        sources.push(chainSource(ctx, "simulateTransaction lending_account_pulse_health", health.slot));
      } catch (e) {
        gaps.push(`marginfi: marginfi own health for ${acc.address} unavailable: ${(e as Error).message}`);
      }
      const r = buildMarginfiLoan(acc, banks, symbols, sources, gaps, nowSecs, health);
      loans.push(r.loan);
      positions.push(...r.positions);
    }
    return { positions, loans, gaps };
  },
};
