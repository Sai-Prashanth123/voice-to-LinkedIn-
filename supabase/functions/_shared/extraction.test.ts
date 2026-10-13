import { test } from "node:test";
import assert from "node:assert/strict";
import {
  joshSaid,
  missingNumbers,
  PROSE_FIELDS,
  verifyExtraction,
  WRITTEN_UP,
} from "./extraction.ts";

/** What Josh actually said. Everything below is judged against this and nothing else. */
const SOURCE = `
WHAT JOSH SENT:
Had a call with a CFO yesterday that I have not stopped thinking about.

Q: What happened?
A: I was halfway through the deck and he stopped me. He said "if Dan goes, we start from zero".
Q: How many people were on the call?
A: Just the two of us. It was a 40 minute slot and we used about 12 minutes of it.
`;

const base = {
  the_moment: "The CFO interrupted the deck to ask about key-person risk.",
  the_detail: "",
  the_realisation: "",
  the_lesson: "",
  what_happened_before: "",
  who_was_there: "",
  their_actual_words: "",
  how_he_felt: "",
  what_changed: "",
  reader_takeaway: "",
  names: [] as { name: string }[],
};

test("a quote that was tidied is refused", () => {
  // The exact failure this exists to catch: the words are close, the meaning is right, and it is
  // not what he said. A draft would then quote it as verbatim and pass every downstream check.
  const r = verifyExtraction(
    { ...base, their_actual_words: "if Dan leaves, we start from nothing" },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.match(r.failures.join(" "), /their_actual_words/);
});

test("a verbatim quote passes, and so does one carrying a full stop", () => {
  const exact = verifyExtraction(
    { ...base, their_actual_words: "if Dan goes, we start from zero" },
    SOURCE,
  );
  assert.equal(exact.ok, true, exact.failures.join(" "));

  // A quotation takes the punctuation of the sentence it sits in. Same latitude claims.ts gives,
  // and it was added there because the strict version failed a real, honest quote.
  const punctuated = verifyExtraction(
    { ...base, their_actual_words: "if Dan goes, we start from zero." },
    SOURCE,
  );
  assert.equal(punctuated.ok, true, punctuated.failures.join(" "));
});

test("a number he never gave is refused, wherever it appears", () => {
  const r = verifyExtraction(
    { ...base, the_detail: "The renewal was worth 90,000 a year." },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.match(r.failures.join(" "), /90000|90,000/);
});

test("numbers he did give are fine", () => {
  const r = verifyExtraction(
    { ...base, the_detail: "A 40 minute slot, and they used 12 minutes of it." },
    SOURCE,
  );
  assert.equal(r.ok, true, r.failures.join(" "));
});

test("a rounded number is a different number", () => {
  // "Do not round the ones he did." 12 minutes becoming 15 is an invention that reads as a tidy-up.
  const r = verifyExtraction({ ...base, the_detail: "About 15 minutes." }, SOURCE);
  assert.equal(r.ok, false);
});

test("nobody may be recorded who was never named", () => {
  // A name nobody said cannot be cleared, because there is nobody to ask — so it would sit
  // uncleared forever and block a moment that never needed clearing.
  const r = verifyExtraction(
    { ...base, names: [{ name: "Dan" }, { name: "Priya" }] },
    SOURCE,
  );
  assert.equal(r.ok, false);
  assert.match(r.failures.join(" "), /Priya/);
  assert.doesNotMatch(r.failures.join(" "), /\bDan\b(?!.*Priya)/);
});

test("prose that summarises is allowed, because extraction summarises", () => {
  // The whole design rests on this. "The CFO interrupted the deck" appears nowhere in the source
  // verbatim, and demanding that it did would reject every honest extraction ever made.
  const r = verifyExtraction(
    {
      ...base,
      the_moment: "A CFO stopped a pitch halfway through to raise key-person risk.",
      how_he_felt: "Caught out, and still turning it over the next day.",
    },
    SOURCE,
  );
  assert.equal(r.ok, true, r.failures.join(" "));
});

test("the verdict says what it did not check", () => {
  // A pass that implies "this extraction is verified" would recreate the problem one level up.
  const r = verifyExtraction(base, SOURCE);
  assert.equal(r.ok, true);
  assert.ok(r.not_checked.length > 0, "it claims to have checked everything");
  assert.match(r.not_checked.join(" "), /summaris/i);
});

test("an empty extraction is not a failure", () => {
  // Clause 5: an interview that produced nothing is a real outcome. The parking rules decide what
  // to do about it; this is not the place to refuse it.
  const r = verifyExtraction(base, SOURCE);
  assert.equal(r.ok, true, r.failures.join(" "));
});

/* ── Dropped numbers ─────────────────────────────────────────────────────── */

const TURNS = [
  { role: "question", body: "How many years, and how many builds in the last 3 months?" },
  {
    role: "answer",
    body: "the better part of 10 years, all of which have fallen woefully short. Take 30% off. under $16",
  },
  { role: "answer", body: "This probably works best for SMB" },
];
const SAID = joshSaid("I've only just started building TAMs like this in the last six months", TURNS);

test("joshSaid keeps his words and leaves the interviewer's out", () => {
  assert.match(SAID, /six months/);
  assert.match(SAID, /under \$16/);
  assert.doesNotMatch(SAID, /3 months/);
});

test("a number he gave that no field carries is refused", () => {
  // 13 Oct 2026: two extractions of one interview each dropped "10 years", "six months", "30%" and
  // "$16", and the post the interview existed to produce could state none of them.
  const r = verifyExtraction(
    { ...base, the_moment: "TAMs built this way for the last six months, after 10 years of falling short." },
    SAID,
    SAID,
  );
  assert.equal(r.ok, false);
  assert.match(r.failures.join(" "), /"30".*"16"|"16".*"30"/);
  assert.deepEqual(missingNumbers({ ...base, the_moment: "six months, 10 years" }, SAID).sort(), ["16", "30"]);
});

test("every number carried, in any field and in any form, passes", () => {
  const r = verifyExtraction(
    {
      ...base,
      the_moment: "Building TAMs like this for the last 6 months, after ten years of falling short.",
      the_detail: "Take 30% off the average cost, under $16.",
    },
    SAID,
    SAID,
  );
  assert.equal(r.ok, true, r.failures.join(" "));
  assert.match(r.checked.join(" "), /carried/);
});

test("a number only the interviewer used is not required", () => {
  assert.deepEqual(
    missingNumbers({ ...base, the_moment: "six months, 10 years, 30%, $16" }, SAID),
    [],
  );
});

test("without his words, the dropped-number check does not run", () => {
  // Callers that only hold the combined source cannot tell his numbers from the interviewer's, so
  // they get the three original checks and the verdict does not claim the fourth.
  const r = verifyExtraction(base, SAID);
  assert.equal(r.ok, true, r.failures.join(" "));
  assert.doesNotMatch(r.checked.join(" "), /carried/);
});

/*
 * ── What the dropped-number check must NOT fire on ─────────────────────────────────────────────
 *
 * Measured, not imagined. Run against every real entry in the project on 13 Oct 2026, the first
 * version of this check reported a dropped number on three of five, and was wrong all three times:
 * "13" and "2026" from the annotation stamp "[Josh confirmed this is how he works, 13 Oct 2026:]",
 * "15" from "Email received Tue, Sep 15", and "2" from "the two main ones I used". It caught
 * nothing real, because the figures that mattered were carried.
 *
 * A warn notice that fires on three interviews in five is one he stops reading — the reasoning
 * 4.4.3 already applies to candidates — so it now asks for a figure rather than a numeral. These
 * are the exact strings from his transcripts, in both directions.
 */

const EMPTY_ENTRY = Object.fromEntries(PROSE_FIELDS.map((f) => [f, ""]));

test("a date he never gave as a figure is not a dropped number", () => {
  assert.deepEqual(
    missingNumbers(EMPTY_ENTRY, "[Josh confirmed this is how he works, 13 Oct 2026:]"),
    [],
  );
  assert.deepEqual(
    missingNumbers(EMPTY_ENTRY, "[Email received Tue, Sep 15, from the founder and CEO]"),
    [],
  );
});

test("a numeral used as speech is not a dropped number", () => {
  assert.deepEqual(
    missingNumbers(EMPTY_ENTRY, "those are the two main ones I used"),
    [],
  );
  assert.deepEqual(
    missingNumbers(EMPTY_ENTRY, "to answer the second question you had"),
    [],
  );
});

test("every figure he actually lost is still caught", () => {
  // His words, verbatim from moments 90 and 94, and an entry that carries none of them.
  const said = [
    "I've only just started building TAMs like this in the last six months, but have been " +
      "building for the better part of 10 years",
    "I would also take 30% off that number. Take 30% off. under $16",
    "average 5,481 businesses per vertical and most of them are currently under fifteen dollars " +
      "to build each",
    "if we have, like, a 100 prospects, that gets cut down to 10 or 15",
  ].join("\n\n");

  const dropped = missingNumbers(EMPTY_ENTRY, said);

  // 10 years, six months, 30%, $16, 5,481 businesses, fifteen dollars, 100 prospects.
  for (const figure of ["10", "6", "30", "16", "5481", "15", "100"]) {
    assert.ok(dropped.includes(figure), `"${figure}" is no longer caught: ${dropped.join(", ")}`);
  }
});

test("a figure carried in any field counts as carried", () => {
  const said = "most of them are currently under fifteen dollars to build each";
  assert.deepEqual(missingNumbers(EMPTY_ENTRY, said), ["15"]);
  assert.deepEqual(
    missingNumbers({ ...EMPTY_ENTRY, reader_takeaway: "under $15 a build" }, said),
    [],
  );
});

/*
 * ── One list of the statuses a resubmission must not walk over ──────────────────────────────────
 *
 * The guard tested `mined` alone. Every real moment in the project on 13 Oct 2026 was `drafted`,
 * so a resubmission on any of them went through: it overwrote material a draft's claim ledger had
 * already been verified against, moved the moment back to `mined`, and recorded nothing. The spans
 * in that ledger would then point at text that no longer existed.
 */

test("every status past the write-up is guarded, and the earlier ones are not", () => {
  for (const past of ["mined", "queued", "drafted", "gated", "scheduled", "published"]) {
    assert.ok(WRITTEN_UP.includes(past), `${past} is not guarded against a silent resubmission`);
  }
  // Before the write-up there is nothing to overwrite, and refusing would block the normal path.
  for (const before of ["captured", "half_mined", "parked"]) {
    assert.ok(!WRITTEN_UP.includes(before), `${before} must not need redo: true`);
  }
});

test("both callers refuse on the shared list rather than their own copy", async () => {
  // Two copies of one rule is how isSupplied drifted for five weeks, so this is checked by source.
  const files = [
    "../cc-submit/index.ts",
    "../../../mcp-server/tools/brief.mjs",
  ];
  for (const f of files) {
    const source = await Deno.readTextFile(new URL(f, import.meta.url));
    assert.match(source, /WRITTEN_UP/, `${f} does not use the shared status list`);
    assert.doesNotMatch(
      source,
      /(const|let)\s+WRITTEN_UP\s*=/,
      `${f} declares its own copy of the status list`,
    );
    assert.doesNotMatch(
      source,
      /status === "mined" && !/,
      `${f} still guards on "mined" alone`,
    );
  }
});
