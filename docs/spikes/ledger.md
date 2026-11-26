# Spike: forward prediction ledger

Date: 2026-11-26. Question: can Steady make short horizon calls before the outcome, sign them, and settle them later from
its own mainnet reads, with a frontier model answering the same questions blind as the control?

Verdict: the machinery works end to end. 23 real predictions were made on 2026-11-26 09:41 UTC and are signed and stored.
They settle between 2026-11-27 09:41 UTC and 2026-11-29 09:41 UTC. The frontier control has NOT run yet: the Anthropic key
in `.env` returned "credit balance is too low" on every call, so all 23 predictions currently carry Steady's call only.
After credit is added, `tsx scripts/ledger-make.ts --frontier-only` fills in the blind answers (it must run before
settlement; a settled prediction refuses an update).

## Code

- `src/ledger/store.ts`: append only JSON lines at `data/ledger.jsonl` (`data/` is in `.gitignore`). Each prediction is
  a `sign()` memo of the `Prediction` body. Each settlement is a second signed memo `{predictionId, predictionDigest,
  settledAt, outcome, score}` that references the prediction memo by digest. `update(id, patch)` appends a new signed
  version with `supersedes` set; `load()` returns the latest version per id with the outcome merged in.
- `src/ledger/make.ts`: pure builders per kind (fixture tested) plus live readers.
- `src/ledger/frontier.ts`: Anthropic Messages API, model `claude-sonnet-5-5`, no tools, no web. The prompt is today's date,
  the question text and the JSON reply format. Nothing else.
- `src/ledger/settle.ts`: fresh reads, `judge` (truth of the claim from the settled value), scoring (hit when verdict
  equals outcome verdict; absolute error of `value` against the settled value), `settleDue`.
- `src/ledger/report.ts`: per kind counts, hit rates, mean absolute error, misses, USD at stake (liquidation and exit).
- `scripts/ledger-make.ts` (`--no-frontier`, `--frontier-only`), `scripts/ledger-settle.ts [iso now]`,
  `scripts/ledger-report.ts [--json]`.
- Tests: `src/ledger/ledger.test.ts`, 13 tests, no network (builders, judge, scoring, store and signatures, settle with an
  injected read, report, frontier prompt and parsing).

## What was made

| Kind | Count | Horizon | Source of the number |
|---|---|---|---|
| rate_drift | 4 (USDC, SOL, JitoSOL, USDT, Kamino main market) | 72 h | Kamino API `GET /kamino-market/{market}/reserves/metrics`, field `supplyApy`; band stability from the same API's hourly `metrics/history` (`supplyInterestAPY`, last 7 days) |
| peg_band | 5 (USDC, USDT, PYUSD, USDe, USDS) | 24 h | Jupiter lite price v3 |
| exit_at_size | 6 (SOL sold into Orca, Raydium CLMM, Meteora DLMM, Raydium AMM v4 SOL/USDC pools; $100k each, plus $1M on Orca and Raydium CLMM) | 24 h | `exitCost` best Jupiter route impact; $2.4M of size in total |
| liquidation_distance | 8 real Kamino main market obligations, health 1.11 to 1.51 | 24 h | `kaminoAdapter` read of the obligation and its reserves; $5.67M of debt in total |

Obligations were found by one `getProgramAccounts` over klend obligations of the main market with a 64 byte data slice
(debt, liquidation limit), keeping debt from $5k to $5M and health 1.02 to 1.5, then re read through the adapter for fresh
health and spread over the debt ranking, one per owner.

Rules, all computed by code (`steady.why` says the arithmetic):

- rate_drift: band is the current rate plus or minus 20% of itself, never narrower than 0.5 points. Verdict is "inside"
  when at least half of the 7 day hourly windows stayed inside their own band 72 hours later. Value is the current rate.
- peg_band: band $0.995 to $1.005. Verdict true when the price is inside and within 0.3% of $1. Value is the current price.
- exit_at_size: ceiling Y is the smallest of 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10 percent that is at least 1.3 times the current
  impact. Value is the current impact.
- liquidation_distance: safe when collateral would need to lose at least 6% (all other prices fixed) to reach health 1.0.
  Value is the current health.

Honest limit: every claim is checked at settle time only, not as a path over the window (a loan that is liquidated and
recovers, or a price that dips and returns, would not be seen). The claim text says "at settle time".

## Sample predictions

```
rate_drift:D6q6wuQS  USDC supply APY on Kamino main is between 3.33% and 4.99% at settle time, 72 hours from now
  steady: false, 4.1598. Current supply APY is 4.16%. In 52 of 106 hourly windows over the last 7 days the rate was still
  inside the same band 72 hours later (49.06%); the call is leaves the band.
rate_drift:d4A2prbA  SOL supply APY ... between 2.76% and 4.14%     steady: true, 3.4493
peg_band:Es9vMFrz    USDT Jupiter price is between $0.995 and $1.005 at settle time   steady: true, 0.9984
exit_at_size:Czfq3xZZ:1000k  Selling 14074.38 SOL (about $1,000,000) through the best Jupiter route costs under 0.5% price
  impact at settle time    steady: true, 0.3104    usd at stake 1,000,000
liquidation_distance:93fpx4Bx  Kamino loan 93fpx4Bx has health above 1.0 (not liquidatable) at settle time, 24 hours from now
  steady: false, 1.0492 (collateral only has to lose 4.7%)    usd at stake 5,073,294
liquidation_distance:ET1fSvYU  ... steady: true, 1.1118 (10.1% distance)    usd at stake 28,390
```

Signer of the memos: `0x364C521eee6694304f22b8eAFA8F618c08e8f5b2` (the memo key, holds no funds).

## Frontier answers

None yet. Every request to `claude-sonnet-5-5` failed with HTTP 400 "Your credit balance is too low to access the
Anthropic API". The question each model would get is stored in `params.question`, for example:

> On Kamino Lend (Solana, main market), will the USDC supply APY be between 3.33% and 4.99% on 2026-11-29T09:41:08.603Z?
> Set "value" to your estimate of the supply APY in percent at that time.

The model sees only the date and this text. It never sees the current rate, health, depth or any Steady output. Note the band
itself is part of the claim and so is shown; for liquidation the model is given only the obligation address, which is
exactly what it could know blind.

## Report right now

```
rate_drift: 4 predictions, 0 settled, 4 open
peg_band: 5 predictions, 0 settled, 5 open
exit_at_size: 6 predictions, 0 settled, 6 open, $2,400,000 at stake
liquidation_distance: 8 predictions, 0 settled, 8 open, $5,668,998 at stake
Total 23 predictions, 0 settled.
```

## To finish the proof

1. Add Anthropic credit, then `npx tsx scripts/ledger-make.ts --frontier-only` before 2026-11-27 09:41 UTC (the first
   settle time, peg and exit and liquidation). Each answer is appended as a new signed version of its prediction.
2. From 2026-11-27 09:41 UTC run `npx tsx scripts/ledger-settle.ts` (the 72 hour rate_drift set is due 2026-11-29 09:41 UTC),
   then `npx tsx scripts/ledger-report.ts`.
3. A liquidation whose obligation has been closed cannot be read and stays open with a "left open" error rather than a
   guessed outcome.
4. `data/` is git ignored; publish `data/ledger.jsonl` deliberately when the record should go public (every line verifies
   with `verify()` from `src/memo/memo.ts`).
