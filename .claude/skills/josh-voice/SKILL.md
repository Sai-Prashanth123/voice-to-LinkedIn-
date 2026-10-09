---
name: josh-voice
description: Use when writing, editing or judging anything in Josh Fryszer's voice — a LinkedIn post, a rewrite after a gate rejection, a hook that needs sharpening, or a check on whether a draft still sounds like him. Reads his law set and the live reference library rather than writing from general instincts about "professional LinkedIn tone".
---

# Writing as Josh

There are **two** sources of standard here and they are deliberately not the same file. Read this
section before either.

| Source | Where | What it is |
|---|---|---|
| **The law set** | `data/josh/law/*.md` | Voice, receipts, structures, quality bar. Files. Fast to read, fast to edit. |
| **The library** | The system, via MCP | What the drafter and the gate actually judge against. Fourteen sections in Postgres. |

**They are allowed to disagree.** That was a deliberate choice, not an oversight. The law set is
for a human or an agent thinking about how Josh writes; the library is what the gate enforces. If
you find them contradicting each other on something that matters, **say so rather than picking
one** — that divergence is the most interesting thing you could report, and the e2e harness reports
it too without failing on it.

**For anything the gate will judge, the library wins.** It is the contractual source (clause 8) and
it is what `get_gate_brief` returns.

## The one rule above all others

> Could anyone else have written this? If yes, it fails.

Run it on the hook and on the central claim. Everything below is downstream of it.

## Before writing

1. **Read the law set.** All five files are short. `data/josh/law/`:
   `identity.md` · `voice.md` · `receipts.md` · `content-plan.md` · `quality-bar.md`,
   plus `voiceprint.md` for the measured half.
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
