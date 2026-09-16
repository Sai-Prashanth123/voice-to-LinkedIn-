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

## 2b. Working on it — the two things that are not in this repo

### The Supabase connection an agent uses

Claude Code talks to the project through an MCP server, added per-person and per-machine:

```bash
claude mcp add --scope local --transport http supabase-voice-to-content \
  "https://mcp.supabase.com/mcp?project_ref=<your-project-ref>"
claude mcp login supabase-voice-to-content   # browser; sign in as the project owner
```

Local scope, deliberately: the OAuth credential is personal, so it does not belong in a file that
gets committed. It also pins the project ref, which a general Supabase connection does not — and
that is the reason this server exists at all. A connection authorised as a different account
reports itself healthy and then refuses every call with `You do not have permission to perform
this action`, which reads like a bug in the query rather than a bug in the login.

### The migration ledger has seven backfilled rows

Migrations 0017–0023 were applied as raw SQL and never recorded, so the ledger said 0016 while the
schema said 0023. Anything rebuilding from the ledger — which 14.1 eventually will, in Josh's
account — would have replayed seven migrations already in place.

They are recorded now and marked `created_by = 'ledger-backfill'`, so which rows were applied out
of band is visible rather than inferred. Their `statements` column holds a pointer to the canonical
file plus its size and hash, not the SQL itself: `db push` replays from `supabase/migrations/`, so
the column is a record rather than a source, and 33 KB transcribed by hand could drift from the
file with nothing to catch it.

Check it with:

```sql
select version, name, created_by from supabase_migrations.schema_migrations order by version;
```

## 3. Setting it up from nothing

```bash
# 1. Database
supabase link --project-ref <your-project-ref>
supabase db push                      # applies supabase/migrations in order

# 2. Secrets the scheduler needs (stored in Supabase Vault, not in a table)
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
select vault.create_secret('<service_role_key>', 'service_role_key');

# Telegram access
# After migration 0035 and the webhook deploy, a new person sends /start and is registered
# automatically. Approved users share the same bank and drafts; no Vault edit is needed per user.

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

**Claude Code sessions**, on your machine. There are two ways to read them and you only need one.

### The short way: ask for it

If you use Claude Code you already have the MCP server, so there is nothing further to install:

> scan my sessions

The `scan_sessions` tool reads this machine's recent sessions, keeps only the genuinely unusual
ones, and sends a digest of what you **said and decided**. No code and no tool output ever leaves
the machine — the filter runs locally, which is what keeps 625 MB of logs and anything resembling
client work off the wire (15.4).

Ask for a dry run the first time on a new machine. It shows exactly what would be sent, sends
nothing, and leaves the seen-list untouched so a real run afterwards still has every session to look
at.

It refuses to upload with a service_role key. It does not need one: `worker-triage` builds its own
admin client and only requires a valid JWT, so **the anon key is enough**, and a key that bypasses
row-level security should not sit on a laptop to do a job the public key can do. Put the anon key in
the MCP server's environment as `CONTENT_SYSTEM_KEY`.

To make it automatic, add a `SessionStart` hook that runs it in the background. That fires when you
start working — which is also the only time new sessions exist to read — so it is a better trigger
than a fixed hour, not a worse one.

### The long way: schedule it

Only needed if Claude Code is **not** where you work. Calibrate first:

```bash
node eval/calibrate-cc.mjs             # what the filter would surface, and at what rate
node cc-agent/index.mjs --dry-run      # what it would send today
```

Then one command registers a daily task (Task Scheduler on Windows, `launchd` on a Mac, a systemd
timer on Linux):

```bash
node cc-agent/install.mjs              # set it up
node cc-agent/install.mjs --status     # is it scheduled, when did it last run
node cc-agent/install.mjs --uninstall  # stop it
```

Credentials go in `cc-agent/.env`, readable only by you, rather than into the task definition —
`schtasks /query` prints arguments in full, and a key has no business in anything that prints.

Note that the scheduled runner also executes `work.mjs`, which drafts and gates through Claude Code.
That makes this machine the drafting engine, on your subscription. The two jobs are isolated, so if
you do not have Claude Code the reader still runs.

### On 4.4.1

The clause says these logs must be read "on a schedule, with no action from Josh". That cannot mean
no action ever — the logs are on your machine and nothing in Supabase can reach them.

The scheduled route reads it as no action per **run**: one setup, then never again. The hook reads
it as no action you would not already be taking. Both are honest readings and neither is a
reinterpretation made quietly; whichever you use, this paragraph is why.

**If you do not use Claude Code, this input produces nothing however it is installed.** That is
worth settling before either route, because acceptance test 4 waits on it either way.

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

## 4b. What it costs, and where

14.4 names five things a runbook must cover and this document claimed all five while covering four.
The cost lived only in `docs/02-cost-model.md`, which is the *budget*. This is the operational half:
what each running part costs, in the place you would look when a bill surprises you.

| Where it runs | What it costs | Billed by |
|---|---|---|
| Supabase (database, storage, edge functions, cron) | $25/mo on Pro | Supabase |
| Drafting, the gate, the interview, triage, learning | ~$24/mo **if Anthropic is keyed** | Anthropic |
| The same work today, with no Anthropic key | $0 | Groq, Hugging Face free tiers |
| Transcription | ~$2/mo | Deepgram |
| Dedup embeddings | $0 | Hugging Face free tier |
| The desk | $0 | Vercel Hobby |
| Telegram, LinkedIn, GitHub | $0 | — |

**Budget $53/month. Today it is closer to $25**, because the model work is on free tiers — which is
also why no draft has yet cleared all eight gate checks. See "What is actually being spent today" in
the cost model.

### Where the money went this month

```sql
-- by purpose
select purpose, sum(cost_usd) as usd, count(*) as calls
  from llm_calls where created_at > now() - interval '30 days'
 group by 1 order by 2 desc;

-- by service, which is the question a bill actually asks (15.9)
select provider, sum(cost_usd) as usd, count(*) as calls
  from llm_calls where created_at > now() - interval '30 days'
 group by 1 order by 2 desc;

-- what the system is calling at all, and whether Josh has been told (15.1, 15.3)
select provider, purposes, first_seen_at, announced_at from providers_seen order by provider;
```

### The three things that move it

1. **Volume.** The budget assumes ~30 moments drafted a month. Double the capture, roughly double the
   model cost.
2. **Gate rejection rate.** A moment that fails twice costs three drafts and three full gate passes.
   Highest in the first weeks, falling as the library is tuned.
3. **A provider change.** The daily message names any service in use that is not on the tool list,
   the first time it is used (15.3). You should never learn about one from a statement.

Storage only goes up — 6.3 forbids deleting anything, and the audio is kept as well as the transcript
(4.1.2). About 2 GB a year, against 100 GB on Pro.

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

## 6b. Where the build stands against clause 17

```bash
node eval/acceptance.mjs        # all twelve component tests, plus 17a
node eval/gate-acceptance.mjs   # component test 8, on its own (slow)
```

Both read `eval/.env` — copy `eval/.env.example` and fill in the service role key. It bypasses RLS,
so it lives in a gitignored file rather than a shell export where it would sit in history.

`acceptance.mjs` reports three verdicts, and the difference matters:

| | Meaning | Who acts |
|---|---|---|
| `PASS` | Measured against the criterion in the spec | Nobody |
| `FAIL` | Enough data to judge, and it does not meet the bar | Us |
| `----` | Cannot be judged yet — the line says what on | Depends: Josh, elapsed time, or a model |

One voice note out of twenty is not a failing capture test; nobody has sent twenty. **17a with no
measurements reports as unmeasurable, never as zero** — reporting 0 of 6 would say six drafts were
rewritten when none has been approved at all.

The same scoring runs inside `worker-ops` monthly, from the same module, so the scoreboard Josh
receives and the one you run cannot disagree.

## 6c. Handing it over

`docs/04-handover.md` is the sequence for moving everything into Josh's accounts (14.1, 14.3),
written from a rehearsal rather than from these setup steps. `docs/05-walkthrough.md` is the
running order for the recorded session 14.5 requires, and `OWNERSHIP.md` states what transfers.

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
