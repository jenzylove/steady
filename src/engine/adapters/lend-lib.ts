// Helpers shared by the lending adapters (Kamino, marginfi, Save).
import type { AdapterContext } from "../types.js";
import { rpc } from "./lib.js";

export interface GpaAccount {
  pubkey: string;
  data: Buffer;
}

/** getProgramAccounts with the slot of the read. */
export async function getProgramAccounts(
  ctx: AdapterContext,
  program: string,
  filters: unknown[],
  dataSlice?: { offset: number; length: number },
): Promise<{ accounts: GpaAccount[]; slot: number }> {
  const cfg: Record<string, unknown> = { encoding: "base64", filters, withContext: true, commitment: "confirmed" };
  if (dataSlice) cfg["dataSlice"] = dataSlice;
  const { result, slot } = await rpc<{ value: { pubkey: string; account: { data: [string, string] } }[] }>(ctx, "getProgramAccounts", [program, cfg]);
  return { slot, accounts: result.value.map((a) => ({ pubkey: a.pubkey, data: Buffer.from(a.account.data[0], "base64") })) };
}

export async function getJson<T>(ctx: AdapterContext, url: string): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await ctx.fetch(url);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`GET ${url} http ${res.status}`);
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`GET ${url} http ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      if (String((e as Error).message).includes("No recorded response")) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** bigint / bigint to a float keeping the fractional part. */
export function div(n: bigint, d: bigint): number {
  return Number(n / d) + Number(n % d) / Number(d);
}
