/**
 * The extraction shape, and the name guard that an empty array cannot fail.
 *
 * WHAT THIS FILE IS FOR
 *
 * From 13 to 28 Oct 2026 `write_post` — the second call of every session in the mode Josh is
 * actually in — declared its `extracted` parameter as `z.record(z.string())`. The real shape has
 * eighteen fields and six of them are not strings. The MCP boundary parses that record, so a caller
 * passing `names` was answered with "expected string, received array", and a caller passing
 * `audience_known: true` with "expected string, received boolean". Both are hard refusals, so the
 * model learned not to send them.
 *
 * The consequence is the one thing CLAUDE.md says can never fail: "Never name a client." Every link
 * in that chain filters an array — `unclearedNames` (names.ts), `create_draft`'s word-boundary
 * refusal (write.mjs), `verifyDraft` (claims.ts) — and AN EMPTY ARRAY CANNOT FAIL A FILTER.
 * Measured 28 Oct 2026: 31 of the 48 moments with material hold zero `moment_names` rows, every
 * moment from 100 to 114 among them. Moment 110's material contains Josh saying "My client Thermal
 * doesn't want me to mention Shoden… so let's drop them", and `get_drafting_brief` returned
 * `must_not_name: []`.
 *
 * So these tests are not about zod. They are about the four ways this defect could come back:
 * a second declaration of the shape, a field quietly dropped from it, a coercion that turns
 * "false" into true, and a detector that stops being able to tell "nothing recorded" from "nothing
 * to record".
 *
 * Offline by construction — no database, and `fetch` is stubbed where a write door would be called.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The registry, not the modules: onestep.mjs and tools/index.mjs form a cycle, and the registry is
// how the server itself reaches a tool. mode.test.mjs documents this at its own import site.
import { tools } from "./tools/index.mjs";
import { EXTRACTION, EXTRACTION_FIELDS } from "./tools/extraction-shape.mjs";
import { REFERENCE_WRITERS } from "./writers.mjs";
import {
  candidateNames,
  missingNames,
  verifyExtraction,
} from "../supabase/functions/_shared/extraction.ts";

const writePost = tools.find((t) => t.name === "write_post");
const submitExtraction = tools.find((t) => t.name === "submit_extraction");

/** The six fields that are not strings, which is the whole of what the old schema could not carry. */
const NOT_STRINGS = [
  "names",
  "audience_known",
  "audience_is_buyer",
  "time_sensitive",
  "strength",
  "decays_in_days",
];

/** A complete, honest extraction, for the tests that are not about what is missing. */
const FULL = {
  the_moment: "The CFO stopped me halfway through the deck",
  the_detail: "He put his pen down first",
  the_realisation: "I had been answering a question nobody asked",
  the_lesson: "Open where they already are",
  audience: "Founders selling to finance",
  audience_known: true,
  audience_is_buyer: true,
  strength: 4,
  time_sensitive: false,
  names: [{ name: "Jordan Crawford", kind: "person" }],
};

/* ── 1. One declaration, not two that agree ───────────────────────────────── */

test("write_post and submit_extraction share the SAME extraction object", () => {
  /*
   * Identity, not shape equality. Comparing shapes detects a divergence after somebody writes it;
   * identity makes the second declaration impossible to write — there is one object and both tools
   * point at it. That is conformance.test.mjs's whole premise, and this defect is the case it was
   * built for: the two schemas did not disagree by accident, they were written in different files
   * eleven days apart and nothing ever compared them.
   */
  assert.equal(
    writePost.config.inputSchema.extracted,
    submitExtraction.config.inputSchema.extracted,
    "write_post has its own declaration of the extraction again",
  );
  assert.equal(writePost.config.inputSchema.extracted, EXTRACTION);
});

test("write_post's schema carries every field the extraction has, read off the schema itself", () => {
  // Asserted against EXTRACTION's own key set rather than a list typed out here, so a nineteenth
  // field cannot be added to the shape and silently missed by this test.
  const declared = Object.keys(writePost.config.inputSchema.extracted.shape);
  assert.deepEqual(declared, EXTRACTION_FIELDS);
  assert.equal(declared.length, 18, "the shape changed size — update the prose that says eighteen");

  for (const field of NOT_STRINGS) {
    assert.ok(declared.includes(field), `write_post cannot carry ${field}`);
  }
});

test("the shape still matches schemas.ts, which is the real authority", () => {
  /*
   * `ExtractionSchema` is `npm:zod@4` — a Deno specifier Node cannot resolve — so this reads it as
   * source, the way mode.test.mjs reads inspect.mjs. The edge function parses against that one and
   * validates against the transcript; this module exists only to tell a caller what the fields are.
   * Two copies is the mistake this repository keeps paying for, so they are pinned together here
   * rather than trusted to stay in step.
   */
  const source = readFileSync(
    new URL("../supabase/functions/_shared/schemas.ts", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("export const ExtractionSchema"),
    source.indexOf("export type Extraction"),
  );
  const keys = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);

  assert.deepEqual(
    [...keys].sort(),
    [...EXTRACTION_FIELDS].sort(),
    "extraction-shape.mjs and schemas.ts no longer describe the same extraction",
  );
});

/* ── 2. The six fields, accepted — and "false" not read as true ───────────── */

test("the real shape parses: an array of names, three booleans, two numbers", () => {
  const parsed = EXTRACTION.parse(FULL);

  assert.deepEqual(parsed.names, [{ name: "Jordan Crawford", kind: "person" }]);
  assert.equal(parsed.audience_known, true);
  assert.equal(parsed.audience_is_buyer, true);
  assert.equal(parsed.time_sensitive, false);
  assert.equal(parsed.strength, 4);
  // `.default(0)`, which never materialised while write_post reached the handler directly.
  assert.equal(parsed.decays_in_days, 0);
});

test('a string "false" becomes false, and is never read as a truthy string', () => {
  /*
   * THE LIVE BUG A NAIVE COERCION WOULD HAVE INTRODUCED.
   *
   * `Boolean("false")` is `true`. A caller that has been told every field is a span of text sends
   * the flags as strings, and coercing them with Boolean() would turn "I am guessing about the
   * reader" into "the reader is certain" — silently, and in the confident direction, which is the
   * exact failure 5.6 exists to prevent. The two strings are listed and mapped by hand instead.
   */
  const parsed = EXTRACTION.parse({
    ...FULL,
    audience_known: "false",
    audience_is_buyer: "true",
    time_sensitive: "false",
    strength: "2",
    decays_in_days: "14",
  });

  assert.equal(parsed.audience_known, false, '"false" was read as true');
  assert.equal(parsed.audience_is_buyer, true);
  assert.equal(parsed.time_sensitive, false);
  assert.equal(parsed.strength, 2);
  assert.equal(parsed.decays_in_days, 14);
});

test("a string that is not plainly true or false is refused, with the reason in the message", () => {
  // Rejected loudly rather than guessed at. "yes" and "1" are a caller improvising, and improvising
  // on this field decides whether the audience is stored at all.
  for (const value of ["yes", "1", "", "maybe", "FALSE "]) {
    const r = EXTRACTION.safeParse({ ...FULL, audience_known: value });
    assert.equal(r.success, false, `audience_known accepted ${JSON.stringify(value)}`);
    assert.match(
      r.error.issues.map((i) => i.message).join(" "),
      /true or false/,
      "the refusal does not say what is accepted",
    );
  }

  // And the bounds still hold, so an inflated strength cannot be smuggled through as a string.
  assert.equal(EXTRACTION.safeParse({ ...FULL, strength: "9" }).success, false);
  assert.equal(EXTRACTION.safeParse({ ...FULL, strength: 0 }).success, false);
});

test("the old flat record of strings is refused, and the refusal names the fields to add", () => {
  /*
   * This is what backward compatibility means here, and it is deliberately NOT a set of defaults.
   * The repo's own argument is in handlers/gate.ts: a verdict with no basis recorded as a pass is
   * worse than no verdict. `strength: 3` as a default is a fabricated judgement that then decides
   * whether the park guard fires, so there must not be one.
   *
   * What makes that safe mid-session is that the refusal is readable and retryable — one extra
   * round trip with the field names in it, against today, where a SUCCESSFUL call produced a null
   * audience and a dead name guard.
   */
  const r = EXTRACTION.safeParse({ the_moment: "something happened" });
  assert.equal(r.success, false);

  const named = r.error.issues.map((i) => i.path.join(".")).sort();
  assert.deepEqual(named, [
    "audience_is_buyer",
    "audience_known",
    "strength",
    "time_sensitive",
  ]);
  // The two with honest defaults are not in that list, because they have an answer that is not a
  // judgement: nothing decays by default and nobody is named by default.
  assert.ok(!named.includes("decays_in_days"));
  assert.ok(!named.includes("names"));
});

test("every field tells the caller something — and names tells it the consequence", () => {
  // The describe() text is the ONLY instruction a model receives about this parameter. Four places
  // said "the ten fields" while the shape had eighteen, and a model counting to ten and stopping is
  // a model obeying its tool.
  for (const [field, schema] of Object.entries(EXTRACTION.shape)) {
    const described = schema.description ?? schema._zod?.def?.description ?? "";
    assert.ok(described.length > 10, `${field} carries no instruction at all`);
  }

  const names = EXTRACTION.shape.names.description ?? "";
  assert.match(names, /every person and company/i, "names does not say what to record");
  assert.match(names, /does not name anyone|does not clear/i, "names does not say recording is safe");
  assert.match(names, /filter|empty array/i, "names does not say what an empty array costs");

  for (const text of [writePost.config.description, submitExtraction.config.description]) {
    assert.doesNotMatch(text, /the ten fields/i, "a tool still tells the caller there are ten");
  }
});

/* ── 3. The names actually reach the write door ───────────────────────────── */

test("names passed to write_post arrive at the write door intact", async () => {
  /*
   * Asserted at the handler boundary rather than against a database, because the thing that was
   * broken is between the two tools: `viaTool` reaches `submit_extraction`'s handler directly, so
   * the only place the names can be observed leaving this process is the request it posts.
   *
   * The stub answers `status: "parked"`, which short-circuits write_post before it asks for a
   * drafting brief — that needs a live library and is tested elsewhere. The names have already been
   * posted by then, which is the whole claim.
   */
  const realFetch = globalThis.fetch;
  const posted = [];
  globalThis.fetch = async (url, init) => {
    posted.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "parked", note: "parked for this test" }),
    };
  };

  try {
    await writePost.handler(
      {
        moment_id: 110,
        extracted: {
          ...FULL,
          the_realisation: "",
          the_lesson: "",
          strength: 1,
          names: [
            { name: "Thermal", kind: "company" },
            { name: "Shoden", kind: "company" },
            { name: "Jordan", kind: "person" },
          ],
        },
      },
      { db: { async select() { return [{ value: true }]; } }, url: "https://example.test", key: "k" },
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  const extraction = posted.find((p) => p.body.kind === "extraction");
  assert.ok(extraction, "write_post never submitted an extraction");
  assert.match(extraction.url, /functions\/v1\/cc-submit/, "it did not go through the write door");
  assert.deepEqual(
    extraction.body.extracted.names.map((n) => n.name),
    ["Thermal", "Shoden", "Jordan"],
    "the names were dropped between write_post and cc-submit",
  );
  assert.equal(extraction.body.extracted.audience_known, true, "the audience flag was dropped");
  assert.equal(extraction.body.extracted.strength, 1, "the strength was dropped");
  // The default that could not materialise while nothing parsed the inner schema.
  assert.equal(extraction.body.extracted.decays_in_days, 0, "viaTool applied no defaults");
});

test("viaTool refuses arguments the target tool does not accept, readably", async () => {
  /*
   * In production this cannot refuse anything the MCP boundary has not already refused — a real
   * call is parsed against write_post's own schema before this handler exists. It is asserted
   * because the alternative is what used to happen: `tool.handler(args)` with no parse at all, so
   * two tools' schemas could disagree in effect however well they agreed in text.
   */
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("viaTool dispatched an invalid call to the write door");
  };

  try {
    await assert.rejects(
      () => writePost.handler(
        { moment_id: 110, extracted: { the_moment: "x", strength: 99, audience_known: true, audience_is_buyer: true, time_sensitive: false } },
        { db: {}, url: "https://example.test", key: "k" },
      ),
      (err) => {
        assert.match(err.message, /submit_extraction/, "the refusal does not say which tool");
        assert.match(err.message, /strength/, "the refusal does not name the field");
        assert.match(err.message, /[Nn]othing has been stored/, "it does not say nothing was stored");
        return true;
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ── 4. The detector: "not scanned" vs "scanned, found nothing" ───────────── */

test("missingNames finds a name in his words that the extraction recorded no row for", () => {
  // Moment 110's own material, shortened. Six parties named; `must_not_name` came back empty.
  const said =
    "My client Thermal doesn't want me to mention Shoden, so let's drop them. " +
    "I asked Jordan about it and Firmable had the same problem.";

  const missing = missingNames({ names: [] }, said);
  for (const expected of ["Thermal", "Shoden", "Jordan", "Firmable"]) {
    assert.ok(missing.includes(expected), `missingNames did not find ${expected}`);
  }
});

test("a name already recorded is not reported again, however he spaced it", () => {
  const said = "We pulled the list out of Zoom Info and Jordan Crawford checked it.";

  // Recorded closed-up, said open. Reporting it would be asking him twice about one company, which
  // is the nagging that makes the clearance question stop working (9.12).
  assert.deepEqual(
    missingNames({ names: [{ name: "ZoomInfo", kind: "company" }] }, said),
    ["Jordan Crawford"],
  );

  // Either direction counts: a recorded first name covers the full one.
  assert.deepEqual(
    missingNames({ names: [{ name: "ZoomInfo" }, { name: "Jordan" }] }, said),
    [],
  );
});

test("it does not report the things that are not names", () => {
  const noise =
    "Still, the CFO said no. Honestly I thought we were done. " +
    "Result: we lost it on Tuesday. The TAM was wrong and the SMB numbers were worse. " +
    "Start by fixing the DNS. Josh pushed back.";

  const reported = missingNames({ names: [] }, noise);
  for (const notAName of ["Still", "Honestly", "Result", "Start", "Tuesday", "TAM", "SMB", "DNS", "Josh", "CFO"]) {
    assert.ok(
      !reported.includes(notAName),
      `${notAName} was reported as a name Josh needs to decide about`,
    );
  }
});

test("the eight reference writers are never reported, because they are an 8.3 ask", () => {
  /*
   * `moment_names` id 49 is "Matt Barker" on moment 109 — uncleared, and the only name row created
   * in the project in the fifteen days after 13 October. He named him while instructing the writer,
   * which is a request for a shape under clause 8.3, not a person who needs protecting under 9.10.
   *
   * The stop list in extraction.ts is a second copy of writers.mjs, because that is a Node module
   * and extraction.ts is also the Edge Function's — the import could only run one way. So the
   * duplication is pinned here: add a ninth writer there and this fails until the list follows.
   */
  for (const writer of REFERENCE_WRITERS) {
    const said = `Write this one like ${writer.name} would, and ${writer.surname} always opens cold.`;
    assert.deepEqual(
      missingNames({ names: [] }, said),
      [],
      `${writer.name} is reported as a name needing clearance`,
    );
  }
});

test("verifyExtraction reports the dropped names without ever refusing on them", () => {
  // Mid-clause on purpose. Rule 7 needs one sighting of a one-word name that is not a clause
  // opener, and "Thermal pulled out on Friday" gives it none — which is a documented limit of the
  // detector, not a bug to assert around. The limits are listed on missingNames itself.
  const said = "On Friday my client Thermal pulled out, and I told Jordan about it.";
  const verdict = verifyExtraction({ their_actual_words: "", names: [] }, said, said);

  assert.equal(verdict.ok, true, "a dropped name blocked the extraction — it must only report");
  assert.deepEqual(verdict.failures, []);
  assert.ok(verdict.names_not_recorded.includes("Thermal"));
  assert.match(verdict.checked.join(" "), /proper nouns/i, "it does not say the scan ran");
});

test("not scanned and scanned-found-nothing are different answers", () => {
  /*
   * The precedent is the gate's notJudged: a check with no basis is recorded WITH A REASON rather
   * than silently passing, because a green verdict with no reason is indistinguishable from an
   * earned one everywhere it is later read. Called without his words, this says so in
   * `not_checked`; called with them and finding nothing, it says so in `checked`.
   */
  const clean = { their_actual_words: "", names: [] };

  const blind = verifyExtraction(clean, "Thermal pulled out.");
  assert.deepEqual(blind.names_not_recorded, []);
  assert.match(blind.not_checked.join(" "), /nothing looked/i, "a blind run reads as a clean one");

  const looked = verifyExtraction(clean, "nothing here", "nothing here");
  assert.deepEqual(looked.names_not_recorded, []);
  assert.match(looked.checked.join(" "), /proper nouns/i);
  assert.doesNotMatch(looked.not_checked.join(" "), /nothing looked/i);
});

test("candidateNames keeps the title-case headings out and the mid-sentence names in", () => {
  // Rule 7, the one that made the detector usable. A word that is only ever the first word of its
  // line is a heading in his pasted notes; a word seen once mid-clause is a name.
  assert.deepEqual(candidateNames("Cost\nResult\nPaid\nStart"), []);
  assert.ok(candidateNames("so I called Thermal about it").includes("Thermal"));
  // Two words carry their own evidence wherever they sit.
  assert.ok(candidateNames("Hardy Relations never replied").includes("Hardy Relations"));
});

test("write_post says what an empty uncleared list means, either way", () => {
  // "He named nobody" and "nobody was recorded, so there is nothing to clear" used to come back as
  // the same empty array, and the second is the one where 9.10 is enforced by nothing.
  const source = readFileSync(new URL("./tools/onestep.mjs", import.meta.url), "utf8");
  assert.match(source, /names_not_recorded/, "write_post no longer reports the names scan");
  assert.match(source, /names_note/, "write_post drops the reason the scan gives");
});
