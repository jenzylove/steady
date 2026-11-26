import type { Adapter, AdapterContext, AdapterResult, Position } from "../types.js";
import { SOL_MINT, chainSource, readPrices, readSymbols, readTokenAccounts, rpc } from "./util.js";

export const walletAdapter: Adapter = {
  id: "wallet",
  async read(wallet: string, ctx: AdapterContext): Promise<AdapterResult> {
    const gaps: string[] = [];
    const positions: Position[] = [];

    let lamports: number | undefined;
    let solSlot: number | undefined;
    try {
      const b = await rpc<{ value: number }>(ctx, "getBalance", [wallet, { commitment: "confirmed" }]);
      lamports = b.result.value;
      solSlot = b.slot;
    } catch (e) {
      gaps.push(`Native SOL balance not read: ${(e as Error).message}`);
    }

    const ta = await readTokenAccounts(wallet, ctx);
    gaps.push(...ta.gaps);

    // Merge token accounts of the same mint into one position (per account detail kept in extra).
    const held = ta.accounts.filter((a) => a.amount > 0);
    const byMint = new Map<string, typeof held>();
    for (const a of held) byMint.set(a.mint, [...(byMint.get(a.mint) ?? []), a]);
    const delegated = ta.accounts.filter((a) => a.delegate && (a.delegatedAmount ?? 0) > 0);
    const mints = [...new Set([...byMint.keys(), ...delegated.map((a) => a.mint)])];

    const [px, sy] = await Promise.all([readPrices([SOL_MINT, ...mints], ctx), readSymbols(mints, ctx)]);
    gaps.push(...px.gaps, ...sy.gaps);
    const priceSrc = px.sources.slice(0, 1);

    if (lamports !== undefined) {
      const amount = lamports / 1e9;
      const p = px.prices.get(SOL_MINT);
      positions.push({
        protocol: "wallet",
        kind: "token",
        mint: SOL_MINT,
        symbol: "SOL",
        account: wallet,
        amount,
        ...(p !== undefined ? { usd: amount * p } : {}),
        extra: { native: true, lamports },
        sources: [chainSource(ctx, "getBalance", solSlot), ...(p !== undefined ? priceSrc : [])],
      });
      if (p === undefined) gaps.push("SOL price unavailable; SOL position is unpriced.");
    }

    const unpriced: string[] = [];
    for (const [mint, accs] of byMint) {
      const amount = accs.reduce((s, a) => s + a.amount, 0);
      const p = px.prices.get(mint);
      const symbol = sy.meta.get(mint)?.symbol;
      if (p === undefined) unpriced.push(symbol ?? mint);
      positions.push({
        protocol: "wallet",
        kind: "token",
        mint,
        ...(symbol ? { symbol } : {}),
        ...(accs.length === 1 ? { account: accs[0]!.account } : {}),
        amount,
        ...(p !== undefined ? { usd: amount * p } : {}),
        extra: { tokenAccounts: accs.map((a) => a.account), program: accs[0]!.program, decimals: accs[0]!.decimals },
        sources: [...ta.sources, ...(p !== undefined ? priceSrc : [])],
      });
    }
    if (unpriced.length) {
      gaps.push(
        `No Jupiter price for ${unpriced.length} token(s), left unpriced: ${unpriced.slice(0, 20).join(", ")}${unpriced.length > 20 ? ", ..." : ""}`,
      );
    }

    // Live delegations: a delegate with an allowance can move tokens without the owner signing.
    for (const a of delegated) {
      const p = px.prices.get(a.mint);
      const symbol = sy.meta.get(a.mint)?.symbol;
      const da = a.delegatedAmount!;
      positions.push({
        protocol: "wallet",
        kind: "delegation",
        account: a.account,
        mint: a.mint,
        ...(symbol ? { symbol } : {}),
        amount: da,
        ...(p !== undefined ? { usd: da * p } : {}),
        extra: { delegate: a.delegate, tokenAccount: a.account, delegatedAmount: da, balance: a.amount },
        sources: [...ta.sources, ...(p !== undefined ? priceSrc : [])],
      });
    }

    return { positions, loans: [], gaps };
  },
};
