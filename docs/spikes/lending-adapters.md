# Spike: lending adapters (Kamino, marginfi, Save) and health math

Date: 2026-11-26. Question: can we read a wallet's lending accounts from Solana mainnet and have our own
`healthFactor` (sum of collateral usd times liquidation threshold, over sum of borrow usd times borrow factor) agree
with what each protocol itself reports, within 1%?

Verdict: yes for Kamino and marginfi on live accounts (worst case 0.46%). Save matches exactly when the obligation was
refreshed under current reserve config, but Save is nearly dormant, so most obligations are stale snapshots and the
"protocol reported" number there is only as fresh as the last on chain refresh.

## What I ran

Code: `src/engine/adapters/{kamino,marginfi,save,lend-lib}.ts`, `src/engine/risk/health.ts`.
Tools: `scripts/compare-lending.ts <kamino|marginfi|save> <wallet...>` (live), `scripts/compare-save-snapshot.ts`,
`scripts/record-lending.ts` (fixtures). Wallets were found by getProgramAccounts scans of each program (Kamino: klend
obligations of four markets with non zero debt, 57k in the main market alone; marginfi: 36.6k accounts with a liability
in the first balance slot; Save: 16.9k obligations with a borrow), then sampled at spread indices.

### Kamino (id `kamino`)
- Official SDK `@kamino-finance/klend-sdk` 14.0.0 installs and loads, but pulls the `@solana/kit` tree, resolves ledger
  time over RPC and cannot be replayed from recorded fixtures. Decision: decode accounts directly. Layouts were taken from
  the klend IDL in the SDK (Obligation 3344 bytes, Reserve 8624, LendingMarket elevation groups at byte 200).
- Obligations: one `getProgramAccounts` with owner at offset 64 finds every obligation across all 52 Kamino markets.
  Reserves (and the market when an elevation group is set) come from one `getMultipleAccounts`.
- Factor for collateral = reserve `liquidationThresholdPct`; inside an elevation group the group threshold replaces it
  for member reserves and the borrow factor is waived (1.0). Otherwise borrow factor = reserve `borrowFactorPct / 100`
  (for example 1.25 on JitoSOL and bSOL, 1.15 on EURC).
- protocolReported comes from Kamino's API `GET /kamino-market/{market}/users/{wallet}/obligations`, field
  `refreshedStats`: healthFactor = `borrowLiquidationLimit / userTotalBorrowBorrowFactorAdjusted`, plus `loanToValue`
  and `liquidationLtv`.

### marginfi (id `marginfi`)
- Current name is Project 0 (npm `@0dotxyz/p0-ts-sdk` 2.12.0, app 0.xyz). The program id is unchanged,
  `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`. Old `@mrgnlabs/marginfi-client-v2` 6.4.2 is heavy (anchor 0.30) so I
  decode directly (MarginfiAccount 2312 bytes, authority at offset 40, 16 balances of 104 bytes; Bank layout from the
  0.1.8 IDL). The p0 SDK IDL was used to confirm the instruction account order.
- Factors are the bank's maintenance weights (asset weight maint for collateral, liability weight maint for borrows).
  E-mode matters: when every liability bank of the account lists the collateral's e-mode tag, the lowest listed
  maintenance weight replaces the bank default if higher (mSOL against SOL: 0.80 becomes 1.051).
- protocolReported: the `health_cache` stored inside accounts is unusable (written by older program versions with a
  different layout, mostly zero or stale). Instead I simulate marginfi's own permissionless
  `lending_account_pulse_health` instruction (`simulateTransaction`, no signature, nothing sent) and read the
  `asset_value_maint / liability_value_maint` it writes. Remaining accounts per balance: bank, oracle keys, and the
  integration accounts for oracle setups above 17. Accounts whose oracle fails (marginfi error 6009, or compute
  failure) get a gap, never a guessed value.
- Prices: the bank's cached oracle price (`cache.last_oracle_price`); a price older than 6 hours is a gap.

### Save (id `save`, formerly Solend)
- Obligations (1300 bytes, owner at offset 42) by getProgramAccounts on `So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo`.
  Layout found empirically: deposits 88 bytes each, borrows 112 bytes each, from byte 204.
  Reserves, prices and thresholds from `https://api.solend.fi/v1/reserves?scope=all` and
  `/v1/markets/configs?scope=all` (the SDK is not needed).
- Factor for collateral = reserve `liquidationThreshold / 100`; for borrows `borrowWeight` (1 + added weight bps).
- protocolReported = obligation `unhealthyBorrowValue / borrowedValue` as stored on chain at its last refresh.
- Reserves not refreshed on chain for more than 100,000 slots (about 11 hours) have a stale price and interest rate. If any
  reserve of an obligation is stale, the whole obligation is valued from its own stored per leg values (consistent with
  the protocol number) and a gap says so.

## Results

`ours` = `healthFactor(loan)` from the adapter output; `protocol` = `protocolReported.healthFactor`. All runs live on
2026-11-26.

### Kamino (14 loans, 9 wallets)

| Wallet (start) | Obligation (start) | ours | protocol | diff |
|---|---|---|---|---|
| 6gJxiBgU | ALj6Fh4C | 1.4619 | 1.4619 | 0.00% |
| 6YTv68wC | 38ngpSHV | 1.6100 | 1.6120 | -0.12% |
| 6YTv68wC | 4FS8Viec | 1.2752 | 1.2753 | -0.01% |
| 44tDHrCk | 3rvEWj7K | 1.1370 | 1.1371 | -0.01% |
| 44tDHrCk | 5LTv3Prk | 3.0011 | 3.0011 | 0.00% |
| BpcJeRic | 9iGfgvxk | 1.1351 | 1.1352 | 0.00% |
| 98CjCSKJ | FS8vwj3Y | 1.2826 | 1.2827 | 0.00% |
| 2ihhvuPJ | 6Co3of6S | 46.8745 | 46.6600 | 0.46% |
| 2ihhvuPJ | A5Luo6eC | 1.0543 | 1.0543 | 0.00% |
| 32MBYy9M | rpJ6SUVp | 2.2973 | 2.2973 | 0.00% |
| 32MBYy9M | DZKg9WFf | 1.3473 | 1.3508 | -0.26% |
| 8HhZCE1L | 3wtkdLhS | 1.1854 | 1.1854 | 0.00% |
| 8HhZCE1L | 4DCuzQga | 1.3009 | 1.3011 | -0.01% |
| De1e9rbr | DwwcRy6w | 1.1426 | 1.1426 | 0.00% |

Covers plain borrow factors (1.25, 1.15), elevation groups (8HhZ JitoSOL/SOL), multi leg obligations and the JLP market.
Largest gap 0.46% (a 0.2 usd PYTH borrow against 7 usd USDC, an oracle timing difference).

### marginfi (12 priced loans)

| Wallet (start) | Account (start) | ours | protocol (simulated pulse) | diff |
|---|---|---|---|---|
| 6UfSiPcs | Bf3ySgc1 | 1928.94 | 1921.05 | 0.41% |
| 7USMPgaF | 8azwjJ6d | 1.9175 | 1.9153 | 0.12% |
| FTm9HJ3Z | 476eXrS4 | 16.2159 | 16.2054 | 0.06% |
| GaTEjq7b | 1XEKx36M | 1.0564 | 1.0562 | 0.02% |
| 5JEF2wjt | 2FUUeHR8 | 5.2865 | 5.2822 | 0.08% |
| 2hVkzWkF | ExkXP11r | 2.0445 | 2.0421 | 0.12% |
| E8NVRTss | GDKMruSi | 1.7141 | 1.7104 | 0.21% |
| nw1csfKb | 2smjqCdj | 1.7915 | 1.7907 | 0.04% |
| FjnqQtYQ | B9m7VG5g | 7327.63 | 7310.85 | 0.23% |
| BmNAPNdf | 7v25UTQC | 274757.3 | 274165.0 | 0.22% |
| 5wYm69vh | Ho5B7ZTr | 1.4840 | 1.4817 | 0.15% |
| 56MfuUCc | DHdREPb1 | 976047.9 | 975117.1 | 0.10% |

Before the e-mode fix the LST accounts (mSOL, JitoSOL, bSOL against SOL or LST borrows) were off by 8% to 24%. After it
every one is within 0.41%. Many sampled accounts are dust (usd below 1) but the ratios are still exact; the 7USM
account holds 419 usd of mSOL against 209 usd of SOL. Remaining small differences: marginfi applies a confidence interval
price bias (assets at the low price, liabilities at the high price); we use the bank's cached mid price.

### Save (8 obligations with a protocol number)

Two views: `snapshot` applies our formula to the per leg values stored in the obligation (tests the factors and formula
against the protocol's own stored totals); `live` is the adapter output with current reserve data.

| Wallet (start) | Obligation (start) | protocol (stored) | snapshot | live (adapter) |
|---|---|---|---|---|
| GQP9XKoR | 7DYqwk7p | 1.0942 | 1.0950 (0.08%) | 1.1022 vs 1.1022 (0.00%) |
| GQP9XKoR | 3kijdzL8 | 0.9999 | 0.9999 (0.00%) | stale reserve, valued from stored values (0.00%) |
| 7P1btPmU | 7ogbgKyb | 1.0000 | 1.0000 (0.00%) | 1.0000 (0.00%) |
| xSzdCBQN | 7wkNeG4g | 1.0000 | 1.0000 (0.00%) | 1.0521 (5.2%, price drift since refresh) |
| 7P1btPmU | 72CF8woG | 0.9872 | 0.9872 (0.00%) | 1.2062 (22%, price drift, 3 usd position) |
| CUdNRRfV | 2wBxxQxs | 0.9982 | 0.9982 (0.00%) | 1.1377 (14%, price drift) |
| 6PG4fephf | 2jN9mesv | 1.5034 | 1.5182 (0.99%) | 1.5782 (5.0%) |
| 7fqDdkjr | Cr22PC2s | 1.0000 | 1.3246 | 1.0037 (0.37%) |

The formula and factors reproduce the stored protocol number exactly on 6 of 8 obligations. Where "live" differs from
"protocol", the cause is time: the stored number is from the obligation's last refresh (sometimes months ago), while our
legs use current prices. The protocol itself would show the live number only after its UI refreshes the obligation in
memory, which we reproduce in the adapter by revaluing the legs. Cr22 and a few others differ in the snapshot because
Save changed per reserve weights after the obligation's last refresh (a borrow weight of about 1.24 on USDT at that
time, 1.0 now), so the stored total cannot be reproduced from current config.

## Differences explained

- Price source: Kamino API and the program use the reserve's oracle price; we use the reserve's stored price from the
  same chain read. marginfi uses oracle price with confidence bias; we use the bank cached price. Both stay within 0.5%.
- Elevation groups (Kamino) and e-mode (marginfi) change the collateral weight; both are handled and tested.
- Borrow factor: Kamino 1.0 to 3.0 depending on reserve (waived inside an elevation group); marginfi liability weight
  1.05 to 1.5; Save borrow weight (added bps).
- Stale reserves: a reserve not refreshed on chain for 100k slots gives a wrong price and interest. Kamino and Save
  then value the whole obligation from its own stored numbers (amount is 0, usd is the stored value) and a gap says so.
  Kamino reserves were fresh in every sampled case.

## Gaps and caveats

- marginfi: banks with oracle setups beyond the IDL we have (ids above 17 are passed integration accounts as a guess that
  worked on mSOL/LST banks); accounts where marginfi's own engine errors (error 6009, stale oracle) have no
  protocolReported and a gap. Legs of banks with a cached price older than 6 hours are left out of collaterals and
  borrows, and a gap says so (the health of that loan is then not reliable).
- marginfi `protocolReported` has only `healthFactor` (the cache holds no LTV). Save fills ltv and liquidationLtv from the
  obligation totals. Kamino gives all three.
- Save stale legs carry `amount: 0` (the amount cannot be trusted) with `extra.staleValueFromObligation`, so
  `liquidationPrice` on those legs is not meaningful.
- The simulated pulse needs a funded fee payer account (a public address, never signing).
- The Save API is the only source for Save reserves; if it is down the adapter returns a gap.

## Dependencies

No new packages. `@kamino-finance/klend-sdk` and `@solana/kit` were tried and removed from the plan; `@solana/web3.js`
(already present) builds the simulated marginfi transaction.
