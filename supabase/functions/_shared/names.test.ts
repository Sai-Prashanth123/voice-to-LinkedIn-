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
