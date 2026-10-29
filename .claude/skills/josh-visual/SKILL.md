---
name: josh-visual
description: Use when a post needs a picture — "make an image for this", "what goes with this post", a draft Josh is about to approve that would carry better with a visual, or a rebuild of something he has seen and shared. Writes a self-contained SVG in Slingshot GTM's brand and files it with create_visual so it attaches to the post. Fetches the brand from the library rather than from any palette written down here.
---

# The picture that goes with a post

## The standard is not in this file

It lives in `visual_brand` in the library and you fetch it, so a colour Josh changes is a colour the
next image uses with no deploy and nothing to keep in sync. What is here is the craft: how to decide
what the image is, and the five ways an SVG stops being fileable.

## The one rule

> **Could this be any B2B SaaS company's graphic? If yes, it fails.**

It is the same test the writing is held to, in a different medium. A stock chart of invented numbers
is the visual form of the AI-generated post this whole system exists to prevent.

The corollary is the useful part: **his raw material beats any illustration.** He is sent real cold
emails. He measures real numbers across real companies. A number he measured, set plainly, cannot be
copied by a competitor — they did not measure it. A drawing of a rocket can be copied by anyone.

## Not every post gets one

Clause 10.7, and it is load-bearing: *"The system must not attach one just because it can."* If the
post says the thing in words and the picture would only repeat it, there is no picture. Say so and
stop. A post with no image is a normal outcome.

Two more ways the answer is no:

- **If the image needs something identifying to make its point, produce nothing.** Not a smaller
  version, not a vaguer one. That is a correct outcome, not a failure.
- **If you are inventing the content of the image**, it is not his. Every number, label and quoted
  line has to trace to the moment, exactly as a claim in the body does.

## Steps

1. **Read the brand.** `get_visual_brief` with the moment id. It returns the moment, the library
   view inline, `source_images` if Josh shared one, `existing_versions`, `next_version`,
   `brand_supplied`, and the naming rule stated separately. If `brand_supplied` is false, use a
   restrained neutral palette and **say so in your notes** rather than inventing an identity for him.

2. **Decide what the object is**, before any SVG. One of:
   - **A number he measured**, set large. The strongest and the cheapest. His SDR-ratio post carries
     a real table across 2,206 companies; that is a picture already.
   - **A structure** — the ordered rows, the comparison, the sequence. This is what moment 111 is,
     and the version he chose puts eight methods in one column ranked by effort.
   - **A real artefact**, anonymised — an email he was sent, a screenshot. Use the `josh-artefact`
     skill for these; the redaction is the hard part and it has its own procedure.

   One object and one promise. If it needs two, it is two images or none.

3. **Write the SVG.** Self-contained, `viewBox`, real `<text>` elements. The brand decides colour
   and type; the library section decides density and format.

4. **Check it against the list below** before filing. `create_visual` will refuse four of these and
   silently accept the fifth, which is the one worth checking by hand.

5. **File it.** `create_visual` with `moment_id`, `svg`, `taking`, and `post_doing` saying what the
   image does and why — in your own words, as a note to Josh.

   `taking` is `idea | structure | look`. The vocabulary assumes you are departing from something he
   saw, because that is what the capability was built for. When the image originates here, `idea` is
   the honest value and `post_doing` is where you say so.

## What create_visual refuses

Four mechanical, and it names them:

- not starting with `<svg`
- no `viewBox` — *"it will not scale in a LinkedIn feed"*
- an external image, a `<script>`, an `@import`, a `<link>`, or a `url(https:)`

**And the fifth, which nothing checks: a `<image href="/relative.png">` or a protocol-relative
`//cdn...` passes the validator and renders as nothing.** The check is an `https?:` prefix test, not
a proof of self-containment. An embedded `data:` URI is the only external image that actually works.

### Fonts are not an exception you can argue with

There is no route to a typeface from inside the SVG. `@import` is refused, `<link>` is refused,
`url(https:)` is refused, and **resvg does not resolve `@font-face` at all — not even from a `data:`
URI.** The renderer's font list is the only font source there is.

Since 29 October that list carries DM Serif Display (regular and italic), DM Sans, JetBrains Mono
and DejaVu. Name those and they render. Name anything else and it falls back silently, correctly, in
the wrong face, and **nothing in the system will tell you** — there is no way to look at a stored
visual, and the first reader would be whoever saw it on LinkedIn.

For two days before that the list was DejaVu alone, so every serif heading this system ever
rasterised came out a grotesque. Do not assume a face is available because the brand names it.

## What survives the feed

Hard floors, because LinkedIn renders a feed image a few hundred pixels wide on a phone:

- **No text below 28px** at a 1200-wide viewBox. Smaller is gone.
- **Legible in greyscale.** If removing the accent destroys the meaning, the meaning was carried by
  colour alone and it fails for anyone who cannot see it.
- **An explicit ground rectangle covering the whole viewBox.** A transparent SVG inherits the
  reader's theme, and near-black ink vanishes on a dark feed.

## The naming rule, which is the one with a client-sized downside

Restated here rather than trusted to the section, because **no gate check reads the SVG.** The
checks judge the post body; `visuals` is a different table. Two pieces of prose are the only thing
between a chart label and a published image naming a client.

Nothing identifying, anywhere: not a label, an axis, a legend, a caption, a logo, a watermark, a
URL, an email address, a chart title or a row of a table.

**And removing the name is not anonymising.** A figure plus a niche plus a timeline identifies a
company to anyone in that market, and his readers are in his market. Use the shape — "a vertical
SaaS company", "a compliance platform", "a team of forty".

Check `must_not_name` on the moment before you file, every time.

## If something will not read

Say which section, say you worked without it, and work without it. Never guess at what it said, and
never substitute your own sense of what a good image is for a standard you could not open — that
substitution is the whole reason the standard lives in the system rather than in this file.
