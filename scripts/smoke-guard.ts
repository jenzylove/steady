// Smoke test for Guard against a running API: read a wallet's Kamino loan, ask to prepare a guard, and simulate
// whatever transaction comes back (nonce creation, or the rescue itself) on mainnet without signatures.
import "dotenv/config";
const api = process.argv[2] ?? "http://localhost:8833";
const wallet = process.argv[3] ?? "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";
const line = Number(process.argv[4] ?? "1.08");
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, j: (await r.json()) as any };
};
const adv = await post("/advise", { wallet });
const ob = adv.j.advice?.findings?.find((f: any) => f.fix?.protocol === "kamino" && f.fix?.account)?.fix?.account
  ?? adv.j.advice?.positions?.find((p: any) => p.protocol === "kamino" && p.kind === "borrow")?.account;
console.log("obligation", ob);
const p = await post("/guard/prepare", { wallet, obligation: ob, line });
console.log("prepare", p.status, p.j.step ?? p.j.error, p.j.note ?? p.j.guard?.summary ?? "");
if (p.j.transaction) {
  const r = (await (await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: [p.j.transaction, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }] }) })).json()) as any;
  console.log("simulate", JSON.stringify(r.result?.value?.err ?? r.error), (r.result?.value?.logs ?? []).slice(-3).join(" | "));
}
const g = await (await fetch(`${api}/guard?wallet=${wallet}`)).json();
console.log("guard state", JSON.stringify(g).slice(0, 300));
