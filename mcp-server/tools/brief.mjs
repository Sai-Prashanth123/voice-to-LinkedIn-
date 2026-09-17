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
  EXTRACT_SYSTEM,
  GATE_SYSTEM,
  GATE_USER,
  LEARN_SYSTEM,
  PROMPT_VERSION,
  TRIAGE_CLAUDE_CODE_SYSTEM,
  TRIAGE_SLACK_SYSTEM,
  TRIAGE_TRANSCRIPT_SYSTEM,
} from "../../supabase/functions/_shared/prompts.ts";
import { sourceEntry } from "../../supabase/functions/_shared/entry.ts";
import { parsePillars } from "../../supabase/functions/_shared/library.ts";
import { renderTranscript } from "../../supabase/functions/_shared/session.ts";
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

/** One setting, read the way getSetting reads it, with the same fallback. */
async function setting(db, key, fallback) {
  const [row] = await db.select("settings", { select: "value", key: `eq.${key}`, limit: 1 });
  return row?.value ?? fallback;
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
        select: "id,title,killed,status,audience,pillar",
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

      /*
       * THE WAITING JOB FIRST, BECAUSE IT HOLDS WHAT THE DRAFTS TABLE DOES NOT.
       *
       * A rejected draft's reasons can be rebuilt from gate_runs, which is what the fallback below
       * does. Josh pushing back from Telegram cannot: his note is not a gate verdict and lives only
       * on the draft job it created. Now that drafts are written in Claude, that job waits here for
       * a writer — and a brief that ignored it would hand over a rewrite with the one instruction
       * that mattered missing.
       */
      const [waiting] = await db.select("jobs", {
        select: "payload",
        type: "eq.draft",
        status: "eq.pending",
        "payload->>moment_id": `eq.${id}`,
        order: "id.asc",
        limit: 1,
      });
      const jobFailures = Array.isArray(waiting?.payload?.failures) ? waiting.payload.failures : [];
      if (waiting?.payload?.previous_body || jobFailures.length > 0) {
        previousAttempt = {
          body: waiting.payload.previous_body ?? previous?.body ?? "",
          failures: jobFailures.length > 0 ? jobFailures : [previous?.gate_reason ?? "rejected"],
        };
      }

      if (!previousAttempt && previous && previous.gate_passed === false) {
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
        name: moment.title ?? null,
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
        select: "id,title,audience",
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
        name: moment?.title ?? null,
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
    name: "get_triage_brief",
    config: {
      title: "Get the standard for surfacing content candidates",
      description:
        "The bar something must clear to be worth putting in front of Josh (4.3, 4.4), assembled " +
        "from prompts.ts so this and worker-triage judge by the same words. Most material produces " +
        "NOTHING and that is the intended result — a version surfacing ten candidates a day is " +
        "worse than none, because he stops reading them. Returns the standard and how much room " +
        "is left under today's cap. Finish by calling submit_candidates.",
      inputSchema: {
        source: z.enum(["claude_code", "call_transcript", "slack"])
          .describe("Where the material came from. Each has its own standard."),
      },
    },

    async handler(args, { db }) {
      const source = args.source;

      const SYSTEMS = {
        claude_code: TRIAGE_CLAUDE_CODE_SYSTEM,
        call_transcript: TRIAGE_TRANSCRIPT_SYSTEM,
        slack: TRIAGE_SLACK_SYSTEM,
      };

      // The cap counts what Josh has been SHOWN in the last day, across every source — the same
      // subtraction _shared/triage.ts makes. Reported rather than merely enforced, so a run that
      // has no room stops before spending anything rather than after.
      const cap = await setting(db, "cc_candidates_per_day", 3);
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const surfacedToday = (await db.select("moments", {
        select: "id",
        status: "eq.half_mined",
        source: "in.(claude_code,call_transcript,slack)",
        captured_at: `gte.${since}`,
      })).length;

      const room = Math.max(0, cap - surfacedToday);

      return {
        source,
        system: SYSTEMS[source],
        prompt_version: PROMPT_VERSION,

        daily_cap: cap,
        surfaced_today: surfacedToday,
        room_left_today: room,

        the_bar: [
          "Strength 4 or 5 out of 5. Anything below is discarded before Josh sees it, whatever you say about it.",
          "Empty is the expected result most of the time. Do not pad the list.",
          "Summarise what HAPPENED, neutrally. Never what Josh concluded — that is his to say.",
          "Record every person and company mentioned. None of them is cleared by recording it.",
          "One opening question per candidate. It is stored, not sent: he sees it when he next opens a session.",
        ],

        // Stated because a run that cannot tell "nothing was interesting" from "there was no room"
        // reports the first and means the second.
        note: room === 0
          ? `The daily cap of ${cap} is already reached, so nothing submitted now would surface. ` +
            `Stop here rather than triaging material that would be discarded.`
          : `Room for ${room} more today.`,

        next: "Call submit_candidates with the source_ref and your candidates. The cap and the " +
          "strength bar are applied server-side, so submitting more than the room does no harm — " +
          "the strongest are kept and the rest are simply not surfaced.",
      };
    },
  },

  {
    name: "get_extraction_brief",
    config: {
      title: "Get the brief for turning an interview into idea bank material",
      description:
        "Everything needed to record what one interview produced (clause 5.9): the extraction " +
        "standard from prompts.ts, what Josh sent, the whole conversation, and the pillars he has " +
        "actually defined. This is the same standard worker-dispatch uses. The entry you produce " +
        "becomes the source of truth every later draft is checked against, claim by claim — so " +
        "leaving a field empty is always allowed and is correct whenever he did not say it. " +
        "Finish by calling submit_extraction.",
      inputSchema: {
        moment_id: z.number().int().describe("Which moment's interview to record"),
      },
    },

    async handler(args, { db }) {
      const id = args.moment_id;

      const [moment] = await db.select("moments", {
        select: "id,title,status,killed",
        id: `eq.${id}`,
        limit: 1,
      });
      if (!moment) throw new Error(`No moment with id ${id}.`);
      if (moment.killed) throw new Error(`Moment ${id} has been killed and must not be recorded.`);
      if (moment.status === "mined") {
        throw new Error(
          `Moment ${id} is already mined. Re-extracting would overwrite material a draft may ` +
          `already have been checked against, so it is refused rather than done quietly.`,
        );
      }

      const turns = await db.select("interview_turns", {
        select: "role,body,turn_no",
        moment_id: `eq.${id}`,
        order: "turn_no.asc",
      });

      const raw = await db.select("raw_inputs", {
        select: "kind,text_body,transcript,created_at",
        moment_id: `eq.${id}`,
        order: "created_at.asc",
      });

      const rows = await db.select("library_sections", {
        select: "key,title,body,sort_order",
        order: "sort_order.asc",
      });
      const pillarsBody = (rows.find((r) => r.key === "pillars") ?? {}).body ?? "";

      const { prompt: library } = renderLibrary(rows, VIEWS.interview);

      // renderTranscript imported rather than reproduced: the model must read the conversation in
      // the same shape the validator rebuilds it from, and two renderings of one transcript is
      // exactly the kind of near-identical pair that drifts without anybody noticing.
      const transcript = renderTranscript({ turns });
      // TRANSCRIPT FIRST, THEN text_body.
      //
      // This read text_body alone. For a voice note — the input the whole system is built around —
      // the words live in `transcript` and text_body is null, so `what_josh_sent` came back empty
      // and the extractor was handed a conversation with no opening. It had the answers and not the
      // thing being answered about.
      const seed = raw
        .map((r) => String(r.transcript ?? r.text_body ?? "").trim())
        .filter(Boolean)
        .join("\n\n");

      return {
        moment_id: id,
        name: moment.title ?? null,
        prompt_version: PROMPT_VERSION,

        // Only pillars Josh has actually defined. With none, extraction records none rather than
        // inventing a category that would then be counted in the pillar balance (7.1).
        system: `${EXTRACT_SYSTEM(parsePillars(pillarsBody))}\n\n${library}`,

        what_josh_sent: seed || "(nothing recorded)",
        the_conversation: transcript,

        will_be_checked_mechanically: [
          "their_actual_words must appear verbatim in what Josh said — a paraphrase must be left empty",
          "every number must appear in what he said, unrounded",
          "every name recorded must be one he actually mentioned",
        ],
        will_not_be_checked: [
          "the prose fields, which are meant to summarise and cannot be matched verbatim — " +
          "which is exactly why inventing in them is the thing to avoid on your own account",
        ],

        next: "Call submit_extraction with the full extraction. It is validated before anything " +
          "is written, and refused with reasons rather than stored badly.",
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
