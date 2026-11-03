---
name: josh-hook-lab
description: Use when Josh wants OPTIONS for an opening rather than a verdict on one — "give me some hooks for this", "I don't like that first line", or before filing a draft he is likely to rewrite the top of. Writes six candidate openings in different measured shapes, shows each as it will appear above the fold, checks each against his rules and his own past openings, ranks them, and stops. It never files a draft.
---

# Six openings, previewed, before the draft exists

Josh, 30 October: *"I'm often having to change the opening hook… it's always picking up that the
hook's not great. So let's just fix it at the ground level rather than waiting for it to fail,
inevitably fail, and then fix it."*

That is this skill. `josh-hook` judges one line; this one writes six and makes the choice his.

**It never calls `create_draft`.** It produces openings and stops. He picks one, and the post gets
written to it afterwards.

## Fetch, do not guess

Two calls, in this order:

1. **`get_hook_brief`** with the `moment_id`. Measurements only: first-line length by shape, how
   much of the fold each shape's openings eat, how often the finding is withheld past line one, and
   **the openings he has already used** so a candidate does not repeat one.
2. **`get_library` with key `hooks`.** His rules — the two nevers, the three ways a curiosity gap
   fails, the six tools. **This is the standard and the brief is not.** Where the corpus and his
   section disagree, his section wins (12.10).

Then `get_moment` or the drafting brief for the material. A hook invented from a topic rather than
from his material is the thing the whole system exists to prevent.

## Write six, one per shape

One candidate in each of: **number claim, statement, colon setup, first person, time anchored,
consensus claim.** Not six variations of one idea — six genuinely different ways in.

**Never a question opening.** It is one of his two nevers, and the corpus build already excludes
every question opening his rules reject.

Each candidate must be **writable from the material he actually gave**. If a shape has nothing to
stand on — no figure for a number claim, no date for a time anchor — say so and offer five. An
invented figure to fill a shape is the failure this system exists to stop, and it would be caught
later by the claim ledger anyway.

## Measure each one, do not estimate it

For every candidate, call **`measure_draft`** with the candidate as the body. From the result:

| what to show | where it comes from |
|---|---|
| the preview — what he sees before "see more" | **`preview_post`**, and show him its output as-is |
| how many of the three lines the hook eats | the boxes `preview_post` draws, mobile and desktop |
| first-line length against the corpus | `shape.opening_words` |
| which shape it actually is | `opening.yours` |
| any construction his library rules out | `will_refuse` and `ai_tells` |

## Two things that pass every check and still read as generated

**Once a post exists under the hook, measure these as well.** They are not hook properties — a
first line cannot fix either on its own — so report them when there is a draft and stay quiet when
there are only openings.

| | where | what good looks like |
|---|---|---|
| sentence variation | `rhythm.sentence_words_sd` | inside `rhythm.against_the_corpus` |
| does it turn | `reading_order.turn_marker_found` | 45% of the corpus reverses |

Both are already returned by `measure_draft` and nothing has ever acted on them.

**This is not theory.** On 2 November a sample post for moment 125 came back clean on everything
above — no refusal, zero AI tells, zero scrub findings, hook above the fold, no repeated opening —
and was still flat. Its sentence variation was **5.9** where the eight writers run 7.1 to 18.8, and
it had **no turn at all**. His `banned_phrases` section calls uniform sentence length *"the
strongest statistical signal of generated text"*, and *flat* is his own word for a post that never
changes direction.

A human caught both. Every automated check passed it. That is why they are in this table.

The fix is not subtle and does not need to be. One genuinely long sentence next to a two-word one
moved that draft from 5.9 to **9.0**, and one marked reversal — *"Turns out the vendor publishes
it, one page at a time"* — put a turn at 20% of the way in. Nudging a 19-word sentence to 17 does
nothing; the spread is the point.

**The fold is the point.** Across the measured corpus, **39% of openings fill all three visible
lines or overflow them** — the reader sees the hook and nothing else. That is exactly what Josh was
describing when he pasted a post into a preview tool and said *"it's just a wall of text… there's
nothing here."* An opening that uses one or two lines leaves something underneath it visible.

### The word band and the fold are different constraints, and the fold wins

Found by running six candidates for one moment through `measure_draft` on 2 November:

```
colon setup      6w   ▮▯▯   leaves two lines visible
statement       12w   ▮▮▯
time anchored   25w   ▮▮▮   inside its band, and the reader sees nothing else
```

Twenty-five words is **normal** for a time-anchored opening — the corpus median for that shape is 21
and nine in ten are under 35. It still ate the whole preview. A hook can sit comfortably inside the
measured band for its shape and still be the wall of text Josh complained about, because the band
counts words and the reader sees lines.

**So check both, and when they disagree, the fold is the one he will actually see.** The shapes that
run long by nature — time anchored, number claim — are the ones to watch.

### One more thing the classifier will not tell you

`number_claim` means a number **about him**, not any number. The shape detector needs a figure and a
first-person pronoun in the same line, so *"3,941 practices, read one at a time off a vendor's own
booking page"* comes back as `statement`. If you want the number-claim shape, he has to be in the
line.

**Say the caveat once, and do not quote a word count as a measurement.** The fold is simulated with
uncalibrated constants — 42 characters a line, three lines — and `measure_draft` says so in
`how_much_to_trust_it`. Act on the preview text and on `hook_lands_above_it`. The forty taps to
calibrate it are still outstanding with Josh.

## Check each one

- **Has he opened a post this way before?** Compare against `openings_he_has_used` from the brief.
  On 29 October four drafts for four different moments opened on the identical sentence and nothing
  noticed. Flag it; do not silently drop the candidate — a deliberate callback is his to make.
- **Does it break a rule of his?** `will_refuse` from `measure_draft` is the mechanical half. The
  rest is his hooks section, read not remembered.
- **Does it still owe the reader something?** Name which of his three failure modes it would hit if
  it does not: *no gap at all*, *a gap with no investment*, *the cut is too late*. His section says
  to name which one rather than calling a hook weak.

## Rank, with the reason

Order them and say why the first is first, in one line each. Rank on:

1. whether anything is still owed to the reader after line one;
2. whether it leaves room above the fold;
3. whether it is anchored in something only he has;
4. whether it repeats an opening he has used.

Then stop and ask which he wants. **Do not write the post until he picks**, and do not quietly pick
for him by presenting one option as obviously right.

## What this does not do

- It does not file anything. No `create_draft`, no `start_post`.
- It does not change a rule. If he says *"never open like that"*, that is `add_library_rule`, in his
  words, immediately — and it is his section, not this skill's.
- It does not copy anyone. The corpus behind the brief carries **no sentences**: the build refuses
  to write if any post's text reaches it. Every candidate is written from his material, and
  `create_draft` would refuse a seven-word run borrowed from a reference writer anyway.
