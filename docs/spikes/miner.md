# Spike: Telegraph liquidity miner (LIQUIDITY_DEPTH_VERIFY_GENERAL on Solana)

Run on 2026-11-26. Files: `src/miner/server.ts`, `src/miner/pools.ts`, `src/miner/miner.test.ts`, `miner/steady-liquidity.yaml`, `scripts/register-miner.ts`.

## What the intent asks
`GET https://devnode.telegraphprotocol.com/engine/v1/intents/LIQUIDITY_DEPTH_VERIFY_GENERAL`: request params `pool` ("DEX pool address or name") and `chain`; one response field, `liquidity_usd` (number, USD, 6 decimals, range 1 to 1e12, `scored: true`). 43 miners already serve it (mostly GeckoTerminal and exchange order book wrappers); the family is judged, not compared to a fixed truth.

## Endpoint
`GET /liquidity?pool=<address or name>&chain=solana` returns `pool, pool_address, pool_name, chain, dex, liquidity_usd, token_a, token_b, amount_a, amount_b, price_a, price_b, slot, sources[], answer, fetched_at`. `GET /health` returns `{"status":"ok"}`. Answers are cached 30 s per pool (and concurrent identical reads share one fetch).

Refusals, never a guessed number:
- 400 `unsupported_chain` (anything but solana/sol/solana-mainnet/mainnet-beta), `missing_param`, `bad_pool` (empty, too long, EVM address, ambiguous name), `unsupported_pool` (account is not an Orca, Raydium or Meteora pool)
- 404 `unknown_pool` (name not in the table) and `pool_not_found` (no such account)
- 422 `unpriced_token` (a token has no Jupiter price; the reason names the mint)
- 502 `upstream_error` (RPC or price API failed; API keys are stripped from the message)

## Name table (`src/miner/pools.ts`, `KNOWN_POOLS`)
Addresses come from each DEX's own API on 2026-11-26. A name is matched on DEX, token pair (either order, WSOL counts as SOL) and optional fee tier. "Orca SOL/USDC" resolves; a bare "SOL/USDC" is ambiguous and is refused with the candidate list, because three DEXes and five pools match.

| name | address |
|---|---|
| Orca SOL/USDC 0.04% | Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE |
| Orca SOL/JITOSOL 0.01% | Hp53XEtt4S8SvPCXarsLSdGfZBuUr5mMmZmX2DRNXQKp |
| Orca SOL/CBBTC 0.16% | CeaZcxBNLpJWtxzt58qQmfMBtJY8pQLvursXTJYGQpbN |
| Orca CBBTC/USDC 0.04% | HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM |
| Raydium SOL/USDC 0.25% (AMM v4) | 58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2 |
| Raydium SOL/USDC 0.04% (CLMM) | 8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj |
| Meteora SOL/USDC 0.04% | 5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6 |
| Meteora SOL/USDC 0.1% | BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y |
| Meteora SOL/USDC 0.2% | BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh |

Any other pool works by address.

## Local run
`PORT=8787 npx tsx src/miner/server.ts`, then curl (Helius key from `.env`, never printed). Compared with each DEX's own TVL fetched right after:

| request | HTTP | ours liquidity_usd | slot | DEX's own TVL | diff |
|---|---|---|---|---|---|
| `pool=Orca SOL/USDC&chain=solana` | 200 | 17,911,664.34 | 474102047 | Orca API 17,914,004.49 | -0.01% |
| `pool=58oQChx4...&chain=solana` (Raydium AMM v4) | 200 | 14,479,105.70 | 474102053 | Raydium API 14,476,069.92 | +0.02% |
| `pool=Meteora SOL/USDC 0.1%&chain=solana` | 200 | 2,405,682.06 | 474102056 | Meteora API 2,402,831.96 | +0.12% |
| `pool=Orca SOL/USDC&chain=ethereum` | 400 | unsupported_chain | | | |
| `pool=FOO&chain=solana` | 404 | unknown_pool, lists the table | | | |
| `pool=BqCfmajD...&chain=solana` (Orca OUSD/USDC) | 422 | unpriced_token, no USD price for ousd2mJs... | | | |

Orca response body, abbreviated: `{"pool_name":"Orca SOL/USDC 0.04%","dex":"orca-whirlpool","liquidity_usd":17911664.341194,"amount_a":201226.415617422,"amount_b":3605739.972461,"price_a":71.10,"price_b":0.9995,"slot":474102047,"sources":[{"kind":"chain","ref":"getMultipleAccounts","slot":474102047,...},{"kind":"price_api","ref":"https://lite-api.jup.ag/price/v3",...}]}`.

## Tests
`npx vitest run` (67 passed, 8 skipped without LIVE) and `LIVE=1 npx vitest run src/miner` (10 passed, including the live Orca check within 1% of Orca's API TVL). Unit tests replay the recorded Orca, Raydium AMM and Meteora fixtures from `src/engine/__fixtures__/lp/`, and cover name resolution, the 30 s cache, 400 for other chains and bad input, 422 for unpriced tokens, 404 and 400 mapping for missing and non pool accounts, and the HTTP routes.

## Registration
`miner/steady-liquidity.yaml` follows the V2 spec read from anjoman.ai/docs/miners/yaml-config: only the keys the closed schema allows, `endpoints[].intents`, `params.query.required`, `input_schema` and `output_schema` at top level, `intent_mapping` for `LIQUIDITY_DEPTH_VERIFY_GENERAL` (`liquidity_usd` read from path `liquidity_usd`), `semantics.supported_intents`, and a `limitations` entry. `id: 7420317` and `slug: steady-liquidity` were free in `/api/miners` on 2026-11-26. `base_url` is the placeholder `https://miner.steady.jdollar.site`. Minimum price 10000 and the intent list are passed on chain by the script (the YAML has no price field).

SHA-256 of the YAML at spike time: `0xcccf12db…edca`. The served file now hashes to `0x18e2082fe84e8f80f451d0cd58ce5041e5e120f8df4053c461509c890135b000` (`curl -s https://steady-miner-production.up.railway.app/steady-liquidity.yaml | sha256sum`).

`npx tsx scripts/register-miner.ts [yaml-url] [--update <id>] [--fee 0x..] [--send]` reads `getCanonicalIntents`, `minerBondParams`, `minerBondOf`, `quoteMinerBond`, the test USDC balance and allowance, then simulates `registerMiner` (or `updateMiner`) with eth_call and prints the would-be id or the revert. It sends only with `--send`. It was later run with `--send`: registration 6203 (tx `0x5b5ecaabba244b5242070d27473956ad8bae6ef87c4c93d41238fb3ad943af81`), Telegraph miner id 7420317, active.

Dry run on 2026-11-26 (Diamond 0x72a70e94..., Sepolia, with the placeholder URL above):
- intent `LIQUIDITY_DEPTH_VERIFY_GENERAL` is canonical: true
- `minerBondParams` = 1000000, 100000, 70000, 9 ($1 first intent, $0.10 each to 9, then $0.07)
- payer wallet 0xFaEd7d2f...2E: bond covers 0, test USDC balance 0, allowance 0
- result: `dry run reverted: ERC20: insufficient allowance`

Before `--send`: host the YAML at an immutable URL (it must match the hash), deploy the server at the base_url, mint at least 1 test USDC to the payer (`mint(address,uint256)` on 0xcc194e1a843B658526D0D5C431f670028582Ae17), approve the Diamond for it, and add Sepolia gas ETH. Then rerun the dry run to see the registration id, and send.

## Notes
- Solana RPC reads and Jupiter prices happen per request (30 s cache), so the answer is anchored to one slot per vault read; the two vault reads and the pool read can differ by a slot or two.
- Orca fees uncollected in vaults and Raydium AMM OpenBook orders follow the notes in `lp-perp-adapters.md` (within 0.15% of each DEX).
- The scoring side of this intent is judged by the family's evaluator; nothing here is known about how it compares answers, so the accuracy and plain `answer` text are the only levers.
