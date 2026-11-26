import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayFetch, type RecordedCall as Recorded } from "../__fixtures__/replay.js";
import { healthFactor } from "../risk/health.js";
import type { Adapter, AdapterResult } from "../types.js";
import { kaminoAdapter } from "./kamino.js";
import { marginfiAdapter } from "./marginfi.js";
import { saveAdapter } from "./save.js";

function fixture(protocol: string) {
  const f = JSON.parse(readFileSync(new URL(`../__fixtures__/lending-${protocol}.json`, import.meta.url), "utf8")) as { wallets: string[]; nowIso: string; records: Recorded[] };
  return { wallets: f.wallets, ctx: { heliusRpcUrl: "https://mainnet.helius-rpc.com/?api-key=TESTKEY", fetch: replayFetch(f.records), now: () => new Date(f.nowIso) } };
}

async function readAll(adapter: Adapter, protocol: string) {
  const { wallets, ctx } = fixture(protocol);
  const out: AdapterResult[] = [];
  for (const w of wallets) out.push(await adapter.read(w, ctx));
  return out;
}

function expectSourced(r: AdapterResult) {
  for (const x of [...r.positions, ...r.loans]) {
    expect(x.sources.length).toBeGreaterThan(0);
    for (const s of x.sources) {
      expect(s.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(JSON.stringify(s)).not.toMatch(/api-key/i);
      if (s.kind === "chain") expect(s.slot).toBeGreaterThan(0);
    }
  }
}

const within1pct = (ours: number, theirs: number) => Math.abs(ours / theirs - 1) < 0.01;

describe("kamino adapter (recorded)", () => {
  it("matches Kamino health within 1% and handles borrow factors and elevation groups", async () => {
    const all = await readAll(kaminoAdapter, "kamino");
    const loans = all.flatMap((r) => r.loans);
    expect(loans.length).toBe(4);
    all.forEach(expectSourced);
    for (const l of loans) {
      const rep = l.protocolReported?.healthFactor;
      expect(rep).toBeGreaterThan(1);
      expect(within1pct(healthFactor(l), rep!)).toBe(true);
    }
    expect(loans.some((l) => l.borrows.some((b) => b.factor === 1.25))).toBe(true);
    const eg = all[1]!.loans.find((l) => l.collaterals.some((c) => c.factor === 0.95))!;
    expect(eg.borrows.every((b) => b.factor === 1)).toBe(true);
  });
});

describe("marginfi adapter (recorded)", () => {
  it("matches marginfi simulated health within 1%, including e-mode weights", async () => {
    const all = await readAll(marginfiAdapter, "marginfi");
    const loans = all.flatMap((r) => r.loans);
    expect(loans.length).toBe(2);
    all.forEach(expectSourced);
    for (const l of loans) {
      const rep = l.protocolReported?.healthFactor;
      expect(rep).toBeGreaterThan(1);
      expect(within1pct(healthFactor(l), rep!)).toBe(true);
    }
    const lst = all[0]!.loans[0]!;
    expect(lst.collaterals[0]!.factor).toBeGreaterThan(0.9);
    expect(lst.borrows[0]!.factor).toBeCloseTo(1.1, 5);
  });
});

describe("save adapter (recorded)", () => {
  it("matches the obligation health within 1% and states stale reserves as a gap", async () => {
    const all = await readAll(saveAdapter, "save");
    all.forEach(expectSourced);
    const big = all[0]!.loans.find((l) => l.collaterals.length === 3)!;
    expect(within1pct(healthFactor(big), big.protocolReported!.healthFactor!)).toBe(true);
    // an obligation whose reserve is stale is valued from its stored numbers, stated as a gap, and then matches exactly
    const gaps = all.flatMap((r) => r.gaps).filter((g) => g.includes("stored values"));
    expect(gaps.length).toBeGreaterThan(0);
    const staleLoan = all.flatMap((r) => r.loans).find((l) => l.borrows.length > 0 && gaps.some((g) => g.includes(l.account)))!;
    expect(staleLoan).toBeTruthy();
    expect(within1pct(healthFactor(staleLoan), staleLoan.protocolReported!.healthFactor!)).toBe(true);
  });
});
