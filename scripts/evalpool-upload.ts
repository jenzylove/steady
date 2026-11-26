// Signs and uploads the evaluation rows made by evalpool-make.ts to the Telegraph node's evaluation pool.
// Message format and endpoint: telegraph-docs scoring/contribute-evaluation-data.md. Rows never enter this repo.
// Usage: npx tsx -r dotenv/config scripts/evalpool-upload.ts [dir] [--send]   (without --send it only prints what it would sign)
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const DIR = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "C:/Users/LENOVO/steady-launch/evalpool";
const SEND = process.argv.includes("--send");
const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const CHAIN_ID = 11155111;
const key = process.env.TELEGRAPH_PAYER_KEY;
if (!key) throw new Error("TELEGRAPH_PAYER_KEY is not set");
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);

const receipts: unknown[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".jsonl"))) {
  const intent = file.replace(/\.jsonl$/, "");
  const body = readFileSync(`${DIR}/${file}`);
  const bodySha = createHash("sha256").update(body).digest("hex");
  const nonce = randomBytes(16).toString("hex");
  const message = `Telegraph eval-pool submission v1\nintent_id: ${intent}\nbody_sha256: ${bodySha}\nnonce: ${nonce}\nchain_id: ${CHAIN_ID}`;
  const rows = body.toString("utf8").trim().split("\n").length;
  if (!SEND) { console.log(`[dry] ${intent}: ${rows} rows, sha256 ${bodySha}, submitter ${account.address}`); continue; }
  const signature = await account.signMessage({ message });
  const res = await fetch(`${NODE}/api/evalpool/submissions?intent_id=${intent}&submitter=${account.address}`, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson", "x-evalpool-signature": signature, "x-evalpool-nonce": nonce },
    body,
  });
  const j = await res.json().catch(async () => ({ raw: await res.text() }));
  console.log(intent, res.status, JSON.stringify(j));
  receipts.push({ intent, status: res.status, rows, body_sha256: bodySha, submitter: account.address, at: new Date().toISOString(), response: j });
}
if (SEND) writeFileSync(`${DIR}/receipts-${Date.now()}.json`, JSON.stringify(receipts, null, 2));
