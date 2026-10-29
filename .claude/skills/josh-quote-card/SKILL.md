---
name: josh-quote-card
description: Use when a post has one line worth lifting out — a sentence someone said to him, the line the post turns on, a number stated plainly. Sets it in DM Serif Display on his cream ground as a single card. The cheapest image in the set and the one that travels when someone reshares.
---

# One line, set properly

## The standard is not in this file

Fetch `visual_brand`. The ground, the ink, the accent and the faces all come from there.

## What makes a line worth lifting

Not the best line. **The line that survives leaving the post.**

A quote card is read by people who have not read the post and may never scroll to it. So:

- **It has to make sense alone.** "That's the part that costs something" means nothing without the
  paragraph above it.
- **It has to be his, or attributed.** A line somebody said to him is the strongest kind — but it is
  a quote, and it must appear verbatim in the moment. The claim ledger's rule applies here: a quote
  with no confirmed speaker does not go in, and that is not negotiable because it is the mechanism
  by which a fabricated quote reaches LinkedIn under his name.
- **It must not name anyone.** The shortest format is the most exposed, because the whole image is
  the text. Check `must_not_name` before you set it.

Lines that work: a number he measured, stated flat. A thing a client said. A sentence that admits a
limit. Lines that do not: anything that needs the setup, anything aphoristic enough to be anyone's.

If no line survives alone, say so. Not every post has one.

## The setting

- **Ground** cream, full-bleed rect, whole viewBox.
- **The line** in DM Serif Display, ink, as large as fits in three lines or fewer. Four lines is a
  paragraph and this is a card.
- **One clause in the accent green**, optionally, where the line turns. The italic is loaded and it
  is the title treatment — use it for the accent clause, not for the whole line.
- **Attribution** in DM Sans, muted navy, small, below. Anonymised: "a client", "their VP Sales".
- **The wordmark** bottom centre, lifted from the existing vector block. Never redrawn.
- **Nothing else.** No quotation-mark graphic, no decorative rule, no portrait. The brand's `Never`
  list covers the rest.

1080×1350 portrait, like the rest.

## The one measurement that matters

Three lines or fewer at **no smaller than 48px** on a 1080 viewBox. The 28px floor is for labels; a
quote card that drops to label size has too many words in it, and the fix is a shorter line rather
than smaller type.

Count the characters before choosing the size. A serif at display size is wider than it looks.

## Steps

1. `get_visual_brief` on the moment, for the brand and `must_not_name`.
2. Pick the line **from the moment's own text**, not from the drafted post — the post may have
   paraphrased it, and what you are setting is the thing that was said.
3. Check it reads alone, and check the names.
4. Set it. Measure the longest line, then the size, then the layout.
5. `create_visual` with `taking: "idea"` and a `post_doing` naming the line and who said it.

## If something will not read

Say which section and work without it. Never invent an attribution, and never tidy the line to make
it fit — a quote that has been smoothed is no longer a quote, and this card's whole value is that
somebody actually said it.
