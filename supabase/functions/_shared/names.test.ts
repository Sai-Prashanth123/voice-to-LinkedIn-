import { test } from "node:test";
import assert from "node:assert/strict";
import { isRealName } from "./names.ts";

/**
 * 9.12's clearance question only works if Josh reads it, and the extraction prompt says why he
 * would stop: "noise is how the clearance question stops being read". Three of the first eight
 * names recorded live were not names — "CFO" twice and "Josh" once.
 *
 * These pin the filter in both directions, and the asymmetry is deliberate: a role wrongly kept
 * costs one tap, a real name wrongly dropped means someone gets named without being asked about.
 */

test("job titles identify nobody, with or without their article", () => {
  for (const role of ["CFO", "the CFO", "a client", "the buyer", "my co-founder", "our team"]) {
    assert.equal(isRealName(role), false, `"${role}" is a role, not a name`);
  }
});

test("Josh is never asked for permission to name himself", () => {
  assert.equal(isRealName("Josh"), false);
  assert.equal(isRealName("josh"), false);
  // Someone else who happens to share the name is a different matter, but we cannot tell them apart
  // from a bare first name — and the safe default here is to ask.
  assert.equal(isRealName("Josh Fryszer"), true);
});

test("real names survive", () => {
  for (const name of ["Priya", "Meridian", "Northwind", "Dan", "Acme Industries", "O'Brien"]) {
    assert.equal(isRealName(name), true, `"${name}" is a name and must be asked about`);
  }
});

test("a name that merely contains a role word is still a name", () => {
  // The failure to avoid: dropping a real company because its name reads like a job title.
  assert.equal(isRealName("Client Co"), true);
  assert.equal(isRealName("Founders Fund"), true);
  assert.equal(isRealName("The Partner Agency"), true);
});

test("empty and junk are dropped rather than asked about", () => {
  for (const junk of ["", " ", "a", "the", "someone", "people"]) {
    assert.equal(isRealName(junk), false, `"${junk}" should not become a clearance question`);
  }
});

test("when genuinely ambiguous it keeps the name", () => {
  // A person really called Major, or a company called Head. Asking is cheap; silence is not.
  assert.equal(isRealName("Major"), true);
  assert.equal(isRealName("Bishop"), true);
});

/* ── The clearance expiry, from the shared case list (9.10) ──────────────────────────────────── */

/**
 * THE SAME CASES ARE ASSERTED FROM NODE, in mcp-server/clearance.test.mjs.
 *
 * That is the point of the fixture rather than a tidiness preference. The expiry rule was written
 * here, inside two `async` functions taking a Deno client, and so could not be called from Node —
 * where six readers answer the same question and all six read the `cleared` boolean straight off
 * the row. The rule passed its Deno tests for weeks while being dead on the only path Josh uses.
 *
 * Two suites over one list is what makes that visible: a change that suits one runtime fails the
 * other. Cases go in clearance-cases.json, never into one of the two suites.
 */
import { clearanceSurvivesReopen, isClearedNow, needsAClearanceDecision } from "./names.ts";
import cases from "./clearance-cases.json" with { type: "json" };

test("clearance expiry, every shared case, under Deno", () => {
  assert.ok(cases.cases.length >= 12, "the shared case list has shrunk");
  for (const c of cases.cases) {
    assert.equal(
      isClearedNow(c.reopened_at, c.row),
      c.expected_cleared_now,
      `isClearedNow — ${c.name}`,
    );
    // The complement, asserted rather than assumed. The two readers are separate functions and a
    // moment that is neither cleared nor awaiting a decision would fall out of the system.
    assert.equal(
      needsAClearanceDecision(c.reopened_at, c.row),
      !c.expected_cleared_now,
      `needsAClearanceDecision — ${c.name}`,
    );
  }
});

test("the predicate ignores the boolean and judges only the timestamps", () => {
  // clearanceSurvivesReopen is the time half on its own: callers that have already checked
  // `cleared` use it directly, and clearedNames does exactly that because its query filtered on
  // `cleared = true` already.
  assert.equal(clearanceSurvivesReopen(null, null), true, "never re-opened, nothing expires");
  assert.equal(
    clearanceSurvivesReopen("2026-11-03T00:00:00.000Z", "2026-08-14T02:00:00.000Z"),
    false,
  );
  assert.equal(
    clearanceSurvivesReopen("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
    true,
  );
});
