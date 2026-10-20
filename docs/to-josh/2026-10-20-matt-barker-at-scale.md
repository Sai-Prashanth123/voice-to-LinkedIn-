# Matt Barker, measured on 250 posts instead of six

**Not sent.** Written 20 October 2026. The same findings are in **proposal 18**, waiting on Josh's
approval — this is the readable version for the two of us, and the part he needs is the correction
in the middle.

---

## What we had, and why it was thin

Josh asked to lean into Matt Barker's structure above the other seven. The library has done that
since 5 October: there is a section called *"Matt Barker, read structurally"* that says where he
starts, what his middles do, and which of his moves must not be copied.

It rested on **six of his posts**. They had arrived from the scraping console with their line breaks
stripped, so nothing could measure them and they were read by eye. Six posts is a week of his
output, and a week of anyone's output is a mood.

## What we have now

**1,900 posts across all eight writers, 1,839 of them with their line breaks intact — 97%.**
Before today it was 156 posts and 51 shaped, 33%.

| | before | now |
|---|---|---|
| Matt Barker | 21 posts, 8 measurable | **250 posts, 241 measurable** |
| The whole corpus | 156 posts, 51 measurable | **1,900 posts, 1,839 measurable** |
| Oldest post | 19 Aug 2026 | 28 May 2020 |

Two things made that possible, and both were sitting unused:

- **The line breaks were never LinkedIn's fault.** The console's parser strips them — bug 5 in the
  report we wrote yesterday. Apify returns the same posts with their paragraphs intact. That path
  existed in the code and had never once been run, because the token was never bought. It cost
  $3.85.
- **`adam-treboutat` was never a bad handle.** The library has said *"has returned zero posts on
  every run — worth confirming the handle"* since September. He returned **250 posts** on the first
  Apify call. It was the console failing, quietly, in a way that looked like the writer's fault.

## The correction, which is the important part

The library says Matt Barker **"closes on an ask in nearly every post"**, and rules his closing
habit out of bounds for Josh on that basis. It is in the library, in CLAUDE.md, in three of the
skills and in the README.

It is wrong, and not by a little:

| | closes on an ask |
|---|---|
| **Matt Barker** | **22 of 241 — 9%** |
| The other seven | 17% |
| Josh's own rule | one in five — 20% |

**He asks less often than the other seven, and less often than Josh's own rule allows.** He is the
most restrained closer of the eight.

What the six posts actually showed was a different habit: **he ends one post in five with a
postscript** — 20%, where no other writer here passes 4%. A P.S. carrying a link reads as a pitch
when you have six of them and as a habit when you have 241.

So one of the two things we told Josh "does not transfer" was an artefact of the sample. Nothing
about his closing needs ruling out. His rule rationing a direct ask stays, because it is his rule
and was never Matt's to justify — but it is no longer a place where following Matt would breach it.

## What held up, and got stronger

- **He opens on a number.** 120 of 241 posts — **50%**. He is the only one of the eight whose
  commonest opening is anything but a plain statement, and the nearest any of the others gets is
  27%. This was the original finding and it doubled in strength.
- **He turns early.** 180 of 250 posts reverse on a marked turn (**72%**, against 44% across the
  corpus) and his median turn lands **0.16** of the way through, against 0.25. The earlier number
  was 0.10 in 18 of 21 — the direction was right, the magnitude was overstated.
- **He lands short.** 41% of his closes are eight words or fewer, the highest of the eight.

## What inverted

- **"A scene, not a cut."** We said his openings set a scene, on eight posts that put him at 61.5
  words above the fold. At 241 he is at **39** — the second fewest of the eight. He gets in fast and
  explains afterwards.
- **"Sentence variation 8.3, mid-pack."** At 241 it is 9.3 and he is the **second most uniform** of
  the eight. He writes in steadier lengths than his reputation suggests.
- **"A list in half his posts."** Counted rather than inferred, it is **65%**.

## One number we had been quoting was never that good

Where a post arrived flat, list use was guessed from surviving dashes and digits. That detector was
calibrated on 51 posts and reported as **90% accurate**. Measured against all 1,839 it is **83.8%** —
and for Matt specifically it runs 11 points *below* the true rate, because his lists are often plain
line-broken clauses with no marker to find.

It barely matters now, since 97% of the corpus can be counted directly. But every structural figure
we have sent Josh carrying "90%" should have said 84%.

## The thing that was missing underneath all of this

Scraping ten times more of the writer whose cadence is most likely to leak raises the risk that some
of it ends up in a draft. **"Take the shape. Never the words"** is the strongest rule in CLAUDE.md
about these eight and it had nothing mechanical behind it at all — nine gate checks, and not one of
them can see a reference post, by design.

There is now a check that can. It holds a fingerprint of every seven-word run in all 1,900 posts —
**hashes, not sentences**, so the system still holds none of their text — and refuses a draft that
reuses one.

Calibrated before it was allowed to refuse anything: **zero hits across all 72 of Josh's existing
drafts**, every one written before this corpus existed. It catches a lifted sentence every time.

---

## What Josh needs to decide

**Proposal 18** replaces the reference-posts section with all of the above. Proposal **9** is also
open against the same section and is superseded by it — if he takes 18, reject 9.

The one remaining "does not transfer" is his turn that renames the reader's problem, and that one is
still a reading rather than a count. Given the claim beside it turned out backwards on six posts, it
is labelled as a judgement in the new section until something measures it.
