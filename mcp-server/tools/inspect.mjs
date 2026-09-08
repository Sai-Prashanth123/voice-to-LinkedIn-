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

/** PostgREST returns rows; a missing table returns a permission error, which is the useful answer. */
const rows = (db, path) => db.request("/" + path);

export const inspectTools = [
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
