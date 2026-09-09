import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExtraction } from "./extraction.ts";

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
