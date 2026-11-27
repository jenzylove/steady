// Spike: are Kamino obligation orders (on chain stop loss on LTV) enabled on the markets Steady reads,
// and can Steady build a set order instruction for a real loan and simulate it?
import "dotenv/config";
import { address, createSolanaRpc } from "@solana/kit";
import { KaminoMarket } from "@kamino-finance/klend-sdk";

const rpc = createSolanaRpc(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);
const MARKETS: Record<string, string> = {
  main: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  jlp: "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek",
  altcoins: "ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5",
};
for (const [name, m] of Object.entries(MARKETS)) {
  try {
    const mk = await KaminoMarket.load(rpc as never, address(m), 400);
    const s: any = mk?.state;
    console.log(name, m, "creation", s?.obligationOrderCreationEnabled, "execution", s?.obligationOrderExecutionEnabled);
  } catch (e) { console.log(name, "error", (e as Error).message.slice(0, 120)); }
}
