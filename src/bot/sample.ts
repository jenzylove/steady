// Local check: confirm the token works (getMe) and print the formatted report for a wallet. Sends nothing to any chat.
import "dotenv/config";
import { makeContext } from "../engine/context.js";
import { advise } from "../engine/advice/advise.js";
import { formatReport } from "./report.js";
import { Tg } from "./bot.js";

const me = await new Tg(process.env.TELEGRAM_BOT_TOKEN!).call<{ username: string }>("getMe");
console.log("getMe ok @" + me.username);
const m = formatReport(await advise(process.argv[2]!, makeContext()));
console.log(m, "\n--- length", m.length);
