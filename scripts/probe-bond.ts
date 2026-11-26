import { createPublicClient, http, parseAbi } from "viem"; import { sepolia } from "viem/chains";
const c = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const D = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
for (const f of ["usdc", "usdcToken", "bondToken", "paymentToken", "machina", "machinaToken", "getUsdc", "token"]) {
  try { const r = await c.readContract({ address: D, abi: parseAbi([`function ${f}() view returns (address)`]), functionName: f }); console.log(f, r); } catch {}
}
