# Closing out the old surfaces

The Telegram and web surfaces are gone from the repository. Two things are still live and have to be
retired by hand, in this order, **after** Josh has the repo and his two values.

Why by hand: taking down a service a client is still using is not something to automate, and the
agent running this build was correctly refused permission to do it. Each step below is reversible up
until the token is revoked, which is the point of no return.

---

## 1. First, confirm he is connected

Do not start until Josh has replied to say he has run `node mcp-server/index.mjs --check` and seen
`ok`. Everything below removes his current way of reaching the system, and the gap between "his old
way stopped" and "his new way started" should be zero.

`docs/to-josh/2026-10-09-what-changed-and-how-to-connect.md` is the note to send him.

---

## 2. Stop Telegram delivering

```bash
# The bot token is in the vault. Read it without printing it:
TOK=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/read_secrets" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{}' \
  | python -c "import sys,json;print(next(s['value'] for s in json.load(sys.stdin) if s['name']=='TELEGRAM_BOT_TOKEN'))")

# What it is pointed at now, and whether anything is queued:
curl -s "https://api.telegram.org/bot$TOK/getWebhookInfo"

# Take it down, dropping anything queued:
curl -s "https://api.telegram.org/bot$TOK/deleteWebhook?drop_pending_updates=true"
```

**Do this before undeploying the function.** A webhook pointed at a function that no longer exists
retries into a 404 for days, and from Josh's side the bot looks broken rather than closed — which is a
worse way to retire something than telling him.

---

## 3. Undeploy the three functions

```bash
npx supabase functions delete telegram-webhook
npx supabase functions delete worker-sweep
npx supabase functions delete worker-slack
```

Deleting them from git did not undeploy them. A function live in the project and absent from the
repository is code nobody can read still running against Josh's data — this build has had eight such
deploys at once before, which is why `eval/e2e/cases/s0-wiring.mjs` case S0-01b now checks for it. That
case currently *reports* rather than fails, because the webhook is deliberately still up; once these
three are gone it is clean.

---

## 4. Revoke the bot at BotFather

In Telegram, message **@BotFather** → `/mybots` → the bot → **Delete Bot** (or **Revoke current
token** if you would rather keep the name).

This is the irreversible one and it needs a human in Telegram. Deleting the vault row does **not**
disable the bot: the token keeps working for anyone who has it, and that token has been pasted into
config, logs and transcripts over two months.

---

## 5. Remove the retired secrets

```sql
-- After revoking each one at its provider, not before. Deleting the row only hides it.
select vault.delete_secret(id) from vault.secrets
 where name in (
   'TELEGRAM_BOT_TOKEN',       -- revoked at BotFather in step 4
   'TELEGRAM_CHAT_ID',
   'TELEGRAM_WEBHOOK_SECRET',
   'SLACK_USER_TOKEN',         -- revoke in Slack first: it is HIS user token and reads what he reads
   'DEEPGRAM_API_KEY',         -- revoke at Deepgram: no voice path remains
   'APP_URL'                   -- only rewriteLink read it, and that is gone
 );
```

Then trim the same names from `SECRET_NAMES` in `supabase/functions/_shared/secrets.ts`, or
`secretStatus()` reports six credentials permanently missing and the health read becomes noise.

**Keep:** `OPENAI_API_KEY` (also the embeddings provider for duplicate detection),
`GEMINI_API_KEY`, `GROQ_API_KEY`, `HUGGINGFACE_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`,
`TRANSCRIPT_WEBHOOK_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.

---

## 6. Rotate what has been exposed

Outstanding since 5 October and not related to the above:

```bash
node mcp-server/mint-http-tokens.mjs --set     # the connector tokens
```

The write token has been pasted around during the build. Minting new ones writes them to
`mcp-server/.http-tokens` rather than printing them, and **Josh's connector config has to be updated
at the same time** or his desktop/claude.ai connection stops working. His local Claude Code setup uses
`CONTENT_MCP_KEY` instead and is unaffected.

Also drop the five dead OpenRouter keys — they hit their caps on 19 September and have not worked
since.

---

## 7. The one command still outstanding from the original build

The scoped database role has never had its key minted, so the connector falls back to the service
role — which bypasses row-level security entirely and is the opposite of what that role exists for:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... node mcp-server/mint-key.mjs --write
```

A personal access token from <https://supabase.com/dashboard/account/tokens>, used for that one call
and stored nowhere. Until it is run, every tool is writing with a key that can do anything, and the
sixteen-tables-readable / three-insertable / nothing-deletable boundary is a grant list nothing
exercises.

Do this one **before** handing over, not after: it is the difference between giving Josh a door and
giving him the building.
