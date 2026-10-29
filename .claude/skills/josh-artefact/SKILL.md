---
name: josh-artefact
description: Use when a post rests on something Josh was actually sent or shown — a cold email, a LinkedIn message, a dashboard, a screenshot he shared — and the picture should be that thing rather than a drawing of it. Anonymises it first, then annotates it in his brand. Use this rather than josh-visual whenever the image carries someone else's words or a real interface.
---

# The real thing, anonymised

## The standard is not in this file

The brand lives in `visual_brand` and the cleared names live on the moment. You fetch both. What is
here is the procedure, and the procedure is mostly about what to take out.

## Why this one exists

A drawing of a cold email can be made by anyone. **The actual email he was sent cannot**, because
they were not sent it. That is the whole edge, and it is the same reason his posts work: he was in
the room.

Moment 114 is two real emails. Moment 80 is a pasted outreach message with its subject line. These
are pictures already — they only need the name taken off and the point marked.

## The order matters, and it is not the obvious one

**Anonymise before you annotate, and annotate before you style.** Anonymising last means arrowing at
a name and then removing it, which leaves a mark pointing at nothing. Styling first means doing the
work twice when a redaction changes the layout.

## Steps

1. **Get the names.** `get_drafting_brief` or `get_moment` on the moment. `must_not_name` is the
   list that must not appear. Read it before you read the artefact, so you are looking for them
   rather than at the content.

2. **Read the artefact for what identifies, not for what it says.** Six places, and the last two are
   the ones that get missed:
   - the sender's name, and the recipient's
   - the company name, in the body and in the signature
   - the domain — in an address, a URL, a footer, a tracking link
   - the logo or the avatar
   - **the subject line**, which is prose and is routinely forgotten
   - **anything that identifies without naming** — a headcount plus a sector, a funding round plus a
     month, a product only one company sells

3. **Decide whether it survives.** If what makes the artefact worth showing is the thing that
   identifies, **there is no image**. Say so and stop. That is a correct outcome and the system
   says so in three places.

4. **Redact by replacement, not by blacking out.** A black bar says "there was a name here" and
   invites a guess. Replace with the shape: `[a compliance platform]`, `[their VP Sales]`,
   `[vendor].com`. It reads better and it leaks nothing.

   Keep the structure exactly — line breaks, the stray lowercase, the broken merge field. **The
   errors are the evidence.** An email that says "Hi {{firstName}}" is the whole point of the post,
   and tidying it destroys the thing being shown.

5. **Annotate.** One or two marks, no more. A rule in `#2EA866` beside the line that matters, or a
   short label in the muted navy. If it needs five annotations, the post should be making that
   argument in words.

6. **Style it as a quoted document, not as his own writing.** It is somebody else's artefact shown
   inside his brand — an inset panel on the cream ground, bordered, with his type for the labels and
   the artefact's own plain setting inside. Do not set a stranger's email in DM Serif Display; it
   reads as his.

7. **File it** with `create_visual`, `taking: "look"`, and a `post_doing` that says what was redacted
   and what was kept. That note is the audit trail for a decision nobody can check later.

## Embedding a screenshot

An image is allowed, but only one way. `create_visual` refuses `<image href="https:…">` outright,
and **a relative or protocol-relative path passes the validator and renders as nothing.** The only
form that works is a `data:` URI:

```
<image href="data:image/png;base64,…" x="…" y="…" width="…" height="…"/>
```

Two cautions. Base64 costs about a third more than the file, and the practical ceiling on an SVG
here is around 16–20 KB of text — the four real visuals on moment 111 are 11–12 KB each, dense, with
an embedded vector wordmark. **A screenshot will not fit.** So in practice: redraw the artefact as
type and boxes rather than embedding a photograph of it. That is better anyway — it is legible at
feed size, it is in his brand, and the redaction is part of the drawing rather than a bar over a
picture.

Embed a raster only when the artefact's own rendering is the point, and keep it small.

## The check before you file

Read the finished SVG as text and search it for every name on `must_not_name`. Then read it again
for the composite: **is there a figure, a niche and a date that together name a company to someone
in that market?** His readers are in his market.

Nothing in the system will catch this for you. No gate check reads an SVG.
