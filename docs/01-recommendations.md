# Recommendations and tool list

For Josh Fryszer, from Thought Pilot. Satisfies clause 15.1 (tell Josh which tools and services the
system uses, before they go in) and clause 16 (a recommendation with reasoning for each open
decision, before the relevant work starts).

---

## 1. The seven decisions

### Where the voice notes and images go — **Supabase Storage**

Three private buckets: `voice-notes`, `images`, `renders`. Reached only through signed URLs.

*Why:* 4.1.2 requires keeping both the audio and the transcript, so this grows steadily — roughly
2 GB a year at 20 voice notes a week. Storage sits in the same project as the idea bank, so a full
export (6.2) is one operation rather than two systems to reconcile. It is in your account, on your
card, and nothing about it depends on us.

### Where the idea bank lives — **Supabase Postgres**

*Why:* Clause 6 is the only part of the spec written field by field, so the store had to be something
that survives the tools around it. Postgres gives you `pg_dump` and CSV export natively, which is
what 6.2 asks for: "no format that only one vendor can read." It also lets 6.3 be enforced rather
than promised — DELETE is revoked from every role the system runs as, so the system *cannot* delete a
moment, even if a future change tried to.

You can open and edit any row yourself in the Supabase table editor, which is 6.1 satisfied with no
software for us to build or you to maintain. The app adds a friendlier view on top.

### The orchestration layer — **a Postgres job queue, `pg_cron`, and Supabase Edge Functions**

*Why:* The alternative was a workflow tool (n8n, Make) or a server. Both fail clause 14.3 in
practice: a server is something you have to keep alive, and a workflow tool is a subscription plus a
place where the logic lives outside your control.

A queue in your own database has no moving parts to host. Every step is one function invocation, so
work is resumable — if a step dies halfway, the job becomes claimable again after a backoff instead
of being lost. And because the queue is a table, you can see exactly what the system is doing by
looking at it.

### Which models get used — **Claude, tiered by what the job is worth**

| Job | Model | Why |
|---|---|---|
| Writing the draft | Claude Opus 5 | This is the product. It is also only ~$3/month at your volume. |
| The gate | Claude Opus 5 | Judging whether a post could have been written by anyone else needs the better model, not the cheaper one. |
| The interview | Claude Sonnet 5 | Many short turns. Needs judgement, not maximum capability. |
| Call and Slack triage | Claude Sonnet 5 | Moderate volume, and names have to be caught reliably. |
| Claude Code triage | Claude Haiku 4.5 | ~700 sessions a month even after local filtering. Volume dominates. |
| Transcription | Deepgram (Whisper as fallback) | Cheapest per minute at this volume; Claude does not take audio. |
| Dedup embeddings | Hugging Face `bge-m3` | Free at this volume, and 1024 dimensions like the OpenAI alternative, so a swap does not write vectors the column cannot hold. Used only to check you are not retelling a story. |

**This table is the recommendation. It is not what is running.** No Anthropic key has ever been
configured, so the drafter, the gate and the interview are on Groq and Hugging Face free tiers — see
the tool list below and the cost model. The recommendation has not changed; the key has not arrived.

### The calendar tool — **built into the app, publishing through LinkedIn directly**

*Why:* This is the recommendation most worth reading, because the obvious answer is to buy a
scheduler.

LinkedIn has two relevant permissions, and they are not alike:

- **Posting** (`w_member_social`) is **self-serve**. You add the "Share on LinkedIn" product to an
  app in the LinkedIn developer portal and it works. No review, no waiting.
- **Post analytics** (`r_member_postAnalytics`, for impressions and reach on your own posts) sits
  behind Community Management API review, which needs a registered company and a Page admin to
  verify the application.

So the part that must work needs no permission at all, and there is no reason to pay a third party
for it. Building it also means the weekly pass and the "did it start a conversation" question live in
one place, which clause 12.7 requires — "never a separate task, a reminder, or a second place to go."
And your edits are read back automatically (11.5) because you are editing the idea bank directly.

**Action for you:** submit the Community Management API request under Slingshot GTM in week 1. It is
a lead-time item, not a blocker. If it is slow or declined, the learning loop still works — clause
12.3 says the two automatic signals must be enough on their own, and the stronger of the two
(draft versus published) is entirely within our control.

### How the reference library is structured — **markdown sections in the database, versioned**

Fourteen sections: core rules, pillars, frameworks, hooks, closes, audience, voice guide, prompt set,
banned phrases, formatting, gate rules, visual brand, reference posts (8.3), and the voice interview
transcript the guide is built from (8.1).

*Why:* 8.8 says you must be able to add a rule in under a minute, "because that is how it will
actually get maintained." Prose in a textarea allows that; a structured format does not. Every save
writes a new version and rolls a snapshot forward, so 8.4 (every draft records which version wrote
it), 12.11 (dated, with a reason) and 12.12 (reversible) come for free.

**Two additions to your list**, offered under clause 8's "anything Thought Pilot has learned a system
like this needs":

- **Banned phrases and AI tells.** The specific constructions that make writing read as
  machine-produced. This is what stops drafts sounding like competent LinkedIn AI rather than like
  you, and it is checked by the gate.
- **Gate rules.** 9.6 lists six checks "at minimum". Putting the list in the library rather than in
  code means you can add a seventh yourself, which is what 8.7 requires.

`core_rules` holds the lived-experience test and the no-fabrication rule. It is visible to you but
locked, and a database trigger rejects any attempt by the learning loop to propose against it. That
is clause 12's "one thing that is never tunable", enforced rather than intended.

### The order the build runs in

Driven by one fact that is easy to miss: five of the twelve component tests need **2–4 weeks of live
running** (call transcripts, Claude Code, selection, calendar, the learning loop). They set the
schedule, not build difficulty. So those go live early even in rough form, and the interview comes
first because the seeding session depends on it and everything downstream is tuned against what it
produces.

---

## 2. The full tool list (clause 15.1)

Everything below runs on **your** accounts and your keys (14.1). We work inside them.

| Service | What it does | Cost | Status |
|---|---|---|---|
| **Supabase** (Pro) | Idea bank, reference library, job queue, scheduling, file storage, sign-in | $25/mo | In use |
| **Anthropic** | The interview, the drafter, the gate, triage, the learning loop | ~$25/mo | **Declared, never keyed** |
| **Groq** | Doing Anthropic's work on a free tier while no Anthropic key exists | Free tier | **In use — added mid-build** |
| **Hugging Face** | Embeddings for the "have I told this story already" check, and a second free-tier model provider | Free tier | **In use — added mid-build** |
| **OpenAI** | Fallback for embeddings and for transcription | ~$1/mo if keyed | Not keyed, never used |
| **Deepgram** | Turning your voice notes into text | ~$2/mo | In use |
| **Telegram** | Where you send voice notes and get asked questions | Free | In use |
| **LinkedIn developer app** | Publishing, and post analytics once approved | Free | Not yet connected |
| **Vercel** (Hobby) | Hosting The desk — the calendar, the bank, the library, the weekly pass | Free | Not yet deployed |
| **GitHub** | Where the code lives, and what a rebuild is restored from | Free | Local only, no remote yet |

### What changed here, and why you are being told now (15.3)

**Groq and Hugging Face were added during the build and this list did not say so.** They have been
running the drafter, the gate, the interview and the dedup embeddings, while this table named
Anthropic and OpenAI — neither of which has ever had a key. The cost model was billing that work to
Anthropic at $25 a month.

They were added because the Anthropic key never arrived and a free tier was the only way to keep
building. That is a defensible decision and a poor one to have made silently, which is what 15.3
exists to prevent.

It cannot happen again quietly. The system now records every service it actually calls
(`providers_seen`) and tells you in the daily message about anything in use that is not on this
list, naming it, what it is doing, and when it started. A test fails the build if this table and the
list the system checks itself against ever disagree.

**The consequence worth stating plainly:** the free tiers are why no draft has yet cleared all eight
gate checks. Groq's 8,000 tokens/minute is below what a single gate run needs. The quality argument
in this document rests on Opus doing the drafting and the gating, and Opus has not been available.

### On 14.3, accurately

The earlier version of this section said *"nothing here has a Thought Pilot account attached to it"*.
That was the intention and is not yet the fact. **Every account and key above is currently Thought
Pilot's**, in a Thought Pilot Supabase organisation, because 14.1 has not happened yet. Until it
does, 14.3 is not met: if we stopped tomorrow the system would stop with us.

Nothing in the *design* depends on us — the migration path is documented in `docs/04-handover.md`
and has been rehearsed end to end — but the accounts have to move before that is more than true on
paper.

---

## 3. What we need from you

| Item | Clause | Blocks |
|---|---|---|
| **The voice guide**, from a recording of you talking at length — not your old posts | 8.1, 8.2 | Draft quality. You name it as on the critical path; it needs a date. |
| Content pillars, frameworks, hook rules, closing lines, the prompt set, audience | 8 | Drafting and the gate |
| Reference posts by other writers, for structure only | 8.3 | Draft quality |
| **Brand guidelines for visuals** — required by 10.3 but missing from clause 8's list | 10.3 | The visuals component only |
| Time for the seeding session: 20–30 mined moments | 6 | Everything downstream is tuned against it |
| Your published archive — **for dedup only, never as a voice source** | 7.2, 8a | Avoiding retold stories |
| Which call recorder you use | 4.3.1 | The transcript input |
| Accounts and API keys in your name | 14.1 | Day one |
| The number of days of silence before the system should chase you | 13.1 | Minor; currently set to 4 |

## 4. Two questions

1. **4.2.4 says the system should "keep the thread going in voice."** We have built it to accept
   spoken answers and reply in text. If you pictured it speaking back, that is a different build and
   worth saying now.
2. **8.1 and 8.2 read slightly differently on the voice guide** — 8.1 says it comes from a recorded
   interview, 8.2 says you supply it. If you mean you supply the recording and we build the guide,
   that is our task and our date. If you mean the finished guide, it is yours. Either works; they
   have different critical paths.
