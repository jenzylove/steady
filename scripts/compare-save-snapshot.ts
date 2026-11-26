// Usage: tsx scripts/compare-save-snapshot.ts <wallet...>
// Applies our healthFactor to the per leg values stored in each Save obligation and compares with the
// obligation own unhealthyBorrowValue / borrowedValue, plus our live legs.
import { makeContext } from "../src/engine/context.js";
import { getProgramAccounts } from "../src/engine/adapters/lend-lib.js";
import { buildSaveLoan, decodeObligation, loadSaveReserves, snapshotLoan, SAVE_PROGRAM } from "../src/engine/adapters/save.js";
import { healthFactor } from "../src/engine/risk/health.js";

const ctx = makeContext();
const reserves = await loadSaveReserves(ctx);
for (const w of process.argv.slice(2)) {
  const f = await getProgramAccounts(ctx, SAVE_PROGRAM, [{ dataSize: 1300 }, { memcmp: { offset: 42, bytes: w } }]);
  for (const a of f.accounts) {
    const ob = decodeObligation(a.data);
    if (ob.borrows.length === 0) continue;
    const protocol = ob.unhealthyBorrowValue / ob.borrowedValue;
    const snap = healthFactor(snapshotLoan(a.pubkey, ob, reserves));
    const live = buildSaveLoan(a.pubkey, ob, reserves, [], [], f.slot).loan;
    console.log(`${w} ${a.pubkey} protocol=${protocol.toFixed(4)} snapshot=${snap.toFixed(4)} (${((snap / protocol - 1) * 100).toFixed(2)}%) live=${healthFactor(live).toFixed(4)} (${((healthFactor(live) / protocol - 1) * 100).toFixed(1)}%)`);
  }
}
