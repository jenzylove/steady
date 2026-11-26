import "dotenv/config";
import { makeContext } from "../src/engine/context.js";
import { startBot } from "../src/bot/bot.js";
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
await startBot(token, makeContext());
