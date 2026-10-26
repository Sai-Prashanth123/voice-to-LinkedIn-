---
name: barker-audit
description: Use when asked to audit a draft against Matt Barker's structure, to check whether a post "reads like Barker", or when Josh asks why a draft feels flat structurally. Judges against the measured shape of the eight reference writers, not against taste. Not a rewrite tool — it reports and stops.
---

# Audit a draft against the measured structure

Offered to Josh at the kickoff on 1 September as "a Matt Barker audit". It waited on his course
material, which never arrived. It does not need it: **his structure is measurable from his posts,
and now is measured.**

## What this is not

- **Not a rewrite.** It reports what the draft does and what the writers do. Changing the draft is
  a separate decision and Josh's to ask for.
- **Not a tenth gate check.** The gate judges nine things and this is not one of them. A draft can
  pass the gate and still sit outside every number here, and that is allowed — these are what the
  writers *tend* to do, not rules.
- **Not a licence to copy him.** Clause 8.3: structure only, never cadence or phrasing. If a run of
  words from one of these writers could be recognised in the draft, the draft is wrong however
  well it scores here.

## The stance

Report the number, then the draft's number, then nothing. Do not soften a gap and do not inflate
one. "Your turn lands at 0.71; across the eight the median is 0.23 and Barker's is 0.10" is the
whole finding — whether that matters is Josh's call, and he is better at it than you are.

**One of Barker's signature moves is ruled out on purpose.** Do not recommend it:

- His turn that renames the reader's problem is the construction `banned_phrases` forbids.

A draft that scores badly *because* it avoids that is correct. Say so.

This listed a second until 20 October — that he closes on an ask in nearly every post. It was read
off six of his posts and it was backwards. Across 241 he asks 9% of the time, against 17% for the
other seven and the 20% Josh's rule allows. **Do not tell him his closing habit is one to avoid.**
The habit those six actually showed was a postscript, on one post in five.

## Steps

1. **Get the measured shape.** `get_voice_brief` carries the voiceprint, and
   `analyse_reference_writer` with `handle: "mattjbarker1"` carries his per-writer figures. Use
   those rather than the numbers written below, which are a snapshot and will drift.

2. **Measure the draft.** `measure_draft` returns its paragraphs, above-fold words, closing shape
   and sentence spread. `compare_to_references` puts it beside the writers on four dimensions.

3. **Read the five moves** from the `frameworks` library section via `get_library`. That section is
   where this audit's standard lives, so a change Josh approves there changes this audit with no
   edit here.

4. **Report, in this order**, each as one line with both numbers:

   | Move | What to check |
   |---|---|
   | The opening | Is it specific, or does it name what the reader believes? A consensus opening is the rarest shape in the corpus — 5 of 156 — and banned outright. |
   | The turn | Where does the draft reverse, as a fraction through? The eight median 0.23; Barker 0.10 in 18 of his 21. A turn in the last third is usually a post that explains before it earns attention. |
   | Enumeration | Does it enumerate where it has three or more parallel items? 55% of posts do. Barker 52%. Wide spread, so this is an option, not a failing. |
   | The close | How long is the last sentence? Median 9.5 words, and 37% land in eight or fewer. A close that restates the thesis is a flagged tell. |
   | The ask | Is there one? 8% of posts close on a direct ask, and Josh's rule is one in five. More than that is wrong even though Barker does it. |

5. **Say which of the five the draft is furthest from, and stop.** One line. Do not produce a
   revised draft unless asked.

## The snapshot these numbers came from — and it is a twelfth of the corpus

**Stale, deliberately left here, and not to be quoted.** Measured 14 October 2026 across **156**
stored posts, Matt Barker **21** of them. The corpus is now **1,900** posts and **250** of his, so
every figure below rests on roughly a twelfth of what is stored. Step 1 above says to take the
numbers from `analyse_reference_writer` instead; this section is what "will drift" looks like once
it has.

What the 14 October snapshot said: Matt Barker, 21 posts — opens on a number about himself more
often than any other shape and is the only one of the eight who does; turns at 0.10 in 18 of 21;
lands short; enumerates in 52%.

What 241 measurable posts say: he opens on a number in **120 of 241 (50%)**, still the only one of
the eight; **39** words above the fold, second fewest; **13** paragraphs; lands short in **41%** of
closes, the highest here; uses a list in **65%**. The direction of every claim held. The figures
moved.

**One figure in the old snapshot was inferred, not counted** — 105 of those 156 posts arrived with
their line breaks stripped, so lists were detected from surviving markers, right 46 times out of 51
against known truth. Re-measured at scale that detector came out at **83.8%**, not 90%: the small
sample had been flattering it. Which is the reason this section carries a warning rather than a
correction — a number read off a twelfth of a corpus can be wrong in a direction nobody predicted.

## When the course material arrives

Josh offered his Barker frameworks, hooks and story-extraction prompts at the kickoff. When they
come, they do **not** replace anything here: a taught abstraction and a measured habit are
different kinds of claim, and the measured one is checkable. They go in as library proposals he
approves section by section, and this audit picks them up through `get_library` without an edit.

Watch for one thing when they do. Material from his course will contain the two moves Josh has
already banned, because they are moves Barker teaches. Loading them would quietly reverse rules
Josh set himself.
