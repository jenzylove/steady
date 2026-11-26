# Spike: LP and perp adapters (Orca, Raydium, Meteora, Drift, Jupiter Perps), pool liquidity, exit cost

Run on 2026-11-26 against Solana mainnet (Helius RPC, key never recorded). Scripts live in `scripts/`; fixtures in `src/engine/__fixtures__/lp/`.

## Q1. Can we read LP and perp positions of a wallet from chain and match each protocol's own numbers?

What ran: `scripts/find-wallets.ts` (program account scans per protocol to find real holders), `scripts/try-adapter.ts <adapter> <wallet>`, `scripts/compare-meteora.ts`, `scripts/validate-orca-sum.ts`.

### Orca (chain decode of Position NFTs, Token-2022 and bundles)
- Wallets: 9z4rZ1hj... (2 positions, $88k and $139k, both in range), 42b9Q6o6... ($253k, out of range, all SOL), J68JeFQV... (position bundle, 13 bundled positions), GruPKaUC... (2 positions, one in range).
- Orca's public API has no positions endpoint (`/v2/solana/positions/*` returns empty for every wallet, including ones with $250k positions; the OpenAPI doc lists pools and lock only). So no per-wallet reference exists.
- Independent check instead: sum of every position of the SOL/USDC whirlpool (20,920 positions, our decoder and CLMM math) versus the pool vaults: SOL 199,907 vs vault 202,601 (0.987), USDC 3,188,302 vs 3,505,575 (0.909). Positions never exceed the vault, and the shortfall is uncollected LP fees and protocol fees that sit in the vaults, as expected.
- Verdict: decode and math consistent with chain; no protocol UI figure to compare per wallet. Position bundles work (13 bundled positions found). Token-2022 NFTs are read (both token programs queried) but no real Token-2022 Orca position was located to prove it.

### Raydium
- CLMM: CorMxGXd... one position, $3,772, out of range (all SOL, 53.1 SOL). No Raydium positions API exists; checked ticks/price against the pool API.
- Standard AMM v4 LP: DgbCWnbX... 29,942.79 LP tokens, ours $6,181,513 vs Raydium API lpPrice x amount $6,185,9xx (0.07% lower; we ignore funds parked in OpenBook orders and say so in `extra.note`).
- CPMM LP is implemented (reserves minus withheld fees) and validated at pool level only (below); no wallet holding CPMM LP was tested.

### Meteora DLMM (SDK reading chain)
Compared with Meteora's own portfolio API (`dlmm.datapi.meteora.ag/portfolio/open`), balances excluding fees:

| wallet | positions | ours USD | Meteora API USD | diff |
|---|---|---|---|---|
| 9ZNSLCTL | 1 | 75.57 | 75.31 | +0.35% |
| 3vM1zgks | 7 | 2144.80 | 2138.55 | +0.29% |
| DsqdXGhd | 9 | 1058.86 | 1055.91 | +0.28% |
| 5PBT1cPi | 1 | 4899.88 | 4901.13 | -0.03% |

Differences are price timing (Jupiter vs Meteora price). Unclaimed fees are in `extra.tokenX/Y.uncollectedFees`. DAMM v2 positions are detected and reported as a gap, not valued.

### Drift
- SDK `@drift-labs/sdk` 2.163 (the npm `latest`) cannot decode mainnet PerpMarket accounts (layout newer than the deployed program). Pinned to 2.156.0 (stable), which decodes them. Its gRPC dependencies have no Windows binary, so `drift.ts` stubs them on load failure (Linux is unaffected). Install needed `--force` on Windows.
- Wallet Fo2qidJ2... (sub account 13UuQsh5...): SOL-PERP long 14,966 SOL, BTC-PERP short, etc., with Drift's own numbers: health 88, margin ratio 22.79%, account leverage 4.39, liquidation price SOL 62.26.
- **Finding: Drift looks halted.** The SOL-PERP oracle account was last updated at slot 410,366,404 (about April 2026); current slot is 474M, roughly 8 months. Drift's price (83.95) vs market (71) and its API hosts (`data.api.drift.trade`, `dlob.drift.trade`, `mainnet-beta.api.drift.trade`) no longer resolve. So Drift's margin ratio, liquidation price and any USD value are frozen at that time. The adapter flags each stale oracle (`extra.oracleStale`, age in slots), omits `usd` and adds a gap line rather than showing a wrong value. Token amounts and entry prices still come from chain.
- No live reference to compare against (API gone); values compared with SDK math only.

### Jupiter Perps
Chain Position accounts (program PERPHjGB...S2qQJu, 216 bytes) decoded; liquidation price from `perps-api.jup.ag/v1/positions`.

| wallet | side | size | entry | ours PnL (pre fee) | Jupiter PnL pre fee | liq price |
|---|---|---|---|---|---|---|
| 8Mtzci2d | SOL long | $3,559,186 | 127.09 | -1,571,200 | -1,570,627 | 51.75 (Jupiter) |
| 8dXAExL3 | WBTC long | $1,767,506 | 56,588 | +137,758 | +133,128 | 55,687 (Jupiter) |

Size, entry, collateral and side match Jupiter exactly; PnL differs by price source and timing (SOL 0.04%, BTC 3.5% because Jupiter's mark is 60,808 vs price API 60,999 at that moment).

## Q2. Does `poolLiquidityUsd` (vault balances x Jupiter prices) match each DEX's own TVL?

`scripts/validate-liquidity.ts`, 17 real pools:

- Orca SOL/USDC Czfq3xZZ...: ours $17,855,860 vs Orca API $17,855,799 (0.00%). The brief said about $16.4M on Nov 25; SOL moved, the same pool is $17.9M today.
- Other Orca pools: 2e3WeM4W -0.02%, 9RqDTfwC -0.04%, 9tXiuRRw -0.04%, 9R9nmGDR -0.04%, GfjgwQRM +0.13%, 3wijQvPK -0.03%, 6fteKNvM 0.00%, CeaZcxBN +0.03%, Hp53XEtt 0.00%.
- Raydium: AMM v4 SOL/USDC 58oQChx4 +0.03%, CPMM SOL/USELESS Q2sPHPdU -0.03%.
- Meteora: ANTFUN/USDT 54Vp27uL +0.02%, YZY/USDC DQ9weJhf +0.97%, arc/USDC DW2QC5yc -56%. For the last, Meteora's own `tvl` (8.88M) disagrees with its own fields (token_x_amount 144,037,315 x price 0.02696 = 3.88M); our number matches its amounts and price.
- Unpriced: Orca ousd/USDC and Raydium CLMM CC/USDC have a token Jupiter does not price; the function returns `null` with a gap, never a guess.
- Verdict: within 0.15% on every priced pool except the Meteora API inconsistency. Raydium CLMM pool (SOL/USDC 8sLbNZoA) was also checked: $328,685 vs $329,213 (-0.16%). Jupiter's price endpoint rate limits (429) on bursts; `getPrices` retries with backoff.

## Q3. Does `exitCost` say whether a position can be exited at size?

`scripts/val-exit.ts` (selling SOL): AMM v4 pool is simulated exactly (constant product, 0.25% fee); Orca, Raydium CLMM and Meteora pools are quoted through Jupiter restricted to that DEX; the best unrestricted route is returned alongside.

| pool | size | in pool impact | best route impact |
|---|---|---|---|
| Orca SOL/USDC | 1,000 SOL | 5.57% | 0.010% |
| Orca SOL/USDC | 100,000 SOL | 85.4% | 2.37% |
| Raydium AMM SOL/USDC | 1,000 SOL | 0.98% | 0.010% |
| Raydium AMM SOL/USDC | 20,000 SOL | 16.5% | 0.46% |
| Raydium CLMM SOL/USDC | 500 SOL | 0.16% | 0.023% |
| Meteora SOL/USDC | 2,000 SOL | 0.37% | 0.061% |

Useful result: a $17.9M TVL Orca pool charges 5.6% to sell $71k, because most liquidity is out of range. Impact is price paid versus a 1/1000 size quote on the same route (fees cancel); Jupiter's own reported impact is included. Jupiter's `priceImpactPct` is a fraction.

## Gaps and limits
- Orca/Raydium uncollected fees are the last checkpointed values only.
- DAMM v2 positions are detected and listed as a gap, not valued.
- Drift values are frozen (see above); Drift spot balances use stale interest indices too.
- Raydium AMM v4 values ignore OpenBook orders (0.07% on the tested pool).
- Zero-liquidity, zero-fee positions are skipped.
- No real Token-2022 Orca position and no wallet with CPMM LP was found to test.
