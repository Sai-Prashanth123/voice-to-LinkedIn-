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
 * REWRITTEN 20 OCTOBER, AND ONE OF ITS CENTRAL CLAIMS WAS WRONG.
 *
 * The first version of this read rested on six of his posts, collected on 5 October, read by eye
 * because their line breaks had been stripped. It said he "asks in nearly every post" and ruled his
 * closing habit out of bounds for Josh on that basis. Measured across 241, he closes on an ask in
 * 22 of them — 9%, against 17% for the other seven and 20% for Josh's own one-in-five rule. He is
 * the most restrained closer of the eight, and the claim was the exact opposite of the truth.
 *
 * What the six showed was a postscript, not an ask: he ends a fifth of his posts with one, five
 * times any other writer here, and a P.S. carrying a link reads as a pitch when you have six posts
 * and as a habit when you have 241.
 *
 * So every number below is now counted from the corpus rather than read off a sample, and the two
 * claims that remain judgements say so in the line that makes them.
 */
/*
 * THE CLOSING FIGURES, COMPUTED ONCE.
 *
 * These live out here because three things state them: the body, the one-line claim Josh reads first
 * on the decision screen, and the evidence block. On 20 October the body was rewritten with the
 * counted version and the other two were left carrying the six-post one, so the proposal argued
 * against itself — the summary said he asks in nearly every post and the text three screens down
 * said 9%. A number stated in more than one place has to be derived in one.
 */
const closes = Object.fromEntries(matt.close_shapes ?? []);
const opens = Object.fromEntries(matt.opening_shapes ?? []);
const asks = (closes.direct_ask ?? 0) + (closes.engagement_ask ?? 0);
const askPc = Math.round((100 * asks) / matt.shape_basis);
// The other seven, so "he is restrained" is a comparison rather than an impression.
const others = sentinels.report.filter((r) => r.handle !== "mattjbarker1" && r.close_shapes);
const othersAsks = others.reduce((t, r) => {
  const c = Object.fromEntries(r.close_shapes);
  return t + (c.direct_ask ?? 0) + (c.engagement_ask ?? 0);
}, 0);
const othersBasis = others.reduce((t, r) => t + r.shape_basis, 0);
const othersAskPc = Math.round((100 * othersAsks) / othersBasis);

function section() {
  const L = [];
  const pc = (n) => Math.round((100 * n) / matt.shape_basis);
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
  /*
   * Derived, like the length rank beside it. "Mid-pack" was true of eight posts in October and is
   * false at 241: he is the second most uniform of the eight. A claim about a writer's rhythm that
   * survives the corpus growing tenfold has to be computed, not typed.
   */
  const sds = sentinels.report.map((r) => r.sd_median).sort((a, b) => a - b);
  const sdRank = sds.indexOf(matt.sd_median) + 1;
  const sdPlace = sdRank <= 2
    ? `the ${["", "most", "second most"][sdRank]} uniform of the ${sds.length}`
    : sdRank >= sds.length - 1
      ? `the ${sdRank === sds.length ? "most" : "second most"} varied of the ${sds.length}`
      : `${sdRank}th of ${sds.length}, mid-pack`;
  L.push(`- Sentence-length variation **${matt.sd_median}** — ${sdPlace}. He writes in steadier ` +
    `lengths than his reputation for punchiness suggests.`);
  L.push("");
  L.push("## Where he starts");
  L.push("");
  L.push(`**On a number, and it is the most distinctive thing he does.** ${opens.number_claim} of his ` +
    `${matt.shape_basis} posts open on a figure — **${pc(opens.number_claim)}%**. He is the only one of the`);
  L.push("eight whose commonest opening is anything other than a plain statement, and the nearest any of");
  L.push("the other seven gets to his rate is 27%. If one move is worth taking from him, it is this one.");
  L.push("");
  L.push(`**Then a time, an errand, a place.** ${opens.time_anchored} posts (**${pc(opens.time_anchored)}%**) ` +
    `open time-anchored, his second commonest and the highest`);
  L.push("of the eight. He anchors a commercial point to something mundane and verifiable, and the ordinary");
  L.push("detail does the work a credential would otherwise do.");
  L.push("");
  L.push("**A judgement, not a count: he opens on somebody else's situation and keeps himself in frame as");
  L.push("the person it happened to.** That is a reading of his openings rather than a measurement, and it");
  L.push("is offered as one. It matters for Josh because a shape built around someone else's situation");
  L.push("survives anonymising, where one built around a named account does not.");
  L.push("");
  L.push("This is the move Josh's hook rules already describe as *how I, not how to*, with one difference:");
  L.push("Matt's version puts somebody else at the centre. For Josh that is the easier version to write");
  L.push("honestly, because his material is client work he cannot name.");
  L.push("");
  L.push(`**He cuts, he does not set a scene.** His openings run **${matt.opening_words_median} words** with `  +
    `**${matt.above_fold_words_median} words above the fold** — the`);
  L.push("second fewest of the eight, where Jen Allen-Knuth and Eric Nowoslawski run past 60. The earlier");
  L.push("version of this read called his opening *a scene, not a cut*, on eight posts that put him at");
  L.push("61.5. At 241 he is at 39, and the opposite is true: he gets in fast and explains afterwards.");
  L.push("");
  L.push("## What the middle does");
  L.push("");
  L.push(`**He turns early, and more often than anyone here.** 180 of 250 posts reverse on a marked turn`);
  L.push("(**72%**) against 44% across the corpus, and his median turn lands **0.16** of the way through");
  L.push("against 0.25. He sets up and reverses inside the first few sentences and spends the rest on the");
  L.push("consequence. Measured sentence-wise by `scripts/measure-structure.mjs` on 20 October, so it does");
  L.push("not depend on a line break surviving.");
  L.push("");
  L.push(`**One mechanism, and it is listed about two posts in three.** A list appears in ` +
    `**${Math.round(matt.list_rate * 100)}%** of them, counted`);
  L.push("from the line breaks rather than inferred. That is above the corpus and below Curtis Howland's");
  L.push("82%. The pattern underneath the number is a judgement, not a count: numbered steps when the");
  L.push("point IS a process, unbroken prose when the point is a judgement.");
  L.push("");
  L.push("**He re-aims mid-post with an audience tag.** A paragraph that is just the name of who the rest");
  L.push("is for. It does the altitude filtering Josh's hook section asks of the opening, except Matt does");
  L.push("it again in the middle, where a reader who has stayed is deciding whether this is for them.");
  L.push("Directly transferable, and nothing in Josh's rules covers it.");
  L.push("");
  L.push("**Proof arrives as a range, not a trophy.** Where he quotes an outcome it is bounded (a figure");
  L.push("from-to, a share, a count) and attributed to the person it happened to. It reads as reporting.");
  L.push("");
  L.push("## How he lands");
  L.push("");
  L.push(`**Short.** ${closes.short_landing} of ${matt.shape_basis} posts end in eight words or fewer ` +
    `(**${pc(closes.short_landing)}%**), the highest of the eight.`);
  L.push("");
  L.push(`**And then, one post in five, a postscript.** ${closes.postscript} posts (**${pc(closes.postscript)}%**) ` +
    `close on a P.S. No other writer here`);
  L.push("passes 4%. It is the most distinctive thing about his endings and nothing in Josh's rules");
  L.push("mentions it.");
  L.push("");
  L.push("## One thing that does NOT transfer, where we previously said two");
  L.push("");
  L.push("Said plainly, because it is the most recognisable thing he does and the reason a draft that");
  L.push("imitates him fails Josh's own gate.");
  L.push("");
  L.push("**His turn renames the reader's problem.** The structure is: state the problem the reader");
  L.push("thinks they have, deny it, substitute a renamed one. That is exactly the construction the");
  L.push("banned-phrases section forbids — rejecting a frame in order to assert another — and it is the");
  L.push("single most recognisable AI cadence on LinkedIn, which is not a coincidence: it is a cadence");
  L.push("models learned partly from writing like this. Matt gets away with it because the substituted");
  L.push("problem is one he can evidence. The system still must not copy it. The fix is the one already in");
  L.push("that section: delete the rejected half and state the second problem once, with the detail");
  L.push("attached.");
  L.push("");
  L.push("**This one was not re-verified at scale.** It is a reading of the construction, not a count —");
  L.push("nothing here detects a renamed problem mechanically. Given the closing claim beside it turned");
  L.push("out backwards on six posts, treat this as the judgement it is until something measures it.");
  L.push("");
  L.push("## The correction: he does not ask in nearly every post");
  L.push("");
  L.push("**This section said he did, and that was wrong.** It was written off six posts collected on");
  L.push("5 October whose line breaks the scrape had stripped, so they were read by eye. Counted across");
  L.push(`**${matt.shape_basis}** posts he closes on an ask — direct or engagement — **${asks} times**, ` +
    `which is **${pc(asks)}%**.`);
  L.push(`The other seven writers close on one **${othersAskPc}%** of the time. Josh's own rule rations it ` +
    `to one post in`);
  L.push("five, which is 20%. So Matt asks less often than the other seven, and less often than Josh's");
  L.push("rule allows. He is the most restrained closer of the eight, not the outlier.");
  L.push("");
  L.push(`What the six posts actually showed was the postscript habit above: **${pc(closes.postscript)}%** ` +
    `of his posts end on a P.S.,`);
  L.push("and a P.S. carrying a link reads as a pitch when you have six of them and as a habit when you");
  L.push("have 241. **Nothing about his closing needs to be ruled out for Josh.** The rule that rations a");
  L.push("direct ask stays, because it is Josh's rule and it was never Matt's to justify — but it is no");
  L.push("longer a place where leaning into Matt would breach it.");
  L.push("");
  L.push("## What to take, in order");
  L.push("");
  L.push(`1. **Open on a number.** Half his posts do (**${pc(opens.number_claim)}%**), and he is the only ` +
    `one of the eight who`);
  L.push("   leads with one. The strongest-evidenced move here by a distance.");
  L.push("2. **Turn early.** His median turn is at 0.16 against the corpus 0.25, and he turns in 72% of");
  L.push("   posts against 44%. The turn buys the rest of the post; it is not the climax.");
  L.push(`3. **Get in fast — ${matt.above_fold_words_median} words above the fold**, second fewest of the ` +
    `eight. Explain afterwards.`);
  L.push("4. **Anchor it to something mundane and specific.** A weekday and an errand beat an adjective.");
  L.push(`5. **Land short** — ${pc(closes.short_landing)}% of his closes are eight words or fewer, the ` +
    `highest here.`);
  L.push("6. **One mechanism per post.** List it only if it is genuinely a process.");
  L.push("7. **Name the audience once, in the middle.** New to Josh's rules, and cheap.");
  L.push("");
  L.push("Not: the renamed-problem turn. That is the only one, and it is a judgement rather than a count.");
  L.push("");
  L.push("**Josh — this is a real fork.** We have kept your banned-phrases rule and ruled Matt's turn out");
  L.push("of bounds, because an over-strict gate fails visibly and is easy to correct. If you want that");
  L.push("construction available because it is how he lands a post, say so and it comes out of the banned");
  L.push("list — but it would then be allowed everywhere, and it is the one pattern most likely to make a");
  L.push("draft read as generated.");
  L.push("");
  L.push(`_Counted across ${matt.posts_measured} posts, ${matt.window.from} to ${matt.window.to}. ` +
    `Shape figures rest on the ${matt.shape_basis} that kept`);
  L.push("their line breaks. The previous version of this section rested on six posts and got his closing");
  L.push("habit backwards; the numbers above are what replaced it._");
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

// Before "What never to take", which is the section's closing rule and should stay last.
const anchor = "## What never to take";

/*
 * REPLACE AN EXISTING READING, DO NOT SKIP IT.
 *
 * This used to exit 0 with "already carries the reading" whenever the heading was present. That was
 * right while the reading was written once and never revised, and wrong the moment it needed
 * correcting: on 20 October the proposal carried the six-post version saying Matt asks in nearly
 * every post, this script had the 241-post version saying he does not, and it declined to fold it in
 * because the heading it was about to replace was already there. A refusal to overwrite that is
 * indistinguishable from success is the shape of bug this repository keeps finding.
 *
 * The replaced span runs from the heading to the anchor, or to the end if there is no anchor.
 */
const existing = p.proposed_body.indexOf(HEADING);
const base = existing === -1 ? p.proposed_body : (() => {
  const after = p.proposed_body.indexOf(anchor, existing);
  const tail = after === -1 ? "" : p.proposed_body.slice(after);
  console.log(`  Proposal #${p.id} already carried a reading — replacing it.`);
  return p.proposed_body.slice(0, existing).replace(/\n*(?:---\n*)?$/, "\n\n") + tail;
})();

const at = base.indexOf(anchor);
const merged = at === -1
  ? `${base.replace(/\n*$/, "")}\n\n${body}\n`
  : `${base.slice(0, at)}${body}\n\n---\n\n${base.slice(at)}`;

/*
 * The claim gets the same treatment as the body, for the same reason. The body has a replace path
 * above; the claim did not, so the first re-run appended a second reading after the first and left
 * the superseded sentence — "he asks in nearly every post" — standing at the front, where Josh reads
 * it. The sentence below is the marker for everything this script has ever appended, so cutting at
 * it recovers whatever the refresh wrote and nothing else.
 */
const CLAIM_MARKER = ". Plus a structural reading of Matt Barker";
const cut = p.claim.indexOf(CLAIM_MARKER);
const claimHead = (cut === -1 ? p.claim : p.claim.slice(0, cut)).replace(/\.\s*$/, "");

const res = await fetch(`${url}/rest/v1/library_proposals?id=eq.${p.id}`, {
  method: "PATCH",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({
    proposed_body: merged,
    /*
     * This is the line Josh reads before he reads anything else, so it carries the counted figure
     * rather than a summary of the reading. It used to say "the two things that cannot" transfer and
     * name his closing ask as the second. There is ONE: the renamed-problem turn. The closing claim
     * was measured and came out backwards, which is why the number is in the sentence.
     */
    claim: `${claimHead}. Plus a structural reading of Matt Barker, which Josh asked to lean most ` +
      `into: what transfers from his ${matt.posts_measured} posts and the one thing that cannot — ` +
      `his renamed-problem turn is the construction the banned-phrases section forbids. It also ` +
      `corrects this section: he does not close on an ask in nearly every post. Counted across ` +
      `${matt.shape_basis}, he does it ${askPc}%, against ${othersAskPc}% for the other seven and ` +
      `the 20% Josh's own rule allows.`,
    evidence: {
      ...(p.evidence ?? {}),
      matt_barker: {
        posts_measured: matt.posts_measured,
        window: matt.window,
        median_words: matt.median_words,
        list_rate: matt.list_rate,
        shape_basis: matt.shape_basis,
        // Counted, with the superseded basis kept beside it rather than deleted: the old figure is
        // what the library has been telling drafters since 5 October, so it belongs in the record of
        // what changed. Labelled as superseded so nobody reads it as current evidence.
        closes_on_an_ask: `${asks} of ${matt.shape_basis} (${askPc}%)`,
        closes_on_an_ask_other_seven: `${othersAsks} of ${othersBasis} (${othersAskPc}%)`,
        superseded_reading: "6 of 6, off the posts collected 2026-10-05 whose line breaks the " +
          "scrape stripped, read by eye",
        direct_asks_across_all_seven: `${sentinels.totals.direct_asks} of ${sentinels.totals.of}`,
      },
    },
  }),
});

if (!res.ok) { console.error(`Could not update proposal #${p.id}: ${res.status} ${await res.text()}`); process.exit(1); }

console.log(`\n  Folded into proposal #${p.id} — one thing for Josh to approve, not two.`);
console.log(`  ${merged.length} characters, no post text in it.`);
console.log("  Nothing has changed in the library. It waits for him (12.10).");
