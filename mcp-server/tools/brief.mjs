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
import { REFERENCE_WRITERS, WRITER_CHOICES, writerAskFrom } from "../writers.mjs";
import { joshNote, JOSH_NOTE_PREFIX } from "../../supabase/functions/_shared/notes.ts";
/*
 * ONE RULE FOR WHETHER A NAME IS CLEARED, AND THESE TWO BRIEFS WERE THE LAST READERS NOT USING IT.
 *
 * Clearance is per POST (9.10): a name Josh cleared for one post stops being cleared the moment the
 * idea is re-opened, because a re-open makes it a different post and the permission has to be asked
 * again. names.ts implements that against `moments.reopened_at`, and both briefs read `cleared`
 * straight off the row — so on the Claude path, which is the path that runs, the expiry had never
 * once fired. Six readers, one rule; clearance.test.mjs asserts all six by source.
 */
import {
  isClearedNow,
  needsAClearanceDecision,
} from "../../supabase/functions/_shared/names.ts";
import { WRITTEN_UP } from "../../supabase/functions/_shared/extraction.ts";
import { parsePillars } from "../../supabase/functions/_shared/library.ts";
import { renderTranscript } from "../../supabase/functions/_shared/session.ts";
import { measureShape, shapeAgainst, writerShapeTargets } from "../../supabase/functions/_shared/shape.ts";
import {
  CHECK_NEEDS_SECTION,
  gateInputsFor,
  isSupplied,
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
    // The rows themselves, so the pointer index below is built from the same read rather than from
    // a second one. Two reads of one table inside one brief is how a pointer ends up naming a
    // section whose body the same response measured differently.
    rows,
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

/* ── Pointers, and a response that can tell you it was cut ───────────────── */
/*
 * WHY ANY OF THIS EXISTS
 *
 * Josh has never used a clone. Every session he has ever run went through the hosted connector, and
 * his client truncates a tool response to a ~2 KB preview, cut mid-sentence. Nothing in this repo
 * imposes that limit and nothing here can detect it: mcp-server/http.mjs, the edge function and
 * server.mjs all pass the whole value through as one text block. So the cut is the client's, and the
 * only lever on this side is WHAT SITS IN THE FIRST 2 KB and whether a reader can tell it was cut.
 *
 * Measured 28 October 2026, before this change:
 *
 *   get_drafting_brief, moment 111   73,414 chars   system 41,488  user 28,861
 *   get_gate_brief, draft 90          100,296 chars   system 29,402  checks 69,935
 *
 * Everything below the cut was lost — the material, the audience, the shape targets, must_not_name,
 * the previous rejection. Six drafters hit it in one day and every one recovered only by reading the
 * spilled file off disk, which is exactly what his surface cannot do.
 *
 * Three things answer it, and none of them is a bigger limit. guards.test.mjs has said why since the
 * shape rows were paged: "A bigger limit is not the fix; nothing in a response says it was
 * truncated." So:
 *
 *   1. The constant 38 KB of library prose becomes a ~1.2 KB index of addresses (libraryPointers).
 *   2. JSON.stringify preserves insertion order, so the keys that must survive a cut go FIRST.
 *   3. The response measures itself and ends with a terminal marker, so a reader that cannot see
 *      `brief_is_complete` KNOWS it is holding a cut copy — and the first key already told it what
 *      to call to get the rest.
 */

/** 38581 → "38,581". Written out rather than toLocaleString: ICU builds disagree on the separator. */
const commas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * The library a view may read, as an INDEX of addresses rather than as its bodies.
 *
 * Built from VIEWS[view] rather than from the rows, so the set of URIs this prints is the view's own
 * allowlist by construction. That is the property that matters: a pointer index naming a section the
 * resource cannot serve would be worse than no index at all, and an index missing a section the view
 * allows would quietly narrow the standard. brief-size.test.mjs asserts the set both ways.
 *
 * `library://{key}` has been served by resources.mjs since it was written, with a list callback, and
 * nothing in the repo pointed at it until now. The two routes are named TOGETHER and deliberately:
 * it is not verifiable from this side whether the connector surfaces `resources/list` to the model or
 * only to the person, and `get_library` with a key has existed in read.mjs all along. Naming both
 * costs one line and removes the guess.
 */
function libraryPointers(rows, view) {
  const keys = [...VIEWS[view]];
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const sections = keys.filter((key) => byKey.has(key)).map((key) => {
    const row = byKey.get(key);
    /*
     * TWO SEPARATE FACTS, because one number cannot carry both.
     *
     * `placeholder` uses isSupplied() rather than a length test, and that distinction is the
     * important one: seven sections hold prose addressed to Josh explaining what he should put
     * there, and a length test calls those filled in. See views.ts.
     *
     * `chars` is the length of WHAT get_library HANDS BACK, untrimmed.
     *
     * It used to be the trimmed length of the supplied body, which made it wrong in two ways at
     * once — measured 28 October against the live project. The trim cost a trailing newline, so
     * five sections were reported one character short of what a drafter receives: `core_rules` said
     * 543 where get_library returns 544. And a placeholder was reported as `chars: 0` while
     * get_library returns 187 characters of "not yet supplied by Josh, do not invent one".
     *
     * Neither gap would mislead anybody into a bad draft. Both are still a number that does not
     * describe the thing it labels, in a field whose only job is to tell a reader how big something
     * is before they fetch it — and this project has spent a fortnight on numbers that measured
     * something adjacent to what they claimed. `placeholder` carries the "there is no standard
     * here" signal, so `chars` is free to be the plain truth about size.
     */
    return {
      key,
      title: row.title ?? key,
      /*
       * The length of what get_library WILL HAND BACK — which is nothing at all for a placeholder.
       *
       * My first pass at this reported the raw row length unconditionally. That fixed the five
       * off-by-one sections and broke the one placeholder: it then claimed 1,205 characters for
       * `voice_transcript`, which is 1,205 characters of "FOR JOSH, put your transcript here" that
       * get_library correctly declines to serve as standard. A pointer promising 1,205 characters
       * of a section that returns none is a worse lie than the newline it replaced.
       *
       * So: 0 when there is nothing to fetch, the exact untrimmed length when there is. Verified
       * against get_library for all eleven sections rather than reasoned about.
       */
      chars: isSupplied(row.body) ? String(row.body ?? "").length : 0,
      placeholder: !isSupplied(row.body),
      uri: `library://${key}`,
    };
  });

  // A view key with no row at all is a disagreement between the allowlist and the library, and it
  // is said out loud rather than silently dropped from the index.
  const absent = keys.filter((key) => !byKey.has(key));

  const pad = Math.max(...sections.map((s) => s.key.length), 0);
  const lines = sections.map((s) =>
    `  ${s.key.padEnd(pad)}  ${s.uri.padEnd(pad + 10)}  ` +
    (s.placeholder
      ? `PLACEHOLDER — not supplied by Josh. Do not invent one; work without it.`
      : `${commas(s.chars)} chars · ${s.title}`)
  );

  const total = sections.reduce((n, s) => n + s.chars, 0);

  const text =
    `THE REFERENCE LIBRARY IS NOT PRINTED BELOW. IT IS ADDRESSABLE, AND READING IT IS NOT ` +
    `OPTIONAL.\n\n` +
    `These are the ${sections.length} sections this ${view} view may read — ${commas(total)} ` +
    `characters in total. The standard is in them. This index is only their addresses, so a draft ` +
    `written from the index alone is a draft written from nothing.\n\n` +
    `Read every section that is not a placeholder BEFORE you write. Two routes, either works — use ` +
    `whichever your client has:\n\n` +
    `  · get_library with key: "<key>" — an ordinary tool call, always available\n` +
    `  · resources/read on the URI below, if your client exposes MCP resources\n\n` +
    `${lines.join("\n")}\n\n` +
    (absent.length > 0
      ? `NOT IN THE LIBRARY AT ALL: ${absent.join(", ")}. The ${view} view allows ` +
        `${absent.length === 1 ? "it" : "them"} and no row exists. Say so rather than working ` +
        `around a gap nobody knows about.\n\n`
      : "") +
    `If a section will not read, say WHICH ONE and write without it. Never guess at what it said, ` +
    `and never substitute your own sense of what a good post is for a section you could not open — ` +
    `that substitution is the whole reason this standard lives in the system rather than in a file.`;

  return { text, sections, uris: sections.map((s) => s.uri), total_chars: total, absent };
}

/**
 * Measure a response and seal it, in one pass that cannot disagree with itself.
 *
 * `build(chars)` returns the whole object in key order with the size quoted wherever it needs to be,
 * and WITHOUT the last two keys; this appends `response_chars` and `brief_is_complete`. The size is
 * quoted inside the value being measured, so it is a fixed point: f(n) = length of build(n) is
 * non-decreasing in n (more digits is never shorter), so iterating from zero increases monotonically
 * and settles as soon as the digit count stops changing — three passes at most in practice.
 *
 * `brief_is_complete` is LAST on purpose and is the only honest answer to "nothing in a response says
 * it was truncated". It is not a flag anybody reads for its value: its ABSENCE is the signal.
 */
/*
 * MEASURED THE WAY THE TRANSPORT SERIALISES, which is not the default.
 *
 * This counted `JSON.stringify(body)` — compact. `server.mjs:90` sends
 * `JSON.stringify(value, null, 2)`. So `response_chars` under-reported the wire size by about 2.4%:
 * on moment 111 it said 38,141 where the response was 39,080, and on moment 110 it said 19,809
 * where it was 20,653. Measured 28 October 2026, against the live project.
 *
 * Small as a percentage and exactly the wrong kind of wrong. The field exists so a reader can
 * compare it against what arrived and decide whether it has the whole thing — and the comment
 * below, which was already here, says a figure that disagrees with the response is worse than no
 * figure. It disagreed with the response. The indent is two spaces per level across a deeply nested
 * object, so the gap grows with the brief rather than staying a rounding error.
 *
 * `INDENT` is the one place the two are tied together. If the transport ever stops indenting, this
 * is the line that has to change with it, and `brief-size.test.mjs` asserts the equality rather
 * than the constant.
 */
const INDENT = 2;

function seal(build) {
  let n = 0;
  for (let pass = 0; pass < 8; pass++) {
    const body = { ...build(n), response_chars: n, brief_is_complete: true };
    const measured = JSON.stringify(body, null, INDENT).length;
    if (measured === n) return body;
    n = measured;
  }
  // Unreachable for a monotone f with a bounded digit count, and thrown rather than returned wrong:
  // a response_chars that disagrees with the response is worse than no figure, because the whole
  // point of it is that a reader can trust the figure to decide whether it has the whole thing.
  throw new Error("response size did not settle; refusing to quote a figure that is not the size");
}

/**
 * The first key of a brief, and the only one guaranteed to survive a 2 KB cut.
 *
 * Kept under 600 characters deliberately. It carries the three things a truncated reader needs and
 * nothing else: how big the whole response is, where the library actually lives, and what to call to
 * get the part that was cut off.
 */
function readThisFirst({ chars, tool, part, keys, recover }) {
  return `This response is ${commas(chars)} serialized characters. The reference library is NOT ` +
    `inlined — read it with get_library (key: ${keys.join(", ")}) or resources/read on ` +
    `library://<key>.` +
    (part && part !== "all" ? ` This is the "${part}" part only.` : "") +
    ` If you cannot see brief_is_complete at the end of this response you are reading a cut copy — ` +
    (recover ?? `call ${tool} again with part: "material"`) + `.`;
}

/**
 * A brief carried inside ANOTHER tool's response — `next_work` and `write_post` both do it.
 *
 * ONE TRUNCATION SIGNAL PER RESPONSE. Nested, a brief's own `response_chars` is the size of
 * something nobody serialised and its `brief_is_complete` is no longer the last key of anything, so
 * a reader following the contract would check the wrong marker and conclude a complete response was
 * cut, or a cut one complete. Three disagreeing signals in one object is worse than none, because
 * there is no way to tell which object was measured. So the inner three are stripped and the OUTER
 * response carries the pair, measured on itself.
 *
 * The library keys come off the brief rather than being passed in: a wrapper that typed its own list
 * would be a second answer to which sections the view allows, and they would drift.
 */
export function carriedBrief(brief, { tool, recover }) {
  const {
    read_this_first: _inner,
    response_chars: _size,
    brief_is_complete: _marker,
    ...rest
  } = brief;
  const keys = (brief.library_pointers?.sections ?? []).map((s) => s.key);
  return {
    brief: rest,
    firstKey: (chars) => readThisFirst({ chars, tool, keys, recover }),
  };
}

/** Exported for the two wrappers above, so there is one implementation of the measure-and-seal. */
export { seal };

/** One setting, read the way getSetting reads it, with the same fallback. */
async function setting(db, key, fallback) {
  const [row] = await db.select("settings", { select: "value", key: `eq.${key}`, limit: 1 });
  return row?.value ?? fallback;
}

/**
 * What the gate actually recorded against a draft, as rendered reasons.
 *
 * Read rather than inferred from `drafts.gate_passed`, because that column has three states and
 * only one of them means "clean": false is rejected, true is passed, and null is NOT YET JUDGED —
 * which a part-way gate run leaves behind with real failures already written against it.
 */
async function gateFailures(db, draftId) {
  if (!draftId) return [];
  try {
    const runs = await db.select("gate_runs", {
      select: "check_key,passed,reason",
      draft_id: `eq.${draftId}`,
    });
    return runs
      .filter((r) => r.passed === false)
      .map((r) => `${r.check_key}: ${r.reason ?? "failed without a stated reason"}`);
  } catch {
    // Never worth failing a brief over. An empty list reads as "nothing recorded", which is what
    // the caller would otherwise have had anyway.
    return [];
  }
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
        "are never included and are refused mechanically at filing.\n\n" +
        "THE LIBRARY IS NOT INLINED. The brief names each section, its size and its library:// URI, " +
        "and you read the ones you need with get_library or resources/read. That is not an " +
        "optimisation you may skip: a draft written from the index rather than from the sections is " +
        "a draft written against no standard, and the gate judges it against the sections. If the " +
        "response ends without brief_is_complete, your client cut it — read read_this_first, which " +
        "is the first key for that reason, and call again with the part you are missing.",
      inputSchema: {
        moment_id: z.number().int().describe("Which moment to draft, from list_moments"),
        // Built from REFERENCE_WRITERS rather than typed out again. The same eight were listed by
        // hand here and in tools/voice.mjs, so adding or renaming one would have left the matcher
        // and the description disagreeing in silence.
        writer_handle: z.string().optional().describe(
          `One of: ${WRITER_CHOICES}. Only when Josh named a writer — never chosen for him. ` +
          "If he named one in a pushback note instead, it is read from there and does not need " +
          "passing here.",
        ),
        /*
         * The escape hatch, and the only way back to what shipped before 28 October.
         *
         * "inline" reproduces the old response byte for byte — 41,488 characters of system prompt —
         * and exists for a client with no tool-calling loop (the `draft-post` MCP prompt with
         * inline: true is the one caller that genuinely needs it) and for the eval harness, which
         * compares against recorded prompts and would otherwise read a change in the index as a
         * change in the standard. Nobody drafting on Josh's surface should pass it: his client cuts
         * the response long before the library starts.
         */
        library: z.enum(["pointers", "inline"]).optional().describe(
          "Default \"pointers\": the library is named by URI, not pasted in. \"inline\" pastes all " +
          "eleven sections into `system` — 41,488 characters, which Josh's client truncates.",
        ),
        /*
         * A NAMED ENUMERATION, NEVER A CURSOR.
         *
         * A cursor over 25 KB of prose cuts mid-sentence at whatever offset the page ends on, which
         * is the defect this whole change removes rather than a way of paging around it. Two named
         * halves each make sense read on their own: "material" is everything that varies with the
         * moment, "instructions" is everything that is constant for a library version.
         */
        part: z.enum(["material", "instructions", "all"]).optional().describe(
          "Default \"all\". \"material\" is the moment, the audience, the names and the previous " +
          "attempt — everything that varies. \"instructions\" is the standard. Ask for one half " +
          "when the whole came back cut.",
        ),
      },
    },
    async handler(args, context) {
      const { db } = context;
      const id = args.moment_id;

      const [moment] = await db.select("moments", {
        // `reopened_at` for the clearance expiry above. Without it the rule cannot be evaluated at
        // all, which is why it had silently not been.
        select: "id,title,killed,status,audience,pillar,reopened_at",
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
        select: "name,kind,cleared,cleared_at",
        moment_id: `eq.${id}`,
      });
      const real = names.filter((n) => n.kind !== "not_a_name");
      // Exact complements, from names.ts, so the two lists can never both hold a name or both drop
      // one. A name in neither would be invisible to the drafter and to create_draft's refusal.
      const cleared = real.filter((n) => isClearedNow(moment.reopened_at, n)).map((n) => n.name);
      const uncleared = real
        .filter((n) => needsAClearanceDecision(moment.reopened_at, n))
        .map((n) => n.name);

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
      /*
       * His note is taken OUT of the rejection reasons, because hisNotes below now carries it.
       *
       * Leaving it in both put the same sentence on the page twice, framed two opposite ways: once
       * under "These are INSTRUCTIONS" and once under "It failed on: ... Fix those specifically".
       * The second is the mislabelling this whole change exists to remove — his instruction filed
       * as a verdict against the draft.
       */
      const jobFailures = (Array.isArray(waiting?.payload?.failures) ? waiting.payload.failures : [])
        .filter((f) => !String(f).startsWith(JOSH_NOTE_PREFIX));

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
          .map((f) => joshNote(f))
          .filter(Boolean),
      )];
      if (waiting?.payload?.previous_body || jobFailures.length > 0) {
        /*
         * NO INVENTED VERDICT WHEN THERE WAS NO REJECTION.
         *
         * A pushback job's `failures` holds only his note, so once the note is filtered out above
         * this list is empty — and the fallback here used to substitute `gate_reason ?? "rejected"`.
         * `gate_reason` is null on a draft that PASSED, which is the normal review path: he reads a
         * draft that cleared the gate and asks for a change. The brief then told the writer
         *
         *     Your previous attempt was rejected. It failed on:
         *       - rejected
         *
         * about a draft the gate approved, in place of the words he actually used. A verdict
         * nobody reached is the same class of invention as a quote nobody said.
         */
        /*
         * AND "NOT YET JUDGED" IS NOT "NOTHING REJECTED IT" EITHER.
         *
         * The first fix for the above read `gate_passed === false`, which made every other value —
         * including null — mean the draft was clean. It is not: `finishGate` leaves `gate_passed`
         * null until every check has answered, so a draft part-way through, or one whose verdicts
         * were recorded and never closed out, sits at null WITH failing gate_runs rows against it.
         * Telling the writer "nothing rejected it" about that draft is the same invention pointing
         * the other way, and it drops the failures on the floor.
         *
         * So the verdicts are read rather than inferred from one column, and the three states are
         * kept apart.
         */
        const recorded = jobFailures.length > 0 ? [] : await gateFailures(db, previous?.id);
        previousAttempt = {
          body: waiting.payload.previous_body ?? previous?.body ?? "",
          failures: jobFailures.length > 0 ? jobFailures : recorded,
          verdict: jobFailures.length > 0 || recorded.length > 0
            ? "rejected"
            : previous?.gate_passed === true
            ? "passed"
            : "not_judged",
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
        : writerAskFrom(hisNotes);

      /*
       * ISOLATED, LIKE THE TASTE READ ABOVE AND FOR THE SAME REASON.
       *
       * Both of these page through ~1,800 reference posts. While the only way to reach them was an
       * explicit `writer_handle`, a failure was the caller's problem. Now his own note can trigger
       * them, so a slow page or a transient PostgREST error would fail the whole brief — and
       * `next_work` returns the first unparked moment's brief without skipping one that throws, so
       * the oldest pending rewrite would stop the entire writing queue on every call.
       *
       * A target is an input to a better draft, not a precondition for one. If it cannot be read,
       * the draft is written without it and the caller is told that is what happened.
       */
      /*
       * A HANDLE THE CALLER TYPED AND THIS CANNOT RESOLVE IS A REFUSAL, NOT A QUIET OMISSION.
       *
       * Measured 28 October on the deployed build. Four inputs — `"nobody"`, `"MATTJBARKER1"`,
       * `"Matt Barker"` and `""` — each returned a SUCCESSFUL brief with the whole
       * `BUILD THIS ONE IN …` block simply absent from the prose, no error, and in the empty-string
       * case not even a `no_target` field. The three judging tools refuse the same inputs loudly and
       * name all eight valid handles. The brief, which is the artefact that actually steers the
       * writing, did not.
       *
       * So a drafter that mistypes the case, or writes the NAME where the handle goes, gets a brief
       * with no shape and nothing saying one was asked for and lost — and then falls back to the
       * library's default framework. That is Josh's recorded complaint, "the default framework gets
       * used anyway", still reachable: no longer by a hardcoded Barker read, but by one character of
       * case.
       *
       * Case is normalised first, because `MATTJBARKER1` is a slip rather than a different ask.
       *
       * THE DISTINCTION THAT MATTERS: this refuses only a handle the CALLER PASSED. A handle parsed
       * out of one of his dictated notes keeps the soft `no_target` path, because the parse is ours
       * and a brief must never fail on our reading of his words — `next_work` returns the first
       * unparked moment's brief, so a throw there stops the whole writing queue.
       */
      const typed = typeof args.writer_handle === "string" ? args.writer_handle.trim() : "";
      if (typed && ask?.handle && ask.handle.toLowerCase() === typed.toLowerCase()) {
        // The canonical eight, static — no database call, so a refusal cannot itself fail.
        const known = REFERENCE_WRITERS.map((w) => w.handle.toLowerCase());
        if (!known.includes(typed.toLowerCase())) {
          throw new Error(
            `No measured writer "${typed}". The measured writers are: ${known.join(", ")}. ` +
              `A handle that cannot be resolved is refused rather than dropped, because a brief ` +
              `with the shape silently missing is how the default framework gets used anyway.`,
          );
        }
        ask.handle = typed.toLowerCase();
      }

      let shapeUnavailable = null;
      try {
        if (ask?.handle) {
          writerShape = await writerShapeBlock(db, ask.handle);
          if (writerShape) writerShape.kind = "writer";
        } else if (ask?.corpus) {
          // He pointed at the group. A band across eight, never one of them — see corpusShapeBlock.
          writerShape = await corpusShapeBlock(db);
        }
      } catch (err) {
        writerShape = null;
        shapeUnavailable = `The shape he asked for could not be read (${err?.message ?? err}), so ` +
          "this draft was briefed without it. Nothing else is affected.";
      }

      const library = await libraryText(db, "drafting");
      const pointers = libraryPointers(library.rows, "drafting");
      const inline = args.library === "inline";
      const part = args.part ?? "all";

      // Both halves built ONCE, outside the seal below. `seal` calls its builder up to three times
      // to settle the size it quotes, so anything expensive or impure in there would be done three
      // times — and anything that could answer differently between passes would never settle.
      const systemText = part === "material"
        ? undefined
        : DRAFTER_SYSTEM(inline ? library.text : pointers.text);

      const userText = part === "instructions" ? undefined : DRAFT_USER({
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
           *
           * NOW CARRYING WHICH POST EACH ONE WAS ABOUT, WHICH IS THE WHOLE DIFFERENCE.
           *
           * Measured 28 October 2026: six drafters were each given a different moment, and every
           * one of them read this list as instructions for the post in front of them. On a brief
           * for a post about board papers, the most prominent "feedback" was hook direction for an
           * unrelated post about cold email. The read returns the ten most recent notes about ANY
           * post — deliberately, see migration 0054 — but the page said "WHAT JOSH HAS SAID ABOUT
           * PREVIOUS DRAFTS" directly above a second, moment-scoped list in the identical bullet
           * style whose framing says "these are INSTRUCTIONS … cumulative".
           *
           * Two things fix it, and neither is filtering the read:
           *
           *   1. ANYTHING ABOUT THIS MOMENT IS DROPPED HERE. It is already carried by hisNotes,
           *      correctly scoped and correctly framed as an instruction. Rendering it in both
           *      places put the same sentence on one page twice under opposite headings — once as
           *      a standing instruction and once as a note that "is not a rule". Whichever a
           *      drafter believed, the page contradicted itself.
           *   2. EVERY REMAINING NOTE SAYS WHICH POST IT WAS ABOUT. A note about another post is
           *      evidence of taste; a note about this one is an instruction. They are frequently
           *      the same sentence, and until now the page made them indistinguishable.
           *
           * A note with no text is also dropped. One verdict row on moment 113 has a null note and
           * rendered as `- 2026-10-27 — ""` — a dated entry presented as something he said, which
           * is worse than absent.
           */
          tasteNotes: (taste ?? [])
            .filter((n) => String(n.note ?? "").trim().length > 0)
            .filter((n) => Number(n.moment_id) !== id)
            .map((n) => {
              const when = (n.said_at ?? "").slice(0, 10);
              // The title rather than the id, because a drafter cannot look an id up and the whole
              // point is that it reads at a glance as being about something else.
              const about = n.moment_title ? `on "${n.moment_title}"` : "on another post";
              const said = `${when}, ${about} — "${String(n.note ?? "").trim()}"`;
              if (!n.before_text || !n.after_text || n.before_text === n.after_text) return said;
              const first = (s) => String(s).split("\n")[0].trim();
              if (first(n.before_text) === first(n.after_text)) return said;
              return `${said}\n      He was given:   "${first(n.before_text)}"\n` +
                `      He changed it to: "${first(n.after_text)}"`;
            }),
        });

      /*
       * Said outside the prose as well, for the same reason must_not_name is: if the writer was
       * named and no target could be given, the caller has to know that rather than assume the
       * shape is in there somewhere. writerShapeBlock refuses rather than degrading when a
       * writer's measurable corpus is too thin to call anything his habit.
       */
      const shapeKeys = writerShape
        ? {
          writer_shape: writerShape.refused
            ? { handle: writerShape.handle ?? null, no_target: writerShape.refused }
            : {
              handle: writerShape.handle ?? null,
              name: writerShape.name,
              basis: writerShape.basis,
              targets: writerShape.lines,
              not_from_this_writer: writerShape.excludes,
              /*
               * Where the target came from, because a shape nobody asked for in THIS call needs to
               * announce itself. "his_note" means it was read out of his own pushback — tell him
               * that rather than letting a target appear from nowhere.
               */
              asked_by: args.writer_handle ? "this_call" : "his_note",
            },
        }
        : {};

      /*
       * THE KEY ORDER IS THE CONTRACT, BECAUSE THE CUT IS THE CLIENT'S AND WE CANNOT SEE IT.
       *
       * JSON.stringify preserves insertion order, so the first keys are the ones that survive a
       * 2 KB preview. read_this_first says how to get the rest; must_not_name is second because it
       * is the one instruction that must never be missed, and because create_draft refuses on it
       * anyway — better to know before writing than after. Everything bulky is below them, and
       * brief_is_complete is last so its ABSENCE is the truncation signal.
       */
      const brief = seal((chars) => ({
        read_this_first: readThisFirst({
          chars,
          tool: "get_drafting_brief",
          part,
          keys: pointers.sections.map((s) => s.key),
          // A reader that asked for the material and STILL got cut cannot be sent back for the
          // material. The moment resource is the smallest thing that carries it.
          recover: part === "material"
            ? `read moment://${id}, or call get_moment with moment_id ${id}`
            : undefined,
        }),
        must_not_name: uncleared,
        library_pointers: {
          view: "drafting",
          read_with: [
            `get_library with key: "<key>" — an ordinary tool call, always available`,
            "resources/read on the URI, if your client exposes MCP resources",
          ],
          sections: pointers.sections,
          ...(pointers.absent.length > 0 && { allowed_but_missing: pointers.absent }),
          note: inline
            ? "library: \"inline\" was asked for, so the bodies are also pasted into `system`. " +
              "These URIs are then a convenience rather than the only route."
            : "The bodies are NOT in this response. Read every section that is not a placeholder " +
              "before writing — the gate judges the draft against them.",
        },
        moment_id: id,
        name: moment.title ?? null,
        prompt_version: PROMPT_VERSION,
        library_version: library.version,
        library_sections_awaiting_josh: library.awaiting_josh,
        // Said out loud, because the comment where this is set promises the caller is told. It was
        // assigned and read by nothing — a value nothing selects, which is the exact defect this
        // repo is named for, introduced inside the fix for another instance of it.
        ...(shapeUnavailable && { writer_shape_unavailable: shapeUnavailable }),
        ...shapeKeys,
        ...(part === "all" ? {} : {
          part,
          the_other_part: part === "material"
            ? "get_drafting_brief with part: \"instructions\" returns the standard."
            : "get_drafting_brief with part: \"material\" returns the moment and the names.",
        }),
        ...(userText !== undefined && { user: userText }),
        ...(systemText !== undefined && { system: systemText }),
        next: part === "instructions"
          ? "Read the library sections named above, then call get_drafting_brief with " +
            "part: \"material\" for the moment itself."
          : "Read every library section named above, write the post, then call create_draft with " +
            "every claim and its verbatim source span.",
      }));

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
        "Every check a draft must clear, each with its own rubric, the post, and " +
        "the source material it was built from. Judge each one separately and record it with " +
        "record_gate_verdict — one call per check. Do not average across them and do not stop at " +
        "the first failure: Josh should see everything wrong with a draft at once. Checks already " +
        "judged are left out, so an interrupted run resumes rather than starting over.\n\n" +
        "THE POST APPEARS ONCE, as the top-level `body` field, and the source material once as " +
        "`source_entry`. Each check points at them rather than carrying its own copy. The library " +
        "is named by URI, not inlined — read the sections with get_library or resources/read. If " +
        "the response ends without brief_is_complete your client cut it: judge one check at a time " +
        "with check_key.",
      inputSchema: {
        draft_id: z.number().int().describe("Which draft to check, from list_drafts"),
        /*
         * One check at a time, for a client that cuts the response.
         *
         * The nine rubrics are ~700 characters each before anything is added to them, so no key
         * order fits them under a 2 KB preview. This is the only way a truncating client can read
         * a rubric in full, and it is also what a resumed run wants: the gate is nine independent
         * judgements and has never needed them in one response.
         */
        check_key: z.string().optional().describe(
          "Judge one check. Its rubric is returned in full with the post and, where the check is " +
          "allowed it, the source. Everything else is unchanged — the counts still report the " +
          "whole draft.",
        ),
        /*
         * The escape hatch, and the only way back to what shipped before 28 October: the post
         * inlined in all nine checks and the source in three of them. Measured on draft 90, that is
         * 58,418 characters of duplication in a 100,296-character response. It exists for the eval
         * harness, which compares against recorded prompts, and for a client that cannot read a
         * sibling field. Nothing on Josh's surface should ask for it.
         */
        bodies: z.enum(["once", "per_check"]).optional().describe(
          "Default \"once\": the post and the source are carried once at the top, each check " +
          "points at them, and the library is named by URI. \"per_check\" is the whole response " +
          "as it stood before 28 October — a copy in every check and the library pasted into " +
          "`system`. One switch, because a half-restored response is not what an eval compares.",
        ),
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
        // `reopened_at` for the same clearance rule as the drafting brief above. The gate judging a
        // name as cleared that the drafter was told not to use is the worst direction for these two
        // to disagree in: the draft is written clean and then failed for being clean.
        select: "id,title,audience,reopened_at",
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
        select: "name,kind,cleared,cleared_at",
        moment_id: `eq.${draft.moment_id}`,
      }))
        .filter((n) => n.kind !== "not_a_name" && isClearedNow(moment?.reopened_at, n))
        .map((n) => n.name);

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

      /*
       * WHAT HE ASKED FOR ON THIS POST, FOR THE CHECKS A REQUEST OF HIS CAN TRIP.
       *
       * GATE_SYSTEM tells the judge to name the collision when a post breaks a rule because Josh
       * asked for it — and until now the judge had no way to know he had. It could only fail the
       * draft with an ordinary verdict, which is what happened four times on moment 113, or invent
       * an attribution, which breaks the rule above it about quoting only what it can see.
       *
       * Same source as the drafting brief: his note lives in the draft job's payload and nowhere
       * else. Never allowed to fail the gate — a judge with no notes is the judge we had
       * yesterday, which is worse than this one but not broken.
       */
      const hisNotes = await (async () => {
        try {
          const rows = await db.select("jobs", {
            select: "payload",
            type: "eq.draft",
            "payload->>moment_id": `eq.${draft.moment_id}`,
            order: "id.desc",
            limit: 12,
          });
          return [...new Set(
            rows
              .flatMap((j) => (Array.isArray(j?.payload?.failures) ? j.payload.failures : []))
              .map((f) => joshNote(f))
              .filter(Boolean),
          )];
        } catch {
          return [];
        }
      })();

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

      /*
       * EVERYTHING ABOVE THIS LINE HAPPENS BEFORE ANYTHING IS MEASURED, AND THAT ORDER IS LOAD-BEARING.
       *
       * The insert is the one write a read tool makes, and the reason it is here is in the comment
       * above it: without it a draft sits permanently at eight of nine verdicts and cc-agent re-gates
       * it for ever. So it stays unconditional and stays FIRST. Assembly and measurement come after,
       * because a size refusal thrown during assembly would skip the write that stops the loop — and
       * the loop is more expensive than a long response.
       */
      const pointers = libraryPointers(library.rows, "gating");
      const once = (args.bodies ?? "once") === "once";

      /*
       * One check, when the caller asked for one. The counts below still describe the whole draft:
       * `checks_remaining` is how many are outstanding, not how many are in this response, because
       * a judge told "1 remaining" when nine are would stop after one.
       */
      const asked = args.check_key
        ? remaining.filter((c) => c.key === args.check_key)
        : remaining;
      const unknownCheck = args.check_key && asked.length === 0;

      // Whether the hoisted source is used by anything in THIS response. gateInputsFor still
      // decides, exactly as before — hoisting moves where the text sits, never who may see it.
      const anySeesSource = asked.some((c) => gateInputsFor(c.key).source) &&
        Object.keys(entry).length > 0;

      /*
       * The rubrics and the system prompt, built ONCE, for the reason the drafting brief gives: the
       * seal below calls its builder up to three times to settle the figure it quotes, and nine
       * rubrics is the most expensive thing in this handler.
       */
      const systemText = GATE_SYSTEM(once ? pointers.text : library.text);
      const checks = asked.map((check) => {
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
            hisNotes: sees.hisNotes && hisNotes.length > 0 ? hisNotes : undefined,
            bodyHoisted: once,
            entryHoisted: once,
          }),
        };
      });

      // 9b — each check is its own call with its own rubric. Run together in one prompt a model
      // averages across them and lets marginal work through, which is the exact failure acceptance
      // test 8 is built to catch.
      return seal((chars) => ({
        read_this_first: readThisFirst({
          chars,
          tool: "get_gate_brief",
          keys: pointers.sections.map((s) => s.key),
          recover: `call get_gate_brief again with check_key: "${
            (asked[0] ?? remaining[0])?.key ?? "anyone_else"
          }" and judge one check at a time`,
        }),
        draft_id: draft.id,
        name: moment?.title ?? null,
        prompt_version: PROMPT_VERSION,
        already_judged: [...done],
        not_judgeable: [...unjudgeable],
        checks_remaining: remaining.length,
        ...(args.check_key && { checks_in_this_response: asked.length }),
        ...(unknownCheck && {
          check_key_not_offered: `"${args.check_key}" is not a check awaiting a verdict on this ` +
            `draft. Outstanding: ${remaining.map((c) => c.key).join(", ") || "none"}.`,
        }),
        /*
         * THE POST, ONCE. Nine copies of one post is not nine inputs — it is one input billed nine
         * times, and on draft 90 it was 24,597 of the response's 100,296 characters. Each check's
         * text now names this field instead of repeating it.
         */
        ...(once && { body: draft.body }),
        ...(once && anySeesSource && {
          /*
           * THE SOURCE, ONCE, AND IT IS THE BIGGEST SAVING HERE. moment 111's entry is 11,307
           * characters and three checks are allowed it — 22,614 characters of duplication. Which
           * three is still CHECK_SEES_SOURCE's decision and nothing else's: each check's own `sees`
           * array below says whether it was told this field exists, so hoisting cannot quietly
           * widen the filter.
           */
          source_entry: entry,
        }),
        library_pointers: {
          view: "gating",
          read_with: [
            `get_library with key: "<key>" — an ordinary tool call, always available`,
            "resources/read on the URI, if your client exposes MCP resources",
          ],
          sections: pointers.sections,
          ...(pointers.absent.length > 0 && { allowed_but_missing: pointers.absent }),
          // The view split, said as a list rather than left implicit in 29 KB of prose. The gate
          // may not read reference_posts or voice_transcript; a judge that has read another
          // writer's posts starts measuring against their voice rather than Josh's.
          note: "These are the only sections the gate may read. reference_posts and " +
            "voice_transcript are deliberately not among them — see views.ts.",
        },
        system: systemText,
        // Each check is shown the post, and nothing else unless its rubric cannot be answered
        // without it. This filter is the whole point of gateInputsFor: it was applied on the
        // server path and NOT here, and this is the path that actually runs, so five of the eight
        // checks were reading his private notes. That is his "it fails drafts for things that
        // aren't in them", and it had survived one fix because that fix was prompt wording.
        checks,
        note: unjudgeable.size > 0
          ? [...unjudgeable].join(", ") + " is not in this list: the library section it judges " +
            "against is empty, so it is recorded as NOT JUDGED rather than passed on no evidence."
          : undefined,
        next: remaining.length > 0
          ? "Read the library sections named above, judge each check on its own, and call " +
            "record_gate_verdict once per check. When unsure, fail it."
          : "Every check already has a verdict. Nothing to do.",
      }));
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
