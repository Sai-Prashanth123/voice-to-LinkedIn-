---
name: josh-animation
description: Use when a post's point is a change over time — a number moving, a sequence revealing, a comparison that lands in stages — and a still would have to show the end state only. Builds an animated GIF and MP4 in his brand. Read the limits section first: this output cannot be filed with create_visual and the system cannot attach it to a post.
---

# A picture that moves, and the system that cannot hold it

## Read this before anything else

**This output does not go through `create_visual` and cannot be attached to a post.** That is not an
oversight to work around, it is what the pipeline is:

- The stored artefact is one PNG at `fitTo: width 1200`, and that PNG is the only thing
  `worker-publish` attaches.
- `<script>` is refused by the validator outright.
- **SMIL — `<animate>`, `<animateTransform>` — passes the validator, and resvg renders frame zero
  and discards the rest, silently.** An "animated SVG" filed here is a still of its first frame
  reporting success, which is the exact defect this repo is named for.
- There is no video column on `visuals`, no encoder in the edge runtime, and no upload path.

So a GIF from this skill is a **file Josh posts by hand.** Say that to him when you hand it over.
Do not imply it is in the calendar, because it is not, and nothing in the system will mention it
again.

There is also no animation skill anywhere to copy. The reference repo has 35 skills and none
animate; its GIF capability is two one-off scripts for one client that write to the same output path
and overwrite each other. This is a first build, and the three ideas worth keeping from those
scripts are named below.

## When it is worth it

Rarely. A still is cheaper, it attaches to the post, and it is what the system was built for. Reach
for this only when the **change itself is the argument**:

- a number that moves as a condition changes, where the end state alone hides the shape
- a sequence where the order is the point and showing it at once collapses it
- a comparison that lands in stages, where the pause before the second half is doing work

If the end state says it, make a still with `josh-infographic` and stop.

## The standard is not in this file

Fetch `visual_brand`. Ground, ink, one accent, the ordinal ramp, the type — all from the library.
The faces are web-loaded here rather than renderer-loaded, because this path renders in a browser
rather than through resvg, so Google Fonts is available and the self-containment rules do not apply.

**Wire the colours from the library on the first pass.** The scripts this replaces carried three
divergent hardcoded palettes, none of which matched their own client's recorded tokens — the client
file said `#EA580C` and the animation used `#FF7A00`, and nothing reconciled them. That is the
specific mistake worth not repeating.

## The pipeline

Three stages, each a separate artefact on disk so a failure is visible rather than silent.

**1. The stage.** One HTML file, 1080×1350, his brand, with the elements laid out in their final
position. Animate with CSS keyframes and an `animation-delay` staircase, `forwards` on every one so
each element holds its end state. A reveal of eight rows is eight delays — roughly 0.0, 0.15, 0.6,
1.2, 2.0, 2.6, 3.6, 4.2s. Hold the final frame for a beat at the end.

**2. The frames.** Playwright, Chromium, screenshot per frame.

Drive the clock, do not sleep on it. The scripts this replaces sampled in wall-clock time with
`wait_for_timeout(1000/FPS)`, so screenshot latency drifted the spacing and no two runs matched.
Use `document.getAnimations()` and set `currentTime` per frame instead — deterministic, reproducible,
and faster because it never waits.

Wait for `document.fonts.ready` before the first frame or the first second renders in a fallback
face.

**3. The assembly.** ffmpeg, two-pass palette. This chain is the one genuinely reusable thing in the
scripts this replaces and it is worth keeping verbatim:

```
fps=10,scale=540:-1:flags=lanczos,split [a][b];
 [a] palettegen=max_colors=64:stats_mode=full [p];
 [b][p] paletteuse=dither=bayer:bayer_scale=5
```

MP4 alongside: `libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart`, with
`scale=trunc(iw/2)*2:trunc(ih/2)*2` because h264 refuses odd dimensions.

**LinkedIn plays MP4 and does not autoplay GIF well. Give him both and say the MP4 is the one to
upload.**

## What it needs on the machine

`ffmpeg` on PATH, and Playwright with Chromium installed. Neither is in `requirements` anywhere and
both are undeclared in the repo this technique came from. Check for them first and say which is
missing rather than failing halfway through a frame loop.

## The rules that still apply

Everything in `visual_brand` about naming, and the composite test. A moving image is no less
identifying than a still, and it is harder to check because a name can appear for half a second in
the middle. **Check every frame's text in the HTML source, not in the output.**

And the content rule: every number that moves has to trace to the moment. An animated figure is the
most persuasive thing this system can produce, which is exactly why an invented one would be the
worst.

## Hand it over honestly

Report: where the files are, which to upload, that it is not attached to any post, and that nothing
in the system will remind him it exists.
