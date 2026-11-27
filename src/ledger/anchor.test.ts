import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { mkdtempSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Ledger } from "./store.js";
import { anchorPending, batchRoot, batches } from "./anchor.js";

const seeded = () => {
  const p = join(mkdtempSync(join(tmpdir(), "steady-anchor-")), "ledger.jsonl");
  copyFileSync(resolve("ledger", "seed-ledger.jsonl"), p);
  return new Ledger(p);
};

describe("ledger anchors", () => {
  beforeAll(() => { process.env.MEMO_SIGNER_KEY ||= generatePrivateKey(); });
  it("roots are order independent", () => {
    expect(batchRoot(["b", "a"])).toBe(batchRoot(["a", "b"]));
  });
  it("anchors the original digests once per batch, even after a later signed update", async () => {
    const l = seeded();
    const first = batches(l);
    const sent: string[] = [];
    const a1 = await anchorPending(l, async (b, r) => { sent.push(`${b} ${r}`); return "0xabc"; });
    expect(a1.length).toBe(first.size);
    expect(a1[0]!.count).toBe([...first.values()][0]!.length);
    // A later version of a call (as when the frontier answer is added) must not change the anchored root.
    const e = l.load()[0]!;
    if (!e.settlement) await l.update(e.prediction.id, { params: { ...e.prediction.params, note: "later" } });
    const a2 = await anchorPending(l, async () => { throw new Error("must not resend"); });
    expect(a2).toEqual([]);
    expect(l.anchors().length).toBe(first.size);
    expect(sent.length).toBe(first.size);
  });
});
