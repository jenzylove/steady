# Steady · Plan (Nov 26 to Dec 1 2026 23:59 UTC)

Stack: Next.js app on Vercel (steady.jdollar.site), a worker on Railway (heartbeat, ledger settlement, Telegram, miner), Postgres for memos and ledger, Helius for Solana mainnet, Telegraph via x402 (Base Sepolia test USDC; Solana devnet as second rail), Claude for plain language and the frontier comparison only.

## Phases (each ends with a check that proves it)
1. **Core engine (pure, tested).** Wallet reader adapters (tokens, stake and LST, Kamino, marginfi, Save, Orca, Raydium, Meteora, Drift, Jupiter perps, delegations, history); risk math (health, liquidation price, concentration, depeg exposure, LP exit at size). Check: unit tests; health and liquidation numbers match each protocol's own UI on 20+ real wallets.
2. **Telegraph buyer.** Quorum client with roles, receipts, spend caps, chain audit of miner answers; memo signer and verifier. Check: a recorded paid run per intent with receipts; memo verify passes and fails when a field changes.
3. **Before signing.** Transaction decode and mainnet simulation, recipient screening (sanctions, freeze lists, lookalikes), token and protocol checks. Check: fixtures for a drainer style transaction, a poisoned address, a frozen recipient, a clean send, each giving the expected verdict.
4. **Opportunities and prepared transactions.** Rate comparison from chain plus verified sources; builders for repay, deposit, withdraw, revoke, Jupiter swap, rate move; mainnet simulation with before and after; Phantom signing. Check: one real signed fix on mainnet (owner's small wallet) with Solscan link.
5. **Forward ledger and proof page.** Signed predictions, settlement job, frontier model comparison, public gallery of real wallets. Check: at least 50 settled predictions before Dec 1 with both records published.
6. **Heartbeat and Telegram.** Watch list, alerts with the prepared fix. Check: an alert fires on a real wallet crossing a set line.
7. **Miner and evaluator.** Solana pool liquidity miner (registration via Sepolia gas or a relayed signature) and truth source upload. Check: miner listed in /api/miners and answering; evaluation rows eligible.
8. **Design, release readiness audit, launch.** Product UI (own identity, dark and light), audit and fixes, README in the owner's style, demo video, X posts, submission. Check: audit findings fixed and tested live; checklist ticked from the live app.

## Delegation (rubric decides)
- Opus (main session): engine math, verification and memo design, Telegraph buyer, before signing logic, key handling, final review.
- Opus agent: UI and proof page (design is judged).
- Sonnet agents: protocol reader adapters from a fixed interface, Telegram bot, ledger settlement job, miner YAML and server, tests from spec, README draft.
- Every delegated result is reviewed, tested and driven in the browser before it lands.

## Risks and unknowns
| Risk | Status |
|---|---|
| Protocol account layouts (Kamino, marginfi, Drift, Meteora) and their SDKs on current versions | needs a spike (day 1): read one real position per protocol |
| Mainnet simulation of prepared transactions via Helius | known (simulateTransaction) |
| Telegraph x402 settlement outages on Base Sepolia (seen Nov 26, recovered) | known; Solana devnet rail as fallback |
| Miner registration gas (Sepolia ETH) | owner requested from faucet; relayed registration as fallback |
| Forward ledger needs settled outcomes before judging | known; start predictions on day 2 |
| Verità and another team building nearby | known; depth, proof page and ledger are the edge |
