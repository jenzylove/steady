// Live check of the lending adapters against the protocol numbers. Runs only with LIVE=1 (needs HELIUS_API_KEY in .env).
import { describe, expect, it } from "vitest";
import { makeContext } from "../context.js";
import { healthFactor } from "../risk/health.js";
import { kaminoAdapter } from "./kamino.js";
import { marginfiAdapter } from "./marginfi.js";

const live = process.env.LIVE === "1";

describe.skipIf(!live)("live lending adapters", () => {
  it("kamino health matches Kamino within 1%", async () => {
    const r = await kaminoAdapter.read("44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS", makeContext());
    expect(r.loans.length).toBeGreaterThan(0);
    for (const l of r.loans) if (l.protocolReported?.healthFactor) expect(Math.abs(healthFactor(l) / l.protocolReported.healthFactor - 1)).toBeLessThan(0.01);
  }, 60_000);
  it("marginfi health matches marginfi within 1%", async () => {
    const r = await marginfiAdapter.read("7USMPgaFyArTX55e6rD3YujsSZmLntFStrkJwxaZMTUt", makeContext());
    expect(r.loans.length).toBeGreaterThan(0);
    for (const l of r.loans) if (l.protocolReported?.healthFactor) expect(Math.abs(healthFactor(l) / l.protocolReported.healthFactor - 1)).toBeLessThan(0.01);
  }, 60_000);
});
