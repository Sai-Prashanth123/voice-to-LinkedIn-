---
name: josh-infographic
description: Use when a post's content has structure worth showing — ranked methods, a comparison, a sequence of steps, a set of numbers measured across a population. Builds it as a self-contained SVG in his brand and files it with create_visual. Use josh-visual for a single object or a single number; use this when the shape of the information is the point.
---

# When the structure is the point

## The standard is not in this file

The palette, the ramp and the type live in `visual_brand` and you fetch them. What is here is how to
choose a shape and how to keep it legible on a phone.

## What this is for, and what it is not

**For:** his eight detection methods ranked by effort. The SDR-to-AE ratio across six company-size
bands. A pros-and-cons split. A three-step sequence where the order carries the argument.

**Not for:** decorating a post that has no structure in it. If the body is a story, the picture is
not a diagram — it is a number, an object, or nothing. Clause 10.7: *"The system must not attach one
just because it can."*

And not for inventing structure. Every row, label and figure traces to the moment, exactly as a
claim in the body does. **A diagram of numbers he did not measure is the clearest possible failure
of the rule that nothing is invented** — it looks authoritative and it is fabricated.

## The shape, chosen in this order

1. **Ranked rows**, when one variable orders the set. One column, ordered, with the ordinal ramp
   carrying the rank and a labelled axis arrow down the side. This is what Josh chose on moment 111
   and it is the strongest default — it reads top to bottom at any size.
2. **Two columns**, when the post compares two things. Not three. Three columns at feed width give
   you about nine characters a cell.
3. **A sequence**, when the order is causal rather than ranked — arrows between steps, same stroke
   as the boxes.
4. **A single table**, when the data genuinely has two dimensions and both matter. Rare, and the
   first thing to cut when it will not fit.

If none of these fits, the content probably has no structure and this is the wrong skill.

## The AntV route, and the one thing it cannot do

The upstream infographic DSL (`infographic` + `data` + `theme`, two-space indented) is a fast way to
get a layout. Use it to think, and to generate — then **export the SVG and inline it.**

What it produces at view time is not fileable here. It pulls its renderer from `unpkg`, its icons
from `api.iconify.design` and its illustrations from a GitHub raw URL, and `create_visual` refuses
every one of those: an external `url(https:)`, a `<script>`, a `<link>`. The HTML preview is a
working drawing. The deliverable is the exported `<svg>` with everything resolved into it.

Two consequences worth planning for rather than discovering:

- **Icons will not come across.** An iconify icon is a fetch. Either inline the path data or drop
  the icon — and dropping it is usually right, since `visual_brand` rules out stock icons anyway.
- **The theme is not his brand.** A `palette` array is three hex values in a sequence; his brand is
  a ground, an ink, one accent and a four-step ordinal ramp with a text-colour flip. Set the colours
  after export, from the library, not from a theme guess.

Writing the SVG directly is often faster for a ranked-row layout. Reach for the DSL when the shape
is one you have not laid out before.

## Density, measured

The floors from `visual_brand` bite hardest here, because an infographic has more text than any
other kind of image.

- **28px minimum** at a 1080–1200 viewBox. Count the longest label before choosing the row count,
  not after.
- **Legible in greyscale.** The ordinal ramp passes because depth survives desaturation. A
  categorical palette of five colours does not.
- **Text flips to `#FBF9F4` on the two darkest ramp steps.** Forgetting this is how a label
  disappears into its own row.

## The rule this skill is most likely to break

**No gate check reads an SVG.** An infographic is far more exposed than any other image, because it
carries axes, legends, row labels, series names and figures — a dozen places a name or an
identifying figure can sit, none of them checked by anything.

Before filing, read the SVG as text and search it for every name on `must_not_name`. Then read it
again for the composite: a figure plus a niche plus a timeline identifies a company to anyone in
that market, and removing the name does not fix that.

If the structure cannot be shown without something identifying, produce no image.

## Steps

1. `get_visual_brief` on the moment — the brand, the naming rule, `next_version`.
2. Choose the shape from the four above, and say which and why.
3. Lay it out. Longest label first, then the row count, then the type sizes.
4. Colour from the library: ground, ink, one accent, the ramp for the ordered variable.
5. Read it back as text against `must_not_name` and against the composite test.
6. `create_visual` with `taking: "structure"` and a `post_doing` that says what the shape is doing.

## If something will not read

Say which section, say you worked without it, and work without it. Never guess at a palette — a
diagram in invented colours is indistinguishable from a diagram in his, until he sees it.
