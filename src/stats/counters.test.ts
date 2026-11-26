import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bump, mark, resetCounters, snapshot } from "./counters.js";

describe("counters", () => {
  it("counts, marks and persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "steady-counters-"));
    process.env.COUNTERS_PATH = join(dir, "c.json");
    resetCounters();
    bump("a"); bump("a"); bump("usd", 0.01); bump("usd", 0.02);
    mark("sweep", "2026-11-26T00:00:00.000Z");
    const s = snapshot();
    expect(s.counts).toEqual({ a: 2, usd: 0.03 });
    expect(s.marks.sweep).toBe("2026-11-26T00:00:00.000Z");
    await new Promise((r) => setTimeout(r, 1200));
    expect(JSON.parse(readFileSync(process.env.COUNTERS_PATH, "utf8")).counts.a).toBe(2);
    resetCounters();
    expect(snapshot().counts.a).toBe(2); // reloaded from disk
    delete process.env.COUNTERS_PATH;
    resetCounters();
  });
});
