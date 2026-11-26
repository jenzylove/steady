import { describe, it, expect, beforeAll } from "vitest";
import { canonical, sign, verify } from "./memo.js";

beforeAll(() => { process.env.MEMO_SIGNER_KEY ??= "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; });

describe("memo", () => {
  it("canonical sorts keys at every level", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });
  it("signs and verifies, and fails when a field changes", async () => {
    const m = await sign({ wallet: "W", action: "repay", usd: 120 });
    expect(await verify(m)).toBe(true);
    expect(await verify({ ...m, body: { ...m.body, usd: 121 } })).toBe(false);
  });
});
