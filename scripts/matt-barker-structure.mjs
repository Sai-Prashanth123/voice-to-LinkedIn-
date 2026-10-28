#!/usr/bin/env node
/**
 * The deeper structural read of Matt Barker, proposed as its own library section.
 *
 *   node scripts/matt-barker-structure.mjs            # print it
 *   node scripts/matt-barker-structure.mjs --apply    # open or refresh the proposal
 *
 * WHY THIS IS SEPARATE FROM sentinel-refresh.mjs
 *
 * The refresh is mechanical: it measures and reports numbers, and it could not write the section
 * below if it tried, because the section is a READING. Josh asked to lean most into Matt Barker —
 * "his frameworks, structures and methods, in my voice" — and a median word count does not answer
 * that. What answers it is: where does he start, what does he do in the middle, how does he turn,
 * how does he close. That is judgement, and the measurements are its evidence.
 *
 * WHY IT IS NO LONGER SPLICED INTO reference_posts
 *
 * It was, from 20 October, and it was 8,287 of that section's 10,924 characters. `reference_posts`
 * is in `DRAFTING_SECTIONS`, so one writer's shape shipped on EVERY drafting brief whichever handle
 * had been passed — and a control run with no handle at all read it as its shape target. That is
 * Josh's recorded complaint that "the default framework gets used anyway", arriving as the mechanism
 * rather than as a symptom: the most likely cadence to leak (8.3) was the default shape target.
 *
 * So it goes to `reference_writer_reads`, which is deliberately in NO entry of `VIEWS` in
 * `supabase/functions/_shared/views.ts`. `renderLibrary` filters by `wanted.has(row.key)`, so a key
 * in no view reaches no prompt: the exclusion is the default rather than a rule to maintain.
 *
 * Nothing load-bearing is lost. A named writer's measured shape reaches a drafter through
 * `writerShapeBlock` in `mcp-server/tools/voice.mjs`, which asks for the handle, and his one
 * exclusion — the renamed-problem turn — is hardcoded beside the target in the same object there,
 * with a comment on why it may never become a separate optional field.
 *
 * WHAT CLAUSE 8.3 ALLOWS AND WHAT IT DOES NOT
 *
 * Structure only. Not one of his sentences is in this file, and the two places where his own phrasing
 * would be the obvious illustration are described abstractly instead. The system holds his posts in
 * `reference_writer_posts` and `get_reference_posts` is the only door that returns them.
 *
 * THE FINDING THAT MATTERS MOST IS A CONFLICT
 *
 * His signature turn is the construction Josh's banned-phrases section forbids outright. Leaning
 * into Matt therefore cannot mean copying Matt, and saying which parts transfer and which one does
 * not is the whole value of the read, so it is not buried.
 *
 * It does not touch library_sections. 12.10: the system proposes, Josh approves.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
// The refusals and the section key, shared with the seeder and both refreshers. Node strips the
// types and reads it verbatim, the way measure.mjs reads _shared/shape.ts.
import {
  describeRefusals,
  END,
  refusals,
  START,
  WRITER_READS_KEY,
} from "../supabase/functions/_shared/library-spans.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");

const sentinels = JSON.parse(readFileSync(join(ROOT, "data/josh/sentinels/latest.json"), "utf8"));
const matt = sentinels.report.find((r) => r.handle === "mattjbarker1");
if (!matt) { console.error("No measurements for mattjbarker1. Run sentinel-refresh first."); process.exit(2); }

const HEADING = "## Matt Barker, read structurally";

/*
 * THE CLOSING FIGURES, COMPUTED ONCE.
 *
 * These live out here because three things state them: the body, the one-line claim Josh reads first
 * on the decision screen, and the evidence block. On 20 October the body was rewritten with the
 * counted version and the other two were left carrying an earlier one, so the proposal argued
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

/**
 * How close the nearest of the other seven gets to his number-opening rate.
 *
 * Was typed as "27%". It happens still to be 27%, which is exactly why it had to be derived: a
 * figure that is right by coincidence is indistinguishable from one that is right by measurement
 * until the corpus moves.
 */
const nearestNumberClaimPc = Math.max(
  ...others.map((r) => {
    const o = Object.fromEntries(r.opening_shapes ?? []);
    return r.shape_basis ? Math.round((100 * (o.number_claim ?? 0)) / r.shape_basis) : 0;
  }),
);

/**
 * THE TURN, WHICH IS THE ONE FIGURE HERE WITH THE OTHER DENOMINATOR.
 *
 * `turnAt` is detected sentence-wise, so it needs no line breaks and is counted over every stored
 * post rather than over the ones that kept them. That makes it the single exception to the rule in
 * the header of `_shared/library-spans.ts`, and the sentence that quotes it says so.
 *
 * Hardcoded because `scripts/measure-structure.mjs` reads the corpus and writes nothing — there is
 * no stored artefact to derive these from. Re-verified 28 October against the live corpus:
 *
 *   node scripts/measure-structure.mjs --handle mattjbarker1   -> 180 of 250, median 0.16
 *   node scripts/measure-structure.mjs                         -> 827 of 1900 (44%), median 0.25
 *
 * If these ever need updating, that is the command that produces them. A figure nobody can
 * reproduce from a named command has no business in Josh's library.
 */
const TURNS = { his: 180, hisAt: "0.16", corpusPc: 44, corpusAt: "0.25" };

/**
 * An ordinal, derived.
 *
 * "The second fewest of the eight" was typed twice in this read and wrong both times: his median
 * above-fold figure is FIFTH of the eight. Josh's own approval note on version 8 records it as an
 * outstanding error he was shipping knowingly — "'second fewest above the fold' is wrong (he is
 * fifth)". A rank is arithmetic and had no business being a sentence.
 */
function rankOf(value, values) {
  return values.filter((n) => typeof n === "number").sort((x, y) => x - y).indexOf(value) + 1;
}

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const ordinal = (k) => ORDINALS[k] ?? `${k}th`;

function section() {
  const L = [];
  /*
   * EVERY PERCENTAGE HERE IS OVER shape_basis, AND THE SENTENCE SAYS WHAT IT IS OVER.
   *
   * Openings, closes, paragraphs, above-fold words and lists are all read from line breaks, so they
   * are counted over the posts that kept them. The rule, and the four live quantities it
   * disambiguates, are in the header of `supabase/functions/_shared/library-spans.ts`. Before it,
   * this read said "**250 posts**, 2026-03-02 to 2026-10-19" four lines above "120 of his 241 posts
   * open on a figure" and "180 of 250 posts reverse on a marked turn" beside "99 of 241 posts end in
   * eight words or fewer" — every figure defensible, and together unreadable.
   */
  const pc = (n) => Math.round((100 * n) / matt.shape_basis);
  const basis = `${matt.shape_basis} of his ${matt.posts_measured} posts that kept their line breaks`;

  const lengths = sentinels.report.map((r) => r.median_words);
  const sds = sentinels.report.map((r) => r.sd_median);
  const folds = sentinels.report.map((r) => r.above_fold_words_median);
  const foldRank = rankOf(matt.above_fold_words_median, folds);

  /*
   * THE WHOLE READ IS INSIDE THE MARKERS, BECAUSE THE WHOLE READ IS DERIVED.
   *
   * The rule `refusals()` enforces is that a count may not sit where no refresh can reach it. In
   * `reference_posts` that splits the section in two, because half of it is prose Josh may write. In
   * THIS section there is no such half: every sentence is composed here from the measurement, so the
   * marked span is the section.
   *
   * Which is also why this file no longer needs the anchor-based replace it carried from 20 October.
   * That logic existed because the read was spliced into somebody else's section around "## What
   * never to take", and a re-run had once appended a second reading below the first and left the
   * superseded sentence standing at the front, where Josh reads it. A section that is only this read
   * replaces itself by construction.
   */
  L.push(START);
  L.push("");
  L.push(HEADING);
  L.push("");
  L.push("Josh asked to lean most into Matt Barker — his frameworks, structures and methods, in Josh's");
  L.push("voice. This is what his posts DO, structurally. None of his words are here and none may reach a");
  L.push("draft (clause 8.3). Two numbers to read it against:");
  L.push("");
  // Derived, not asserted. "The second shortest of the seven" was true of the September numbers and
  // is the kind of claim that goes quietly wrong the next time anyone writes a longer month.
  L.push(`- **${matt.posts_measured} stored posts**, ${matt.window.from} to ${matt.window.to}, ` +
    `median **${matt.median_words} words** — the ${ordinal(rankOf(matt.median_words, lengths))}`);
  L.push(`  shortest of the ${lengths.length}.`);
  /*
   * Derived, like the length rank beside it. "Mid-pack" was true of eight posts in October and is
   * false at this size. A claim about a writer's rhythm that survives the corpus growing tenfold has
   * to be computed, not typed.
   */
  L.push(`- Sentence-length variation **${matt.sd_median}** — the ` +
    `${ordinal(rankOf(matt.sd_median, sds))} most uniform of the ${sds.length}. He writes in`);
  L.push("  steadier lengths than his reputation for punchiness suggests.");
  L.push("");
  L.push("## Where he starts");
  L.push("");
  L.push(`**On a number, and it is the most distinctive thing he does.** ${opens.number_claim} of ` +
    `${basis}`);
  L.push(`open on a figure — **${pc(opens.number_claim)}%**. He is the only one of the eight whose ` +
    `commonest opening is`);
  L.push("anything other than a plain statement, and the nearest any of the other seven gets to his rate");
  L.push(`is ${nearestNumberClaimPc}%. If one move is worth taking from him, it is this one.`);
  L.push("");
  L.push(`**Then a time, an errand, a place.** ${opens.time_anchored} of the same posts ` +
    `(**${pc(opens.time_anchored)}%**) open time-anchored,`);
  L.push("his second commonest and the highest of the eight. He anchors a commercial point to something");
  L.push("mundane and verifiable, and the ordinary detail does the work a credential would otherwise do.");
  L.push("");
  L.push("**A judgement, not a count: he opens on somebody else's situation and keeps himself in frame as");
  L.push("the person it happened to.** That is a reading of his openings rather than a measurement, and it");
  L.push("is offered as one. It matters here because a shape built around someone else's situation");
  L.push("survives anonymising, where one built around a named account does not.");
  L.push("");
  L.push("This is the move Josh's hook rules already describe as *how I, not how to*, with one difference:");
  L.push("Matt's version puts somebody else at the centre. That is the easier version to write honestly");
  L.push("from client work that cannot be named.");
  L.push("");
  L.push(`**He cuts, he does not set a scene.** His openings run **${matt.opening_words_median} ` +
    `words** with **${matt.above_fold_words_median} words above`);
  L.push(`the fold** — the ${ordinal(foldRank)} fewest of the eight, where Jen Allen-Knuth ` +
    `and Eric Nowoslawski run past`);
  L.push("sixty. He gets in fast and explains afterwards.");
  L.push("");
  L.push("## What the middle does");
  L.push("");
  L.push(`**He turns early, and more often than anyone here.** ${TURNS.his} of his ` +
    `${matt.posts_measured} stored posts reverse on a`);
  L.push(`marked turn (**${Math.round((100 * TURNS.his) / matt.posts_measured)}%**) against ` +
    `**${TURNS.corpusPc}%** across the corpus, and his median turn lands`);
  L.push(`**${TURNS.hisAt}** of the way through against **${TURNS.corpusAt}**. He sets up and ` +
    `reverses inside the first few`);
  L.push("sentences and spends the rest on the consequence. Counted over every stored post rather than");
  L.push("over the ones that kept their line breaks, because `scripts/measure-structure.mjs` detects the");
  L.push("turn sentence-wise and a lost line break does not affect it.");
  L.push("");
  L.push(`**One mechanism, and it is listed about two posts in three.** A list appears in ` +
    `**${Math.round(matt.list_rate * 100)}%** of the`);
  L.push(`${basis}, counted from the line breaks rather than inferred.`);
  L.push("That is above the corpus and below Curtis Howland's, who is the heaviest lister of the eight.");
  L.push("The pattern underneath the number is a judgement, not a count: numbered steps when the point IS");
  L.push("a process, unbroken prose when the point is a judgement.");
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
  L.push(`**Short.** ${closes.short_landing} of ${basis} end in eight words or`);
  L.push(`fewer (**${pc(closes.short_landing)}%**), the highest of the eight.`);
  L.push("");
  L.push(`**And then, one post in five, a postscript.** ${closes.postscript} of them ` +
    `(**${pc(closes.postscript)}%**) close on a P.S. No other`);
  L.push("writer here passes four per cent. It is the most distinctive thing about his endings and nothing");
  L.push("in Josh's rules mentions it.");
  L.push("");
  L.push(`**He is the most restrained closer of the eight.** Across ${basis},`);
  L.push(`he closes on an ask — direct or engagement — in **${asks} of them**, which is ` +
    `**${pc(asks)}%**. The other seven`);
  L.push(`close on one **${othersAskPc}%** of the time, and Josh's own rule rations it to one post in ` +
    `five, which is`);
  L.push("twenty per cent. So leaning into his endings breaches nothing. The rule that rations a direct");
  L.push("ask stays, because it is Josh's rule and it was never Matt's to justify.");
  L.push("");
  L.push("## The one thing that does not transfer");
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
  L.push("**This one is a reading, not a count.** Nothing here detects a renamed problem mechanically, so");
  L.push("it is offered as the judgement it is until something measures it.");
  L.push("");
  L.push("## What to take, in order");
  L.push("");
  L.push(`1. **Open on a number.** Half his posts do (**${pc(opens.number_claim)}%**), and he is ` +
    `the only one of the eight who`);
  L.push("   leads with one. The strongest-evidenced move here by a distance.");
  L.push(`2. **Turn early.** His median turn is at ${TURNS.hisAt} against the corpus ` +
    `${TURNS.corpusAt}, and he turns in`);
  L.push(`   ${Math.round((100 * TURNS.his) / matt.posts_measured)}% of posts against ` +
    `${TURNS.corpusPc}%. The turn buys the rest of the post; it is not the climax.`);
  L.push(`3. **Get in fast — ${matt.above_fold_words_median} words above the fold**, the ` +
    `${ordinal(foldRank)} fewest of the eight. Explain`);
  L.push("   afterwards.");
  L.push("4. **Anchor it to something mundane and specific.** A weekday and an errand beat an adjective.");
  L.push(`5. **Land short** — ${pc(closes.short_landing)}% of his closes are eight words or fewer, ` +
    `the highest here.`);
  L.push("6. **One mechanism per post.** List it only if it is genuinely a process.");
  L.push("7. **Name the audience once, in the middle.** New to Josh's rules, and cheap.");
  L.push("");
  L.push("Not: the renamed-problem turn. That is the only one, and it is a judgement rather than a count.");
  L.push("");
  L.push(`_Across ${matt.posts_measured} stored posts, ${matt.window.from} to ${matt.window.to}. ` +
    `Shape figures rest on the`);
  L.push(`${matt.shape_basis} of them that kept their line breaks; the turn is counted over all ` +
    `${matt.posts_measured}._`);
  L.push("");
  L.push(END);
  return L.join("\n");
}

const body = section();

/**
 * THE FORK, WHICH IS FOR JOSH AND WAS BEING HANDED TO A DRAFTER.
 *
 * This paragraph was in the section body until 28 October, which means it shipped on every drafting
 * brief: "**Josh — this is a real fork.** ... If you want that construction available because it is
 * how he lands a post, say so and it comes out of the banned list." It hands a model a decision only
 * Josh can make and tells it a ban is negotiable, which is the one thing a banned-phrases list
 * cannot survive being told.
 *
 * So it lives in the `claim` — the line Josh reads first on the decision screen — and `refusals()`
 * in `_shared/library-spans.ts` refuses a body that reintroduces anything addressed to him.
 */
const FORK_FOR_JOSH =
  "One decision for you, Josh, rather than for a drafter: we have kept your banned-phrases rule and " +
  "ruled Matt's renamed-problem turn out of bounds, because an over-strict gate fails visibly and is " +
  "easy to correct. If you want that construction available because it is how he lands a post, say " +
  "so and it comes out of the banned list — but it would then be allowed everywhere, and it is the " +
  "one pattern most likely to make a draft read as generated.";

/* ── The refusals ─────────────────────────────────────────────────────────── */

// 8.3 is enforced here as well as in the refresh: a run of his text in this file would be a breach
// whatever the comments above say, so the body is checked before it can be stored.
const TELLS = ["distillation problem", "ideas problem", "want the rest", "gentle giant"];
for (const t of TELLS) {
  if (body.toLowerCase().includes(t)) { console.error(`Refusing: "${t}" is his phrasing.`); process.exit(1); }
}

/*
 * And the two that version 8 actually shipped: prose addressed to Josh, and the section's account of
 * its own past. Roughly 1.5 KB of this read was a changelog — "This section said he did, and that
 * was wrong", "the previous version of this read called his opening *a scene, not a cut*". A drafter
 * does not need to know what the standard used to say; it needs the standard. What changed is in
 * `library_section_versions` and in the proposal's evidence, which is where Josh reads it.
 */
const found = refusals(body);
if (found.length) {
  console.error("\n  REFUSING to store this reading:\n");
  console.error(describeRefusals(found));
  console.error("");
  process.exit(1);
}

/* ── Open or refresh the proposal ─────────────────────────────────────────── */

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) => process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

if (!APPLY) {
  console.log(body);
  console.log(`\n  ${body.length} characters, for section "${WRITER_READS_KEY}".`);
  console.log("  Dry run. Nothing written. Pass --apply to open the proposal.");
  process.exit(0);
}

const { url, key } = credentials();
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

/*
 * THE SECTION HAS TO EXIST BEFORE A PROPOSAL AGAINST IT CAN BE APPROVED.
 *
 * `decide_proposal` applies an approved body to `library_sections` by key. A proposal against a key
 * with no row is one Josh can approve and nothing can apply — which is worse than no proposal,
 * because it looks like it worked. So this refuses, and names the migration.
 */
const [target] = await (await fetch(
  `${url}/rest/v1/library_sections?select=key&key=eq.${WRITER_READS_KEY}`, { headers },
)).json();

if (!target) {
  console.error(`\n  There is no "${WRITER_READS_KEY}" section yet, so a proposal against it could`);
  console.error("  be approved and then apply to nothing. Apply the migration that seeds it first:");
  console.error("    supabase/migrations/0057_reference_writer_reads.sql\n");
  console.error("  It is deliberately in no entry of VIEWS, so it reaches no drafting brief.\n");
  process.exit(2);
}

const open = await (await fetch(
  `${url}/rest/v1/library_proposals?section_key=eq.${WRITER_READS_KEY}&status=eq.open` +
    "&order=id.desc&limit=1",
  { headers },
)).json();

/*
 * The whole read, not a splice.
 *
 * It used to be merged into the `reference_posts` proposal around an anchor, with a replace path
 * added on 20 October after a re-run appended a second reading below the first and left the
 * superseded sentence standing at the front where Josh reads it. A section that is ONLY this read
 * needs none of that: the body is the read, so a re-run replaces it by construction. The failure
 * mode the anchor logic existed to survive is gone rather than handled.
 */
const claim =
  `A structural reading of Matt Barker, which Josh asked to lean most into: what transfers from ` +
  `his ${matt.posts_measured} stored posts and the one thing that cannot — his renamed-problem ` +
  `turn is the construction the banned-phrases section forbids. Counted across ` +
  `${matt.shape_basis} of those posts that kept their line breaks, he closes on an ask ${askPc}%, ` +
  `against ${othersAskPc}% for the other seven and the 20% Josh's own rule allows: he is the most ` +
  `restrained closer of the eight. This read moves OUT of reference_posts, which a drafter reads ` +
  `on every brief whichever writer was named, and into a section that is in no view. ` +
  FORK_FOR_JOSH;

const evidence = {
  kind: "writer_structural_read",
  handle: matt.handle,
  posts_measured: matt.posts_measured,
  window: matt.window,
  median_words: matt.median_words,
  list_rate: matt.list_rate,
  shape_basis: matt.shape_basis,
  closes_on_an_ask: `${asks} of ${matt.shape_basis} (${askPc}%)`,
  closes_on_an_ask_other_seven: `${othersAsks} of ${othersBasis} (${othersAskPc}%)`,
  // Kept beside the counted figure rather than deleted: the superseded reading is what the library
  // told drafters from 5 October, so it belongs in the record of what changed. Labelled, so nobody
  // reads it as current — and it is HERE rather than in the body, which is the point.
  superseded_reading: "6 of 6, off the posts collected 2026-10-05 whose line breaks the scrape " +
    "stripped, read by eye. Also: 'second fewest above the fold', which measured fifth.",
  turn_source: "scripts/measure-structure.mjs, re-verified 2026-10-28",
};

const existing = open[0];
const res = existing
  ? await fetch(`${url}/rest/v1/library_proposals?id=eq.${existing.id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ proposed_body: body, claim, evidence }),
  })
  : await fetch(`${url}/rest/v1/library_proposals`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      section_key: WRITER_READS_KEY,
      claim,
      evidence,
      proposed_body: body,
      status: "open",
    }),
  });

if (!res.ok) {
  console.error(`Could not open the proposal: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const [row] = await res.json();
console.log(`\n  Proposal #${row.id} ${existing ? "refreshed" : "opened"} against ` +
  `${WRITER_READS_KEY}.`);
console.log(`  ${body.length} characters, no post text in it, nothing addressed to Josh in the body.`);
console.log("  Nothing has changed in the library. It waits for him (12.10).");
