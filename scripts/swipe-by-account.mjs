#!/usr/bin/env node
/**
 * The swipe file, reorganised by whose post it was.
 *
 *   node scripts/swipe-by-account.mjs
 *
 * WHY THIS IS A SEPARATE VIEW AND NOT A SECOND HARVEST
 *
 * `docs/to-josh/hook-swipe-file.md` is the record of what was taken on 2 November 2026: the
 * openings picked out of the sentinel accounts, ranked within each author so follower counts
 * cannot order the file. It is grouped by SHAPE, because the point of sending it to Josh is "here
 * are six ways to open and what each does above the fold".
 *
 * That grouping is the wrong one for checking coverage. "Which accounts did this come from, and
 * how many from each" cannot be read off it, and the account is only visible inside a URL.
 *
 * So this reads that file and regroups it. It is a VIEW, not a re-harvest: parsing the artefact
 * rather than re-reading the caches is deliberate, because a second read could disagree with what
 * was actually sent and the whole purpose here is to verify what was sent.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * Both paths are arguments so the completeness guard below can be exercised against a doctored
 * copy of the source. A guard nobody has watched fail is a guard nobody knows works, and this one
 * was added only after the first version of this parser silently dropped 32 of 196 openings.
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SRC = arg("source", join(ROOT, "docs", "to-josh", "hook-swipe-file.md"));
// Named as Josh's copy is named, so regenerating overwrites that file rather than quietly
// producing a second one beside it that disagrees with it.
const OUT = arg("out", join(ROOT, "docs", "verify", "Hooks used for Josh.md"));

const lines = readFileSync(SRC, "utf8").split("\n");

/**
 * `- ▮▮▯ · 11w · ×10.4  — the hook`, with the URL on the line beneath.
 *
 * The multiple is optional, and so is the overflow suffix — an opening that needs more than the
 * three visible lines is written `▮▮▮ +2`, with a SPACE. A `\S+` for the bars silently dropped all
 * 32 of those, which are the LONGEST openings in the file (up to 45 words) and therefore exactly
 * the ones Josh was complaining about on 30 October. Losing them would have left a swipe file that
 * quietly argued every good hook is short.
 */
const ENTRY = /^- ([▮▯]+(?: \+\d+)?) · \s*(\d+)w(?: · ×([\d.]+))?\s+— (.+)$/;
const URL_LINE = /^\s*<(https?:\/\/[^>]+)>\s*$/;

const rows = [];
let shape = null;

for (let i = 0; i < lines.length; i++) {
  const heading = lines[i].match(/^## (.+?)(?:\s+\(\d+\))?$/);
  if (heading && !/^Read this|^What the preview/.test(heading[1])) {
    // "Number claim — a real figure of theirs, up front" -> "Number claim"
    shape = heading[1].split("—")[0].trim();
    continue;
  }

  const m = lines[i].match(ENTRY);
  if (!m) continue;
  const [, bars, words, mult, hook] = m;

  const urlMatch = (lines[i + 1] ?? "").match(URL_LINE);
  const url = urlMatch ? urlMatch[1] : null;

  // The handle is the path segment after /posts/, before the first underscore.
  const handle = url
    ? (url.match(/linkedin\.com\/posts\/([^_/?]+)/) ?? [])[1] ?? "unknown"
    : "unknown";

  rows.push({ handle, shape, bars, words: Number(words), mult: mult ? Number(mult) : null, hook, url });
}

if (!rows.length) {
  console.error("\n  Parsed nothing out of " + SRC + ". The format has changed.\n");
  process.exit(1);
}

/*
 * AND REFUSE TO WRITE A PARTIAL VIEW.
 *
 * The first version of this parser silently dropped 32 of the 196 openings, because the overflow
 * suffix is written "▮▮▮ +2" with a space and the bars were matched with \S+. It reported "164
 * hooks" in a confident tone and nothing said the other 32 were missing — the defect this
 * repository keeps finding, reproduced in the tool built to check for it.
 *
 * So the count is asserted against the source rather than trusted. If they ever disagree again,
 * this stops instead of writing a file that looks complete.
 */
const candidates = lines.filter((l) => /^- [▮▯]/.test(l)).length;
if (rows.length !== candidates) {
  console.error(
    "\n  REFUSING: parsed " + rows.length + " of " + candidates + " openings in the source.\n" +
      "  " + (candidates - rows.length) + " did not match the entry pattern, so this view would " +
      "be incomplete\n  while reading as though it were not. Fix the pattern, do not ship the gap.\n",
  );
  process.exit(1);
}

const missingUrl = rows.filter((r) => !r.url).length;

const byHandle = {};
for (const r of rows) (byHandle[r.handle] ??= []).push(r);
const handles = Object.keys(byHandle).sort((a, b) => byHandle[b].length - byHandle[a].length);

const out = [];
out.push("# The hooks taken on 2 November 2026, by account");
out.push("");
out.push("**" + rows.length + " openings from " + handles.length + " accounts.** A view of " +
  "`docs/to-josh/hook-swipe-file.md`, regrouped so coverage per account can be read. Regenerate " +
  "with `node scripts/swipe-by-account.mjs`; nothing reads this file.");
out.push("");
out.push("Drawn from 839 posts that pass Josh's own hook rules, ranked within each author so a " +
  "large account and a small one are comparable. `×n` is reactions against that author's own " +
  "median post. `▮▮▯` is how many of the three lines visible before \"see more\" the opening " +
  "itself uses, simulated at 42 characters a line and **never calibrated against a real phone**.");
out.push("");
out.push("## Before you use any of this");
out.push("");
out.push("**These are other people's words and they are NOT in `reference_shingles`.** " +
  "`create_draft` refuses a draft sharing a seven-word run with Josh's eight reference writers, " +
  "which is what makes clause 8.3 real. None of these accounts is among those eight, so a draft " +
  "that lifted a line from here would not be refused. Take the move, never the sentence.");
out.push("");
if (missingUrl) {
  out.push("> " + missingUrl + " of the " + rows.length + " entries carry no post URL in the " +
    "source file, so their account could not be identified and they are listed under `unknown`.");
  out.push("");
}

out.push("## Coverage");
out.push("");
out.push("| account | hooks |");
out.push("|---|---|");
for (const h of handles) out.push("| " + h + " | " + byHandle[h].length + " |");
out.push("");

for (const h of handles) {
  const mine = byHandle[h].slice().sort((a, b) => (b.mult ?? -1) - (a.mult ?? -1));
  out.push("---");
  out.push("");
  out.push("## " + h + "  (" + mine.length + ")");
  out.push("");
  for (const r of mine) {
    out.push("**" + r.hook + "**");
    out.push("");
    out.push("- shape: " + (r.shape ?? "?") + " · fold: `" + r.bars + "` · " + r.words + " words" +
      (r.mult != null ? " · ×" + r.mult + " that author's median" : " · no reactions recorded"));
    out.push("- post: " + (r.url ? "<" + r.url + ">" : "_no URL in the source file_"));
    out.push("");
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out.join("\n") + "\n");

console.log("\n  " + rows.length + " hooks, " + handles.length + " accounts, " +
  (rows.length - missingUrl) + " with a post URL");
console.log("  written: " + OUT.replace(ROOT, "."));
console.log("\n  hooks per account:");
for (const h of handles) console.log("    " + String(byHandle[h].length).padStart(3) + "  " + h);
console.log("");
