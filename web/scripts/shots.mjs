// Headless walkthrough: every page in dark and light, the app flow with a real wallet, the fix, check and miner.
// Usage: node scripts/shots.mjs [baseUrl] [outDir] [only]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "C:/Users/LENOVO/steady-launch/shots";
const ONLY = process.argv[4] ?? "all";
const WALLET = "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
async function page(theme, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => { try { localStorage.setItem("steady-theme", t); } catch {} }, theme);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${theme} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${theme} console: ${m.text().slice(0, 200)}`); });
  return p;
}
const settle = (p, ms = 1800) => p.waitForTimeout(ms);
async function revealAll(p) {
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await p.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")));
}

for (const theme of ["dark", "light"]) {
  if (ONLY === "all" || ONLY === "static") {
    const p = await page(theme);
    for (const [name, path, wait] of [["landing", "/", 6000], ["proof", "/proof", 2500], ["check", "/check", 1200], ["app-empty", "/app", 1200]]) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      await settle(p, wait);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-fold.png` });
      await revealAll(p); await settle(p, 1200);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-full.png`, fullPage: true });
    }
    // Miner: live query
    await p.goto(BASE + "/miner", { waitUntil: "networkidle" });
    await p.click("button.chip >> nth=0");
    await p.waitForSelector(".num-xl, .tag.risk", { timeout: 40000 });
    await settle(p, 1200);
    await p.screenshot({ path: `${OUT}/miner-${theme}-full.png`, fullPage: true });
    // Check: sample transfer
    await p.goto(BASE + "/check", { waitUntil: "networkidle" });
    await p.fill("#w", WALLET);
    await p.click("text=Build a sample transfer");
    await p.click("button:has-text('Check it')");
    await p.waitForSelector(".verdict-big, p[style*='risk']", { timeout: 90000 });
    await settle(p, 2000);
    await p.screenshot({ path: `${OUT}/check-${theme}-result.png`, fullPage: true });
    await p.context().close();
  }
  if ((ONLY === "all" || ONLY === "app") && theme === "dark" || ONLY === `app-${theme}`) {
    const p = await page(theme);
    await p.goto(`${BASE}/app?wallet=${WALLET}`, { waitUntil: "domcontentloaded" });
    await settle(p, 9000);
    await p.screenshot({ path: `${OUT}/app-${theme}-waiting.png` });
    await p.waitForSelector(".result, .app-empty", { timeout: 160000 });
    await settle(p, 2000);
    await p.screenshot({ path: `${OUT}/app-${theme}-result-fold.png` });
    await p.click("details.drawer >> nth=0 >> summary").catch(() => {});
    await p.click("button:has-text('Prepare fix') >> nth=0").catch((e) => errors.push("no prepare fix: " + e.message));
    await p.waitForSelector(".fix-result, .fix p[style*='risk']", { timeout: 160000 }).catch((e) => errors.push("fix timeout " + e.message));
    await settle(p, 1500);
    for (const d of await p.$$("details.row")) await d.evaluate((el) => (el.open = true));
    await p.click("button:has-text('Verify') >> nth=-1").catch(() => {});
    await settle(p, 1500);
    await p.screenshot({ path: `${OUT}/app-${theme}-result-full.png`, fullPage: true });
    await p.context().close();
  }
}
// Mobile landing and app empty state
if (ONLY === "all" || ONLY === "mobile") {
  for (const theme of ["dark", "light"]) {
    const p = await page(theme, { width: 390, height: 844 });
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await settle(p, 6000);
    await p.screenshot({ path: `${OUT}/landing-${theme}-mobile-fold.png` });
    await revealAll(p); await settle(p, 1000);
    await p.screenshot({ path: `${OUT}/landing-${theme}-mobile-full.png`, fullPage: true });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 390) errors.push(`mobile ${theme} horizontal overflow: ${sw}px`);
    await p.context().close();
  }
}
await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
