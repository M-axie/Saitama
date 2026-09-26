# Saitama V2 — WhatsApp AI Command Bot

Saitama V2 is a Baileys WhatsApp bot with an AI assistant, utility API commands, categorized command menus, and a lightweight status dashboard. Game features have been removed from the runtime and project.

## Run

```bash
npm install
npm start
```

For a hosting panel, use `npm run start:panel`. The bot stores WhatsApp credentials in `./session` and reads the pairing settings from `config.js` and environment variables.

Run tests with:

```bash
npm test
```

## AI chatbot

AI requests try two providers, in order:

1. **XCASPER SPACE `claude` endpoint** (default, no API key needed): `GET https://apiz.xcasper.space/api/ai/claude?query=<message>`, reading the reply from `data.reply`. Override with `SAITAMA_XCASPER_AI_URL` / `SAITAMA_XCASPER_AI_PATH`, or set `SAITAMA_XCASPER_AI_URL=` (empty) to disable it and go straight to provider 2.
2. **Your own saitama-api deployment**, configured via `SAITAMA_API_URL` and `SAITAMA_API_KEY`, hitting `config.api.endpoints.aiChat` (`/api/tools/ai/chat`). Used automatically if the xcasper call errors, and as the sole provider if xcasper is disabled.

The bot works out of the box on provider 1 — you don't need to run saitama-api or hold any AI provider key just to get `!chat` working. Note that the xcasper endpoint appears stateless (a `session` query param had no effect in testing), so each call there is a single fresh question; per-chat conversation history is still tracked locally and used if a request falls back to the saitama-api provider, which does accept a role-tagged prompt.

Commands:

- `!chat <message>` — ask the AI assistant.
- `!ai <message>` — AI alias.
- `!gpt <message>` — AI alias.
- `!chatbot on` / `!chatbot off` — turn automatic AI replies (plain messages with no `!`) on/off **for this chat**. This is saved to `data/saitama.sqlite` and survives restarts. `!ai <message>` still works either way. Run `!chatbot` alone to see the current state.
  - In DMs, any plain message reaches the AI while this is on.
  - In groups, a plain message only reaches the AI when the bot is @mentioned or the message replies to one of the bot's own messages — otherwise every ordinary message between members would get an AI reply.
- `!clearchat` — clear the current chat's AI memory.

The model name (`config.ai.model`, default `gpt-4o-mini`) is only used by the saitama-api fallback; the xcasper endpoint always answers as Claude 3.5 Sonnet regardless of this setting.

## Commands

`!help` displays the boxed categorized command menu. Commands are routed through a plugin registry with separate AI, core, API, and WhatsApp plugins. AI commands include `!chat`, `!ai`, and `!gpt`; ordinary messages are also handled automatically. Implemented utility commands include `!ip`, `!info`, `!audio`, `!video`, `!tiktok`, and `!yt`. General commands include `!ping`, `!uptime`, `!settings`, `!profile`, and `!stats`.

Owner, group, account, process, and destructive commands are recognized and enabled in the router, but remain protected by safety guards until explicit authorization checks are configured. They do not silently execute destructive actions.

### What's actually wired up vs. still a placeholder

Every command in `!help` is *recognized*, but not every one has real behavior behind it yet. Real, working commands:

- **AI**: `ai`/`chat`/`gpt`/`gptv`(text)/`advice`, `clearchat`, `chatbot` (aimode toggle, see above)
- **Toggles** (persisted per chat, admin-only in groups): `antilink`, `antitagall`, `antidelete`, `autoreact`, `welcome`, `bye` — all actually enforced via live event handling in `index.js`. `anticall` and `alwaysonline` are bot-wide (owner-only).
- **Group admin** (real Baileys calls): `gname`, `link`, `revoke`, `open`/`close`, `promote`/`demote`/`remove`/`xkick`/`groupadd`, `tagall`/`hidetag`, `leave`, `pin`/`pinchat`, `disappear`, `joinmode`, `addmode`, `pending`, `approveall`/`rejectall`, `groupstatus`, `delete`
- **Account/owner** (real Baileys calls): `lastseen`, `onlineprivacy`, `statusprivacy`, `privacy`, `checkon`, `bio`, `pp`, `block`/`blocklist`, `broadcast` (to all groups the bot is in), `joingc`, `kill`/`kill2` (ends the active game session), `vv` (reveal a quoted view-once), `forward`/`fwd2`
- **Utility API** (proxied to your Saitama API): `translate`, `summarize`, `code`, `define`/`dictionary`, `weather`, `country`, `currency`, `joke`, `quote`, `fact`, `anime`, `qr`, `ip`, `info`, `audio`, `video`, `tiktok`, `search`/`yt`

Still just a "registered, not wired" placeholder (they reply, but don't do the real thing yet — they need either a media pipeline or a confirmed API endpoint from your Saitama API before it's worth wiring for real): `editimage`, `worm`, `sticker`, `tgsticker`, `toimg`, `tomp3`, `blur`, `greyscale`, `rotate`, `watermark`, `compress`, `play`, `take`, `upload`, `ytv`, `yta`, `github`, `npm`, `movie`, `lyrics`, `removebg`, `tts`, `ocr`, `carbon`, `emojimix`, `fake`, `igstalk`, `shazam`, `transcribe`, `screenshot`, `device`, `fullpp`, `gpp`, `gsettings`, `gsettings2`, `setcmd`, `token`. Say which of these you actually want and I'll build them next.

## Dashboard

The dashboard runs at `http://127.0.0.1:8787` by default and shows bot uptime, AI status, and the number of cataloged commands. Configure its bind address with `SAITAMA_DASHBOARD_HOST` and `SAITAMA_DASHBOARD_PORT`.

## Environment variables

- `SAITAMA_XCASPER_AI_URL` — base URL for the default AI provider, default `https://apiz.xcasper.space`. Set to an empty string to disable it.
- `SAITAMA_XCASPER_AI_PATH` — path for the default AI provider, default `/api/ai/claude`.
- `SAITAMA_API_URL` — Saitama API base URL (AI fallback provider + utility commands).
- `SAITAMA_API_KEY` — Saitama API key.
- `SAITAMA_AI_MODEL` — AI model name, default `gpt-4o-mini`.
- `SAITAMA_AI_TIMEOUT_MS` — AI request timeout.
- `SAITAMA_OWNER_JID` — owner notification JID.
- `SAITAMA_PAIR_METHOD` — `code` or `qr`.
- `SAITAMA_PHONE_NUMBER` — phone number for pairing-code mode.
- `SAITAMA_PREFIX` — bot command prefix, default `!`.

## Structure

```text
index.js                              WhatsApp connection and message router
config.js                             API, AI, pairing, and dashboard settings
handlers/commands/helpcommands.js     categorized menu
handlers/commands/featurecommands.js  AI and general command router
handlers/commands/toolcommands.js     Saitama utility API router
lib/aiClient.js                       Saitama API AI client
lib/apiClient.js                      Saitama utility API client
dashboard/                            bot status dashboard
```
