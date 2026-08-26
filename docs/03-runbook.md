# Runbook

Satisfies clause 14.4 — "what each part does, where it runs, what it costs, how to change it, and
what to check first when something breaks."

Written for someone who is not us. Clause 14.3 requires the system to keep running unchanged if
Thought Pilot stops work tomorrow, and that is only true if this document is good enough to hand to
another developer, or to read yourself at nine on a Monday when the calendar looks wrong.

---

## 1. What each part does

| Part | Where it runs | What it does |
|---|---|---|
| **Telegram bot** | Supabase Edge Function `telegram-webhook` | Everything you touch on your phone: voice notes, typed thoughts, images, answering questions, pushing back on a draft |
| **Queue dispatcher** | Edge Function `worker-dispatch`, every minute | Runs the pipeline: transcribe → interview → extract → draft → gate → visual |
| **Selector** | Edge Function `worker-select`, every 4 hours | Decides what gets written next; keeps ~2 weeks queued; blocks retold stories |
| **Triage** | Edge Function `worker-triage`, every 15 min | Turns call transcripts, Claude Code digests and Slack into *candidates* — never drafts |
| **Call transcripts** | Edge Function `transcript-webhook` | Receives a webhook when a call ends. Adapters for Fireflies, Fathom and Otter/Granola, plus a generic reader for anything else |
| **Slack** | Edge Function `worker-slack`, 09:00 and 17:00 on weekdays | Reads the channels Josh is in. **Does nothing unless `slack_enabled` is true** |
| **Publisher** | Edge Function `worker-publish`, every 5 min | Publishes posts you marked ready, on the date you set |
| **Metrics** | Edge Function `worker-metrics`, daily 09:00 | Pulls engagement 7 days after publishing |
| **Learning** | Edge Function `worker-learn`, Mondays 07:00 | Proposes library changes, with evidence, for you to approve |
| **Ops** | Edge Function `worker-ops`, daily 08:00 + monthly | Silence alerts, queue warnings, the two monthly reports |
| **The desk** (web app) | Vercel | Weekly pass, calendar, idea bank, library, proposals |
| **cc-agent** | **Your machine**, scheduled | Reads Claude Code logs locally, sends small digests. Never sends code. |

Everything except `cc-agent` and the web app runs inside your Supabase project.

## 2. The rules that are enforced, not just intended

Worth knowing, because they are why certain things "cannot" happen:

- **Nothing publishes without you.** `posts` has check constraints requiring `marked_ready_at` before
  a row can reach `ready`, `scheduled` or `published`. Not application logic — the database refuses.
- **The system cannot delete anything.** DELETE is revoked from `anon`, `authenticated` and
  `service_role` on every table. You can still delete from the Supabase dashboard; the system cannot.
- **The learning loop cannot touch the core rules.** A trigger rejects any proposal against the
  `core_rules` library section, which holds the lived-experience test and the no-fabrication rule.
- **Automatic inputs cannot produce drafts.** They create moments at `half_mined`; the selector only
  ever picks up `mined`, and only the interview moves a moment there.

If you ever need to verify these still hold, run `bash supabase/tests/run-migrations.sh` — it rebuilds
the schema from scratch and asserts every one of them.

## 3. Setting it up from nothing

```bash
# 1. Database
supabase link --project-ref <your-project-ref>
supabase db push                      # applies supabase/migrations in order

# 2. Secrets the scheduler needs (stored in Supabase Vault, not in a table)
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
select vault.create_secret('<service_role_key>', 'service_role_key');

# 3. Edge function environment
supabase secrets set \
  ANTHROPIC_API_KEY=... \
  DEEPGRAM_API_KEY=... \
  OPENAI_API_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... \
  TELEGRAM_WEBHOOK_SECRET=... \
  TRANSCRIPT_WEBHOOK_SECRET=... \
  SLACK_USER_TOKEN=... \
  LINKEDIN_CLIENT_ID=... \
  LINKEDIN_CLIENT_SECRET=...

# 4. Deploy
supabase functions deploy telegram-webhook transcript-webhook worker-dispatch \
  worker-select worker-triage worker-slack worker-publish worker-metrics \
  worker-learn worker-ops

# 5. Point Telegram at the webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<ref>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

# 6. The web app
cd app && npm install && vercel deploy --prod
```

**LinkedIn.** Create an app at developer.linkedin.com under the Slingshot GTM page. Add the "Share on
LinkedIn" product (self-serve, instant) for posting. Separately request Community Management API
access for analytics. Then store the token:

```sql
update public.linkedin_auth set
  member_urn = 'urn:li:person:<your-id>',
  access_token = '<token>',
  refresh_token = '<refresh token>',
  access_expires_at = now() + interval '60 days',
  has_post_analytics = false          -- flip to true once approved
where id = true;
```

**Call recorder.** Point its webhook at:

```
https://<ref>.supabase.co/functions/v1/transcript-webhook?secret=<TRANSCRIPT_WEBHOOK_SECRET>
```

Fireflies, Fathom and Otter/Granola payload shapes are recognised automatically. Anything else falls
back to a generic reader that finds the transcript in the payload, so an unfamiliar recorder still
works on day one rather than dropping calls silently. Send one test call, then check it arrived:

```sql
select created_at, kind, detail from system_events
where kind like 'transcript%' order by created_at desc limit 5;
```

**Slack — optional, and off until you turn it on.** Create a Slack app with `channels:history`,
`groups:history`, `channels:read`, `groups:read` and `users:read`, install it to the workspace, set
`SLACK_USER_TOKEN`, then:

```sql
update public.settings set value = 'true' where key = 'slack_enabled';

-- To mute one noisy channel without turning the whole input off:
update public.slack_state set enabled = false where channel_name = 'random';
```

It reads only channels you are a member of, joins nothing and posts nothing. Everyone named in a
Slack conversation is recorded and left uncleared — 4.5.3 is explicit that this is other people's
words in a place they did not expect to be quoted.

**cc-agent**, on your machine. Calibrate before trusting it:

```bash
node eval/calibrate-cc.mjs             # what the filter would surface, and at what rate
node cc-agent/index.mjs --dry-run      # what it would send today
```

Then schedule it. One command — it asks for the two values, registers a daily task (Task Scheduler on
Windows, `launchd` on a Mac, a systemd timer on Linux), and proves the wiring with a dry run:

```bash
node cc-agent/install.mjs              # set it up
node cc-agent/install.mjs --status     # is it scheduled, when did it last run
node cc-agent/install.mjs --uninstall  # stop it
```

Credentials go in `cc-agent/.env`, readable only by you, rather than into the task definition —
`schtasks /query` prints arguments in full, and a service-role key has no business in anything that
prints.

4.4.1 says these logs must be read "on a schedule, with no action from Josh". That cannot mean no
action ever: the logs are on your machine and nothing in Supabase can reach them. It means no action
per **run**. This is the one setup, and then never again — which is the point, because the previous
version of this section asked you to build a scheduled task by hand, and that is the class of
instruction that quietly never happens.

## 4. What to check first when something breaks

**Start here, always.** The system logs its own failures rather than swallowing them:

```sql
select created_at, kind, severity, detail
from system_events
where severity in ('warn','error')
order by created_at desc limit 20;
```

| Symptom | Most likely cause | Check |
|---|---|---|
| Sent a voice note, heard nothing | Telegram webhook not reaching Supabase | `getWebhookInfo` on the Telegram API; then Supabase function logs |
| Voice notes land but no questions come | Queue not being ticked, or the model call failing | `select * from jobs where status in ('pending','dead') order by id desc limit 20;` |
| Nothing being drafted | Nothing mined, or the selector found nothing strong enough | `select status, count(*) from moments group by status;` |
| Drafts never appear in the calendar | The gate is rejecting everything | `select check_key, count(*) from gate_runs where passed = false group by 1;` |
| A scheduled post did not go out | LinkedIn token expired | `select access_expires_at, last_error from linkedin_auth;` |
| No engagement numbers | Analytics scope not granted yet — expected until approved | `select has_post_analytics from linkedin_auth;` |
| Costs climbing | More drafts, or more gate retries | `select purpose, sum(cost_usd) from llm_calls where created_at > now() - interval '30 days' group by 1 order by 2 desc;` |

**A dead job** has exhausted its retries. Read `last_error`, fix the cause, then requeue:

```sql
update jobs set status = 'pending', attempts = 0, run_after = now() where id = <id>;
```

## 5. How to change things

| To change | Do this | Deploy needed? |
|---|---|---|
| What it writes about, how it hooks, how it sounds | Edit the section in **The desk → Library** | No — next draft uses it |
| The questions a session asks | Library → The prompt set | No |
| What the gate checks beyond the six | Library → Gate rules | No |
| How many posts to keep queued | `update settings set value = '12' where key = 'queue_target_posts';` | No |
| Turn Slack on | `update settings set value = 'true' where key = 'slack_enabled';` | No |
| How long before it chases you about silence | `settings` → `silence_alert_days` | No |
| How many Claude Code candidates a day | `settings` → `cc_candidates_per_day` | No |
| The prompts themselves, the pipeline, the models | Edit code, `supabase functions deploy` | Yes |

Almost everything you would actually want to change is in the library or the settings table, by
design (clause 16: "if changing a question needs a developer, the prompt set never gets changed and
the system decays").

## 6. Backups and getting your data out

Supabase Pro takes daily backups automatically. To take your own copy at any time:

```bash
supabase db dump -f idea-bank.sql          # everything, restorable anywhere
# or, per table, as CSV from the Supabase dashboard
```

Audio and images live in Storage and download from the dashboard or the CLI. Nothing is in a
proprietary format, and nothing requires our involvement (6.2, 14.3).

## 7. Running the tests

```bash
bash supabase/tests/run-migrations.sh                 # schema + the enforced rules
node --test supabase/functions/_shared/*.test.ts      # claim ledger, edit classification
deno check supabase/functions/*/index.ts              # every function type-checks under Deno
node eval/syntax-check.mjs                            # fallback parse check if Deno is absent
node eval/calibrate-cc.mjs                            # Claude Code filter rates
node eval/regression.mjs --compare                    # re-draft the golden set, diff vs last run
cd app && npx tsc --noEmit && npx next build          # the web app
```

Run the regression harness before and after any library change. If claim verification gets worse, the
change made fabrication more likely and should be rolled back from **Library → roll back to**.
