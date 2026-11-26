import { describe, expect, it } from "vitest";
import { stakeAdapter } from "./stake.js";
import { loadFixture } from "./fixtures.js";

describe("stake adapter (recorded fixtures)", () => {
  it("reads native stake accounts with vote account and state", async () => {
    const { wallet, ctx } = loadFixture("wallet-stake");
    const r = await stakeAdapter.read(wallet, ctx);
    const native = r.positions.filter((p) => p.protocol === "native-stake");
    expect(native).toHaveLength(2);
    expect(native.map((p) => p.amount).sort()).toEqual([expect.closeTo(4.512365537, 9), expect.closeTo(6.017044531, 9)]);
    for (const p of native) {
      expect(p.kind).toBe("stake");
      expect(p.extra).toMatchObject({ voteAccount: "BzgTDU98GGMaq5RWkWcDLsX7W31VqRcEyNiukXzYV2Jd", state: "active" });
      expect(p.sources[0]).toMatchObject({ kind: "chain" });
      expect(p.sources[0]!.slot).toBeGreaterThan(0);
      expect(p.usd).toBeGreaterThan(0);
    }
  });

  it("marks LSTs with extra.lst and a SOL value", async () => {
    const { wallet, ctx } = loadFixture("wallet-tokens");
    const r = await stakeAdapter.read(wallet, ctx);
    const lsts = r.positions.filter((p) => p.extra?.lst === true);
    const msol = lsts.find((p) => p.symbol === "mSOL")!;
    expect(msol.kind).toBe("stake");
    expect(msol.amount).toBeCloseTo(16526.416569763, 6);
    expect(msol.extra!.solValue as number).toBeGreaterThan(msol.amount);
    expect(r.positions.filter((p) => p.protocol === "native-stake")).toHaveLength(0);
  });
});
