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

import { recordBriefRead } from "../brief-read.mjs";
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
import { writingSources } from "../sources.mjs";
import { shapedWriterRows } from "../shape-rows.mjs";
// Module-level, not via the tool registry: voice.mjs does not import this file, so there is no
// cycle, and tools/index.mjs warns that a registry lookup needs the tool imported last.
import { corpusShapeBlock, writerShapeBlock } from "./voice.mjs";
import { writerAskFrom } from "../writers.mjs";
import { WRITTEN_UP } from "../../supabase/functions/_shared/extraction.ts";
import { parsePillars } from "../../supabase/functions/_shared/library.ts";
import { renderTranscript } from "../../supabase/functions/_shared/session.ts";
import { measureShape, shapeAgainst, writerShapeTargets } from "../../supabase/functions/_shared/shape.ts";
import {
  CHECK_NEEDS_SECTION,
  gateInputsFor,
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
        "not need any other source. When done, call create_draft.\n\n" +
        "Pass writer_handle when Josh asks for a post in one of his reference writers' shapes — " +
        "\"write this one like Matt Barker would\" — and the brief carries that writer's measured " +
        "structure as the target for this post, plus what must not be taken from them. Their words " +
        "are never included and are refused mechanically at filing.",
      inputSchema: {
        moment_id: z.number().int().describe("Which moment to draft, from list_moments"),
        writer_handle: z.string().optional().describe(
          "One of: mattjbarker1 (Matt Barker), demandjen1 (Jen Allen-Knuth), outboundphd " +
          "(Eric Nowoslawski), juliacarter98 (Julia Carter), ryanscarlin (Ryan Carlin), " +
          "curtishowland (Curtis Howland), amangrowth (Aman Ghataura), adam-treboutat " +
          "(Adam Treboutat). Only when Josh named a writer — never chosen for him.",
        ),
      },
    },
    async handler(args, context) {
      const { db } = context;
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
      // His own words and his receipts count as sources now, so a moment with no mined material can
      // still be draftable — a topic he typed with a receipts file behind it is not nothing.
      const extra = await writingSources(db, id);
      const entry = sourceEntry(material, extra);
      /*
       * The writer's measured shape, when Josh named one. Loaded here so the targets reach the
       * prompt rather than sitting behind analyse_reference_writer, which nothing told the drafter
       * to call — the gap Josh described on 26 October.
       */
      // Resolved after the pushback note is read, because the note may itself be the instruction.
      // Declared here so the ordering of the two reads below cannot silently change the answer.
      let writerShape = null;

      /*
       * WHAT HE HAS ALREADY SAID ABOUT DRAFTS — the one thing this brief never carried.
       *
       * The standing assumption was that the system has nothing positive to aim at, because it has
       * never been shown a post he approved. That was wrong. It holds five pushback notes in his own
       * words, three verdicts, and three before-and-after pairs — and the drafter had seen none of
       * them. `push_back_on_draft` carries his note into the next draft of THAT moment through the
       * job payload and nowhere else, so a preference he stated on Monday was invisible to Tuesday's
       * post about something different.
       *
       * Read through an RPC rather than a grant: the notes live in system_events, where this role
       * holds no privilege at all and should not. See migration 0054.
       *
       * Never allowed to fail a draft: if the read errors, the brief is built without it. A new
       * input is not worth making the write path fragile for.
       */
      const taste = await (async () => {
        try {
          return await db.rpc("joshs_notes", { p_limit: 10 });
        } catch {
          return [];
        }
      })();
      if (Object.keys(entry).length === 0) {
        throw new Error(
          `Moment ${id} has nothing to write from: no material, nothing he typed against it, and ` +
          `no receipts on file. A draft built on nothing is what the claim ledger exists to stop.`,
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

      /*
       * EVERYTHING HE HAS SAID ABOUT THIS POST — not just the note on the job still waiting.
       *
       * The read above is filtered to `status = pending`, and `create_draft` closes the job it
       * answers. So his note survived exactly one draft and then disappeared from this brief for
       * good. On moment 113, on 27 October, that played out in ninety minutes:
       *
       *   03:11  job 353  "the opening hook could be something like I analysed 21,278 US sales
       *                    teams… I don't think we need to mention the 20 company test"
       *   03:16  job 354  "no one cares about the data set, role count looked wrong… this
       *                    audience doesn't care about that"
       *   03:31  job 355  "Heads of sales development is very specific. What about Managers of
       *                    SDRs… want to invite input from the readers at the end"
       *
       * All three are `status = done`. By draft 93 the brief carried none of them, so the writer
       * was working from gate verdicts alone — and hook_opens_loop and banned_phrases failed on all
       * four drafts in a row. Four identical failures is not a writer who will not learn. It is a
       * brief that forgot the instruction between attempts.
       *
       * His note does not stop being his note when the job closes. Newest first, deduplicated,
       * and kept SEPARATE from the gate's reasons: one is an instruction and the other is a
       * verdict, and filing the first under "it failed on" mislabels what he said.
       */
      const noteJobs = await db.select("jobs", {
        select: "payload",
        type: "eq.draft",
        "payload->>moment_id": `eq.${id}`,
        order: "id.desc",
        limit: 12,
      });
      const hisNotes = [...new Set(
        noteJobs
          .flatMap((j) => (Array.isArray(j?.payload?.failures) ? j.payload.failures : []))
          .map((f) => String(f).match(/Josh's note on the previous version:\s*([\s\S]+)/)?.[1]?.trim())
          .filter(Boolean),
      )];
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

      /*
       * WHICH SHAPE TO BUILD IN — HIS PARAMETER, OR FAILING THAT, HIS OWN WORDS.
       *
       * `writer_handle` has been available since 26 October and is optional, so a session that does
       * not think to pass it gets the default framework. That is the complaint he opened with on
       * 26 October, one layer further in — and he then made the ask twice more, in pushback notes
       * nothing read:
       *
       *   26 Oct — "go look at the Sentinel accounts to see how others who have done lists like
       *             this would write it"
       *   27 Oct — "what makes a good opening hook from the Sentinel accounts"
       *
       * Both arrived in `previousAttempt.failures`, which this brief already carries verbatim to
       * the writer — so the instruction WAS on the page and only a human could act on it. Reading
       * it here is the difference between telling the drafter what he said and doing what he said.
       *
       * An explicit parameter always wins: it is this session's instruction, where the note may be
       * three drafts old.
       */
      const ask = args.writer_handle
        ? { handle: args.writer_handle }
        : writerAskFrom(hisNotes.join("\n"));

      if (ask?.handle) {
        writerShape = await writerShapeBlock(db, ask.handle);
        if (writerShape) writerShape.kind = "writer";
      } else if (ask?.corpus) {
        // He pointed at the group. A band across eight, never one of them — see corpusShapeBlock.
        writerShape = await corpusShapeBlock(db);
      }

      const library = await libraryText(db, "drafting");

      const brief = {
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
          hisNotes,
          writerShape: writerShape?.lines ? writerShape : null,
          /*
           * Pre-rendered here, so prompts.ts stays a pure string module with no database shape in
           * it. Two kinds: what he said, and what he changed — and the second is the stronger of
           * the two, because a verdict says what was wrong while a diff says what right looked
           * like.
           */
          tasteNotes: (taste ?? []).map((n) => {
            const when = (n.said_at ?? "").slice(0, 10);
            const said = `${when} — "${String(n.note ?? "").trim()}"`;
            if (!n.before_text || !n.after_text || n.before_text === n.after_text) return said;
            const first = (s) => String(s).split("\n")[0].trim();
            if (first(n.before_text) === first(n.after_text)) return said;
            return `${said}\n      He was given:   "${first(n.before_text)}"\n` +
              `      He changed it to: "${first(n.after_text)}"`;
          }),
        }),
        /*
         * Said outside the prose as well, for the same reason must_not_name is: if the writer was
         * named and no target could be given, the caller has to know that rather than assume the
         * shape is in there somewhere. writerShapeBlock refuses rather than degrading when a
         * writer's measurable corpus is too thin to call anything his habit.
         */
        ...(writerShape && {
          writer_shape: writerShape.refused
            ? { handle: writerShape.handle ?? null, no_target: writerShape.refused }
            : {
              handle: writerShape.handle ?? null,
              name: writerShape.name,
              basis: writerShape.basis,
              targets: writerShape.lines,
              not_from_him: writerShape.excludes,
              /*
               * Where the target came from, because a shape nobody asked for in THIS call needs to
               * announce itself. "his_note" means it was read out of his own pushback — tell him
               * that rather than letting a target appear from nowhere.
               */
              asked_by: args.writer_handle ? "this_call" : "his_note",
            },
        }),
        // Repeated outside the prose because it is the one instruction that must not be missed,
        // and because create_draft refuses on it anyway — better to know before writing.
        must_not_name: uncleared,
        next: "Write the post, then call create_draft with every claim and its verbatim source span.",
      };

      // Recorded so cc-submit can refuse a draft written against no standard. See brief-read.mjs
      // for why this is a server-side record and not another hook.
      await recordBriefRead(id, "drafting", context);

      return brief;
    },
  },

  {
    name: "get_gate_brief",
    config: {
      title: "Get the gate's checks for a draft",
      description:
        "The nine independent checks a draft must clear, each with its own rubric, the post, and " +
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
      // The same twelve fields the drafter and the ledger get. A judge asked whether a figure
      // traces to the source has to be shown the source — see the note in handlers/gate.ts.
      const gateExtra = await writingSources(db, draft.moment_id);
      const entry = sourceEntry(material, gateExtra);

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

      /*
       * The shape numbers, for the one check that judges shape.
       *
       * Only posts that kept their line breaks are counted — most of what the console returns is
       * one unbroken line, and averaging those in would report the scraper as a habit of the
       * writer. If nothing measurable is stored the targets come back empty and the check says so
       * rather than inventing a range.
       */
      const writerRows = await shapedWriterRows(db);
      const targets = writerShapeTargets(writerRows);
      const shapeLines = shapeAgainst(measureShape(draft.body), targets);

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
        // Each check is shown the post, and nothing else unless its rubric cannot be answered
        // without it. This filter is the whole point of gateInputsFor: it was applied on the
        // server path and NOT here, and this is the path that actually runs, so five of the eight
        // checks were reading his private notes. That is his "it fails drafts for things that
        // aren't in them", and it had survived one fix because that fix was prompt wording.
        checks: remaining.map((check) => {
          const sees = gateInputsFor(check.key);
          return {
            check_key: check.key,
            // Said out loud so a reader of the brief can see what the judge was given, rather than
            // having to trust that something upstream filtered correctly.
            sees: Object.entries(sees).filter(([, v]) => v).map(([k]) => k),
            user: GATE_USER({
              check,
              body: draft.body,
              entry: sees.source && Object.keys(entry).length > 0 ? entry : undefined,
              audience: sees.audience ? (moment?.audience ?? null) : undefined,
              clearedNames: sees.clearedNames ? cleared : undefined,
              shape: sees.shape ? shapeLines : undefined,
            }),
          };
        }),
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
        redo: z.boolean().optional().describe(
          "Only when Josh asked for an idea already written up to be written up again. The " +
            "entry it replaces is kept on the record.",
        ),
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
      // The same set cc-submit refuses on, and for the same reason: every status past the write-up,
      // not just `mined`. Two copies of one rule is how the library's isSupplied drifted, so if one
      // of these changes the other has to.
      if (WRITTEN_UP.includes(moment.status) && !args.redo) {
        throw new Error(
          `Moment ${id} has already been written up (${moment.status}). Re-extracting would ` +
          `overwrite material a draft may already have been checked against, so it is refused ` +
          `rather than done quietly. If Josh asked for it to be written up again, call this with ` +
          `redo: true.`,
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

      /*
       * The VIEW NAME, not VIEWS.interview.
       *
       * renderLibrary does `new Set(VIEWS[view])` itself, so passing the array gave it
       * VIEWS[["core_rules","pillars",…]] — an undefined lookup, an empty wanted-set, and every
       * section silently filtered out. No error, no gap notice, just an empty library string
       * interpolated into the extractor's system prompt.
       *
       * This is the same mistake voice.mjs:92 made and fixed in September, with a comment
       * describing it exactly; the fix was never carried across to here. It is the one call site of
       * nine that passed an array — every other one passes a string literal.
       *
       * It matters more here than anywhere: extraction is what turns Josh's answers into the
       * material every later claim is verified against. He answered 21 interview questions on
       * 13 October and the extractor read none of his pillars, audience or prompt set while doing
       * it.
       */
      const { prompt: library } = renderLibrary(rows, "interview");

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
        will_be_reported_back: [
          "any number he gave that no field carries — a dropped number can never reach a post",
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
