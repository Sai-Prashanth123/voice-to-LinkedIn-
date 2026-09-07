#!/usr/bin/env node
/**
 * Load Josh's reference library, version 1.0 (4 September 2026).
 *
 *   node scripts/load-josh-library.mjs           # show what would change
 *   node scripts/load-josh-library.mjs --apply   # write it
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 *
 * Migration 0004 seeds the fourteen sections as placeholders. This fills seven of them with what
 * Josh actually sent. It is deliberately NOT a migration, because a migration runs on every deploy
 * and would overwrite whatever Josh had edited since — the section body is his, and 8.6 says his
 * edit must reach the very next draft. A script run once cannot do that damage.
 *
 * It is still committed, because a rebuild into Josh's own account (14.1) starts from an empty
 * database and would otherwise come back with the placeholders. `docs/04-handover.md` names it.
 *
 * WHAT WAS ADDED, AND WHERE
 *
 * Josh asked for this explicitly: "What I have written is a skeleton. If there is meat you would
 * add to it, add it, and tell me where you have." Every addition is marked in the section body with
 * a "Thought Pilot:" prefix, so he can see at a glance what is his and what is ours, and delete
 * ours if he disagrees. Nothing of his has been paraphrased or softened.
 *
 * THE ONE FORMAT CONSTRAINT THAT IS NOT COSMETIC
 *
 * `parsePillars()` in _shared/library.ts reads the pillars section for `##` headings and bullets,
 * and those names become the values the selector balances across (7.1). So in THAT section, `##`
 * marks a pillar and nothing else — a stray subheading there would become a phantom pillar and
 * quietly corrupt which moment gets written next. Other sections have no such rule.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/* ── The sections ─────────────────────────────────────────────────────────── */

const SECTIONS = {
  /**
   * Only `##` here. See the note at the top of this file.
   */
  pillars: `# Content pillars

Three pillars. They describe where a moment came from, not what it is about.

## Career and business

Running the consultancy. Client work, decisions, pricing, what I turned down, what went wrong, what
I noticed across engagements. The commercial side rather than the craft.

## Expertise and craft

The method itself. Finding pain in public data, building segments, what breaks in a build, what a
data source turned out to be worth, where I was wrong about a technique.

## Life

Anything outside work. It stays in, because it is where the lived experience test is easiest to
pass. But it carries a condition.

**The condition on the life pillar.** Every life post has to land somewhere my buyer recognises, at
the same altitude as everything else. The walk is not the post. What I worked out on the walk is. A
life post with no landing attracts the wrong readers, and the wrong readers are worse than no
readers.`,

  audience: `# Who he is talking to

A more sophisticated reader than most advice assumes.

Nearly all LinkedIn writing advice is built for solo operators, freelancers and early-stage
founders. Josh's buyer is not that, and this is the single biggest adjustment the system makes.
Every other rule sits underneath this one.

- **The person.** A VP of Business Development, a VP of Sales, or a head of inside sales. That level.
- **The company.** A vertical SaaS business, Series A through Series C.
- **The motion.** An existing outbound motion. Nobody is starting from zero.
- **The team.** At least five SDRs, BDRs or account executives doing the outreach.
- **Who they sell to.** SMB and mid-market.
- **The pain.** Not booking the meetings they want. Volume is not the problem. Quality and
  prioritisation are.

## Two words that get misread

**Sophisticated** means their operating vocabulary at the altitude they work at. The writing stays
plain, and jargon still fails.

**Strategic** means altitude, not vagueness. A strategic post still carries a specific number, a
specific person and a specific Tuesday. A post for this buyer talks about how a segment gets
chosen. A post for a beginner talks about which button to press.

## The reader who never engages

Josh's buyer lurks. They read and do not like, comment or repost. Do not write for the reader who
reacts; write for the one who reads it and says nothing.`,

  hooks: `# Hook rules

## The test, which is pass or fail

Two things, both required.

1. Only Josh could have written it, because only he was in that room.
2. It opens a loop rather than closing one.

## What a good one usually has

Five elements in the opening lines: **timeline, location, character, action, stakes.**

The stakes are the one most often left out and the one that does the most work, because without
them the reader assumes everything was fine.

Not every hook needs all five, and this is not to be applied mechanically. It is what to aim at
rather than a template to fill. Use judgement on when a hook lands better without one of them.

**Worked example.** *In March I sat on a call with a VP of Sales in Melbourne who had just been
handed a number nobody had worked out how to hit.*
Timeline: in March. Location: a call, Melbourne. Character: a VP of Sales. Action: handed a number.
Stakes: nobody knew how to hit it.

## The toolkit, in order of how often to reach for it

**Name who it is for.** States the job title, team size, company type or a qualifier in the opening
line. The highest-value tool available: it does the altitude work on its own, turning the right
reader on and the wrong one off.

**Contrast.** Two short lines that fight each other — past against present, expectation against
reality, consensus against what he found. Whenever the moment has a genuine before and after. Do
not manufacture one.

**Authority markers.** Time, status, money or recency attached to an otherwise ordinary opening.
Only when the number is real and his. A borrowed or rounded number is worse than none.

**Premise, setup, trigger.** A longer three-part opener: a premise with a real number, a setup that
breaks the expectation, a line that teases the reveal. For posts with a big result and a twist
underneath it.

**How I, not how to.** Puts him inside the claim instead of standing outside teaching it. Any time
he actually did the thing. If he did not, the post should not exist.

**Two stacked gaps.** Line two refuses to answer line one and adds a second question instead of
resolving the first. For short hooks where there is no scene to set. Easy to overdo.

## The open loop, and why most of them fail

From Josh's coaching brief 4. This is the part that is usually got wrong, and it is not "be
mysterious".

**A curiosity gap works by building investment first, then cutting at the reveal.** Withholding on
its own does nothing, because the reader has no reason to care yet. Investment comes from three
things, and a hook missing all three cannot be rescued by a better cut:

- **specificity** — the detail that proves this happened
- **a real emotion** — what it felt like, not what it meant
- **clear stakes** — what was at risk if it went the other way

**Three ways it fails.** Name which one, rather than saying the hook is weak:

1. **No gap at all.** The opening states its conclusion. Nothing is owed to the reader.
2. **A gap with no investment behind it.** Something is withheld, but nothing has been given first,
   so the withholding reads as a trick.
3. **The cut is too late.** The reveal is already inside the hook, so the rest of the post is
   confirmation rather than payoff.

## Two nevers

**Never open with a question.** It reads as an advert and trips the reader's filter before anything
has been earned. A question can *close* a hook, which is a different thing and often works well. It
cannot start one.

**No bait.** Deliberately provoking a reaction to lift reach is effective and unwanted. It
contradicts how Josh sells and attracts an audience he cannot do anything with. If a hook only
works because it annoys someone, it fails.`,

  frameworks: `# Body frameworks

Three, and nothing else. The drafter records which one it chose (9.3).

## What, why, how

State what happened. Explain why it happened. Show how the reader could apply it. The most
versatile of the three and the right default when nothing else obviously fits.

## Problem, agitate, solve

Name a problem the reader recognises, make them feel what it costs, then show what fixed it. For
posts about a mistake, a frustration or something broken.

## Hook, frame, insight, lesson

The frame is the extra step: name what most people believe before delivering what he found instead.
For posts that challenge an assumption rather than teach a method.`,

  closes: `# Closing lines

One ask at most, or none.

## A genuine question

Specific enough that only his reader could answer it, and one he actually wants the answer to. Not
"what do you think". **The default close.**

## A soft close, no ask

A line that closes the loop the post opened and leaves the reader with something. Right for the
more personal posts, where an ask would jar.

## One direct ask

Message me, here is the link, let's talk. Permitted, but rationed to roughly **one post in five**.
More often and the whole feed reads as a pitch.

## Three nevers

- **Never two asks in one post.** The reader then does neither.
- **Never a request for likes, reposts or follows.**
- **Never a pitch bolted onto a post that was not about the offer.** It reads as a bait and switch
  after someone has given you three minutes.`,

  formatting: `# LinkedIn formatting

**Lean, then fat, then lean.** Short and punchy to get in, the depth in the middle, a short clear
exit. If the opening is heavy, the reader never reaches the middle.

**Vary the sentence length.** Everything the same length is exhausting. Short lines create emphasis,
longer ones carry the detail. Read it aloud: rhythm, or legal document?

**Colons.** The most underused tool available. A colon creates a micro-pause and a micro-curiosity
at once, and pulls the eye to the next line.

**Bullet discipline.** Bullets surface a genuine list. They are a crutch when they replace sentences
and fragment ideas that should flow. One list per post is usually plenty. If the bullets could be a
sentence, they should be.

**White space.** One idea per paragraph. When the idea shifts, break. Four or five lines already
reads as dense on a phone.

**No word count.** The moment decides the length. Nothing gets padded to reach a target, and nothing
gets cut to fit one.`,

  gate_rules: `# Gate rules

Constraints the gate applies on top of the eight checks it always runs. All of these are Josh's,
from *Reference library inputs* v1.0.

## Never

- **Never open with a question.** A question may close a hook, never start one.
- **Never two asks in one post.** The reader does neither.
- **Never ask for likes, reposts or follows.**
- **Never bolt a pitch onto a post that was not about the offer.**
- **Never bait.** If a hook only works because it annoys someone, it fails.

## Never name a client

No client gets named. Not on a roster, not with permission, not at all. Posts use the shape
instead: a vertical SaaS company, a compliance platform, a team of forty, a health tech business
selling into clinics.

**Removing the name does not anonymise anything on its own.** A number plus a niche plus a date
identifies a company to anyone in that market, and Josh's readers are in that market. This has to
be an actual test, not a hope — it is the failure mode that costs him a client rather than a post.

Where a moment cannot survive without identifying someone, two options in order: use Josh's own
numbers instead of theirs, or park it. **Parking it is a correct outcome.**

## Rationing

The direct ask is rationed to roughly one post in five. If the last few have used it, say so.

## The life pillar has a landing requirement

A life post must land somewhere the buyer recognises, at the same altitude as everything else. The
walk is not the post; what he worked out on the walk is.

---

**Thought Pilot:** two notes on how these are enforced, so you know which are mechanical and which
are judgements.

The client-naming rule is already two separate mechanisms, deliberately. The "names cleared" check is a
literal string search performed before any model runs — it cannot have an off day. The "identifiable"
check is the model reading for a figure, a niche or a timeline that identifies someone anyway. The
first catches the name; only the second catches the shape, which is the one you are describing.

The one-in-five rationing is not yet enforced automatically. It needs the last five published posts
to count against, and nothing has published. Until LinkedIn is connected it is a rule the drafter is
told, not one the gate can measure.`,

  reference_posts: `# Reference posts — structure only

Eight accounts, per clause 8.3. **Structural reference only. Never a source of voice, never copied,
never quoted.**

- linkedin.com/in/demandjen1
- linkedin.com/in/ryanscarlin
- linkedin.com/in/outboundphd
- linkedin.com/in/curtishowland
- linkedin.com/in/adam-treboutat
- linkedin.com/in/juliacarter98
- linkedin.com/in/amangrowth
- linkedin.com/in/mattjbarker1

What to take: how they get in, what they hold back, where the turn lands, how they use the space
above the fold.

What never to take: their words, their cadence, their phrasing. Not quoted, not near-quoted, not
paraphrased. If a run of words from one of these could be recognised in a draft, it has been used
wrongly. Josh's voice comes from the voice guide and nowhere else.`,
};

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
  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };

  const before = await (await fetch(
    url + "/rest/v1/library_sections?select=key,title,version,body",
    { headers },
  )).json();
  const byKey = Object.fromEntries(before.map((s) => [s.key, s]));

  console.log("\n  Josh's reference library, v1.0 — 4 September 2026\n");
  console.log("  " + "─".repeat(66));

  for (const [sectionKey, body] of Object.entries(SECTIONS)) {
    const current = byKey[sectionKey];
    if (!current) {
      console.log("  ??  " + sectionKey.padEnd(18) + "no such section — skipped");
      continue;
    }
    const same = current.body?.trim() === body.trim();
    const mark = same ? "==" : APPLY ? "->" : "  ";
    console.log(
      "  " + mark + "  " + sectionKey.padEnd(18) +
        String(current.body?.length ?? 0).padStart(6) + " -> " + String(body.length).padStart(6) +
        " chars   v" + current.version,
    );

    if (!same && APPLY) {
      const res = await fetch(
        url + "/rest/v1/library_sections?key=eq." + encodeURIComponent(sectionKey),
        { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ body }) },
      );
      if (!res.ok) {
        console.error("      failed: " + res.status + " " + (await res.text()).slice(0, 200));
        process.exitCode = 1;
      }
    }
  }

  if (!APPLY) {
    console.log("\n  Dry run. Nothing written. Re-run with --apply.\n");
    return;
  }

  // The trigger bumps the version and snapshots the body, so the whole load is one reversible
  // change per section (8.4, 12.12). Read it back rather than trusting the write.
  const after = await (await fetch(
    url + "/rest/v1/library_sections?select=key,version,body",
    { headers },
  )).json();
  const now = Object.fromEntries(after.map((s) => [s.key, s]));

  console.log("\n  " + "─".repeat(66));
  let wrong = 0;
  for (const [sectionKey, body] of Object.entries(SECTIONS)) {
    if (now[sectionKey]?.body?.trim() !== body.trim()) {
      console.log("  !!  " + sectionKey + " did not take");
      wrong += 1;
    }
  }
  console.log(wrong === 0 ? "  All sections written and read back.\n" : "\n  " + wrong + " failed.\n");
  if (wrong > 0) process.exitCode = 1;
}

await main();
