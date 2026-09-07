#!/usr/bin/env node
/**
 * Josh's prompt set, version 1.0 (4 September 2026).
 *
 *   node scripts/load-prompt-set.mjs           # show what the parser would extract
 *   node scripts/load-prompt-set.mjs --apply   # write it
 *
 * WHY THIS SECTION IS DIFFERENT FROM THE OTHER NINE
 *
 * Every other library section is read by a model. This one is also read by a PARSER.
 * `parsePromptSet()` in _shared/questions.ts walks it line by line, and every line it accepts
 * becomes a row in `question_stats` — a real question the interviewer can ask, with its own record
 * of whether it has ever produced material (4.2.6). So the formatting here is load-bearing in a way
 * that no other section's is, and the same is true of pillars for a different parser.
 *
 * TWO THINGS THE PARSER DOES THAT JOSH CANNOT BE EXPECTED TO KNOW
 *
 * 1. A LINE NEEDS A QUESTION MARK, or it must start with one of tell/describe/walk/what/who/when/
 *    where/why/how. Five of Josh's thirty prompts are written as instructions rather than questions
 *    — "Something a person close to you said that shifted how you see the work." — and the parser
 *    drops them silently. Not an error, not a warning: 30 sent, 25 ingested.
 *
 *    Handled here by giving those five the closing question the other twenty-five already have.
 *    Every one is marked in the section body so Josh can see exactly what was added to his words
 *    and delete it. They are listed in the report this script prints, too.
 *
 * 2. DEPTH IS TAGGED FROM MARKDOWN HEADINGS, and only from headings containing "scene", "time",
 *    "perspective" or "earned". Josh wrote his three depths as bold labels, which are not headings,
 *    so as sent they would all have landed with depth = null. They are headings here.
 *
 * THE UNDERLYING DEFECT, NOT FIXED HERE, DELIBERATELY
 *
 * Requiring a question mark is a bad rule. A prompt is a prompt whether or not it ends in one, and
 * clause 8.8 promises Josh he can add a rule in under a minute — which he cannot do safely if a
 * punctuation mark decides whether his edit takes effect. The honest fix is in parsePromptSet.
 *
 * That fix is not made here because questions.ts lives in `_shared`, every Edge Function bundles
 * its own copy, and shipping it means ten redeploys that cannot currently be verified — S0-01 and
 * S0-02 are blocked for want of a SUPABASE_ACCESS_TOKEN. Making an unverifiable change to shared
 * code, to fix a silent-drop bug, is how the next silent-drop bug gets introduced. It is written
 * down instead, and the section is shaped to survive the parser as it actually is.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** The five whose closing question was added so the parser would see them. */
const QUESTION_ADDED = [6, 15, 18, 20, 24];

const PROMPT_SET = `# The prompt set

Josh's, v1.0 (4 September 2026). Four sets, doing four different jobs.

| Set | Job | Runs when |
|---|---|---|
| 1. Mining a moment | Turn a sentence into something only Josh could have written | After every input, whichever door it came in through |
| 2. The weekly sweep | Refill the bank when nothing obvious has happened | Once a week, ten minutes |
| 3. The interview | Go looking when the sweep comes back empty | On request, longer session |
| 4. The thirty prompts | A specific door into a memory when open questions produce nothing | On request, one at a time |

**Thought Pilot, on editing this section.** It is read by a parser as well as by a model: every
question below becomes a row in the question bank with its own record of whether it has ever
produced anything. Two consequences. Write each question as a bullet or a numbered line. And give it
a question mark — the parser currently requires one, which is a defect on our side rather than a
rule you should have to remember. Five of your thirty prompts needed a closing question added for
this reason, and each is marked **[closing question added]**. Delete the addition if you dislike it;
just leave a question mark somewhere in the line.

---

## Set 1 — mining a moment

The part that does the actual work. Maps to clause 5.

### First, how deep does the material go

Three depths, in order. Stop as soon as one produces something.

#### Depth 1 — a specific scene

Always the goal. A real moment, with a time, a place, a person and a detail.

- Was there a specific moment where this actually happened?
- Who was in the room when it happened?
- What was the detail you still remember about it?

#### Depth 2 — time-anchored

A memory located in a period rather than a scene. Walk backwards, because a time prompt gives the
brain one drawer to search instead of the whole house.

- When did this come up most recently — last week, or last month?
- Was there a stretch, three or six months back, when this kept happening?
- When you were starting out, how did this look then?

#### Depth 3 — earned perspective

No single moment, but a view built from years of the work with the track record behind it. A weaker
pass than depth 1 or 2, and still a pass, because not everyone has that history.

- How many times have you seen this, and across how long?
- What have you watched change about this over the years you have been doing it?

### None of the above

Park it. Do not manufacture a story. There is always another topic Josh can write from experience,
so find that one instead.

### Then mine it

Six questions, in this order.

1. What happened right before this?
2. Who was there?
3. What did they actually say? Can you remember any of the words?
4. How did you feel in that moment?
5. What did you realise? What changed for you?
6. What would you want someone reading this to take away?

### How it asks

- One question at a time, then wait. Not a list in one message.
- Short and conversational.
- Push back once on a vague answer. Twice is nagging.
- Never invent a detail, a quote, a number or a name to fill a gap. Missing detail stays missing and
  the draft works without it.
- Never write draft sentences during the interview. The job here is only to ask.
- Establish who the post is for, and record it.
- Know when to stop. A session that runs to fifteen questions gets abandoned. Take what you have.
- If Josh gives you something strong, say so. It teaches him what good material feels like.

### What it writes back

Four things: the moment, the detail, the realisation, the lesson. Plus the pillar it thinks this
belongs to, so Josh can correct it.

---

## Set 2 — the weekly sweep

Designed to produce five candidates from an ordinary week where nothing dramatic happened.

1. What happened this week that surprised you, even slightly?
2. What did you have to work out that you did not know before?
3. What did a client or a colleague say that stuck with you?
4. What did you see someone doing wrong that you have also done wrong?
5. What small thing happened that made you think about something bigger?

---

## Set 3 — the longer sitting

Five categories. Follow the energy rather than marching through them: if Josh lights up about
something, dig there and abandon the rest.

### Recent moments

- What happened in the last month that surprised you, even slightly?
- Did you have a conversation recently that stuck with you? What was actually said?
- Did a client do or say something you did not expect?
- Was there a moment where something clicked and you understood it differently?
- What frustrated you professionally that felt like it should not be that way?

### Wins and progress

- What worked recently, even something small?
- Who did you help this month, and what actually happened?
- What result are you quietly proud of, even if the number is not big?
- What do clients thank you for most?

### Mistakes and lessons

- What did you used to believe about this work that you have since changed your mind on?
- What early mistake taught you something you still use?
- What would you tell yourself when you were starting out?
- What did you get wrong on an engagement, and what did it teach you?

### Observations and opinions

- What do most people in this field get wrong?
- What is common advice in go-to-market that you think is actively bad?
- What do clients consistently struggle with?
- What do you believe that not everyone would agree with?
- What is overhyped right now, and what is underrated?

### The work itself

- Walk me through something you did recently. What actually happened?
- What does your day look like that would surprise someone outside it?
- What question do you get asked constantly?
- What do you do that looks simple and is not?

### What to do with each answer

Look for a specific moment, a genuine reaction, a realisation, or something that would make another
operator think *I have felt that too* or *I had not thought about it that way*. If it is there, probe
further with set 1. If it is not, move on. Do not force it.

---

## Set 4 — the thirty prompts

Each one is already matched to a pillar and a body framework. One at a time, never as a list. These
are the specific doors, and they are what a seeding session (clause 6) runs on.

1. A client said something in passing that changed how you run engagements. Not a complaint. A throwaway line that stopped you. What did they say, and what did you change?
   *Career and business · what, why, how*
2. A mistake inside the method itself, not the business. A data source you trusted, a segment that did not hold, an approach you were confident in that turned out to be wrong. When did you find out? What replaced it?
   *Expertise and craft · problem, agitate, solve*
3. Something you do outside work that solved a work problem. A run, a drive, a chore. What were you stuck on, and what landed?
   *Life · hook, frame, insight, lesson*
4. The first time you raised your rate, or turned down work that would have paid. What made you do it, what happened after, and what does it now tell you about pricing?
   *Career and business · what, why, how*
5. The mistake you can spot in someone's outbound inside thirty seconds. The obvious one. The one you made yourself. Why does everyone make it, and what is the fix?
   *Expertise and craft · problem, agitate, solve*
6. Something a person close to you said that shifted how you see the work. Not career advice. Something human that landed unexpectedly. What did they say? **[closing question added]**
   *Life · hook, frame, insight, lesson*
7. Your worst engagement. Not for the drama, for the red flags you talked yourself past. What were they, and what do you now do in the first conversation because of it?
   *Career and business · what, why, how*
8. A method you built yourself through repetition, because things kept going wrong the same way. What is it, how does it work, and why does it work?
   *Expertise and craft · hook, frame, insight, lesson*
9. Something outside work you failed at and went back for. What did the failure teach you that finishing first time would not have?
   *Life · what, why, how*
10. The moment the business stopped feeling precarious. Not a vanity milestone. What had you been doing in the background that you did not realise was working?
    *Career and business · problem, agitate, solve*
11. A belief about go-to-market you held early and no longer hold. What was it, when did it crack, and what do you believe now?
    *Career and business · hook, frame, insight, lesson*
12. The question clients ask you most. What does the question itself reveal about where they are stuck, and what is the answer that makes the question obsolete?
    *Expertise and craft · problem, agitate, solve*
13. A book, film, conversation or hobby from completely outside this field that changed how you work. What crossed over?
    *Life · hook, frame, insight, lesson*
14. A decision that looked wrong to everyone around you and turned out right. Or one that looked smart and did not play out. What does it tell you about how you decide?
    *Career and business · what, why, how*
15. A small technique inside the method that most people skip. Something that sounds almost too simple, and makes an obvious difference when applied. What is it? **[closing question added]**
    *Expertise and craft · hook, frame, insight, lesson*
16. Your relationship with stopping. A time you pushed through and paid for it, or took time off and it unlocked something. What changed about how you treat your own energy?
    *Life · what, why, how*
17. The gap between what a client thinks they are hiring you for and the job that actually determines whether it works. What is the real job?
    *Expertise and craft · problem, agitate, solve*
18. Someone who made you materially better at this, not through a lesson but through a standard they held you to or a way of working you absorbed. Who were they, and what did you take? **[closing question added]**
    *Career and business · hook, frame, insight, lesson*
19. A money decision made under pressure. Or money spent on something that felt reckless and turned out to be the best call you made. What does it say about how you take risk?
    *Career and business · what, why, how*
20. A widely held belief in this industry that your own work has quietly disproved. Not a hot take. Something you believed, tested, and found false or far more complicated. What was it? **[closing question added]**
    *Expertise and craft · hook, frame, insight, lesson*
21. The hardest conversation you have had professionally. Not the most dramatic, the one that took the most nerve. What made it hard, and what happened after?
    *Career and business · what, why, how*
22. Something you quit. A sport, a side project, a career path. Do you regret it, or did the quitting teach you what you actually wanted?
    *Life · hook, frame, insight, lesson*
23. What nobody told you before you went out on your own. The gap between what you expected and what you found. What would you tell someone about to find out the same way?
    *Career and business · problem, agitate, solve*
24. Your honest take on a tool or trend everyone is talking about right now. Not the consensus. Yours, based on actually using it and seeing what it does and does not produce. What is it? **[closing question added]**
    *Expertise and craft · hook, frame, insight, lesson*
25. A moment of pride with no metric attached. Small, unglamorous, significant to you and possibly only to you. Why did it land harder than the external wins?
    *Life · what, why, how*
26. A partnership, referral relationship or introduction that changed the business rather than just helping it. What did they bring that you could not have built?
    *Career and business · what, why, how*
27. The first question you ask at the start of every engagement. The one that cuts to what will make or break it. Why does it matter, and what happens when you get the answer?
    *Expertise and craft · problem, agitate, solve*
28. A life stage shift that rewired how you work. Something that happened in your life rather than your career. What do you do differently now?
    *Life · hook, frame, insight, lesson*
29. A segment or a data recipe that looked brilliant on paper and did not work. What did you assume, and what did the failure teach you about how you build them?
    *Expertise and craft · problem, agitate, solve*
30. A client or a piece of work you turned down. What was the decision actually about, underneath the stated reason?
    *Career and business · hook, frame, insight, lesson*`;

/* ── A faithful copy of parsePromptSet, so the write can be previewed ─────── */
//
// questions.ts imports the Supabase client through an `npm:` specifier, so Node's loader will not
// resolve it and the real function cannot be imported here. The regexes are copied verbatim from
// _shared/questions.ts. If that file changes and this does not, the preview lies — so the e2e
// harness asserts the two agree (X-07).

function parsePromptSetCopy(promptSet) {
  const out = [];
  let depth = null;

  for (const raw of promptSet.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      const h = line.replace(/^#+\s*/, "").toLowerCase();
      if (h.includes("scene")) depth = "scene";
      else if (h.includes("time")) depth = "time_anchored";
      else if (h.includes("perspective") || h.includes("earned")) depth = "earned_perspective";
      else depth = null;
      continue;
    }

    const text = line.replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (text.length < 8) continue;
    if (!text.includes("?") && !/^(tell|describe|walk|what|who|when|where|why|how)/i.test(text)) {
      continue;
    }
    out.push({ text, depth });
  }
  return out;
}

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
  const parsed = parsePromptSetCopy(PROMPT_SET);
  const byDepth = parsed.reduce((acc, q) => {
    const k = q.depth ?? "(none)";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\n  Prompt set — Josh v1.0, 4 September 2026\n");
  console.log("  " + "─".repeat(70));
  console.log("  the parser would ingest " + parsed.length + " questions");
  for (const [d, n] of Object.entries(byDepth)) {
    console.log("    " + String(n).padStart(3) + "  depth " + d);
  }

  // A pipe in a question means a markdown table row was ingested whole, which is what happens if
  // set 4 is left in the shape Josh sent it. Loud, because the result reads fine in the database
  // and only looks wrong inside a prompt.
  const tainted = parsed.filter((q) => q.text.includes("|") || /^\*/.test(q.text));
  if (tainted.length > 0) {
    console.error("\n  !! " + tainted.length + " question(s) carry table or emphasis markup:");
    for (const q of tainted.slice(0, 5)) console.error("     " + q.text.slice(0, 90));
    process.exit(1);
  }
  console.log("  no question carries table pipes or stray markup");

  // All thirty of set 4 must survive. This is the check that would have caught the silent drop.
  const setFour = parsed.filter((q) => /·/.test(q.text) === false && q.text.length > 110);
  console.log("  " + setFour.length + " long-form prompts ingested (set 4 should be 30)");
  console.log("  closing question added to prompts: " + QUESTION_ADDED.join(", "));

  const { url, key } = credentials();
  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

  const [current] = await (await fetch(
    url + "/rest/v1/library_sections?select=version,body&key=eq.prompt_set",
    { headers },
  )).json();

  console.log("\n  prompt_set   " + String(current?.body?.length ?? 0).padStart(6) + " -> " +
    String(PROMPT_SET.length).padStart(6) + " chars   v" + current?.version);

  if (!APPLY) {
    console.log("\n  Dry run. Nothing written. Re-run with --apply.\n");
    return;
  }

  const res = await fetch(url + "/rest/v1/library_sections?key=eq.prompt_set", {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ body: PROMPT_SET }),
  });
  if (!res.ok) {
    console.error("  failed: " + res.status + " " + (await res.text()).slice(0, 300));
    process.exit(1);
  }

  const [after] = await (await fetch(
    url + "/rest/v1/library_sections?select=version,body&key=eq.prompt_set",
    { headers },
  )).json();
  const ok = after?.body?.trim() === PROMPT_SET.trim();
  console.log("\n  " + "─".repeat(70));
  console.log(ok ? "  Written and read back. Now v" + after.version + ".\n" : "  !! did not take\n");
  console.log("  The questions reach question_stats on the next interview, not now — syncQuestions");
  console.log("  runs inside the interview handler. Nothing is inserted until Josh sends something.\n");
  if (!ok) process.exitCode = 1;
}

await main();
