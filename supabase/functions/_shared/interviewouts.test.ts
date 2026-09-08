/**
 * Every button the interview emits must parse back into the action the webhook handles.
 *
 * This is the test the claim-ledger bug earlier the same day argued for. There, create_draft asked
 * for one shape and verifyDraft read another; each side was coherent alone, nothing compared them,
 * and the failure was silent. Buttons have exactly that shape: worker-select and interview.ts write
 * callback_data, weeklypass.ts reads it, and a drifted verb produces a button that does nothing at
 * all when tapped. No error is raised, nothing is logged, and the only symptom is Josh concluding
 * the reminder is broken — on the one occasion he actually engaged with it.
 *
 * So this asserts the round trip rather than the spelling. Renaming a verb is fine; renaming it in
 * only one of the two places is not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { questionOuts, roundupOuts } from "./interviewouts.ts";
import { parseAction } from "./weeklypass.ts";

const MOMENT = 41;

test("every button under a question parses back to an action for that moment", () => {
  const kinds: string[] = [];

  for (const button of questionOuts(MOMENT).flat()) {
    const action = parseAction(button.data);
    assert.notEqual(
      action.kind,
      "unknown",
      `"${button.text}" emits ${button.data}, which parseAction does not recognise`,
    );
    assert.equal(
      (action as { momentId?: number }).momentId,
      MOMENT,
      `"${button.text}" lost the moment id`,
    );
    kinds.push(action.kind);
  }

  assert.deepEqual(kinds.sort(), ["enough", "parkit", "skipq"]);
});

test("every button on the roundup parses back to the right moment", () => {
  const ids = [7, 12, 30];
  const rows = roundupOuts(ids);

  assert.equal(rows.length, ids.length, "one row per moment");

  rows.forEach((row, i) => {
    const kinds = row.map((button) => {
      const action = parseAction(button.data);
      assert.notEqual(action.kind, "unknown", `${button.data} is not recognised`);
      assert.equal(
        (action as { momentId?: number }).momentId,
        ids[i],
        `row ${i} points at the wrong moment`,
      );
      return action.kind;
    });
    assert.deepEqual(kinds, ["resume", "skipq", "parkit"]);
  });
});

test("a single stalled moment is not numbered, several are", () => {
  // "1 · Answer" on a message listing one moment is a number referring to nothing.
  assert.equal(roundupOuts([9])[0][0].text, "Answer");
  assert.equal(roundupOuts([9, 10])[0][0].text, "1 · Answer");
  assert.equal(roundupOuts([9, 10])[1][0].text, "2 · Answer");
});

test("callback data fits the 64 bytes Telegram allows", () => {
  // send() slices callback_data to 64 bytes rather than throwing, so an over-long payload does not
  // fail — it arrives with a truncated moment id and points the action at a DIFFERENT moment.
  // Parking the wrong moment is the worst of these, and 6.3 means it cannot simply be undone.
  const big = 999_999_999;
  for (const button of [...questionOuts(big).flat(), ...roundupOuts([big, big - 1]).flat()]) {
    assert.ok(
      new TextEncoder().encode(button.data).length <= 64,
      `${button.data} is too long for a callback payload`,
    );
  }
});

test("the four verbs are distinct", () => {
  // Two actions sharing a verb means one is unreachable, and which one depends on the order of a
  // switch statement in a different file.
  const verbs = [...questionOuts(1).flat(), ...roundupOuts([1]).flat()]
    .map((b) => b.data.split(":")[0]);
  assert.deepEqual([...new Set(verbs)].sort(), ["enuf", "pk", "rsm", "skq"]);
});
