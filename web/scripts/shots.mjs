// Headless walkthrough: every page in dark and light, mobile 390px, the check scenarios, the miner board, the running now strip,
// the remembered wallet, and the app flow with a real wallet. Fails loudly on page errors, overflow and unnamed controls.
// Usage: node scripts/shots.mjs [baseUrl] [outDir] [only]   only: all | static | check | mobile | app
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "C:/Users/LENOVO/steady-launch/shots-v2";
const ONLY = process.argv[4] ?? "all";
const WALLET = "44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const notes = [];
async function page(theme, viewport = { width: 1440, height: 900 }, init) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t, w]) => { try { localStorage.setItem("steady-theme", t); if (w) localStorage.setItem("steady-wallet", w); else localStorage.removeItem("steady-wallet"); } catch {} }, [theme, init?.wallet ?? null]);
  const p = await ctx.newPage();
  const tag = `${theme} ${viewport.width}`;
  p.on("pageerror", (e) => errors.push(`${tag} pageerror ${p.url()}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(429)/.test(m.text())) errors.push(`${tag} console ${p.url()}: ${m.text().slice(0, 200)}`); });
  return p;
}
const settle = (p, ms = 1800) => p.waitForTimeout(ms);
async function revealAll(p) {
  await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await p.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")));
}
async function audit(p, label) {
  const width = p.viewportSize().width;
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > width) errors.push(`${label}: horizontal overflow ${sw}px > ${width}px`);
  const unnamed = await p.evaluate(() => [...document.querySelectorAll("a, button")].filter((el) => {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    return !(el.getAttribute("aria-label") || (el.textContent ?? "").trim() || el.getAttribute("title"));
  }).map((el) => el.outerHTML.slice(0, 80)));
  if (unnamed.length) errors.push(`${label}: ${unnamed.length} controls with no name: ${unnamed.slice(0, 3).join(" | ")}`);
  const dashes = await p.evaluate(() => {
    const t = document.body.innerText;
    return (t.match(/[^\n]{0,30}[—–][^\n]{0,30}/g) ?? []).slice(0, 3);
  });
  if (dashes.length) errors.push(`${label}: dash in copy: ${dashes.join(" | ")}`);
}

for (const theme of ["dark", "light"]) {
  if (ONLY === "all" || ONLY === "static") {
    const p = await page(theme);
    for (const [name, path, wait] of [["landing", "/", 7000], ["proof", "/proof", 6000], ["check", "/check", 1500], ["app-empty", "/app", 1500]]) {
      await p.goto(BASE + path, { waitUntil: "networkidle" });
      await settle(p, wait);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-fold.png` });
      await revealAll(p); await settle(p, 1200);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-full.png`, fullPage: true });
      await audit(p, `${name} ${theme}`);
    }
    // Running now strip has live numbers
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.waitForSelector(".running-c .running-v:not(.mute)", { timeout: 40000 }).catch(() => errors.push(`${theme}: running now strip never filled`));
    const strip = await p.$(".running"); if (strip) await strip.screenshot({ path: `${OUT}/running-${theme}.png` });
    notes.push(`running ${theme}: ` + (await p.$$eval(".running-c", (cs) => cs.map((c) => c.innerText.replace(/\s+/g, " ")).join(" | "))));
    // How it works, vertical
    const flow = await p.$("#how"); if (flow) { await flow.scrollIntoViewIfNeeded(); await settle(p, 5000); await flow.screenshot({ path: `${OUT}/how-${theme}.png` }); }
    // Miner board: live, rows filled, one row opened
    await p.goto(BASE + "/miner", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("tr.brow", { timeout: 60000 });
    await settle(p, 2500);
    const rows = await p.$$eval("tr.brow", (rs) => rs.map((r) => r.innerText.replace(/\s+/g, " ")));
    notes.push(`miner rows ${theme}: ${rows.length}`);
    if (rows.length !== 9) errors.push(`miner board shows ${rows.length} rows`);
    await p.screenshot({ path: `${OUT}/miner-${theme}-fold.png` });
    await p.click("tr.brow >> nth=0");
    await p.waitForSelector("tr.bjson pre");
    await revealAll(p); await settle(p, 800);
    await p.screenshot({ path: `${OUT}/miner-${theme}-full.png`, fullPage: true });
    await audit(p, `miner ${theme}`);
    await p.context().close();
  }
  if (ONLY === "all" || ONLY === "check") {
    // Check: first load shows no error; each bad scenario blocks; a send with a remembered wallet runs
    const p = await page(theme, undefined, { wallet: WALLET });
    await p.goto(BASE + "/check", { waitUntil: "networkidle" });
    const early = await p.$$eval("p", (ps) => ps.filter((x) => getComputedStyle(x).color.includes("rgb(255, 91, 61)") || getComputedStyle(x).color.includes("rgb(217, 54, 27)")).length);
    if (early) errors.push(`check ${theme}: ${early} error lines before any action`);
    await p.fill("#to", "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
    await p.click("button:has-text('Check this send')");
    await p.waitForSelector(".verdict-big", { timeout: 90000 }).catch(() => errors.push(`check ${theme}: send gave no verdict`));
    await settle(p, 1500);
    notes.push(`check send ${theme}: ${await p.$eval(".verdict-big", (e) => e.textContent).catch(() => "none")}`);
    await p.screenshot({ path: `${OUT}/check-${theme}-send.png`, fullPage: true });
    if (theme === "dark") {
      await p.click("button[role=tab]:has-text('block a bad one')");
      for (const [k, name] of [[0, "approval"], [1, "lookalike"], [2, "handover"], [3, "takeover"]]) {
        await p.click(`ul.bad li >> nth=${k} >> button`);
        await p.waitForFunction(() => !document.querySelector("ul.bad button[disabled]"), null, { timeout: 90000 });
        await settle(p, 800);
        const verdict = await p.$eval(".verdict-big", (e) => e.textContent).catch(() => "none");
        const reasons = await p.$$eval(".reasons li", (ls) => ls.map((l) => l.textContent).join(" / ")).catch(() => "");
        notes.push(`check bad ${name}: ${verdict} :: ${reasons.slice(0, 220)}`);
        if (verdict !== "Block") errors.push(`check bad ${name}: verdict ${verdict}`);
        await p.screenshot({ path: `${OUT}/check-${theme}-bad-${name}.png`, fullPage: true });
      }
    } else {
      await p.click("button[role=tab]:has-text('block a bad one')");
      await settle(p, 500);
      await p.screenshot({ path: `${OUT}/check-${theme}-bad-list.png`, fullPage: true });
    }
    await audit(p, `check ${theme}`);
    await p.context().close();
  }
  if (((ONLY === "all" || ONLY === "app") && theme === "dark") || ONLY === `app-${theme}`) {
    // Remembered wallet: /app with no link opens it straight away
    const p = await page(theme, undefined, { wallet: WALLET });
    await p.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await p.waitForURL(/wallet=/, { timeout: 15000 }).catch(() => errors.push("remembered wallet did not open /app"));
    await settle(p, 9000);
    await p.screenshot({ path: `${OUT}/app-${theme}-waiting.png` });
    await p.waitForSelector(".result, .app-empty", { timeout: 160000 });
    await settle(p, 2500);
    await p.screenshot({ path: `${OUT}/app-${theme}-result-fold.png` });
    const watch = await p.$eval(".watch a.btn", (a) => a.getAttribute("href")).catch(() => null);
    notes.push(`watch link: ${watch}`);
    if (!watch?.includes(`start=${WALLET}`)) errors.push("watch link missing");
    await p.click("button:has-text('Prepare fix') >> nth=0").catch((e) => errors.push("no prepare fix: " + e.message));
    await p.waitForSelector(".fix-result, .fix p[style*='risk']", { timeout: 160000 }).catch((e) => errors.push("fix timeout " + e.message));
    await settle(p, 1500);
    notes.push(`fix memo: ${(await p.$$eval(".fix-result details.drawer summary", (s) => s.map((x) => x.textContent).join(" / ")).catch(() => ""))} ${(await p.$eval(".fix-result p.mute", (e) => e.textContent).catch(() => ""))}`);
    for (const d of await p.$$("details.row")) await d.evaluate((el) => (el.open = true));
    await settle(p, 800);
    await p.screenshot({ path: `${OUT}/app-${theme}-result-full.png`, fullPage: true });
    await audit(p, `app ${theme}`);
    await p.context().close();
  }
}
if (ONLY === "all" || ONLY === "mobile") {
  for (const theme of ["dark", "light"]) {
    const p = await page(theme, { width: 390, height: 844 }, { wallet: WALLET });
    for (const [name, path, wait] of [["landing", "/", 7000], ["check", "/check", 1500], ["miner", "/miner", 9000], ["proof", "/proof", 6000]]) {
      await p.goto(BASE + path, { waitUntil: "load" });
      await settle(p, wait);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-mobile-fold.png` });
      await revealAll(p); await settle(p, 1000);
      await p.screenshot({ path: `${OUT}/${name}-${theme}-mobile-full.png`, fullPage: true });
      await audit(p, `${name} ${theme} mobile`);
    }
    await p.click(".wchip > button");
    await settle(p, 400);
    await p.screenshot({ path: `${OUT}/nav-wallet-${theme}-mobile.png` });
    await p.context().close();
  }
  // App result at 390 for the aria label check
  const p = await page("dark", { width: 390, height: 844 });
  await p.goto(`${BASE}/app?wallet=${WALLET}`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".result, .app-empty", { timeout: 160000 });
  await settle(p, 2000);
  for (const d of await p.$$("details")) await d.evaluate((el) => (el.open = true));
  await p.screenshot({ path: `${OUT}/app-dark-mobile-full.png`, fullPage: true });
  await audit(p, "app dark mobile");
  await p.context().close();
}
await browser.close();
console.log(notes.join("\n"));
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no page errors");
process.exit(errors.length ? 1 : 0);
