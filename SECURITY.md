# Security

## What Steady can and cannot do with your wallet

- Steady reads public Solana state. It never asks for a seed phrase or private key and never holds one for your wallet.
- A prepared fix is an unsigned transaction. Only Phantom, with your approval, can sign and send it. Steady simulates it on mainnet first and turns signing off when the simulation fails.
- Every fix touches only the programs it names (for the Kamino repay: Kamino Lend, Jupiter, Associated Token and Compute Budget), and the wallet is its only signer.

## Signed memos

- Each result is signed with Steady's memo key (EIP-191 over the canonical JSON). `POST /verify` recomputes the digest and checks the signer against that key.
- A fix memo is signed only when the fix appears in Steady's own signed advice for the same wallet from the last 6 hours, so a caller cannot get a Steady signature on text Steady did not recommend.

## Spending and abuse limits

- Telegraph answers are paid from a dedicated test wallet, capped at $0.05 per answer and by a daily cap that resets at 00:00 UTC. News answers are reused for 3 hours per protocol.
- The API limits free runs per client IP per day across `/advise`, `/fix` and `/presign`, and has a global ceiling per minute.
- Error text is scrubbed of provider keys before it reaches a response or a memo.

## Secrets

- Keys live only in environment variables on the hosts (`.env` is ignored by git). Recorded test fixtures keep provider keys redacted.
- Evaluation material uploaded to Telegraph is kept outside this repository, so the pool's hidden half stays hidden.

## Reporting

Please report a vulnerability privately through a GitHub security advisory on this repository rather than a public issue.
