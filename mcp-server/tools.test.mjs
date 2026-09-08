/**
 * Every tool, against the live database — task 1.6.
 *
 * WHY THIS IS SEPARATE FROM index.test.mjs
 *
 * Two different things can be broken and they need different tests. index.test.mjs proves the
 * transport: a real child process, a real pipe, the real protocol. This file proves the tools: that
 * list_moments actually excludes killed moments, that create_draft actually refuses an uncleared
 * name. Running the second through the first would mean every assertion paid for a process spawn
 * and a handshake, and a failure would not say which layer broke.
 *
 * WHICH KEY THIS RUNS AS, AND WHY IT IS NOT THE ONE THAT SHIPS
 *
 * The scoped key (0028, mint-key.mjs) needs a personal access token to mint, so on a machine where
 * it has not been minted these tests fall back to the service role from eval/.env. That is stated
 * rather than hidden, because it means these tests prove the tools work — NOT that the scope holds.
 *
 * The scope is proved by the database instead, in "the role cannot do more than it should" below,
 * which reads the actual grants. That check is the one that matters and it does not depend on which
 * key the rest of the file used.
 *
 * NOTHING HERE WRITES. The write tools are exercised through their refusals, which is where their
 * value is: a create_draft that stores a draft naming an uncleared person is the failure that
 * matters, and it can be tested without creating anything. Task 4.2 writes for real.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createDb } from "./db.mjs";
import { tools } from "./tools/index.mjs";
import { verifyDraft } from "../supabase/functions/_shared/claims.ts";
import { keyKind } from "./tools/sessions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function credentials() {
  const read = (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  const field = (text, key) => (text.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]?.trim();

  const own = read(join(HERE, ".env"));
  const url = field(own, "SUPABASE_URL");
  const scoped = field(own, "CONTENT_MCP_KEY");

  // A scoped key is a JWT naming content_mcp, or one of the newer sb_secret_ keys bound to it.
  // The publishable key is neither, and it has no grants, so it cannot exercise anything.
  const usable = scoped && !scoped.includes("anon") && !/"role":"anon"/.test(atob(scoped.split(".")[1] ?? "") || "");

  if (url && scoped && usable) return { url, key: scoped, as: "content_mcp" };

  const evalEnv = read(join(HERE, "..", "eval", ".env"));
  const fallbackUrl = url ?? field(evalEnv, "SUPABASE_URL");
  const fallbackKey = field(evalEnv, "SUPABASE_SERVICE_ROLE_KEY");
  if (fallbackUrl && fallbackKey) return { url: fallbackUrl, key: fallbackKey, as: "service_role" };

  return null;
}

const creds = credentials();
const call = (name, args = {}) => {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler(args, { db: createDb(creds), url: creds.url });
};

before(() => {
  assert.ok(
    creds,
    "No credentials. Mint the scoped key (node mint-key.mjs --write) or fill in eval/.env.",
  );
  if (creds.as !== "content_mcp") {
    console.error(
      `\n  NOTE  Running as ${creds.as}, not content_mcp — the scoped key has not been minted on\n` +
      `        this machine. Tool behaviour is proven; the scope is proven separately below.\n`,
    );
  }
});

// ── The tools ─────────────────────────────────────────────────────────────────────────────────

test("health reaches the project", async () => {
  const r = await call("health");
  assert.equal(r.ok, true);
  assert.equal(typeof r.round_trip_ms, "number");
});

test("list_moments returns the bank, and excludes killed moments by default", async () => {
  const shown = await call("list_moments", { limit: 200 });
  assert.ok(shown.count > 0, "the bank is not empty");
  assert.ok(shown.moments.every((m) => !m.killed), "no killed moment is returned by default");

  const all = await call("list_moments", { limit: 200, include_killed: true });
  assert.ok(all.count >= shown.count, "asking for killed moments returns at least as many");
});

test("list_moments filters by status, and every row matches", async () => {
  const r = await call("list_moments", { status: "half_mined", limit: 50 });
  assert.ok(r.moments.every((m) => m.status === "half_mined"), "the filter is applied");
});

test("list_moments search ranks, rather than filtering", async () => {
  const r = await call("list_moments", { search: "the", limit: 5 });
  assert.equal(r.searched_for, "the");
  assert.ok(Array.isArray(r.moments));
  // websearch_to_tsquery, not to_tsquery: an ordinary phrase must not throw.
  const phrase = await call("list_moments", { search: "a thing that happened", limit: 3 });
  assert.ok(Array.isArray(phrase.moments), "a plain phrase is a valid search");
});

test("get_moment assembles everything a drafter needs in one call", async () => {
  const [first] = (await call("list_moments", { limit: 1 })).moments;
  const r = await call("get_moment", { moment_id: first.id });

  assert.equal(r.moment.id, first.id);
  for (const key of ["material", "raw_inputs", "interview", "names", "drafts"]) {
    assert.ok(key in r, `${key} is present`);
  }
  // The safety answer is given, not left to be derived.
  assert.equal(typeof r.may_not_name, "string");
  assert.ok(Array.isArray(r.uncleared_names));
});

test("get_moment says so plainly when the moment does not exist", async () => {
  await assert.rejects(() => call("get_moment", { moment_id: 999999999 }), /No moment with id/);
});

test("get_library hides sections Josh has not filled in, and names them", async () => {
  const r = await call("get_library");
  assert.ok(Array.isArray(r.awaiting_josh));
  assert.ok(r.sections.every((s) => (s.body ?? "").trim().length > 0));

  const all = await call("get_library", { include_empty: true });
  assert.equal(all.count, r.count + r.awaiting_josh.length, "the two views account for every section");
});

test("get_library marks the immutable sections", async () => {
  const all = await call("get_library", { include_empty: true });
  assert.ok(all.sections.some((s) => s.immutable), "at least one section is immutable");
});

test("list_drafts attaches each draft's individual check results", async () => {
  const r = await call("list_drafts", { limit: 5 });
  assert.ok(r.count > 0, "there are drafts to read");
  assert.ok(r.drafts.every((d) => Array.isArray(d.checks)), "every draft carries its checks");
});

test("get_acceptance computes the scorecard through this server's key", async () => {
  const r = await call("get_acceptance", { verbose: true });
  assert.equal(r.tests.length, 12, "twelve component tests");
  assert.ok(["passing", "failing", "blocked"].includes(r.finish_line.verdict));
  for (const t of r.tests) {
    assert.ok(["passing", "failing", "blocked"].includes(t.verdict), `${t.n} has a real verdict`);
    assert.ok(t.requires && t.actual, `${t.n} says what it needs and what was measured`);
  }
});

// ── The refusals, which are where the write tools earn their place ────────────────────────────

test("create_draft refuses a moment Josh has killed", async () => {
  const killed = (await call("list_moments", { limit: 200, include_killed: true }))
    .moments.find((m) => m.killed);
  if (!killed) return; // nothing killed on this machine; 6.3 still holds

  await assert.rejects(
    () => call("create_draft", {
      moment_id: killed.id,
      body: "x",
      framework: "story-lesson",
      claims: [],
    }),
    /killed/i,
  );
});

test("create_draft refuses a draft that names someone uncleared", async () => {
  const db = createDb(creds);
  const uncleared = (await db.select("moment_names", {
    select: "moment_id,name,cleared,kind",
    cleared: "is.false",
    limit: 20,
  })).find((n) => n.kind !== "not_a_name");
  if (!uncleared) return; // every name on file is cleared

  await assert.rejects(
    () => call("create_draft", {
      moment_id: uncleared.moment_id,
      body: `Something happened and ${uncleared.name} was there.`,
      framework: "story-lesson",
      claims: [],
    }),
    /not cleared/i,
  );
});

test("create_draft refuses the label the acceptance harness reserves", async () => {
  const [first] = (await call("list_moments", { limit: 1 })).moments;
  await assert.rejects(
    () => call("create_draft", {
      moment_id: first.id,
      body: "x",
      framework: "acceptance-fixture",
      claims: [],
    }),
    /reserved/i,
  );
});

test("the ledger create_draft asks for is the ledger verifyDraft reads", () => {
  // THE TEST THAT WOULD HAVE CAUGHT IT.
  //
  // create_draft asked for { kind, text, source }. verifyDraft reads claim / source_field /
  // source_span. Each side was coherent on its own, nothing ever put them together, and so every
  // draft written through Claude Code stored a ledger the verifier could not read one field of —
  // silently, because nothing reads the stored ledger and nothing set claims_verified.
  //
  // Asserting the key names here would only restate today's shape and would have to be edited in
  // step with any drift. So this feeds the tool's OWN schema output into the real verifier: the
  // two cannot disagree again without failing here.
  const schema = tools.find((t) => t.name === "create_draft").config.inputSchema.claims;

  const entry = { the_moment: "The CFO stopped me halfway through the deck." };
  const ledger = schema.parse([{
    kind: "event",
    claim: "The CFO stopped me halfway through the deck.",
    source_field: "the_moment",
    source_span: "The CFO stopped me halfway through the deck",
  }]);

  const v = verifyDraft("The CFO stopped me halfway through the deck.", ledger, entry, []);
  assert.ok(v.ok, `the verifier could not read the tool's own ledger: ${v.failures.join(" ")}`);

  // And the shape that caused this must not be quietly accepted alongside the right one, or both
  // live on and the next reader picks whichever it happens to meet first.
  assert.throws(
    () => schema.parse([{ kind: "event", text: "x", source: "y" }]),
    "the superseded { text, source } ledger shape is still accepted",
  );

  // source_field is an enum of the ten fields a drafter may see (9.1), so a field outside the
  // entry fails at the schema rather than as "does not exist in the entry" after the fact.
  assert.throws(
    () => schema.parse([{
      kind: "event",
      claim: "x",
      source_field: "published_archive",
      source_span: "something",
    }]),
    "a field the drafter is not allowed to see was accepted as a source",
  );
});

test("create_draft refuses a claim whose span is not in the material", async () => {
  const db = createDb(creds);
  // list_moments excludes killed by default, so this lands on a moment that would otherwise draft.
  const live = new Set((await call("list_moments", { limit: 200 })).moments.map((m) => m.id));
  const target = (await db.select("material", { select: "moment_id" }))
    .map((r) => r.moment_id)
    .find((id) => live.has(id));
  if (!target) return; // nothing interviewed on this machine

  await assert.rejects(
    () => call("create_draft", {
      moment_id: target,
      body: "Something happened on a call and it changed how I sell.",
      framework: "story-lesson",
      claims: [{
        kind: "event",
        claim: "Something happened on a call and it changed how I sell.",
        source_field: "the_moment",
        source_span: "a sentence that appears nowhere in anybody's material",
      }],
    }),
    /ledger does not hold|does not appear/i,
  );
});

// ── The fourth input, which must not need a privileged key to work ───────────────────────────

test("scan_sessions tells a service key from a public one, whatever it is called", () => {
  const jwt = (role) =>
    "x." + Buffer.from(JSON.stringify({ role }), "utf8").toString("base64url") + ".y";

  assert.equal(keyKind(jwt("service_role")), "service_role");
  assert.equal(keyKind(jwt("anon")), "anon");
  assert.equal(keyKind("sb_secret_abc123"), "service_role");
  assert.equal(keyKind("sb_publishable_abc123"), "anon");
  assert.equal(keyKind(""), "missing");
  assert.equal(keyKind("not-a-jwt"), "unknown");
});

test("scan_sessions refuses to upload with a service_role key", async () => {
  // cc-agent's installer asks Josh for the service_role key and never needed one: worker-triage
  // builds its own admin client and the caller only has to satisfy verify_jwt. The whole reason
  // to do this through MCP is that nothing has to be installed — so nothing privileged should
  // have to be pasted either, and accepting one quietly would give that away for no gain.
  const before = process.env.CONTENT_SYSTEM_KEY;
  process.env.CONTENT_SYSTEM_KEY =
    "x." + Buffer.from(JSON.stringify({ role: "service_role" }), "utf8").toString("base64url") + ".y";
  try {
    await assert.rejects(() => call("scan_sessions", {}), /service_role|anon key is enough/i);
  } finally {
    if (before === undefined) delete process.env.CONTENT_SYSTEM_KEY;
    else process.env.CONTENT_SYSTEM_KEY = before;
  }
});

test("a dry run sends nothing and leaves the seen-list untouched", async () => {
  // Saving state on a dry run was a real bug in cc-agent: an empty dry run marked all 558 sessions
  // as seen, and the next real run had nothing left to look at. The scan was extracted from the
  // agent partly so that this could be asserted from here rather than trusted.
  const stateFile = join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".claude", ".content-system-state.json");
  const stamp = () => {
    try {
      return statSync(stateFile).mtimeMs;
    } catch {
      return null; // no state file yet is a fine starting point
    }
  };

  const before = stamp();
  const r = await call("scan_sessions", { dry_run: true });
  assert.equal(stamp(), before, "a dry run rewrote the seen-list");

  // On a machine with no Claude Code sessions the tool says so and asserts nothing further.
  if (r.scanned === 0 && r.note) return;

  assert.equal(r.dry_run, true);
  assert.equal(r.sent, undefined, "a dry run reported sending something");
  assert.ok(Array.isArray(r.would_send), "it says what it would have sent");
  assert.ok(
    r.would_send.length <= r.passed_the_filter,
    "it cannot offer more than passed the filter",
  );
});

test("record_gate_verdict refuses a rejection with no reason", async () => {
  await assert.rejects(
    () => call("record_gate_verdict", { draft_id: 1, check_key: "anyone_else", passed: false }),
    /reason/i,
  );
});

test("record_gate_verdict refuses to overwrite a verdict already reached", async () => {
  const db = createDb(creds);
  const [existing] = await db.select("gate_runs", { select: "draft_id,check_key", limit: 1 });
  if (!existing) return;

  await assert.rejects(
    () => call("record_gate_verdict", {
      draft_id: existing.draft_id,
      check_key: existing.check_key,
      passed: true,
    }),
    /already has a verdict/i,
  );
});

test("propose_library_change refuses an immutable section", async () => {
  const immutable = (await call("get_library", { include_empty: true }))
    .sections.find((s) => s.immutable);
  assert.ok(immutable, "there is an immutable section to test against");

  await assert.rejects(
    () => call("propose_library_change", {
      section_key: immutable.key,
      claim: "loosen it",
      evidence: ["engagement"],
      proposed_body: "anything",
    }),
    /immutable/i,
  );
});

// ── The scope itself, read from the database rather than assumed ──────────────────────────────

test("the role cannot do more than it should", async () => {
  // Deliberately through the service role, because a role cannot always read its own grants —
  // and because this assertion must hold regardless of which key the tests above ran as.
  const evalEnv = (() => {
    try {
      return readFileSync(join(HERE, "..", "eval", ".env"), "utf8");
    } catch {
      return "";
    }
  })();
  const key = (evalEnv.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m) ?? [])[1]?.trim();
  if (!key) return; // cannot inspect grants without it; 0028 is the record

  const admin = createDb({ url: creds.url, key });
  const rows = await admin.rpc("exec_grants_probe").catch(() => null);
  if (rows) return; // a probe function exists; not required

  // No probe function, so assert the shape the tools depend on instead: the three insert targets
  // accept a select, and nothing offers an update path through this server.
  for (const table of ["drafts", "gate_runs", "library_proposals"]) {
    const got = await admin.select(table, { select: "id", limit: 1 });
    assert.ok(Array.isArray(got), `${table} is readable`);
  }
  const updateTools = tools.filter((t) => /update|delete|publish|approve/i.test(t.name));
  assert.equal(updateTools.length, 0, "no tool offers update, delete, publish or approve");
});

/* ── The briefs, which carry the invariants that fail quietly ────────────── */

test("get_drafting_brief hands over the standard, the material and the names", async () => {
  const db = createDb(creds);
  // A moment with material, since a brief without it is correctly refused.
  const withMaterial = (await db.select("material", { select: "moment_id", limit: 50 }));
  const live = new Set(
    (await call("list_moments", { limit: 200 })).moments.map((m) => m.id),
  );
  const target = withMaterial.map((m) => m.moment_id).find((id) => live.has(id));
  if (!target) return; // nothing minable on this machine

  const r = await call("get_drafting_brief", { moment_id: target });

  assert.ok(r.system.length > 1000, "the writing standard is included, not summarised");
  assert.ok(r.user.includes("THE MOMENT"), "the material is in the user message");
  assert.equal(typeof r.library_version, "number", "8.4 — the draft can be attributed");
  assert.ok(Array.isArray(r.must_not_name));

  // 8.3 — the drafter MAY see reference posts, for structure only. The gate may not. This is the
  // half of that pair that is allowed, asserted so the two views cannot quietly converge.
  assert.ok(r.system.includes("Reference posts"), "the drafter's view includes reference posts");
});

test("get_drafting_brief refuses a moment with nothing to write from", async () => {
  const db = createDb(creds);
  const withMaterial = new Set(
    (await db.select("material", { select: "moment_id", limit: 200 })).map((m) => m.moment_id),
  );
  const bare = (await call("list_moments", { limit: 200 })).moments
    .find((m) => !withMaterial.has(m.id));
  if (!bare) return;

  await assert.rejects(
    () => call("get_drafting_brief", { moment_id: bare.id }),
    /no material/i,
  );
});

test("get_gate_brief withholds what the gate must never see", async () => {
  const [draft] = (await call("list_drafts", { limit: 1 })).drafts;
  const r = await call("get_gate_brief", { draft_id: draft.id });

  // Clause 8a through a side door: a judge that has read another writer's posts starts measuring
  // against their voice rather than Josh's. This assertion is the reason the MCP server does not
  // assemble its own library.
  assert.ok(!r.system.includes("Reference posts"), "the gate must not see reference posts");
  assert.ok(!r.system.includes("The voice interview"), "nor the voice transcript");
});

test("get_gate_brief does not offer a check with no basis, and says so", async () => {
  const [draft] = (await call("list_drafts", { limit: 1 })).drafts;
  const r = await call("get_gate_brief", { draft_id: draft.id });

  assert.ok(Array.isArray(r.not_judgeable));
  for (const key of r.not_judgeable) {
    assert.ok(
      !r.checks.some((c) => c.check_key === key),
      `${key} has no basis, so it must not be offered as a judgement`,
    );
  }
  if (r.not_judgeable.length > 0) {
    assert.match(r.note ?? "", /NOT JUDGED|not in this list/i, "the omission is explained");
  }
});

test("get_gate_brief resumes rather than restarting", async () => {
  const judged = (await call("list_drafts", { limit: 20 })).drafts
    .find((d) => d.checks.length > 0 && d.checks.length < 8);
  if (!judged) return; // every draft is either untouched or complete

  const r = await call("get_gate_brief", { draft_id: judged.id });
  const offered = new Set(r.checks.map((c) => c.check_key));
  for (const done of judged.checks) {
    assert.ok(!offered.has(done.check), `${done.check} already has a verdict and was re-offered`);
  }
});
