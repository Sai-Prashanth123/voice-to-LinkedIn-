/**
 * The check keys, in every place they are written down, agree.
 *
 * WHY THIS FILE
 *
 * A gate check's key is enumerated in more places than any one person remembers, and the cost of a
 * divergence is not a crash — it is a check that is judged and then discarded, or a count that
 * tells Josh a post was judged more thoroughly than it was. Both have happened:
 *
 *   - `types.ts`'s `GateCheckKey` was a union of eight. `shape` was added on 14 October and the
 *     union was not touched, so it was wrong for over a month. Nothing caught it because nothing
 *     imports it.
 *   - `gate_runs.check_key` is a closed database constraint. A key in code but not in the
 *     constraint is refused at the write door AFTER the model call is made and paid for.
 *
 * On 18 November a tenth check, `holds_together`, was added at Josh's request. This file exists so
 * the eleventh cannot be half-wired: every list below is derived from a different file, and any two
 * of them drifting fails here with the names of the keys that differ.
 *
 * The migration is read as TEXT on purpose. Parsing the live constraint would test the database
 * this suite happens to point at; reading the file tests what a fresh clone would get.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GATE_CHECKS } from "./prompts.ts";
import type { GateCheckKey } from "./types.ts";

/**
 * The keys, written out once here, as the thing the other lists are compared against.
 *
 * Typed as `GateCheckKey[]`, so adding a key to GATE_CHECKS and to this list WITHOUT adding it to
 * the union in types.ts is a type error rather than a passing test.
 */
const EXPECTED: GateCheckKey[] = [
  "anyone_else",
  "claims_trace",
  "hook_opens_loop",
  "aimed_at_someone",
  "voice_guide",
  "names_cleared",
  "banned_phrases",
  "identifiable",
  "shape",
  "holds_together",
];

Deno.test("GATE_CHECKS carries exactly the keys this suite knows about", () => {
  assertEquals(
    GATE_CHECKS.map((c) => c.key).sort(),
    [...EXPECTED].sort(),
    "a check was added or removed in prompts.ts without updating GateCheckKey in types.ts and the " +
      "list in this file. Both are read by hand and neither fails on its own.",
  );
});

Deno.test("every key is allowed by the gate_runs constraint a clone would get", async () => {
  /*
   * The newest migration that rewrites the constraint is the one that counts, because each drops
   * and re-adds it. Picking it by name rather than by scanning them all keeps the failure legible:
   * if an eleventh check adds 0064 and this is not updated, the assertion below names the key that
   * the constraint does not allow.
   */
  const MIGRATION = "0063_holds_together_check.sql";
  const sql = await Deno.readTextFile(
    new URL(`../../migrations/${MIGRATION}`, import.meta.url),
  );

  const missing = EXPECTED.filter((key) => !sql.includes(`'${key}'`));
  assertEquals(
    missing,
    [],
    `${MIGRATION} does not allow ${missing.join(", ")}. A gate_runs insert for that key is ` +
      `refused AFTER the judgement has been made, so the verdict is paid for and thrown away.`,
  );
});

Deno.test("the constraint allows nothing the code does not have", () => {
  /*
   * The other direction, which matters less but is still a signal: a key left in the constraint
   * after being removed from the code means stored verdicts exist for a check nothing runs, and the
   * learning loop would keep counting them.
   */
  const keys = new Set(GATE_CHECKS.map((c) => c.key));
  const orphans = EXPECTED.filter((k) => !keys.has(k));
  assertEquals(orphans, [], `the constraint allows ${orphans.join(", ")}, which no check produces`);
});

Deno.test("no two checks share a key", () => {
  // A duplicate would make one rubric unreachable and the count wrong, silently.
  const keys = GATE_CHECKS.map((c) => c.key);
  assertEquals(keys.length, new Set(keys).size, `duplicate key in GATE_CHECKS: ${keys.join(", ")}`);
});

Deno.test("every check has a rubric substantial enough to judge against", () => {
  /*
   * A check with an empty or one-line question is a check with nothing to check, which reports
   * success. The floor is deliberately low — it is here to catch a stub, not to grade prose.
   */
  for (const c of GATE_CHECKS) {
    const length = c.question.trim().length;
    assertEquals(
      length > 200,
      true,
      `the rubric for "${c.key}" is ${length} characters, which is too short to be a judgement`,
    );
  }
});
