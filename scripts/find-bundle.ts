import { makeContext } from "../src/engine/context.js";
import { rpc } from "../src/engine/adapters/lib.js";
import bs58 from "bs58";
const ctx = makeContext();
const r = await rpc<any>(ctx, "getProgramAccounts", ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", { encoding: "base64", filters: [{ memcmp: { offset: 0, bytes: "NgtjH3CB1T1" } }] }]);
console.log("bundles", r.result.length);
const withBits = r.result.map((x: any) => { const b = Buffer.from(x.account.data[0], "base64"); return { mint: bs58.encode(b.subarray(8, 40)), bits: [...b.subarray(40, 72)].reduce((s, v) => s + v.toString(2).replace(/0/g, "").length, 0) }; }).filter((x: any) => x.bits > 0).sort((a: any, b: any) => b.bits - a.bits).slice(0, 25);
for (const w of withBits) { try {
  const l = await rpc<any>(ctx, "getTokenLargestAccounts", [w.mint]);
  const a = await rpc<any>(ctx, "getAccountInfo", [l.result.value[0].address, { encoding: "jsonParsed" }]);
  console.log(w.mint, w.bits, a.result.value?.data?.parsed?.info?.owner, a.result.value?.owner);
} catch {} }
