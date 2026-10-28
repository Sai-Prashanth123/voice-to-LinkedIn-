/**
 * The briefs have to fit through the only surface Josh uses — task of 28 October 2026.
 *
 * WHAT WENT WRONG, MEASURED
 *
 * He has never used a clone. Every session he has run went through the hosted connector, and his
 * client truncates a tool response to a ~2 KB preview, cut mid-sentence. Measured on 28 October,
 * before the change this file guards:
 *
 *   get_drafting_brief, moment 111   73,414 chars   system 41,488   user 28,861
 *   get_gate_brief, draft 90        100,296 chars   system 29,402   checks 69,935
 *
 * The 41,488 is the eleven DRAFTING_SECTIONS pasted into the system prompt, and it does not vary
 * with the moment or the writer. The 69,935 is nine copies of one draft body and three copies of
 * one source entry. Everything after the cut was lost: the material, the audience, the shape
 * targets, must_not_name, the previous rejection. Six drafters hit it in one day and every one
 * recovered only by reading a spilled file off disk — which is exactly what his sessions cannot do.
 *
 * There is no server-side limit anywhere in this repo to raise. http.mjs, supabase/functions/mcp
 * and server.mjs all pass the whole value through as one text block, so the cut is the client's and
 * this side can neither raise nor detect it. guards.test.mjs has carried the conclusion since the
 * shape rows were paged: "A bigger limit is not the fix; nothing in a response says it was
 * truncated."
 *
 * WHY THIS SUITE NEEDS NO CREDENTIALS, UNLIKE THE OTHER BRIEF TESTS
 *
 * Three reasons, and the third is the one that decided it.
 *
 *   1. CI runs it. A size budget that only runs on a laptop with a service key is a budget nobody
 *      enforces — and .github/workflows/checks.yml excludes the live suites BY NAME, so a live
 *      version of this file would have had to be added to that list and would then never run.
 *   2. The budget has to be stable. Against the live project the numbers move whenever Josh edits a
 *      section, so a failure would not say whether the code regressed or the library grew.
 *   3. The gate brief WRITES. Its idempotence is tested by counting rows, and gate_runs has no
 *      UPDATE and no DELETE by design — a test that proved idempotence against the live project
 *      would leave permanent verdicts on real drafts to prove it.
 *
 * The library fixture is therefore synthetic, with every section's length taken from the live
 * project on 28 October 2026 (see SECTIONS). Filler of the recorded length, not a copy of his
 * standard: a second copy of the library in a test file is the drift this repo keeps paying for,
 * and the thing being measured is the SHAPE of the response, not his prose.
 *
 * And the shape is what makes the budget hold as the library grows. A pointer index is one line per
 * section, so the drafting brief's constant cost is now O(sections) rather than O(characters) —
 * which is why a fixture of recorded sizes is a fair test and would not have been before.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { tools } from "./tools/index.mjs";
import { resourcesFor } from "./resources.mjs";
import { DRAFTER_SYSTEM, GATE_CHECKS, GATE_SYSTEM } from "../supabase/functions/_shared/prompts.ts";
import {
  CHECK_SEES_SOURCE,
  DRAFTING_SECTIONS,
  GATING_SECTIONS,
  renderLibrary,
} from "../supabase/functions/_shared/views.ts";

/* ── The fixture ──────────────────────────────────────────────────────────── */

/**
 * The live library's shape on 28 October 2026: every section, its title, and the length of its body
 * after `isSupplied` has had its say. `chars: 0` is a placeholder Josh has not written.
 *
 * Numbers, not prose. Read off the project with one query; the totals they produce are 38,099
 * characters across the drafting view and 27,182 across the gating view, which is where the 41,488
 * and 29,402 above come from once the headings are added.
 */
const SECTIONS = [
  { key: "core_rules", title: "Core rules (never tunable)", chars: 543 },
  { key: "pillars", title: "Content pillars", chars: 933 },
  { key: "frameworks", title: "Body frameworks", chars: 664 },
  { key: "hooks", title: "Hook rules", chars: 3677 },
  { key: "closes", title: "Closing lines", chars: 1051 },
  { key: "audience", title: "Who he is talking to", chars: 1865 },
  { key: "voice_guide", title: "Voice guide (from speech, not the archive)", chars: 8341 },
  { key: "prompt_set", title: "The prompt set", chars: 12635 },
  { key: "banned_phrases", title: "Banned phrases and AI tells", chars: 8935 },
  { key: "formatting", title: "LinkedIn formatting rules", chars: 1165 },
  { key: "gate_rules", title: "Gate rules", chars: 2656 },
  { key: "visual_brand", title: "Visual brand", chars: 5791 },
  { key: "receipts", title: "Receipts (his career, method and numbers)", chars: 0 },
  {
    key: "reference_posts",
    title: "Reference posts by other writers (structure only)",
    chars: 10925,
  },
  { key: "reference_writer_reads", title: "Structural readings of individual writers", chars: 0 },
  { key: "voice_transcript", title: "The voice interview", chars: 0 },
];

/**
 * A body of exactly `chars` characters that `isSupplied` calls supplied, or the placeholder shape it
 * calls absent. Both halves matter: a placeholder that read as supplied would be handed to a drafter
 * as though it were the standard, which is the bug isSupplied was written for.
 */
function body({ title, chars }) {
  if (chars === 0) {
    return `# ${title}\n\nFOR JOSH. Not drafted, because guessing at what you write about would ` +
      `put words in your mouth.`;
  }
  // Prose-shaped filler rather than one repeated character, so a reader of a failure can see it is
  // a fixture and not a fragment of his library.
  const unit = "fixture section text, standing in for the real standard. ";
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

const librarySections = (overrides = {}) =>
  SECTIONS.map((s, i) => {
    const spec = { ...s, ...(overrides[s.key] ?? {}) };
    return { key: spec.key, title: spec.title, body: body(spec), sort_order: i };
  });

/**
 * Enough of mcp-server/db.mjs to run a brief, and nothing more.
 *
 * `insert` appends into the same state `select` reads, which is the only reason the idempotence test
 * below means anything: the second call has to SEE what the first one wrote, exactly as PostgREST
 * would show it.
 */
function fakeDb(state) {
  const matches = (row, query) => {
    for (const [column, raw] of Object.entries(query)) {
      if (["select", "order", "limit", "offset"].includes(column)) continue;
      const value = String(raw);
      // Only the operators the briefs actually use. An unknown one throws rather than silently
      // matching everything — a fake that over-matches turns a filter bug into a green test.
      if (value.startsWith("eq.")) {
        if (String(row[column] ?? "") !== value.slice(3)) return false;
      } else if (value === "is.null") {
        if (row[column] !== null && row[column] !== undefined) return false;
      } else if (value === "is.true" || value === "is.false") {
        if (Boolean(row[column]) !== (value === "is.true")) return false;
      } else if (value.startsWith("neq.")) {
        if (String(row[column] ?? "") === value.slice(4)) return false;
      } else {
        throw new Error(`fakeDb does not implement "${column}=${value}"`);
      }
    }
    return true;
  };

  return {
    state,
    async select(table, query = {}) {
      const rows = (state[table] ?? []).filter((r) => matches(r, query));
      const limit = query.limit === undefined ? undefined : Number(query.limit);
      return limit === undefined ? rows : rows.slice(0, limit);
    },
    async insert(table, rows) {
      state[table] = [...(state[table] ?? []), ...rows];
      return rows;
    },
    async rpc(name) {
      return state.rpc?.[name] ?? [];
    },
  };
}

/**
 * The field names are SOURCE_FIELDS', not invented ones: `sourceEntry` copies that list and nothing
 * else, so a fixture using a plausible-sounding field would silently produce an empty entry — and
 * an empty entry is exactly what the "the source appears once" assertion below would then be
 * proving nothing about.
 */
const MATERIAL = {
  moment_id: 1,
  the_moment: "A fixture scene, long enough to stand in for real mined material. ".repeat(12),
  their_actual_words: "We have never once looked at that number.",
  what_changed: "He stopped opening with the dashboard. ".repeat(8),
  the_realisation: "Because the question nobody asks is the one that costs money. ".repeat(10),
};

const DRAFT_BODY = "A fixture draft body, one paragraph among several.\n\n".repeat(30);

function state(overrides = {}) {
  return {
    moments: [{ id: 1, title: "A fixture moment", killed: false, status: "mined", audience: "Heads of revenue operations", pillar: "diagnosis", reopened_at: null }],
    material: [MATERIAL],
    raw_inputs: [{ moment_id: 1, text_body: "What he typed, at length. ".repeat(80), transcript: null, id: 1 }],
    moment_names: [
      { moment_id: 1, name: "Northwind Logistics", kind: "company", cleared: false, cleared_at: null },
      { moment_id: 1, name: "Ben", kind: "person", cleared: true, cleared_at: "2026-10-20" },
    ],
    drafts: [{ id: 7, moment_id: 1, body: DRAFT_BODY, version: 1, library_version: 70, gate_passed: null }],
    jobs: [],
    gate_runs: [],
    library_sections: librarySections(overrides.library),
    library_versions: [{ version: 70 }],
    reference_writer_posts: [],
    ...overrides.state,
  };
}

/** The handler, with no url or key in the context — recordBriefRead returns early without them. */
const call = (name, args, db) => {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler(args, { db });
};

const drafting = (args = {}, st = state()) =>
  call("get_drafting_brief", { moment_id: 1, ...args }, fakeDb(st));

const gating = (args = {}, db = fakeDb(state())) =>
  call("get_gate_brief", { draft_id: 7, ...args }, db);

/* ── The budgets ──────────────────────────────────────────────────────────── */

/*
 * RECORDED, NOT GUESSED, and deliberately not tight.
 *
 * A budget set to the current measurement fails on every harmless edit and gets raised without
 * being read, which is how a limit stops being one. These are set at roughly 1.5× what the shape
 * costs today, so an ordinary change to the prose passes and re-inlining a library does not: the
 * drafting brief's constant half would have to grow eightfold to breach it.
 */
const DRAFTING_BUDGET = 20_000;
const GATE_BUDGET = 40_000;
/** The constant half on its own. 4,764 live on 28 October; 41,488 before the change. */
const DRAFTER_SYSTEM_BUDGET = 8_000;
const GATE_SYSTEM_BUDGET = 8_000;

const quoted = (label, actual, budget) =>
  `${label} serialises to ${actual} characters, over its recorded budget of ${budget}. ` +
  `His client previews ~2 KB and cannot say it cut anything, so every character above the ` +
  `budget is a character that may not arrive.`;

/**
 * Serialised the way the TRANSPORT serialises, which is not the default.
 *
 * `server.mjs` sends `JSON.stringify(value, null, 2)`. This file measured `JSON.stringify(value)`,
 * so every size here was the compact one — about 3% under what actually reaches him, and the gap
 * grows with the nesting rather than staying a rounding error.
 *
 * It mattered most in the first-2,000-characters test, not the budgets. His client cuts the INDENTED
 * text, and indentation means fewer keys fit under the cut — so measuring compact there was
 * optimistic in the one place being optimistic is worst: it could pass while `must_not_name` sat
 * below the cut on the real response.
 *
 * Tied to the transport here rather than restated, so if `server.mjs` stops indenting this is the
 * line that changes with it.
 */
const wire = (value) => JSON.stringify(value, null, 2);

test("the drafting brief stays inside its recorded budget", async () => {
  const brief = await drafting();
  const size = wire(brief).length;

  assert.ok(size <= DRAFTING_BUDGET, quoted("get_drafting_brief", size, DRAFTING_BUDGET));
  assert.ok(
    brief.system.length <= DRAFTER_SYSTEM_BUDGET,
    quoted("its `system`", brief.system.length, DRAFTER_SYSTEM_BUDGET),
  );
  // The pointer index is not a summary of the standard, so it must still be substantial enough to
  // carry the writing discipline itself — the prose above the library is 2,907 characters of it.
  assert.ok(brief.system.length > 1000, "the writing standard was summarised away");
});

test("the gate brief stays inside its recorded budget, with every check offered", async () => {
  const brief = await gating();
  const size = wire(brief).length;

  assert.equal(brief.checks.length, GATE_CHECKS.length, "every check should be outstanding here");
  assert.ok(size <= GATE_BUDGET, quoted("get_gate_brief", size, GATE_BUDGET));
  assert.ok(
    brief.system.length <= GATE_SYSTEM_BUDGET,
    quoted("its `system`", brief.system.length, GATE_SYSTEM_BUDGET),
  );
});

/* ── The contract that survives a cut ─────────────────────────────────────── */

test("brief_is_complete is the last key of both briefs, and response_chars is the response", async () => {
  for (const brief of [await drafting(), await gating()]) {
    const keys = Object.keys(brief);
    assert.equal(
      keys.at(-1),
      "brief_is_complete",
      "the terminal marker is not last, so its absence no longer means the response was cut",
    );
    assert.equal(brief.brief_is_complete, true);

    const serialised = wire(brief);
    assert.equal(
      brief.response_chars,
      serialised.length,
      "response_chars disagrees with the response, which is worse than not quoting a figure",
    );
    /*
     * The marker has to be the last thing in the TEXT as well as the last key. JSON.stringify
     * preserves insertion order, and this is the assertion that says so rather than assuming it.
     *
     * Matched with a pattern rather than an exact tail, because the exact tail depends on whether
     * the serialiser indents — it was `"brief_is_complete":true}` and the transport actually sends
     * `"brief_is_complete": true\n}`. A test pinned to one spelling of whitespace fails on a change
     * that is not the thing it is guarding.
     */
    assert.match(
      serialised,
      /"brief_is_complete":\s*true\s*\}\s*$/,
      "the marker is not at the end of the serialised text",
    );
  }
});

test("read_this_first and must_not_name land inside the first 2,000 characters", async () => {
  const brief = await drafting();
  const head = wire(brief).slice(0, 2000);

  assert.ok(head.includes('"read_this_first"'), "the recovery instruction is below the cut");
  assert.ok(
    head.includes('"must_not_name"'),
    "the one instruction that must never be missed is below the cut",
  );
  assert.ok(
    brief.read_this_first.includes("brief_is_complete"),
    "the first key does not say what the terminal marker is for",
  );
  assert.ok(
    /get_library|library:\/\//.test(brief.read_this_first),
    "the first key does not say where the library is",
  );
  // Short enough to survive on its own. 600 is the design ceiling; quoted so a failure says by how
  // much it was missed rather than only that it was.
  assert.ok(
    brief.read_this_first.length <= 600,
    `read_this_first is ${brief.read_this_first.length} characters, over its 600 ceiling — the one ` +
    `string guaranteed to arrive cannot itself be the thing that gets cut`,
  );
});

test("the gate brief's first key sends a cut reader to one check at a time", async () => {
  const brief = await gating();
  assert.ok(brief.read_this_first.includes("check_key"), "no way back from a cut gate brief");
  assert.ok(brief.read_this_first.includes("brief_is_complete"));
});

/* ── Pointer integrity ────────────────────────────────────────────────────── */

/**
 * Read one `library://` URI the way a client would, through resourcesFor.
 *
 * This is the half that a pointer index cannot prove about itself: an index naming a section the
 * resource cannot serve is worse than no index, because the reader is told the standard is one call
 * away and the call fails.
 */
async function readUri(db, uri) {
  const resource = resourcesFor({ db }).find((r) => r.name === "library-section");
  assert.ok(resource, "library://{key} is not registered as a resource");
  const key = uri.replace("library://", "");
  return await resource.read(new URL(uri), { key });
}

for (const [view, sections, fetchBrief] of [
  ["drafting", DRAFTING_SECTIONS, drafting],
  ["gating", GATING_SECTIONS, gating],
]) {
  test(`every library:// URI the ${view} brief prints resolves, and the set is exactly the view`, async () => {
    const st = state();
    const db = fakeDb(st);
    const brief = view === "drafting"
      ? await call("get_drafting_brief", { moment_id: 1 }, db)
      : await fetchBrief({}, db);

    const printed = brief.library_pointers.sections.map((s) => s.uri);
    assert.deepEqual(
      [...printed].sort(),
      [...sections].map((k) => `library://${k}`).sort(),
      `the ${view} index and ${view === "drafting" ? "DRAFTING_SECTIONS" : "GATING_SECTIONS"} ` +
      `disagree — one of them is wrong about what this view may read`,
    );

    for (const uri of printed) {
      const read = await readUri(db, uri);
      assert.ok(read.contents?.[0]?.text, `${uri} resolved to nothing`);
    }

    // The index also has to appear in the prompt the model reads, not only in a sibling field a
    // client may not surface. Both come from one function, so they cannot disagree.
    for (const key of sections) {
      assert.ok(
        brief.system.includes(`library://${key}`),
        `${key} is in the view and its URI is not in the prompt`,
      );
    }
  });
}

test("the gate's pointer index names the gating keys and no others, which is the view split", async () => {
  const brief = await gating();
  // The pair this replaces: tools.test.mjs asserted that the string "Reference posts" was absent
  // from 29 KB of prose. A list of exactly six keys says the same thing where a person can see it.
  for (const key of ["reference_posts", "voice_transcript"]) {
    assert.ok(
      !brief.library_pointers.sections.some((s) => s.key === key),
      `the gate is being offered ${key} — a judge that has read another writer's posts starts ` +
      `measuring against their voice rather than Josh's`,
    );
    assert.ok(!brief.system.includes(`library://${key}`), `${key}'s URI reached the gate's prompt`);
  }
});

test("a placeholder is named as one rather than counted as filled in", async () => {
  const brief = await drafting({}, state({ library: { voice_guide: { chars: 0 } } }));
  const guide = brief.library_pointers.sections.find((s) => s.key === "voice_guide");
  assert.equal(guide.placeholder, true, "an empty voice guide reads as a section to go and read");
  assert.ok(brief.library_sections_awaiting_josh.includes("voice_guide"));
  assert.match(brief.system, /PLACEHOLDER/, "the prompt does not show the gap");
});

/* ── The escape hatches ───────────────────────────────────────────────────── */

test("library: inline reproduces the standard byte for byte", async () => {
  const st = state();
  const brief = await drafting({ library: "inline" }, st);
  const expected = DRAFTER_SYSTEM(renderLibrary(st.library_sections, "drafting").prompt);

  assert.equal(
    brief.system,
    expected,
    "the inline form has drifted from DRAFTER_SYSTEM(renderLibrary(rows, \"drafting\")). It is the " +
    "escape hatch and the eval harness's baseline; an escape hatch that quietly changes is not one",
  );
  // And it is genuinely the bodies, not the index with extra words. The drafter MAY see reference
  // posts, for structure only — 8.3 — which is the half of that pair the gate test above denies.
  assert.ok(brief.system.includes("Reference posts"), "the drafter's view lost reference posts");
  assert.ok(
    brief.system.length > 35_000,
    `inline returned ${brief.system.length} characters; the eleven sections are ~41,500`,
  );
});

test("bodies: per_check restores the gate brief as it stood before 28 October", async () => {
  const st = state();
  const brief = await gating({ bodies: "per_check" }, fakeDb(st));

  assert.equal(
    brief.system,
    GATE_SYSTEM(renderLibrary(st.library_sections, "gating").prompt),
    "per_check no longer restores the inline system prompt",
  );
  assert.equal(brief.body, undefined, "per_check should not hoist the post as well");
  assert.equal(brief.source_entry, undefined, "per_check should not hoist the source as well");

  const copies = JSON.stringify(brief.checks).split(JSON.stringify(DRAFT_BODY).slice(1, -1)).length - 1;
  assert.equal(copies, GATE_CHECKS.length, "per_check did not inline the post in every check");
});

/* ── One copy of the post, one of the source ──────────────────────────────── */

test("the post appears once at the top and never inside a check", async () => {
  const brief = await gating();

  assert.equal(brief.body, DRAFT_BODY, "the post is not carried once at the top level");
  const inChecks = JSON.stringify(brief.checks)
    .split(JSON.stringify(DRAFT_BODY).slice(1, -1)).length - 1;
  assert.equal(
    inChecks,
    0,
    `the draft body still appears ${inChecks} times inside checks. Nine copies of one post is not ` +
    `nine inputs; it is one input billed nine times, and it was 24,597 of draft 90's 100,296 ` +
    `characters`,
  );
  for (const check of brief.checks) {
    assert.ok(
      check.user.includes('THE POST is the "body" field at the top of this response.'),
      `${check.check_key} does not say where the post is`,
    );
  }
});

test("the source appears once, and hoisting neither widens nor narrows which checks see it", async () => {
  const brief = await gating();
  const serialised = JSON.stringify(brief);

  assert.ok(brief.source_entry, "the source was not hoisted");
  const needle = JSON.stringify(MATERIAL.the_moment).slice(1, -1);
  assert.equal(
    serialised.split(needle).length - 1,
    1,
    "the source material appears more than once; it was three copies of 11,307 characters on " +
    "moment 111, the largest single duplication in the response",
  );

  // THE FILTER IS STILL gateInputsFor's, AND THIS IS THE ASSERTION THAT SAYS SO. Hoisting moves
  // where the text sits; it must not move who is told it exists. On 5 October five of the checks
  // were reading his private notes and failing drafts for things that were not in them.
  const sawSource = brief.checks.filter((c) => c.sees.includes("source")).map((c) => c.check_key);
  assert.deepEqual([...sawSource].sort(), [...CHECK_SEES_SOURCE].sort());
  for (const check of brief.checks) {
    const mentions = check.user.includes('"source_entry" field');
    assert.equal(
      mentions,
      check.sees.includes("source"),
      `${check.check_key}: its text and its \`sees\` array disagree about the source`,
    );
  }
});

/* ── Parts and single checks ──────────────────────────────────────────────── */

test("part returns one half and says where the other one is", async () => {
  const all = await drafting();

  const material = await drafting({ part: "material" });
  assert.equal(material.system, undefined, "part: material still carried the standard");
  assert.equal(material.user, all.user, "part: material changed the material");
  assert.match(material.the_other_part, /part: "instructions"/);

  const instructions = await drafting({ part: "instructions" });
  assert.equal(instructions.user, undefined, "part: instructions still carried the material");
  assert.equal(instructions.system, all.system, "part: instructions changed the standard");
  assert.match(instructions.the_other_part, /part: "material"/);

  // must_not_name is in BOTH halves. It is the one instruction that must never be missed, and a
  // caller that asked for the instructions is a caller about to write.
  assert.deepEqual(material.must_not_name, ["Northwind Logistics"]);
  assert.deepEqual(instructions.must_not_name, ["Northwind Logistics"]);

  // A reader cut while holding the material cannot be sent back for the material.
  assert.match(material.read_this_first, /moment:\/\/1|get_moment/);
});

test("check_key returns one rubric and still reports the whole draft", async () => {
  const brief = await gating({ check_key: "claims_trace" });

  assert.equal(brief.checks.length, 1);
  assert.equal(brief.checks[0].check_key, "claims_trace");
  assert.equal(
    brief.checks_remaining,
    GATE_CHECKS.length,
    "a judge told one check remains when nine do would stop after one",
  );
  assert.equal(brief.checks_in_this_response, 1);
  assert.ok(brief.source_entry, "claims_trace cannot judge without the source");
});

test("an unknown check_key is said out loud rather than answered with an empty list", async () => {
  const brief = await gating({ check_key: "not_a_check" });
  assert.equal(brief.checks.length, 0);
  assert.match(brief.check_key_not_offered, /not a check awaiting a verdict/);
  assert.match(brief.check_key_not_offered, /anyone_else/, "it does not say what IS outstanding");
});

/* ── The write that stops the re-gate loop ────────────────────────────────── */

test("the unjudgeable rows are written once, however many times the brief is asked for", async () => {
  // voice_guide empty, so the voice_guide check has nothing to judge against and is recorded as NOT
  // JUDGED rather than passed on no evidence.
  const st = state({ library: { voice_guide: { chars: 0 } } });
  const db = fakeDb(st);

  assert.equal(st.gate_runs.length, 0);

  const first = await gating({}, db);
  assert.deepEqual(first.not_judgeable, ["voice_guide"]);
  assert.equal(st.gate_runs.length, 1, "the NOT JUDGED row was not written");
  assert.equal(st.gate_runs[0].check_key, "voice_guide");
  assert.equal(st.gate_runs[0].model, "none");
  assert.match(st.gate_runs[0].reason, /NOT JUDGED/);

  const second = await gating({}, db);
  assert.equal(
    st.gate_runs.length,
    1,
    "a second brief wrote the row again. Without the `done` set this would double every verdict " +
    "on a resumed run, and gate_runs has no UPDATE and no DELETE to clean it up with",
  );
  assert.ok(!second.checks.some((c) => c.check_key === "voice_guide"));
  assert.ok(second.already_judged.includes("voice_guide"));
});

/* ── The wrappers that carry a brief ─────────────────────────────────────── */

/*
 * next_work HANDS BACK A BRIEF INSIDE ANOTHER OBJECT, SO IT IS THE SAME PROBLEM ONE LAYER OUT.
 *
 * Both of its branches were unexercised by anything until this suite: in one-step mode — the mode
 * Josh is in — it returns early with no brief at all, so a live call cannot reach either of them.
 * That is exactly the shape of code that works until the mode changes.
 */
for (const [what, state$, expected] of [
  ["a draft to gate", () => state({ state: { settings: [] } }), "gate"],
  [
    "a post to write",
    () => state({
      state: {
        settings: [],
        // Nothing ungated, so the gate branch is skipped and the writing branch is reached.
        drafts: [{ id: 7, moment_id: 1, body: DRAFT_BODY, version: 1, gate_passed: true }],
        // `type` and `status` because next_work reads the pending draft queue by both. A row
        // missing either is a row the queue does not see, which is how this fixture first returned
        // "none" and proved nothing.
        jobs: [{
          id: 1,
          type: "draft",
          status: "pending",
          payload: { moment_id: 1, attempt: 1 },
          created_at: "2026-10-28",
        }],
      },
    }),
    "draft",
  ],
]) {
  test(`next_work offering ${what} keeps the brief's contract in its own response`, async () => {
    const st = state$();
    const brief = await call("next_work", {}, fakeDb(st));

    assert.equal(brief.work, expected);
    const keys = Object.keys(brief);
    assert.equal(keys[0], "read_this_first", "the recovery instruction is not the first key");
    assert.equal(keys.at(-1), "brief_is_complete", "the terminal marker is not last");
    assert.equal(brief.response_chars, wire(brief).length);

    // ONE SIGNAL, NOT THREE. A nested brief keeping its own size and marker would have a reader
    // checking the wrong object and concluding a whole response was cut, or a cut one whole.
    assert.equal(brief.brief.response_chars, undefined, "the nested brief kept its own size");
    assert.equal(brief.brief.brief_is_complete, undefined, "the nested brief kept its own marker");
    assert.equal(brief.brief.read_this_first, undefined, "two recovery instructions in one reply");

    // And it still carries the pointers, or the writer has no route to the standard at all.
    assert.ok(brief.brief.library_pointers.sections.length > 0);
    assert.ok(
      brief.how.some((h) => /library:\/\/|get_library/.test(h)),
      "next_work tells the caller to write or judge from the brief without saying that the " +
      "library has to be fetched — which is 'the default framework gets used anyway' again",
    );
  });
}

test("the write happens before the response is measured, so a size refusal cannot skip it", () => {
  /*
   * Asserted by source, because the only way to make `seal` throw is to make it fail to settle —
   * and a test that engineered that would be testing the engineering.
   *
   * The order is the point. The insert is what stops cc-agent re-gating a draft for ever at eight
   * of nine verdicts, and `seal` is the one thing in the handler that can throw after the reads
   * have finished. If assembly came first, a response that would not settle would cost the loop
   * rather than the response.
   */
  const src = readFileSync(new URL("./tools/brief.mjs", import.meta.url), "utf8");
  const gate = src.slice(src.indexOf('name: "get_gate_brief"'));
  const insertAt = gate.indexOf('db.insert("gate_runs"');
  const sealAt = gate.indexOf("return seal(");
  assert.ok(insertAt > 0 && sealAt > 0, "the gate brief no longer inserts or no longer seals");
  assert.ok(
    insertAt < sealAt,
    "the gate_runs insert has moved after the measurement. A size refusal would then skip the " +
    "write that stops the re-gate loop, which is more expensive than a long response",
  );
});
