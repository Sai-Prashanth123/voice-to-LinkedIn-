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

/*
 * THE WRITE DOOR'S OWN VERSION, added 2 November 2026.
 *
 * Everything above closed the question for the connector. It stayed open for `cc-submit`, which is
 * the function that holds every write in the system: it imported none of this, `system_status` is
 * served by `mcp` and reports `mcp`'s stamp, and so a deploy of cc-submit was indistinguishable
 * from a deploy that silently did nothing. The same fault as 27 October, in the half nobody
 * checked, for six days.
 */

test("cc-submit can say which build it is, and the route writes nothing", () => {
  const source = readFileSync(new URL("../supabase/functions/cc-submit/index.ts", import.meta.url), "utf8");

  // Static import, or it does not travel in the bundle — the whole lesson of build-info.mjs.
  assert.match(
    source,
    /^import \{ buildStamp \} from "\.\.\/\.\.\/\.\.\/mcp-server\/build-stamp\.mjs";$/m,
    "cc-submit does not statically import the stamp, so it cannot report its own build",
  );

  // And a route that serves it.
  assert.match(source, /^\s*build: \(\) => Promise\.resolve\(json\(/m, "there is no build route");

  // It must not touch the database. A diagnostic route that writes is not a diagnostic route, and
  // this one exists to be safe to call against Josh's live project at any time.
  const route = source.slice(source.indexOf("    build: () =>"));
  const oneLine = route.slice(0, route.indexOf("\n"));
  for (const forbidden of ["db.", "insert", "update", "delete"]) {
    assert.ok(!oneLine.includes(forbidden), `the build route touches the database (${forbidden})`);
  }
});

test("the deploy proves the stamp landed instead of asking someone to check", () => {
  const source = readFileSync(new URL("../scripts/deploy.mjs", import.meta.url), "utf8");

  assert.match(source, /async function verifyStamp/, "deploy.mjs does not verify anything");
  // It must ask the DEPLOYED function, not re-read its own stamp.
  assert.match(source, /kind: "build"/, "the verification does not call the build route");
  assert.match(source, /body\?\.build\?\.commit/, "it does not compare the deployed commit");
  // A mismatch has to fail, or the check is decoration.
  assert.match(source, /process\.exit\(3\)/, "a failed verification does not fail the script");
  // And missing credentials must not read as success.
  assert.match(source, /NOT VERIFIED/, "it cannot distinguish unchecked from checked-and-correct");
});

test("health reports both builds and says when they disagree", async () => {
  const { health } = await import("./tools/health.mjs");
  const source = readFileSync(new URL("./tools/health.mjs", import.meta.url), "utf8");

  assert.match(source, /bothBuilds/, "health does not compare the two surfaces");
  assert.match(source, /write_door/, "health does not report cc-submit's build");
  assert.match(source, /agree/, "health does not say whether they agree");

  // The readings it could not take must be named, not silently absent: three failures that look
  // identical from outside are what this whole tool exists to tell apart.
  for (const state of ["not_asked", "unreadable", "unreachable"]) {
    assert.ok(source.includes(state), `health cannot report the state "${state}"`);
  }

  // And it must never throw, whatever the far end does.
  const out = await health[0].handler({}, {
    db: { ping: async () => ({ granted: true, detail: "" }) },
    url: "https://nonexistent-xyzzy-deploy-check.supabase.co",
    key: "irrelevant",
  });
  assert.equal(out.ok, true, "health failed because a build reading failed");
  assert.equal(out.builds.agree, false);
  assert.match(out.builds.write_door.source, /unreachable|unreadable/);
});
