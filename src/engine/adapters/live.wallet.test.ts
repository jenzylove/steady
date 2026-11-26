// Live comparison against independent reads. Runs only with LIVE=1 (needs HELIUS_API_KEY in .env).
import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { makeContext } from "../context.js";
import { walletAdapter } from "./wallet.js";
import { stakeAdapter } from "./stake.js";
import { recentActivity } from "./history.js";
import { rpc } from "./util.js";

const live = process.env.LIVE === "1";
const TOKENS_WALLET = "J6DV46TYWk359ym6Uks5FT7ehfnWhcjVrHYowCbYLfXR";
const STAKE_WALLET = "5ECz5NM8Y7m6avBxd5bEh4hNzeZfBk3wg3BxGRppypLr";

describe.skipIf(!live)("live wallet adapters", () => {
  it("token balances match Helius DAS getAssetsByOwner", async () => {
    const ctx = makeContext();
    const r = await walletAdapter.read(TOKENS_WALLET, ctx);
    const das = (await rpc<any>(ctx, "getAssetsByOwner", { ownerAddress: TOKENS_WALLET, page: 1, limit: 1000, displayOptions: { showFungible: true, showNativeBalance: true } })).result;
    const dasFungible = (das.items as any[]).filter((a) => a.token_info?.balance !== undefined && a.interface !== "V1_NFT" && !a.compression?.compressed);
    const mine = new Map(r.positions.filter((p) => p.kind === "token" && p.extra?.native !== true).map((p) => [p.mint!, p.amount]));
    let matched = 0;
    const diffs: string[] = [];
    for (const a of dasFungible) {
      const bal = Number(a.token_info.balance) / 10 ** a.token_info.decimals;
      if (bal === 0) continue;
      const m = mine.get(a.id);
      if (m !== undefined && Math.abs(m - bal) <= Math.max(1e-9, bal * 1e-9)) matched++;
      else diffs.push(`${a.id} das=${bal} mine=${m}`);
    }
    const sol = r.positions.find((p) => p.extra?.native === true)!;
    console.log(`TOKENS wallet: adapter tokens=${mine.size}, DAS fungible nonzero=${dasFungible.filter((a) => Number(a.token_info.balance) > 0).length}, matched=${matched}, diffs=${diffs.length}`);
    console.log(`SOL adapter=${sol.amount} DAS nativeBalance=${das.nativeBalance?.lamports / 1e9}`);
    if (diffs.length) console.log(diffs.join("\n"));
    expect(diffs).toEqual([]);
    expect(Math.abs(sol.amount - das.nativeBalance.lamports / 1e9)).toBeLessThan(0.01);
  }, 60000);

  it("stake matches a raw account decode", async () => {
    const ctx = makeContext();
    const r = await stakeAdapter.read(STAKE_WALLET, ctx);
    const native = r.positions.filter((p) => p.protocol === "native-stake");
    expect(native.length).toBeGreaterThan(0);
    for (const p of native) {
      const acc = (await rpc<any>(ctx, "getAccountInfo", [p.account, { encoding: "base64" }])).result.value;
      const b = Buffer.from(acc.data[0], "base64");
      const voter = bs58.encode(b.subarray(124, 156));
      const stake = Number(b.readBigUInt64LE(156)) / 1e9;
      console.log(`STAKE ${p.account} adapter=${p.amount} raw=${stake} vote adapter=${p.extra!.voteAccount} raw=${voter}`);
      expect(p.amount).toBeCloseTo(stake, 9);
      expect(p.extra!.voteAccount).toBe(voter);
    }
  }, 60000);

  it("history returns items", async () => {
    const r = await recentActivity(TOKENS_WALLET, makeContext(), 50);
    console.log(`HISTORY items=${r.items.length} gaps=${r.gaps.length}`);
    expect(r.items.length).toBe(50);
  }, 60000);
});
