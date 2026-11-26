# Steady · PRD

Telegraph Hackathon Season II · Track 03 Apps & Agents (plus Track 01 Miner and Track 02 Evaluator material from the same codebase) · Deadline Dec 1 2026 23:59 UTC · Testnet payments (Telegraph), Solana mainnet reads.

## 1. Problem
Solana users hold tokens, stablecoins, staked SOL, loans, LP and perp positions across many protocols, and they sign transactions they cannot read. They lose money four ways:
- **Signing something bad.** Drainer transactions, address poisoning (about $62M lost since December 2025, Scam Sniffer via Cointelegraph), sends to frozen or sanctioned wallets.
- **Not seeing risk build up.** The Oct 10 2025 crash wiped out about $19B of leveraged positions in hours, $1.7B of it long SOL (RockawayX); depegs and protocol exploits hit positions that looked fine.
- **Acting on wrong numbers.** In our paid Telegraph tests (Nov 25 2026) one miner said marginfi pays 330% on USDC and one said $3.5M for an Orca SOL/USDC pool that holds $16.4M. A single source is not safe to act on.
- **Leaving money idle.** Stablecoins sit at lower rates than verified alternatives.

The Telegraph team asked for exactly this product ("AI Financial Advisor Inside a Solana Wallet", Discord showcase, Nov 2026) and set the bar: specific to the user's actual portfolio, independently verified, continuously updated, with prepared transactions the user approves, and a measured advantage over a frontier model and existing solutions.

## 2. User and front door
A Solana DeFi user with real positions. Front door: paste a wallet address (or pick one from the public gallery). In the first ten seconds they see their whole portfolio loading with a live "checking" stream, then their top risks and opportunities in plain words.

## 3. Full scope (nothing descoped; any cut needs the owner's explicit yes)
1. **Read the whole wallet** from Solana mainnet (Helius): tokens and stablecoins, staked SOL and LSTs, lending and borrowing (Kamino, marginfi, Save), LP (Orca, Raydium, Meteora), perps (Drift, Jupiter perps), token delegations and approvals, recent transaction history.
2. **Check before signing.** Paste any transaction (base64) or a send intent: simulate it on mainnet, show balance changes in plain words, screen the recipient (sanctions miners, Tether and Circle freeze lists, address poisoning lookalikes vs the user's history), check tokens (supply, authorities, holder concentration, liquidity at size) and the protocol (security, news, TVL trend). Verdict with reasons.
3. **Risk across holdings.** Liquidation distance on every loan, depeg exposure, concentration, live delegations to unknown programs, positions in protocols with exploit news or draining TVL, LP that cannot exit at size.
4. **Opportunities.** Verified better lending rates for idle stablecoins, safer equivalents for risky positions, with the expected gain computed from verified numbers.
5. **Prepared transactions.** Repay, deposit, withdraw, revoke delegation, swap via Jupiter, move to the better rate. Each built for the user's wallet, simulated on mainnet with before and after, signed by the user in Phantom. Nothing moves without approval.
6. **Continuous.** A heartbeat rechecks watched wallets and sends Telegram alerts (@steadysol_bot) with the prepared fix attached.
7. **Forward prediction ledger.** Steady signs and timestamps short horizon calls before the outcome (liquidation distance after a set price move, lending rate drift over 72 hours, a stablecoin holding its band, an LP exit at a given size), settles them from its own mainnet reads, and publishes the record next to a frontier model making the same calls, with dollars at stake.
8. **Proof page.** Public gallery of real mainnet wallets; per fact and per recommendation: single miner vs miner quorum vs frontier model vs chain truth, the wrong transaction each would have built, cost and latency; misses published.
9. **Own miner (Track 01).** Solana pool liquidity read from chain (Orca, Raydium, Meteora) for `LIQUIDITY_DEPTH_VERIFY_GENERAL`, registered on Telegraph, sold to any app.
10. **Evaluator material (Track 02).** A Solana pool liquidity truth source and evaluation pairs submitted to Telegraph's evaluation pool.

## 4. Verification design
- **Chain facts are ours:** balances, positions, pool depth, rates, liquidation distance, authorities and simulation come from Steady's own mainnet reads. They are ground truth and are also used to audit miners that answer the same things (published, not relied on).
- **Telegraph is bought for what the chain cannot know:** protocol security (`SECURITY_REVIEW`, `SMART_CONTRACT_AUDIT` when open, `THREAT_INTELLIGENCE_INDICATOR`), news and depeg warnings (`NEWS_SEARCH`, `FACT_CHECK`), recipient and counterparty screening (`SANCTIONS_SCREENING_MATCH`, `FRAUD_DETECTION`, `URL_SAFE` for linked sites), reserve attestations (`ASSET_RESERVE_ATTESTATION`), plus price quorum (`CRYPTO_PRICE_USD`) where chain prices need an outside reference. Several miners per fact with roles (answer, verify, compare); disagreement is shown.
- **Every recommendation is a signed memo** (EIP-191 style signature over canonical JSON) listing each chain read, each Telegraph answer with its signal hash and receipt, and the rule that decided. A verify button rechecks the signature.
- **Code decides, the model explains.** The model (Claude) only writes plain language from computed numbers and runs the frontier comparison; it never chooses an action.

## 5. Judging criteria, how each is met
| Criterion | How |
|---|---|
| Technical quality and mainnet readiness (35) | Mainnet reads across 8+ protocols, mainnet simulation, real Phantom signing, signed memos, tests against protocol displayed numbers |
| Commercial viability (25) | DeFi users (subscription), wallets embedding it, treasuries; the five commercial questions answered |
| Organic growth, education, developer activation (20) | Tutorial, three dated X updates, public gallery and ledger, miner other apps can call, invite to other teams |
| Independent adoption and retention (10) | Any Solana user can paste a wallet; Telegram alerts bring them back; usage counts shown honestly |
| Telegraph integration (5) | Many intents, competing miners, receipts, own miner and evaluator material |
| Reproducibility and proof (5) | Proof page, ledger, fixtures, `npm test`, live scripts |

## 6. Claims and how each is proven
| Claim | Proof |
|---|---|
| Steady catches wrong numbers a single source would act on | Proof page rows with receipts (330% rate, $3.5M vs $16.4M pool) and the wrong transaction each would build |
| Its calls beat a frontier model | Forward ledger: signed before outcome, settled from chain, both records public |
| Liquidation and health numbers are right | Test against the protocols' own displayed values on 20+ real wallets |
| Every recommendation is traceable | Signed memo with signal hashes; verify button |
| The fix works | Mainnet simulation before signing; signed transaction on Solscan |

## 7. What it does not do
Never moves funds without the user's signature; never holds keys or funds; no custody; not investment advice; testnet payments to Telegraph until its mainnet (Jan 2027).

## 8. Sponsor checklist (becomes docs/SUBMISSION_CHECKLIST.md, ticked only from the live app)
- [ ] Star github.com/telegraphprotocol/bounties (done Nov 26 from jenzylove)
- [ ] Anjoman account and Season II registration (owner)
- [ ] At least one autonomous machine to machine purchase through the supported Telegraph flow, used for a meaningful task
- [ ] Working deliverable, live link, reviewer access
- [ ] Genuine Telegraph integration evidence (receipts, signal hashes)
- [ ] Repeatable results with clear instructions
- [ ] Safe keys and spending limits
- [ ] Accurate network claims (testnet payments, mainnet reads)
- [ ] 2 to 5 minute demo video
- [ ] How to run: prerequisites, config, sample request, expected result, network, spending limits, limitations
- [ ] Evidence: receipts, requests, tests
- [ ] Short public summary plus links to at least three dated updates and any independent developer testing
- [ ] Five commercial questions answered
- [ ] Solana functionality, frontier model comparison, competing providers (Discord brief)
- [ ] Miner registered (Track 01) and evaluator material uploaded (Track 02)
