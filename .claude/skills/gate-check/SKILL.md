---
name: gate-check
description: Use when judging a draft against the content system's eight quality checks — after drafting, when asked to "run the gate", or to review a draft before Josh sees it. Fetches the real rubrics from the system rather than judging by general taste.
---

# Run the gate

Eight independent checks. **The rubrics are not in this file** — they live in the system and you
fetch them, so this and the system's own gate judge by exactly the same words.

## The stance

You are not scoring the post and you are not giving feedback. For each check you decide one thing:
**does this post fail it, yes or no.**

Be adversarial. Your job is to find the failure, not to be fair to the post.

> A gate that eventually passes everything is not a gate. It is a formality, and it lets generic
> writing reach Josh's name.

**If you are genuinely unsure, that is a fail.** Marginal work is exactly what you exist to stop.

## Steps

1. **Call `get_gate_brief`** with the draft id. It returns:
   - `system` — the gate's stance and the library sections the gate is allowed to see
   - `checks` — one entry per check still to judge, each with its own rubric, the post, and the
     source material
   - `already_judged` — checks with a verdict already; these are left out

2. **Judge each check on its own.** Read only that check's rubric, then decide. Do not let a
   verdict on one check influence another — that is averaging, and averaging is how marginal work
   gets through. Another check covers the rest; yours covers yours.

3. **Call `record_gate_verdict` once per check** — not once per draft. A rejection needs a reason
   Josh could act on: **name the sentence, not the rule.** "The opening states the conclusion" is
   useless; "The first line, 'Here is what I learned about pipeline reviews', gives away the whole
   post" is what a rewrite is built from.

4. **Run every check, even after one fails.** Josh should see everything wrong with a draft at
   once, not one fault per round trip. Stopping early is the most common way to make this take four
   times as long.

## What each verdict costs

A verdict is written once and cannot be overwritten — `record_gate_verdict` refuses. That is
deliberate: a check that could be re-run until it passed would record nothing. If a draft needs
another chance, it needs another draft.

Verdicts are also written as you reach them, so an interrupted run resumes at the check it stopped
on rather than starting over.

## The two checks that carry the most weight

Both are in the brief with full rubrics. They are named here because they are the ones most often
softened:

- **anyone_else** — could a competent stranger in the same field have written this from general
  knowledge? Fluency is not evidence. A confident post full of sensible generalities is precisely
  the failure you are looking for.
- **claims_trace** — does every assertion, quote, number and name appear in the source material?
  Plausibility is irrelevant. **If it is not in the source, it is fabricated** — including a detail
  that makes the story better.

## After the eight

`record_gate_verdict` tells you how many remain and what has failed so far. When all eight are in:

- **All passed** — the draft goes to Josh's calendar as a draft. It still is not published;
  only he can do that.
- **Any failed** — use the `draft-post` skill to re-draft. The new brief will carry these
  rejections, so fix them specifically rather than starting again.
