/**
 * Inspection tools — the five granted tables that had no tool at all.
 *
 * WHAT WAS MISSING, AND WHY IT MATTERED
 *
 * Migration 0028 grants `content_mcp` select on sixteen tables. The original eleven tools reached
 * eight of them. Five were readable and unreachable: `library_proposals`, `outcomes`,
 * `selection_runs`, `posts` and `visuals`.
 *
 * That is not a cosmetic gap. Those five are, between them, every question about what the system
 * DECIDED rather than what it holds — why this moment and not that one, what Josh changed before he
 * published, what is waiting on his approval. A model that can read the idea bank but not the
 * outcomes can write a post and has no way to find out whether the last one worked.
 *
 * STILL READ-ONLY, AND DELIBERATELY SO
 *
 * Nothing here writes. `content_mcp` has insert on exactly three tables and no UPDATE or DELETE
 * anywhere, and `tools.test.mjs` asserts that no tool matches /update|delete|publish|approve/.
 * These tools do not change that: approving a post, applying a proposal and publishing remain
 * Josh's, enforced by grants rather than by anyone remembering.
 *
 * THE ONE THING THAT IS NOT A TABLE READ
 *
 * `system_status` answers "is it alive and what is it waiting for", which is the question people
 * actually have and which no single table answers. It is the same shape as scripts/smoke.mjs,
 * exposed here so it can be asked rather than run.
 */

import { z } from "zod";

import { recordBriefRead } from "../brief-read.mjs";
// The same measure that classifies a draft against what Josh published (12.2). Reused so "how
// much changed" means one thing everywhere, rather than two similar numbers computed two ways.
import { similarity } from "../../supabase/functions/_shared/diff.ts";
// 9.1 — the exact set of fields a drafter may see. Reused so a rewrite is shown neither more nor
// less than the first attempt was.
import { sourceEntry } from "../../supabase/functions/_shared/entry.ts";
import { isSupplied } from "../../supabase/functions/_shared/views.ts";
// 9.3 — the recorded framework, compared on a key so one structure spelled two ways counts once.
import { frameworkMix } from "../frameworks.mjs";
import { modeName, oneStepMode } from "../mode.mjs";
import { writerShapeBlock } from "./voice.mjs";

/** PostgREST returns rows; a missing table returns a permission error, which is the useful answer. */
const rows = (db, path) => db.request("/" + path);

export const inspectTools = [
  {
    name: "get_section_history",
    config: {
      title: "Every version of one library section",
      description:
        "What a section used to say, when it changed and why. Clause 12.12 requires a library " +
        "change to be reversible, and this is the record that makes that true — it answers 'the " +
        "drafter behaves differently than last week, what changed?', which is otherwise " +
        "unanswerable without SQL. Bodies are omitted unless asked for, because a section runs to " +
        "thousands of characters and six of them would bury the reasons.",
      inputSchema: {
        key: z.string().describe("The section key, e.g. hooks, voice_guide, banned_phrases"),
        include_bodies: z.boolean().optional()
          .describe("Return the full text of each version. Default false."),
      },
    },

    async handler(args, { db }) {
      const versions = await rows(
        db,
        `library_section_versions?select=version,body,reason,created_at&key=eq.${
          encodeURIComponent(args.key)
        }&order=version.asc`,
      );

      if (versions.length === 0) {
        throw new Error(
          `No history for "${args.key}". Either the key is wrong, or the section has never been ` +
          `edited since it was created.`,
        );
      }

      // similarity() from _shared/diff.ts, the same measure that classifies a draft against what
      // Josh actually published. Reused rather than reinvented so "how much changed" means one
      // thing across the system.
      const history = versions.map((v, i) => {
        const previous = i > 0 ? versions[i - 1].body : null;
        const changed = previous === null ? null : 1 - similarity(previous ?? "", v.body ?? "");
        return {
          version: v.version,
          at: v.created_at,
          reason: v.reason ?? "(no reason recorded)",
          words: String(v.body ?? "").trim().split(/\s+/).filter(Boolean).length,
          changed_from_previous: changed === null
            ? "first version"
            : `${Math.round(changed * 100)}% different`,
          ...(args.include_bodies ? { body: v.body } : {}),
        };
      });

      return {
        key: args.key,
        versions: history.length,
        current_version: history[history.length - 1].version,
        history,
        note: args.include_bodies
          ? undefined
          : "Bodies omitted. Pass include_bodies to read what a version actually said.",
      };
    },
  },

  {
    name: "get_rewrite_brief",
    config: {
      title: "What to fix on a draft that was rejected",
      description:
        "One rejected draft, the exact verdicts against it, and the material it was built from. " +
        "9.8 says a second attempt is told what the first failed on, or it writes it again — and " +
        "the most common way a rewrite fails is throwing away a working angle and breaking " +
        "something new. Fix what was named. Keep what passed.",
      inputSchema: {
        draft_id: z.number().int().describe("The draft to rewrite"),
        writer_handle: z.string().optional().describe(
          "If the first attempt was built in one of his reference writers' shapes, pass the same " +
          "handle so the rewrite keeps it. e.g. mattjbarker1",
        ),
      },
    },

    async handler(args, context) {
      const { db } = context;
      const [draft] = await db.select("drafts", {
        select: "id,moment_id,version,attempt,body,hook,framework,gate_passed,gate_reason",
        id: `eq.${args.draft_id}`,
        limit: 1,
      });
      if (!draft) throw new Error(`No draft with id ${args.draft_id}.`);

      const writerShape = args.writer_handle
        ? await writerShapeBlock(db, args.writer_handle)
        : null;

      const runs = await db.select("gate_runs", {
        select: "check_key,passed,reason",
        draft_id: `eq.${args.draft_id}`,
      });

      // Distinct by check, newest wins — the same counting the gate itself uses. Rows are not
      // checks, which is the bug that let a draft report itself fully judged on six of eight.
      const byCheck = new Map();
      for (const r of runs) if (!byCheck.has(r.check_key)) byCheck.set(r.check_key, r);
      const verdicts = [...byCheck.values()];

      const failed = verdicts.filter((v) => !v.passed);
      const passed = verdicts.filter((v) => v.passed);

      if (verdicts.length === 0) {
        throw new Error(
          `Draft ${args.draft_id} has not been judged yet, so there is nothing to rewrite ` +
          `against. Run the gate on it first.`,
        );
      }
      if (failed.length === 0) {
        throw new Error(
          `Draft ${args.draft_id} passed every check that has been run (${verdicts.length} of 8). ` +
          `There is nothing to fix.`,
        );
      }

      const [material] = await db.select("material", {
        select: "*",
        moment_id: `eq.${draft.moment_id}`,
        limit: 1,
      });
      const names = await db.select("moment_names", {
        select: "name,kind,cleared",
        moment_id: `eq.${draft.moment_id}`,
      });
      const uncleared = names
        .filter((n) => n.kind !== "not_a_name" && !n.cleared)
        .map((n) => n.name);

      const brief = {
        draft_id: draft.id,
        moment_id: draft.moment_id,
        framework: draft.framework,
        the_draft: draft.body,

        fix_these: failed.map((f) => ({ check: f.check_key, why: f.reason })),
        // Named explicitly, because the failure mode 9.8 warns about is a rewrite that throws
        // away a working angle and breaks something that was fine.
        keep_these: passed.map((p) => p.check_key),

        material: sourceEntry(material),
        must_not_name: uncleared,
        /*
         * A rewrite that loses the writer target reverts to the default framework, which is the
         * complaint Josh made on 26 October arriving one attempt later rather than being fixed.
         * Refused rather than degraded when the corpus is too thin — see writerShapeBlock.
         */
        ...(writerShape && {
          writer_shape: writerShape.refused
            ? { handle: writerShape.handle, no_target: writerShape.refused }
            : {
              handle: writerShape.handle,
              name: writerShape.name,
              basis: writerShape.basis,
              targets: writerShape.lines,
              not_from_him: writerShape.excludes,
            },
        }),

        how_to_rewrite: [
          "Fix what was named, sentence by sentence. Do not start from scratch if the moment and " +
            "the angle were sound.",
          "Every check that passed is a constraint on the rewrite, not a free hand.",
          "Call measure_draft before create_draft — it costs nothing and catches the mechanical " +
            "faults without a gate run.",
          "A moment gets three attempts (9.8). After that it parks with a plain reason, which is " +
            "a correct outcome rather than a failure.",
        ],

        attempts_so_far: draft.attempt,
        next: "Write the fixed post, then create_draft with the full claim ledger. It becomes a " +
          "new version rather than replacing this one — nothing is overwritten (6.3).",
      };

      // A rewrite reads this instead of the drafting brief, so it satisfies the same requirement.
      // Recorded against the moment, not the draft: the next attempt is a new draft id.
      await recordBriefRead(draft.moment_id, "rewrite", context);

      return brief;
    },
  },

  {
    name: "next_action",
    config: {
      title: "The one thing most worth doing now",
      description:
        "Reads the whole system and returns the single highest-value action, with the reason. " +
        "Answers 'what should I do now' in one call rather than six reads the caller has to " +
        "interpret. It names what is BLOCKING, not what is merely incomplete — most of this " +
        "system is waiting on one thing at a time.",
      inputSchema: {},
    },

    async handler(_args, { db }) {
      const [mined, halfMined, captured, unjudged, waiting, openProposals, oneStep] =
        await Promise.all([
        rows(db, "moments?select=id&status=eq.mined&killed=is.false"),
        rows(db, "moments?select=id,title&status=eq.half_mined&killed=is.false&order=id.asc"),
        rows(db, "moments?select=id,title&status=eq.captured&killed=is.false&order=id.asc"),
        rows(db, "drafts?select=id&order=id.desc&limit=100"),
        // moments!inner(killed) — a post on a killed moment is a verification fixture. Counting
        // them told the operator two posts were waiting on Josh when both were fakes, which is
        // exactly the wrong thing for a tool whose whole job is "what should I do now".
        rows(db, "posts?select=id,moments!inner(killed)&status=eq.draft&moments.killed=is.false"),
        rows(db, "library_proposals?select=id&status=eq.open"),
        oneStepMode(db),
      ]);

      // Ordered by what unblocks the most. A draft waiting on Josh is worth more than a new draft,
      // because nothing publishes without him and an unreviewed pile is not progress.
      const actions = [];

      if (waiting.length > 0) {
        actions.push({
          do: `Review ${waiting.length} post(s) waiting on Josh`,
          // Named `decide_draft` until 13 Oct 2026, which is not a tool, a command or a skill and
          // never has been — so the single most useful action in the system pointed at nothing.
          // These four exist: `node mcp-server/index.mjs --tools` lists them.
          where: "Claude Code — /review, then mark_ready, hold_post, edit_post or " +
            "push_back_on_draft with his words",
          why: "Approval is the only thing that authorises publishing, and it is enforced four " +
            "ways in the database. Nothing downstream of it can happen until he passes.",
        });
      }

      // Everything below that reaches into the idea bank is suppressed in one_step mode. Not
      // cosmetically: this tool is the second call of every session by CLAUDE.md's own
      // instruction, and on the morning of 13 October it would have answered "answer the
      // interview on 1 candidate" while Josh was writing "I want to scrap all that for the time
      // being". The code had stopped asking him questions and the advice had not, which is the
      // same complaint arriving by a route nobody had closed. The counts below still report every
      // idea, so nothing is hidden — only the instruction to go and use them is gone.
      if (mined.length > 0 && !oneStep) {
        actions.push({
          do: `Draft ${mined.length} mined moment(s)`,
          where: "Claude Code — next_work, then the draft-post skill",
          why: "These have material and no draft. This is the only state where writing is possible.",
        });
      }

      if (halfMined.length > 0 && !oneStep) {
        actions.push({
          do: `Answer the interview on ${halfMined.length} candidate(s) — start with "${halfMined[0].title ?? "an unnamed idea"}"`,
          where: "Claude Code — next_interview_question, then answer_interview",
          why: "A candidate cannot be drafted until Josh has been interviewed about it (4.3.3). " +
            "With nothing mined, this is what everything else is waiting on.",
        });
      }

      if (openProposals.length > 0) {
        actions.push({
          do: `Decide ${openProposals.length} library proposal(s)`,
          where: "Claude Code — decide_proposal",
          why: "The system proposes and Josh decides (12.10). Nothing changes until he does.",
        });
      }

      if (captured.length > 0 && !oneStep) {
        actions.push({
          do: `${captured.length} input(s) captured but never mined`,
          where: "Claude Code — next_interview_question, or park_idea if it is not worth it",
          why: "The interview stalled or never finished on these. They expire on their own after " +
            "7 to 14 days, taking whatever they have.",
        });
      }

      // Said once, at the end, and phrased as a fact rather than a thing to do. He needs to know
      // the material is still there — none of it was deleted — without being pointed back at it.
      const held = mined.length + halfMined.length + captured.length;
      if (held > 0 && oneStep) {
        actions.push({
          do: `${held} idea(s) are held in the bank and nothing will be drafted from them`,
          where: "Nothing to do — do not start an interview and do not pull one of these",
          why: "He asked on 13 October for the interview and the idea bank to stop. They are kept " +
            "rather than deleted, and only he turns that back on, with set_writing_mode.",
        });
      }

      return {
        // First, because it decides whether half of what follows applies at all.
        mode: modeName(oneStep),
        next: actions[0] ?? {
          do: "Nothing is blocked",
          where: "—",
          why: "Nothing is waiting on a person and nothing is ready to write. Send something in.",
        },
        // The rest, so a reader can disagree with the ordering rather than be told.
        then: actions.slice(1),
        counts: {
          ready_to_draft: mined.length,
          awaiting_interview: halfMined.length,
          just_arrived: captured.length,
          drafts_waiting_on_josh: waiting.length,
          open_proposals: openProposals.length,
          drafts_total: unjudged.length,
        },
      };
    },
  },

  {
    name: "list_proposals",
    config: {
      title: "Library changes waiting on Josh",
      description:
        "Proposed changes to the reference library, newest first. The system proposes and Josh " +
        "decides — nothing here has been applied unless its status says approved. Use this to see " +
        "what the learning loop and the sentinel refresh have suggested, and what he has already " +
        "rejected, so the same suggestion is not made twice.",
      inputSchema: {
        status: z.enum(["open", "approved", "rejected", "reverted"]).optional()
          .describe("Filter by decision. Omit for all."),
        section_key: z.string().optional().describe("Only proposals against this library section"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        include_body: z.boolean().optional()
          .describe(
            "Return the full proposed text of each section. Default false. Ask for it with one " +
            "proposal in view — it is what Josh is deciding, so read it to him before he decides.",
          ),
      },
    },
    async handler(args, { db }) {
      const q = new URLSearchParams({
        select: "id,section_key,claim,evidence,status,decided_at,decided_reason," +
          "applied_library_version,applied_section_version,created_at,proposed_body",
        order: "id.desc",
        limit: String(args.limit ?? 20),
      });
      if (args.status) q.set("status", "eq." + args.status);
      if (args.section_key) q.set("section_key", "eq." + args.section_key);

      const data = await rows(db, "library_proposals?" + q);

      /*
       * THE BODY IS BEHIND A FLAG, NOT ABSENT. The original reasoning still holds — a body is a
       * whole section, often several thousand characters, and twenty of them would bury the claims
       * that are the point of reading this at all. But omitting it entirely meant Josh had no route
       * to the text at all: on 19 October he asked for the wording of proposal 14 and said "I can
       * see the reasoning but not the text", after it had sat open for five days. A decision he
       * cannot read is not a decision. So `body_chars` always says a body exists and how big it is,
       * and `include_body` returns it.
       */
      /*
       * TWO OPEN PROPOSALS AGAINST ONE SECTION ARE A SILENT OVERWRITE.
       *
       * Each one carries a whole replacement body, so approving both applies the second over the
       * first and Josh never sees that he undid a decision he had just made. Nothing stops this
       * being filed: the sentinel refresh can propose against a section a session also proposed
       * against, and on 14 October two proposals landed on `frameworks` hours apart — the second
       * measured, superseding the first, with nothing in the data saying so.
       *
       * Not resolved by closing one. A proposal is withdrawn by rejecting it, and rejecting is
       * Josh's verb, not ours — clause 12.10 is that the system proposes and he decides, so a
       * system that tidies away its own proposals has quietly taken the decision. The honest fix
       * is to hand him the collision: newest first, so `supersedes` points back at what the newer
       * one would overwrite, and he can reject the older one himself in one step.
       */
      /*
       * Counted from the open proposals themselves, not from the page above. Asked with limit 2 on
       * 19 October this warned about "2 open proposals" against `frameworks` when there were four —
       * a collision understated by the size of the page is exactly the kind of quiet wrongness the
       * warning exists to prevent. Ids and keys only, so this stays one cheap request.
       */
      const openRows = await rows(
        db,
        "library_proposals?select=id,section_key&status=eq.open&order=id.desc&limit=200",
      );
      const openBySection = new Map();
      for (const p of openRows) {
        if (!openBySection.has(p.section_key)) openBySection.set(p.section_key, []);
        openBySection.get(p.section_key).push(p.id);
      }

      // Only for sections the caller is actually looking at. The counts come from every open
      // proposal; the warnings do not, or asking about `hooks` would report a collision on
      // `frameworks` that has nothing to do with the question.
      const onThePage = new Set(data.map((p) => p.section_key));
      const collisions = [...openBySection.entries()]
        .filter(([section, ids]) => ids.length > 1 && onThePage.has(section));

      return {
        proposals: data.map((row) => {
          const { proposed_body: body, ...p } = row;
          const siblings = (openBySection.get(p.section_key) ?? []).filter((id) => id !== p.id);
          return {
            ...p,
            claim: p.claim,
            body_chars: (body ?? "").length,
            ...(args.include_body ? { proposed_body: body } : {}),
            evidence_kind: p.evidence?.kind ?? (p.evidence?.post_ids ? "post_ids" : "other"),
            evidence_summary: p.evidence?.post_ids
              ? p.evidence.post_ids.length + " post(s) cited"
              : p.evidence?.handles
                ? p.evidence.handles.length + " sentinel account(s), " +
                  (p.evidence.changes?.length ?? 0) + " change(s)"
                : undefined,
            // Only on the newer one: it is the one whose approval would discard the other.
            ...(p.status === "open" && siblings.some((id) => id < p.id)
              ? { supersedes: siblings.filter((id) => id < p.id) }
              : {}),
          };
        }),
        ...(collisions.length > 0
          ? {
            competing: collisions.map(([section, ids]) => ({
              section_key: section,
              open_proposals: ids,
              warning:
                `${ids.length} open proposals replace the whole of "${section}". Approving more ` +
                `than one applies the last over the earlier ones. Read him the newest, and if he ` +
                `takes it, reject the others explicitly rather than leaving them open.`,
            })),
          }
          : {}),
        note: "A proposal changes nothing until Josh approves it (12.10). 'reverted' means he " +
          "approved it, the posts got worse, and he rolled it back — treat that as a stronger " +
          "rejection than 'rejected'. Call this again with include_body before he decides: " +
          "body_chars is the size of the text that would replace the section, and he should hear " +
          "the text, not a summary of it.",
      };
    },
  },

  {
    name: "get_outcomes",
    config: {
      title: "What happened to published posts",
      description:
        "The learning signal: how much Josh edited each draft before publishing, his verdict, " +
        "whether it started a conversation, and the engagement numbers where they exist. " +
        "Draft-versus-published is the strongest signal available and engagement is the weakest — " +
        "a post he published almost untouched worked whatever its impressions did.",
      inputSchema: {
        edit_class: z.enum(["light", "rewrite"]).optional()
          .describe("Only posts he barely touched, or only ones he rewrote"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
    },
    async handler(args, { db }) {
      const q = new URLSearchParams({
        select: "post_id,moment_id,edit_ratio,edit_class,edit_stage,verdict,verdict_at," +
          "conversation,conversation_who,impressions,reach,reactions,comments,reshares," +
          "metrics_pulled_at,metrics_error,updated_at",
        order: "updated_at.desc",
        limit: String(args.limit ?? 20),
      });
      if (args.edit_class) q.set("edit_class", "eq." + args.edit_class);

      const data = await rows(db, "outcomes?" + q);
      const measured = data.filter((o) => o.edit_ratio !== null);
      const light = measured.filter((o) => o.edit_class === "light").length;

      // The bodies are not returned. draft_body and published_body are full posts, and the ratio
      // plus the class is what a model needs to learn from; the text is what it would imitate.
      return {
        outcomes: data,
        summary: measured.length === 0
          ? "Nothing measured yet — no post has been approved and published."
          : `${light} of ${measured.length} measured posts needed only light editing. ` +
            `17a asks for five of the last six.`,
        note: "Bodies are omitted on purpose. The edit ratio is the lesson; the text is not.",
      };
    },
  },

  {
    name: "list_calendar",
    config: {
      title: "The calendar",
      description:
        "Posts and where they stand: draft, scheduled, published or held. Nothing reaches " +
        "'scheduled' or 'published' without Josh's approval, which is enforced by four database " +
        "constraints rather than by application code. Use this to see what is queued and what has " +
        "gone out.",
      inputSchema: {
        status: z.enum(["draft", "ready", "scheduled", "published"]).optional()
          .describe("Filter by stage"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25"),
      },
    },
    async handler(args, { db }) {
      const q = new URLSearchParams({
        /*
         * `body` was missing, and that mattered more once Telegram went.
         *
         * This returned every field about a post except the post. It was enough while the weekly
         * pass happened in a chat that quoted the text itself — but Claude Code is the only surface
         * now, and approving a post without having read it back to him is exactly the thing
         * `mark_ready` must never be used for. Selecting it costs nothing: `posts` is already
         * readable by this role.
         */
        select: "id,moment_id,draft_id,visual_id,status,body,scheduled_for,marked_ready_at," +
          "published_at,linkedin_urn,publish_error,announced_at,created_at",
        order: "id.desc",
        limit: String(args.limit ?? 25),
      });
      if (args.status) q.set("status", "eq." + args.status);

      /*
       * The draft list is the one `/review` reads out to him, so it answers "what needs a decision
       * from you" rather than "what rows exist". A draft on a killed or parked idea needs no
       * decision, and showing it asks him to make one.
       *
       * Measured on 9 October: five posts came back as waiting on him and two were real. The others
       * were an acceptance fixture written that morning, a draft whose idea was parked in August,
       * and an August leftover. `next_action` already excludes killed moments for exactly this
       * reason — its own comment records telling the operator two posts were waiting when both were
       * fakes — but the tool he actually sees had no moment filter at all, so the fix had never
       * reached the list it mattered most on.
       *
       * Only for drafts. Scheduled and published stay unfiltered: that is the record of what went
       * out, and nothing in this system hides what happened, including on an idea later killed.
       */
      const reviewing = args.status === "draft";
      if (reviewing) {
        /*
         * THE VERDICTS, ON THE SURFACE HE ACTUALLY READS.
         *
         * Josh, 26 October: "I noticed I give more or less the same editorial notes every time."
         * He was giving notes the gate had already given — on draft 90 it named four of his six in
         * its own words — and then one_step mode pushed the post to his calendar regardless.
         *
         * He was not ignoring them. gate_passed, gate_advisory and gate_reason live on `drafts`,
         * and this tool selects from `posts`, so `/review` has never been able to show him a
         * verdict at all. The only thing it could show was the body, so he read the body and
         * worked the rest out by eye, every week.
         *
         * Embedded the same way `moments!inner` already is, through posts.draft_id.
         */
        q.set(
          "select",
          q.get("select") + ",moments!inner(killed,status)" +
            ",drafts(gate_passed,gate_advisory,gate_reason)",
        );
        q.set("moments.killed", "is.false");
        q.set("moments.status", "neq.parked");
      }

      const data = await rows(db, "posts?" + q);

      /*
       * Say how many were withheld rather than quietly showing fewer. A list that silently shrinks
       * is the same class of fault in the other direction: he would have no way to tell "nothing is
       * waiting" from "something was filtered out of your view".
       */
      let withheld = 0;
      if (reviewing) {
        const all = await rows(db, "posts?select=id&status=eq.draft&limit=100");
        withheld = Math.max(0, all.length - data.length);
        for (const p of data) delete p.moments;

        /*
         * Reshaped into the order it should be read in, and put BEFORE the body.
         *
         * Key order is not decoration here: a model reads an object top-down and reads it out to
         * Josh in roughly that order. The body first is how the verdicts got skipped. So each
         * post becomes { gate, ...the rest }, and gate_reason — stored as one string joined on
         * " | ", each part prefixed with its check key — is split back into the checks that
         * actually failed.
         */
        for (let i = 0; i < data.length; i++) {
          const p = data[i];
          const d = p.drafts ?? null;
          delete p.drafts;
          if (!d) continue;

          const why = {};
          for (const part of (d.gate_reason ?? "").split(" | ").filter(Boolean)) {
            const at = part.indexOf(": ");
            if (at > 0) why[part.slice(0, at)] = part.slice(at + 2);
            else why._ = part;
          }
          const flagged = Object.keys(why);

          data[i] = {
            gate: {
              passed: d.gate_passed,
              advisory: d.gate_advisory === true,
              flagged,
              why,
              read_first: d.gate_passed === null
                ? "Not judged yet. Nothing has looked at this one."
                : d.gate_passed
                ? "Passed every check."
                : `${flagged.length} of 9 check(s) flagged this, and it reached your calendar ` +
                  `anyway because one-step mode makes the gate advisory. Read him these before ` +
                  `the post, in the check's own words — they are usually the note he was about ` +
                  `to give.`,
            },
            ...p,
          };
        }
      }

      const unauthorised = data.filter(
        (p) => (p.status === "published" || p.status === "scheduled") && !p.marked_ready_at,
      );

      return {
        posts: data,
        ...(withheld > 0
          ? {
            withheld_from_review: withheld,
            withheld_means: `${withheld} draft(s) sit on ideas that were killed or parked, so ` +
              `they need no decision and are not listed. list_drafts still shows them.`,
          }
          : {}),
        // If this is ever non-empty something has gone very wrong, and it should be the first
        // thing anyone reading this notices rather than a row they have to spot themselves.
        published_without_josh: unauthorised.length,
        note: unauthorised.length === 0
          ? "Every scheduled or published post carries Josh's approval, as it must (R3)."
          : "STOP: " + unauthorised.length + " post(s) are live without approval. This should be " +
            "impossible — the database refuses it four ways.",
      };
    },
  },

  {
    name: "get_selection",
    config: {
      title: "Why these moments were chosen",
      description:
        "Selection runs, newest first. Every run records what it was aiming for, how many it had " +
        "in hand, how many it wrote and — when it fell short — the reason. Running short is a " +
        "valid outcome with a stated reason, not a failure (7.7). Read this to understand why a " +
        "particular moment came up and another did not.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 15"),
        short_only: z.boolean().optional().describe("Only runs that did not hit target"),
      },
    },
    async handler(args, { db }) {
      const q = new URLSearchParams({
        select: "id,ran_at,target,in_hand,unreviewed,considered,wrote,ran_short,short_reason,skipped",
        order: "ran_at.desc",
        limit: String(args.limit ?? 15),
      });
      if (args.short_only) q.set("ran_short", "is.true");

      const data = await rows(db, "selection_runs?" + q);
      const short = data.filter((r) => r.ran_short).length;
      return {
        runs: data,
        summary: `${data.length} run(s) shown, ${short} of them short of target.`,
        note: "A short run with a reason is the system being honest about an empty bank, not a " +
          "fault. A short run with no reason would be the fault.",
      };
    },
  },

  {
    name: "system_status",
    config: {
      title: "Is it working, and what is it waiting for",
      description:
        "One answer covering the whole system: the library, the idea bank, drafts, the gate, the " +
        "calendar and what is blocked. Every line either reports something healthy or names who " +
        "the next move belongs to. Use this first when asked how things are going — it is faster " +
        "and more honest than assembling the same picture from six tools.",
      inputSchema: {},
    },
    // `url` is destructured for reading_from: it is how a session proves which project answered.
    async handler(_args, { db, url }) {
      // Verification fixtures are excluded everywhere below. A status that counted them would say
      // posts had published on a system with no LinkedIn connection, which is exactly the
      // reassuring nonsense this is meant to replace.
      const one = async (path) => {
        const data = await rows(db, path);
        return Array.isArray(data) ? data.length : 0;
      };

      const sections = await rows(db, "library_sections?select=key,body");
      // Imported rather than reimplemented. This block was a correct hand-copy of isSupplied, which
      // is the more dangerous kind: it agreed with views.ts the day it was written, and nothing
      // would have told anyone the day it stopped. Two other copies had already drifted.
      const empty = sections.filter((s) => !isSupplied(s.body)).map((s) => s.key);

      const [mined, halfMined, captured, needGate, openProposals, published] = await Promise.all([
        one("moments?select=id&status=eq.mined&killed=is.false&limit=200"),
        one("moments?select=id&status=eq.half_mined&killed=is.false&limit=200"),
        one("moments?select=id&status=eq.captured&killed=is.false&limit=200"),
        one("drafts?select=id&framework=not.eq.acceptance-fixture&limit=200"),
        one("library_proposals?select=id&status=eq.open&limit=100"),
        one("posts?select=id&status=eq.published&body=not.like.FIXTURE*&limit=100"),
      ]);

      /*
       * WHAT HE MISSED WHILE HE WAS AWAY.
       *
       * Everything above is derived from state, so it is always current. What is NOT derivable is a
       * fact that was true once and nobody was told: an error burst last Tuesday, a provider seen
       * for the first time, a token expiring in nine days, an idea parked while he was away. Those
       * used to be Telegram messages. With no push channel left they wait in `notices`, and this is
       * where they surface — because clause 13 exists so the system cannot break quietly, and a
       * table nobody reads is quieter than a message nobody sent.
       */
      const unread = await rows(
        db,
        "notices?select=id,kind,severity,body,moment_id,post_id,acted_on,created_at" +
          "&read_at=is.null&order=created_at.desc&limit=15",
      );

      const waiting = [];
      if (halfMined > 0) {
        waiting.push(`${halfMined} candidate(s) need Josh interviewed before they can be drafted`);
      }
      if (openProposals > 0) waiting.push(`${openProposals} library change(s) need his decision`);
      if (empty.length > 0) waiting.push(`${empty.length} library section(s) still empty: ${empty.join(", ")}`);

      const problems = unread.filter((n) => n.severity !== "info").length;

      const oneStep = await oneStepMode(db);

      /*
       * WHICH SYSTEM IS ANSWERING, SAID OUT LOUD.
       *
       * On 14 October Josh ran a session, asked it to fetch Matt Barker, and watched it call Exa —
       * a tool this project has never used and which appears nowhere in this repository. It was
       * running an older content system still sitting on his drive, and it took a screen share and
       * twenty minutes to work that out. Everything he reported that morning has to be read through
       * that, because some of it was never our code.
       *
       * This repository cannot delete the other one and should not try. What it can do is refuse to
       * be confused with it: these three facts come from this database, through this connector, and
       * a session running something else cannot produce them. CLAUDE.md tells a session to stop if
       * it cannot get them rather than improvise from whatever files are on disk.
       */
      const [latestLibrary] = await rows(
        db,
        "library_versions?select=version&order=version.desc&limit=1",
      );

      /*
       * IS HE ACTUALLY VARYING THE STRUCTURE? Clause 9.3 has the drafter record which framework it
       * used so that it "can be reviewed", and for seven weeks nothing reviewed it. Josh asked to
       * keep 9.3 on 19 October in those words — "it's how we'll see whether posts are actually
       * varying" — and the column had the answer waiting: 19 of the 20 drafts since 1 October used
       * one structure. That is the thing he is worried about, stated in his own data, and it needed
       * no new measurement, only a read.
       *
       * The window is the last twenty, not all time: the question is what the system is doing now,
       * and an all-time count would bury a month of monotony under the variety of August.
       */
      const recentDrafts = await rows(
        db,
        "drafts?select=framework,created_at&framework=not.eq.acceptance-fixture" +
          "&order=created_at.desc&limit=20",
      );
      const mix = frameworkMix(
        recentDrafts,
        sections.find((s) => s.key === "frameworks")?.body,
      );
      const strangers = mix.filter((m) => m.in_library === false);

      /*
       * HAS ANYTHING STOPPED HAPPENING? The generalisation of the line above, and the read this
       * repository has needed for weeks.
       *
       * Every recent fault here has been one of two things: code nothing ever ran, or a value
       * nothing ever read. Neither announces itself. A ninth gate check was added on 14 October and
       * the tool that records verdicts was left accepting eight, so from that day no draft could
       * close and mark_ready refused every one of them — for five days, with the tool reporting
       * "0 check(s) still to record". Nothing failed. Nothing logged. The numbers below are what
       * would have said so on the first afternoon.
       *
       * Only what content_mcp may select (0028). moment_embeddings and system_events are not in
       * that grant, so the retelling cache cannot be read from here — the archive count is the half
       * that can, and it is the half that matters most, because an empty archive means the
       * published-comparison side of 7.2 has nothing to compare against.
       */
      /*
       * JUDGED AND NEVER CLOSED is the symptom, and it is the one worth counting.
       *
       * The first version of this read "when was a verdict last recorded", which would have been
       * reassuring and wrong: eight verdicts WERE recorded on 19 October, on two drafts, and both
       * stayed unapproved because the ninth could not be. There is no decision timestamp on drafts
       * to ask instead. So the question is asked the way it actually bites — a draft carrying
       * verdicts whose gate_passed is still null is a draft someone judged and nobody can approve,
       * whatever stopped it.
       */
      const openDrafts = await rows(db, "drafts?select=id&gate_passed=is.null");
      const verdictRows = await rows(
        db,
        "gate_runs?select=draft_id,created_at&order=created_at.desc&limit=2000",
      );
      const judged = new Set(verdictRows.map((r) => r.draft_id));
      const judgedNeverClosed = openDrafts.filter((d) => judged.has(d.id)).length;

      const [lastSelection] = await rows(
        db,
        "selection_runs?select=id,ran_at&order=ran_at.desc&limit=1",
      );
      const archived = await rows(db, "published_archive?select=id&limit=1");

      const stalled = [];
      if (judgedNeverClosed > 0) {
        stalled.push(
          `${judgedNeverClosed} draft(s) carry gate verdicts and were never closed, so ` +
            `gate_passed is still unset on them and mark_ready refuses an unjudged draft in ` +
            `every mode. Either the run stopped part way, or something is stopping it from ` +
            `finishing — read one of them back with get_gate_brief, which lists what is left.`,
        );
      }
      if (archived.length === 0) {
        stalled.push(
          "The retelling index is empty, so the published half of 7.2 has nothing to compare " +
            "against. New material is checked against other moments only.",
        );
      }

      return {
        reading_from: {
          // No regex: the project ref is the first label of the host. A hand-written escape in this
          // file has been silently eaten twice today, and a wrong one here would be cosmetic enough
          // to ship.
          project: (() => {
            try {
              return new URL(String(url)).hostname.split(".")[0];
            } catch {
              return null;
            }
          })(),
          library_version: latestLibrary?.version ?? null,
          sections: sections.length,
          means: "These come from Josh's database through this connector. If a session cannot " +
            "produce them, it is not connected to the content system — do not carry on from files " +
            "on disk, say so and stop.",
        },
        /*
         * First, because the instructions tell every session to read it before writing anything,
         * and a fact the model has to go looking for is a fact it will sometimes not have.
         */
        mode: modeName(oneStep),
        mode_means: oneStep
          ? "He gives you material and you write it: start_post, write_post, create_draft. Nothing " +
            "asks him questions and nothing is pulled from the idea bank. The eight checks run and " +
            "you read him what they caught, but they do not hold the post back — he decides."
          : "The interviewed path: capture_thought, a few short questions, next_work for what is " +
            "waiting, and a draft waits for the checks to pass.",
        library: `${sections.length - empty.length} of ${sections.length} sections filled in`,
        idea_bank: { ready_to_draft: mined, awaiting_interview: halfMined, just_arrived: captured },
        drafts_written: needGate,
        // 9.3, read back. One line he can act on: if one structure holds most of the window, the
        // variety he asked for is not happening, whatever the library says is available.
        framework_mix: mix.length ? mix : undefined,
        framework_note: mix.length === 0
          ? undefined
          : (() => {
            const top = mix[0];
            const total = mix.reduce((n, m) => n + m.used, 0);
            const lead = top.used >= Math.ceil(total * 0.7)
              ? `${top.used} of the last ${total} drafts used "${top.framework}" — the structure ` +
                `is barely varying.`
              : `${mix.length} structure(s) across the last ${total} drafts.`;
            return strangers.length
              ? `${lead} ${strangers.length} value(s) are not named in his frameworks section: ` +
                `${strangers.map((s) => `"${s.framework}"`).join(", ")}.`
              : lead;
          })(),
        // The same idea as framework_note, asked of the pipeline rather than of the structures:
        // what has quietly stopped? A dormant path announces itself here instead of waiting to be
        // stumbled over.
        last_verdict_recorded: verdictRows[0]?.created_at ?? null,
        drafts_judged_but_never_closed: judgedNeverClosed,
        last_selection_run: lastSelection?.ran_at ?? null,
        retelling_index_rows: archived.length === 0 ? 0 : "1 or more",
        stalled_note: stalled.length ? stalled : undefined,
        published,
        waiting_on_josh: waiting.length ? waiting : ["nothing"],
        // Read these to him. They are the half of the system that cannot ask for attention.
        unread_notices: unread,
        notices_note: unread.length === 0
          ? "Nothing has happened that he has not been told."
          : `${unread.length} thing(s) he has not been told${problems ? `, ${problems} needing a look` : ""}. ` +
            `Read them out, then call mark_notices_read so they are not repeated.`,
        note: published === 0
          ? "Nothing has published. Until LinkedIn is connected, nothing can."
          : undefined,
      };
    },
  },
];
