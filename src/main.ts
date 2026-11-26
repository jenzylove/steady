// One image, several Railway services: STEADY_SERVICE picks what runs (miner by default for the registered miner host).
import { createServer } from "node:http";
const which = process.env.STEADY_SERVICE ?? "miner";
if (which === "api") await import("./api/server.js");
else if (which === "bot") {
  // The bot long polls Telegram; a tiny health endpoint lets the host check it is alive.
  createServer((_, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":"ok","service":"steady-bot"}'); }).listen(Number(process.env.PORT ?? 8789));
  await import("../scripts/bot.js");
} else await import("./miner/server.js");
