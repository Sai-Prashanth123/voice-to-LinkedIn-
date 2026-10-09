/**
 * Read tools — task 1.2.
 *
 * WHAT A MODEL ACTUALLY NEEDS
 *
 * Not a table browser. A model arriving here has one question — "what should I write, and what am I
 * allowed to say?" — so the tools are shaped around that rather than around the schema. get_moment
 * returns a moment with its material, its interview, its names and its previous attempts in one
 * call, because every one of those is needed before a word is written and four round trips to
 * assemble them is four chances to skip one.
 *
 * KILLED MOMENTS ARE EXCLUDED BY DEFAULT
 *
 * 6.3 says nothing is deleted, only killed and labelled. That makes `killed` the single most
 * important filter in this file: a model that drafts from a killed moment is writing something Josh
 * has already said no to. It can still be asked for explicitly.
 */

import { z } from "zod";
import { gatherAll } from "../../eval/gather.mjs";
import { score, overall, summarise } from "../../supabase/functions/_shared/acceptance.ts";
import { sourceEntry } from "../../supabase/functions/_shared/entry.ts";

const MOMENT_FIELDS =
  "id,title,source,status,depth_reached,pillar,audience,strength,pinned,killed," +
  "time_sensitive,decays_at,not_before,parked_reason,notes,captured_at,last_score";

/** A killed row is `true`; everything else is live, including a null. */
const LIVE_ONLY = { killed: "is.false" };

export const readTools = [
  {
    name: "list_moments",
    config: {
      title: "List moments",
      description:
        "List moments from the idea bank, newest first. Killed moments are excluded unless you ask " +
        "for them. Use status='mined' to find moments ready to draft, or status='half_mined' to " +
        "find ones the interview is still working on. Returns a summary per moment; call " +
        "get_moment for the full picture before drafting.",
      inputSchema: {
        status: z.enum([
          "captured", "half_mined", "mined", "queued", "drafted",
          "gated", "scheduled", "published", "parked",
        ]).optional().describe("Only moments at this stage"),
        source: z.enum([
          "raw_capture", "prompted_session", "call_transcript", "claude_code", "slack",
        ]).optional().describe("Only moments that arrived this way"),
        pillar: z.string().optional().describe("Only moments on this content pillar"),
        search: z.string().optional()
          .describe("Full-text search across the moment, its detail, its notes and quotes"),
        include_killed: z.boolean().optional()
          .describe("Include moments Josh has killed. Off by default — see 6.3"),
        limit: z.number().int().min(1).max(200).optional().describe("Default 25"),
        cursor: z.string().optional()
          .describe("next_cursor from a previous call, to continue from where it stopped"),
      },
    },
    async handler(args, { db }) {
      const limit = args.limit ?? 25;

      // Search goes through the RPC because it ranks; a filter cannot. The ids come back ordered
      // and the second query re-imposes that order, since PostgREST will not preserve it.
      if (args.search) {
        const ranked = await db.rpc("search_moments", { q: args.search, limit_to: limit });
        const ids = ranked.map((r) => r.moment_id);
        if (ids.length === 0) return { count: 0, moments: [], searched_for: args.search };

        const rows = await db.select("moments", {
          select: MOMENT_FIELDS,
          id: `in.(${ids.join(",")})`,
          ...(args.include_killed ? {} : LIVE_ONLY),
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
        return { count: ordered.length, searched_for: args.search, moments: ordered };
      }

      /*
       * KEYSET, NOT OFFSET.
       *
       * An offset shifts every time something is captured, so a caller walking the bank while the
       * system is running skips rows and repeats others. Paging on the id it last saw cannot: the
       * bank only ever grows, and 6.3 means a row never disappears from under a cursor.
       *
       * Ordered by id rather than captured_at for the same reason — captured_at is not unique, and
       * two moments captured in the same second would make a cursor ambiguous.
       */
      const moments = await db.select("moments", {
        select: MOMENT_FIELDS,
        order: "id.desc",
        limit,
        ...(args.cursor ? { id: `lt.${Number(args.cursor)}` } : {}),
        ...(args.include_killed ? {} : LIVE_ONLY),
        ...(args.status ? { status: `eq.${args.status}` } : {}),
        ...(args.source ? { source: `eq.${args.source}` } : {}),
        ...(args.pillar ? { pillar: `eq.${args.pillar}` } : {}),
      });

      return {
        count: moments.length,
        moments,
        // Only when a full page came back. Offering a cursor on a short page invites one more
        // round trip that is certain to return nothing.
        ...(moments.length === limit
          ? { next_cursor: String(moments[moments.length - 1].id) }
          : {}),
      };
    },
  },

  {
    name: "get_moment",
    config: {
      title: "Get one moment in full",
      description:
        "Everything about one moment: the captured material, the interview so far, any names that " +
        "appear and whether each is cleared, and every previous draft with why it was rejected. " +
        "Call this before drafting — the material is what a draft may claim, and the uncleared " +
        "names are what it must not say.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment's id, from list_moments"),
      },
    },
    async handler(args, { db }) {
      const id = args.moment_id;
      const [moment] = await db.select("moments", { select: "*", id: `eq.${id}`, limit: 1 });
      if (!moment) throw new Error(`No moment with id ${id}.`);

      const [material, names, turns, drafts, raw] = await Promise.all([
        db.select("material", { select: "*", moment_id: `eq.${id}`, limit: 1 }),
        db.select("moment_names", {
          // `id` so a caller can be precise. clear_names matches on the name as he says it, which is
          // right for a conversation, but two people called Ben on one idea need the id to separate.
          select: "id,name,kind,cleared,cleared_note",
          moment_id: `eq.${id}`,
          order: "created_at.asc",
        }),
        db.select("interview_turns", {
          select: "role,body,created_at",
          moment_id: `eq.${id}`,
          order: "created_at.asc",
        }),
        db.select("drafts", {
          select: "id,version,attempt,body,hook,framework,gate_passed,gate_reason,created_at",
          moment_id: `eq.${id}`,
          order: "version.desc",
        }),
        db.select("raw_inputs", {
          select: "kind,transcript,created_at",
          moment_id: `eq.${id}`,
          order: "created_at.asc",
        }),
      ]);

      const uncleared = names.filter((n) => !n.cleared && n.kind !== "not_a_name");

      return {
        moment,
        // sourceEntry, not the raw row — 9.1 defines exactly what a drafter may see.
        //
        // This returned `material[0]` for months, which handed back search_text and every other
        // column alongside the ten fields. The moment:// resource has always narrowed it and
        // capabilities.test.mjs asserts that it does; the same assertion was never written for the
        // tool, so the resource was careful and the tool beside it was not. A model reads whichever
        // one it reaches first.
        material: sourceEntry(material[0] ?? null),
        raw_inputs: raw,
        interview: turns,
        names,
        // Hoisted rather than left for the caller to derive. A model that has to compute its own
        // safety check is a model that will eventually skip it.
        uncleared_names: uncleared.map((n) => n.name),
        may_not_name: uncleared.length > 0
          ? "These are NOT cleared and must not appear in a draft: " +
            uncleared.map((n) => n.name).join(", ")
          : "No uncleared names on this moment.",
        drafts,
      };
    },
  },

  {
    name: "get_library",
    config: {
      title: "Get the reference library",
      description:
        "The fourteen sections that decide how the system writes — voice, pillars, audience, gate " +
        "rules, banned phrasing and the rest. Read this before drafting and before checking; it is " +
        "the standard, not a suggestion. Sections marked immutable hold the non-negotiable rules " +
        "and cannot be changed by anyone, including Josh.",
      inputSchema: {
        key: z.string().optional().describe("One section by key. Omit for all of them."),
        include_empty: z.boolean().optional()
          .describe("Include sections Josh has not filled in yet. Off by default."),
      },
    },
    async handler(args, { db }) {
      const sections = await db.select("library_sections", {
        select: "key,title,body,version,immutable,sort_order,updated_at",
        order: "sort_order.asc",
        ...(args.key ? { key: `eq.${args.key}` } : {}),
      });
      if (args.key && sections.length === 0) throw new Error(`No library section "${args.key}".`);

      // A section whose body is only the placeholder is not content, and a drafter treating it as
      // content would be writing to an instruction that was never meant for it.
      const isEmpty = (s) => !(s.body ?? "").replace(/DELIBERATELY EMPTY[\s\S]*/, "").trim();

      const kept = args.include_empty ? sections : sections.filter((s) => !isEmpty(s));
      const awaiting = sections.filter(isEmpty).map((s) => s.key);

      return {
        count: kept.length,
        awaiting_josh: awaiting,
        note: awaiting.length
          ? awaiting.length + " section(s) are still empty and were left out. Draft without them " +
            "rather than inventing what they would have said."
          : undefined,
        sections: kept,
      };
    },
  },

  {
    name: "list_drafts",
    config: {
      title: "List drafts",
      description:
        "Drafts with their gate outcome, newest first. Use gate_passed=false to read what the gate " +
        "has been rejecting and why — that is the fastest way to understand the standard before " +
        "writing. Each row includes the individual check results when they exist.",
      inputSchema: {
        moment_id: z.number().int().optional().describe("Only drafts for this moment"),
        gate_passed: z.boolean().optional().describe("Filter by whether the draft cleared the gate"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        cursor: z.string().optional()
          .describe("next_cursor from a previous call, to continue from where it stopped"),
      },
    },
    async handler(args, { db }) {
      const limit = args.limit ?? 20;

      // Keyset on id, for the same reason as list_moments: an offset shifts under a caller as
      // drafts are written, and drafts are written by four different things.
      const drafts = await db.select("drafts", {
        select: "id,moment_id,version,attempt,body,hook,framework,model," +
          "claims_verified,gate_passed,gate_reason,created_at",
        order: "id.desc",
        limit,
        ...(args.cursor ? { id: `lt.${Number(args.cursor)}` } : {}),
        ...(args.moment_id ? { moment_id: `eq.${args.moment_id}` } : {}),
        ...(args.gate_passed === undefined ? {} : { gate_passed: `is.${args.gate_passed}` }),
      });
      if (drafts.length === 0) return { count: 0, drafts: [] };

      const nextCursor = drafts.length === limit
        ? { next_cursor: String(drafts[drafts.length - 1].id) }
        : {};

      const runs = await db.select("gate_runs", {
        select: "draft_id,check_key,passed,reason",
        draft_id: `in.(${drafts.map((d) => d.id).join(",")})`,
      });
      const byDraft = new Map();
      for (const r of runs) {
        if (!byDraft.has(r.draft_id)) byDraft.set(r.draft_id, []);
        byDraft.get(r.draft_id).push({ check: r.check_key, passed: r.passed, reason: r.reason });
      }

      return {
        count: drafts.length,
        drafts: drafts.map((d) => ({ ...d, checks: byDraft.get(d.id) ?? [] })),
        ...nextCursor,
      };
    },
  },

  {
    name: "get_acceptance",
    config: {
      title: "The clause 17 scorecard",
      description:
        "How far along the build is: twelve component tests and the overall finish line, computed " +
        "from the live database. A test is 'blocked' when it cannot be measured yet, which is not " +
        "the same as failing. Use this to see what work would actually move the project forward.",
      inputSchema: {
        verbose: z.boolean().optional()
          .describe("Include what each test requires and what was actually measured"),
      },
    },
    async handler(args, { db }) {
      // The same reduction the harness uses, but through this server's key rather than the service
      // role — so a permission gap surfaces here as a permission error rather than as a quietly
      // wrong number, which is the failure that would be impossible to notice.
      const counts = await gatherAll((path) => db.request(`/${path}`));
      const results = score(counts);
      const finish = overall(counts);

      const row = (r) => args.verbose
        ? {
          n: r.n, name: r.name, verdict: r.verdict,
          requires: r.requires, actual: r.actual, blocker: r.blocker,
        }
        : { n: r.n, name: r.name, verdict: r.verdict, actual: r.actual };

      return {
        summary: summarise(results),
        finish_line: row(finish),
        tests: results.map(row),
      };
    },
  },
];
