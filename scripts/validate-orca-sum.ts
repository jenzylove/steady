// Sums the token amounts of every position of the Orca SOL/USDC pool with our decoder and math and compares with the pool vaults.
import { makeContext } from "../src/engine/context.js";
import { rpc, getMultiple, clmmAmounts } from "../src/engine/adapters/lib.js";
import { decodePosition, decodeWhirlpool } from "../src/engine/adapters/orca.js";
const ctx = makeContext();
const POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const { accounts: [pa] } = await getMultiple(ctx, [POOL]);
const pool = decodeWhirlpool(POOL, pa!.data);
const r = await rpc<any>(ctx, "getProgramAccounts", ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", { encoding: "base64", filters: [{ dataSize: 216 }, { memcmp: { offset: 8, bytes: POOL } }] }]);
let a = 0, b = 0, inRange = 0, feeA = 0n, feeB = 0n;
for (const x of r.result) {
  const p = decodePosition(x.pubkey, Buffer.from(x.account.data[0], "base64"));
  const m = clmmAmounts(p.liquidity, pool.sqrtPrice, p.tickLower, p.tickUpper, pool.tickCurrent);
  a += m.amountA; b += m.amountB; if (m.inRange && p.liquidity > 0n) inRange++; feeA += p.feeOwedA; feeB += p.feeOwedB;
}
const { accounts: v } = await getMultiple(ctx, [pool.vaultA, pool.vaultB]);
const vA = Number(v[0]!.data.readBigUInt64LE(64)), vB = Number(v[1]!.data.readBigUInt64LE(64));
console.log("positions", r.result.length, "in range with liquidity", inRange);
console.log("SOL  sum of positions", (a / 1e9).toFixed(2), "vault", (vA / 1e9).toFixed(2), "ratio", (a / vA).toFixed(5));
console.log("USDC sum of positions", (b / 1e6).toFixed(2), "vault", (vB / 1e6).toFixed(2), "ratio", (b / vB).toFixed(5));
process.exit(0);
