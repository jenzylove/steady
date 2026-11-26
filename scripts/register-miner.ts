// Register the Steady liquidity miner on the Telegraph Diamond (Ethereum Sepolia).
// Usage: npx tsx scripts/register-miner.ts <yaml-url> [--yaml miner/steady-liquidity.yaml] [--fee 0x..] [--update <registrationId>] [--send]
// Without --send it only reads the bond and intents, then dry runs the call with eth_call. The key is TELEGRAPH_PAYER_KEY.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeErrorResult, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b" as const;
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17" as const;
const RPC = process.env.TELEGRAPH_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const INTENTS = ["LIQUIDITY_DEPTH_VERIFY_GENERAL"];
const MIN_PRICE = 10000n; // 0.01 USDC, the registry floor

const abi = parseAbi([
  "function registerMiner(string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents) returns (uint256)",
  "function updateMiner(uint256 oldId, string yamlUrl, bytes32 yamlHash, address feeAddress, uint256 minPriceUsdc, string[] supportedIntents) returns (uint256)",
  "function getCanonicalIntents() view returns (string[])",
  "function minerBondParams() view returns (uint256, uint256, uint256, uint256)",
  "function quoteMinerBond(uint256 n) view returns (uint256, uint256)",
  "function minerBondOf(address m) view returns (uint256, uint256, uint256)",
  "function isCanonicalIntent(string) view returns (bool)",
  "error Error(string)",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const send = process.argv.includes("--send");
  const yamlUrl = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
  const yamlPath = arg("--yaml") ?? "miner/steady-liquidity.yaml";
  const hash = ("0x" + createHash("sha256").update(readFileSync(yamlPath)).digest("hex")) as Hex;
  console.log(`yaml file   ${yamlPath}\nsha256      ${hash}`);

  const key = process.env.TELEGRAPH_PAYER_KEY as Hex | undefined;
  if (!key) throw new Error("TELEGRAPH_PAYER_KEY is not set");
  const account = privateKeyToAccount(key);
  const fee = (arg("--fee") ?? account.address) as Hex;
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

  const canonical = (await client.readContract({ address: DIAMOND, abi, functionName: "getCanonicalIntents" })) as string[];
  for (const i of INTENTS) console.log(`intent ${i} canonical: ${canonical.includes(i)}`);
  if (INTENTS.some((i) => !canonical.includes(i))) throw new Error("an intent is not canonical on this Diamond");
  const params = await client.readContract({ address: DIAMOND, abi, functionName: "minerBondParams" });
  console.log("minerBondParams", params.map((p) => p.toString()).join(", "));
  const [bondUsd, bondUsdc] = await client.readContract({ address: DIAMOND, abi, functionName: "minerBondOf", args: [account.address] });
  const [quoteUsd] = await client.readContract({ address: DIAMOND, abi, functionName: "quoteMinerBond", args: [BigInt(INTENTS.length)] });
  console.log(`wallet      ${account.address}\nbond covers ${formatUnits(bondUsd, 6)} USD (holds ${formatUnits(bondUsdc, 6)} USDC); one intent quotes ${formatUnits(quoteUsd, 6)}`);
  const [bal, allow] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    client.readContract({ address: USDC, abi: erc20, functionName: "allowance", args: [account.address, DIAMOND] }),
  ]);
  console.log(`test USDC   balance ${formatUnits(bal, 6)}, allowance to Diamond ${formatUnits(allow, 6)}`);

  if (!yamlUrl) {
    console.log("no YAML URL given: stopping after the reads (pass the hosted YAML URL as the first argument for the dry run)");
    return;
  }
  const update = arg("--update");
  const call = update
    ? ({ functionName: "updateMiner", args: [BigInt(update), yamlUrl, hash, fee, MIN_PRICE, INTENTS] } as const)
    : ({ functionName: "registerMiner", args: [yamlUrl, hash, fee, MIN_PRICE, INTENTS] } as const);
  try {
    const sim = await client.simulateContract({ address: DIAMOND, abi, account, ...call } as any);
    console.log(`dry run ok: would-be registration id ${String(sim.result)}`);
    if (!send) return console.log("not sent (pass --send to send the transaction)");
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });
    const tx = await wallet.writeContract(sim.request as any);
    console.log(`sent ${tx}`);
    const rc = await client.waitForTransactionReceipt({ hash: tx });
    console.log(`mined in block ${rc.blockNumber}, status ${rc.status}`);
  } catch (e: any) {
    const reason = e?.cause?.reason ?? e?.shortMessage ?? e?.message ?? String(e);
    console.log(`dry run reverted: ${String(reason).split("\n")[0]}`);
    if (e?.cause?.data) {
      try { console.log(decodeErrorResult({ abi, data: e.cause.data })); } catch { /* raw data not a known error */ }
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted>"));
  process.exit(1);
});
