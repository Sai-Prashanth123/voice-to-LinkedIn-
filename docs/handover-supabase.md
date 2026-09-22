# Supabase access and ownership

Josh asked, on 22 September 2026: *"Can you please confirm that you'll transfer the Supabase
ownership over to me? Just want to make sure because I'll be storing client data in there."*

The answer is yes. This is how, in two stages, and what is true about the data in the meantime.

## Stage 1 — today: Josh becomes an Owner of the existing project

Nothing moves. He gets full control of the project as it stands, including the ability to remove
anyone else later.

**What we do**

1. Supabase dashboard → the organisation holding the project → **Members** → **Invite member**.
2. His email, role **Owner**.
3. Tell him to accept the invitation; he lands in the same project, with the same data.

**What he can do immediately**: read and change every table, rotate every key, read the logs, export
the whole database, and remove our access. Nothing in the system needs redeploying — the keys do not
change when a member is added.

**What this does not do**: move billing, or put the project inside an organisation he owns. That is
stage 2.

## Stage 2 — when he wants it: the project moves to his organisation

1. Josh creates his own Supabase organisation (free, a minute) and adds a payment method if he wants
   a paid plan.
2. He invites us to that organisation as an Owner, temporarily, so the transfer can be initiated.
3. In the project's **Settings → General → Transfer project**, the project is moved into his
   organisation.
4. He removes our access whenever he chooses.

**What survives the move**: the project reference, the database URL, every API key, the Edge
Functions, the cron schedules and the Vault secrets. Nothing in the Telegram bot, the MCP connector
or the desk needs re-pointing.

**What changes**: billing, and who can delete the project.

## What holds the client data today

- **The database** is the only copy of the idea bank, the interview transcripts, the drafts and the
  library. Nothing is deleted by the system by design: entries are killed and labelled, never
  removed, and the DELETE grant is revoked from every role (clause 6.3).
- **Voice notes** are stored in Supabase Storage, alongside their transcripts.
- **Nothing leaves the project** except what a model call needs, and what leaves is recorded — see
  below.

## Who sees the material, and why that list can change

Model calls go to one provider at a time. If that provider is down or rate limited, the call is
retried, and then handed to another provider so the work does not stop. Every call records which
provider actually answered (`providers_seen`, `llm_calls`), so the disclosure is accurate rather
than aspirational.

Providers that can be reached this way today: **Google Gemini** (currently configured), **Groq**,
**OpenRouter** and **Hugging Face** for text, **Deepgram** for voice transcription, **Anthropic**
when a key is added. Telegram carries the conversation itself.

If Josh wants that list narrowed — for example, only providers with a data-processing agreement he
has signed — say so: it is one ordered list in `supabase/functions/_shared/llm.ts` and the keys of
anything removed can be deleted from the Vault.

## Before he stores real client material

Two things are currently true and worth him knowing:

1. **Any Telegram chat that messages the bot is admitted automatically**, by his own instruction, and
   an admitted chat can add ideas and answer questions. The chat id is the only barrier. If he wants
   an approval step back, it is one setting's worth of work.
2. **The desk (the web view) has no login.** It shows the idea bank and the drafts, read only, to
   anyone with the URL, and search engines are asked not to index it. If client material is going in,
   this is the first thing to change.
