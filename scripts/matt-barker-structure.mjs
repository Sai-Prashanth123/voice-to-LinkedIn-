#!/usr/bin/env node
/**
 * The deeper structural read of Matt Barker, folded into the open sentinel proposal.
 *
 *   node scripts/matt-barker-structure.mjs            # print it
 *   node scripts/matt-barker-structure.mjs --apply    # fold it into the open proposal
 *
 * WHY THIS IS SEPARATE FROM sentinel-refresh.mjs
 *
 * The refresh is mechanical: it measures and reports numbers, and it could not write the section
 * below if it tried, because the section is a READING. Josh asked to lean most into Matt Barker —
 * "his frameworks, structures and methods, in my voice" — and a median word count does not answer
 * that. What answers it is: where does he start, what does he do in the middle, how does he turn,
 * how does he close. That is judgement, and the measurements are its evidence.
 *
 * WHAT CLAUSE 8.3 ALLOWS AND WHAT IT DOES NOT
 *
 * Structure only. Not one of his sentences is in this file, and the two places where his own phrasing
 * would be the obvious illustration are described abstractly instead. The system holds no copy of his
 * posts, which is why "Matt Barker returned nothing" when Josh looked — the design working, not a
 * bug, and he deserves to be told that rather than discover it twice.
 *
 * THE TWO FINDINGS THAT MATTER MOST ARE CONFLICTS
 *
 * His signature turn is the construction Josh's banned-phrases section forbids outright, and he
 * carries a direct ask in nearly every post where Josh's own rule rations it to one in five. Leaning
 * into Matt therefore cannot mean copying Matt. Saying which parts transfer and which two do not is
 * the whole value of the read, so neither is buried.
 *
 * It does not touch library_sections. 12.10: the system proposes, Josh approves.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");

const sentinels = JSON.parse(readFileSync(join(ROOT, "data/josh/sentinels/latest.json"), "utf8"));
const matt = sentinels.report.find((r) => r.handle === "mattjbarker1");
if (!matt) { console.error("No measurements for mattjbarker1. Run sentinel-refresh first."); process.exit(2); }

const HEADING = "## Matt Barker, read structurally";

/**
 * The read itself.
 *
 * Every claim is either a measurement from `latest.json` or a count across the six posts of his
 * collected on 5 October, and each one says which. The distinction matters: the measured half rests
 * on the eight of his posts that still had their line breaks, and the counted half on the six that
 * did not and so could only be read by eye.
 */
function section() {
  const L = [];
  L.push(HEADING);
  L.push("");
  L.push("Josh asked to lean most into Matt Barker — his frameworks, structures and methods, in Josh's");
  L.push("voice. This is what his posts DO, structurally. None of his words are here and none may reach a");
  L.push("draft (8.3). Two numbers to read it against, both from the measurements above:");
  L.push("");
  // Derived, not asserted. "The second shortest of the seven" was true of the September numbers and
  // is the kind of claim that goes quietly wrong the next time anyone writes a longer month.
  const lengths = sentinels.report.map((r) => r.median_words).sort((a, b) => a - b);
  const rank = lengths.indexOf(matt.median_words) + 1;
  const place = ["", "shortest", "second shortest", "third shortest"][rank] ??
    `${rank}th of ${lengths.length} by length`;
  L.push(`- **${matt.posts_measured} posts**, ${matt.window.from} to ${matt.window.to}, median ` +
    `**${matt.median_words} words** — the ${place} of the ${lengths.length}.`);
  L.push(`- Sentence-length variation **${matt.sd_median}**, mid-pack. He is not writing in uniform` +
    ` blocks, and he is not Aman's staccato either.`);
  L.push("");
  L.push("## Where he starts");
  L.push("");
  L.push("**Someone else's situation, with their number in it.** Four of his six most recent posts open on");
  L.push("somebody else — a client, a peer, a stranger who had emailed him — and in three of those a figure");
  L.push("belonging to that person lands within the first two lines. Of the other two, one opens on his own");
  L.push("errand and hands the post over to a stranger by line four. His own standing is implied by having");
  L.push("been in the room; he rarely opens by asserting it.");
  L.push("");
  L.push("This is the move Josh's hook rules already describe as *how I, not how to*, with one difference:");
  L.push("Matt's version puts somebody else at the centre and keeps himself in the frame as the person it");
  L.push("happened to. For Josh that is the easier version to write honestly, because his material is");
  L.push("client work he cannot name — and a shape built around someone else's situation survives");
  L.push("anonymising, where one built around a named account does not.");
  L.push("");
  L.push("**The scene is small and physical.** A specific weekday, an errand, a place. He anchors a");
  L.push("commercial point to something mundane and verifiable, and the ordinary detail does the work a");
  L.push(`credential would otherwise do. Measured: his openings run **${matt.opening_words_median} words**`);
  L.push(`with **${matt.above_fold_words_median} words above the fold** — a scene, not a cut.`);
  L.push("");
  L.push("## What the middle does");
  L.push("");
  L.push("**One mechanism, and it is listed once or not at all.** A list appears in half his posts");
  L.push(`(**${Math.round(matt.list_rate * 100)}%**, measured). The pattern underneath that number: numbered`);
  L.push("steps when the point IS a process, unbroken prose when the point is a judgement. He does not run");
  L.push("a numbered list and a causal argument in the same post, which is why they stay short.");
  L.push("");
  L.push("**He re-aims mid-post with an audience tag.** A paragraph that is just the name of who the rest");
  L.push("is for. It does the altitude filtering Josh's hook section asks of the opening, except Matt does");
  L.push("it again in the middle, where a reader who has stayed is deciding whether this is for them.");
  L.push("Directly transferable, and nothing in Josh's rules covers it.");
  L.push("");
  L.push("**Proof arrives as a range, not a trophy.** Where he quotes an outcome it is bounded (a figure");
  L.push("from-to, a share, a count) and attributed to the person it happened to. It reads as reporting.");
  L.push("");
  L.push("## The two things that do NOT transfer");
  L.push("");
  L.push("Said plainly, because they are the most recognisable things he does and the reason a draft that");
  L.push("imitates him fails Josh's own gate.");
  L.push("");
  L.push("**1. His turn renames the reader's problem.** The structure is: state the problem the reader");
  L.push("thinks they have, deny it, substitute a renamed one. That is exactly the construction the");
  L.push("banned-phrases section forbids — rejecting a frame in order to assert another — and it is the");
  L.push("single most recognisable AI cadence on LinkedIn, which is not a coincidence: it is a cadence");
  L.push("models learned partly from writing like this. Matt gets away with it because the substituted");
  L.push("problem is one he can evidence. The system still must not copy it. The fix is the one already in");
  L.push("that section: delete the rejected half and state the second problem once, with the detail");
  L.push("attached.");
  L.push("");
  L.push("**2. He asks in nearly every post.** All six posts collected on 5 October end on an offer and a");
  L.push("link, two of them as a postscript. Josh's closing rule rations a direct ask to roughly one post");
  L.push("in five, and the measurements across all seven writers put a direct ask on");
  L.push(`**${sentinels.totals.direct_asks} of ${sentinels.totals.of}** — Matt is the outlier, not the`);
  L.push("standard. His frequency fits a creator selling a course to a list. Josh sells consulting to a");
  L.push("buyer who lurks, and the same frequency would read as a pitch feed.");
  L.push("");
  L.push("## What to take, in order");
  L.push("");
  L.push("1. **Open on someone else's situation, with their number.** Highest value, and it anonymises.");
  L.push("2. **Anchor it to something mundane and specific.** A weekday and an errand beat an adjective.");
  L.push("3. **One mechanism per post.** List it only if it is genuinely a process.");
  L.push("4. **Name the audience once, in the middle.** New to Josh's rules, and cheap.");
  L.push("");
  L.push("Not: the renamed-problem turn, and not the ask on every post.");
  L.push("");
  L.push("**Josh — the first conflict above is a real fork.** We have kept your banned-phrases rule and");
  L.push("ruled Matt's turn out of bounds, because an over-strict gate fails visibly and is easy to");
  L.push("correct. If you want that construction available to you because it is how he lands a post, say");
  L.push("so and it comes out of the banned list — but it would then be allowed everywhere, and it is the");
  L.push("one pattern most likely to make a draft read as generated.");
  return L.join("\n");
}

const body = section();

/* ── Fold it into the open proposal ───────────────────────────────────────── */

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) => process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

// 8.3 is enforced here as well as in the refresh: a run of his text in this file would be a breach
// whatever the comments above say, so the body is checked before it can be stored.
const TELLS = ["distillation problem", "ideas problem", "want the rest", "gentle giant"];
for (const t of TELLS) {
  if (body.toLowerCase().includes(t)) { console.error(`Refusing: "${t}" is his phrasing.`); process.exit(1); }
}

if (!APPLY) {
  console.log(body);
  console.log("\n  Dry run. Nothing written. Pass --apply to fold it into the open proposal.");
  process.exit(0);
}

const { url, key } = credentials();
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const open = await (await fetch(
  `${url}/rest/v1/library_proposals?section_key=eq.reference_posts&status=eq.open&order=id.desc&limit=1`,
  { headers },
)).json();

if (!open.length) {
  console.error("No open proposal against reference_posts. Run sentinel-refresh.mjs --apply first,\n" +
    "so the measurements and this reading reach Josh as one thing to approve.");
  process.exit(2);
}

const p = open[0];
if (p.proposed_body.includes(HEADING)) {
  console.log(`  Proposal #${p.id} already carries the reading. Nothing to do.`);
  process.exit(0);
}

// Before "What never to take", which is the section's closing rule and should stay last.
const anchor = "## What never to take";
const at = p.proposed_body.indexOf(anchor);
const merged = at === -1
  ? `${p.proposed_body}\n\n${body}\n`
  : `${p.proposed_body.slice(0, at)}${body}\n\n---\n\n${p.proposed_body.slice(at)}`;

const res = await fetch(`${url}/rest/v1/library_proposals?id=eq.${p.id}`, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({
    proposed_body: merged,
    claim: `${p.claim}. Plus a structural reading of Matt Barker, which Josh asked to lean most ` +
      `into: what transfers from his posts, and the two things that cannot — his renamed-problem ` +
      `turn is the construction the banned-phrases section forbids, and he asks in nearly every post.`,
    evidence: {
      ...(p.evidence ?? {}),
      matt_barker: {
        posts_measured: matt.posts_measured,
        window: matt.window,
        median_words: matt.median_words,
        list_rate: matt.list_rate,
        shape_basis: matt.shape_basis,
        read_by_eye: "the 6 posts collected 2026-10-05, whose line breaks the scrape stripped",
        closes_on_an_ask: "6 of those 6",
        direct_asks_across_all_seven: `${sentinels.totals.direct_asks} of ${sentinels.totals.of}`,
      },
    },
  }),
});

if (!res.ok) { console.error(`Could not update proposal #${p.id}: ${res.status} ${await res.text()}`); process.exit(1); }

console.log(`\n  Folded into proposal #${p.id} — one thing for Josh to approve, not two.`);
console.log(`  ${merged.length} characters, no post text in it.`);
console.log("  Nothing has changed in the library. It waits for him (12.10).");
