---
name: josh-visual-audit
description: Use when asked whether an image is right before it goes out, why a visual feels off, or to check a draft SVG against Slingshot GTM's brand. Measures the SVG against the brand and against what the renderer can actually do, then reports. Not a rewrite tool — it reports and stops.
---

# Audit an image against the measured brand

## What this is not

- **Not a rewrite.** It reports what the SVG does and what the brand says. Changing it is a separate
  decision and Josh's to ask for.
- **Not another gate check.** None of the gate's checks reads an SVG, and this is not one of them
  either. A visual can fail everything here and still be filed, because this is advice and the gate
  is not.
- **Not taste.** Every finding here is a hex value, a pixel measurement or a rule quoted from the
  library. If a finding cannot be stated as one of those, it does not belong in the report.

## The standard is not in this file

Fetch `visual_brand` with `get_library`. Every number below comes from there, so a change Josh
approves changes this audit with no edit here.

## The stance

Report the brand's value, then the SVG's value, then nothing. "Your ground is `#FAFAF8`; his is
`#F4F1EA`" is the whole finding. Whether it matters is his call.

## What to measure

Read the SVG as text. Everything here is a string search or a number comparison — no judgement is
required and none should be offered.

**Colour.** Pull every hex in the file. Report any that is not in the brand, and say what it is
nearest to. Count distinct accents: more than one is a finding, and it is the brand's own rule.

**Type.** Pull every `font-family`. The renderer carries DM Serif Display (regular and italic), DM
Sans, JetBrains Mono and DejaVu. **A family outside that list does not fail — it falls back
silently, correctly, in the wrong face.** That is the finding most worth making, because nothing
else in the system will ever make it.

Check for `font-style="italic"` on a family whose italic is not loaded. resvg will not slant a
regular to make one and will not say so.

**Size.** The smallest `font-size` against the 28px floor, at this SVG's own viewBox. Scale it: 28px
at a 1080 viewBox is not 28px at 2000.

**Ground.** Is there a rect covering the whole viewBox? A transparent SVG inherits the reader's
theme and the navy ink vanishes on a dark feed.

**Format.** The viewBox against 1080×1350 and 1200×1200.

**Self-containment.** The five refusals — no leading `<svg`, no `viewBox`, an external image, a
`<script>`, an `@import`, a `<link>`, a `url(https:)`. And the sixth, which nothing checks: an
`<image href>` that is relative or protocol-relative passes the validator and renders as nothing.

**Names.** Every name on the moment's `must_not_name`, searched in the SVG text. Then the composite:
a figure, a niche and a date together. This one is a reading, not a search, and it should be
reported as a reading.

## Look at it

The research said there is no way to look at a stored visual. There is, and this audit should use
it — a rendered path is `renders/{moment}/v{n}.png` in storage, fetchable with the project key.

`rendered: true` means a PNG exists. It does not mean the words are in it, and on 27 October that
exact signal was true of an image containing two coloured bars and not one of its four labels. **If
you can fetch the PNG, fetch it and say what you see.** If you cannot, say that you could not, and
do not describe an image you have not looked at.

## The report

Four lines at most per finding: what the brand says, what the SVG does, where in the file, and
whether it is mechanical or a reading. Then stop.

If nothing is out, say so plainly. An audit that manufactures a finding to look useful is worse than
no audit, because the next one will be believed less.
