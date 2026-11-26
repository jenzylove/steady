// Drift: perp positions, spot deposits and borrows of every sub account of a wallet, with Drift's own margin math
// (health, margin ratio, liquidation price) from @drift-labs/sdk running on chain state.
import { createRequire } from "node:module";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { Adapter, AdapterContext, AdapterResult, Position } from "../types.js";
import { chainSource, rpc } from "./lib.js";

const require = createRequire(import.meta.url);
export const DRIFT_PROGRAM = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";
const USER_DISCRIMINATOR = bs58.encode(Buffer.from([159, 117, 95, 227, 239, 151, 58, 236]));
const USER_SIZE = 4376;

/**
 * The SDK imports gRPC clients whose native binaries do not exist on Windows (dev machine). We never use gRPC, so when the
 * load fails on one of them, stub that module and load again. On Linux (production) the first require succeeds.
 */
function loadSdk(): any {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return require("@drift-labs/sdk");
    } catch (e) {
      const msg = String((e as Error).message);
      const m = msg.match(/Cannot find module '([^']+)'/);
      const native = msg.includes("native binding");
      const target = native ? "@triton-one/yellowstone-grpc" : m?.[1]?.startsWith("helius-laserstream") ? "helius-laserstream" : undefined;
      if (!target) throw e;
      const p = require.resolve(target);
      require.cache[p] = { id: p, filename: p, loaded: true, exports: new Proxy({}, { get: () => class {} }) } as any;
      for (const k of Object.keys(require.cache)) if (k.includes("drift-labs")) delete require.cache[k];
    }
  }
  return require("@drift-labs/sdk");
}

/** An oracle older than this many slots (about one hour) is not trusted for USD values. */
export const STALE_ORACLE_SLOTS = 9000;
const SLOT_SECONDS = 0.4;
const BN_TO_NUM = (bn: any, precision: number) => Number(bn.toString()) / precision;
const redact = (s: string) => s.replace(/api-key=[^&\s"]+/g, "api-key=***");

export const driftAdapter: Adapter = {
  id: "drift",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];
    const authority = new PublicKey(wallet);

    // 1. every Drift user (sub account) of the authority
    const gpa = await rpc<any>(ctx, "getProgramAccounts", [
      DRIFT_PROGRAM,
      {
        encoding: "base64", commitment: "confirmed", withContext: true, dataSlice: { offset: 0, length: 0 },
        filters: [{ dataSize: USER_SIZE }, { memcmp: { offset: 0, bytes: USER_DISCRIMINATOR } }, { memcmp: { offset: 8, bytes: wallet } }],
      },
    ]);
    const userKeys: string[] = (gpa.result.value ?? gpa.result).map((x: any) => x.pubkey);
    if (userKeys.length === 0) return { positions, loans: [], gaps };
    const slot = gpa.result.context?.slot ?? gpa.slot;

    // 2. which markets the accounts touch (read from the raw account bytes), so the SDK only loads those
    const { getMultiple } = await import("./lib.js");
    const { accounts: rawUsers } = await getMultiple(ctx, userKeys);
    const perpIdx = new Set<number>();
    const spotIdx = new Set<number>([0]);
    for (const a of rawUsers) {
      if (!a) continue;
      for (let i = 0; i < 8; i++) {
        const o = 424 + i * 96;
        const used = a.data.readBigInt64LE(o + 8) !== 0n || a.data.readBigInt64LE(o + 16) !== 0n || a.data[o + 94] !== 0 || a.data.readBigUInt64LE(o + 64) !== 0n;
        if (used) perpIdx.add(a.data.readUInt16LE(o + 92));
        const so = 104 + i * 40;
        if (a.data.readBigUInt64LE(so) !== 0n || a.data[so + 35] !== 0) spotIdx.add(a.data.readUInt16LE(so + 32));
      }
    }

    // 3. Drift's own client math on those accounts
    const sdk = loadSdk();
    const perpCfg: any[] = sdk.PerpMarkets["mainnet-beta"];
    const spotCfg: any[] = sdk.SpotMarkets["mainnet-beta"];
    const oracleInfos: any[] = [];
    const seen = new Set<string>();
    for (const i of perpIdx) {
      const c = perpCfg.find((m) => m.marketIndex === i);
      if (!c) { gaps.push(`drift: perp market index ${i} is not in the SDK market list; its positions are not read`); perpIdx.delete(i); continue; }
      if (!seen.has(c.oracle.toBase58())) { seen.add(c.oracle.toBase58()); oracleInfos.push({ publicKey: c.oracle, source: c.oracleSource }); }
    }
    for (const i of spotIdx) {
      const c = spotCfg.find((m) => m.marketIndex === i);
      if (!c) { gaps.push(`drift: spot market index ${i} is not in the SDK market list; its balances are not read`); spotIdx.delete(i); continue; }
      if (!seen.has(c.oracle.toBase58())) { seen.add(c.oracle.toBase58()); oracleInfos.push({ publicKey: c.oracle, source: c.oracleSource }); }
    }
    const conn = new Connection(ctx.heliusRpcUrl, { commitment: "confirmed", fetch: ctx.fetch as any });
    const loader = new sdk.BulkAccountLoader(conn, "confirmed", 0);
    const client = new sdk.DriftClient({
      connection: conn,
      wallet: new sdk.Wallet(Keypair.generate()),
      env: "mainnet-beta",
      perpMarketIndexes: [...perpIdx],
      spotMarketIndexes: [...spotIdx],
      oracleInfos,
      skipLoadUsers: true,
      accountSubscription: { type: "polling", accountLoader: loader },
    });
    const users: any[] = [];
    try {
      await client.subscribe();
      for (const key of userKeys) {
        const user = new sdk.User({
          driftClient: client,
          userAccountPublicKey: new PublicKey(key),
          accountSubscription: { type: "polling", accountLoader: loader },
        });
        await user.subscribe();
        users.push(user);
      }
      const srcs = [chainSource(ctx, "getProgramAccounts", slot), chainSource(ctx, "getMultipleAccounts", slot)];
      for (const user of users) {
        const key: string = user.userAccountPublicKey.toBase58();
        const acct = user.getUserAccount();
        const subAccountId: number = acct.subAccountId;
        let account: Record<string, unknown> = {};
        try {
          const totalCollateral = BN_TO_NUM(user.getTotalCollateral("Initial"), 1e6);
          const marginReq = BN_TO_NUM(user.getMarginRequirement("Maintenance"), 1e6);
          const free = BN_TO_NUM(user.getFreeCollateral("Initial"), 1e6);
          const leverage = BN_TO_NUM(user.getLeverage(), 1e4);
          const mr = user.getMarginRatio();
          const marginRatio = mr.gt(new sdk.BN(Number.MAX_SAFE_INTEGER)) ? null : BN_TO_NUM(mr, 1e4);
          account = {
            subAccountId, userAccount: key, healthPercent: user.getHealth(),
            totalCollateralUsd: totalCollateral, maintenanceMarginUsd: marginReq, freeCollateralUsd: free,
            accountLeverage: leverage, marginRatio, liquidatable: user.canBeLiquidated?.().canBeLiquidated ?? undefined,
          };
        } catch (e) {
          gaps.push(`drift: account ${key} margin summary failed (${redact((e as Error).message)})`);
        }

        // perp positions
        for (const pos of user.getActivePerpPositions()) {
          const idx: number = pos.marketIndex;
          try {
            const market = client.getPerpMarketAccount(idx);
            const name = sdk.decodeName ? sdk.decodeName(market.name) : `PERP-${idx}`;
            const oracle = client.getOracleDataForPerpMarket(idx);
            const mark = BN_TO_NUM(oracle.price, 1e6);
            const oracleSlot = Number(oracle.slot?.toString?.() ?? 0);
            const ageSlots = slot - oracleSlot;
            const stale = !(oracleSlot > 0) || ageSlots > STALE_ORACLE_SLOTS;
            if (stale) gaps.push(`drift: oracle of ${name} last updated ${(ageSlots * SLOT_SECONDS / 86400).toFixed(0)} days ago (slot ${oracleSlot}); Drift's own price, margin and liquidation numbers for ${key} are frozen at that time, so no USD value is given`);
            const base = BN_TO_NUM(pos.baseAssetAmount, 1e9);
            const entry = base !== 0 ? BN_TO_NUM(sdk.calculateEntryPrice(pos), 1e6) : null;
            const breakEven = base !== 0 && sdk.calculateBreakEvenPrice ? BN_TO_NUM(sdk.calculateBreakEvenPrice(pos), 1e6) : null;
            const upnl = BN_TO_NUM(user.getUnrealizedPNL(true, idx), 1e6);
            let liq: number | null = null;
            try {
              const l = user.liquidationPrice(idx);
              liq = l.lt(new sdk.BN(0)) ? null : BN_TO_NUM(l, 1e6);
            } catch { /* no liquidation price for this position */ }
            const notional = Math.abs(base) * mark;
            positions.push({
              protocol: "drift", kind: "perp", account: key, symbol: name, amount: base, ...(stale ? {} : { usd: notional }),
              extra: {
                oracleSlot, oracleAgeSlots: ageSlots, oracleStale: stale,
                market: name, marketIndex: idx, side: base >= 0 ? "long" : "short", size: base,
                notionalAtOracleUsd: notional, entryPrice: entry, breakEvenPrice: breakEven, oraclePrice: mark,
                unrealizedPnlUsd: upnl, driftLiquidationPrice: liq,
                driftMarginRatio: (account as any).marginRatio ?? null, driftAccountLeverage: (account as any).accountLeverage ?? null,
                driftHealthPercent: (account as any).healthPercent ?? null,
                usdMeaning: "position notional (absolute); unrealizedPnlUsd is the PnL; collateral is in the account block",
                account,
              },
              sources: srcs,
            });
          } catch (e) {
            gaps.push(`drift: perp market ${idx} of ${key} unreadable (${redact((e as Error).message)})`);
          }
        }

        // spot deposits and borrows (collateral and debt of the same account)
        for (const sp of user.getActiveSpotPositions()) {
          const idx: number = sp.marketIndex;
          try {
            const market = client.getSpotMarketAccount(idx);
            const name = sdk.decodeName ? sdk.decodeName(market.name) : `SPOT-${idx}`;
            const amtBn = user.getTokenAmount(idx);
            const amount = BN_TO_NUM(amtBn, 10 ** market.decimals);
            const od = client.getOracleDataForSpotMarket(idx);
            const price = BN_TO_NUM(od.price, 1e6);
            const oSlot = Number(od.slot?.toString?.() ?? 0);
            const stale = !(oSlot > 0) || slot - oSlot > STALE_ORACLE_SLOTS;
            if (stale) gaps.push(`drift: oracle of spot market ${name} last updated ${((slot - oSlot) * SLOT_SECONDS / 86400).toFixed(0)} days ago; balance of ${key} given in tokens, no USD value`);
            positions.push({
              protocol: "drift", kind: amount >= 0 ? "lend" : "borrow", account: key, mint: market.mint.toBase58(), symbol: name,
              amount: Math.abs(amount), ...(stale ? {} : { usd: Math.abs(amount) * price }),
              extra: { marketIndex: idx, subAccountId, oracleStale: stale, oraclePrice: price, account },
              sources: srcs,
            });
          } catch (e) {
            gaps.push(`drift: spot market ${idx} of ${key} unreadable (${redact((e as Error).message)})`);
          }
        }
      }
    } catch (e) {
      if (process.env.DEBUG_ADAPTERS) console.error((e as Error).stack); gaps.push(`drift: could not read accounts (${redact((e as Error).message)})`);
    } finally {
      for (const u of users) { try { await u.unsubscribe(); } catch { /* ignore */ } }
      try { await client.unsubscribe(); } catch { /* ignore */ }
    }
    return { positions, loans: [], gaps };
  },
};
