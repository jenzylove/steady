// Mint test USDC (anyone can) and approve the Telegraph Diamond for the miner bond, on Ethereum Sepolia.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17", DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const acct = privateKeyToAccount(process.env.TELEGRAPH_PAYER_KEY as `0x${string}`);
const transport = http("https://ethereum-sepolia-rpc.publicnode.com");
const pub = createPublicClient({ chain: sepolia, transport }), wal = createWalletClient({ chain: sepolia, transport, account: acct });
const abi = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
console.log("ETH", formatEther(await pub.getBalance({ address: acct.address })));
if ((await pub.readContract({ address: USDC, abi, functionName: "balanceOf", args: [acct.address] })) < 2_000_000n) {
  const h = await wal.writeContract({ address: USDC, abi, functionName: "mint", args: [acct.address, 5_000_000n] });
  await pub.waitForTransactionReceipt({ hash: h }); console.log("minted 5 test USDC", h);
}
if ((await pub.readContract({ address: USDC, abi, functionName: "allowance", args: [acct.address, DIAMOND] })) < 2_000_000n) {
  const h = await wal.writeContract({ address: USDC, abi, functionName: "approve", args: [DIAMOND, 5_000_000n] });
  await pub.waitForTransactionReceipt({ hash: h }); console.log("approved", h);
}
console.log("USDC", await pub.readContract({ address: USDC, abi, functionName: "balanceOf", args: [acct.address] }), "ETH", formatEther(await pub.getBalance({ address: acct.address })));
