/**
 * The renderer must hold the faces Josh's brand actually names.
 *
 * WHY THIS FILE EXISTS
 *
 * On 27 October the renderer had no fonts at all, so resvg drew every shape and silently dropped
 * every word while returning a valid PNG. That was fixed by loading DejaVu Sans and failing a
 * render that has text but no font.
 *
 * On 29 October the second half turned up. DejaVu was the ONLY face loaded, and Josh's brand is a
 * serif: four of his visuals ask for `'DM Serif Display', Georgia, serif` and every one of them
 * rasterised in a grotesque. Nothing reported it, and nothing could have — a missing font drops
 * words and is catchable, a wrong font renders every word correctly in the wrong typeface and
 * leaves no trace in the PNG at all.
 *
 * So this asserts the font list against the brand rather than against itself. A face removed here
 * is a face that silently stops appearing in his images, which is exactly the failure that has now
 * happened twice.
 *
 * It deliberately does NOT fetch anything. A test that reaches a CDN fails on a train, and the
 * thing worth pinning is which faces the code asks for, not whether jsDelivr is up today. The
 * fetch, the variable-font handling and the glyph coverage were measured by hand before this list
 * was written: every face rendered differently from the DejaVu baseline, and a control naming a
 * family nobody has rendered byte-identical to it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { FONT_FAMILY, FONT_URLS } from "./handlers/visual.ts";

/** What `visual_brand` names, and what the four visuals on moment 111 actually specify. */
const BRAND_FACES = ["DMSerifDisplay", "DMSans", "JetBrainsMono"];

test("every typeface Josh's brand names is loaded into the renderer", () => {
  const joined = FONT_URLS.join(" ");
  for (const face of BRAND_FACES) {
    assert.ok(
      joined.includes(face),
      `${face} is not in FONT_URLS. His brand names it, so an SVG asking for it will render in ` +
        `whatever resvg falls back to — correctly, in the wrong face, with nothing to say so.`,
    );
  }
});

test("the serif italic is loaded, because resvg will not synthesise one", () => {
  assert.ok(
    FONT_URLS.some((u) => /DMSerifDisplay-Italic/.test(u)),
    "Without the italic file, the green italic line Josh chose on moment 111 renders upright. " +
      "resvg does not slant a regular face to make an italic, and it does not complain either.",
  );
});

test("DejaVu stays, for the glyphs the brand faces do not carry", () => {
  assert.ok(
    FONT_URLS.some((u) => /DejaVuSans\.ttf/.test(u)),
    "DM Sans and DM Serif Display are Latin-only. DejaVu is the per-glyph fallback that keeps an " +
      "arrowhead, an em dash or an accent from vanishing out of an otherwise correct diagram.",
  );
});

test("the font pin is a commit, so a face cannot change under an approved post", () => {
  for (const url of FONT_URLS) {
    if (!url.includes("/gh/google/fonts@")) continue;
    const ref = url.split("/gh/google/fonts@")[1].split("/")[0];
    assert.match(
      ref,
      /^[0-9a-f]{40}$/,
      `google/fonts is pinned to "${ref}", not a commit. On @main or a tag the typeface can change ` +
        `after Josh has approved the image it drew.`,
    );
  }
});

test("the default family is his, not a fallback that belongs to nobody", () => {
  assert.equal(
    FONT_FAMILY,
    "DM Sans",
    "defaultFontFamily is what text gets when it names no family or names one that is absent. " +
      "His body face means unstyled text lands in his brand instead of in DejaVu.",
  );
});
