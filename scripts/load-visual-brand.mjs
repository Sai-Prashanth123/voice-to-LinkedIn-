#!/usr/bin/env node
/**
 * The visual brand section (clause 10.3).
 *
 *   node scripts/load-visual-brand.mjs           # show what would change
 *   node scripts/load-visual-brand.mjs --apply   # write it
 *
 * WHY THIS ONE IS DIFFERENT FROM THE OTHER TEN
 *
 * Josh sent nothing for it. His document has one sentence about images and no brand at all — no
 * colours, no type, no shapes. The placeholder that has been sitting here said, correctly, that "a
 * wrong brand looks worse than no brand, and an invented one is worse still", and that remains
 * true: NOTHING BELOW CLAIMS TO BE HIS BRAND.
 *
 * What it does instead is three things that are true whether or not he ever fills it in.
 *
 * 1. IT CARRIES THE ONE RULE HE DID GIVE US, TO THE ONLY READER THAT CANNOT OTHERWISE HEAR IT.
 *
 *    Josh wrote: "The naming rule above applies to anything visible in the image too." That rule
 *    lives in `gate_rules`. `gate_rules` is not in VISUAL_SECTIONS — the SVG generator is shown
 *    core_rules, visual_brand and audience, and nothing else. handlers/visual.ts contains no name
 *    screening of its own (grep for name/clear/redact/gate returns nothing). And the eight gate
 *    checks judge the draft BODY; `visuals` is a separate table and no check reads svg_body.
 *
 *    So today a rebuilt diagram could carry a client's name straight out of the source image and
 *    every check in the system would pass. This section is the only place that rule reaches that
 *    prompt without changing shared code.
 *
 * 2. IT DEFINES THE DEFAULT THAT WAS PROMISED AND NEVER SPECIFIED.
 *
 *    VISUAL_SYSTEM says: "If the brand has not been supplied yet, use a restrained neutral palette
 *    and say so in your notes." "Restrained neutral palette" is not a specification. Two runs of
 *    the same moment produce two different greys, and 10.6 offers Josh another version — which is
 *    meant to be a different LAYOUT, not a different identity. Naming the default makes the output
 *    reproducible. It is a default, explicitly labelled as one, not a claim about him.
 *
 * 3. IT CONSTRAINS WHAT AN SVG ON LINKEDIN HAS TO SURVIVE.
 *
 *    Legibility on a phone, no external fonts, no gradients that die on a dark background. These
 *    are properties of the medium, not of Josh, so they can be stated now and stay true after he
 *    fills the rest in.
 *
 * THE CODE-LEVEL FIX, NAMED AND NOT MADE
 *
 * The durable fix for (1) is adding "gate_rules" to VISUAL_SECTIONS in _shared/views.ts. That is
 * one line. It is not made here for the same reason the parsePromptSet fix was not: views.ts is
 * bundled into all ten Edge Functions, and ten redeploys cannot be verified while S0-01 and S0-02
 * are blocked for want of a SUPABASE_ACCESS_TOKEN. A one-line change to the file that decides what
 * every prompt in the system can see is not a change to ship blind.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const VISUAL_BRAND = `# Visual brand

**STARTER — written by Thought Pilot. Josh has supplied no brand, and none is invented below.**

Two things are in here. The first is a rule of yours that has to live in this section for a
technical reason. The second is a DEFAULT — the specific restrained palette used when no brand has
been given, so that two rebuilds of the same idea look the same as each other rather than merely
both looking inoffensive. It is not a guess at your identity, and replacing it costs you five
minutes: see "What only you can fill in" at the bottom.

---

## The naming rule, applied to images

Your words, from *Reference library inputs* v1.0:

> "The naming rule above applies to anything visible in the image too."

Stated here in full, because this section is the only part of the reference library the image
generator is shown that can carry it.

**Nothing identifying may appear anywhere in a rebuilt image.** Not in a label, an axis, a legend, a
caption, a logo, a watermark, a URL, an email address, a chart title, or a row of a table.

- No company name, product name or person's name that is not cleared for that specific post.
- No client logo, and no shape or colour scheme that stands in for one.
- No dashboard chrome that identifies the tool it was screenshotted from.
- No figure, niche or timeline combination that identifies a company to someone in that market —
  the same standard the post itself is held to. Removing the name is not anonymising.

Use the shape instead: "a vertical SaaS company", "a compliance platform", "a team of forty".

**Where a diagram cannot make its point without something identifying, produce no image.** A post
with no picture is a normal outcome. A post with a picture that names a client is the failure that
costs the client rather than the post.

---

## The default palette

Used when no brand has been supplied — which is now. Say so in the notes, as the prompt already
requires.

| Role | Hex | Where it goes |
|---|---|---|
| Ground | \`#FAFAF8\` | The canvas. Warm off-white, not pure white, which glares in a dark feed. |
| Ink | \`#1A1A1A\` | All body text and labels. Near-black, never pure black. |
| Muted | \`#6B6B6B\` | Secondary labels, axis text, anything subordinate. |
| Rule | \`#D8D8D4\` | Dividers, borders, gridlines. |
| Accent | \`#2F5D50\` | One accent only. A deep green. The single element being emphasised. |

**One accent per image, and it marks exactly one thing.** The moment a second colour is
load-bearing, the diagram is doing two jobs and should be two diagrams or none.

No gradients. No drop shadows. No glows. No colour used to decorate rather than to distinguish.

## Type

The SVG carries no external fonts, so the stack has to be one that resolves everywhere:

\`font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"\`

Sans-serif throughout. Two weights at most — regular and semibold. Never italic for emphasis;
weight or colour does that job. Sentence case for labels, never all-caps.

## Shape and density

- **Square corners**, or a radius small enough to read as square (2px at a 1200px viewBox).
- **Outlined, not filled.** A 1.5px rule in Rule grey. Fill only the one element the accent marks.
- **Six labelled elements maximum.** If the idea needs more than six boxes, it is an idea for the
  post body, not for a picture.
- **Arrows are allowed** where they carry direction or sequence, and not as decoration. Plain
  single-headed, same stroke as the boxes.
- **Generous margins.** At least 8% of the viewBox on every side. Cramped reads as cheap.

## What it has to survive

LinkedIn renders a feed image a few hundred pixels wide on a phone, so these are hard floors, not
preferences.

- Build at a **1200×1200 viewBox**. Square takes the most feed height available.
- **No text below 28px** at that viewBox. Anything smaller is gone on a phone.
- **Legible in greyscale.** If removing the accent colour destroys the meaning, the meaning was
  carried by colour alone, and it fails for anyone who cannot see it.
- **Readable on both a light and a dark feed.** The explicit Ground rectangle must cover the whole
  viewBox — an SVG with a transparent background inherits the reader's theme and the near-black ink
  vanishes.

## Never

Gradients · drop shadows · glows · bevels · clip art · stock icons · emoji · photographic textures ·
3D perspective · more than one accent colour · text set in all-caps · italic for emphasis · a
watermark or signature · a logo of any kind, including his own unless he asks for it.

---

## What only you can fill in, Josh

Five answers replace everything above the "Never" list, and each is one line.

1. **Colours.** Hex codes if you have them. Which is the accent, which is the ground, what never
   appears.
2. **Type.** The typeface, or a plain description — "a grotesque, nothing with serifs".
3. **Shape.** Square corners or round. Lines or blocks. Filled or outlined.
4. **Density.** Four labelled boxes, or twelve. Whether arrows are allowed.
5. **What you would never post.** Say it and it will not appear.

If you have a deck, a one-pager or a site with the colours already on it, sending that is faster
than answering these — we can read the hex codes off it.

**The naming rule at the top stays whatever you decide about the rest.**`;

/* ── Applying ─────────────────────────────────────────────────────────────── */

function credentials() {
  let file = "";
  try {
    file = readFileSync(join(ROOT, "eval", ".env"), "utf8");
  } catch { /* environment only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  const key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or fill in eval/.env.");
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

const APPLY = process.argv.includes("--apply");

async function main() {
  const { url, key } = credentials();
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  const [current] = await (await fetch(
    url + "/rest/v1/library_sections?select=version,body&key=eq.visual_brand",
    { headers },
  )).json();

  console.log("\n  Visual brand — starter, 7 September 2026\n");
  console.log("  " + "─".repeat(70));
  console.log("  visual_brand   " + String(current?.body?.length ?? 0).padStart(6) + " -> " +
    String(VISUAL_BRAND.length).padStart(6) + " chars   v" + current?.version);

  // The section is only worth writing if it actually reads as supplied afterwards. It contains
  // `---` dividers, so a leftover placeholder head would make isSupplied() return true for the
  // wrong reason — it would be reporting the appended-content rule, not real content.
  const placeheld = /DELIBERATELY EMPTY/.test(VISUAL_BRAND) ||
    /^#[^\n]*\n+\s*FOR JOSH\b/.test(VISUAL_BRAND);
  if (placeheld) {
    console.error("\n  Still reads as a placeholder. Refusing to write it.\n");
    process.exit(1);
  }

  // The rule this section exists to deliver. If it is ever edited out, the SVG generator loses the
  // only naming constraint it can see, and nothing downstream would notice.
  for (const required of ["naming rule", "cleared for that specific post", "produce no image"]) {
    if (!VISUAL_BRAND.includes(required)) {
      console.error("  the naming rule is incomplete — missing: " + required);
      process.exit(1);
    }
  }
  console.log("  carries the naming rule, and does not read as a placeholder");

  if (!APPLY) {
    console.log("\n  Dry run. Nothing written. Re-run with --apply.\n");
    return;
  }

  const res = await fetch(url + "/rest/v1/library_sections?key=eq.visual_brand", {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ body: VISUAL_BRAND }),
  });
  if (!res.ok) {
    console.error("  failed: " + res.status + " " + (await res.text()).slice(0, 300));
    process.exit(1);
  }

  const [after] = await (await fetch(
    url + "/rest/v1/library_sections?select=version,body&key=eq.visual_brand",
    { headers },
  )).json();
  const ok = after?.body?.trim() === VISUAL_BRAND.trim();
  console.log("\n  " + "─".repeat(70));
  console.log(ok ? "  Written and read back. Now v" + after.version + ".\n" : "  !! did not take\n");
  if (!ok) process.exitCode = 1;
}

await main();
