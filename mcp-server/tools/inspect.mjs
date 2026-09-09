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
// The same measure that classifies a draft against what Josh published (12.2). Reused so "how
// much changed" means one thing everywhere, rather than two similar numbers computed two ways.
import { similarity } from "../../supabase/functions/_shared/diff.ts";
// 9.1 — the exact set of fields a drafter may see. Reused so a rewrite is shown neither more nor
// less than the first attempt was.
import { sourceEntry } from "../../supabase/functions/_shared/entry.ts";

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
      },
    },

    async handler(args, { db }) {
      const [draft] = await db.select("drafts", {
        select: "id,moment_id,version,attempt,body,hook,framework,gate_passed,gate_reason",
        id: `eq.${args.draft_id}`,
        limit: 1,
      });
      if (!draft) throw new Error(`No draft with id ${args.draft_id}.`);

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

      return {
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
      const [mined, halfMined, captured, unjudged, waiting, openProposals] = await Promise.all([
        rows(db, "moments?select=id&status=eq.mined&killed=is.false"),
        rows(db, "moments?select=id,ref&status=eq.half_mined&killed=is.false&order=id.asc"),
        rows(db, "moments?select=id,ref&status=eq.captured&killed=is.false&order=id.asc"),
        rows(db, "drafts?select=id&order=id.desc&limit=100"),
        rows(db, "posts?select=id&status=eq.draft"),
        rows(db, "library_proposals?select=id&status=eq.open"),
      ]);

      // Ordered by what unblocks the most. A draft waiting on Josh is worth more than a new draft,
      // because nothing publishes without him and an unreviewed pile is not progress.
      const actions = [];

      if (waiting.length > 0) {
        actions.push({
          do: `Review ${waiting.length} post(s) waiting on Josh`,
          where: "the desk's This week, or /review in Telegram",
          why: "Approval is the only thing that authorises publishing, and it is enforced four " +
            "ways in the database. Nothing downstream of it can happen until he passes.",
        });
      }

      if (mined.length > 0) {
        actions.push({
          do: `Draft ${mined.length} mined moment(s)`,
          where: "the draft-post prompt, or worker-select on its four-hourly tick",
          why: "These have material and no draft. This is the only state where writing is possible.",
        });
      }

      if (halfMined.length > 0) {
        actions.push({
          do: `Answer the interview on ${halfMined.length} candidate(s) — start with ${halfMined[0].ref}`,
          where: "Telegram",
          why: "A candidate cannot be drafted until Josh has been interviewed about it (4.3.3). " +
            "With nothing mined, this is what everything else is waiting on.",
        });
      }

      if (openProposals.length > 0) {
        actions.push({
          do: `Decide ${openProposals.length} library proposal(s)`,
          where: "the desk's Proposals",
          why: "The system proposes and Josh decides (12.10). Nothing changes until he does.",
        });
      }

      if (captured.length > 0) {
        actions.push({
          do: `${captured.length} input(s) captured but never mined`,
          where: "Telegram",
          why: "The interview stalled or never finished on these. They expire on their own after " +
            "7 to 14 days, taking whatever they have.",
        });
      }

      return {
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
      },
    },
    async handler(args, { db }) {
      const q = new URLSearchParams({
        select: "id,section_key,claim,evidence,status,decided_at,decided_reason," +
          "applied_library_version,applied_section_version,created_at",
        order: "id.desc",
        limit: String(args.limit ?? 20),
      });
      if (args.status) q.set("status", "eq." + args.status);
      if (args.section_key) q.set("section_key", "eq." + args.section_key);

      const data = await rows(db, "library_proposals?" + q);

      // The proposed body is deliberately not returned in the list. It is a whole section — often
      // several thousand characters — and returning twenty of them would bury the claims that are
      // the point of reading this at all.
      return {
        proposals: data.map((p) => ({
          ...p,
          claim: p.claim,
          evidence_kind: p.evidence?.kind ?? (p.evidence?.post_ids ? "post_ids" : "other"),
          evidence_summary: p.evidence?.post_ids
            ? p.evidence.post_ids.length + " post(s) cited"
            : p.evidence?.handles
              ? p.evidence.handles.length + " sentinel account(s), " +
                (p.evidence.changes?.length ?? 0) + " change(s)"
              : undefined,
        })),
        note: "A proposal changes nothing until Josh approves it (12.10). 'reverted' means he " +
          "approved it, the posts got worse, and he rolled it back — treat that as a stronger " +
          "rejection than 'rejected'.",
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
        select: "id,moment_id,draft_id,visual_id,status,scheduled_for,marked_ready_at," +
          "published_at,linkedin_urn,publish_error,announced_at,created_at",
        order: "id.desc",
        limit: String(args.limit ?? 25),
      });
      if (args.status) q.set("status", "eq." + args.status);

      const data = await rows(db, "posts?" + q);
      const unauthorised = data.filter(
        (p) => (p.status === "published" || p.status === "scheduled") && !p.marked_ready_at,
      );

      return {
        posts: data,
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
    async handler(_args, { db }) {
      // Verification fixtures are excluded everywhere below. A status that counted them would say
      // posts had published on a system with no LinkedIn connection, which is exactly the
      // reassuring nonsense this is meant to replace.
      const one = async (path) => {
        const data = await rows(db, path);
        return Array.isArray(data) ? data.length : 0;
      };

      const sections = await rows(db, "library_sections?select=key,body");
      const empty = sections.filter((s) => {
        const t = (s.body ?? "").trim();
        if (!t) return true;
        const placeheld = /DELIBERATELY EMPTY/.test(t) || /^#[^\n]*\n+\s*FOR JOSH\b/.test(t);
        if (!placeheld) return false;
        const [, ...rest] = t.split(/(?:^|\n)---(?:\n|$)/);
        return !rest.some((c) => c.trim());
      }).map((s) => s.key);

      const [mined, halfMined, captured, needGate, openProposals, published] = await Promise.all([
        one("moments?select=id&status=eq.mined&killed=is.false&limit=200"),
        one("moments?select=id&status=eq.half_mined&killed=is.false&limit=200"),
        one("moments?select=id&status=eq.captured&killed=is.false&limit=200"),
        one("drafts?select=id&framework=not.eq.acceptance-fixture&limit=200"),
        one("library_proposals?select=id&status=eq.open&limit=100"),
        one("posts?select=id&status=eq.published&body=not.like.FIXTURE*&limit=100"),
      ]);

      const waiting = [];
      if (halfMined > 0) {
        waiting.push(`${halfMined} candidate(s) need Josh interviewed before they can be drafted`);
      }
      if (openProposals > 0) waiting.push(`${openProposals} library change(s) need his decision`);
      if (empty.length > 0) waiting.push(`${empty.length} library section(s) still empty: ${empty.join(", ")}`);

      return {
        library: `${sections.length - empty.length} of ${sections.length} sections filled in`,
        idea_bank: { ready_to_draft: mined, awaiting_interview: halfMined, just_arrived: captured },
        drafts_written: needGate,
        published,
        waiting_on_josh: waiting.length ? waiting : ["nothing"],
        note: published === 0
          ? "Nothing has published. Until LinkedIn is connected, nothing can."
          : undefined,
      };
    },
  },
];
