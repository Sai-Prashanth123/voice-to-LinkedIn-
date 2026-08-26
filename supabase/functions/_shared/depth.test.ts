import { test } from "node:test";
import assert from "node:assert/strict";
import { deepest } from "./session.ts";

/**
 * `depth_reached` must record which rung of the ladder PRODUCED material, not which rungs were
 * tried. Clause 5: the interview works down three depths "in order, and stops as soon as one
 * produces material".
 *
 * This is load-bearing. worker-select scores scene +8, time_anchored +4, earned_perspective +2,
 * none -20 — so a moment credited with a scene it never had outranks moments that genuinely have
 * one, and the queue fills with the wrong material.
 *
 * The bug these tests lock out: the handler used to write depth_reached on every question asked,
 * using the depth being PROBED. Asking a scene question and getting nothing back still recorded
 * "scene". Observed live on M-000005, a moment whose entire content was the words "Okay thanks".
 */

test("deepest() ranks the ladder correctly", () => {
  assert.equal(deepest("none", "scene"), "scene");
  assert.equal(deepest("earned_perspective", "time_anchored"), "time_anchored");
  assert.equal(deepest("time_anchored", "scene"), "scene");
  assert.equal(deepest("scene", "earned_perspective"), "scene");
  assert.equal(deepest("none", "none"), "none");
});

test("deepest() is order-independent", () => {
  assert.equal(deepest("scene", "time_anchored"), deepest("time_anchored", "scene"));
  assert.equal(deepest("none", "earned_perspective"), deepest("earned_perspective", "none"));
});

/**
 * The rule the handler now follows: depth is written only when the interview FINISHES, from the
 * depth the model reports as reached. Probing is not recorded.
 */
function depthAfterSession(
  events: { action: "ask" | "finish" | "park"; depth: string }[],
): string {
  let recorded = "none";
  for (const e of events) {
    if (e.action === "finish") recorded = e.depth;
    if (e.action === "park") recorded = "none";
    // "ask" deliberately records nothing — an attempted rung is not an achieved one.
  }
  return recorded;
}

test("probing a scene and landing on a time-anchored memory records time_anchored", () => {
  const depth = depthAfterSession([
    { action: "ask", depth: "scene" },          // "was there a specific moment?" — nothing came back
    { action: "ask", depth: "scene" },          // pushback, still nothing
    { action: "ask", depth: "time_anchored" },  // walked him back a month — this landed
    { action: "finish", depth: "time_anchored" },
  ]);
  assert.equal(depth, "time_anchored", "must not be credited with a scene it never got");
});

test("a session that produces a real scene records scene", () => {
  assert.equal(
    depthAfterSession([
      { action: "ask", depth: "scene" },
      { action: "finish", depth: "scene" },
    ]),
    "scene",
  );
});

test("a parked moment records none, however many depths were tried", () => {
  const depth = depthAfterSession([
    { action: "ask", depth: "scene" },
    { action: "ask", depth: "time_anchored" },
    { action: "ask", depth: "earned_perspective" },
    { action: "park", depth: "none" },
  ]);
  assert.equal(depth, "none");
});

test("questions alone never record a depth — the M-000005 case", () => {
  // A scene question was asked and never answered. Under the old behaviour this read as "scene"
  // and would have scored +8 in selection.
  assert.equal(depthAfterSession([{ action: "ask", depth: "scene" }]), "none");
});
