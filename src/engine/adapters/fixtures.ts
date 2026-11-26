import { readFileSync } from "node:fs";
import { replayContext, type Recorded } from "../__fixtures__/replay.js";

export function loadFixture(name: string) {
  const f = JSON.parse(readFileSync(new URL(`../__fixtures__/${name}.json`, import.meta.url), "utf8")) as { wallet: string; nowIso: string; records: Recorded[] };
  return { wallet: f.wallet, ctx: replayContext(f.records, f.nowIso) };
}
