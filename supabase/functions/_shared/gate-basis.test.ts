/**
 * A check with nothing to judge against must say so, rather than pass quietly.
 *
 * WHAT THIS IS PROTECTING
 *
 * Measured across every gate run in the build to date: `voice_guide` failed 0 times out of 18,
 * including all five deliberately generic drafts that acceptance test 8 exists to have rejected.
 * `anyone_else` caught 6 of those 6. The gap was not leniency — the voice guide section is still the
 * placeholder Josh has not replaced, so the check had nothing to compare a draft to and every draft
 * looked compliant.
 *
 * It still passes, because blocking a draft over a section Josh was never required to supply first
 * would punish him for a gap he has already been told about. What must not happen is that the pass
 * is indistinguishable from an earned one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { notJudged, unjudgeableChecks } from "./handlers/gate.ts";
import { GATE_CHECKS } from "./prompts.ts";
import { isSupplied, renderLibrary } from "./views.ts";

const FULL: Record<string, string> = {
  core_rules: "the rules",
  hooks: "hook rules",
  audience: "who he talks to",
  voice_guide: "how Josh sounds",
  banned_phrases: "no em dashes",
  gate_rules: "extra rules",
};

test("a filled library leaves every check judgeable", () => {
  assert.equal(unjudgeableChecks(GATE_CHECKS, FULL).length, 0);
});

test("an empty voice guide makes exactly that check unjudgeable", () => {
  const sections = { ...FULL, voice_guide: "" };
  const out = unjudgeableChecks(GATE_CHECKS, sections);
  assert.deepEqual(out.map((c) => c.key), ["voice_guide"]);
});

test("whitespace is not content", () => {
  const sections = { ...FULL, voice_guide: "   \n\t  " };
  assert.deepEqual(unjudgeableChecks(GATE_CHECKS, sections).map((c) => c.key), ["voice_guide"]);
});

test("a missing section key is treated the same as an empty one", () => {
  const { voice_guide: _dropped, ...withoutIt } = FULL;
  assert.deepEqual(unjudgeableChecks(GATE_CHECKS, withoutIt).map((c) => c.key), ["voice_guide"]);
});

test("checks that do not depend on a section are never skipped, whatever is missing", () => {
  const out = unjudgeableChecks(GATE_CHECKS, {});
  const keys = out.map((c) => c.key);

  // The judgement the whole build exists to make. It reads the draft and the source, so no empty
  // section can excuse it from running.
  assert.ok(!keys.includes("anyone_else"), "anyone_else always runs");
  assert.ok(!keys.includes("claims_trace"), "claims_trace always runs");
  assert.ok(!keys.includes("names_cleared"), "names_cleared always runs");
  assert.ok(!keys.includes("identifiable"), "identifiable always runs");

  // aimed_at_someone reads the audience section but also the audience on the moment, and GATE_USER
  // deliberately handles a missing one — so it judges the post on its own terms rather than opting
  // out. Asserted because the tempting "it reads a section, so list it" would be wrong.
  assert.ok(!keys.includes("aimed_at_someone"), "aimed_at_someone judges on its own terms");
});

test("every check named as depending on a section is a real check", () => {
  const known = new Set(GATE_CHECKS.map((c) => c.key));
  for (const check of unjudgeableChecks(GATE_CHECKS, {})) {
    assert.ok(known.has(check.key), `${check.key} is not one of the eight checks`);
  }
});

test("the recorded reason says it was not judged, not that it was fine", () => {
  const reason = notJudged("voice_guide");
  assert.ok(reason.startsWith("NOT JUDGED"), "a reader sees the verdict before the explanation");
  assert.ok(reason.includes("voice_guide"), "it names which section is missing");
  assert.ok(
    /absence of evidence/.test(reason),
    "it says plainly that this is not evidence of quality",
  );
});

/* ── What counts as a supplied section ───────────────────────────────────── */

test("a placeholder addressed to Josh is not content", () => {
  assert.equal(isSupplied("# Content pillars\n\nFOR JOSH. Not drafted, because guessing would."), false);
  assert.equal(isSupplied("# Voice guide\n\nDELIBERATELY EMPTY. This one cannot be drafted."), false);
  assert.equal(isSupplied(""), false);
  assert.equal(isSupplied("   \n  "), false);
  assert.equal(isSupplied(null), false);
});

test("a STARTER section IS content — we wrote it to be used", () => {
  assert.equal(isSupplied("# Hook rules\n\nSTARTER — Josh has some firm views here."), true);
});

test("real prose is content, including prose that happens to mention Josh", () => {
  assert.equal(isSupplied("# Core rules\n\nTwo rules that are not open to adjustment."), true);
  assert.equal(
    isSupplied("# Audience\n\nFounders who sell. Josh talks to them every week."),
    true,
    "FOR JOSH only counts as a marker at the head of the section",
  );
});

test("the placeholder does not reach the prompt as if it were the standard", () => {
  const { sections, prompt } = renderLibrary(
    [
      { key: "core_rules", title: "Core rules", body: "The two rules." },
      { key: "voice_guide", title: "Voice guide", body: "# Voice guide\n\nDELIBERATELY EMPTY. Etc." },
    ],
    "gating",
  );

  assert.equal(sections.voice_guide, "", "recorded as absent");
  assert.ok(!prompt.includes("DELIBERATELY EMPTY"), "the placeholder text is not in the prompt");
  assert.ok(prompt.includes("Not yet supplied by Josh"), "the gap is named instead");
  assert.ok(prompt.includes("The two rules."), "real content still comes through");
});

/* ── Content appended under a placeholder ────────────────────────────────── */

const PLACEHOLDER =
  "# The voice interview\n\nFOR JOSH (8.1). The transcript of you talking at length.\n\n" +
  "## Currently Empty.\n\nUntil it is filled, the voice guide has nothing behind it.\n";

test("a placeholder on its own is still empty", () => {
  assert.equal(isSupplied(PLACEHOLDER), false);
  assert.equal(isSupplied(PLACEHOLDER + "\n---\n\n"), false, "a divider with nothing after it");
  assert.equal(isSupplied(PLACEHOLDER + "\n---\n\n   \n"), false, "whitespace after it");
});

test("a recording appended below the placeholder DOES count", () => {
  // The exact shape /voiceguide writes: the preamble stays at the top and each recording is
  // appended under a divider. Testing only the head reported this as an empty section, so the
  // first real voice recording was stored, versioned — and then ignored by the drafter.
  const withOne = PLACEHOLDER +
    "\n---\n\n## Recorded 2026-09-04\n\nHey. Hi. Hello. Today AWS is blocked due to some issues.\n";
  assert.equal(isSupplied(withOne), true);

  const withTwo = withOne + "\n---\n\n## Recorded 2026-09-05\n\nMore of him talking.\n";
  assert.equal(isSupplied(withTwo), true);
});

test("the appended recording reaches the drafter, not a gap notice", () => {
  const body = PLACEHOLDER + "\n---\n\n## Recorded 2026-09-04\n\nHey. Hi. Hello.\n";
  const { sections, prompt } = renderLibrary(
    [{ key: "voice_transcript", title: "The voice interview", body }],
    "drafting",
  );

  assert.notEqual(sections.voice_transcript, "", "the section counts as supplied");
  assert.ok(prompt.includes("Recorded 2026-09-04"), "the recording is in the prompt");
  assert.ok(!prompt.includes("Not yet supplied by Josh"), "and the gap notice is gone");
});

test("a section Josh rewrote entirely still counts, divider or not", () => {
  assert.equal(isSupplied("# Voice guide\n\nHe writes in short sentences. He never hedges."), true);
});
