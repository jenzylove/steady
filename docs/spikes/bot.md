# Telegram bot spike

Bot @steadysol_bot, code in `src/bot/`, run with `npm run bot` (needs TELEGRAM_BOT_TOKEN and HELIUS_API_KEY in .env).

## What it does
- Long polling over fetch (getUpdates, 30s). Commands: /start, /watch, /unwatch, /list, /check, /help. A pasted Solana address acts as /check.
- Seed phrases (12 to 24 lowercase words), base58 secret keys, 64 byte JSON keypairs and 64 hex strings get a warning and are never stored or echoed.
- Reports (`report.ts`): HTML, escaped, total value, up to 5 findings by severity with emoji and key numbers, "Fix ready" line plus `https://steady.jdollar.site/app?wallet=<address>#<finding id>`, one verification line (Telegraph answers used and rejected). Hard cap 3500 characters.

## Watching
- `data/watch.json` maps chatId to wallets with the last seen finding ids and severities. `/watch` baselines the first report so the first heartbeat does not repeat it.
- Heartbeat every WATCH_INTERVAL_MIN minutes (default 15). Alerts only for high or critical findings that are new or worse than last seen. Unchanged or improved findings stay quiet.
- Cost control: each heartbeat runs `advise(wallet, ctx, { telegraph: false })`, which makes no paid Telegraph calls. Only if that run shows a high or critical finding is it re run once with Telegraph on, so the alert carries verified evidence. Quiet wallets cost nothing per heartbeat.

## Checked
- Tests: `src/bot/bot.test.ts` (formatting, length cap, escaping, diff new/worsened/unchanged, secret guard). No network.
- Live: getMe returned @steadysol_bot; formatter run on a live advise() for 44tDHrCk3yr91ruoGk9VZMHJoKDjviuHAXZrwYBfsCaS (`npx tsx src/bot/sample.ts <address>`). Nothing was sent to any chat.

## Not done
- Polling and heartbeat not exercised end to end against real Telegram users by design.
- The app route must read `?wallet=` and the `#<finding id>` hash for the link to land on the fix.
