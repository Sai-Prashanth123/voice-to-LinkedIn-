---
name: josh-voice
description: Use when writing, editing or judging anything in Josh Fryszer's voice — a LinkedIn post, a rewrite after a gate rejection, a hook that needs sharpening, or a check on whether a draft still sounds like him. Fetches the live voice guide and reference library from the system rather than writing from general instincts about "professional LinkedIn tone", and rather than from the files on disk, which can be older than the library without saying so.
---

# Writing as Josh

There are **two** sources of standard here and they are deliberately not the same file. Read this
section before either.

| Source | Where | What it is |
|---|---|---|
| **The library** | The system, via `get_voice_brief` and `get_drafting_brief` | What the drafter and the gate actually judge against. Fifteen sections in Postgres. **Write from this.** |
| **The law set** | `data/josh/law/*.md` | Background for a person reading about how Josh writes. Not an input to a draft. |

**They are allowed to disagree, and that is why only one of them is an input.** The split was a
deliberate choice. What was not deliberate was a drafter reading the files: on 14 October Josh
watched a session take its frameworks and its voice guide off the disk while the library held newer
versions of both, and the only thing that had told it to was step 1 of this skill.

So the law set is for reading about him, not for writing as him. If you notice the two contradicting
each other on something that matters, **say so rather than picking one** — that divergence is worth
reporting, and the e2e harness reports it too without failing on it.

**For anything the gate will judge, the library wins.** It is the contractual source (clause 8) and
it is what `get_gate_brief` returns.

**One exception to "allowed to disagree", added 14 October 2026: `receipts.md`.** Since a claim may
now cite `receipts` as a source, that text is quoted word for word by the claim check, and two copies
of it would mean a post could assert something the library does not hold. The file is where it is
EDITED; the `receipts` library section is what a claim CITES, and `scripts/load-receipts.mjs` is the
one-way trip between them. If they differ, the file has not been loaded — do not resolve it by
hand, and do not quote the file in a draft.

## The one rule above all others

> Could anyone else have written this? If yes, it fails.

Run it on the hook and on the central claim. Everything below is downstream of it.

## Before writing

1. **Get his voice from the system, not from the disk.** `get_voice_brief`. It assembles the voice
   guide, the measured voiceprint and the banned list as they stand right now.

   **Do not read `data/josh/law/` to write from.** This step used to say "read the law set, all five
   files are short", and on 14 October Josh watched a session do exactly that and report back: *"I
   didn't call the voice brief, I read through the voice files from this instead"*, *"the voice guide
   arrived on the voice files on disk"*, and *"the frameworks I used the three structures from the
   file on disk rather than the library's own version."* He also watched it skip three of the six
   files it had just been told to read.

   Both failures came from the same instruction. Six files is six chances to skip one, and a file on
   disk is a file that can be older than the library without saying so — which is why the precedence
   note above exists, and why an instruction that sends you to the disk first makes that note
   unenforceable.

   **Two things, and only two, are not in the library yet.** Audited file by file on 14 October:
   everything else the old step fetched is a thinner or older copy of something the briefs already
   hand over. These are the exceptions.

   - **His biography and his vantage** — Slingshot GTM, the years consulting, what he does not do.
     No library section holds it. Read `law://identity` when a post needs to be grounded in his
     career, and only then.
   - **His receipts** — the seventeen facts with the call dates they came from. The `receipts`
     library section exists and is still the placeholder, so until
     `scripts/load-receipts.mjs --apply` has been run, `law://receipts` is the only copy. After it
     has been run, the section is the copy a claim can actually cite and the file is not.

2. **Get the real brief.** `get_drafting_brief` with the moment id. It assembles the live library
   for the drafting view. **The drafting standard is not in this file** — it is there, and it
   changes without any deploy when Josh edits a section.
3. **Never invent.** Every claim traces to the idea bank entry. Missing detail stays missing and
   the draft works without it.

## The five things most likely to go wrong

Ordered by how often they actually happen, not by severity.

**1. Reproducing spoken filler as authenticity.** The transcripts are full of "kind of like", "you
know", "yeah yeah yeah". These score highest of all on the contrast against the reference writers
and **none of them belongs in a post**. If you have read the transcripts, this is the trap.

**2. Sounding like Matt Barker.** He is not a peer reference — he is where Josh's rules came from.
His 3 September post states the lived-experience test and "lessons not advice" in almost the words
Josh sent us. A draft agreeing with him is not evidence of Josh's voice.

**3. Tidying away the hedge.** Josh hedges hardest immediately before his most useful sentence.
Compress it to one clause; do not delete it. It is the voice.

**4. Addressing the reader constantly.** "Your" is the word the reference accounts use most and
Josh uses least. Their posts are aimed at you; his talk is about a situation.

**5. Padding to a length.** The reference writers' median post lengths span an eightfold range and
all of it works, so no target length goes near a draft. Do not take the numbers from this file —
`get_sentinels` derives them from the current measurements, and the figures once written here were
wrong within a month of being typed (seven writers, not eight; 422 words at the top, not 408).

## Structure

Three, and nothing else — `content-plan.md` Part A. Name which one you used; `create_draft` records
it (9.3).

## Opening and closing

Never open with a question. A question may *close* a hook.

Close with a genuine question, a soft close with no ask, or one direct ask — never two, never a
request for likes or reposts. The direct ask is rationed to roughly one post in five.

## Names

No client is ever named. Removing the name is not anonymising: a figure plus a niche plus a date
identifies a company to anyone in that market, and Josh's readers are in that market. Use the shape
instead. Where a moment cannot survive without identifying someone, **park it** — that is a correct
outcome, not a failure.

## After writing

Run the `gate-check` skill. Eight checks, any one failing fails the draft. Do not run the gate in
the same session that wrote the draft.

## Keeping the law set current

- `node scripts/build-voiceprint.mjs --sentinels <posts.json> --apply` — recompute the fingerprint.
- `node scripts/sentinel-refresh.mjs --apply` — refresh the reference-writer measurements and
  propose a library change.
- `node scripts/build-law.mjs --apply` — rebuild all five files. **Overwrites hand edits.** Read
  the diff first.

Nothing here writes to the library. Automated changes go to `library_proposals` and wait for Josh
(clause 12.10). If you want a library section changed, use `propose_library_change` and say so.
