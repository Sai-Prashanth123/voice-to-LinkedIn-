/**
 * The model tier — the journeys that need a real model in the middle of them.
 *
 * These are the cases `--with-model` has always promised and never had. Until now the flag
 * filtered on a tier no case declared, so running with it produced byte-identical output to
 * running without it: 108 cases either way, and a green report that had never sent a single word
 * to a model.
 *
 * Each case sends the REAL prompt from prompts.ts to the CONFIGURED provider and judges the reply
 * against the rule the prompt states. The sample material is fixed here rather than read from the
 * bank, so a change in the report is a change in the model or the prompt and never in the data.
 *
 * ON RATE LIMITS
 *
 * Every gemini 3.x flash model allows about twenty requests a day on the free tier. A refusal for
 * load is BLOCKED, not failed — the case proved nothing and says so. A refusal for content is a
 * failure, because that is the model declining to do the job.
 */

import { defineCase, block } from "../harness.mjs";
import { askModel, isRateLimit, modelConfig } from "../model.mjs";
import { renderLibrary, VIEWS } from "../../../supabase/functions/_shared/views.ts";
import {
  DRAFT_USER,
  DRAFTER_SYSTEM,
  GATE_CHECKS,
  GATE_SYSTEM,
  GATE_USER,
  INTERVIEWER_SYSTEM,
  NEXT_QUESTION_USER,
} from "../../../supabase/functions/_shared/prompts.ts";
import { verifyDraft } from "../../../supabase/functions/_shared/claims.ts";

/** The library, assembled for one view exactly as the workers assemble it. */
async function libraryFor(live, view) {
  const rows = await live.rest(
    "library_sections?select=key,title,body,sort_order&order=sort_order.asc",
  );
  return renderLibrary(rows, view).prompt;
}

/**
 * Fixed sample material. Deliberately thin in the same way real material is thin, and carrying an
 * uncleared name so the drafter has something it must write around.
 */
const ENTRY = {
  the_moment: "The head of sales stopped me halfway through the deck and asked what happens when the champion leaves.",
  who_was_there: "Only the head of sales and I were on the call.",
  their_actual_words: "if Riva goes, we start from zero",
  how_he_felt: "I felt caught out, and a bit defensive.",
  what_changed: "I have not changed anything yet.",
};
const NAMES = [{ name: "Riva", cleared: false }];

/** A post any competent stranger could have written. The gate exists to refuse exactly this. */
const GENERIC_POST = `Most teams do not have a people problem. They have a clarity problem.

I have seen it again and again. Everyone is busy, everyone is working hard, and nobody can say what
success looks like this quarter.

The best leaders I know do one thing differently: they make the goal impossible to misread.

Clarity is a kindness.`;

function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

/** Run a model call, turning a load refusal into a BLOCK rather than a failure. */
async function ask(ctx, opts) {
  const cfg = modelConfig();
  if (!cfg.ready) block(cfg.why);
  ctx.note("provider", cfg.provider);
  try {
    const out = await askModel(opts);
    ctx.note("model", out.model);
    return out.value;
  } catch (err) {
    if (isRateLimit(err?.message)) {
      block(`the provider refused for load, not for content: ${String(err.message).slice(0, 160)}`);
    }
    throw err;
  }
}

export const cases = [
  defineCase({
    id: "M-01",
    stage: 2,
    clause: "5",
    tier: "model",
    name: "the interviewer asks one plain question, not a compound abstract one",
    async run(ctx) {
      const library = await libraryFor(ctx.live, VIEWS.interview);

      const value = await ask(ctx, {
        system: INTERVIEWER_SYSTEM(library),
        user: NEXT_QUESTION_USER({
          transcript:
            "Josh: A prospect asked me something on a call yesterday that I could not answer.",
          questionsAsked: 1,
          maxQuestions: 8,
          depthReached: "none",
          pushbackUsed: false,
        }),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["action", "question", "depth", "is_pushback"],
          properties: {
            action: { type: "string", enum: ["ask", "finish", "park"] },
            question: { type: "string" },
            depth: { type: "string", enum: ["none", "scene", "time_anchored", "earned_perspective"] },
            is_pushback: { type: "boolean" },
          },
        },
        maxTokens: 2000,
      });

      const q = String(value.question ?? "");
      ctx.note("question", q);

      // One thin answer with a real prospect in it is a scene to dig into, not a park.
      ctx.assert.equal(value.action, "ask", "it asks rather than giving up on one thin answer");

      // The rules the prompt states, checked against what it actually produced. Every one of these
      // was broken by a real question in a real session: "That sounds like a moment of friction
      // between how you want to build and the limitations of the tool—what does that trade-off
      // tell you?" — an interpretation, then an abstraction, joined by an em dash.
      ctx.assert.equal((q.match(/\?/g) ?? []).length, 1, "exactly one question mark");
      ctx.assert.ok(!/[—–]/.test(q), "no em dash, which he never writes");
      ctx.assert.ok(wordCount(q) <= 45, `under 45 words (was ${wordCount(q)})`);
      ctx.assert.ok(
        !/\bwhat (does|do) (that|this|it) (tell|say|mean)\b/i.test(q),
        "asks what happened rather than what it meant",
      );
    },
  }),

  defineCase({
    id: "M-02",
    stage: 5,
    clause: "9.4",
    tier: "model",
    name: "the drafter returns a ledger the deterministic verifier can actually read",
    async run(ctx) {
      const library = await libraryFor(ctx.live, VIEWS.drafting);

      const value = await ask(ctx, {
        system: DRAFTER_SYSTEM(library),
        user: DRAFT_USER({
          entry: ENTRY,
          audience: "a VP of Sales carrying a renewal",
          pillar: "Career and business",
          clearedNames: [],
          unclearedNames: ["Riva"],
          nearMiss: null,
        }),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["hook", "body", "framework", "claims"],
          properties: {
            hook: { type: "string" },
            body: { type: "string" },
            framework: { type: "string" },
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["claim", "kind", "source_field", "source_span"],
                properties: {
                  claim: { type: "string" },
                  kind: { type: "string", enum: ["quote", "number", "name", "event", "detail"] },
                  source_field: { type: "string" },
                  source_span: { type: "string" },
                },
              },
            },
          },
        },
      });

      const claims = Array.isArray(value.claims) ? value.claims : [];
      ctx.note("framework", value.framework);
      ctx.note("claims", claims.length);

      // THE CONTRACT, which is this case's subject: a ledger in the shape the verifier reads.
      // Exactly the thing that was broken on the MCP path — a ledger stored in keys verifyDraft
      // could not read one field of, which nothing noticed because nothing compared them.
      ctx.assert.ok(claims.length > 0, "it emitted a ledger rather than an empty array");
      ctx.assert.ok(
        claims.every((c) => Object.keys(ENTRY).includes(c.source_field)),
        "every claim names a field that exists in the entry it was given",
      );
      ctx.assert.ok(
        claims.every((c) => String(c.source_span ?? "").trim().length >= 4),
        "every claim carries a span long enough to evidence anything",
      );

      // 9.10 is a hard stop and does not depend on how good the model is.
      ctx.assert.ok(
        !new RegExp("\\bRiva\\b", "i").test(String(value.body ?? "")),
        "it wrote around the uncleared name rather than using it",
      );

      // THE MEASUREMENT, deliberately not an assertion.
      //
      // Whether this provider fabricates is a fact about the provider, and clause 17's test 6 is
      // where it is judged. Asserting it here would paint the whole harness red for as long as the
      // free tier is in use, and a permanently red case stops being read. X-07 reports drift the
      // same way, for the same reason.
      const verification = verifyDraft(value.body, claims, ENTRY, NAMES);
      ctx.note("claims_verified", verification.ok);
      ctx.note("fabrications", verification.failures.slice(0, 3));
    },
  }),

  defineCase({
    id: "M-03",
    stage: 6,
    clause: "9.6",
    tier: "model",
    name: "the gate refuses a post any competent stranger could have written",
    async run(ctx) {
      const library = await libraryFor(ctx.live, VIEWS.gate);
      const check = GATE_CHECKS.find((c) => c.key === "anyone_else");

      const value = await ask(ctx, {
        system: GATE_SYSTEM(library),
        user: GATE_USER({
          check,
          body: GENERIC_POST,
          entry: ENTRY,
          audience: "a VP of Sales carrying a renewal",
          clearedNames: [],
        }),
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["passed", "reason"],
          properties: {
            passed: { type: "boolean" },
            reason: { type: "string" },
          },
        },
        maxTokens: 2000,
      });

      ctx.note("reason", String(value.reason ?? "").slice(0, 300));

      // The one check clause 1 rests on. A gate that waves this through is a formality, and the
      // post above is the exact failure it describes: fluent, confident, and about nobody.
      ctx.assert.equal(value.passed, false, "it refuses a post built entirely of generalities");
      ctx.assert.ok(
        String(value.reason ?? "").trim().length > 0,
        "a refusal comes with a reason Josh could act on",
      );
    },
  }),
];
