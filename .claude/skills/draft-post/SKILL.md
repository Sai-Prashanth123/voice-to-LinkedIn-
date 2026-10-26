---
name: draft-post
description: Use when writing a LinkedIn post for Josh from a moment in the content system's idea bank — drafting, re-drafting after a gate rejection, or when asked to "draft the next one". Fetches the real drafting standard from the system rather than writing from general instincts.
---

# Draft a post

You are writing a post that only Josh could have written. **The standard is not in this file.**
It lives in the system, is the same one the system's own drafter uses, and you fetch it.

## The one thing that decides everything

> Could anyone else have written this?

If yes, it fails — however well written it is. It passes only because Josh was in that room and had
that conversation.

## Steps

1. **Pick the moment.** If you were given one — which in **one_step** mode you always are, by
   `start_post` and `write_post` — use that one and **never** go looking for another. Reaching into
   the idea bank for something to write about is the exact thing Josh asked to stop on 13 October,
   after a morning in which he answered 21 questions about a new idea and the system drafted an old
   one instead.

   In **interviewed** mode, if you were not given one, call `list_moments` with `status: "mined"`.
   Nothing mined means nothing is ready; say so rather than drafting from a half-mined moment.

2. **Call `get_drafting_brief`** with the moment id. It returns:
   - `system` — the writing standard and the reference library, assembled for drafting
   - `user` — the moment's material, the audience, the pillar, cleared and uncleared names
   - `must_not_name` — names that must not appear, in any form
   - `library_sections_awaiting_josh` — sections Josh has not filled in

   **Read both `system` and `user` in full and follow them exactly.** They are the instructions.
   Do not substitute your own sense of what a good LinkedIn post is, and do not soften anything in
   them because it seems strict.

3. **Write the post**, using only what the brief gives you. You have exactly two sources: the
   moment's material and the reference library. No research, no browsing, no general knowledge
   about Josh's industry, no borrowing from other posts.

   Missing detail stays missing. **Write around a gap; never fill one.**

4. **Build the claim ledger.** Every factual claim, quote, number and name in the post needs the
   verbatim span of the material it rests on — copied exactly, not paraphrased. The span is checked
   mechanically against the source, so a paraphrase fails even when it is accurate.

   If you cannot point at a span, do not make the claim.

5. **Call `create_draft`** with the body, the framework you used, and the ledger.

6. **Then run the gate** — use the `gate-check` skill on the draft you just created. A draft that
   has not been checked is not finished.

## What will get the draft refused before it exists

`create_draft` refuses a moment Josh has killed, a body naming someone uncleared, and the framework
name `acceptance-fixture`. These are not style notes — the call fails and nothing is stored.

The uncleared-name check is a string search, so anonymising is not enough if the name is still in
the text. Identifying someone by description is also a failure, and that one the gate catches:
not by a figure, a niche, or a timeline only they match.

## Two sections of the library have narrower uses than the rest

The brief says this too, and it is the instruction most easily lost:

- **The voice interview** is how Josh *sounds*. It is never a source of facts. A claim resting on it
  fails mechanically, because the ledger only accepts spans from the moment's material.
- **Reference posts** are **structure only** — how another writer gets in, what they hold back,
  where the turn lands. Never their words, cadence or phrasing. If a run of words from one could be
  recognised in your draft, you have used it wrongly.

## When he names one of his writers

If he says to write it like Matt Barker would — or like any of the eight — pass `writer_handle` to
`start_post` or `get_drafting_brief`, and **keep passing it**: `write_post` takes it, and so does
`get_rewrite_brief` if the draft comes back. A handle dropped between steps means the default
framework gets used anyway, which is the exact thing he wrote in about on 26 October.

The brief then carries that writer's **measured** shape — where he opens, how much sits above the
fold, how many paragraphs, how he lands — as the target for that post, with the corpus range beside
each number so none of it reads as a law. Two things to hold onto:

- **The shape outranks the frameworks section for that post, and only for structure.** You still
  pick one of Josh's three frameworks and still name it; 9.3 records it either way. The framework
  says what the body argues. The shape says how it gets in and how it lands.
- **The exclusions come with it and are not optional.** Matt Barker's turn that renames the reader's
  problem is the construction Josh's banned-phrases list forbids outright. The brief prints it in the
  same block as the targets for that reason.

His sentences are never in the brief, and that is checked rather than trusted: every seven-word run
of the draft is compared against every stored post by those eight before anything is filed, and a
borrowed run is refused rather than flagged. Take the shape; write the words yourself.

If the brief comes back saying `no_target`, that writer's stored posts are too thin to read for
shape. Say so in one line rather than guessing at a shape — and do not substitute a different writer.

## What the gate has actually been rejecting

Measured across every real draft judged so far, not guessed. In order of how often it bites:

**1. Claims that trace to nothing — 12 of 16 drafts.** By far the biggest failure, and it is rarely
a small invention. One draft turned a two-person call with a CFO into *"eight people in a room"*.
Another wrote about busyness, fear and working at 11pm when the source described a presentation.
The pattern is a model that finds the material thin and writes a better story instead.

If the material will not carry a post, **say so and stop.** A moment that cannot support a draft is
a normal outcome — clause 1 says fewer posts is the correct answer when the material is not there.

**2. A post aimed at everyone — 8 of 13.** Typical reason: *"a generic business trope that could
apply to almost any corporate worker"*.

Most moments have **no audience recorded**, and the brief says "infer from the moment". Infer means
*commit*: pick one specific reader and write to that person. Hedging across several readers is what
produces the platitude the check rejects. If you genuinely cannot tell who it is for, that is a
signal the moment is not ready, not a licence to write broadly.

**3. Identifying someone without naming them — 5 of 13.** Removing the name is not enough. A figure,
a niche, a job title and a timeline that only one person matches identifies them just as well.

**4. Banned structures — 5 of 12.** The one that recurs: **closing on a one-line restatement of the
thesis.** *"That is usually the real problem, and it is never the one on the agenda."* reads as a
sign-off and is a flagged AI tell. End on the moment, or on the one ask, not on a summary.

**5. A hook that closes the loop — 4 of 13.** *"I used to think being busy meant being valuable"*
gives away the whole post in the first line. The reader has the premise and the moral and no reason
to continue.

## If you are re-drafting

The brief includes the previous attempt and exactly what each check rejected it for. Fix those
specifically. **Do not start from scratch if the moment and the angle were sound** — a rewrite that
throws away a working angle usually fails on something new.
