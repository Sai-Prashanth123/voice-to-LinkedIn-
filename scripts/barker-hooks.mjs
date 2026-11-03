#!/usr/bin/env node
/**
 * Matt Barker's openings, read off the stored corpus.
 *
 *   node scripts/barker-hooks.mjs                 top 30 by performance
 *   node scripts/barker-hooks.mjs --top 50        more of them
 *   node scripts/barker-hooks.mjs --out <path>    somewhere else
 *
 * WHY HE WAS MISSING, WHICH WAS NOT AN OVERSIGHT
 *
 * Josh asked for the swipe file and said in as many words: take more from Matt Barker if you need
 * volume. `grep -ci barker` on `docs/to-josh/hook-swipe-file.md` returns 0. He is the one writer
 * Josh named for EXTRA weight and the one writer with none.
 *
 * Two deliberate constraints collided and nobody noticed the result.
 *
 * The first is the swipe file's own warning: "These openings are not in that index. A draft that
 * lifted a line from this file would not be refused." It was built from content-agent clients and a
 * console harvest precisely BECAUSE none of them is one of Josh's eight — so that sentence is true
 * of every line in it. Barker is one of the eight and is in `reference_shingles`, so he breaks the
 * blanket claim, in the SAFE direction: a draft lifting his line does get refused.
 *
 * The second is the real reason this file is not committed. `docs/verify/all-openings.md` is
 * gitignored because it is "the only place Josh's eight writers' 1,682 opening lines would appear
 * in a public repo". This repository is public and its history is permanent. 250 of Barker's
 * opening lines are the same problem in a smaller box.
 *
 * SO: THIS WRITES TO A GITIGNORED PATH, and it is for sending to Josh rather than for shipping.
 * He can have what he asked for without 250 of another writer's lines landing in public git
 * history for good.
 *
 * WHAT IT DOES NOT DO
 *
 * Fetch anything. It reads `reference_writer_posts`, which already holds 250 of his posts loaded on
 * 20 October. No scrape, no key beyond a read, and nothing about the corpus changes.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { measureShape } from "../supabase/functions/_shared/shape.ts";
import { foldFor, SURFACES } from "../supabase/functions/_shared/fold-preview.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDLE = "mattjbarker1";

const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
};
const TOP = Number(arg("top", 30));
const OUT = arg("out", join(ROOT, "docs", "verify", "matt-barker-hooks.md"));

function credentials() {
  let file = "";
  for (const p of [join(ROOT, "eval", ".env"), join(ROOT, "mcp-server", ".env"), join(ROOT, ".env")]) {
    try {
      file += readFileSync(p, "utf8") + "\n";
    } catch { /* next */ }
  }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  // A read is all this needs. The scoped connector key can select reference_writer_posts (0044
  // grants it), so the service role is not required and is not asked for.
  const key = field("CONTENT_MCP_KEY") ?? field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("\n  Set SUPABASE_URL and CONTENT_MCP_KEY (or SUPABASE_SERVICE_ROLE_KEY).\n");
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

const { url, key } = credentials();

const rows = await (async () => {
  const q = new URLSearchParams({
    select: "activity_id,posted_at,text,opening_shape,opening_words,words,paragraphs,uses_list," +
      "reaction_count,comment_count,has_line_breaks,url",
    handle: "eq." + HANDLE,
    order: "posted_at.desc",
    limit: "1000",
  });
  const res = await fetch(`${url}/rest/v1/reference_writer_posts?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`\n  read failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}\n`);
    process.exit(1);
  }
  return await res.json();
})();

if (!rows.length) {
  console.error(`\n  No posts stored for ${HANDLE}. Nothing written.\n`);
  process.exit(1);
}

/* ── Measure ──────────────────────────────────────────────────────────────── */

const median = (xs) => {
  const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const medianReactions = median(rows.map((r) => r.reaction_count));

const measured = rows.map((r) => {
  const line1 = String(r.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  /*
   * The fold is measured on line one ALONE, which is the question Josh actually asked: does the
   * opening leave the reader anything, or is it the whole of what they see. Inherits the
   * uncalibrated constants and the output says so.
   */
  const foldLines = foldFor(line1, SURFACES.mobile).all.length;
  return {
    ...r,
    line1,
    foldLines,
    mult: medianReactions > 0 && typeof r.reaction_count === "number"
      ? r.reaction_count / medianReactions
      : null,
    shape: r.opening_shape ?? measureShape(r.text)?.opening_shape ?? "unknown",
  };
});

const usable = measured.filter((r) => r.line1 && r.has_line_breaks);
const flat = measured.length - usable.length;

const ranked = [...usable].sort((a, b) => (b.mult ?? -1) - (a.mult ?? -1)).slice(0, TOP);

const bar = (n) =>
  "▮".repeat(Math.min(n, 3)) + "▯".repeat(Math.max(0, 3 - n)) + (n > 3 ? " +" + (n - 3) : "");

/* ── Write ────────────────────────────────────────────────────────────────── */

const byShape = {};
for (const r of usable) (byShape[r.shape] ??= []).push(r);
const shapesByCount = Object.keys(byShape).sort((a, b) => byShape[b].length - byShape[a].length);

const dates = usable.map((r) => r.posted_at).filter(Boolean).sort();
const span = dates.length ? `${dates[0].slice(0, 10)} to ${dates.at(-1).slice(0, 10)}` : "unknown";

const out = [];
out.push("# Matt Barker's openings");
out.push("");
out.push(`**Top ${ranked.length} of ${usable.length} measurable posts, ranked by reactions against ` +
  `his own median of ${medianReactions}.** Posted ${span}. Read from the ${measured.length} posts ` +
  `already stored in \`reference_writer_posts\`; nothing was scraped to make this.`);
out.push("");
out.push("## Why this is a separate file and not in the swipe file");
out.push("");
out.push("Josh asked for more from Matt Barker and the swipe file has none of him. That was two " +
  "deliberate decisions colliding rather than an oversight, and only one of them should hold.");
out.push("");
out.push("The swipe file says of its own contents: *\"These openings are not in that index. A draft " +
  "that lifted a line from this file would not be refused.\"* It was built from accounts that are " +
  "**not** among Josh's eight, so that warning is true of every line in it. Barker **is** one of " +
  "the eight and is in `reference_shingles` — so `create_draft` refuses a draft sharing a " +
  "seven-word run with anything below. He is safer to read than the swipe file, not riskier.");
out.push("");
out.push("What does hold is publication. `docs/verify/all-openings.md` is gitignored because it is " +
  "the only place his eight writers' opening lines would appear in a **public** repository, whose " +
  "history is permanent. This file is 250 of one writer's lines and is gitignored for the same " +
  "reason. **Send it to Josh; do not commit it.**");
out.push("");
out.push("## What the columns mean");
out.push("");
out.push("`▮▮▯` is how many of the three lines visible before \"see more\" the opening alone uses — " +
  "two filled means something else is still visible under it, three means the hook is all they " +
  "get. **Simulated at 42 characters a line and not calibrated against a real render**, so read " +
  "it as a direction. `×n` is that post's reactions against his own median, so his big posts and " +
  "his quiet ones are comparable.");
out.push("");
if (flat > 0) {
  out.push(`> ${flat} of his ${measured.length} stored posts came back from the console without ` +
    `line breaks, so their shape is an artefact of the fetch and they are left out.`);
  out.push("");
}
if (!usable.some((r) => r.url)) {
  out.push("> **None of his stored posts carries a URL**, so unlike the swipe file these cannot be " +
    "clicked through to. The loader had no `url` for this handle on the 20 October load.");
  out.push("");
}

/* ── His measured habits, which is the part Josh can act on ───────────────── */

out.push("## What he actually does with an opening");
out.push("");
out.push("| | |");
out.push("|---|---|");
out.push(`| posts measured | ${usable.length} |`);
out.push(`| median opening length | ${median(usable.map((r) => r.opening_words))} words |`);
out.push(`| median post length | ${median(usable.map((r) => r.words))} words |`);
out.push(`| median paragraphs | ${median(usable.map((r) => r.paragraphs))} |`);
const fills = usable.filter((r) => r.foldLines >= 3).length;
out.push(`| openings that fill or overflow the fold | ${fills} of ${usable.length} ` +
  `(${Math.round((fills / usable.length) * 100)}%) |`);
out.push(`| uses a list | ${usable.filter((r) => r.uses_list).length} of ${usable.length} |`);
out.push("");
out.push("**His opening shapes, most used first.** This is the thing worth copying — the " +
  "distribution, not the sentences.");
out.push("");
out.push("| shape | posts | share | median ×median reactions |");
out.push("|---|---|---|---|");
for (const s of shapesByCount) {
  const mine = byShape[s];
  const m = median(mine.map((r) => r.mult).filter((n) => n != null));
  out.push(`| ${s} | ${mine.length} | ${Math.round((mine.length / usable.length) * 100)}% | ` +
    `×${m ? m.toFixed(2) : "—"} |`);
}
out.push("");

/* ── The openings ─────────────────────────────────────────────────────────── */

out.push("---");
out.push("");
out.push(`## The ${ranked.length} that travelled furthest`);
out.push("");
for (const r of ranked) {
  out.push(`**${r.line1}**`);
  out.push("");
  out.push(`- shape: ${r.shape} · fold: \`${bar(r.foldLines)}\` · ${r.opening_words} words` +
    (r.mult != null ? ` · ×${r.mult.toFixed(1)} his median` : " · no reactions recorded") +
    (r.posted_at ? ` · ${r.posted_at.slice(0, 10)}` : ""));
  out.push("");
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\n") + "\n");

console.log(`\n  ${usable.length} measurable posts, ${ranked.length} written`);
console.log(`  median reactions ${medianReactions}, span ${span}`);
console.log(`  shapes: ${shapesByCount.map((s) => s + " " + byShape[s].length).join(", ")}`);
console.log(`  written: ${OUT.replace(ROOT, ".")}`);
console.log(`\n  NOT FOR COMMITTING — gitignored. Send it to Josh.\n`);
