#!/usr/bin/env node
/**
 * The voice guide, derived from Josh's own speech (clause 8.1, 8.2).
 *
 *   node scripts/load-voice-guide.mjs           # show what would change
 *   node scripts/load-voice-guide.mjs --apply   # write it
 *
 * WHY THIS EXISTS AND WHY IT IS SEPARATE FROM load-josh-library.mjs
 *
 * The other eight sections are Josh's words, sent to us. This one is not. It is OUR READING of six
 * recorded calls, and that difference matters enough to keep the two scripts apart: he can accept
 * the eight and reject this one, and nothing about the eight depends on it.
 *
 * The section's own placeholder said "DELIBERATELY EMPTY. This one cannot be drafted for you." That
 * was correct on the day it was written, because the reason given was that there was no recording.
 * Six calls arrived on 7 September 2026 — 11,022 words of Josh talking, across five registers.
 * The stated blocker is gone, so the placeholder is replaced rather than appended to.
 *
 * THE MISTAKE THIS GUIDE IS BUILT TO AVOID
 *
 * A voice guide derived from transcripts has one obvious failure mode: it describes SPEECH. Josh
 * says "kind of like" ten times and "you know" constantly, and a guide that faithfully recorded
 * that would teach the gate to demand filler in written posts. The transcripts are evidence of how
 * he THINKS, and only some of that survives the move to the page. The guide says which, explicitly,
 * because the gate reads this section and will apply whatever it finds.
 *
 * WHAT IS QUOTED, AND WHAT IS NOT
 *
 * Every quote is from the four non-client calls: the networking call, the prospect discovery call,
 * the product feedback session, and our own kickoff. Nothing is quoted from the 27 or 31 August
 * client sessions. Those are the two Josh's README flags as carrying identifying detail, and a
 * quote lifted out of them would travel into every drafting prompt from here on.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const VOICE_GUIDE = `# Voice guide

**Derived, not supplied. Josh has not confirmed this yet.**

Built by Thought Pilot on 7 September 2026 from six recorded calls (24, 27, 31 August and three on
1 September) — 11,022 words of Josh talking, in five different registers: his own career, running
client discovery, sitting in a room he does not chair, qualifying a prospect out, and giving
critical feedback on someone else's product.

Josh: this is a reading, and readings can be wrong. Cut anything you do not recognise. The parts
you delete are as useful to us as the parts you keep.

---

## The rule that governs everything below

**This is a guide to how he thinks, not a transcript of how he talks.**

He says "kind of like" ten times across six calls, "you know" constantly, and repeats words in
threes when he is searching — "good, good, good", "yeah, yeah, yeah". **None of that goes in a
post.** Written filler does not read as authentic, it reads as padding, and a draft that imitated
his speech disfluencies would fail the master test by sounding like a transcript rather than like
him.

What transfers is the shape of the thinking underneath. That is what the rest of this section
describes.

---

## How he actually builds a thought

### 1. He narrows a word in public instead of arriving with the right one

The most distinctive thing he does. He says a word, hears that it is not quite right, and corrects
it out loud — and the second word is always more precise than the first.

> "tidy those up, so to speak, tighten those up, I should say"

> "this is our baby, not even our baby, this is our grown up adolescent"

**In writing:** keep the correction, lose the stumble. "Not our baby. Our grown-up adolescent." The
move is showing the reader the more precise word arriving. It is not a stylistic tic to sprinkle in
— it earns its place when the first word was genuinely the obvious one and the second is genuinely
better.

### 2. He defines by saying what he is not

Three negations in a row, then the positive.

> "I'm not a cold email agency. I'm not a lead generation agency. I actually don't do any of the
> sending myself. None of it comes from me."

**In writing:** transfers directly, and it is one of the strongest things he does. Note it is
specific — he names the two things people actually mistake him for, not a strawman.

### 3. He hedges hardest immediately before the most useful sentence

This is the pattern most likely to be edited out by a drafter trying to sound confident, and it
should not be.

> "this is me putting on my, you know, asking dumb questions type of thing" — and the question that
> follows is the one that reframes the campaign.

> "Sorry, it's a very poor way of describing it." — after a description that was not poor at all.

> "I love this tool... don't take this as—" — immediately before the sharpest criticism in the call.

**In writing:** the softener stays, compressed. One clause, not three. "This might be a stupid
question." Then the question. The hedge is not weakness; it is how he makes it safe for the other
person to be wrong.

### 4. He asks a question, then sharpens it rather than answering it

> "what makes a good fit prospect for each of those? And then when you push that even further, what
> makes a 10x better fit?"

The **"10x better fit"** question is his single most recurrent tool — it appears seven times across
two unrelated calls, and he explains why he uses it:

> "I asked that 10x question because that typically gets to the situation or the scenario or the
> context which that person's in, which then you can figure out ways to go and find other people in
> that situation."

**In writing:** transfers, with the constraint from the hooks section that a question may close a
hook but never open one.

### 5. He defers to numbers, and says plainly when he does not know

> "I don't have a great answer for you. It's kind of like, let the numbers help us decide."

> "I won't know that until I run those numbers."

> "the number side isn't my strongest, which is where I want to get a partner"

**In writing:** transfers. He is comfortable ending on an open question, and a post that admits the
limit of what he knows is more his voice than one that resolves cleanly.

### 6. He names the mechanism, not the feeling

Asked what was wrong with a product, he refuses the easy answer and locates it:

> "I didn't think it was the UI... it was more the underlying architecture that was the issue."

And on why outbound works, his own phrase for it:

> "it's information asymmetry — what you know about their situation that they don't know"

**In writing:** transfers, and it is the difference between a post that describes a problem and one
that diagnoses it.

---

## Vocabulary

### Actually his, with counts across the six calls

"figure out" (9) · "kind of like" (10, spoken only) · "whatever it might be" (5) · "quick win" (2) ·
"off the top of my head" (2) · "so to speak" (2) · "hang on a second" (2) · "bread and butter" ·
"sweet spot" · "low hanging fruit" · "spitballing" · "mad scramble" · "11th hour" · "through the
cracks" · "wheelhouse" · "candidly" · "transparently" · "recut" (a list) · "10x better fit" ·
"information asymmetry"

Australian and informal, and he does not modulate it for seniority: "buddy", "man", "dude" all
appear, to a stranger, a prospect and a supplier respectively.

### Not his

No "delve", "unlock", "game-changer", "double down", "deep dive", "at the end of the day", "in
today's landscape", "resonate", "robust", "seamless". Zero instances across 11,022 words.

He is aware of jargon and flags it when he uses it:

> "there are synergies — I hate using the word, but synergies"

**One conflict to resolve, Josh.** Our banned-phrases section currently bans **"leverage"** as an AI
tell. You use it naturally three times ("data you could potentially leverage"). We have left the ban
in place rather than quietly carving out an exception, because an over-strict gate fails visibly and
is easy to correct, while a missed AI tell is invisible. But it is your word, and if you want it
back, say so and it comes out.

---

## Sentence shapes

**Concrete before abstract, always.** He reaches for the number, the year, the headcount first:
"six years", "nine or so years", "series A to series C", "70 to 75%", "a one-year-old as of
Saturday". Abstraction arrives afterwards, if at all.

**Two paths, then the unanswered question.** How he structures a decision he has not made:

> "do I do it with a business partner... and that's kind of the big unanswered question right now"

He does not resolve it for the reader's comfort. He names it as open.

**Long when thinking, short when landing.** His exploratory sentences run to 100+ words. His
conclusions are blunt: "So that's where it's at." "Let the numbers help us decide." "That's the
output view." The formatting section's lean-fat-lean is not an imposed rule — it is already how he
talks.

---

## What he never does

- **Never claims a certainty he does not have.** Not once in 11,022 words does he assert something
  he has not seen. When he does not know, that is the sentence.
- **Never oversells himself.** "Don't take my lack of progress as a lack of appetite" is as close as
  he comes to self-promotion, and it is a defence, not a pitch.
- **Never talks down.** The 10x question is asked of a founder and a client in identical words.
- **Never performs enthusiasm he does not feel.** Where he is genuinely enthusiastic he says
  "amazing" or "I love it" plainly and moves on.

---

## Where this guide is weakest

Said plainly so it is not mistaken for more than it is.

**All six recordings are conversations.** Every sample is Josh responding to another person, and
none is him talking uninterrupted at length about a subject he chose. A monologue would show things
a dialogue cannot — how he opens when nobody has prompted him, and how he ends when nobody is
waiting to reply. Those are exactly the hook and the close.

**Registers are uneven.** There is a great deal of him asking questions and comparatively little of
him making an argument, because five of the six calls are ones where his job was to ask.

If a single 15-minute recording of Josh making a case for something, unprompted, ever exists, it
would improve this section more than another six calls of discovery.`;

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
    url + "/rest/v1/library_sections?select=key,version,body&key=eq.voice_guide",
    { headers },
  )).json();

  if (!current) {
    console.error("No voice_guide section. Apply migration 0004.");
    process.exit(1);
  }

  console.log("\n  Voice guide — derived from six calls, 7 September 2026\n");
  console.log("  " + "─".repeat(66));
  console.log(
    "  voice_guide   " + String(current.body?.length ?? 0).padStart(6) + " -> " +
      String(VOICE_GUIDE.length).padStart(6) + " chars   v" + current.version,
  );

  // The check that decides whether any of this reaches a prompt. `isSupplied` treats a body whose
  // head carries DELIBERATELY EMPTY or "FOR JOSH" as absent unless something is appended under a
  // `---` divider — and this guide DOES contain `---` dividers, so a stale placeholder head would
  // make it read as supplied for the wrong reason. Assert the head is clean instead.
  const headIsPlaceholder = /DELIBERATELY EMPTY/.test(VOICE_GUIDE.slice(0, 400)) ||
    /^#[^\n]*\n+\s*FOR JOSH\b/.test(VOICE_GUIDE);
  if (headIsPlaceholder) {
    console.error("\n  The new body still reads as a placeholder. Refusing to write it.\n");
    process.exit(1);
  }
  console.log("  head is not a placeholder, so isSupplied() will report it as content");

  if (!APPLY) {
    console.log("\n  Dry run. Nothing written. Re-run with --apply.\n");
    return;
  }

  const res = await fetch(url + "/rest/v1/library_sections?key=eq.voice_guide", {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ body: VOICE_GUIDE }),
  });
  if (!res.ok) {
    console.error("  failed: " + res.status + " " + (await res.text()).slice(0, 300));
    process.exit(1);
  }

  const [after] = await (await fetch(
    url + "/rest/v1/library_sections?select=version,body&key=eq.voice_guide",
    { headers },
  )).json();

  const ok = after?.body?.trim() === VOICE_GUIDE.trim();
  console.log("\n  " + "─".repeat(66));
  console.log(ok ? "  Written and read back. Now v" + after.version + ".\n" : "  !! did not take\n");
  if (!ok) process.exitCode = 1;
}

await main();
