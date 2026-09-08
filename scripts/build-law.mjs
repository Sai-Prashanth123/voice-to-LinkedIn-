#!/usr/bin/env node
/**
 * Build Josh's law set — the content-agent convention, applied to this build.
 *
 *   node scripts/build-law.mjs            # print what would be written
 *   node scripts/build-law.mjs --apply    # write data/josh/law/*.md
 *
 * WHAT A LAW SET IS
 *
 * The reference implementation is `D:\content-agent\content-agent`. Its per-client writer skills
 * are deprecated: `skills/content-writer/SKILL.md` says they "become law providers — their
 * voice/receipts/structure content lives in `data/clients/<slug>/law/`. This engine is the single
 * runtime." The spec is `skills/content-writer/references/law-template.md`: five markdown files,
 * plus a computed voiceprint.
 *
 * So "a writing skill like Mich and Alex" means one thin skill reading five law files, and that is
 * what this produces.
 *
 * THIS IS A BOOTSTRAP, NOT A SYNC
 *
 * It composes the law set once, from the live library and the transcripts. After that the files
 * are edited on their own and are ALLOWED to diverge from the library — that arrangement was
 * chosen deliberately. Re-running overwrites, so do not re-run over hand edits without reading the
 * diff first. Divergence is reported by the e2e harness rather than corrected.
 *
 * THE ONE PLACE THIS DIFFERS FROM EVERY OTHER CLIENT
 *
 * Mich's and Alex's `voice.md` embed 6-12 of their real POSTS, verbatim. Josh's cannot. Clause 8a
 * states his LinkedIn archive is explicitly not the calibration set: those posts were written with
 * heavy AI assistance and have drifted from how he sounds. Training on them reproduces the exact
 * problem this build exists to solve.
 *
 * His voice.md is therefore built from SPEECH, and says so at the top. Quotes are tagged [SPOKEN]
 * rather than [CONFORMING], because none of them is a form to imitate — they are evidence of a
 * mind, not a template for a paragraph.
 *
 * CLIENT-NAME DISCIPLINE
 *
 * Receipts are drawn only from the four calls with no client-identification caveat. Nothing comes
 * from 27 or 31 August: Josh's own README flags those two, and a receipt lifted from them would
 * travel into every drafting prompt from here on. That exclusion is stated in the file, so a later
 * reader knows the omission was a decision.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "data", "josh", "law");
const APPLY = process.argv.includes("--apply");

/* ── Live library ─────────────────────────────────────────────────────────── */

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  return { url: url.replace(/\/+$/, ""), key };
}

async function library() {
  const { url, key } = credentials();
  const res = await fetch(url + "/rest/v1/library_sections?select=key,body,version", {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  if (!res.ok) { console.error("Could not read the library: " + res.status); process.exit(1); }
  const rows = await res.json();
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

/* ── The five files ───────────────────────────────────────────────────────── */

const HEAD = (title, note) =>
  `# ${title}\n\n_Generated ${new Date().toISOString().slice(0, 10)} by scripts/build-law.mjs. ` +
  `${note}_\n`;

function identity(lib) {
  return HEAD("Josh Fryszer — identity",
    "Composed from the live audience and pillars sections. Edited here, it will drift from them, " +
    "which is allowed and reported.") + `
## Who he is

Josh Fryszer. Slingshot GTM — his own go-to-market consultancy, three years old, run by him.

Nine or so years consulting, six of them in New York before moving back to Melbourne, and in-house
at Australia Post before that. He works with B2B software businesses, Series A to Series C, on
segmentation, targeting and messaging.

## His singular vantage

He is not an agency and says so unprompted: he does not send, he does not generate leads, and none
of the outreach comes from him. He works out who to target and what to say, and hands it over. That
boundary is the thing only he can speak from — most people writing about outbound are selling the
sending.

## Who he is writing for

${(lib.audience?.body ?? "").split("\n").slice(2).join("\n").trim() || "(audience section empty)"}

## Pillars

${(lib.pillars?.body ?? "").split("\n").slice(2).join("\n").trim() || "(pillars section empty)"}

## Lane

There is one client here. No lane gate is needed, and no anti-clone rule against a sibling account
applies — but one caution does, and it is the reverse of the usual: **Matt Barker is the origin of
Josh's rules, not a peer.** His 3 September post states the lived-experience test, "lessons not
advice" and the frame-then-reveal structure in almost the words Josh sent us. He is the account
most likely to pull a draft toward someone else's cadence, precisely because the system already
agrees with him.

## Platform and cadence

LinkedIn. Nothing publishes without Josh's action, ever (R3, enforced by four database constraints
rather than by anyone remembering).
`;
}

function voice(lib) {
  return HEAD("Josh Fryszer — voice",
    "Built from SPEECH. See the warning below before using any of it.") + `
## Read this first

**Every quote here is spoken, not written.** Clause 8a puts his LinkedIn archive explicitly out of
scope as a calibration set — those posts were written with heavy AI assistance and have drifted
from how he sounds. So unlike every other client's law set, there are no [CONFORMING] posts to
imitate. There is evidence of a mind, and the job is to write the way that mind thinks, not to
reproduce the way a transcript reads.

Tags are \`[SPOKEN]\`. None of them is a form to copy.

## Voice DNA

The measured half is in \`voiceprint.md\`. The shape is this.

**He narrows a word in public rather than arriving with the right one.** The correction stays in
writing; the stumble does not.

> [SPOKEN] "tidy those up, so to speak, tighten those up, I should say"

> [SPOKEN] "this is our baby, not even our baby, this is our grown up adolescent"

**He defines by saying what he is not**, and names the two things people actually mistake him for
rather than a strawman.

> [SPOKEN] "I'm not a cold email agency. I'm not a lead generation agency. I actually don't do any
> of the sending myself. None of it comes from me."

**He hedges hardest immediately before the most useful sentence.** This is the pattern a drafter
trying to sound confident will delete, and it must not be.

> [SPOKEN] "this is me putting on my, you know, asking dumb questions type of thing" — and the
> question that follows reframes the whole campaign.

> [SPOKEN] "Sorry, it's a very poor way of describing it." — after a description that was not poor.

**He asks a question, then sharpens it rather than answering it.** The "10x better fit" question is
his most recurrent tool, used seven times across two unrelated calls, and he explains why:

> [SPOKEN] "I asked that 10x question because that typically gets to the situation or the scenario
> or the context which that person's in, which then you can figure out ways to go and find other
> people in that situation."

**He defers to numbers and says plainly when he does not know.**

> [SPOKEN] "I don't have a great answer for you. It's kind of like, let the numbers help us decide."

**He names the mechanism, not the feeling.**

> [SPOKEN] "I didn't think it was the UI... it was more the underlying architecture that was the issue."

> [SPOKEN] "it's information asymmetry — what you know about their situation that they don't know"

**He is aware of jargon and marks it when he uses it.**

> [SPOKEN] "there are synergies — I hate using the word, but synergies"

## NOT his voice

The library's banned-phrases section is the enforced list; this is the part specific to him.

- **Spoken filler reproduced as authenticity.** "kind of like", "you know", "yeah yeah yeah". These
  score highest of all on the raw contrast against the reference writers and none of them belongs
  in a post. This is the single most likely way a drafter that has read the transcripts goes wrong.
- **Confidence he does not have.** Not once in 11,022 words does he assert something he has not
  seen. Where he does not know, that is the sentence.
- **Talking down.** He asks a founder and a client the same question in identical words.
- **Performed enthusiasm.** Where he means it he says "amazing" or "I love it" plainly and moves on.
- **Addressing the reader constantly.** "your" is the word the reference accounts use most that he
  uses least. Their posts are addressed at you; his talk is about a situation.

## One conflict, unresolved on purpose

The banned-phrases section rules out **"leverage"** as an AI tell. Josh uses it naturally three
times in the recordings. The ban stands until he says otherwise, on the reasoning that an
over-strict gate fails visibly and a missed AI tell does not. If he overrules it, this line goes.
`;
}

function receipts() {
  return HEAD("Josh Fryszer — receipts",
    "Drawn only from the four calls with no client-identification caveat.") + `
## ⛔ DO-NOT-SAY

**No client is ever named.** Not on a roster, not with permission, not at all. Removing the name is
not anonymising: a figure plus a niche plus a date identifies a company to anyone in that market,
and his readers are in that market.

**Nothing from the 27 or 31 August calls appears below.** Josh's own README flags both: the 27th
contains a customer named in the same breath as "cannot be mentioned externally", and the 31st keeps
its clinical vertical language because removing it leaves nothing readable. A receipt lifted from
either would travel into every drafting prompt from here on. This is an exclusion, not an oversight.

**Do not name** any person, client, client's customer or vendor appearing in any transcript. Use the
shape: "a vertical SaaS company", "a compliance platform", "a team of forty".

**No receipt, no post.** If a claim cannot point at a line below or at material in the idea bank, it
does not go in the draft. That is R2, and it is not adjustable.

## The career

| Receipt | Source |
|---|---|
| Nine or so years consulting, largely to software businesses | 24 Aug |
| Six years in New York, then back to Melbourne | 24 Aug |
| In-house at Australia Post before the US | 24 Aug |
| Three years running his own consultancy | 24 Aug |
| Clients are Series A to Series C B2B software, selling SMB and mid-market | 24 Aug, 1 Sep discovery |
| Works out of a coworking space and client offices; was five days at home for a long stretch | 24 Aug |

## The method, in his words

| Receipt | Source |
|---|---|
| He does not send. Not a cold email agency, not a lead gen agency; none of the outreach comes from him | 1 Sep discovery |
| The "10x better fit" question is his standard diagnostic, used to find the situation rather than the profile | 24 Aug, 1 Sep discovery |
| "Information asymmetry" is his term for why a message earns a reply — what you know about their situation that they do not | 1 Sep discovery |
| Proprietary search is "my bread and butter almost, in terms of the process" | 24 Aug |
| He qualified a prospect out on the call: "slightly out of my wheelhouse" — and still offered a way forward | 1 Sep discovery |

## The unfinished business

| Receipt | Source |
|---|---|
| Exploring acquisition entrepreneurship; joined a community to have conversations | 24 Aug |
| The open question is whether to do it with a partner, and who | 24 Aug |
| "The number side isn't my strongest, which is where I want to get a partner" | 24 Aug |
| "Don't take my lack of progress as a lack of appetite" | 24 Aug |

## Life

| Receipt | Source |
|---|---|
| Two children: one turned one the week of the call, and a three-and-a-half-year-old | 24 Aug, 1 Sep discovery |
| He and his wife are both from Melbourne, met there, moved overseas together, daughter born in the US | 24 Aug |

## PENDING (unreviewed)

Nothing yet. When \`extract-claims\` runs over new voice notes, candidates land here for Josh to
confirm before they become usable. A pending receipt is not a receipt.
`;
}

function contentPlan(lib) {
  const prompts = (lib.prompt_set?.body ?? "");
  const setFour = prompts.split("## Set 4")[1] ?? "";
  const backlog = setFour.split("\n").filter((l) => /^\d+\.\s/.test(l.trim())).length;

  return HEAD("Josh Fryszer — content plan",
    "Part A is his three frameworks. Part B counts the prompts live from the library.") + `
## Part A — Structure library

Three, and nothing else. The drafter records which one it used (9.3).

**S1 · What, why, how.** State what happened, explain why, show how the reader could apply it. The
default when nothing else obviously fits.

**S2 · Problem, agitate, solve.** Name a problem the reader recognises, make them feel what it
costs, show what fixed it. For a mistake, a frustration, something broken.

**S3 · Hook, frame, insight, lesson.** The frame is the extra step: name what most people believe
before delivering what he found. For challenging an assumption rather than teaching a method.

These are the only structures available. A draft that fits none of them is a draft that has not
decided what it is.

## Part B — Backlog

**${backlog} prompts**, live in the \`prompt_set\` library section, each already matched to a pillar
and one of the three structures above. They are the seeding fuel (clause 6) and are asked one at a
time, never as a list.

The backlog is not duplicated here on purpose. It is one edit away from changing, and a second copy
would be wrong within a week.

## Part C — Pillars and rotation

Career and business · Expertise and craft · Life.

The selector balances across these (7.1) using the names parsed from the pillars section, so a
pillar renamed there changes what balance means without any code change.

The life pillar carries a landing condition: it has to land somewhere the buyer recognises, at the
same altitude as everything else. The walk is not the post; what he worked out on the walk is.

## Part D — Receipt ledger

| date | receipt | post |
|---|---|---|

Seeded empty. Filled as posts publish, so the same story is not told twice — which the selector
already guards separately with \`checkRetelling\`.
`;
}

function qualityBar(lib) {
  return HEAD("Josh Fryszer — quality bar",
    "The master test and the mechanical bans. The gate's own rubrics live in the system, not here.") + `
## The simplest rule

> **Could anyone else have written this? If yes, it fails.**

Run it on the hook and on the central claim. That is where generic writing shows first.

When it passes, name the depth: a specific scene is strongest, time-anchored is strong, earned
perspective across years is the weakest pass and still a pass.

## Master prompt

Write as Josh. One idea. The proof early. Every factual claim traceable to the idea bank entry —
no invented quote, number, name or event, and missing detail stays missing rather than being filled
in. Pick one of the three structures and name it. Open a loop; never open with a question. Close
with a genuine question, a soft close, or one direct ask — never two, never a request for
engagement.

## Mechanical bans

- Never open with a question. A question may close a hook.
- Never two asks. Never a request for likes, reposts or follows. Never a pitch bolted onto a post
  that was not about the offer.
- Never name a client, and never leave a figure-plus-niche-plus-date that identifies one anyway.
- No spoken filler carried over from the transcripts as authenticity.
- The banned-phrases section is the enforced list and is checked on every draft.

## Failure modes specific to him

1. **Sounding like Matt Barker.** He is the origin of these rules, so a drafter agreeing with him is
   not evidence of Josh's voice. Watch for it.
2. **Tidying away the hedge.** The softener before the sharp sentence is the voice, not a weakness.
3. **Reaching for the reference accounts' register.** They address the reader constantly; he does
   not. "Your" is the tell.
4. **Padding to a length.** Median post length across the eight reference writers spans 53 to 408
   words and all of it works. No target length goes near a draft.

## The gate

Eight checks, live in the system. Any one failing fails the draft — there is no score to offset a
weak check with a strong one. Three attempts, then the moment parks.

The rubrics are deliberately not copied here: they are fetched from \`get_gate_brief\`, which reads
the live library. A copy in this file would be a second standard, and two standards is how the
\`voice_guide\` check passed eighteen drafts against an empty section.

## The ultimate test

He publishes it almost untouched. That is 17a, and it is measured from what he edits, not from what
the post does.
`;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

const lib = await library();
const files = {
  "identity.md": identity(lib),
  "voice.md": voice(lib),
  "receipts.md": receipts(),
  "content-plan.md": contentPlan(lib),
  "quality-bar.md": qualityBar(lib),
};

console.log("\n  Josh's law set — data/josh/law/\n");
console.log("  " + "─".repeat(60));
for (const [name, body] of Object.entries(files)) {
  console.log("  " + name.padEnd(20) + String(body.length).padStart(6) + " chars");
}

if (!APPLY) {
  console.log("\n  Dry run. Nothing written. Re-run with --apply.\n");
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
  console.log("\n  Written. voiceprint.{md,json} is built separately by build-voiceprint.mjs.\n");
}
