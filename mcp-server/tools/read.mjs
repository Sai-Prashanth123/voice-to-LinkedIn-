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
// One rule for clearance expiry, shared with the Deno side. See clearanceSurvivesReopen.
import { needsAClearanceDecision } from "../../supabase/functions/_shared/names.ts";
import { isSupplied, renderLibrary } from "../../supabase/functions/_shared/views.ts";
import { COMMENT_SYSTEM } from "../../supabase/functions/_shared/prompts.ts";

/*
 * TWO FIELDS ADDED HERE BECAUSE NOTHING HAD EVER SELECTED THEM.
 *
 * Both were written faithfully for weeks and read by nobody, which is the same fault as
 * drafts.framework: the data looks healthy precisely because nothing looks at it.
 *
 *   audience_is_buyer — written by the same extraction call as framework
 *   (handlers/interview.ts:529), declared in schemas.ts and types.ts, selected nowhere. Clause 6
 *   asks for "a note that it is deliberately not the buyer", and that note existed and could not
 *   be seen.
 *
 *   last_score_reasons — whose own migration says it is "shown on the bank page so 7.4 overrides
 *   are informed rather than blind" (0018_selection.sql:74). That reader has never existed, so
 *   Josh has been pinning and killing against a ranking whose stated justification was written
 *   every four hours into a column nothing opened. last_scored_at comes with it, because a score
 *   from before the selector last stopped looks identical to a fresh one without it.
 */
const MOMENT_FIELDS =
  "id,title,source,status,depth_reached,pillar,audience,audience_is_buyer,strength,pinned,killed," +
  "time_sensitive,decays_at,not_before,parked_reason,notes,captured_at,last_score," +
  "last_score_reasons,last_scored_at";

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
          // `cleared_at` for the expiry rule: clearance is per post (9.10), and this tool read the
          // `cleared` boolean straight off the row, so a permission granted before the last
          // re-open came back here as live.
          select: "id,name,kind,cleared,cleared_at,cleared_note",
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

      // `moment` is selected with `*` above, so `reopened_at` is already in hand — the column was
      // there and nothing on this path read it.
      const uncleared = names.filter((n) =>
        n.kind !== "not_a_name" && needsAClearanceDecision(moment.reopened_at, n)
      );
      // Named separately, because "never cleared" and "cleared for the post this used to be" are
      // different things to say to Josh and only one of them is a question he has already answered.
      const expired = uncleared.filter((n) => n.cleared);

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
        ...(expired.length > 0 && {
          clearance_expired_on_reopen: {
            names: expired.map((n) => ({ name: n.name, previously_cleared_at: n.cleared_at ?? null })),
            why: `This moment was re-opened at ${moment.reopened_at}, which 9.10 makes a different ` +
              "post. Permission given for the earlier one does not carry into this one, so these " +
              "need asking about again — they are not a refusal Josh has never seen, they are a " +
              "yes he gave to a different post.",
          },
        }),
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
      /*
       * AN EMPTY KEY IS A SLIP, NOT A REQUEST FOR EVERYTHING.
       *
       * `args.key ? …` treats `""` as absent, so `key: ""` returned the ENTIRE 64,600-character
       * library. Measured 28 October on the deployed build. On the client Josh uses — which
       * previews about 2 KB and cannot say it cut anything — one stray character silently
       * reproduces the exact defect the pointer index was built to remove. And this tool carries no
       * `read_this_first` and no `brief_is_complete`, so there is nothing in the response to tell a
       * reader it was cut.
       *
       * Omitting the argument is still how you ask for all of them. Passing it empty is refused.
       */
      if (typeof args.key === "string" && args.key.trim() === "") {
        throw new Error(
          "get_library was given an empty key. Omit the argument to read every section, or pass " +
            "one key. An empty string used to return the whole library, which on a client that " +
            "previews two kilobytes is the same as returning nothing.",
        );
      }

      const sections = await db.select("library_sections", {
        select: "key,title,body,version,immutable,sort_order,updated_at",
        order: "sort_order.asc",
        ...(args.key ? { key: `eq.${args.key}` } : {}),
      });
      if (args.key && sections.length === 0) throw new Error(`No library section "${args.key}".`);

      /*
       * isSupplied, imported — not a local rule that agrees with it on most days.
       *
       * This used to carry its own test: strip the "deliberately empty" marker and whatever follows
       * it, then trim. That knows one of the three placeholder forms. It does not know the
       * `# …` heading followed by a line addressed to Josh, which is the head
       * that fourteen sections actually ship with, and it does not know that real content gets
       * appended BELOW a `---` divider while the placeholder stays at the top.
       *
       * So this tool and the drafting brief gave two different answers about the same row. On
       * 13 October, live: get_library reported `voice_transcript` as 1,205 characters of content
       * and left it out of awaiting_josh, while the drafting brief rendered that same section as
       * "(Not yet supplied by Josh. Do not invent one — work without it.)". Josh read a filled
       * library and the model writing his posts was handed a hole where his voice evidence goes —
       * then he was told the system was not referencing the library correctly, and he was right.
       *
       * views.ts is the single answer. X-02 is named "there is one answer to whether a library
       * section is filled in" and asserts it; it never reached this file because this file had its
       * own copy.
       */
      const isEmpty = (s) => !isSupplied(s.body);

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
/* ── His creator list, and the comments waiting on it ───────────────────── */

  {
    name: "list_creators",
    config: {
      title: "Who is being watched for comment options",
      description:
        "The creators Josh has asked to be watched, with when each was last polled and when they " +
        "last posted. Use it when he asks who is on the list, whether a name is already on it, or " +
        "why no comment options have arrived.\n\n" +
        "READ last_polled_at BEFORE BLAMING A QUIET LIST. A poll that has stopped and a week " +
        "where nobody posted look identical from the options alone, and this is the only thing " +
        "that tells them apart. An empty list is not a fault: it is the off state, and the whole " +
        "feature does nothing until he names someone.",
      inputSchema: {
        include_inactive: z
          .boolean()
          .optional()
          .describe("Include creators he has stopped watching. Off by default; nothing is deleted."),
      },
    },
    async handler(args, { db }) {
      const query = {
        select: "handle,display_name,profile_url,active,added_at,last_polled_at,last_seen_posted_at",
        order: "handle.asc",
      };
      if (!args.include_inactive) query.active = "eq.true";
      const creators = await db.select("creators", query);

      const stalest = creators
        .filter((c) => c.active)
        .map((c) => c.last_polled_at)
        .sort();
      const lastPoll = stalest[stalest.length - 1] ?? null;
      const hoursSince = lastPoll
        ? Math.round((Date.now() - new Date(lastPoll).getTime()) / 3600000)
        : null;

      const waiting = await db.select("comment_options", {
        select: "id",
        status: "eq.offered",
        limit: 200,
      });

      return {
        watching: creators.filter((c) => c.active).length,
        creators: creators.map((c) => ({
          handle: c.handle,
          name: c.display_name ?? c.handle,
          profile: c.profile_url,
          active: c.active,
          last_polled_at: c.last_polled_at,
          last_seen_posted_at: c.last_seen_posted_at,
          never_polled: !c.last_polled_at,
        })),
        options_waiting: waiting.length,
        last_poll: lastPoll,
        means: creators.length === 0
          ? "Nobody is being watched, so nothing is fetched and nothing is spent. That is the " +
            "off state, not a fault — the first creator he names switches the feature on."
          : lastPoll === null
          ? "NOTHING HAS BEEN POLLED YET. The schedule runs at 07:00 and 15:00 on weekdays; " +
            "run_worker with engage checks now."
          : hoursSince > 48
          ? "THE LAST POLL WAS " + hoursSince + " HOURS AGO, which is longer than the schedule " +
            "allows for. Something is wrong with the job rather than quiet on his list — check " +
            "health, then run_worker with engage."
          : "Polled " + hoursSince + " hour(s) ago.",
      };
    },
  },

  {
    name: "list_comment_options",
    config: {
      title: "Comment options waiting for him",
      description:
        "Drafted comments on posts by the creators he watches, newest first, grouped by post and " +
        "carrying the post itself and its URL so he can read what is being replied to. Use it " +
        "when he asks what is waiting, or after system_status reports comments ready.\n\n" +
        "THESE ARE UNCHECKED. No gate, no claim ledger and no shingle guard reads a comment — " +
        "those all read drafts. Any `flags` on an option are what three cheap deterministic " +
        "checks caught, and an empty flag list is NOT a safety certificate: the thing that " +
        "actually identifies a client is a figure plus a niche plus a date, and no string search " +
        "finds that. Read any number in a comment before he uses it.\n\n" +
        "He pastes the one he wants into LinkedIn himself; nothing here posts. Call " +
        "record_comment_used afterwards for the one he left AND the ones he passed over, or there " +
        "is no signal at all about which comments are worth writing.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional()
          .describe("How many options to return. Default 12."),
        include_decided: z.boolean().optional()
          .describe("Include options he has already used or passed over. Off by default."),
      },
    },
    async handler(args, { db }) {
      const limit = args.limit ?? 12;
      const query = {
        select: "id,activity_id,body,why,flags,status,created_at",
        order: "created_at.desc",
        limit,
      };
      if (!args.include_decided) query.status = "eq.offered";
      const options = await db.select("comment_options", query);

      if (options.length === 0) {
        const watched = await db.select("creators", { select: "handle", active: "eq.true", limit: 1 });
        return {
          options: [],
          means: watched.length === 0
            ? "Nothing is waiting because nobody is being watched. watch_creator starts it."
            : "Nothing is waiting. Either nobody on his list has posted since the last run, or " +
              "nothing they posted was worth a comment — both are normal. list_creators shows " +
              "when each was last polled.",
        };
      }

      // The posts these reply to, in one read rather than one per option.
      const ids = [...new Set(options.map((o) => o.activity_id))];
      const posts = await db.select("creator_posts", {
        select: "activity_id,handle,author_name,url,posted_at,text",
        activity_id: "in.(" + ids.map((i) => '"' + i + '"').join(",") + ")",
        limit: ids.length,
      });
      const byId = new Map(posts.map((p) => [p.activity_id, p]));

      const grouped = ids.map((id) => {
        const post = byId.get(id);
        const mine = options.filter((o) => o.activity_id === id);
        return {
          post: post
            ? {
              author: post.author_name ?? post.handle,
              handle: post.handle,
              posted_at: post.posted_at,
              url: post.url,
              text: post.text,
            }
            : { author: "unknown", note: "The post this replies to is no longer readable." },
          options: mine.map((o) => ({
            option_id: o.id,
            comment: o.body,
            why_his: o.why,
            flags: o.flags ?? [],
            status: o.status,
          })),
        };
      });

      const flagged = options.filter((o) => Array.isArray(o.flags) && o.flags.length > 0).length;

      return {
        waiting: options.length,
        posts: grouped.length,
        flagged,
        groups: grouped,
        means: "Unchecked drafts. " +
          (flagged > 0
            ? flagged + " of " + options.length + " carry a flag — read it and decide; nothing " +
              "is blocked. "
            : "None carry a flag, which is not the same as being safe to post. ") +
          "Read him the comment and the one line on why it is his, then record_comment_used for " +
          "whichever way he goes.",
      };
    },
  },
{
    name: "get_comment_brief",
    config: {
      title: "Get the standard for writing a comment",
      description:
        "The instructions for drafting a comment in Josh's voice, assembled from his live library. " +
        "This is the SAME brief the creator poll's worker is given, which is the point of fetching " +
        "it rather than writing from instinct: the josh-comment skill and worker-engage would " +
        "otherwise hold two standards and nothing would say which one a given comment followed. " +
        "Call it before drafting a comment, whether he pasted the post or the poll found it.",
      inputSchema: {},
    },
    async handler(_args, { db }) {
      const sections = await db.select("library_sections", {
        select: "key,title,body,sort_order",
        order: "sort_order.asc",
      });
      const { sections: visible, prompt } = renderLibrary(sections, "commenting");

      return {
        system: COMMENT_SYSTEM(prompt),
        sections_included: Object.keys(visible),
        /*
         * Said out loud because the absences are deliberate and a reader who does not know that
         * will go looking for them. The hook rules in particular: a comment that opens a loop
         * under someone else's post is the behaviour his market is sick of.
         */
        deliberately_absent: {
          hooks: "A comment is a reply, not a post. It does not open a loop, it answers something.",
          formatting: "Those rules shape a post above the fold. A two-to-five sentence reply has no fold.",
          pillars_and_frameworks: "He is answering someone else's subject, not choosing his own.",
          reference_posts:
            "A writer who has just read another writer's posts starts measuring against their " +
            "voice. It matters more here than in the gate, because the comment sits directly " +
            "under someone else's writing.",
        },
        voice_guide_supplied: Boolean(visible.voice_guide),
        nothing_checks_this:
          "No gate, no claim ledger and no shingle guard reads a comment — they all read drafts. " +
          "If you are writing this in a session you are the only check there is. Any number you " +
          "cannot source is one to write around, because he pastes this straight into LinkedIn.",
      };
    },
  },
];
