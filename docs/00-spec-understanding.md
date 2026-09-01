# Understanding the build spec — "A content system that writes from lived experience"

Source: Build specification v2.0, 20 August 2026, prepared by Josh Fryszer (Slingshot GTM) for Thought Pilot.
Supersedes the 7 August flow diagram and spec v1.0. Intended to attach to the services agreement.

This document is my read of the spec before any building starts. It restates every requirement in build
terms, names what the spec forces us to do, names what it deliberately leaves to us, and flags the places
where the spec is silent, ambiguous, or in tension with itself.

Nothing here changes the spec. Where I disagree or see a risk, I say so and mark it clearly.

**Provenance.** Checked against the full source at
`C:\Users\saip0\OneDrive\Documents\Content System Build Spec.html` (the body lives in
`Content System Build Spec_files\saved_resource.html`). The prose is identical to what was supplied, and
the clause 2 flow diagram — which renders as an inline SVG and is invisible to a plain text extraction —
was pulled out separately and matches the screenshots verbatim. **116 numbered requirements** across
clauses 4–15, plus 12 component tests and one overall acceptance test. Nothing in the source is missing
from this read.

---

## 0. The parties and the commercial frame

| | |
|---|---|
| **Client** | Josh Fryszer, Slingshot GTM. Sole user of the system. Sole judge of acceptance. |
| **Builder** | Thought Pilot (us). |
| **Deliverable** | A running system, plus code, prompts, config, docs, runbook, recorded walkthrough. |
| **IP** | All of it becomes Josh's on payment. No ongoing licence from us. (14.2) |
| **Infrastructure** | Every account, subscription and key in Josh's name, paid by Josh. We work inside them. (14.1) |
| **Continuity test** | The system keeps running unchanged if we stop work tomorrow. Nothing may depend on a Thought Pilot account, server, licence or subscription. (14.3) |
| **Running cost** | Must be confirmed in writing **before the build starts**. Josh's working assumption is ~$50/month. (15.7) |
| **Acceptance** | 5 of the last 6 drafts need only light editing. Tuning free until then. (17a) |

Two commercial facts that shape architecture more than anything technical:

1. **14.1 + 14.3 together forbid a Thought Pilot-hosted service.** Whatever we build has to sit entirely
   in accounts Josh owns and can keep paying for. That rules out "we host the orchestrator" and pushes
   toward either Josh's own cloud account or Josh's own machine. This is the single biggest architectural
   constraint in the document and it is commercial, not technical.
2. **15.7 puts a number on it before we design.** We owe a cost model, not a guess, and we owe it early.
   See §11 — the $50 figure is achievable but only with deliberate cost engineering, and I would not sign
   it without modelling first.

**Wording convention (from clause 3), which I am holding to throughout:**
- **Must** = requirement, forms part of acceptance.
- **Should** = strong preference, tradeable only with Josh's written agreement.
- **Builder's call** = genuinely open, subject to clause 16.

---

## 1. The job, stated the way Josh states it

The bottleneck is **not** ideas and **not** writing ability. It is that the moments worth writing about
happen during the working day and are gone by the time there is an hour to write.

So the system:
- captures those moments **when they happen**,
- **interviews** Josh about them until there is real material,
- turns that material into drafts **that sound like him**,
- and hands him **one calendar pass a week**.

### The test everything is measured against

> **Could anyone else have written this?**
> If yes, it fails. If no — because only Josh was in that room and had that conversation — it passes.

Every requirement in the document exists to protect that test. When I hit a design fork later, this is the
tiebreaker.

### The target and the rule above it

- **4–5 posts a week.** That is what the system is designed to sustain.
- **Quality wins over quantity, every time.** If the material is not there in a given week, fewer posts is
  the *correct outcome*, not a shortfall to be made up with something thin.
- A system that hits five posts a week by lowering the bar **has failed at the only thing it was built to do.**

This is repeated three times in the document (clause 1, clause 7.7, the callout under 9b). It is not a
throwaway line. It means: **no filler generation, no "the queue is empty so write something", no padding a
thin moment into a post.** The gate parking a moment is a pass, not a bug.

### What success looks like (clause 1)

1. 4–5 posts a week, sustained, without Josh setting aside writing time.
2. Every post traces back to a specific moment that actually happened.
3. Josh's weekly involvement = one calendar pass + whatever ad hoc talking he chooses.
4. Drafts need light editing, not rewriting.
5. Posts sound like **Josh talking**, not Josh writing for LinkedIn.

### What this is explicitly NOT

- Not a content mill. Volume without a real moment behind it is a failure.
- Not a repurposing tool. It does not spin one post into five formats.
- Not a system that invents opinions, examples, numbers or quotes. **If Josh did not say it, it does not go in.**
- Not autonomous. **Nothing publishes without Josh.**

---

## 2. The three rules that are never negotiable

Pulled out because they override everything else, including the learning loop and including the weekly target.

| # | Rule | Where |
|---|---|---|
| **R1** | **The lived-experience test.** Could anyone else have written this? If yes it does not ship. | Clause 1, 9.6, "the one thing that is never tunable" |
| **R2** | **No fabrication.** Every factual claim, quote, number and name traces to something in the idea bank entry. Nothing else may appear. Missing detail stays missing and the draft works without it. | 5.4, 9.4, 17b (zero tolerance) |
| **R3** | **The system never publishes.** Ever. Under any circumstance. Publishing follows only from Josh marking a post ready. | 11.2, step 8, 17b (zero exceptions) |

R1 and R2 are explicitly **exempt from the learning loop** — clause 12's callout: *"A system optimising
freely against LinkedIn engagement finds its way to engagement bait, because that is what the metric
rewards. Everything else can move."* So the learning loop must be architecturally unable to propose
changes to those two rules. That is a build requirement, not a policy note.

A fourth rule sits just below these three, and it is the one the spec repeats most:

| **R4** | **Candidates only from automatic inputs.** The system must not draft a post from a transcript, a session log, or a Slack thread alone, under any circumstance. | 4.3.3, 4.4.4, 4.5.4 |

Josh states the reasoning himself, and it is the sharpest paragraph in the document:

> A transcript, a session log or a Slack thread captures **what was said and done**. None of them capture
> **what Josh thought or felt about it**, and that is the entire raw material of a post worth reading. A
> system that drafts off these sources will produce fluent, confident, generic posts. **That is the single
> most likely way this build fails.**

He has told us the failure mode. The automatic inputs feed the *interview*, never the *drafter*.

---

## 3. The nine steps

The flow diagram numbers the pipeline 1–9 and the whole document references those numbers. Restating it
as I read the three diagram images:

```
FIVE WAYS IN
  ME   Dump a thought        (voice or typed, from anywhere, any time)
  ME   Ask me questions      (Josh requests a session, system runs prompts)
  AUTO Call transcripts      (every call lands on its own, gets read)
  AUTO Claude Code           (what he built, what broke, what he worked out — high bar)
  AUTO·OPT Slack             (conversations he can see, if and when he turns it on)
        │
        ▼
  01  Follow-up questions ── however it came in, it digs: what happened before, who was
                              there, their words, how he felt, what changed
        │ saved
        ▼
  02  Idea bank ─────────── one entry per moment
        │
        ▼
  03  Choose what gets written next ── strength, pillar balance, time-sensitive,
                                        already posted. Keeps two weeks queued.
        │
        ▼
  04  Write the first draft ◄──── reads ──── Reference library
        │                                     (pillars, frameworks, hook rules,
        │                                      voice, audience)
        ▼
  05  Self-check before I see it ◄──► ME  Push back (only when in session)
        │  fails → rewrite, back to 04
        │  passes
        ▼
  06  Into the calendar as a draft ◄──── ME  Send an image
        │                                     (asks what he's taking, rebuilds it)
        ▼
  ME·07 Weekly calendar review ── tweak, mark ready to schedule
        │ scheduled
        ▼
  08  Published to LinkedIn ── on the date he set. System never publishes on its own.
        │
        ▼
  09  What comes back ── numbers, edits he made, whether it started a conversation
        │
        ├──► lands on the moment that produced it ──► back to 02 (idea bank)
        └──► proposed changes, he approves ─────────► back to the Reference library
```

**Josh touches the system in exactly four places** (stated under the diagram):
1. Putting material in (inputs 1 and 2, plus images).
2. Sending an image to be rebuilt.
3. Pushing back on a draft — **only when he happens to be in the session**.
4. The weekly calendar pass.

Everything else runs without him. That is the design brief for every interface decision: if a feature
needs Josh's attention at a fifth place, it is wrong.

**Reading the diagram legend:** solid arrows = the main path; dashed = what comes back; green outline =
where Josh is involved. Two dashed return paths leave step 09: one on the left, *"lands on the moment
that produced it"*, back to the idea bank (02); one on the right, *"proposed changes, I approve"*, back
to the reference library. The library is drawn as a side panel with a **`reads`** arrow into step 04
only — but **clause 8.7 additionally requires it to be read at gating**. The written clause governs; the
diagram is the simplified view. Worth noting because it is exactly the kind of gap that produces a gate
with its rules hard-coded, which 8.7 explicitly forbids.

---

## 4. Step 1 — the five ways in

All five feed **the same follow-up interview** and **the same idea bank**. They differ only in what
starts them. That is a strong architectural statement: one interview engine, one store, five adapters.

### 4.1 Dump a raw thought (Josh starts it)

*Between meetings, in the car, walking. Thought out of his head immediately.*

| # | Requirement | What it forces |
|---|---|---|
| 4.1.1 | Must accept **voice note or typed text from a phone**. A purpose-built app is fine; so is an app Josh does not keep open. What matters is capture takes **seconds**. | A channel that is already on his phone and always reachable, or a PWA/native app. "An app he does not keep open" is a hint toward a messaging channel or share-sheet target. Decision under clause 16. |
| 4.1.2 | Must **transcribe** voice input and store **both the audio and the transcript**. | STT service + blob storage. Audio is retained, not discarded. |
| 4.1.3 | Must let him talk for two minutes and be done, with **follow-up happening later** if he is busy. | The interview is asynchronous and detachable from capture. Capture never blocks on questions. |
| 4.1.4 | Must **acknowledge receipt** so Josh knows it landed. | Immediate ack on the channel, before processing completes. |
| 4.1.5 | Must reach the idea bank **as soon as the system reasonably can**. Nothing sits in a queue waiting for a nightly run. | Event-driven ingestion, not cron, for this input. (Contrast 4.4.1, which *is* scheduled.) |

### 4.2 Get asked questions (Josh starts it)

*The input that fills the well when nothing obvious has happened.*

| # | Requirement | What it forces |
|---|---|---|
| 4.2.1 | Starts **on Josh's request**, in the **same place as 4.1**, no scheduling. | Same channel. One entry point, two modes. No separate app for sessions. |
| 4.2.2 | Asks from a **prompt set in the reference library that Josh can edit himself**. | Questions live in config Josh owns, not in code. (Reinforced by 8.5, 8.8, and clause 16's "if changing a question needs a developer, the prompt set never gets changed and the system decays".) |
| 4.2.3 | **One question at a time and wait.** Not a list in one message. | Conversational state machine, not a form. |
| 4.2.4 | Must accept **spoken answers** and **keep the thread going in voice**. | STT on every turn. ⚠️ Ambiguous — see §13.1: does the *system* speak back (TTS), or does it just accept voice and reply in text? |
| 4.2.5 | Josh can **stop at any point** and keep what has been captured. | Partial sessions persist. No all-or-nothing. |
| 4.2.6 | Where a question keeps producing nothing, the system must **try asking it a different way rather than dropping it**. A question that lands stays as it is. A question that does not gets **rephrased, not retired**. | Per-question yield tracking across sessions, and a rephrasing mechanism. This is a small learning loop on the prompt set, separate from clause 12. Easy to miss. |

### 4.3 Call transcripts (runs on its own — **in scope, not optional**)

| # | Requirement | What it forces |
|---|---|---|
| 4.3.1 | Ingest new transcripts **automatically**, no action from Josh. | Integration with whatever records his calls. ⚠️ The spec never names the tool — see §13.4. |
| 4.3.2 | Surface candidate moments into the idea bank, stored as **half-mined**, never as finished material. | A distinct status. `half-mined` is in the status list at clause 6. |
| 4.3.3 | **Must not draft a post from a transcript alone, under any circumstance.** | Hard gate between candidate status and the drafter. |
| 4.3.4 | When Josh next opens a session, the system **raises waiting candidates** and runs the follow-up interview on them. | The session surface is also the candidate inbox. Ties into 7.5 (ranked, only strongest few raised). |
| 4.3.5 | Every candidate records **which call it came from** and **any names that appeared in it**. | `source_ref` + `names`. Feeds clause 9c. |

### 4.4 Claude Code sessions (runs on its own — high bar)

*Josh runs most of his working day inside Claude Code. Things get built, things break, decisions get
made, and occasionally something clicks. **Almost none of it is worth a post, and that is the point.***

| # | Requirement | What it forces |
|---|---|---|
| 4.4.1 | Read session logs **on a schedule**, no action from Josh. | Scheduled job. Unlike 4.1.5, batch is fine here. |
| 4.4.2 | **High bar.** Only genuinely unusual sessions surface: something broke and got fixed in an odd way; something got built that had not been built before; an assumption turned out to be wrong; a decision changed. **Routine work produces nothing and the system stays silent about it.** | Four named signal types. These are effectively the classifier's classes. Everything else → silence. |
| 4.4.3 | **Volume is the risk here, not coverage.** ~1,400 sessions across two months as of Aug 2026. A version that surfaces **ten candidates a day is worse than no version at all**, because Josh will stop reading them. | ~23 sessions/day. A hard cap on candidates surfaced, and a cheap pre-filter before any expensive judgment. Precision over recall, explicitly. |
| 4.4.4 | Same rule as 4.3.3. Candidates only. **A session log records what happened, never what Josh thought about it.** | — |

This is the input with the worst signal-to-noise ratio and the one most likely to produce cost blowout
(1,400 sessions is a lot of tokens). It needs a tiered filter: cheap deterministic/heuristic pass →
cheap model triage → expensive judgment on survivors only. See §11.

### 4.5 Slack (optional, off by default)

| # | Requirement | What it forces |
|---|---|---|
| 4.5.1 | Where enabled, read conversations Josh has access to; surface candidates: a question someone asked, an argument worth having, something Josh explained well. | Three named signal types, distinct from 4.4.2's four. |
| 4.5.2 | **Switchable off entirely, and off by default** until Josh says otherwise. | A flag Josh controls himself, not a redeploy. |
| 4.5.3 | Slack contains **other people's words in places they did not expect to be quoted.** The naming rule (9c) applies with particular force. | Names extraction is mandatory here, and the default posture is anonymise. |
| 4.5.4 | Candidates only. | — |

**Build-order implication:** Slack is the only input that can be deferred without failing acceptance. It
is not in the 17b component test list. It should be built last, or built behind a flag and left off.

---

## 5. Step 1 continued — the interview

> *This is the part that makes the whole thing work. A moment arrives as a sentence or two. The interview
> turns it into something only Josh could have written.*

### The three depths

Worked **in order**, stopping **as soon as one produces material**:

| Depth | What it is after | How it asks |
|---|---|---|
| **1. A specific scene** | A real moment. A time, a place, a person, a detail. | *"Was there a specific moment where this happened? Who was there?"* |
| **2. Time-anchored** | A memory located in a period rather than a scene. | Walks back through last week, last month, six months, when he started. |
| **3. Earned perspective** | A view built from years of the work, with the track record behind it. | *"How many times have you seen this, and across how long?"* |
| **None of the above** | Nothing worth writing. | **Parks the moment and moves on. It does not manufacture a story.** |

This is a ladder with an explicit exit at the bottom. The exit is a feature.

### Requirements

| # | Requirement | Notes |
|---|---|---|
| 5.1 | One question at a time, **short and conversational**, and wait. | Same as 4.2.3 — applies to all five inputs, not just prompted sessions. |
| 5.2 | Mine a found moment for: **what happened just before, who was there, their actual words, how Josh felt, what changed for him, what a reader should take from it.** | Six named slots. This is the extraction schema. |
| 5.3 | **Push back once** on a vague answer before moving on. **Twice is nagging.** | Hard limit of one re-ask per question. |
| 5.4 | **Never invent** a detail, quote, number or name. Missing detail stays missing and the draft works without it. | R2. |
| 5.5 | **Never write draft sentences during the interview.** Its job here is to ask. | Separation of interviewer and drafter — different prompts, arguably different models. |
| 5.6 | Establish **who the post is for** and record it. Where not obvious, it asks. | → `audience` field. Feeds 9.2 and the gate (9.6 "aimed at someone in particular"). |
| 5.7 | Ask about **any names it would need to use**, and record whether Josh has **cleared** them. | → `names` field with a per-name cleared flag. |
| 5.8 | **Know when to stop.** Josh is busy; a session that runs to fifteen questions gets abandoned. Takes what it has and moves on. | Implies a question budget. Fifteen is named as too many. |
| 5.9 | Finish by writing structured material back to the idea bank: **the moment, the detail, the realisation, the lesson.** | → `material` field, four slots. Note this is a *different* four-part shape from 5.2's six-part mining list. 5.2 is what it asks about; 5.9 is what it stores. |
| 5.10 | **Tag the moment to a pillar and say which**, so Josh can correct it. | Visible, correctable classification. |
| 5.11 | A session must be **resumable**. Josh gets interrupted constantly. | Durable session state, resumable across days. |
| 5.12 | *Should* tell Josh when he has given it something strong, **so he learns what good material feels like.** | The only `should` in this clause. It is training the human, deliberately. Worth keeping — it compounds. |

**Re-audited 2026-08-26**, after the seeding, re-open and pacing work changed this file substantially.

Most of clause 5 held. The ladder is worked in order and stops at the first depth that produces
material; 5.5 is structural rather than requested, because `NextQuestionSchema` has no field a draft
sentence could live in; 5.3 and 5.8 are hard limits in code that a rewritten prompt cannot talk its
way past. 5.2 is working in practice — M-000003 carries eight of the ten material fields, including
`who_was_there`, `their_actual_words`, `how_he_felt` and `what_changed`.

**But one `return` was quietly costing two requirements.** `handleInterviewExtract` asked the name
question and returned, skipping everything below it:

- **5.10 never fired on a moment with a person in it.** "Tag the moment to a pillar and say which, so
  Josh can correct it" — he was never told what was decided and never offered the buttons, on exactly
  the material most likely to need correcting. M-000003 has four uncleared names and has never once
  received its pillar confirmation.
- **A seeding sitting stopped dead at the first moment involving a person.** `advanceSeeding` was
  skipped, and `awaiting: "name_clearance"` overwrote `seeding`, so the cold start ended without a
  word — and most good moments have someone in them.
- **The answer had nowhere unambiguous to go.** `sent_messages` recorded the question as
  `kind: "names"` and `route()` only routed replies for `draft` and `question`. Written, never read.

Now one message carries both: what it was filed under, who it mentions, a tap per name (9.10 is per
name, per post) and the pillar buttons. The sitting keeps going, because the reply route and the
button each carry their own context and need no conversation state. Silence still leaves names
uncleared, which 9.12 already calls the safe default — and an uncleared name still fails the gate.

**The interview is the highest-value component in the build.** Everything downstream is a function of the
material quality it produces. If I get one thing disproportionately right, it is this.

---

## 6. Step 2 — the idea bank

> *The idea bank is the asset. Tools get swapped over the years. This is the thing that has to survive
> all of them, so it is specified in full and Josh owns it outright.*

The only component Josh specifies field-by-field. That tells me he cares about it more than the tooling.

### Schema (verbatim from clause 6)

| Field | Holds | Build note |
|---|---|---|
| `id` | Stable identifier. Referenced by drafts, calendar entries and everything that comes back. | Must survive tool migration. Not an auto-increment tied to one vendor. |
| `source` | Raw capture / prompted session / call transcript / Claude Code session / Slack. | Enum of exactly 5. |
| `source_ref` | Which call, session or thread. **Empty for raw capture.** | |
| `captured_at` | When the moment came in. | |
| `pillar` | Which content pillar it belongs to. | From the reference library (8). Set by 5.10, correctable. |
| `audience` | Who this post is for, **or a note that it is deliberately not aimed at the buyer**. | The "deliberately not the buyer" case is explicit — not every post is bottom-funnel. |
| `raw_input` | The original audio where there is one, **plus** the transcript or text. | Both. 4.1.2. |
| `interview` | The **full** follow-up conversation, questions and answers. | Full transcript, not a summary. |
| `material` | Structured output of 5.9: the moment, the detail, the realisation, the lesson. | |
| `names` | Any person or company named in the source, **and whether Josh has cleared each one**. | Per-name clearance, not a single flag. |
| `time_sensitive` | Whether the moment decays, and roughly **when it stops being worth posting**. | Feeds selection (7.1). |
| `status` | captured / half-mined / mined / queued / drafted / gated / scheduled / published / **parked**. | Nine states. See below. |
| `drafts` | **Every version, in order**, with the framework used, the gate result, **and which version of the reference library wrote it**. | A collection, not a text field. Library version per draft is what makes tuning measurable (8.4). |
| `visual` | The source image Josh supplied and the rebuilt version, where there is one. | |
| `calendar_ref` | The calendar entry, once pushed. | |
| `outcome` | What came back: numbers, the edits Josh made, whether it started a conversation. (Clause 12.) | |
| `notes` | Free text. Josh's own, and anything the system wants to leave for next time. | Two-way scratchpad. |

### The status machine as I read it

```
                       ┌──────────────────────────────────────────────┐
                       │                                              │
  raw capture ──► captured ──► [interview] ──► mined ──► queued ──► drafted ──► gated
  prompted    ──►                  ▲                                    │         │
                                   │                          fails ────┘         │ passes
  transcript  ──┐                  │                          (rewrite, max 3)    │
  Claude Code ──┼──► half-mined ───┘                                              ▼
  Slack       ──┘        │                                                    scheduled
                         │ ages out (7.6)                                         │
                         ▼                                                        ▼
                      parked ◄──── 3 gate strikes (9.8)                       published
                         │         no depth reached (clause 5)                    │
                         │                                                        ▼
                         └──── Josh adds to it (6.4) ──► back to queued        outcome
                                                                            written back
```

Observations worth carrying into the build:

- `parked` is a **destination, not a failure bin.** 6.3: *"Parked moments stay, because something that was
  not ready in August is often the right post in November."*
- `gated` as a status implies the gate result is durable, not transient.
- **6.4 makes the graph cyclic**: Josh adds to an old entry → it goes back into the queue. So drafts
  accumulate across re-openings and `drafts` is genuinely append-only across a moment's whole life.

### The four operating rules

| # | Requirement | What it forces |
|---|---|---|
| 6.1 | Readable and editable **by Josh directly**, without a developer and **without going through the chat interface**. | A table/database UI he can open. Not a CLI, not JSON files, not "ask the bot". |
| 6.2 | **Exports in full** to a plain, portable format on demand. No format only one vendor can read. | One-click full export. Blobs (audio, images) included or referenced portably. |
| 6.3 | **Nothing may be deleted by the system.** | Append-only / soft-delete. No cleanup jobs, no TTLs. |
| 6.4 | A moment must be **re-openable**. | Status can move backwards. |

**Re-audited 2026-08-26**, after three new tables and the selection rework.

All seventeen fields still exist and carry what the clause says. **6.3 was re-checked across every
table in the schema** — twenty-seven of them — and only the table owner holds DELETE anywhere: not
`anon`, not `authenticated`, not `service_role`, including the three tables added since.

**But 6.2 had drifted, and could not help drifting.** `/export` walked a hard-coded list of nineteen
tables, and three added later were silently absent — among them `library_recordings`, the recorded
voice interview that 8.1 calls the source of truth for the voice guide and the one artefact here that
cannot be regenerated from anything else. A missing table in a JSON file looks exactly like a table
with no rows.

The list is inverted now: `exportable_tables()` returns every table in `public` with a reason where
one is deliberately withheld, so a table added by a future migration is exported *because it exists*.
Twenty-two export; five are named as excluded with why — credentials, queue plumbing, model-call
accounting. The bundle states its own boundaries rather than leaving a reader to wonder whether a gap
is a decision or a bug.

**And a moment could be parked on a guess Josh never saw.** `time_sensitive` and `decays_at` are set
by the extraction model on every moment, and `expireDecayedMoments` parks any mined moment once that
date passes — with a reason that was flatly untrue if the guess was wrong. The fields appeared
nowhere and were editable nowhere, so 6.1's "editable by Josh directly" was never true of the one
field that could remove his material without him lifting a finger.

Both are now shown on the bank page and editable together (clearing the date clears the flag, so they
cannot disagree). The daily message names anything decaying within three days **before** it parks,
and the parked reason names the date and admits whose guess it was. Verified live: M-000009 parked
with its date quoted, M-000003 was warned about and then queued by selection — the urgency term in
7.1 moving it up, which is the mechanism working as intended.

**As built.** 6.1 is the bank page: pillar, audience, notes and the whole `material` block are
editable there, because `material` is the only thing the drafter ever reads — an extraction error
left uncorrectable would be inherited by every future draft of that moment. 6.2 is `GET /export`,
one JSON file plus signed URLs for stored audio and images; credentials and queue plumbing are
excluded. 6.3 is enforced rather than intended: no DELETE policy on any table, DELETE revoked from
every role, every foreign key `ON DELETE RESTRICT`.

6.4 needed the most work, because the system was already promising it. Two park messages told Josh
to send more and the moment would reopen; nothing reopened anything, and there was no linkage
either, so more material opened a new moment while the old one stayed parked — which 6.3 guarantees
it would, indefinitely. Parked messages now carry an **"Add to this one"** button, the bank page
carries the same action, and both point the conversation at that moment and ask him a question, so
what he says next lands on the right row. Re-opening also resets the per-session budgets in 5.3 and
5.8 (`moments.reopened_at`): a moment parked after eight questions would otherwise come back with
nothing left to spend, go straight to extraction, and park itself again.

**Clause 4, as built and measured (2026-08-26).**

4.1 is **proven live**: a 3-second voice note transcribed by `deepgram:nova-3`, audio and transcript
both stored, receipt acknowledged, question back out. 4.2 runs from a prompt set Josh edits, one
question at a time, spoken answers transcribed inline. The candidates-only rule across 4.3/4.4/4.5 is
a CHECK constraint, not a promise — the drafter reads `material` and nothing else, so no transcript,
session log or Slack thread can reach it.

**4.2.6 was dead code.** `rephraseDeadQuestions` was imported by `worker-ops` and never called, so
a question that never landed would have been asked forever in the same words — the exact decay its
own module header warns about. Now called daily and reported. Verified: a question at five asks with
zero yield was reworded and its counter reset, a question that HAS produced material was left
untouched, and all eleven rows survive — 4.2.6 forbids retiring, only rewording.

**A rate limit on that optional reword returned 500 from the entire daily ops run**, silencing the
error alerts, the queue warning and the silence check — everything clause 13 exists to deliver. The
lowest-value work in the system was taking down the most important message. It now declines to start
when the provider's minute is spent, fails per-question rather than per-run, and is wrapped at the
call site as well.

**4.4.1 was not on a schedule.** `cc-agent` was built, calibrated and documented, and nothing ran
it — the runbook asked for a hand-built Task Scheduler entry, which is the class of instruction that
never happens. `cc-agent/install.mjs` registers it on Windows, macOS or Linux in one command and
proves the wiring with a dry run. Measured against a real 41-session corpus: 1 session clears the bar
(2.4%), about 3.9 a week, inside 4.4.3's band and bounded further by the daily cap of three.

**The queue could not survive real use.** The first time the system was used properly — a voice note,
an image and a prompted session arriving together — every job behind them stalled on Groq's
8,000-tokens-per-minute ceiling, burning retries on a problem retrying cannot solve. The dispatcher
raced the provider because nothing knew a budget existed. It reads the last minute's spend from
`llm_calls` before claiming work now, and releases what it cannot finish rather than failing it.
Verified: `claimed: 2, deferred: 1`. On a provider without a ceiling the check is a no-op.

**Clause 10 cannot run on an OpenAI-compatible provider at all** — image blocks are dropped on that
path, so the rebuild was being asked to redraw a picture it had never seen, failing schema validation
five times per image. It now says so plainly and keeps the image for when a vision-capable provider
is set.

### The cold start — a required build phase

> *On day one the bank is empty. If the system waits for moments to trickle in at the rate life produces
> them, the first useful draft is weeks away and there is nothing to tune against.*

**The build must include a seeding session:** a long, deliberate interview aimed at filling the bank with
**20–30 mined moments** before anything else runs. Everything downstream gets tested against real material
instead of one thin example.

**As built.** `/seed` in Telegram. It reports where the bank stands against `settings.seed_target`
(25), and one moment rolls straight into the next rather than ending the sitting — the point is a
single long session, not twenty-five separate decisions to continue. `/stop` ends it at any point
with everything captured kept (4.2.5). Clause 1 still governs: if the moments are not there, fewer
is the right outcome, and the target is a target rather than a gate.

This is a **deliverable**, not a nice-to-have. It also has a scheduling consequence: it needs a long block
of Josh's time early, and it needs the interview engine working before anything else. That puts the
interview at the front of the build order and puts a Josh-time dependency on the critical path alongside
the voice guide (8.2).

---

## 7. Step 3 — choosing what gets written next

> *The bank will hold more moments than get written, and three of the five inputs run on their own.
> Something has to decide what becomes a post and in what order, or the queue becomes whatever surfaced
> most recently.*

| # | Requirement | What it forces |
|---|---|---|
| 7.1 | Weigh: **strength of material, pillar balance, time-sensitivity, what Josh has posted recently, who the post is for.** | Five explicit factors. A scoring function with those inputs, ideally inspectable. |
| 7.2 | Check against **what has already been published** and **not retell a story Josh has already told.** Rewriting an angle is fine. Repeating the anecdote is not. | Semantic similarity against the published archive **and** against other mined moments. Non-trivial: needs embeddings or an LLM comparison pass. |
| 7.3 | Keep a working queue ahead of the calendar, targeting **roughly two weeks of approved posts**. | At 4–5/week that is **8–10 approved posts in hand** at all times. |
| 7.4 | Josh can **override**: pin to front, kill one, or say "not this month". | Three named override verbs. Editable from the idea bank UI (6.1). |
| 7.5 | Candidates from automatic inputs must be **ranked**, with only the **strongest few** raised in any one session. The rest wait their turn. | Reinforces 4.4.3. "A few" per session, not a backlog dump. |
| 7.6 | Candidates that go unmined for an extended period **age quietly to parked** rather than accumulating in front of Josh forever. | Automatic ageing. Note "quietly" — no notification. And 6.3 still applies: parked ≠ deleted. |
| 7.7 | If the queue cannot be filled to target **without dropping the bar, it must run short and say so.** | The quantity rule again, made operational. Ties to 13.4. |

**Re-audited 2026-08-26**, against live data rather than against the code alone.

**7.2 survives the provider running out.** Hugging Face chat credits were exhausted mid-build, but
the embedding endpoint is on a separate quota and still returns vectors — so the retelling check is
fully operational, and the cache means an unchanged moment is not re-embedded every four hours.

**7.1's five factors are visible in the bank, not only in tests.** M-000003 scored 74.03 carrying its
own explanation: strong material, reached a scene, no reader recorded, time sensitive with a day
left. **7.4 outranks everything**, including the dedup block — M-000009 records "written anyway
because you pinned it" at 1049.52.

**7.5 and 7.6 had never once fired**, because only one candidate had ever existed. Both were tested
with fixtures and both work: six candidates of differing strength produced exactly the strongest
three (5, 4, 4) with the 3, 2 and 1 left for another session; a 60-day-old candidate parked quietly
with a plain reason and was not deleted.

**The fault this pass found: an abandoned interview had no ending.** M-000004 held an unanswered
question for two days with nothing that would ever resolve it — `openCandidate` moves a candidate to
`captured`, 7.6's ageing only looked at `half_mined`, selection only reads `mined`, and no job
existed. The precise thing 7.6 exists to prevent was reachable, and *opening a candidate* was the way
in.

The rule already existed and simply had no timer. 5.8 — "takes what it has and moves on" — is the
policy at fifteen questions and is now equally the policy at a fortnight of silence: extraction runs,
which mines a thin conversation honestly or parks it with a reason, and 6.4 means nothing is lost.

Two thresholds, because the two are not the same thing: a voice note Josh stopped his day to record
gets fourteen days, a candidate a model dug out of a transcript gets seven. Verified in a single run
— at nine days silent, the transcript candidate closed and his own voice note was left alone.

**And which side is waiting is the whole discriminator.** A last turn that is a QUESTION means the
system is waiting on Josh, which 4.1.3 explicitly blesses and a timer should be generous about. A
last turn that is an ANSWER means he replied and nothing came back — that is a dead job, not an
abandoned conversation, and it gets resumed rather than closed. Verified: M-000011 was resumed,
M-000004 was closed, in the same run.

**As built.** `worker-select`, on cron every four hours. Scoring is plain arithmetic in
`_shared/scoring.ts` — inspectable, free, identical every run, and unit tested, which is how the
missing fifth factor was found. Every run writes `last_score` and a list of plain-language reasons
back to the moment and a row to `selection_runs`. That is not decoration: 7.4 hands Josh three
overrides, and an override on a ranking he cannot see is a guess.

**7.1 weighed four factors, not five.** Audience never entered the score, and "what he has posted
recently" was standing in for pillar balance as well as itself. Both are now their own term. An
unknown audience scores the MIDDLE of the range rather than the bottom — 5.6 treats an admitted gap
as more honest than a guessed reader, and a bank where nothing has an audience yet must not spend
every run in a self-inflicted tie.

**7.2 was inert, and would have stayed inert even once fixed.** Two separate faults:

1. No embedding provider was configured. `embed()` threw, the caller caught it, returned "no
   match", and every candidate read as new ground. A duplicate check that fails open and says
   nothing is worse than no check, because the code, the settings and the logs all say it is running.
   It now degrades to an LLM comparison pass, and if that is unavailable too the moment **waits** and
   an error is raised.
2. Comparison was against the published archive only. Nothing is published for days after it is
   selected, so two moments telling the same story would both be queued and both drafted before
   either could warn about the other. `match_moments` closes that. Proven live: M-000009 was
   blocked at 96% against M-000008, which existed only as a draft.
3. The thresholds were inherited from a different embedding model. Measured against `BAAI/bge-m3`,
   a straight retelling scores 0.71–0.96 and two different stories on one theme top out at 0.64 —
   so the old 0.88 would have blocked nothing at all. Re-measured, and the calibration model is now
   recorded alongside the numbers so a provider swap says so instead of silently drifting.

**7.3 counted the wrong thing.** `in_hand` included unapproved drafts, so a pile Josh had not
looked at read as a full queue while the calendar was empty. Approved means `ready` or
`scheduled` — R3 is explicit that `marked_ready_at` is the only authorisation. Drafts get their
own cap (`max_unreviewed_drafts`) so they cannot become a wall either.

**7.4 now beats 7.2, not just the scoring.** A pinned moment is written even when the retelling check
blocks it, with the reason recorded and the near-miss passed to the drafter. "The system ranks, he
has final say" is the clause, and a cosine distance is not better placed than Josh to know whether
the second telling is a different post.

**7.7 said so to a log nobody read** — fourteen identical warnings, four hours apart. It now reaches
him through the daily ops message, once, in clause-1 language: a short queue with a reason is a pass,
not a shortfall.

Two bugs found by running it rather than reading it:

- The draft job's dedupe key was `draft:<id>:1`, which is once per moment ever. 6.4 made the status
  graph cyclic, so the first moment to go round the loop hit a key that already existed, the enqueue
  silently did nothing, and the moment sat in `queued` forever — invisible to selection, which
  reads `mined`. Keyed per pass now, with `rescueStranded` as the backstop.
- The dedup skip wrote its reason into `moments.notes`, which 6.1 had just made Josh's to edit.

---

## 8. The reference library

> *This is deliberately under-specified. Josh has firm views on some of it and Thought Pilot will have
> views of their own, particularly on how it is structured and what a system like this actually needs to
> read. The intention is to meet in the middle rather than hand over a finished set of rules.*

### What Josh brings

| Item | His description |
|---|---|
| **Content pillars** | What he writes about, and what each pillar **actually covers for him** rather than the generic version. |
| **Body frameworks** | The post structures he wants used, and **when to reach for each**. |
| **Hook rules** | How an opening line is built. *"Some firm views here, not a complete set."* |
| **Closing lines** | How a post ends. **One ask at most**, matched to the post, **never a request for engagement.** |
| **The prompt set** | The questions the prompted session asks, and the follow-ups used to mine a moment. |
| **Who he is talking to** | His audience: who they are, what they are trying to do, what language they use, **what they are sick of hearing.** |

### What is open to our recommendation

| Item | Note |
|---|---|
| **Structure and format** | How the library is organised, split and stored so the system reads it well. **Explicitly our call.** |
| **What else it needs** | Anything we have learned a system like this needs that is not on Josh's list. |

That second one is an open invitation. Candidates I would put forward (not committing yet — this belongs
in the recommendation under clause 16): banned phrases / AI-tells list, formatting rules for LinkedIn
specifically (line breaks, length bands, no emoji rules if he has them), worked examples of good vs bad
for each framework, the structural reference posts from 8.3 as annotated examples, and the audience's
objections/language bank.

### 8a — The voice guide, and why it is NOT the archive

**This is the paragraph I need to not get wrong.**

> Josh has an archive of past LinkedIn posts. **It is not the calibration set and should not be used as
> one.** Those posts were written with heavy AI assistance, and they have **drifted from how Josh actually
> sounds**. They also do not use the storytelling structure this system is being built to produce.
> **Training the system on them would reproduce exactly the problem it exists to solve.**

| # | Requirement |
|---|---|
| 8.1 | The voice guide must be built from a **recorded interview in which Josh talks the way he talks, at length, in his own words.** That transcript is the **source of truth for voice**, not any body of written posts. |
| 8.2 | **Josh supplies the voice guide.** Timing is his call and it **sits on the critical path**, so it is worth **agreeing a date** rather than leaving it open. |
| 8.3 | Josh will supply **reference posts by other writers** whose **storytelling structure** he wants to borrow. **Structural reference only. Never a source of voice, never copied, never quoted.** |
| 8.4 | The voice guide must be **versioned**, and **every draft must record which version wrote it.** Without that, tuning is guesswork. |

**As built (clauses 8, 9a, 9b, 10, 11).**

The drafter reads exactly two things and nothing in it touches `published_archive` — 8a is
structural rather than promised. Every draft records its framework and library version. The claim
ledger verifies spans mechanically before a gate token is spent.

Two library sections were missing and are now there: `reference_posts` (8.3, drafting view only —
a gate that has read another writer's posts starts judging against their voice) and
`voice_transcript` (8.1), fed by `/voiceguide` in Telegram through the existing transcription path
and stored with its audio in `library_recordings`.

**The gate could not pass anything, and the cause was one rubric.** `aimed_at_someone` opened "you
are told who this post is for" and was handed "not recorded", because audience is Josh's input and
he has not supplied it. It failed 0-for-4 on every draft ever written, and with three strikes then
park, every moment would park. Nothing could ever reach the calendar, and it looked like a working
gate rather than a missing input. The rubric now judges the POST — whether it speaks to a particular
reader is visible in the writing — with the recorded audience as corroboration. Measured: 0 of 6
before, 3 of 5 after, on drafts with no audience recorded.

Four smaller faults, all found by running it:

- The claim ledger rejected a **verbatim** quote because the draft ended the sentence with a full
  stop the source did not have. 9.4 has zero tolerance, so the check must be exactly as strict as
  the clause and not one notch stricter. Trailing sentence punctuation is now allowed on a quote;
  interior words are not, and a paraphrase still fails.
- `banned_phrases` failed drafts by running out of output tokens mid-thought. A JSON-budget failure
  is the provider misbehaving, not a verdict, so it is marked transient and retried rather than
  burning one of the three attempts.
- **The gate now resumes rather than restarts.** Each verdict is written as it is reached and a check
  that has one is not re-run. It began as a way to survive an 8,000 token-per-minute ceiling that
  eight checks cannot fit into one invocation, but it is right for any provider: there was never a
  reason for the seventh check failing to discard the first six.
- A push-back **revision created a second calendar entry**, because every gate pass inserted a post
  and nothing constrains `posts.moment_id`. It supersedes the draft it revises now, and never
  touches an entry Josh has already approved.

**Push-back by voice was silently dropped.** `route()` passes `msg.text ?? msg.caption ?? ""`, so a
voice reply arrived as an empty string and the handler returned without a word — he would have
recorded an objection, watched it be received, and seen nothing happen. It transcribes first now,
through the same `pushBack` both paths share.

**9.5 was never decided.** Delivery is `batched` by default: a digest a short while after drafts
land, so a single draft after a session still arrives quickly and a selection run that queues ten
arrives as one message. The digest reports only what it has not reported before, so a duplicate
sends nothing.

**Clause 10 asked two of its three questions.** Which moment an image belongs to was guessed and
announced. The guess stays as the default and now carries a button to change it. And an image sent
*before* the draft never reached the calendar at all, because `visual.ts` only set `visual_id` if a
post already existed — the gate's insert picks up the latest visual now, and the calendar renders it
rather than saying "image attached".

**Acceptance test 8 has a harness**: `eval/gate-acceptance.mjs`, ten deliberately generic drafts,
two of them near-misses with specific-sounding detail on a generic spine.

**A third model provider.** `LLM_PROVIDER` now takes `huggingface` as well as `groq` and
`anthropic`, through the same OpenAI-compatible path — a URL, a key name and a model map in
`COMPAT`, because callers ask for a ROLE and never for a model. Verified running the full
eight-check gate in one pass on Qwen3-235B, with no per-minute ceiling to throttle around, which is
what the Groq free tier cannot do. It is the better of the two for judgement work and neither is the
product; Anthropic remains what the quality argument assumes.

That test also surfaced the last bug of this pass. The Hugging Face account ran out of credits
mid-gate and returned 402, and four checks recorded "could not be completed" as FAILURES — three of
which would have parked the moment under 9.8. A moment Josh spent ten minutes on must not be
destroyed because an account needs topping up, so 401, 402 and 403 now retry like a rate limit
rather than answering. The four false verdicts are marked VOIDED in `gate_runs` rather than removed,
because 6.3 applies to the system's own mistakes too.

Two things follow that are easy to get wrong:

1. **The published archive still has a job** — clause 7.2 needs it, to avoid retelling stories. So we
   ingest the archive **as a "already told" index only**, and it must be architecturally impossible for it
   to reach the drafter as style input. Two separate stores, not one corpus with a flag.
2. **8.2 says Josh supplies the voice guide** but 8.1 says it is built from a recorded interview. My read:
   Josh owns the deliverable; who conducts and processes the interview is open. Worth confirming — see
   §13.2 — because if we are running that interview it is our task and our date, and if he is, it is his.

### 8b — How the library behaves

| # | Requirement | What it forces |
|---|---|---|
| 8.5 | Every part editable by Josh with **no build or deploy step**. | Library lives in a document/DB Josh can open, not in the repo. |
| 8.6 | A change must apply to **the very next draft**. | Read at runtime, no caching that outlives a change. |
| 8.7 | The system reads the library **at drafting and at gating**. **Rules are not to be copied into code where Josh cannot see and change them.** | The gate's criteria are config, not hard-coded prompts. This is a strong constraint on how I write the gate. |
| 8.8 | Josh must be able to **add a rule in under a minute**, because that is how it will actually get maintained. | Low-ceremony format. Plain prose beats YAML here. |

**Re-audited 2026-08-26**, with fourteen sections and a real recording in the system.

**8.5 / 8.6 / 8.7 are structural.** The library is read at call time and never cached, so an edit
lands on the very next draft; drafting and gating read it through one function; every section is a
textarea with no build step. **8.4 is proven** — draft 6 carries library version 21 while the library
now stands past 30, and sections version individually with rollback. **8a is architectural**:
`published_archive` has no code path to the drafter, so training on the drifted archive is
impossible rather than discouraged.

**Three faults, all found in live data.**

**Capture mode swallowed anything typed.** While `/voiceguide` was on, every typed message was
appended verbatim — so two of Josh's questions to me were sitting in the section the drafter reads as
evidence of how he sounds. Voice still goes straight in; typed text now asks first, because 8.1 wants
a recording of him TALKING and a typed line mid-session is more often a stray thought. The two stray
lines were removed.

**Two sections were blank with no guidance at all.** `gate_rules` and `visual_brand` were zero
characters while the other twelve explained themselves. `visual_brand` matters most: clause 10 says
the rebuild follows "guidelines he supplies", the visual prompt reads that section, and nothing told
him what to supply. Both now state their own purpose — including, for `gate_rules`, that the six
checks in 9b are contractual and live in code because changing them would breach the spec, and that
this section adds to them rather than replacing them.

**The transcript arrived and nothing happened to it.** 8.1 says the guide "must be built from a
recorded interview"; the transcript landed in its own section and stopped. `worker-learn` now drafts
one from his own recorded words and raises it as an ordinary library proposal — his to approve or
reject, which respects 8.2, 12.10 and 8a at once. It proposes once, never repeats, and refuses below
400 words of real transcript. Verified: at two words it correctly proposed nothing.

**8.8 was the one I had referenced without measuring.** Adding a rule meant opening the web app,
finding one of fourteen collapsed sections, expanding it, scrolling a thousand characters of
markdown, and saving — about a minute on a laptop, and the same miserable textarea this build already
refused to use for rewriting a post. 8.8 says under a minute *"because that is how it will actually
get maintained"*, and Josh lives in Telegram, which is why the weekly pass went there under 12.7.

`/rule never use the word journey` now appends to the right section in one message. Where the words
do not make the section obvious it asks with buttons. Verified live on both paths — the obvious one
appended to `banned_phrases`, the ambiguous one asked and landed in `audience` on a tap.

---

## 9. Steps 4 and 5 — drafting and the gate

### 9a — Writing the draft

| # | Requirement | Notes |
|---|---|---|
| 9.1 | The drafter reads **only** the idea bank entry and the reference library. **It does not research or browse.** | No web tools on the drafter. Hard. |
| 9.2 | Writes for the **audience recorded against the moment**, in **language that audience uses**. | Uses `audience` + the audience section of the library. |
| 9.3 | **Chooses a framework and records which one**, so the choice can be reviewed later. | → `drafts[].framework`. Feeds 12.13 (which frameworks land). |
| 9.4 | **Every factual claim, quote, number and name must trace to something in the idea bank entry. Nothing else may appear.** | R2. Enforced again at the gate (9.6). |
| 9.5 | Runs **either immediately or later in a batch.** Josh does not want to wait after a session, but he also does not want to be pinged all day. | ⚠️ Reads as a contradiction on first pass. See §13.3 — I read it as: *may* run either way; the constraint is the notification behaviour. |

### 9b — The gate

> *The gate runs on every draft before Josh sees it. **It is a rejection mechanism, not a scoring
> exercise.***

| # | Requirement |
|---|---|
| 9.6 | Must check, **at minimum**: (a) could anyone else have written this; (b) does every claim trace to the source; (c) does the hook **open a loop rather than close one**; (d) is it **aimed at someone in particular**; (e) does it obey the voice guide; (f) does it use a name that has not been cleared. |
| 9.7 | On failure the gate **rewrites and runs again**. It **must not pass a draft with a note attached**. |
| 9.8 | After **three failed attempts** the draft **must not be sent**. The moment goes to `parked` with a **plain-language reason**, usually that there is not enough real material yet. |
| 9.9 | The gate records **what it caught and what it changed**, so the library can be tuned against real failures. |

> **Quality over quantity, in practice:** *A gate that always eventually passes something is not a gate.
> If the honest answer on a given moment is that there is no post here, the system saying so is a correct
> outcome and will be treated as one.*

Design consequences:
- The gate has **no "pass with warnings" state**. Binary. (9.7)
- Three strikes is a **hard counter per draft cycle**, and exhausting it parks the *moment*, not just the draft.
- 9.6 says "at minimum" — the six checks are a floor, and per 8.7 they must live in the library where Josh
  can add a seventh in under a minute.
- The gate needs to be **genuinely adversarial**. A model asked "does this pass?" about its own output
  says yes. The acceptance test at 17b is explicit: **10 deliberately generic drafts, at least 9 rejected.**
  That is a test I have to design *against*, and it argues for the gate being a separate call with a
  separate persona, and probably for the gate not seeing that it wrote the draft.

### 9c — Names

| # | Requirement |
|---|---|
| 9.10 | **No client name, individual or company, may appear in a post without Josh's express permission for that post.** Applies across **every** input, not only call transcripts. |
| 9.11 | Same rule for **anyone else** whose words or actions appear: colleagues, partners, people in a Slack thread, people on a call. |
| 9.12 | Where a moment does not work without naming someone, **the system must ask Josh**. If permission is not given, it **anonymises or parks**. **It does not quietly ship a version that identifies them by description.** |
| 9.13 | Where used anonymously, the draft **must not include details that identify the person or company by implication** — such as a figure, a niche, or a timeline **only they match**. |

9.13 is the hard one. "Identifiable by implication" is a judgment call, and the acceptance test checks it
directly: *"zero cases where the client is identifiable by description."* Note the permission is
**per post**, not per person (9.10) — clearing a name once does not clear it forever. The `names` field
holds clearance, but clearance has to be scoped to the use.

### 9d — Pushing back

| # | Requirement |
|---|---|
| 9.14 | When Josh **is in the session**, he can push back on a draft **in the same thread**, by voice or typed, and get a revision. |
| 9.15 | Revisions **go back through the gate** like any other draft. |
| 9.16 | Push-back is **optional. The system must not wait on Josh.** If he is not there, the draft goes to the calendar and he deals with it in the weekly pass. |

**Re-audited 2026-08-26**, point by point against live data.

**9a and 9b hold.** The drafter reads the bank entry and the library and nothing else; the framework
is recorded on every draft; the claim ledger verifies each span mechanically before a gate token is
spent, and caught a real fabrication live. 9.7 is structural — `GateVerdictSchema` has no field a
note could live in, so "passing with a note" is unrepresentable. 9.8's three strikes were verified,
and the park message now carries the button that makes 6.4 real.

**Three faults, all found in live data.**

**9.10 said "for that post" and the model stored per moment.** `moment_names.cleared` was a
permanent boolean: Dan was cleared on M-000008 and that one permission covered three posts and eight
drafts, and would have covered every future one. Because 6.4 makes moments re-openable, a name
cleared in August for a post about a good outcome would carry into a post written from the same
moment in November about a difficult one — and the bank page told him, in as many words, that
clearance was per post. The interface stated a guarantee the schema did not keep.

Clearance granted before `moments.reopened_at` now stops counting, and `_shared/names.ts` is the
single reader for the drafter, the gate and the bank page so the three cannot disagree. Verified: the
same stored flag reads as cleared before a re-open and uncleared after.

**A third of the recorded names were not names.** The extraction prompt says "record PROPER NAMES
only, not job titles"; it recorded "CFO" twice and "Josh" once, so the system was preparing to ask
Josh for permission to name Josh. The prompt's own reasoning explains why that matters — "noise is
how the clearance question stops being read" — and 9.12 depends entirely on him reading it. Filtered
in code now, with tests, because a rule the model has already ignored does not improve by being
restated. The rule errs towards KEEPING: a role kept costs one tap, a real name dropped means someone
is named without being asked.

**9.5's digest could only ever record one draft.** It marked drafts as announced by writing one
`sent_messages` row each, all carrying the digest's single `telegram_message_id` — which is that
table's PRIMARY KEY. A digest listing three drafts recorded exactly one and dropped the rest without
error, so every later run would have announced them again, every 45 minutes, forever. Announcement
lives on `posts.announced_at` now. Verified live: three drafts, one message, all three marked, and a
second run that sent nothing.

9.16 is the important one: **nothing blocks on Josh.** Combined with 9.5, this is what makes the whole
thing run without him.

---

## 10. Alongside the draft — turning a found image into Josh's

> *Josh regularly sees a diagram or an image that captures an idea well and wants his own version of it
> for a post. He can do the basics himself. What he wants is the system to take the idea and rebuild it in
> his visual brand, rather than him reaching for a design tool.*

| # | Requirement | Notes |
|---|---|---|
| 10.1 | Send an image or diagram in **the same way he sends a voice note**. | Same channel again. Third confirmation that there is one input surface. |
| 10.2 | The system **asks what he is taking from it: the idea, the structure, or just the look.** Also asks **what the post is doing** and **which moment it goes with.** | Three explicit questions. The image is bound to a moment, not free-floating. |
| 10.3 | Produce a version in **Josh's visual brand**, following **brand guidelines he supplies**. | ⚠️ Brand guidelines are a Josh deliverable but are **not listed in clause 8** among what he brings. See §12. |
| 10.4 | **Never reproduce someone else's image as it stands**, or a version close enough to be **recognisable as theirs**. Takes the idea and rebuilds it. | Acceptance: *"none recognisable as the original."* |
| 10.5 | The result **attaches to the calendar entry** with the post and **stores against the moment**. | → `visual` field + calendar attachment. |
| 10.6 | Josh can ask for **another version without starting again**. | Iteration keeps context. |
| 10.7 | **Not every post gets an image. The system must not attach one just because it can.** | Images are Josh-initiated only. Nothing in the spec has the system generating an image unprompted. |

Note what is **out of scope** (clause 3): generating original images with no reference, photography,
video, carousels. The visual capability is *rebuild-from-reference only*.

---

## 11. Steps 6–8 — the calendar and the weekly pass

| # | Requirement | Notes |
|---|---|---|
| 11.1 | Passing drafts pushed into a calendar tool **at draft status. Never scheduled, never live.** | |
| 11.2 | **The system must never publish to LinkedIn.** Publishing follows only from Josh marking a post ready. | R3. |
| 11.3 | The calendar entry carries the **idea bank id** and its **image** where there is one. | The id is the join key for step 9. |
| 11.4 | Josh can **edit the post in the calendar tool itself**, without going back into the system. | He works where he already is. |
| 11.5 | **Edits Josh makes are read back into the idea bank.** | Requires reading final content out of the calendar tool. Feeds 12.2. |
| 11.6 | The tool chosen **must allow drafts to be created programmatically and post performance to be read back. Cost is a selection criterion.** | The two hard API requirements. See §11 risk — this narrows the candidate list sharply. |

**Clauses 10 and 11, re-audited 2026-08-26.**

**Clause 11 holds in full**, and its central guarantee was re-tested adversarially after every change
made today: the database still refuses a published post with no `marked_ready_at`, a scheduled post
with no date, and a post published before it was marked ready. Exactly two code paths write
`marked_ready_at`, both Josh actions. 11.6 is argued rather than assumed in the recommendations —
posting is self-serve so the part that must work needs no third party, analytics is a week-1
lead-time item behind Community Management review, and cost is zero because the calendar is the app.

**Clause 10's intake is proven and its output is not.** An image was sent, stored under its moment,
and correctly refused: the OpenAI-compatible path drops image blocks, so on Groq or Hugging Face the
rebuild would be asked to redraw a picture it had never seen.

**But the refusal made a promise nothing kept.** Josh was told the image "will be rebuilt as soon as
that is switched over" — and the job was marked done, no state remembered the image, and switching
provider would not have produced it. The same shape as the parked-moment promise found on the first
day of this build: true about the past, false about the future.

The deferral is recorded on the moment now, and `worker-select` sweeps it the moment
`canSeeImages()` becomes true. Verified live in both directions: silent on Groq, and on switching to
Anthropic it queued the rebuild for M-000004 and said so. A guard borrowed from `rescueStranded`
stops a rebuild that cannot succeed from being re-queued every four hours forever, and the
announcement only fires when something was actually queued.

10.4 is worth stating plainly: it holds *structurally*. The rebuild emits an SVG from a description,
so producing something "close enough to be recognisable as theirs" is not prevented by instruction —
it is not reachable.

Clause 16 adds: *"The scheduler named in earlier conversations was a suggestion from Josh, not a
requirement."* — so the tool choice is genuinely ours, and **cheaper alternatives are welcome**.

---

## 12. Step 9 — what comes back, and how it gets better

> *The system is expected to improve over time, not sit still once it is handed over.*

Two layers, and the split matters: **12a must work with zero effort from Josh. 12b is best effort and
nothing may depend on it.**

### 12a — The layer that runs on its own (required)

| # | Requirement |
|---|---|
| 12.1 | **Engagement numbers pulled seven days after publishing** and written against the originating moment, **with no action from Josh.** (Impressions, comments, reactions.) |
| 12.2 | **The difference between the draft the system produced and the post Josh actually published must be captured automatically, every time.** |
| 12.3 | **These two must be enough on their own to drive the learning in 12c.** Everything below improves it and **nothing below is a dependency.** |

12.2 is the highest-value automatic signal and Josh says so: *"the difference between the two needs no
effort from Josh and is the most direct evidence available of what the system gets wrong."* It is also
technically easy — a stored diff — provided 11.5 works. It should be built early.

### 12b — The layer Josh adds where he can (best effort)

| # | Requirement |
|---|---|
| 12.4 | A **one-line verdict** on a draft in **a couple of seconds**. *"Hook was wrong." "This one nailed it."* If it takes longer he will not do it. |
| 12.5 | As part of the **weekly calendar pass**, show posts published in the last few weeks and ask **one question: did any of these lead to a conversation.** Josh answers or skips. |
| 12.6 | The answer records what happened against the post: **a comment thread worth having, a DM, a call, a client** — and optionally **who**. |
| 12.7 | **This question must sit inside the weekly pass Josh already does.** Never a separate task, a reminder, or a second place to go. **A separate habit will not survive.** |
| 12.8 | **Must not stall, nag or degrade if Josh skips it for weeks at a time.** |

> **Why 12.5 exists even though it is the awkward one:** *Engagement numbers are the easy signal and the
> weakest one. They cannot tell you whether a post sounded like Josh, and they cannot tell you whether it
> produced a conversation, because LinkedIn will never report that a DM came from a post. Attribution here
> is invisible unless a person says so out loud, which is exactly why almost nobody builds it and almost
> nobody can tell you whether their content works. **Across more than 150 posts, one client traces back to
> content**, and that is a measurement gap rather than a verdict. One question a week is what closes it.*

That paragraph tells me 12.5 is the requirement Josh cares about most in clause 12, even though it is the
one with the weakest enforcement. It also tells me his archive is 150+ posts.

### 12c — What it does with all of it

| # | Requirement |
|---|---|
| 12.9 | Propose **specific changes to the reference library, each with the evidence behind it.** Not *"posts are underperforming"* but *"the last six posts opening with a question underperformed the six that opened with a scene, here they are, propose changing the hook rule."* |
| 12.10 | **Josh approves or rejects each proposal. The system must never change the library on its own.** |
| 12.11 | Approved changes take effect **on the next draft**, **increment the library version**, and are **recorded with the date and the reason.** |
| 12.12 | A change must be **reversible**. If posts get worse after a change, Josh can see **which change** and undo it. |
| 12.13 | Learning must extend past voice: **which pillars land, which frameworks land, which hooks land, what times work, and which moments were worth writing at all.** |
| 12.14 | **Monthly**, report what is working and what is not, **with the underlying posts named rather than summarised.** |

12.11 + 12.12 + 8.4 together = the reference library needs **version control with a readable history and
a rollback**. Git is the obvious answer for us and the wrong answer for 8.5/8.8 (Josh editing in under a
minute, no deploy). Reconciling those two is a real design problem and part of the clause 16 recommendation.

### The one thing that is never tunable

> *The lived experience test in clause 1 and the no-fabrication rule in 9.4 are **not open to adjustment by
> the learning loop**, whatever the numbers say. A system optimising freely against LinkedIn engagement
> finds its way to engagement bait, because that is what the metric rewards. **Everything else can move.***

Build consequence: R1 and R2 live somewhere the proposal mechanism structurally cannot reach — a separate
immutable section of the library, or in code, with 8.7's "rules not copied into code" carved out for these
two specifically. Worth calling out explicitly to Josh rather than deciding silently.

### AUDIT — 26 August 2026

Checked against the live database rather than against the code's claims. Three faults, all of the same
shape: correct code called from a place that never runs.

**12.2 was coupled to LinkedIn, and 12.3 forbids exactly that.**
`recordOutcome` — the draft-vs-published diff — was called from one place: inside the successful LinkedIn
publish loop in `worker-publish`. LinkedIn is not connected, so it captured nothing. Live at the time of
the audit: 3 posts, 2 published, **0 rows with a draft body**, `edit_class` null everywhere. That also took
down 13.3's "how many Josh rewrote" and the whole 17a acceptance measurement.

12.3 requires the two automatic signals to be *enough on their own*. 12.1 is blocked on Community
Management review; 12.2 was blocked on the same connection. So the layer the spec says must work was
entirely dead, and the one signal that needs no network was the one being withheld.

Fixed: `_shared/outcome.ts` measures at approval, on both surfaces, and re-measures at publish only if the
body moved in between. A sweep in `worker-select` measures anything either writer misses, because an
approved post with no measurement is indistinguishable from a post that was never approved.

**12.4 had no Telegram path at all, and could not be left on a draft.**
The verdict box existed only in the web app, only under "Recently out" — posts that had already gone out.
Two failures: the clause that says *seconds or he will not do it* was built on the surface Josh has to
remember to open (live: **0 verdicts ever recorded**), and 12.4's *"a short reaction on any draft"* could
not reach a draft he rejected outright, which is the case where the system got it most wrong.

"Not this one" was one tap that reverted the post and recorded nothing.

Fixed: the question is asked on the taps he already makes — always on a rejection, once per pass on an
approval. Three guards stop the state swallowing material: voice and photos fall through, commands fall
through, and it expires in ten minutes.

**The learning loop had no memory of what Josh had decided.**
`worker-learn` sent the model posts and gate failures, never past proposals — so a rejected change could
return the following Monday with the same evidence. And `proposal_status` has always had a `'reverted'`
value that **nothing anywhere set**: a change Josh approved and then rolled back went on reading
"approved" for ever, so the loop could not learn that its own change had been tried and undone.

Also fixed alongside: `library_section_versions.reason` was never written, so the rollback list read
"v5 v4 v3" with no indication which version came from a proposal and which Josh typed himself — 12.12's
*"see **which** change"* half missing even though the undo worked. And `worker-learn` was selecting
`drafts.library_version` and discarding it.

**What holds:** 12.1's mechanism (scheduled at publish, swept daily, degrades to `metrics_error` rather
than failing), 12.5–12.8 (one shared reader/writer, capped at two asks, verified live), 12.9/12.10 (no
proposal without named posts; `core_rules` refused by trigger), 12.13's dossier.

**Still unproven:** 12.1 has never returned a number, and 12.14's monthly report has never run on real
data — the two published posts on file are verification fixtures.

---

## 13. Operations

> *The main operational risk is not that the system breaks. It is that it **breaks quietly** and Josh
> finds out three weeks later when the calendar is empty.*

| # | Requirement | Notes |
|---|---|---|
| 13.1 | If nothing captured, drafted or scheduled for **an agreed number of days**, tell Josh. **Silence is not the same as nothing happening.** | "Agreed number" — a parameter to settle with him. |
| 13.2 | **Failures surface rather than being swallowed.** If an input stops working, Josh hears about it. | No silent try/except. Per-input health. |
| 13.3 | **Monthly self-report**: moments captured by source, moments mined, drafts written, how many the gate rejected, how many Josh rewrote, posts published. | Six metrics. Needs the counters instrumented from day one. |
| 13.4 | Where the queue is running low against 7.3's target, **say so before the calendar runs dry, not after.** | Leading indicator, not lagging. |

**Steps 07–09, as built.**

**08 is the best-defended thing in the build**, and deliberately so — it is the zero-tolerance
clause. Exactly two code paths in the repo write `marked_ready_at`: his button in the app and his
tap in Telegram. Verified against the live database that it refuses, at the schema level, a published
post with no `marked_ready_at`, a scheduled post with no date, and a post published before it was
marked ready. Acceptance test 11 is defended by CHECK constraints rather than by anyone's care.

**"Skip this week" did nothing.** It wrote `conversation_asked_at` and nothing read it — both the
web pass and the Telegram pass filtered on `conversation_answered_at` alone, so a skipped post came
back on every pass for three weeks. That is 12.8's nagging, and a button that looks like it worked is
worse than no button. It counts now: two asks and the question drops away, answered or not. One ask
is early for a DM that arrives a fortnight later; three is nagging. **Verified live** — asked, asked
again, then silent on the third pass.

**The two passes disagreed with each other.** Both surfaces had their own copy of "which posts still
need asking about", so a skip in one was invisible to the other. 12.7 permits two surfaces; it does
not permit two answers. The rule now lives in `_shared/conversation.ts` and both ask it rather than
deciding it, and `recordAnswer` is the single writer.

**Nothing told Josh a proposal existed.** `worker-learn` wrote them every Monday at seven and
logged. He lives in Telegram and had no reason to open a proposals page, so the closing step of the
entire loop depended on him remembering a URL. Open proposals now head the pass he already does, on
both surfaces, evidence and buttons inline. **Verified live**: approved from a Telegram tap, the
section changed, the library went v26 → v27, `applied_library_version` and `decided_at` recorded,
history row written, and the change reverted cleanly to v28 with the history append-only.

**`decideProposal` could report success having changed nothing.** The update carried
`.eq("immutable", false)`, so a proposal against `core_rules` would match no rows and still be
recorded as approved — a lie in the audit trail about the one thing that must never move. It now
checks a row actually changed. Verified: the trigger refuses such a proposal at insert, and
`core_rules` matches zero rows for a mutable update, so the guard cannot be bypassed.

**12.13's last item had no evidence behind it.** The dossier carried pillar, framework, hook and
audience but not `strength`, `depth_reached` or `source` — so the loop could never learn "which
moments were worth writing at all", the one signal that improves the INTERVIEW rather than the
drafts. Timing was a raw timestamp; it is day-of-week and hour now.

**A missing LinkedIn connection failed the metrics job rather than degrading.** `getAuth` throws
when nothing is connected, which failed the job, retried it five times and killed it — and since the
dedupe key is one per post, that post's numbers were then lost for good. A missing connection is the
same situation as a missing scope: record why, once, and let the learning carry on (12.3). Verified
live. Publishing keeps the opposite behaviour, correctly: there a post did not go out and Josh needs
telling.

Two monthly reports are required — 12.14 (content performance) and 13.3 (system health). They can be one
document but both sets of content must be there. They also need a **delivery channel**, which the spec
never names. Presumably the same channel as everything else.

---

## 14. Ownership and handover

| # | Requirement |
|---|---|
| 14.1 | Every account, subscription and API key **in Josh's name and paid by Josh**. We work inside them. |
| 14.2 | All **code, prompts, configuration and documentation** become Josh's property **on payment**, with no ongoing licence required from us to keep running it. |
| 14.3 | **The system keeps running unchanged if we stop work tomorrow.** No component may depend on a Thought Pilot account, server, licence or subscription. |
| 14.4 | Handover includes a **written runbook**: what each part does, where it runs, what it costs, how to change it, what to check first when something breaks. |
| 14.5 | Handover includes a **recorded walkthrough** with Josh covering the runbook end to end. |

**14.3 is the architectural constraint.** It kills: our own hosting, our own orchestration SaaS seat, any
component on a plan we own, and anything requiring us to be reachable. Everything must be provisioned in
Josh's accounts from the start — retrofitting this at handover is painful and error-prone.

---

### AUDIT — 27 August 2026 (clause 14)

**14.1 and 14.3 are unmet, and were also unproven.** Everything runs in a Thought Pilot Supabase
organisation on Thought Pilot's keys, which was known. What was not known is whether the move out
would work: no migration had ever been applied to an empty database as a chain — they went on
incrementally over days, several as raw SQL — and `/export`, the only route data leaves by, has
never been run.

The chain has now been run. All 26 migrations apply cleanly from nothing and every assertion passes,
including the R3 constraints. `/export` remains unexercised and is named as such in
`docs/04-handover.md` rather than assumed.

**The rehearsal corrected one of my own findings.** The production ledger carries a
`0006b_storage_policy` entry with no matching file, which looked like a migration that existed only
in production — a rebuild would then have had no read policy on private storage buckets, and every
voice note and image would have been stored correctly and unreadable. It is not that:
`0006_security.sql:83` already creates that exact policy, and `0006b` is a duplicate application.
Recorded because the false version is the kind that gets re-raised.

It did find a real one. `run-migrations.sh` waited on `pg_isready`, which reports ready while
Postgres is still starting, so the run failed intermittently with *the database system is starting
up* — in the script whoever inherits this system runs first, where an intermittent failure reads as a
broken schema. It now waits for a query that succeeds.

**14.2 had no artifact at all** — no licence, no ownership statement. `OWNERSHIP.md` now states it,
naming the prompts and the seeded library explicitly, since those are what a vendor would otherwise
treat as method rather than deliverable, and listing every dependency licence so "no ongoing licence
required" is checkable rather than asserted.

**14.4 claimed a section it did not have.** The runbook opened by claiming to satisfy 14.4 —
including *"what it costs"* — and had no cost section. Added as §4b.

**14.5 is outstanding** and needs a call with Josh.

---

## 15. Practicalities

### 15a — Which tools
- **15.1** We tell Josh which tools and services the system uses and what each does, **before they go in**. A plain list is fine.
- **15.2** Everything runs on Josh's accounts and keys, so the terms that apply are ones he has signed up to himself.
- **15.3** New tools added later: tell him **at the time**, not on a statement.

### 15b — Confidentiality
- **15.4** Treat transcripts, session logs, Slack content, idea bank contents and drafts as **confidential, including material belonging to Josh's clients.**
- **15.5** Tell Josh **promptly** if anything is accessed or exposed that should not have been.
- **15.6** Scoped access continues **for as long as we are maintaining the system**.

### 15c — Running cost
- **15.7** Expected monthly running cost **confirmed in writing before the build starts.** Josh's current understanding is **~$50/month**, which he says is fine, and **it needs confirming rather than assuming.**
- **15.8** What ongoing maintenance covers, and what it costs, set out alongside it.
- **15.9** If running cost moves materially, **we raise it** rather than letting it show up on a bill.

---

## 16. What is left to us

> *Tooling, architecture and build order are Thought Pilot's decisions.*

### The constraints those decisions must clear

| Constraint | Josh's reasoning |
|---|---|
| Josh must be able to run it without us present | *He is buying a system, not a dependency.* |
| Nothing Josh cannot maintain at a basic level | *If changing a question needs a developer, the prompt set never gets changed and the system decays.* |
| Every store must export in full | *The idea bank outlives the tools around it.* |
| Capture must work from a phone in seconds | *Every input is captured between other things. Friction here means no input, which means no system.* |
| Running cost agreed up front | *Recurring cost is what quietly kills systems like this.* |
| Cheaper alternatives are welcome | *The scheduler named in earlier conversations was a suggestion from Josh, not a requirement.* |

### The seven open decisions — each needs a recommendation with reasoning **before the relevant work starts**

1. Where the **voice notes and images** go.
2. Where the **idea bank** lives.
3. The **orchestration layer**.
4. **Which models** get used.
5. The **calendar tool**.
6. How the **reference library is structured**.
7. **The order the build runs in.**

Each of these is a written recommendation we owe him, gated before the corresponding work. That is a
process obligation, not just a technical one — I should treat each as a small deliverable with reasoning
attached, not a decision made silently in a commit.

---

### AUDIT — 27 August 2026 (clauses 16 and 17)

**Clause 16 holds.** All seven decisions are recommended with reasoning, including the build order.
Its models table had drifted — it still named OpenAI for embeddings after the tool list was corrected
— and now says what is recommended alongside a note that the recommendation is not what is running.

**Clause 17: zero of twelve component tests pass, and none had ever been checked.** Not failed —
never run. The line the engagement is judged by was answerable only by querying the database by hand.
`eval/acceptance.mjs` answers it now, and `worker-ops` folds the same summary into the monthly
message, because 17a names Josh as the judge and he should not have to ask.

All twelve are **blocked** rather than failing: five need weeks of running, four need Josh, and the
rest need a model that can clear the gate.

Test 5 was briefly scored as failing — "the interview reached depth on 1 of 7" — and that was wrong.
Five of those seven moments were asked one question and never answered. An unanswered question is
the interview waiting, not the interview failing, and the original reading would have sent someone
tuning a prompt set that is not broken. It is judged on answered moments only now, and pinned by a
test.

**17a is unmeasurable, not zero.** No draft has been approved by Josh, so there is nothing to score.
Reporting 0 of 6 would assert that six drafts were rewritten. Pinned by a test.

**The gate is not broken; the drafter is.** `claims_trace` accounts for 12 of the gate's 16
draft-level failures, and three of the four sampled are genuine fabrication correctly caught — *"still
haunts me"*, *"grinding on a client project"*, *"because it took me most of that week to stop arguing
with it"*, none of it in the source. So R2 works and the drafter, on a free-tier model, invents
things. Two different failures with two different fixes, and the second is the Anthropic key.

**One gate check cannot currently fail.** `voice_guide` has passed 13 times and failed none, because
the section it reads is empty. A check that cannot fail is not a check. It becomes real when 8.2 is
supplied; until then the scoreboard says so rather than letting it inflate the gate's apparent health.

**Two things found by running what had never been run.** `eval/gate-acceptance.mjs` — the harness for
acceptance test 8, the most testable clause in the contract — did not work: it inserted drafts without
`library_version`, which 8.4 makes NOT NULL. And 13.3's monthly counts did not exclude fixtures: the
report said 18 drafts and 2 published where the real figures are 8 and 0.

---

## 17. Acceptance

### 17a — The overall test

> **The build is finished when five of the last six drafts need only light editing from Josh, rather than
> a rewrite. Josh is the judge. Until that point, tuning of the reference library and the gate continues
> at no additional cost.**

| Passes — **light editing** | Fails — **a rewrite** |
|---|---|
| Changes at the **word and line level**. Cutting a sentence, swapping a phrase, tightening the close, fixing a detail. **The story, the angle, the hook and the structure survive.** | Changing **which moment** the post is about, changing **the angle**, replacing **the hook**, or **restructuring the body**. **If Josh opens a blank document, it was a rewrite.** |

**Tuning** = changes to the reference library, the prompt set, the gate rules, and the drafting
instructions. **It does not mean new inputs, new outputs or new features.** That boundary is our
protection against unbounded free work, and it is worth holding to precisely.

Note the interaction with 12.2: the draft-vs-published diff **is** the acceptance measurement, captured
automatically. Build 12.2 early and acceptance measures itself.

### 17b — Component tests

Each checked **once, on a working system, before tuning begins.**

| # | Component | Test | Passes at |
|---|---|---|---|
| 1 | Raw capture | 20 voice notes from his phone across a week | All 20 in the idea bank, transcribed, **promptly enough that Josh never wonders whether one was lost** |
| 2 | Prompted session | 5 sessions | Each produces **≥3 mined moments** with a scene, a detail and a realisation |
| 3 | Call transcripts | Two weeks of calls | Every call read, candidates surfaced, **none drafted** before Josh has been interviewed on it |
| 4 | Claude Code | Two weeks of normal working | Candidates surfaced are ones Josh **agrees are interesting**. **A week that produces nothing is a pass, not a failure.** |
| 5 | Interview | 10 deliberately **thin one-line inputs** | **≥8 reach depth 1 or 2.** Any that reach none are **parked, not padded** |
| 6 | Fabrication | Josh audits 10 drafts line by line against source entries | **Zero** invented quotes, numbers, names or events. **Pass or fail, no tolerance** |
| 7 | Names | Josh audits 10 drafts built on moments containing client names | **Zero** uncleared names, **zero** cases identifiable by description |
| 8 | The gate | Josh seeds 10 deliberately generic drafts | **≥9 rejected** |
| 9 | Selection | Four weeks running | No repeated stories, pillars roughly balanced, queue near target or a warning raised |
| 10 | Visuals | 5 reference images | All 5 in his visual brand, **none recognisable as the original** |
| 11 | Calendar | Four weeks running | **Nothing reaches published without Josh's action. Zero exceptions.** |
| 12 | Learning loop | One month of published posts | Numbers and draft-vs-published captured automatically **on every post**, the weekly conversation question asked **every week**, and **≥1 specific, evidenced change proposed** |

**Slack is not tested.** It is the only input absent from this list — consistent with it being optional
and off by default. Confirms it is last in build order.

**Tests 3, 4, 9, 11 and 12 each need 2–4 weeks of elapsed running time.** They cannot be compressed. That
sets a floor on the calendar between "system works" and "acceptance complete", and it means those
components must be live and instrumented well before the end. Build order has to be driven by which tests
need the longest observation window, not by which components are easiest.

---

## 18. Requirements the spec implies but never states

Things that follow necessarily from the text and that I would otherwise discover late.

| # | Implied requirement | Derived from |
|---|---|---|
| I1 | **One conversational surface** that handles: raw capture, prompted sessions, image sending, in-session push-back, and raising waiting candidates. Five distinct jobs, one place. | 4.1.1, 4.2.1, 4.3.4, 9.14, 10.1 |
| I2 | **Speech-to-text on every input turn**, not just first capture. | 4.2.4, 9.14 |
| I3 | **Durable, resumable, multi-day session state** with a thread model. | 4.1.3, 4.2.5, 5.11 |
| I4 | **Immediate acknowledgement decoupled from processing** — ack before the pipeline finishes. | 4.1.4 + 4.1.5 |
| I5 | **Per-question yield tracking** across sessions, plus a rephrasing mechanism. A second, smaller learning loop nobody would think to build. | 4.2.6 |
| I6 | **A semantic "already told" index** over the 150+ published posts, kept strictly separate from any voice input. | 7.2 + 8a |
| I7 | **A tiered filter for Claude Code** — cheap pre-filter before expensive judgment, with a hard daily candidate cap. | 4.4.3 + cost |
| I8 | **Per-name, per-post clearance state**, not a global "cleared" flag. | 9.10 ("for that post") |
| I9 | **An identifiability check** distinct from the name check — figures, niches, timelines. | 9.13 |
| I10 | **Append-only draft history** carrying framework, gate result, and library version on each version. | 6 (`drafts`), 8.4, 9.3 |
| I11 | **Library version control with human-readable history and rollback**, reconciled with sub-minute editing. | 8.4, 12.11, 12.12 vs 8.5, 8.8 |
| I12 | **A read path out of the calendar tool** for final published text, not just a write path. | 11.5, 12.2 |
| I13 | **Metrics instrumentation from day one** — the six counters in 13.3 cannot be backfilled. | 13.3 |
| I14 | **A notification channel and policy** — silence alerts, failure alerts, queue-low warnings, two monthly reports — that does not violate "don't ping me all day". | 9.5, 13.1–13.4, 12.14 |
| I15 | **A structural separation between the interviewer and the drafter** so the interviewer cannot write prose. | 5.5 |
| I16 | **An adversarial gate that does not know it wrote the draft.** | 9.7 + acceptance test 8 |
| I17 | **The learning loop must be structurally unable to touch R1 and R2.** | Clause 12 callout |
| I18 | **Blob storage for audio and images**, portable, included in the full export. | 4.1.2, 6.2, 10.5 |

---

## 19. Where this build fails — my risk read

Ordered by how likely they are to actually bite.

**1. Generic drafts. (The one Josh names himself.)**
The failure mode is fluent, confident, forgettable posts. Mitigations are all already in the spec —
candidates-only (R4), the interview depth ladder, the gate, the voice guide from speech not writing. The
build risk is treating any of those as optional under time pressure. They are the product.

**2. Claude Code noise, and its cost.**
~23 sessions a day. 4.4.3 says ten candidates a day is *worse than nothing*. Precision must be brutally
high, and 1,400 sessions is also where a naive implementation burns the entire monthly budget in a week.
Needs a tiered filter and a hard cap. This is the input I would build with the most care and the least
ambition.

**3. The $50/month number.**
Achievable, but not by accident. Transcription, ~700 session screenings a month, drafting, up to 3 gate
rewrites per draft, image generation, embeddings for dedup. The honest answer is a cost model with
per-component estimates before we commit in writing (15.7). If it does not fit, the fix is model tiering
and filter design, not silently exceeding it (15.9). **This must be settled before the build starts —
it is a stated precondition, not a milestone.**

**4. LinkedIn performance data (11.6, 12.1).**
"Draft creation programmatically + performance read back" is a genuinely narrow requirement. Personal-
profile analytics via API are restricted, and third-party scheduler APIs vary widely in what they expose.
**This is the requirement most likely to constrain the whole tool choice**, and it needs verifying against
real APIs before recommending a calendar tool, not after. Cost is also a stated criterion here.

**5. 14.3 discovered late.**
If anything is provisioned on our accounts during the build, handover becomes a migration. Provision
everything in Josh's accounts from day one.

**6. Josh's dependencies slipping.**
The voice guide (8.2, explicitly on the critical path), the seeding session (20–30 moments, needs a long
block of his time), the brand guidelines (10.3), and the six library components (clause 8). Nothing
downstream is testable without them. Dates, not intentions.

**7. Elapsed-time acceptance tests.**
Five of the twelve need 2–4 weeks of real running. That is a scheduling constraint on the whole
engagement and it is invisible unless planned for up front.

**8. The gate being too soft.**
An LLM grading its own output passes almost everything. Test 8 (≥9 of 10 generic drafts rejected) is
designed to catch exactly that, and it is the test I would build toward first.

---

## 20. What Josh owes us, and when

| Item | Clause | On the critical path? |
|---|---|---|
| Content pillars | 8 | Yes — needed for 5.10 and selection |
| Body frameworks | 8 | Yes — needed for drafting |
| Hook rules | 8 | Yes — needed for drafting and the gate |
| Closing lines | 8 | Yes |
| The prompt set (session questions + mining follow-ups) | 8, 4.2.2 | Yes — needed before the seeding session |
| Who he is talking to (audience) | 8 | Yes — 9.2 and the gate depend on it |
| **The voice guide** (from a recorded interview, not the archive) | 8.1, 8.2 | **Yes — he names it as on the critical path. Agree a date.** |
| Structural reference posts by other writers | 8.3 | Yes for drafting quality |
| Brand guidelines for visuals | 10.3 | Only for the visuals component |
| His time for the seeding session (20–30 moments) | Clause 6 | Yes — everything downstream tunes against it |
| Accounts, subscriptions, API keys in his name | 14.1 | Yes — from day one |
| Access: call recorder, Claude Code logs, LinkedIn, (Slack if enabled) | 4.3–4.5 | Yes per input |
| Confirmation of the "agreed number of days" for the silence alert | 13.1 | Minor |
| The published archive (for dedup only, **never for voice**) | 7.2, 8a | Yes for selection |

## What we owe Josh before the build starts

| Item | Clause |
|---|---|
| Written running-cost estimate, with maintenance scope and cost alongside | 15.7, 15.8 |
| A plain list of tools and services and what each does | 15.1 |
| A recommendation with reasoning for each of the seven open decisions, before the relevant work | 16 |
| A recommendation on reference library structure and what else it needs | 8 |
| An agreed date for the voice guide | 8.2 |

---

## 21. Ambiguities and tensions to settle with Josh

Flagged as questions, not blockers. Most have an obvious sensible default I would proceed on.

**§13.1 — 4.2.4, "keep the thread going in voice."**
Does the system **speak back** (TTS, a genuine voice conversation), or does it accept spoken answers and
reply in text? These are very different builds and different costs. *My default if unanswered:* accept
voice in, reply in text, since 4.2.3's one-question-at-a-time reads naturally as messages. Worth asking —
a spoken interview would feel materially different and may be what he pictures.

**§13.2 — 8.1 vs 8.2, who runs the voice-guide interview.**
8.1 says the guide is built from a recorded interview of Josh talking. 8.2 says "Josh supplies the voice
guide." If he means he supplies the *recording* and we build the guide, that is our task and our date. If
he means he supplies the finished guide, it is his. Materially different critical paths.

**§13.3 — 9.5, immediate vs batch drafting.**
*"Must run either immediately or later in a batch. Josh does not want to wait after a session, but he
also does not want to be pinged all day."* Read literally these pull opposite ways, and 9.14's in-session
push-back only works if a draft exists while he is still there. *My reading:* the constraint is on
**notifications**, not on when drafting runs. Draft immediately when a session ends and he is present
(enabling push-back); otherwise draft in batches and surface everything at the weekly pass. Worth
confirming, because it decides whether push-back is a common path or a rare one.

**§13.4 — 4.3.1, which call recorder.**
Never named. Affects transcript format, API, and whether ingestion is push or poll. Also 4.3.5 (names)
depends on whether the recorder gives us speaker labels.

**§13.5 — Where the Claude Code logs live.**
If they are on Josh's laptop, automatic scheduled ingestion (4.4.1) has to run there or the logs have to
sync somewhere. This interacts directly with 14.3 and with decision 3 (orchestration layer). One of the
first things to establish.

**§13.6 — 10.3 brand guidelines are not in the clause 8 list.**
Clause 8 enumerates what Josh brings and brand guidelines are not on it, but 10.3 requires them. Add to
his list, or scope visuals to start after they arrive.

**§13.7 — 13.1's "agreed number of days".**
A parameter left open by design. Needs a number.

**§13.8 — R1/R2 vs 8.7.**
8.7 says rules must not be copied into code where Josh cannot see and change them. The clause 12 callout
says the lived-experience test and the no-fabrication rule are never tunable. Those two need a home that
is visible to Josh but out of reach of the learning loop. I would propose an explicitly immutable section
of the library and confirm rather than decide silently.

**§13.9 — 12.1 metrics availability.**
Impressions, comments, reactions at 7 days, automatically. Needs verifying against the actual API of
whichever tool wins decision 5 before that decision is made. If impressions specifically are not
retrievable, Josh needs to know before the tool is chosen, not after.

---

## 22. What I take from this as the shape of the build

Not a design — a design comes next, with the clause 16 recommendations. But the spec constrains the shape
more than it first appears:

- **One conversational surface** doing five jobs (I1). Everything Josh touches except the weekly pass
  happens there.
- **Five thin adapters** feeding **one interview engine** feeding **one idea bank**.
- **A hard wall** between automatic inputs and the drafter (R4). Candidates go to the interview, never
  past it.
- **Three separate model roles** with different jobs and different prompts: the **interviewer** (asks,
  never writes — 5.5), the **drafter** (reads only the entry and the library, never browses — 9.1), the
  **gate** (rejects, adversarial, never scores — 9.7). Plus cheap triage models on the automatic inputs.
- **Two stores Josh owns and can open**: the idea bank (a table) and the reference library (documents).
  Both exportable, both editable without us.
- **Nothing blocks on Josh** except publishing, which only he does.
- **Everything instrumented from day one**, because 13.3's counters and 12.2's diffs cannot be backfilled
  and 17a's acceptance measures itself off them.
- **Everything provisioned in Josh's accounts from day one**, because 14.3 makes retrofitting painful.

The build order will be driven by two things the spec makes unavoidable: the components whose acceptance
tests need weeks of elapsed observation must go live early, and the interview must come first because the
seeding session depends on it and everything downstream tunes against what the seeding session produces.

---

## Task 2.7 — the fifth control that looked like it worked and did nothing

Reading the gate's own rejections, with fixtures separated from real drafts, produced one number
that did not fit:

| Check | Fixtures rejected | Real drafts rejected |
|---|---|---|
| `anyone_else` | **6 of 6** | 2 of 13 |
| `claims_trace` | 5 of 5 | 12 of 16 |
| `aimed_at_someone` | 3 of 5 | 8 of 13 |
| `voice_guide` | **0 of 5** | **0 of 13** |

The fixtures are written to be deliberately generic — acceptance test 8 requires at least nine of
ten to be rejected. `anyone_else` caught every one. `voice_guide` passed every one, and has never
failed anything in eighteen runs.

**It was not being lenient. It had nothing to judge against.**

### Two different answers to "is this section filled in?"

Seven of the fourteen library sections are not blank. They contain prose explaining what Josh should
put there and why we did not guess it for him — *"FOR JOSH. Not drafted, because guessing at what
you write about would put words in your mouth."* is 462 characters.

`loadLibrary` decided a section was supplied by testing `body.length > 0`. So all seven counted as
supplied, and **the drafter and the gate were handed six sections of instructions addressed to
somebody else and told they were the standard.** The acceptance harness already knew better — it
strips `DELIBERATELY EMPTY` before deciding whether the voice guide exists — so the system held two
answers to the same question and they disagreed. Nothing compared them.

`isSupplied()` in `views.ts` is now the single answer. `STARTER` sections stay supplied: Thought
Pilot wrote them to be used, and a draft written against them is written against something real.

### What changed, and what deliberately did not

A check whose section is empty is now recorded as **NOT JUDGED**, with `model = 'none'` and a reason
that says so, before any model is called. It still passes — blocking a draft over a section Josh was
never required to supply first would punish him for a gap he has already been told about.

What changed is that the pass is no longer indistinguishable from an earned one. A green verdict
with no reason reads identically everywhere `gate_runs` is shown: the draft record, the desk,
`list_drafts`. The scorecard has warned about this since clause 17 was built, but that warning lived
in a report nobody reads per draft.

`aimed_at_someone` was deliberately **not** listed as section-dependent, though it reads the audience
section. It also reads the audience recorded against the moment, and `GATE_USER` already handles a
missing one on purpose — so it can still judge a post on its own terms. The tempting rule ("it reads
a section, so list it") would have switched off a check that works.

### The one this does not fix

`voice_guide` becomes a real check the moment Josh records ~400 words of himself talking. Until
then it is an honest gap rather than a silent pass — which is an improvement, not a substitute.
