// Signed memos: every recommendation is canonical JSON, hashed with SHA-256 and signed (EIP-191) by a key that holds no funds.
import "dotenv/config";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";

/** Canonical JSON: keys sorted at every level, no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function digest(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

export interface Signed<T> { body: T; digest: string; signer: string; signature: `0x${string}` }

export async function sign<T>(body: T): Promise<Signed<T>> {
  const key = process.env.MEMO_SIGNER_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("MEMO_SIGNER_KEY is not set");
  const acct = privateKeyToAccount(key);
  const d = digest(body);
  const signature = await acct.signMessage({ message: `Steady memo sha256:${d}` });
  return { body, digest: d, signer: acct.address, signature };
}

/** True only when the body hashes to the digest and the signature recovers the stated signer. */
export async function verify<T>(m: Signed<T>): Promise<boolean> {
  if (digest(m.body) !== m.digest) return false;
  return verifyMessage({ address: m.signer as `0x${string}`, message: `Steady memo sha256:${m.digest}`, signature: m.signature });
}
