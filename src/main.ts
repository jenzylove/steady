// One image, several Railway services: STEADY_SERVICE picks what runs (miner by default for the registered miner host).
import { createServer } from "node:http";
const which = process.env.STEADY_SERVICE ?? "miner";
if (which === "api") await import("./api/server.js");
else if (which === "bot") {
  // The bot long polls Telegram; /health lets the host check it is alive, /stats gives counts only (no addresses, no chat ids).
  const { botStats } = await import("./bot/stats.js");
  createServer((req, res) => {
    const stats = (req.url ?? "").startsWith("/stats");
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(stats ? botStats() : { status: "ok", service: "steady-bot" }));
  }).listen(Number(process.env.PORT ?? 8789));
  await import("../scripts/bot.js");
} else {
  // The miner module only listens when run directly, so start it here.
  const { createMinerServer } = await import("./miner/server.js");
  const { makeContext } = await import("./engine/context.js");
  const ctx = makeContext();
  const port = Number(process.env.PORT ?? 8787);
  createMinerServer({ ctx: () => ctx }).listen(port, () => console.log(`steady liquidity miner on :${port}`));
}
