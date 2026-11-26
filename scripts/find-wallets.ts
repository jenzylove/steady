// Finds real mainnet wallets holding positions per protocol (dev helper). Prints addresses only.
import { makeContext } from "../src/engine/context.js";
import { rpc } from "../src/engine/adapters/lib.js";
import bs58 from "bs58";

const ctx = makeContext();
const which = process.argv[2];

async function owners(mints: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const m of mints) {
    try {
      const l = await rpc<any>(ctx, "getTokenLargestAccounts", [m]);
      const acc = l.result.value[0]?.address;
      if (!acc) continue;
      const a = await rpc<any>(ctx, "getAccountInfo", [acc, { encoding: "jsonParsed" }]);
      const o = a.result.value?.data?.parsed?.info?.owner;
      if (o) out.push(o);
    } catch {}
  }
  return out;
}

async function main() {
  if (which === "orca") {
    const r = await rpc<any>(ctx, "getProgramAccounts", ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", {
      encoding: "base64", dataSlice: { offset: 40, length: 48 },
      filters: [{ dataSize: 216 }, { memcmp: { offset: 8, bytes: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" } }],
    }]);
    const rows = r.result.map((x: any) => { const b = Buffer.from(x.account.data[0], "base64"); return { mint: bs58.encode(b.subarray(0, 32)), liq: b.readBigUInt64LE(32) + (b.readBigUInt64LE(40) << 64n) }; });
    rows.sort((a: any, b: any) => (a.liq < b.liq ? 1 : -1));
    const mints = rows.slice(0, 12).map((x: any) => x.mint);
    console.log("positions in pool:", r.result.length);
    console.log((await owners(mints)).join("\n"));
  } else if (which === "ray") {
    const r = await rpc<any>(ctx, "getProgramAccounts", ["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", {
      encoding: "base64", dataSlice: { offset: 9, length: 88 },
      filters: [{ dataSize: 281 }, { memcmp: { offset: 41, bytes: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj" } }],
    }]);
    const rows = r.result.map((x: any) => { const b = Buffer.from(x.account.data[0], "base64"); return { mint: bs58.encode(b.subarray(0, 32)), liq: b.readBigUInt64LE(72) + (b.readBigUInt64LE(80) << 64n) }; });
    rows.sort((a: any, b: any) => (a.liq < b.liq ? 1 : -1));
    console.log("clmm positions", rows.length);
    console.log((await owners(rows.slice(0, 8).map((x: any) => x.mint))).join(","));
    const l = await rpc<any>(ctx, "getTokenLargestAccounts", ["8HoQnePLqPj4M7PUDzfw8e3Ymdwgc7NLGnaTUapubyvu"]);
    for (const v of l.result.value.slice(0, 5)) { const a = await rpc<any>(ctx, "getAccountInfo", [v.address, { encoding: "jsonParsed" }]); console.log("LP holder", a.result.value?.data?.parsed?.info?.owner, v.uiAmountString); }
  } else if (which === "met") {
    const r = await rpc<any>(ctx, "getProgramAccounts", ["LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", {
      encoding: "base64", dataSlice: { offset: 40, length: 32 },
      filters: [{ memcmp: { offset: 8, bytes: "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y" } }, { dataSize: 8120 }],
    }]);
    console.log("positions", r.result.length);
    console.log([...new Set(r.result.map((x: any) => bs58.encode(Buffer.from(x.account.data[0], "base64"))))].slice(0, 30).join(","));
  } else if (which === "drift") {
    const disc = bs58.encode(Buffer.from([159, 117, 95, 227, 239, 151, 58, 236]));
    const r = await rpc<any>(ctx, "getProgramAccountsV2", ["dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH", {
      encoding: "base64", dataSlice: { offset: 0, length: 520 }, limit: 3000,
      filters: [{ dataSize: 4376 }, { memcmp: { offset: 0, bytes: disc } }, { memcmp: { offset: 516, bytes: "11" } }],
    }]);
    const acc = r.result.accounts ?? r.result;
    console.log("page", acc.length);
    let n = 0;
    for (const x of acc) {
      const b = Buffer.from(x.account.data[0], "base64");
      const base = b.readBigInt64LE(424 + 8);
      if (base !== 0n && Number(base < 0n ? -base : base) > 1e9) {
        console.log(bs58.encode(b.subarray(8, 40)), x.pubkey, String(base));
        if (++n >= 8) break;
      }
    }
  } else if (which === "jup") {
    const r = await rpc<any>(ctx, "getProgramAccounts", ["PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBoq5jP", {
      encoding: "base64", dataSlice: { offset: 8, length: 32 }, filters: [{ dataSize: 256 }],
    }]);
    console.log("count", r.result.length);
    console.log([...new Set(r.result.slice(0, 60).map((x: any) => bs58.encode(Buffer.from(x.account.data[0], "base64"))))].join("\n"));
  }
}
main().catch((e) => { console.error(String(e).replace(/api-key=[^&\s]+/g, "api-key=***")); process.exit(1); });
