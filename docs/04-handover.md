# Handover

Moving this system into Josh's accounts, for clauses 14.1 and 14.3.

> **14.1** — *Every account, subscription and API key must be in Josh's name and paid by Josh.*
> **14.3** — *The system must keep running unchanged if Thought Pilot stops work tomorrow.*

## Where things stand, plainly

**Neither clause is met today.** Everything runs in a Supabase organisation belonging to Thought
Pilot, on Thought Pilot's keys. If we stopped this afternoon the system would stop with us — not
because the design depends on us, but because the accounts do.

Nothing here is a surprise; it is the ordinary state of a build before handover. It is written down
because the earlier version of the recommendations said *"nothing here has a Thought Pilot account
attached to it"*, which was the intention rather than the fact.

## What has been proven, and what has not

The steps below are not a plan written from the setup instructions. The migration chain was run.

| Step | Status |
|---|---|
| All migrations apply to an empty database, in order | **Proven.** `bash supabase/tests/run-migrations.sh` — every migration applies and every assertion passes, including the R3 constraints |
| Edge functions deploy from this repo | **Proven.** All ten deployed on 27 August |
| Vault secrets, cron schedules, storage buckets | Applied by migration; exercised in production daily |
| `GET /export` authenticated | **Not proven.** Never once run. It is the only route data leaves by |
| Import into a fresh project | **Not proven.** No round trip has been done |

The two unproven rows are the data half, and they are the half that matters most on the day.

### What the rehearsal actually found

The chain applies. Every migration, from nothing, in order, with all assertions passing — including
the R3 constraints that make an unauthorised published post impossible to store.

Two smaller things surfaced, and one of them was a false alarm worth recording so nobody re-raises
it:

**The production ledger has a `0006b_storage_policy` entry with no matching file.** It looked at
first like a migration that existed in production and nowhere else — which would have meant a rebuild
producing a system where every voice note and image was stored correctly and unreadable, silently,
because storing works and only reading fails.

It is not that. `0006_security.sql:83` already creates that exact policy. The `0006b` entry is a
duplicate, applied separately on 23 August. Harmless, and a rebuild has always had the policy. Trying
to "restore" it broke the chain immediately with *policy already exists*, which is how it was caught.

**The test harness had a readiness race.** `run-migrations.sh` waited on `pg_isready`, which answers
"ready" while Postgres is still starting, so the shim could land on a database that then refused it:
*FATAL: the database system is starting up*. Seen for real, twice. It now waits for a query that
actually succeeds. This matters because that script is the check whoever inherits this system runs
first, and an intermittent failure in it reads as a broken schema.

## The sequence

### 1. Accounts, in Josh's name (14.1)

| Service | What to create | Notes |
|---|---|---|
| Supabase | Organisation and project, **Pro** | Pro is for backups and storage — see the cost model |
| Anthropic | API key | The one thing that has never been configured. No draft has yet cleared the gate without it |
| Deepgram | API key | Transcription |
| Telegram | A bot via `@BotFather` | New token; the chat id is Josh's own |
| LinkedIn | Developer app | Posting is self-serve; analytics needs Community Management review, so start it early |
| Vercel | Hobby account | For The desk |
| GitHub | Repository | This repo, pushed |

Groq and Hugging Face are optional after that — they exist because the Anthropic key never arrived.

### 2. Database

```bash
supabase link --project-ref <josh-project-ref>
supabase db push                       # every migration, in order
```

Then the two Vault secrets the scheduler reads:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
select vault.create_secret('<service_role_key>', 'service_role_key');
```

### 3. Secrets and functions

```bash
supabase secrets set ANTHROPIC_API_KEY=... DEEPGRAM_API_KEY=... TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... TELEGRAM_WEBHOOK_SECRET=... TRANSCRIPT_WEBHOOK_SECRET=... \
  LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... APP_URL=https://<the-desk>

supabase functions deploy telegram-webhook transcript-webhook worker-dispatch worker-select \
  worker-triage worker-slack worker-publish worker-metrics worker-learn worker-ops
```

`telegram-webhook` and `transcript-webhook` deploy with `--no-verify-jwt`; both check their own
shared secret instead.

### 4. The data

Export from the old project **while signed in**, then import. This is the step with no rehearsal
behind it, so do it first and check the counts rather than assuming:

```
The desk → /export     → idea-bank-<date>.json
```

`linkedin_auth` is excluded by design — the tokens are re-issued against the new app, not moved.
After importing, compare row counts table by table before pointing anything at the new project.

### Where it runs today

Recorded because it is not obvious from the code, and because two of these are due to change.

| | |
|---|---|
| The desk | `https://the-desk-saip00519-gmailcoms-projects.vercel.app` |
| Vercel project | `the-desk`, on a personal Vercel account |
| Function region | `syd1`, chosen to sit beside the Supabase project rather than an ocean away |
| Supabase | `uzqvebxcxgmseqjhfpku`, `ap-southeast-2`, Thought Pilot organisation |
| Sign-in | one address only, and it fails closed if that setting is missing |

**The project was renamed to `the-desk`, and the alias followed on the next deploy.** The old
`app-` URL still resolves but is frozen on whatever was deployed before the rename, which is worse
than a dead link: it serves a stale app rather than an error. Do not rename a project after handing
out its URL — or if you do, re-point NEXT_PUBLIC_SITE_URL, the Vault APP_URL and the Supabase
redirect list, and redeploy, which is what had to happen here.

`desk.thought-pilot.com` is already added and verified on the project. It needs one CNAME record
(`desk` -> `4890da21ee6ce82f.vercel-dns-017.com.`) and then three values move with it:
`NEXT_PUBLIC_SITE_URL` on Vercel, `APP_URL` in Supabase Vault, and the redirect list in Supabase
auth. At handover that domain becomes one of Josh's, and the same three values move again.

### 5. Point things at it

```bash
curl "https://api.telegram.org/bot<NEW_TOKEN>/setWebhook" \
  -d "url=https://<new-ref>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Then Vercel: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL` and `ALLOWED_EMAIL`, and add the deployed origin to the Supabase auth redirect
allowlist.

### 6. Strip the two Thought Pilot references

- `supabase/config.toml` — `project_id`
- `cc-agent/install.mjs` — the scheduler entry is named `com.thoughtpilot.cc-agent`. Cosmetic, but
  not a string that belongs on Josh's machine afterwards.

### 7. Rotate, before any real material goes in

Every key used during the build is Thought Pilot's and has been handled on a development machine:
Deepgram, Telegram, Groq, Hugging Face, the Supabase service role and a Supabase personal access
token. None of them is Josh's and none of them has ever touched real client material — every moment
in the development project is synthetic — so 15.5's duty to disclose is not triggered.

That stops being true the moment real material arrives. Rotate first.

### 8. Check it

```bash
bash supabase/tests/run-migrations.sh    # the schema applies from nothing
npx deno test --allow-all supabase/functions/_shared/
```

Then, in the new project: send a voice note and confirm a moment appears; run `/status`; confirm the
daily 08:00 message arrives the next morning. If a service is in use that is not on the tool list,
the system will say so itself (15.3).

## What is deliberately not moved

- **`linkedin_auth`** — re-authorise against Josh's app.
- **The MCP connection** in `docs/03-runbook.md` — personal to whoever is working on it, and per 15.6
  Thought Pilot's access ends when maintenance does.
- **Killed verification fixtures.** Nine moments in the development project are test material, kept
  and labelled rather than deleted (6.3). They are excluded from everything that learns, but there is
  no reason to carry them across.
