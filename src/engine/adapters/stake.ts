import type { Adapter, AdapterContext, AdapterResult, Position } from "../types.js";
import { JUP_TAG_URL, fetchRetry, SOL_MINT, STAKE_PROGRAM, chainSource, readPrices, readSymbols, readTokenAccounts, rpc } from "./util.js";

/** Fallback set used when the Jupiter LST tag list cannot be read. */
export const KNOWN_LSTS: Record<string, string> = {
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm": "INF",
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v: "jupSOL",
};

const U64_MAX = "18446744073709551615";

async function lstMints(ctx: AdapterContext, gaps: string[]): Promise<Set<string>> {
  const set = new Set(Object.keys(KNOWN_LSTS));
  try {
    const res = await fetchRetry(ctx, JUP_TAG_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as { id: string; tags?: string[] }[];
    for (const t of list) if (t.tags?.includes("lst") && t.id !== SOL_MINT) set.add(t.id);
  } catch (e) {
    gaps.push(`Jupiter LST tag list unavailable, using built in list only (JitoSOL, mSOL, bSOL, INF, jupSOL): ${(e as Error).message}`);
  }
  return set;
}

export const stakeAdapter: Adapter = {
  id: "stake",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];

    let epoch: number | undefined;
    try {
      epoch = (await rpc<{ epoch: number }>(ctx, "getEpochInfo", [])).result.epoch;
    } catch (e) {
      gaps.push(`Current epoch not read, stake state not classified: ${(e as Error).message}`);
    }

    // Native stake accounts: staker authority at byte offset 12, withdrawer at 44.
    const found = new Map<string, any>();
    let stakeOk = true;
    for (const offset of [12, 44]) {
      try {
        const { result } = await rpc<any[]>(ctx, "getProgramAccounts", [
          STAKE_PROGRAM,
          { encoding: "jsonParsed", commitment: "confirmed", filters: [{ memcmp: { offset, bytes: wallet } }] },
        ]);
        for (const a of result) found.set(a.pubkey, a);
      } catch (e) {
        stakeOk = false;
        gaps.push(`Native stake accounts not fully read (authority offset ${offset}): ${(e as Error).message}`);
      }
    }
    let stakeSlot: number | undefined;
    try {
      stakeSlot = (await rpc<number>(ctx, "getSlot", [{ commitment: "confirmed" }])).result;
    } catch {
      gaps.push("Slot for the stake read is unavailable.");
    }

    const lstSet = await lstMints(ctx, gaps);
    const ta = await readTokenAccounts(wallet, ctx);
    gaps.push(...ta.gaps);
    const lsts = new Map<string, { amount: number; accounts: string[] }>();
    for (const a of ta.accounts) {
      if (a.amount > 0 && lstSet.has(a.mint)) {
        const cur = lsts.get(a.mint) ?? { amount: 0, accounts: [] };
        cur.amount += a.amount;
        cur.accounts.push(a.account);
        lsts.set(a.mint, cur);
      }
    }

    const lstMintList = [...lsts.keys()];
    const [px, sy] = await Promise.all([
      readPrices([SOL_MINT, ...lstMintList], ctx),
      lstMintList.length ? readSymbols(lstMintList, ctx) : Promise.resolve({ meta: new Map<string, { symbol?: string }>(), gaps: [] as string[] }),
    ]);
    gaps.push(...px.gaps, ...sy.gaps);
    const solPrice = px.prices.get(SOL_MINT);
    const priceSrc = px.sources.slice(0, 1);

    for (const a of found.values()) {
      const parsed = a.account?.data?.parsed;
      const info = parsed?.info;
      const lamports = Number(a.account?.lamports ?? 0);
      const meta = info?.meta;
      const deleg = info?.stake?.delegation;
      const reserve = Number(meta?.rentExemptReserve ?? 0);
      let amount: number;
      let state = String(parsed?.type ?? "unknown");
      const extra: Record<string, unknown> = {
        stakeAccount: a.pubkey,
        totalLamports: lamports,
        staker: meta?.authorized?.staker,
        withdrawer: meta?.authorized?.withdrawer,
        lockupUnixTimestamp: meta?.lockup?.unixTimestamp,
        lockupCustodian: meta?.lockup?.custodian,
      };
      if (deleg) {
        amount = Number(deleg.stake) / 1e9;
        extra.voteAccount = deleg.voter;
        extra.activationEpoch = Number(deleg.activationEpoch);
        extra.deactivationEpoch = deleg.deactivationEpoch === U64_MAX ? null : Number(deleg.deactivationEpoch);
        if (epoch !== undefined) {
          const act = Number(deleg.activationEpoch);
          const deact = deleg.deactivationEpoch === U64_MAX ? Infinity : Number(deleg.deactivationEpoch);
          state = epoch > deact ? "inactive" : epoch === deact ? "deactivating" : epoch > act ? "active" : "activating";
        }
      } else {
        amount = Math.max(0, lamports - reserve) / 1e9;
        extra.voteAccount = null;
      }
      extra.state = state;
      positions.push({
        protocol: "native-stake",
        kind: "stake",
        account: a.pubkey,
        mint: SOL_MINT,
        symbol: "SOL",
        amount,
        ...(solPrice !== undefined ? { usd: amount * solPrice } : {}),
        extra,
        sources: [chainSource(ctx, "getProgramAccounts(Stake11111111111111111111111111111111111111)", stakeSlot), ...(solPrice !== undefined ? priceSrc : [])],
      });
    }
    if (!stakeOk && found.size === 0) gaps.push("Native stake could not be confirmed for this wallet.");

    for (const [mint, v] of lsts) {
      const p = px.prices.get(mint);
      const symbol = sy.meta.get(mint)?.symbol ?? KNOWN_LSTS[mint];
      const extra: Record<string, unknown> = { lst: true, tokenAccounts: v.accounts };
      let usd: number | undefined;
      if (p !== undefined) {
        usd = v.amount * p;
        if (solPrice !== undefined) {
          extra.solValue = usd / solPrice;
          extra.solPerToken = p / solPrice;
        } else gaps.push(`SOL price unavailable; SOL value of ${symbol ?? mint} not computed.`);
      } else gaps.push(`No Jupiter price for LST ${symbol ?? mint}; SOL value not computed.`);
      positions.push({
        protocol: "lst",
        kind: "stake",
        mint,
        ...(symbol ? { symbol } : {}),
        ...(v.accounts.length === 1 ? { account: v.accounts[0]! } : {}),
        amount: v.amount,
        ...(usd !== undefined ? { usd } : {}),
        extra,
        sources: [...ta.sources, ...(p !== undefined ? priceSrc : [])],
      });
    }

    return { positions, loans: [], gaps };
  },
};
