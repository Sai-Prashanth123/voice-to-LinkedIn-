---
name: josh-hook
description: Use when writing or sharpening the first line of a post for Josh — a hook that needs to be stronger, a draft that failed hook_opens_loop, or a redraft where the opening gives the post away. Fetches his hook rules from the system and measures the line against what the eight reference writers actually do, rather than against instincts about what a hook sounds like.
---

# Write the first line

The first line is the only line most of his readers will ever see, and the only line
`hook_opens_loop` judges. It is also the thing Josh has complained about most often.

**The standard is not in this file.** His `hooks` section is 3,677 characters, it is his, and it is
better than anything that could be written here. Fetch it with `get_library` and key `hooks` before
you write. What this skill adds is what that section cannot: what the writers he chose measurably
do, and what has actually been failing.

## The test

> Two things, both required. Only Josh could have written it, because only he was in that room.
> And it opens a loop rather than closing one.

Everything below is downstream of that.

## Name which of the three ways it fails

His section lists them, and the instruction attached is *"Name which one, rather than saying the
hook is weak."* Almost every recorded failure is the first:

1. **No gap at all.** The opening states its conclusion. Nothing is owed to the reader.
2. **A gap with no investment behind it.** Something is withheld, but nothing has been given first,
   so the withholding reads as a trick.
3. **The cut is too late.** The reveal is already inside the hook, so the rest of the post is
   confirmation rather than payoff.

## What has actually been failing

Read off `gate_runs`, with the check's own words. All of these are real first lines of his.

**"A client's team created 82 new dental deals in October."**
*"a complete statement of the result and withholds nothing."* The number is the whole post. Moving
the baseline up — what it was before — turns the same fact into a gap.

**"Outbound messaging that starts with an LLM takes far more rounds to get usable than messaging I
write myself."**
*"states the post's premise as a [conclusion]."* Nineteen words, and the argument is finished. This
is the one Josh was looking at on 30 October when he said it *"almost gives away what the post is
going to be about in the hook itself."*

**"The number of reps who don't want to cold call shocks me."**
*"states a reaction and withholds nothing."* It also opened **four different posts** — see
**Do not reuse an opening** below.

**"On 14 October a hiring manager posted that he's stunned by how many reps don't want to cold
call."**
*"a complete news summary."* Thirty-two words. Nothing is left to find out.

### And two the check got wrong, which you should recognise

**"SDR leaders: I worked out the SDR-to-AE ratio at 2,206 US software companies."** was failed for
*"announces the topic and the method"* — while the rubric's own clause says **"Naming the METHOD
while withholding the FINDING passes."** The ratio is not in that line. It is a good hook and the
check contradicted itself.

**"This is why cold email is broken:"** was failed too, and Josh had asked for that exact opening in
writing two days earlier.

If you write a strong hook and the check fails it, say so in those terms rather than rewriting a
good line. The rubric carries a dated note conceding it misreads its own rule.

## The measured floor

From `data/josh/hooks/latest.json`, derived across the reference posts by
`scripts/build-hook-patterns.mjs`. **Do not copy these numbers into a draft or into this file's
head — re-read them, because they move when the corpus is re-measured.**

- **Length.** Their first lines run a median of about eleven words and nine in ten are under about
  thirty. Per shape they differ a lot: a colon setup is short, a number claim roughly twice that, a
  time-anchored opening longest of all. A long first line is the commonest reason a hook reads as a
  topic announcement.
- **Withholding.** In roughly three in ten of their posts the first figure arrives *after* line one.
  That is the curiosity gap as his section defines it.
- **Naming the reader.** His section calls this the highest-value tool available. They use it in
  about one line in seven — a real move, not a default.

## One thing his section asks for that these writers do not do

His section asks the opening to carry **specificity, a real emotion and clear stakes**, and says a
hook missing all three cannot be rescued by a better cut.

Measured, the eight carry two or more of those in **under one first line in ten**. Specificity is
common; stakes and a stated emotion are rare.

**So it is not a quota and must not be used as one.** It is his advice about what makes a reader
care, and it is good advice. A draft is not better for ticking two of three, and a hook is not
failed for carrying one. If you tell Josh his hook is short of an element, you are inventing a
standard and attributing it to writers who do not meet it.

## Do not reuse an opening

On 29 October the identical first line opened four drafts for four different moments. Nothing
noticed, because the only cross-post check compares embeddings and almost none exist.

`create_draft` now reports this as `own_words`. It advises and never refuses — a deliberate callback
is a real move, and his words are his to repeat. Read it to him rather than deciding for him.

## Two nevers, and one that was over-enforced

**Never open with a question.** His rule, and a question *closing* a hook is a different thing that
often works.

**No bait.** If a hook only works because it annoys someone, it fails.

**"Here's why:" is allowed, and used to be refused.** His banned list rules out `"Here's why."` and
`"Here's the thing:"` as lines that stand alone and explain nothing — a reader made to wait a line
for nothing. A teaser that introduces the clause immediately after it is the colon-setup shape, one
of the six tools in his own section. Josh said those words aloud on 30 October as his example of a
good opening while the system was refusing them. The detectors were narrowed to the forms the
library actually names on 2 November.

## Before you hand it over

Run `measure_draft`. Three things in it are about the first line:

- `fold.what_he_would_see` — the text before "see more". The constants are uncalibrated, so act on
  the preview and on `hook_lands_above_it`, and **do not quote the word count to Josh as a
  measurement.**
- `shape.opening_words` — line one against the writers' band.
- `opening.yours` — which of the seven shapes it is.

Then say which of the three failure modes it would have been, if any, and why it is not.
