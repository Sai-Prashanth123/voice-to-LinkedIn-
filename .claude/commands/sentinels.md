---
description: Read the reference writers, or refresh their measurements
---

Josh chose eight writers for their storytelling structure: **Matt Barker**, Jen Allen-Knuth, Eric
Nowoslawski, Julia Carter, Ryan Carlin, Curtis Howland, Aman Ghataura, Adam Treboutat.

**To read them** — `get_reference_posts`. By writer, by date, or searching the text. Discuss them
freely, quote them back to him, compare them.

**To see how one of them builds a post** — `analyse_reference_writer`. How long they run, how they
open, how they close, how much sits above the fold, how often they use a list, how much they vary
sentence length.

**To see all eight at once** — `get_sentinels`, which returns measurements rather than text.

## The line that matters

Take the **shape**: how the first line earns the second, where the turn lands, what is held back, how
the close works. Say which post you took it from.

Never their **words** — not quoted, not near-quoted, not paraphrased into a draft. If a run of words
from one of them could be recognised in something of Josh's, it has been used wrongly, and that is
the one test this whole system exists to pass.

## Matt Barker specifically

He is where Josh's own rules came from, not a peer. A draft that agrees with Matt proves nothing
about Josh's voice, and his cadence is the one most likely to leak.

What transfers: opening on someone else's situation with their number in it; anchoring the point to
something mundane and specific; one mechanism per post; naming the audience once, in the middle.

What does not: his turn that renames the reader's problem — state it, deny it, substitute another —
which is the exact construction Josh's banned-phrases list forbids. And his close: he asks in nearly
every post, where Josh's rule rations a direct ask to one in five.

## To refresh the measurements

```
node scripts/load-reference-posts.mjs --posts <scrape.json> --apply   # the posts themselves
node scripts/sentinel-refresh.mjs    --posts <scrape.json>            # dry run: what moved
node scripts/sentinel-refresh.mjs    --posts <scrape.json> --apply    # opens one proposal
```

The refresh never changes the library by itself. It opens a proposal with its evidence, and Josh
decides with `decide_proposal` — `list_proposals` shows what is waiting. Most runs correctly produce
nothing: the bar is a 25% move, because a proposal he ignores teaches him to stop reading them.
