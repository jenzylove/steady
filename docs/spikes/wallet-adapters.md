# Spike: wallet, stake and history adapters

Date: 2026-11-26

## Question

Do `wallet.ts`, `stake.ts` and `history.ts` read the same numbers an independent source reports for real mainnet wallets, and do they put anything we cannot read into `gaps` instead of guessing?

## What I ran

Two public mainnet wallets, found on chain (not from a list):

- Tokens wallet `J6DV46TYWk359ym6Uks5FT7ehfnWhcjVrHYowCbYLfXR`. Found as the owner of an mSOL holder account via `getTokenLargestAccounts`. It holds 30 token accounts with a balance, 16,526 mSOL, and 3 live token delegations.
- Stake wallet `5ECz5NM8Y7m6avBxd5bEh4hNzeZfBk3wg3BxGRppypLr`. Found via `getProgramAccounts` on the Stake program filtered by voter `BzgTDU98GGMaq5RWkWcDLsX7W31VqRcEyNiukXzYV2Jd`. It is the withdrawer of two stake accounts.

Command: `LIVE=1 npx vitest run src/engine/adapters/live.wallet.test.ts`

Independent sources used:

- Helius DAS `getAssetsByOwner` (showFungible, showNativeBalance) for token and SOL balances. The adapters use `getTokenAccountsByOwner` and `getBalance`, so this is a different code path on the indexer side.
- A raw `getAccountInfo` base64 decode of each stake account (voter at byte 124, delegated stake u64 at byte 156), done in the test, not through the adapter's jsonParsed path.
- Solscan: not usable. `solscan.io` returns HTTP 403 to scripts and the public API did not respond, so there is no Solscan comparison. DAS plus raw account decode stand in.

## Output

Tokens wallet:

```
adapter tokens=30, DAS fungible nonzero=29, matched=29, diffs=0
SOL adapter=0.155263039 DAS nativeBalance=0.155263039
```

The one extra adapter token (mint `6fVxT6SD...Q6re4`, symbol UD, amount 1) is an NFT held in a token account. DAS lists it as `V1_NFT` with balance 1, and my test filter excluded NFTs from the fungible comparison. Every mint DAS reported with a balance matched to 1e-9 relative.

Delegations found on this wallet: SAMO 2.582290173 (delegate `4SMzSN8J...`), KURO 0.000009, LDO 1e-8.

Stake wallet (two accounts, adapter vs raw decode):

```
7GdnuwyL...Eutrd  adapter=4.512365537  raw=4.512365537  vote BzgTDU98...V2Jd (both)
7UiEHGfD...X7Rn   adapter=6.017044531  raw=6.017044531  vote BzgTDU98...V2Jd (both)
```

Both state "active" at epoch read time. History: 50 of 50 requested items returned for the tokens wallet, no gaps. LST check on the tokens wallet: mSOL 16,526.416569763 flagged `kind: "stake"`, `extra.lst: true`, with SOL value from Jupiter prices. A second wallet found during search (`7s1da8Du...2Z`, 60 tokens) returned 8 LSTs (fwdSOL, mSOL, japanSOL, JitoSOL, rkuSOL, JupSOL, INF, dfdvSOL), so the Jupiter `lst` tag list works beyond the 5 built in mints.

## Findings worth knowing

- Token-2022 program id is `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. A wrong id makes Helius answer "unrecognized Token program id", which now shows as a gap rather than a silent zero.
- Jupiter lite API returns HTTP 429 under burst. `fetchRetry` retries 429 and 503 with backoff; without it stake and wallet reads dropped prices.
- Many long tail tokens have no Jupiter price (19 of 31 on the tokens wallet). They are left unpriced with `usd` unset and listed in `gaps`. USD totals from this adapter are therefore a floor, never a guess.
- A homoglyph fake `JitοSΟL` (Greek letters) showed up in another wallet with symbol resolved from DAS. Symbol alone must never identify a token downstream; use the mint.
- Native stake `amount` is the delegated stake, not the account lamports (the difference is the rent reserve). Undelegated stake accounts report lamports minus rent reserve with `voteAccount: null`.

## Verdict

Passes. Token balances, SOL balance and stake amounts and vote accounts match independent reads exactly on both wallets. Not verified: USD values against a second price source, Solscan comparison, and a wallet with a stake account in warmup or cooldown (state classification by epoch is implemented but only the "active" branch was seen live).
