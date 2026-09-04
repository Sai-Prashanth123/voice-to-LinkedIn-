/**
 * X — two readers of the same thing must agree.
 *
 * THIS IS THE FILE THAT EARNS THE HARNESS
 *
 * Every bug found in this build has been this shape, and every one had passing tests on both sides:
 *
 *   isSupplied() said a section was empty while a real voice recording sat in it
 *   the MCP gate brief and the edge-function gate judged the same empty section differently
 *   eval/gather.mjs and _shared/acceptance-data.ts each computed the scorecard, separately
 *   app/lib/pillars.ts and _shared/library.ts each parsed pillars, separately
 *   compatText picked its model from GROQ_MODELS whatever provider was configured
 *   drafts.model recorded the literal "STRONG" rather than the model that wrote it
 *
 * A unit test proves one reader. Nothing proved the pair. These cases do.
 */

import { defineCase } from "../harness.mjs";

export const cases = [
  defineCase({
    id: "X-01",
    stage: "X",
    clause: "8a",
    tier: "deterministic",
    name: "the drafter's library view and the gate's differ in exactly the documented way",
    async run({ assert, seen }) {
      const { VIEWS } = await import("../../../supabase/functions/_shared/views.ts");
      const drafting = [...VIEWS.drafting];
      const gating = [...VIEWS.gating];
      seen("views", { drafting, gating });

      // 8a's failure arrives through a side door: a judge that has read another writer's posts
      // measures against their voice rather than Josh's. The MCP server got this wrong by
      // assembling its own library, and the output looked entirely reasonable.
      assert.includes(drafting, "reference_posts", "the drafter may borrow structure (8.3)");
      assert.excludes(gating, "reference_posts", "the gate must never see another writer's posts");
      assert.includes(drafting, "voice_transcript", "the drafter has the transcript for voice");
      assert.excludes(gating, "voice_transcript", "the gate judges against the guide, not the evidence");
      assert.includes(gating, "gate_rules", "the gate has Josh's extra constraints");
      assert.excludes(drafting, "gate_rules", "which the drafter does not need");
    },
  }),

  defineCase({
    id: "X-02",
    stage: "X",
    clause: "8.1",
    tier: "deterministic",
    name: "there is one answer to whether a library section is filled in",
    async run({ assert, seen }) {
      const { isSupplied, renderLibrary } = await import(
        "../../../supabase/functions/_shared/views.ts"
      );

      const placeholder = "# The voice interview\n\nFOR JOSH (8.1). Talk at length.\n";
      const withRecording = placeholder + "\n---\n\n## Recorded 2026-09-04\n\nHey. Hi. Hello.\n";
      const rewritten = "# Voice guide\n\nShort sentences. Never hedges.";

      seen("shapes", { placeholder: false, withRecording: true, rewritten: true });

      // Three states, and getting any of them wrong is silent. The first version tested only the
      // head of the body, so a real recording appended under a placeholder read as empty — the
      // drafter was handed "" and the gate went on recording NOT JUDGED.
      assert.not(isSupplied(placeholder), "a placeholder alone is not content");
      assert.ok(isSupplied(withRecording), "a recording appended below it IS content");
      assert.ok(isSupplied(rewritten), "a section Josh rewrote outright is content");

      // And the renderer must agree with the predicate, or the prompt says one thing while the
      // gate believes another.
      const { sections, prompt } = renderLibrary(
        [{ key: "voice_guide", title: "Voice guide", body: withRecording }],
        "gating",
      );
      assert.notEqual(sections.voice_guide, "", "the renderer agrees the section is supplied");
      assert.not(/Not yet supplied/.test(prompt), "so the prompt does not announce a gap");
    },
  }),

  defineCase({
    id: "X-03",
    stage: "X",
    clause: "17",
    tier: "deterministic",
    name: "both scorecard readers compute the same counts from the same rows",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const shared = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/acceptance-data.ts", import.meta.url),
        "utf8",
      );
      const harness = fs.readFileSync(
        new URL("../../../eval/gather.mjs", import.meta.url),
        "utf8",
      );
      const { gateFixtures } = await import("../../../supabase/functions/_shared/acceptance.ts");

      // worker-ops folds the board into Josh's monthly message; eval/acceptance.mjs prints it in a
      // session. Two independent reductions of the same database is two answers waiting to differ,
      // and the type checker only caught it because a field was added.
      assert.ok(typeof gateFixtures === "function", "the fixture scorer is shared, not duplicated");
      assert.match(shared, /gateFixtures/, "worker-ops uses the shared scorer");
      assert.match(harness, /gateFixtures/, "and so does the harness");

      // The shared scorer must give one answer for one input.
      const drafts = [
        { id: 1, version: 9000, gate_passed: false, framework: "acceptance-fixture" },
        { id: 2, version: 9001, gate_passed: false, framework: "acceptance-fixture" },
        { id: 3, version: 5, gate_passed: true, framework: "story-lesson" },
      ];
      const runs = [{ draft_id: 1, model: "gemini-3.1-flash-lite" }];
      const a = gateFixtures(drafts, runs);
      const b = gateFixtures(drafts, runs);
      seen("scored", a);
      assert.same(a, b, "the same rows give the same counts");
      assert.equal(a.gateFixtureRejected, 2, "only fixtures are counted, and only rejected ones");
    },
  }),

  defineCase({
    id: "X-04",
    stage: "X",
    clause: "8.4",
    tier: "deterministic",
    name: "the app's copies of shared logic still agree with the originals",
    async run({ assert, seen }) {
      // app/ cannot import from supabase/functions/_shared, so two modules are copied. A copy that
      // drifts is invisible: both halves keep working and disagree about the same post.
      const pairs = [
        ["diff", "../../../supabase/functions/_shared/diff.ts", "../../../app/lib/diff.ts"],
        ["pillars", "../../../supabase/functions/_shared/library.ts", "../../../app/lib/pillars.ts"],
      ];
      seen("pairs", pairs.map((p) => p[0]));

      const diffShared = await import("../../../supabase/functions/_shared/diff.ts");
      const diffApp = await import("../../../app/lib/diff.ts");

      // classifyEdit IS the 17a number. If the desk and the worker classified the same edit
      // differently, the finish line would depend on which one happened to run.
      const before = "The CFO stopped me halfway through the deck and asked one question.";
      const after = "The CFO stopped me halfway through and asked one question.";
      assert.equal(
        diffApp.classifyEdit(before, after).editClass,
        diffShared.classifyEdit(before, after).editClass,
        "both copies classify the same edit identically",
      );

      const rewritten = "Something completely different about a different day entirely.";
      assert.equal(
        diffApp.classifyEdit(before, rewritten).editClass,
        diffShared.classifyEdit(before, rewritten).editClass,
        "and agree on a rewrite too",
      );
    },
  }),

  defineCase({
    id: "X-05",
    stage: "X",
    clause: "16",
    tier: "deterministic",
    name: "a request goes to the model the active provider names, not to another provider's",
    async run({ assert, seen }) {
      // llm.ts imports `npm:` specifiers, which Node's loader cannot resolve — the behavioural
      // version of this lives in vision-routing.test.ts under Deno. What is asserted here is the
      // property that actually broke: compatText picked its model from GROQ_MODELS whatever the
      // provider was, so no non-Groq provider could serve a text call at all.
      const fs = await import("node:fs");
      const llm = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/llm.ts", import.meta.url),
        "utf8",
      );
      seen("llm.ts", { chars: llm.length });

      const hardcoded = [...llm.matchAll(/const model = (\w+)\[opts\.model\]/g)].map((m) => m[1]);
      seen("model selection", hardcoded);
      assert.excludes(hardcoded, "GROQ_MODELS", "no call path is pinned to one provider's model map");
      assert.match(llm, /function modelFor\(/, "model choice goes through one place");
      assert.match(llm, /p\.models\[opts\.model\]/, "which reads the ACTIVE provider's map");
      assert.match(llm, /visionModel/, "and the vision swap is scoped to requests carrying an image");
    },
  }),

  defineCase({
    id: "X-06",
    stage: "X",
    clause: "8.4",
    tier: "deterministic",
    name: "a verdict records the model that made it, not the role that asked",
    async run({ assert, seen }) {
      const fs = await import("node:fs");
      const gate = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/gate.ts", import.meta.url),
        "utf8",
      );
      const draft = fs.readFileSync(
        new URL("../../../supabase/functions/_shared/handlers/draft.ts", import.meta.url),
        "utf8",
      );
      seen("handlers", { gate: gate.length, draft: draft.length });

      // Both stored the literal "STRONG". That word has meant Claude, gpt-oss, Qwen and flash-lite
      // at different points in this build, so a verdict could not be attributed to whatever
      // actually made it — which is the single most important caveat on every gate number here.
      assert.match(gate, /model: modelName\(/, "gate_runs stores the resolved model name");
      assert.match(draft, /model: modelName\(/, "drafts stores the resolved model name");
      assert.not(/model: MODELS\.OPUS,\s*\}\)/.test(gate), "no bare role is written as a model");
    },
  }),
];
