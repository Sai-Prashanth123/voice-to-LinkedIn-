/**
 * The briefs — task 2.1 and 2.2, the half that lives on this side of the wire.
 *
 * WHY THE SKILLS DO NOT CONTAIN THE INSTRUCTIONS
 *
 * The obvious way to write a drafting skill is to put the writing standard in the skill file. That
 * would immediately create a second standard: prompts.ts already holds one, worker-draft uses it,
 * and the two would drift apart the first time either was improved. The drift would be invisible —
 * both would produce plausible posts, and nothing would say which was following the current rules.
 *
 * So the skill files are thin and these tools are where the standard comes from. DRAFTER_SYSTEM,
 * DRAFT_USER, GATE_SYSTEM, GATE_CHECKS and GATE_USER are imported from prompts.ts verbatim and
 * assembled with the live library, exactly as the edge function assembles them. Claude Code and
 * worker-draft are handed the same words.
 *
 * prompts.ts imports nothing, so Node reads it directly. That is not an accident of its design —
 * acceptance.ts is import-free for the same reason.
 */

import { z } from "zod";
import {
  DRAFTER_SYSTEM,
  DRAFT_USER,
  GATE_CHECKS,
  GATE_SYSTEM,
  GATE_USER,
  LEARN_SYSTEM,
  PROMPT_VERSION,
} from "../../supabase/functions/_shared/prompts.ts";
import { sourceEntry } from "../../supabase/functions/_shared/entry.ts";
import {
  CHECK_NEEDS_SECTION,
  notJudged,
  renderLibrary,
  unjudgeableChecks,
  VIEWS,
} from "../../supabase/functions/_shared/views.ts";

/**
 * The library, exactly as loadLibrary() assembles it for the same view.
 *
 * This function first had its own idea of what the library was: every non-placeholder section,
 * concatenated. That was wrong twice over. It handed the gate `reference_posts` and
 * `voice_transcript`, which the gate must never see — a judge that has read another writer's posts
 * measures against their voice rather than Josh's — and it dropped empty sections entirely, where
 * the real assembly names them as explicit gaps so a missing voice guide is visible in the prompt
 * rather than quietly changing how the model behaves.
 *
 * Both mistakes produced output that looked completely reasonable. Neither would have been found by
 * reading this file.
 */
async function libraryText(db, view) {
  const rows = await db.select("library_sections", {
    select: "key,title,body,sort_order",
    order: "sort_order.asc",
  });

  const { sections, prompt } = renderLibrary(rows, view);

  const [version] = await db.select("library_versions", {
    select: "version",
    order: "version.desc",
    limit: 1,
  });

  return {
    text: prompt,
    // Per-section bodies as well as the assembled prompt: the gate brief has to know WHICH section
    // is empty, not merely that the prompt mentions a gap.
    sections,
    version: version?.version ?? null,
    view,
    included: VIEWS[view],
    // Named rather than counted: which section is missing decides what a reader should make of
    // the draft, and "3 missing" does not.
    awaiting_josh: Object.entries(sections).filter(([, body]) => !body).map(([key]) => key),
  };
}

export const briefTools = [
  {
    name: "get_drafting_brief",
    config: {
      title: "Get the drafting brief for a moment",
      description:
        "The complete instructions for writing one post: the writing standard, the reference " +
        "library, the moment's material, the audience, and which names may and may not be used. " +
        "This is the same brief the system's own drafter is given — follow it exactly rather than " +
        "writing from your own sense of what a good post is. Returns everything needed; you should " +
        "not need any other source. When done, call create_draft.",
      inputSchema: {
        moment_id: z.number().int().describe("Which moment to draft, from list_moments"),
      },
    },
    async handler(args, { db }) {
      const id = args.moment_id;

      const [moment] = await db.select("moments", {
        select: "id,ref,killed,status,audience,pillar",
        id: `eq.${id}`,
        limit: 1,
      });
      if (!moment) throw new Error(`No moment with id ${id}.`);
      if (moment.killed) {
        throw new Error(
          `Moment ${id} has been killed. Josh has already declined it and it must not be drafted.`,
        );
      }

      const [material] = await db.select("material", { select: "*", moment_id: `eq.${id}`, limit: 1 });
      const entry = sourceEntry(material);
      if (Object.keys(entry).length === 0) {
        throw new Error(
          `Moment ${id} has no material yet. The interview has not produced anything to write ` +
          `from, and a draft built on nothing is exactly what the claim ledger exists to stop.`,
        );
      }

      const names = await db.select("moment_names", {
        select: "name,kind,cleared",
        moment_id: `eq.${id}`,
      });
      const real = names.filter((n) => n.kind !== "not_a_name");
      const cleared = real.filter((n) => n.cleared).map((n) => n.name);
      const uncleared = real.filter((n) => !n.cleared).map((n) => n.name);

      // 9.8 — a second attempt is told what the first one failed on, or it writes it again.
      const [previous] = await db.select("drafts", {
        select: "id,body,gate_passed,gate_reason,version",
        moment_id: `eq.${id}`,
        order: "version.desc",
        limit: 1,
      });
      let previousAttempt;
      if (previous && previous.gate_passed === false) {
        const runs = await db.select("gate_runs", {
          select: "check_key,passed,reason",
          draft_id: `eq.${previous.id}`,
        });
        const failures = runs.filter((r) => !r.passed).map((r) => `${r.check_key}: ${r.reason}`);
        previousAttempt = {
          body: previous.body,
          failures: failures.length > 0 ? failures : [previous.gate_reason ?? "rejected"],
        };
      }

      const library = await libraryText(db, "drafting");

      return {
        moment_id: id,
        moment_ref: moment.ref,
        prompt_version: PROMPT_VERSION,
        library_version: library.version,
        library_sections_awaiting_josh: library.awaiting_josh,
        system: DRAFTER_SYSTEM(library.text),
        user: DRAFT_USER({
          entry,
          audience: moment.audience ?? null,
          pillar: moment.pillar ?? null,
          clearedNames: cleared,
          unclearedNames: uncleared,
          previousAttempt,
        }),
        // Repeated outside the prose because it is the one instruction that must not be missed,
        // and because create_draft refuses on it anyway — better to know before writing.
        must_not_name: uncleared,
        next: "Write the post, then call create_draft with every claim and its verbatim source span.",
      };
    },
  },

  {
    name: "get_gate_brief",
    config: {
      title: "Get the eight checks for a draft",
      description:
        "The eight independent checks a draft must clear, each with its own rubric, the post, and " +
        "the source material it was built from. Judge each one separately and record it with " +
        "record_gate_verdict — one call per check. Do not average across them and do not stop at " +
        "the first failure: Josh should see everything wrong with a draft at once. Checks already " +
        "judged are left out, so an interrupted run resumes rather than starting over.",
      inputSchema: {
        draft_id: z.number().int().describe("Which draft to check, from list_drafts"),
      },
    },
    async handler(args, { db }) {
      const [draft] = await db.select("drafts", {
        select: "id,moment_id,body,version,library_version",
        id: `eq.${args.draft_id}`,
        limit: 1,
      });
      if (!draft) throw new Error(`No draft with id ${args.draft_id}.`);

      const [moment] = await db.select("moments", {
        select: "id,ref,audience",
        id: `eq.${draft.moment_id}`,
        limit: 1,
      });
      const [material] = await db.select("material", {
        select: "*",
        moment_id: `eq.${draft.moment_id}`,
        limit: 1,
      });
      const entry = sourceEntry(material);

      const cleared = (await db.select("moment_names", {
        select: "name,kind,cleared",
        moment_id: `eq.${draft.moment_id}`,
      })).filter((n) => n.cleared && n.kind !== "not_a_name").map((n) => n.name);

      // Resuming rather than restarting. handlers/gate.ts does exactly this, for the same reason:
      // a run interrupted at check six should cost two more calls, not eight.
      const done = new Set(
        (await db.select("gate_runs", { select: "check_key", draft_id: `eq.${args.draft_id}` }))
          .map((r) => r.check_key),
      );
      const library = await libraryText(db, "gating");

      // The same rule the edge function applies, from the same function.
      //
      // Without it the two gate paths disagreed on live data: handlers/gate.ts recorded voice_guide
      // as NOT JUDGED while a run through this skill recorded it as a plain pass, on the same empty
      // section. Two answers to one question, and the more flattering one was the one Claude Code
      // produced. A check with nothing to judge against is not offered here at all.
      const unjudgeable = new Set(
        unjudgeableChecks(GATE_CHECKS, library.sections).map((c) => c.key),
      );
      const remaining = GATE_CHECKS.filter((c) => !done.has(c.key) && !unjudgeable.has(c.key));

      // A read tool that writes needs a reason, and this is it: withholding the check without
      // recording it leaves the draft permanently at seven of eight, and cc-agent/work.mjs looks
      // for drafts with fewer than eight verdicts. It would re-gate the same draft for ever,
      // burning quota on a check nobody can answer.
      //
      // So the row is written here, identically to handlers/gate.ts — same reason text, same
      // model marker — rather than asking the model to reproduce a specific string faithfully.
      const toRecord = [...unjudgeable].filter((key) => !done.has(key));
      if (toRecord.length > 0) {
        await db.insert("gate_runs", toRecord.map((key) => ({
          draft_id: draft.id,
          check_key: key,
          passed: true,
          reason: notJudged(CHECK_NEEDS_SECTION[key]),
          model: "none",
        })), { returning: false });
      }

      // 9b — each check is its own call with its own rubric. Run together in one prompt a model
      // averages across them and lets marginal work through, which is the exact failure acceptance
      // test 8 is built to catch.
      return {
        draft_id: draft.id,
        moment_ref: moment?.ref,
        prompt_version: PROMPT_VERSION,
        already_judged: [...done],
        not_judgeable: [...unjudgeable],
        checks_remaining: remaining.length,
        system: GATE_SYSTEM(library.text),
        checks: remaining.map((check) => ({
          check_key: check.key,
          user: GATE_USER({
            check,
            body: draft.body,
            entry: Object.keys(entry).length > 0 ? entry : undefined,
            audience: moment?.audience ?? null,
            clearedNames: cleared,
          }),
        })),
        note: unjudgeable.size > 0
          ? [...unjudgeable].join(", ") + " is not in this list: the library section it judges " +
            "against is empty, so it is recorded as NOT JUDGED rather than passed on no evidence."
          : undefined,
        next: remaining.length > 0
          ? "Judge each check on its own and call record_gate_verdict once per check. When unsure, fail it."
          : "Every check already has a verdict. Nothing to do.",
      };
    },
  },

  {
    name: "get_learning_brief",
    config: {
      title: "Get the brief for proposing a library change",
      description:
        "The standard the learning loop judges by (clause 12c), assembled from prompts.ts so this " +
        "and worker-learn propose against the same words. Returns the system prompt, what Josh " +
        "has already decided so a settled question is not raised again, and where to gather the " +
        "evidence. It does NOT gather it for you: the read tools already return it, and a second " +
        "assembly here would be a second answer to what the evidence is.",
      inputSchema: {},
    },

    async handler(_args, { db }) {
      // Everything he has already answered. Re-proposing a settled question is the fastest way to
      // teach him to stop reading these, which the prompt says in as many words — so it is handed
      // over rather than left to be looked up.
      const decided = (await db.select("library_proposals", {
        select: "id,section_key,claim,status,decided_at,decided_reason",
        status: "neq.open",
        order: "id.desc",
        limit: "40",
      })).map((p) => ({
        section_key: p.section_key,
        claim: p.claim,
        status: p.status,
        decided_reason: p.decided_reason,
      }));

      // The same exclusion scripts/smoke.mjs uses, and for the same reason it had to add it: there
      // is no fixture column on posts, so the two acceptance rows read as published to anything
      // that does not filter the body prefix. Written the same way here deliberately — a third
      // answer to "is this a fixture" is how two readers of one fact start disagreeing.
      const published = (await db.select("posts", {
        select: "id",
        status: "eq.published",
        body: "not.like.FIXTURE*",
        limit: "1",
      })).length;

      return {
        system: LEARN_SYSTEM,

        gather_evidence_with: [
          "get_outcomes — what published posts did, and the draft-versus-published diff",
          "list_drafts — every draft with its eight verdicts, so rejection patterns are visible",
          "get_library — the sections as they currently stand",
          "list_proposals — the full history, including rejected and reverted",
        ],

        already_decided: decided,

        // Stated rather than left to be inferred from an empty result. A loop that cannot tell
        // "no pattern" from "no data" reports the first and means the second.
        evidence_available: published > 0
          ? "There are published posts, so outcomes and edit diffs carry real signal."
          : "NOTHING HAS PUBLISHED. There are no outcomes, no engagement numbers and no " +
            "draft-versus-published diffs. Gate rejections across drafts are the only evidence " +
            "that exists, and they are thin ground for a library change. Proposing nothing is " +
            "very likely the correct answer today — the prompt says a quiet month is honest.",

        // 12.10 and the core-rules ban are enforced in the database and in propose_library_change's
        // own schema, not by this sentence. It is here because a model that knows the boundary
        // writes better proposals than one that discovers it as a rejection.
        constraints: [
          "Every proposal cites specific posts or drafts by id. No claim without evidence.",
          "If the evidence is thin, propose nothing.",
          "You may never propose a change to core_rules. That is refused four ways regardless.",
          "You propose, Josh decides. Nothing here is applied by proposing it.",
        ],

        next: "Call propose_library_change once per proposal, with its evidence. Or stop, and say " +
          "plainly that the evidence did not support one.",
      };
    },
  },
];
