/**
 * Prompts, resources and annotations — the two thirds of MCP this server did not use.
 *
 * These are cheap tests for expensive mistakes. Every failure they catch is silent: a prompt whose
 * completions never appear, a resource template that contributes nothing to a listing, a write tool
 * a client auto-approves because it was labelled read-only. Nothing throws in any of those cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getCompleter, isCompletable } from "@modelcontextprotocol/sdk/server/completable.js";

import { createDb } from "./db.mjs";
import { tools } from "./tools/index.mjs";
import { build } from "./server.mjs";
import { promptsFor } from "./prompts.mjs";
import { resourcesFor } from "./resources.mjs";
import { annotationsFor, WRITE_TOOLS } from "./auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function credentials() {
  const read = (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const field = (t, k) => (t.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim();
  const own = read(join(HERE, ".env"));
  const url = field(own, "SUPABASE_URL");
  const key = field(own, "CONTENT_MCP_KEY");
  if (url && key) return { url, key };
  const ev = read(join(HERE, "..", "eval", ".env"));
  return { url: field(ev, "SUPABASE_URL"), key: field(ev, "SUPABASE_SERVICE_ROLE_KEY") };
}

const creds = credentials();
const context = { db: createDb(creds), url: creds.url };

// ── Registration ──────────────────────────────────────────────────────────────────────────────

test("the server builds with prompts and resources registered", () => {
  // registerPrompt and registerResource call registerCapabilities, which throws outright after
  // connect(). If either were ever moved out of build() this is what would catch it.
  assert.doesNotThrow(() => build(context, tools, null));
});

test("every prompt declares arguments the SDK can actually read", () => {
  // argsSchema must be a RAW object of Zod types. Passing a constructed z.object() type-checks,
  // registers without complaint, and advertises no arguments at all.
  for (const p of promptsFor(context)) {
    assert.ok(p.config.argsSchema, `${p.name} has no argsSchema`);
    assert.equal(
      typeof p.config.argsSchema,
      "object",
      `${p.name}'s argsSchema is not a plain shape`,
    );
    assert.ok(
      !("_def" in p.config.argsSchema && "shape" in p.config.argsSchema),
      `${p.name} passed a constructed z.object() instead of a raw shape`,
    );
  }
});

test("id arguments survive as completable", () => {
  // THE BUG THIS CAUGHT. completable(...).describe(...) reads naturally and is wrong: .describe()
  // returns a NEW schema without the COMPLETABLE_SYMBOL, so the completions silently never appear.
  // Nothing errors — the client is simply told there is nothing to complete.
  const prompts = promptsFor(context);
  for (const [name, arg] of [["draft-post", "moment_id"], ["gate-check", "draft_id"]]) {
    const schema = prompts.find((p) => p.name === name).config.argsSchema[arg];
    assert.ok(isCompletable(schema), `${name}.${arg} lost its completions`);
    assert.equal(typeof getCompleter(schema), "function");
  }
});

// ── Prompts ───────────────────────────────────────────────────────────────────────────────────

test("a thin prompt names the brief rather than restating the standard", async () => {
  // If a prompt ever started carrying the writing standard there would be two standards again,
  // and no way to tell which one a given post had followed.
  const p = promptsFor(context).find((x) => x.name === "draft-post");
  const out = await p.cb({ moment_id: "3" });

  const text = out.messages[0].content.text;
  assert.match(text, /get_drafting_brief/);
  assert.ok(
    !text.includes("Could anyone else have written this?"),
    "the thin prompt is carrying a copy of the standard",
  );
});

test("prompt messages have the shape the protocol requires", async () => {
  // content is a SINGLE object here, not an array — the opposite of a tool result, and the easiest
  // thing in the SDK to get wrong.
  for (const p of promptsFor(context)) {
    const out = await p.cb({ moment_id: "3", draft_id: "53", source: "claude_code" });
    assert.ok(Array.isArray(out.messages), `${p.name} did not return messages`);
    for (const m of out.messages) {
      assert.ok(["user", "assistant"].includes(m.role), `${p.name} has a bad role`);
      assert.ok(!Array.isArray(m.content), `${p.name} returned content as an array`);
      assert.equal(m.content.type, "text");
      assert.ok(m.content.text.length > 0, `${p.name} returned an empty message`);
    }
  }
});

test("inline is decided by the string true, not by truthiness", async () => {
  // Arguments arrive as strings. `if (inline)` would make "false" turn it on.
  const p = promptsFor(context).find((x) => x.name === "propose-learning");
  const off = await p.cb({ inline: "false" });
  assert.match(off.messages[0].content.text, /Call get_learning_brief/);
});

// ── Resources ─────────────────────────────────────────────────────────────────────────────────

test("the library lists every section, placeholders included", async () => {
  const lib = resourcesFor(context).find((r) => r.name === "library-section");
  const listed = await lib.uri.listCallback();

  assert.equal(listed.resources.length, 14, "not all fourteen sections are listed");
  assert.ok(listed.resources.every((r) => r.uri.startsWith("library://")));
  // A section Josh has not filled in must still be listed, and must say so. Hiding it would make
  // a missing voice guide invisible, which is exactly what isSupplied exists to prevent.
  assert.ok(listed.resources.every((r) => typeof r.description === "string"));
});

test("a moment resource returns only the fields a drafter may see", async () => {
  const m = resourcesFor(context).find((r) => r.name === "moment");
  const out = await m.read(new URL("moment://3"), { id: "3" });
  const parsed = JSON.parse(out.contents[0].text);

  // sourceEntry, not the raw row — 9.1 defines what a drafter is allowed to see, and widening it
  // here would widen it everywhere downstream.
  assert.ok(!("search_text" in parsed.material), "the raw material row leaked through");
  assert.ok(Array.isArray(parsed.must_not_name));
});

test("resource contents are an array, unlike prompt content", async () => {
  // One known-good address per resource, rather than one bag of variables sprayed at all of them.
  // The bag broke the moment a template used a variable it did not contain, and the failure was a
  // test problem rather than a code one — which is the worst kind to leave lying around.
  const SAMPLES = {
    "library-section": ["library://pillars", { key: "pillars" }],
    moment: ["moment://3", { id: "3" }],
    law: ["law://voice", { file: "voice" }],
    sentinels: ["sentinels://latest", null],
    voiceprint: ["voiceprint://josh", null],
  };

  const resources = resourcesFor(context);

  // Every resource must be covered, so adding one without a sample fails here rather than going
  // untested and looking green.
  for (const r of resources) {
    assert.ok(SAMPLES[r.name], `${r.name} has no sample address in this test`);
  }

  for (const r of resources) {
    const [uri, variables] = SAMPLES[r.name];
    const out = variables ? await r.read(new URL(uri), variables) : await r.read(new URL(uri));

    assert.ok(Array.isArray(out.contents), `${r.name} did not return a contents array`);
    assert.ok(out.contents[0].uri, `${r.name} did not echo the uri back`);
    assert.ok(out.contents[0].text.length > 0, `${r.name} returned nothing`);
  }
});

test("the voice brief keeps the transfers split, and is not silently empty", async () => {
  // renderLibrary takes the view NAME. Passing VIEWS.drafting instead gave it an undefined lookup,
  // an empty wanted-set, and every section came back blank — no error, just three empty strings
  // where the voice guide should be. Length is asserted because presence was not enough.
  const brief = await tools.find((t) => t.name === "get_voice_brief").handler({}, context);

  assert.ok(brief.from_the_library.voice_guide.length > 1000, "the voice guide came back empty");
  assert.ok(brief.from_the_library.banned_phrases.length > 100, "banned phrases came back empty");

  // The split is the entire reason this tool exists: the spoken rhythm is not a target, and the
  // comparable numbers must be offered in its place.
  assert.equal(brief.does_not_transfer.spoken_sentence_sd, 16.3);
  assert.match(brief.does_not_transfer.why, /not a\s+target/i);
  assert.ok(Object.keys(brief.does_not_transfer.use_instead.scene_writers_sd).length === 4);
  assert.ok(brief.transfers_from_speech.signature_terms.length > 0);
});

test("the voiceprint says which of its numbers do not transfer", async () => {
  // The single most misreadable thing in the file: the rhythm figures are computed from SPEECH and
  // are not targets for writing. A client attaching this as context may never scroll to the header,
  // so the warning is repeated at the top level.
  const vp = resourcesFor(context).find((r) => r.name === "voiceprint");
  const parsed = JSON.parse((await vp.read(new URL("voiceprint://josh"))).contents[0].text);

  assert.ok(parsed.how_to_read_this, "the voiceprint ships without its warning");
  assert.match(parsed.how_to_read_this.does_not_transfer, /rhythm/i);
  assert.ok(
    Object.keys(parsed.how_to_read_this.sentinel_sd_by_account).length >= 7,
    "the comparable measurements are not offered alongside",
  );
});

// ── Annotations ───────────────────────────────────────────────────────────────────────────────

test("every write tool is annotated as one", () => {
  // A client uses readOnlyHint to decide what to auto-approve. Labelling a write read-only means
  // something writes to Josh's bank without anyone being asked.
  for (const t of tools) {
    const a = annotationsFor(t.name);
    assert.equal(
      a.readOnlyHint,
      !WRITE_TOOLS.has(t.name),
      `${t.name} is annotated the wrong way round`,
    );
  }
});

test("nothing is annotated destructive, because nothing can be", () => {
  // Not a nicety. 6.3 is a revoked grant rather than a policy: neither role holds DELETE or
  // TRUNCATE on any table. If that ever stopped being true, this should stop being true with it.
  for (const t of tools) {
    assert.equal(annotationsFor(t.name).destructiveHint, false);
  }
});

// ── Local-only ────────────────────────────────────────────────────────────────────────────────

test("scan_sessions is marked local-only", () => {
  // Over HTTP it reads the edge function's own container and answers "nothing to do" forever —
  // indistinguishable from a real quiet result, which is worse than not offering it.
  const scan = tools.find((t) => t.name === "scan_sessions");
  assert.equal(scan.localOnly, true);
  assert.ok(
    !("localOnly" in scan.config),
    "localOnly is inside config, which is passed straight to the SDK",
  );
});
