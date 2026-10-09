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
| LinkedIn | Developer app | Posting is self-serve; analytics needs Community Management review, so start it early |
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
supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... \
  HUGGINGFACE_API_KEY=... TRANSCRIPT_WEBHOOK_SECRET=... \
  LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... \
  MCP_READ_TOKEN=... MCP_WRITE_TOKEN=...

supabase functions deploy mcp cc-submit transcript-webhook worker-dispatch worker-select \
  worker-triage worker-publish worker-metrics worker-learn worker-ops linkedin-oauth
```

Three functions are reachable without a Supabase JWT, and each authenticates itself:
`transcript-webhook` and the MCP connector check their own credential, and `linkedin-oauth` validates
the signed state it issued. All three are declared in `supabase/config.toml` rather than passed as a
flag on the command line — the flag is sticky per function, so one bulk deploy without it closes a
door silently and the only symptom is a 401 nobody can explain.

### 4. The data

Export from the old project **while signed in**, then import. This is the step with no rehearsal
behind it, so do it first and check the counts rather than assuming:

```
In Claude Code:  "export the idea bank"     → idea-bank-<date>.json
```

That is the `export_bank` tool, built on 9 October. The web app had an `/export` page which was
deleted some months before the rest of it, and nothing replaced it until now — so for a while this
document described a guarantee the system could not honour.

It uses a deny list rather than an allow list: every table in `public` is exported unless it is
deliberately named as excluded, with the reason. That direction matters, because the failure mode of
the other one is a table quietly missing from his copy of his own data.

`linkedin_auth` is excluded by design — the tokens are re-issued against the new app, not moved.
After importing, compare row counts table by table before pointing anything at the new project.

### Where it runs today

Recorded because it is not obvious from the code, and because two of these are due to change.

| | |
|---|---|
| Supabase | `uzqvebxcxgmseqjhfpku`, `ap-southeast-2`, Thought Pilot organisation |
| Function region | `syd1`, chosen to sit beside the Supabase project rather than an ocean away |
| The connector | `https://<ref>.supabase.co/functions/v1/mcp`, carrying its own bearer token |
| Access | Claude only. No sign-in, no allowlist, no hosted page |

**There is no web deployment any more.** The Next.js app and the Telegram bot were removed on
9 October 2026, which also removed four accounts from this list: Vercel, a Telegram bot, a Deepgram
key and a Slack token.

One lesson from the app worth keeping, because it generalises: it was renamed once after its URL had
been handed out, and the old URL kept resolving — frozen on the deploy from before the rename. That
is worse than a dead link, because it serves something stale rather than an error. If you ever hand
out a URL for anything here, do not rename the thing behind it.

### 5. Point things at it

Nothing to register with a third party — which is the main thing that got simpler.

```bash
# Mint the connector's tokens on the new project and set them on it:
node mcp-server/mint-http-tokens.mjs --set

# Mint the scoped database key, so the connector is not running as the service role:
SUPABASE_ACCESS_TOKEN=sbp_... node mcp-server/mint-key.mjs --write
```

Then point Claude at it: `SUPABASE_URL` and `CONTENT_MCP_KEY` in `mcp-server/.env` for a local
server, or the connector URL and an MCP token for the hosted one. `README.md` has both, written for
someone who is not an engineer.

The call-transcript webhook is the one external thing left to re-point, if that integration is in
use: it takes `TRANSCRIPT_WEBHOOK_SECRET` and the new function URL.

### 6. Strip the two Thought Pilot references

- `supabase/config.toml` — `project_id`
- `cc-agent/install.mjs` — the scheduler entry is named `com.thoughtpilot.cc-agent`. Cosmetic, but
  not a string that belongs on Josh's machine afterwards.

### 7. Rotate, before any real material goes in

Every key used during the build is Thought Pilot's and has been handled on a development machine:
Groq, Hugging Face, the MCP connector tokens, the Supabase service role and a Supabase personal access
token. None of them is Josh's and none of them has ever touched real client material — every moment
in the development project is synthetic — so 15.5's duty to disclose is not triggered.

That stops being true the moment real material arrives. Rotate first.

### 8. Check it

```bash
bash supabase/tests/run-migrations.sh    # the schema applies from nothing
npx deno test --allow-all supabase/functions/_shared/
```

Then, in the new project, from a Claude session: capture a thought and confirm it comes back named
with a question; ask "is it working?" and read the answer; and the next morning confirm the
daily 08:00 message arrives the next morning. If a service is in use that is not on the tool list,
the system will say so itself (15.3).

## What is deliberately not moved

- **`linkedin_auth`** — re-authorise against Josh's app.
- **The MCP connection** in `docs/03-runbook.md` — personal to whoever is working on it, and per 15.6
  Thought Pilot's access ends when maintenance does.
- **Killed verification fixtures.** Nine moments in the development project are test material, kept
  and labelled rather than deleted (6.3). They are excluded from everything that learns, but there is
  no reason to carry them across.
