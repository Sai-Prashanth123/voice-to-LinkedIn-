import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  clearanceSurvivesReopen,
  isClearedNow,
  needsAClearanceDecision,
} from "../supabase/functions/_shared/names.ts";
import cases from "../supabase/functions/_shared/clearance-cases.json" with { type: "json" };

/**
 * A NAME CLEARED FOR ONE POST STAYED CLEARED AFTER THE POST WAS RE-OPENED — 28 October.
 *
 * names.ts has implemented the expiry since the `reopened_at` migration, and `names.test.ts`
 * asserted it under Deno. It was dead on the path that actually runs. `clearedNames` and
 * `unclearedNames` are both `async` and both take a Deno `SupabaseClient`, so nothing in Node could
 * call them — and the MCP-side readers each read `cleared` straight off the row:
 *
 *   create_draft's refusal (tools/write.mjs), get_moment (tools/read.mjs),
 *   get_rewrite_brief (tools/inspect.mjs), the moment:// bank resource (resources.mjs),
 *   get_drafting_brief and get_rewrite_brief's material block (tools/brief.mjs).
 *
 * Josh has never used a clone. Every session he has ever run went through the hosted connector,
 * which serves `mcp-server/` — so the rule that was tested was the rule he was never subject to.
 *
 * This suite asserts the SAME cases names.test.ts asserts, off the same file, which is the only
 * arrangement in which two runtimes stay honest about one rule. It also guards the half a unit test
 * cannot reach: whether each reader still ASKS for the two columns the rule needs. Selecting
 * `cleared` without `cleared_at`, or a moment without `reopened_at`, fails open silently — every
 * clearance reads as live, which is the exact defect, and no assertion on the predicate can see it.
 */

test("clearance expiry, every shared case, under Node", () => {
  assert.ok(cases.cases.length >= 12, "the shared case list has shrunk");
  for (const c of cases.cases) {
    assert.equal(
      isClearedNow(c.reopened_at, c.row),
      c.expected_cleared_now,
      `isClearedNow — ${c.name}`,
    );
    assert.equal(
      needsAClearanceDecision(c.reopened_at, c.row),
      !c.expected_cleared_now,
      `needsAClearanceDecision — ${c.name}`,
    );
  }
});

test("the two runtimes are reading the same file, not two copies of it", () => {
  // If this list is ever duplicated into a suite, the duplicate drifts and both suites go green
  // against different rules — which is how the Deno implementation came to pass while the Node
  // path had no implementation at all.
  const raw = readFileSync(
    new URL("../supabase/functions/_shared/clearance-cases.json", import.meta.url),
    "utf8",
  );
  const deno = readFileSync(
    new URL("../supabase/functions/_shared/names.test.ts", import.meta.url),
    "utf8",
  );
  assert.match(deno, /clearance-cases\.json/, "the Deno suite no longer reads the shared cases");
  assert.ok(JSON.parse(raw).cases.length === cases.cases.length);
});

test("the August clearance does not survive a November re-open", () => {
  // Stated on its own, outside the table, because it is the defect and a reader of this file
  // should not have to open a JSON file to find out what was wrong.
  const august = { cleared: true, cleared_at: "2026-08-14T02:00:00.000Z" };
  assert.equal(isClearedNow(null, august), true, "nothing re-opened it, so it stands");
  assert.equal(isClearedNow("2026-11-03T00:00:00.000Z", august), false, "9.10 — per post");
  assert.equal(needsAClearanceDecision("2026-11-03T00:00:00.000Z", august), true);
});

test("every MCP reader asks for the columns the rule needs", () => {
  /*
   * WHY A SOURCE READ RATHER THAN A BEHAVIOUR TEST.
   *
   * The failure is a missing column in a PostgREST `select`, and it fails OPEN: `reopened_at`
   * absent from the row reads as undefined, the predicate reads undefined as "never re-opened",
   * and every clearance comes back live. That is correct for a moment genuinely never re-opened and
   * catastrophic for one that was, and no amount of exercising the predicate can tell them apart.
   *
   * Exercising the readers for real needs the live project, and the three suites that do that are
   * excluded from CI by name for want of credentials (.github/workflows/checks.yml). So this reads
   * the source, the way guards.test.mjs does for the rules it protects.
   *
   * All six readers are listed. brief.mjs was the last one — it landed on 28 October with the
   * pointerising of the two briefs, which is the only reason it was separate: one file, one agent,
   * one round. There is no known gap left for this comment to name.
   */
  const readers = [
    ["tools/write.mjs", "create_draft's name refusal"],
    ["tools/read.mjs", "get_moment"],
    ["tools/inspect.mjs", "get_rewrite_brief"],
    ["resources.mjs", "the moment:// bank page"],
    ["tools/brief.mjs", "get_drafting_brief and get_gate_brief"],
  ];

  for (const [file, what] of readers) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(
      src,
      /needsAClearanceDecision|isClearedNow/,
      `${what} (${file}) reads the cleared boolean without the shared expiry rule`,
    );
    assert.match(
      src,
      /cleared_at/,
      `${what} (${file}) does not select cleared_at, so the expiry has nothing to compare`,
    );
    assert.match(
      src,
      /reopened_at|select: "\*"/,
      `${what} (${file}) does not read reopened_at, so every clearance reads as live`,
    );
  }
});
