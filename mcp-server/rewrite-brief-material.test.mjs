/**
 * The rewrite brief carries what Josh typed — EXECUTED, because reading it is what missed this.
 *
 * WHAT HAPPENED
 *
 * 18 November. Josh, on thirteen days of using the system: "My notes get lost between ideas. In
 * one-step mode a new detail starts a new idea, so the ZoomInfo post became six. My guess is my
 * earlier notes didn't reach the rewrite."
 *
 * His guess was right. `get_rewrite_brief` called `sourceEntry(material)` with one argument. The
 * second argument is what carries `his_words` — the join of every `raw_inputs` row for the moment —
 * and `receipts`. So the brief held ten model-summarised fields and nothing he had typed, while
 * `create_draft` kept verifying the resulting draft against the full twelve-field entry. A writer
 * judged against material it was never shown.
 *
 * WHY THESE TESTS LOOK AT THE RENDERED OBJECT AND NOT AT THE CALL
 *
 * CLAUDE.md: "a new input is not wired until something renders it and a test asserts the
 * rendering." A test that asserted `writingSources` had been called would have passed against the
 * broken version the moment someone added the call without threading the result through. So these
 * assert his actual sentence is present in the brief that comes back, and one of them asserts the
 * negative — that the brief refuses to look complete when the material is empty.
 *
 * The client is a stub. Clause 6.3 means nothing in the idea bank can ever be deleted, so a test
 * that filed a row there would leave it there for good.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tools } from "./tools/index.mjs";

const rewrite = tools.find((t) => t.name === "get_rewrite_brief");
assert.ok(rewrite, "get_rewrite_brief is not registered");

/** The sentence that has to survive into the brief. Distinctive, so a match cannot be accidental. */
const HIS_PASTE =
  "We charge $40k a year and the thing that actually loses us deals is the ramp time, " +
  "not the price. Nobody writes that down.";

const HIS_SECOND_PASTE = "Actually make it about who signs it off, not who uses it.";

const HIS_NOTE = "no one cares about the data set, this audience doesn't care about that";

/**
 * A stub PostgREST client that answers the reads this handler makes, and records them.
 *
 * `rawInputs` is the knob: pass rows to get a moment he has typed into, pass [] to get one he has
 * not. Everything else is held still.
 */
function stubDb({ rawInputs, notes = [] } = {}) {
  const asked = [];
  return {
    asked,
    async select(table, params = {}) {
      asked.push({ table, params });
      switch (table) {
        case "drafts":
          return [{
            id: 149,
            moment_id: 156,
            version: 1,
            attempt: 1,
            body: "A draft that failed two checks.",
            hook: "A draft that failed two checks.",
            framework: "default",
            gate_passed: false,
            gate_reason: "anyone_else | banned_phrases",
          }];
        case "gate_runs":
          return [
            { check_key: "anyone_else", passed: false, reason: "A recap with an opinion on top." },
            { check_key: "banned_phrases", passed: false, reason: "A label plus colon." },
            { check_key: "claims_trace", passed: true, reason: "Every number is in the source." },
          ];
        case "material":
          return [{
            moment_id: 156,
            the_moment: "A pricing conversation.",
            the_detail: "",
            the_realisation: "Ramp time loses deals.",
            the_lesson: "",
            what_happened_before: "",
            who_was_there: "",
            their_actual_words: "",
            how_he_felt: "",
            what_changed: "",
            reader_takeaway: "",
          }];
        case "moments":
          return [{ reopened_at: null }];
        case "moment_names":
          return [];
        case "raw_inputs":
          return rawInputs;
        case "jobs":
          return notes.map((n) => ({
            payload: {
              moment_id: 156,
              failures: [`Josh's note on the previous version: ${n}`],
            },
          }));
        case "library_sections":
          return [];
        default:
          return [];
      }
    },
    async rpc() {
      return [];
    },
  };
}

/** Run the handler with the brief-read side effect neutralised. */
async function run(opts) {
  const db = stubDb(opts);
  const out = await rewrite.handler({ draft_id: 149 }, {
    db,
    url: "https://example.test",
    key: "test-key",
  });
  return { out, db };
}

test("his typed words reach the rewrite brief", async () => {
  // THE REGRESSION. Before 18 November this assertion failed: `material` held the ten summarised
  // fields and `his_words` was not a key at all.
  const { out } = await run({
    rawInputs: [{ transcript: null, text_body: HIS_PASTE }],
  });

  assert.ok(out.material, "the brief carries no material at all");
  assert.ok(
    "his_words" in out.material,
    "the rewrite brief has no his_words key, so sourceEntry was called without its second " +
      "argument — the defect Josh reported on 18 November",
  );
  assert.match(
    out.material.his_words,
    /ramp time/i,
    "his own sentence is not in the brief, so the writer is being judged against text it cannot see",
  );
  // The whole paste, not a summary of it.
  assert.ok(out.material.his_words.includes(HIS_PASTE), "his paste reached the brief truncated");
});

test("every raw input reaches it, not just the first", async () => {
  // This is the half of Josh's complaint that `continue_post` created: a moment now accumulates
  // material, and a rewrite that saw only the original paste would drop the correction that
  // prompted it. `writingSources` joins all rows ordered by id; nothing filters or caps them.
  const { out } = await run({
    rawInputs: [
      { transcript: null, text_body: HIS_PASTE },
      { transcript: null, text_body: HIS_SECOND_PASTE },
    ],
  });

  assert.ok(out.material.his_words.includes(HIS_PASTE), "the first input is missing");
  assert.ok(
    out.material.his_words.includes(HIS_SECOND_PASTE),
    "the SECOND input is missing — a correction he added after the first draft would be invisible " +
      "to the rewrite, which is exactly what he reported",
  );
  assert.ok(
    out.material.his_words.indexOf(HIS_PASTE) <
      out.material.his_words.indexOf(HIS_SECOND_PASTE),
    "inputs are out of order; they must read oldest first, as the drafting brief renders them",
  );
});

test("it actually reads raw_inputs for the right moment", async () => {
  const { db } = await run({ rawInputs: [{ transcript: null, text_body: HIS_PASTE }] });
  const read = db.asked.find((a) => a.table === "raw_inputs");
  assert.ok(read, "raw_inputs was never queried");
  assert.equal(
    read.params.moment_id,
    "eq.156",
    "raw_inputs was read for the wrong moment — the draft's moment is 156",
  );
});

test("a moment he has typed nothing into omits the key, as every other caller does", async () => {
  /*
   * This test first asserted the opposite — that an empty `his_words` should still appear, so that
   * "he typed nothing" could be told apart from "nothing was wired". That was wrong, and the reason
   * is worth keeping: `sourceEntry` omits every empty field on purpose (entry.ts), and the claim
   * ledger leans on it. `verifyOne` refuses a span whose "source field is empty or does not exist",
   * so a field rendered as "" would become a claimable field with nothing in it. Making this brief
   * the one exception would have weakened verification to improve a diagnostic.
   *
   * The distinction the original assertion wanted is already held upstream: a brief whose entry has
   * nothing in it at all is refused outright rather than written, because "a draft built on nothing
   * is what the claim ledger exists to stop".
   */
  const { out } = await run({ rawInputs: [] });
  assert.ok(
    !("his_words" in out.material),
    "an empty source must be omitted, the same way the drafting brief and the ledger treat it",
  );
  // And the brief is still built from what the interview did capture, rather than failing.
  assert.equal(out.material.the_moment, "A pricing conversation.");
});

test("his pushback reaches the rewrite, separately from the gate's verdicts", async () => {
  const { out } = await run({
    rawInputs: [{ transcript: null, text_body: HIS_PASTE }],
    notes: [HIS_NOTE],
  });

  assert.deepEqual(out.his_notes, [HIS_NOTE], "his own note did not reach the rewrite brief");
  // The distinction is the point: one is an instruction, the other is a judgement.
  const verdicts = JSON.stringify(out.fix_these);
  assert.ok(
    !verdicts.includes(HIS_NOTE),
    "his note was filed under what the gate failed it on, which mislabels what he said",
  );
});

test("no notes means the key is absent, not an empty promise", async () => {
  const { out } = await run({ rawInputs: [{ transcript: null, text_body: HIS_PASTE }] });
  assert.ok(
    !("his_notes" in out),
    "an empty his_notes array in the brief reads as 'he said nothing worth repeating' rather " +
      "than 'he has not commented'",
  );
});

test("the verdict count is not hard-coded at eight", async () => {
  // `(${verdicts.length} of 8)` was in the refusal text while nine checks existed. The count in
  // prose is the recurring defect in this repo; it now derives from GATE_CHECKS.
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./tools/inspect.mjs", import.meta.url), "utf8")
  );
  assert.ok(
    !/of 8\)/.test(src),
    "a gate count is still written out as 8 in inspect.mjs",
  );
});
