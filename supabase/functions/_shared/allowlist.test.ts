/**
 * Who may sign in to the desk.
 *
 * This is the one rule standing between the open internet and an idea bank holding call transcripts
 * and client material (15.4). It has already failed open once — `if (user && allowed && ...)` made
 * an unset ALLOWED_EMAIL short-circuit, so on the public deployment anyone with an account on this
 * Supabase project could have read everything. It looked correct on a laptop for months.
 *
 * So the interesting cases here are all the ways a permissive answer could be given by accident,
 * not the happy path.
 *
 * Tested from the Deno suite the same way `app/lib/pillars.ts` and `app/lib/diff.ts` are: the app
 * cannot import from here, so the suite reaches into the app instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { isAllowed, isOpenToAnyone } = await import("../../../app/lib/allowlist.ts");

test("an unset allowlist admits nobody", () => {
  assert.equal(isAllowed("josh@slingshot.com", undefined), false);
  assert.equal(isAllowed("josh@slingshot.com", ""), false);
  assert.equal(isAllowed("josh@slingshot.com", "   "), false);
});

test("no email is never allowed, whatever the list says", () => {
  assert.equal(isAllowed("", "*"), false);
  assert.equal(isAllowed(null, "*"), false);
  assert.equal(isAllowed(undefined, "josh@slingshot.com"), false);
});

test("one address behaves exactly as it did before", () => {
  assert.equal(isAllowed("josh@slingshot.com", "josh@slingshot.com"), true);
  assert.equal(isAllowed("someone@else.com", "josh@slingshot.com"), false);
});

test("case and surrounding whitespace do not decide access", () => {
  assert.equal(isAllowed("  JOSH@Slingshot.com ", " josh@slingshot.com "), true);
});

test("several addresses, however they were pasted", () => {
  const list = "josh@slingshot.com, prashanth@thought-pilot.com";
  assert.equal(isAllowed("josh@slingshot.com", list), true);
  assert.equal(isAllowed("prashanth@thought-pilot.com", list), true);
  assert.equal(isAllowed("nobody@elsewhere.com", list), false);

  // Same list, separated by a newline and a semicolon instead.
  const messy = "josh@slingshot.com;\nprashanth@thought-pilot.com";
  assert.equal(isAllowed("prashanth@thought-pilot.com", messy), true);
});

test("a domain wildcard admits that domain and no lookalike", () => {
  assert.equal(isAllowed("anyone@slingshot.com", "*@slingshot.com"), true);
  assert.equal(isAllowed("josh@slingshot.com", "*@slingshot.com"), true);

  // The one that matters: a suffix test without the "@" would admit both of these.
  assert.equal(isAllowed("attacker@evil-slingshot.com", "*@slingshot.com"), false);
  assert.equal(isAllowed("attacker@notslingshot.com", "*@slingshot.com"), false);
  assert.equal(isAllowed("josh@slingshot.com.evil.com", "*@slingshot.com"), false);
});

test("a bare star admits anyone, because that is what it is for", () => {
  assert.equal(isAllowed("literally-anyone@gmail.com", "*"), true);
  assert.equal(isOpenToAnyone("*"), true);
});

test("a star mixed into a list still opens the door completely", () => {
  // Worth asserting rather than assuming: someone adding "*" to try a demo, alongside two real
  // addresses, has opened it to everyone and should not be surprised later.
  assert.equal(isAllowed("stranger@gmail.com", "josh@slingshot.com, *"), true);
  assert.equal(isOpenToAnyone("josh@slingshot.com, *"), true);
});

test("a closed list is not reported as open", () => {
  assert.equal(isOpenToAnyone("josh@slingshot.com"), false);
  assert.equal(isOpenToAnyone("*@slingshot.com"), false, "a domain wildcard is not everyone");
  assert.equal(isOpenToAnyone(""), false);
});

test("a star inside an address is not a wildcard", () => {
  assert.equal(isAllowed("a*b@slingshot.com", "a*b@slingshot.com"), true);
  assert.equal(isAllowed("anyone@anywhere.com", "a*b@slingshot.com"), false);
});
