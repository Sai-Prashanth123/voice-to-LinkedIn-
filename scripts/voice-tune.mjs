#!/usr/bin/env node
/**
 * voice-tune — make the voiceprint learn, so steering compounds instead of resetting.
 *
 *   node scripts/voice-tune.mjs show
 *   node scripts/voice-tune.mjs from-outcomes [--apply]
 *   node scripts/voice-tune.mjs ban <word...>
 *   node scripts/voice-tune.mjs unban <word...>
 *   node scripts/voice-tune.mjs signature <term...>
 *   node scripts/voice-tune.mjs directive "<text>"
 *
 * THE MODEL THIS FOLLOWS
 *
 * `D:\content-agent\content-agent\scripts\voice_tune.py` — "Persist voice corrections into a
 * client's voiceprint + law, so steering compounds instead of resetting each session." Its
 * `from-feedback` subcommand mines a feedback log for words humans repeatedly cut or added and
 * promotes them into the voiceprint, with the evidence recorded.
 *
 * THE SIGNAL HERE IS BETTER THAN A FEEDBACK LOG, AND IT ALREADY EXISTS
 *
 * This system does not need a human to remember to log a correction. Clause 12.2 already captures
 * the strongest possible version of one: the draft the system wrote, and the text Josh actually
 * published. The difference between those two IS the correction, recorded automatically, with no
 * chance of anyone forgetting.
 *
 * `worker-learn`'s own prompt says the same thing: "The strongest signal available is the
 * difference between what was drafted and what he actually published. Engagement numbers are the
 * weakest — they cannot tell you whether a post sounded like him."
 *
 * WHAT IT WILL DO TODAY: NOTHING, HONESTLY
 *
 * No post has been approved or published, so there are zero diffs to learn from. This is built now
 * rather than later on purpose — a learning loop written the week it first matters is a learning
 * loop debugged against the only data anyone cares about. It reports the emptiness plainly instead
 * of inventing a finding.
 *
 * TWO DESTINATIONS, AND ONLY ONE OF THEM IS AUTOMATIC
 *
 *   data/josh/law/voiceprint.json   written directly. Files may drift; that was the arrangement.
 *   library_proposals               PROPOSED. Clause 12.10 — the system never changes the library
 *                                   on its own, and this is not the place to start.
 *
 * MANUAL EDITS SURVIVE RECOMPUTE
 *
 * Everything this writes goes into a `manual` block that `build-voiceprint.mjs` carries forward
 * untouched. Without that, a correction Josh made would silently vanish the next time the
 * fingerprint was recomputed from the transcripts — which is the failure that makes people stop
 * bothering to correct anything.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tokens } from "./lib/prose.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRINT = join(ROOT, "data", "josh", "law", "voiceprint.json");

const [, , command, ...rest] = process.argv;
const APPLY = rest.includes("--apply");
const args = rest.filter((a) => !a.startsWith("--"));

/* ── The voiceprint file ──────────────────────────────────────────────────── */

const EMPTY_MANUAL = { banned: [], signature: [], directives: [], learned: [] };

function load() {
  if (!existsSync(PRINT)) {
    console.error("\n  No voiceprint yet. Run: node scripts/build-voiceprint.mjs --apply\n");
    process.exit(1);
  }
  const vp = JSON.parse(readFileSync(PRINT, "utf8"));
  vp.manual = { ...EMPTY_MANUAL, ...(vp.manual ?? {}) };
  return vp;
}

function save(vp) {
  vp.manual.updated_at = new Date().toISOString();
  writeFileSync(PRINT, JSON.stringify(vp, null, 2) + "\n");
}

/** Case-insensitive, order-preserving, no duplicates. */
function addAll(list, items) {
  const seen = new Set(list.map((x) => (typeof x === "string" ? x : x.word).toLowerCase()));
  let added = 0;
  for (const raw of items) {
    const w = raw.trim().toLowerCase();
    if (!w || seen.has(w)) continue;
    list.push(w);
    seen.add(w);
    added += 1;
  }
  return added;
}

/* ── from-outcomes: the learning loop ─────────────────────────────────────── */

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

/**
 * Grammar, not vocabulary. A word here being cut says nothing about his voice.
 *
 * This list exists because the first version did not have one and was wrong about why it did not
 * need one. The reasoning was: "a word that appears NOWHERE in what he published is a decision, and
 * function words almost never survive that test because he rarely removes every one."
 *
 * Tested against three short draft/published pairs, it returned `leverage(3)` and `unlock(2)` —
 * correct, those are the AI tells — alongside `to(2)` and `and(2)`. Shortening a sentence removes
 * every "to" in it often enough to matter. On a 200-word post it would be rarer, not absent, and
 * "Josh has banned the word 'and'" is the kind of finding that discredits the whole mechanism.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "as", "at", "by", "for",
  "from", "in", "into", "of", "on", "onto", "to", "up", "with", "without", "is", "are", "was",
  "were", "be", "been", "being", "am", "do", "does", "did", "have", "has", "had", "will", "would",
  "can", "could", "should", "may", "might", "must", "this", "that", "these", "those", "it", "its",
  "we", "our", "us", "i", "my", "me", "you", "your", "he", "she", "they", "them", "their",
  "there", "here", "what", "when", "where", "which", "who", "how", "why", "not", "no", "all",
  "any", "some", "more", "most", "very", "just", "also", "too", "out", "over", "about",
]);

/**
 * Words Josh removed completely, and words he added completely.
 *
 * WHY "COMPLETELY" AND NOT A FREQUENCY DELTA
 *
 * Counting how often a word got rarer would rank by how much he shortened the post rather than by
 * what he objected to. A word that appeared in the draft and appears NOWHERE in what he published
 * is a decision about that word.
 *
 * It is a blunt instrument on a single post. Across several, filtered, it is the sharpest signal
 * this system has — and unlike a feedback log, nobody has to remember to write it down.
 */
function wordDelta(draft, published) {
  const before = new Set(tokens(draft));
  const after = new Set(tokens(published));
  const real = (w) => !FUNCTION_WORDS.has(w) && w.length > 2;
  return {
    cut: [...before].filter((w) => !after.has(w) && real(w)),
    added: [...after].filter((w) => !before.has(w) && real(w)),
  };
}

async function fromOutcomes() {
  const { url, key } = credentials();
  const H = { apikey: key, Authorization: "Bearer " + key };

  const res = await fetch(
    url + "/rest/v1/outcomes?select=post_id,moment_id,draft_body,published_body,approved_body," +
      "edit_ratio,edit_class,edit_stage,verdict,updated_at&order=updated_at.desc&limit=100",
    { headers: H },
  );
  if (!res.ok) { console.error("Could not read outcomes: " + res.status); process.exit(1); }
  const outcomes = await res.json();

  // published_body is only set once LinkedIn has published. approved_body is what Josh signed off,
  // which arrives earlier and is the same correction — 12.2 measures the diff at approval for
  // exactly this reason, so the loop does not wait on a LinkedIn connection.
  const usable = outcomes.filter((o) => o.draft_body && (o.published_body ?? o.approved_body));

  console.log("\n  voice-tune — learning from what Josh actually changed\n");
  console.log("  " + "─".repeat(66));
  console.log(`  ${outcomes.length} outcome row(s), ${usable.length} with both a draft and his version`);

  if (usable.length === 0) {
    console.log("\n  Nothing to learn from yet.");
    console.log("  No draft has been approved or published, so there is no correction to read.");
    console.log("  This is the honest answer, not a failure — the loop runs the moment he approves");
    console.log("  his first post, and 12.2 measures the diff at APPROVAL so it does not wait on");
    console.log("  LinkedIn.\n");
    return;
  }

  const cutIn = new Map(), addedIn = new Map();
  for (const o of usable) {
    const { cut, added } = wordDelta(o.draft_body, o.published_body ?? o.approved_body);
    for (const w of new Set(cut)) cutIn.set(w, (cutIn.get(w) ?? 0) + 1);
    for (const w of new Set(added)) addedIn.set(w, (addedIn.get(w) ?? 0) + 1);
  }

  // Two posts, not one. A word cut from a single post is that post; a word cut from two separate
  // posts is a preference. With a corpus this small the threshold matters more than the maths.
  const THRESHOLD = 2;
  const cutRepeatedly = [...cutIn].filter(([, n]) => n >= THRESHOLD).sort((a, b) => b[1] - a[1]);
  const addedRepeatedly = [...addedIn].filter(([, n]) => n >= THRESHOLD).sort((a, b) => b[1] - a[1]);

  const light = usable.filter((o) => o.edit_class === "light").length;
  console.log(`  ${light} of ${usable.length} needed only light editing (17a wants five of the last six)`);
  console.log(`\n  cut from ${THRESHOLD}+ posts:   ` +
    (cutRepeatedly.map(([w, n]) => `${w}(${n})`).join(", ") || "none"));
  console.log(`  added to ${THRESHOLD}+ posts:  ` +
    (addedRepeatedly.map(([w, n]) => `${w}(${n})`).join(", ") || "none"));

  if (cutRepeatedly.length === 0 && addedRepeatedly.length === 0) {
    console.log("\n  No word crossed the threshold. Proposing nothing is a valid answer.\n");
    return;
  }

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --apply to record these and open a proposal.\n");
    return;
  }

  const vp = load();
  const evidence = {
    kind: "edit_diff",
    posts_compared: usable.length,
    post_ids: usable.map((o) => o.post_id),
    cut: Object.fromEntries(cutRepeatedly),
    added: Object.fromEntries(addedRepeatedly),
  };
  vp.manual.learned.push({ at: new Date().toISOString(), ...evidence });
  addAll(vp.manual.banned, cutRepeatedly.map(([w]) => w));
  addAll(vp.manual.signature, addedRepeatedly.map(([w]) => w));
  save(vp);
  console.log("\n  voiceprint.json updated (manual block, preserved across recompute)");

  // The library half. PROPOSED, never applied — 12.10, and there are four independent mechanisms
  // enforcing that. This is not the place to become the fifth exception.
  if (cutRepeatedly.length === 0) {
    console.log("  Nothing to propose for the library — only additions were learned.\n");
    return;
  }

  const headers = { ...H, "Content-Type": "application/json" };
  const [section] = await (await fetch(
    url + "/rest/v1/library_sections?select=key,body&key=eq.banned_phrases", { headers },
  )).json();

  const addition = "\n\n## Learned from Josh's own edits\n\n" +
    `_Added ${new Date().toISOString().slice(0, 10)} from ${usable.length} post(s) he edited before ` +
    `publishing._\n\n` +
    cutRepeatedly.map(([w, n]) => `- "${w}" — cut from ${n} posts`).join("\n") + "\n";

  const post = await fetch(url + "/rest/v1/library_proposals", {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      section_key: "banned_phrases",
      claim: `${cutRepeatedly.length} word(s) Josh removed from ${THRESHOLD} or more of his own ` +
        `drafts before publishing: ${cutRepeatedly.slice(0, 5).map(([w]) => w).join(", ")}`,
      evidence,
      proposed_body: (section?.body ?? "").trimEnd() + addition,
      status: "open",
    }),
  });
  if (!post.ok) {
    console.error("  proposal failed: " + post.status + " " + (await post.text()).slice(0, 200));
    process.exitCode = 1;
    return;
  }
  const [row] = await post.json();
  console.log(`  proposal #${row.id} opened against banned_phrases`);
  console.log("  Nothing has changed in the library. It waits for Josh (12.10).\n");
}

/* ── Commands ─────────────────────────────────────────────────────────────── */

switch (command) {
  case "show": {
    const vp = load();
    console.log("\n  Voiceprint — Josh Fryszer");
    console.log("  computed " + (vp.computed_at ?? "unknown").slice(0, 10));
    console.log("  " + "─".repeat(60));
    console.log("  corpus       " + vp.corpus?.words?.toLocaleString() + " words of speech, " +
      vp.corpus?.calls + " calls");
    console.log("  rhythm       mean " + vp.rhythm?.sentence_words_mean + "w, sd " +
      vp.rhythm?.sentence_words_sd);
    console.log("  I vs we      " + vp.register?.i_vs_we);
    console.log("\n  manual, preserved across recompute:");
    console.log("    banned     " + (vp.manual.banned.join(", ") || "none"));
    console.log("    signature  " + (vp.manual.signature.join(", ") || "none"));
    console.log("    directives " + (vp.manual.directives.length || "none"));
    for (const d of vp.manual.directives) console.log("      - " + d);
    console.log("    learned    " + vp.manual.learned.length + " round(s) from his edits\n");
    break;
  }

  case "ban": case "unban": case "signature": {
    if (args.length === 0) { console.error("Give at least one word."); process.exit(2); }
    const vp = load();
    const list = command === "signature" ? vp.manual.signature : vp.manual.banned;
    if (command === "unban") {
      const before = list.length;
      vp.manual.banned = list.filter((w) => !args.map((a) => a.toLowerCase()).includes(w));
      console.log(`\n  removed ${before - vp.manual.banned.length} word(s) from the ban list\n`);
    } else {
      const n = addAll(list, args);
      console.log(`\n  added ${n} word(s) to the ${command === "signature" ? "signature" : "ban"} list\n`);
    }
    save(vp);
    break;
  }

  case "directive": {
    if (args.length === 0) { console.error('Give the directive in quotes.'); process.exit(2); }
    const vp = load();
    vp.manual.directives.push(args.join(" "));
    save(vp);
    console.log("\n  directive recorded. It survives the next recompute.\n");
    break;
  }

  case "from-outcomes":
    await fromOutcomes();
    break;

  default:
    console.log(`
  voice-tune — make the voiceprint learn

    show                     what the fingerprint currently says
    from-outcomes [--apply]  learn from what Josh changed before publishing
    ban <word...>            never write this word for him
    unban <word...>
    signature <term...>      this IS his word
    directive "<text>"       a standing instruction about his voice

  Everything written here lands in the 'manual' block and survives
  build-voiceprint.mjs recomputing the rest. Library changes are PROPOSED
  and wait for Josh (12.10).
`);
}
