# Steady evaluation material (Telegraph Track 02)

Steady already reads Solana pools and wallets straight from mainnet to check the numbers it acts on. The same reads now feed the Telegraph evaluation pool. They become question pairs that teach the network the difference between a right Solana answer and the wrong ones we actually saw from paid miners.

## What was uploaded

| Intent | Kind | Rows | State on the node |
|---|---|---|---|
| `LIQUIDITY_DEPTH_VERIFY_GENERAL` | judgment | 15 | eligible, attested |
| `TVL_LOOKUP_GENERAL` | judgment | 3 | eligible, attested |
| `WALLET_BALANCE_CHECK_GENERAL` | judgment | 3 | eligible, attested |

Uploaded on Nov 26 2026 at about 20:25 UTC to `https://devnode.telegraphprotocol.com` (Ethereum Sepolia, chain id 11155111). The node returned 21 received, 21 accepted, 0 duplicates and 0 rejected. The submitter is `0xFaEd7d2fD90a4095FF7D52809330ECBe1D9c2e2E`, the same address that registered the Steady liquidity miner (registration 6203).

Check it yourself; the node returns states, never row content:

```bash
curl -s "https://devnode.telegraphprotocol.com/api/evalpool/submissions/mine?submitter=0xFaEd7d2fD90a4095FF7D52809330ECBe1D9c2e2E"
```

## How each row is made

**The better answer is the chain truth at a stated slot.**
- Pool rows read both vault token accounts of nine top Solana pools (Orca Whirlpool, Raydium AMM v4 and CLMM, Meteora DLMM) at one slot, then price them in USD. This is the same reader the Steady miner serves.
- Depth at size rows quote a 250 SOL and a 5,000 SOL sell through one DEX at a time, single hop. They report the output, effective price, price impact, and the pool that actually filled.
- Wallet rows use `getBalance` and `getTokenAccountsByOwner`.

Every prompt carries its timestamp, so the answer stays checkable later. Every row links the Solscan account or the exact quote it came from, so the node reports its provenance class as attested.

**The worse answer is a failure we saw, not a strawman.** Five kinds:
- **Real paid answer:** a paid miner answered $3,500,000 for the Orca SOL/USDC pool `Czfq3x…u44zE` on Nov 25 2026. Read from the chain on Nov 27 2026, that pool holds about $18M.
- **Wrong scale:** off by a factor, or a decimals slip (amounts 1,000 times too large, or lamports reported as SOL).
- **Wrong chain:** the address is looked up on Ethereum or Base and reported as empty.
- **TVL read as depth:** a DEX wide TVL given for one pool, or "no meaningful slippage" for a 5,000 SOL sell that actually moves Raydium by about 4.9%.
- **Invented thin market:** slippage many times larger than the real quote.

Prompts use different wording for each pool and size, because the node refuses prompts that are 85% similar.

## Why the rows stay private

The pool keeps a hidden testing half, so the row text is never committed here. The scripts that make and upload it are:

```bash
npx tsx -r dotenv/config scripts/evalpool-make.ts <outDir>          # reads mainnet, writes one JSONL per intent
npx tsx -r dotenv/config scripts/evalpool-upload.ts <outDir>        # dry run: prints row counts and body hashes
npx tsx -r dotenv/config scripts/evalpool-upload.ts <outDir> --send # signs (EIP-191, Telegraph eval-pool v1 message) and uploads
```

The scripts need `HELIUS_API_KEY` to read Solana, and `TELEGRAPH_PAYER_KEY` to sign as the contributor. Uploading is free. A fresh run writes new prompts with a new timestamp, so it adds new questions instead of duplicates.

## Why it matters for apps

Steady's own advice depends on these exact facts: pool depth before a swap fix, and wallet balances before any recommendation. Better scoring on these intents means a Solana app that buys them from Telegraph gets ranked miners that actually read the chain.
