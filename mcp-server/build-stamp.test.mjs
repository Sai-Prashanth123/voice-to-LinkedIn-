/**
 * Which build is answering, and never a confident wrong answer.
 *
 * On 27 October two features — writer_handle targeting and tasteNotes — were deployed, live, and
 * completely inert. Nothing Josh could read, and nothing we could read, would have told either of
 * us which code was running. "Is that fix live?" was a matter of trust, and the trust was
 * misplaced twice.
 *
 * The rule this file holds: report the build, or report that it cannot be established. Never a
 * number that might be wrong, because a wrong version answers the question falsely and that is
 * worse than not answering it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCommit, buildStamp } from "./build-stamp.mjs";

test("it reports a build, or says plainly that it cannot", () => {
  const s = buildStamp();
  assert.ok(["stamp", "git", "unknown"].includes(s.source), `odd source: ${s.source}`);

  if (s.source === "unknown") {
    assert.equal(s.commit, null, "an unknown build still produced a commit");
    assert.match(s.means, /cannot be established/);
  } else {
    assert.match(s.commit, /^[0-9a-f]{7,40}$/, `not a commit: ${s.commit}`);
  }
});

test("the stamp is a static import, or it never reaches the connector", () => {
  /*
   * The hosted connector is a bundle of files in an edge runtime. `git rev-parse` there returns
   * nothing, so the commit has to be written in before the deploy or it is unknowable. A clone
   * that has never been stamped falls back to git, which is why both paths exist.
   */
  const src = readFileSync(new URL("./build-stamp.mjs", import.meta.url), "utf8");
  assert.ok(
    src.indexOf("stamped() ??") < src.indexOf("fromGit() ??"),
    "git would win over the deploy stamp, so a stale clone could misreport the connector",
  );

  /*
   * This began as a JSON file read with readFileSync, and the connector reported "unknown" on the
   * first deploy after it shipped: an edge bundle carries the import graph and nothing else, so a
   * file nobody imports never arrives. A static import is the only form that travels.
   */
  assert.ok(
    src.includes('import { BUILD } from "./build-info.mjs"'),
    "the stamp is not a static import, so an edge bundle will not carry it",
  );
  // Comments dropped first: this file explains the readFileSync it no longer does, and that
  // explanation is the most useful thing in it.
  const code = src
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join(" ");
  assert.ok(
    !code.includes("readFileSync"),
    "the stamp is read from disk again, which is exactly what did not ship",
  );
});

test("announce and system_status cannot disagree about the build", () => {
  // Two answers to "which build is this" would be worse than none. Asserted by source: both must
  // come from this module rather than each running their own `git rev-parse`.
  const announce = readFileSync(new URL("./announce.mjs", import.meta.url), "utf8");
  assert.match(announce, /from "\.\/build-stamp\.mjs"/, "announce has its own idea of the commit");
  assert.doesNotMatch(announce, /rev-parse/, "announce still shells out to git on its own");

  const inspect = readFileSync(new URL("./tools/inspect.mjs", import.meta.url), "utf8");
  assert.match(inspect, /buildStamp\(\)/, "system_status does not report the build");
  assert.doesNotMatch(inspect, /rev-parse/, "system_status has its own idea of the commit");
});

test("buildCommit is the same commit buildStamp reports", () => {
  assert.equal(buildCommit(), buildStamp().commit);
});
