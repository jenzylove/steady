import { describe, expect, it } from "vitest";
import { recentActivity } from "./history.js";
import { loadFixture } from "./fixtures.js";

describe("recentActivity (recorded fixtures)", () => {
  it("summarises transactions with counterparties", async () => {
    const { wallet, ctx } = loadFixture("wallet-tokens");
    const r = await recentActivity(wallet, ctx, 20);
    expect(r.items).toHaveLength(20);
    expect(r.gaps).toEqual([]);
    for (const t of r.items) {
      expect(t.signature.length).toBeGreaterThan(40);
      expect(t.timestamp).toBeGreaterThan(1_600_000_000);
      expect(typeof t.type).toBe("string");
      expect(t.counterparties).not.toContain(wallet);
    }
    expect(r.items.some((t) => t.counterparties.length > 0)).toBe(true);
  });

  it("returns a gap when the API fails and never leaks the key", async () => {
    const ctx = { heliusRpcUrl: "https://x/?api-key=SECRET", now: () => new Date(), fetch: (async () => new Response("no", { status: 401 })) as typeof fetch };
    const r = await recentActivity("w", ctx, 5);
    expect(r.items).toEqual([]);
    expect(r.gaps.join(" ")).not.toContain("SECRET");
  });
});
