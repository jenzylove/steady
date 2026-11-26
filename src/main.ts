// One image, several Railway services: STEADY_SERVICE picks what runs (miner by default for the registered miner host).
const which = process.env.STEADY_SERVICE ?? "miner";
if (which === "api") await import("./api/server.js");
else if (which === "bot") await import("../scripts/bot.js");
else await import("./miner/server.js");
