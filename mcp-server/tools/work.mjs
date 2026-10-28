/**
 * One tool that hands over a complete unit of writing work.
 *
 * WHO DOES WHAT, NOW
 *
 * Drafts are written in Claude. The server does not write them any more — worker-dispatch leaves
 * `draft` jobs pending — but it still judges every draft, running the checks by itself the
 * moment one is filed. So the work this tool hands out is writing, and only writing.
 *
 * It used to hand out gating first, on the grounds that a half-judged draft blocks everything
 * downstream. That was right when the server did not gate Claude's drafts. It does now, and offering
 * the same checks here would judge each draft twice, with two sets of verdicts on one row.
 *
 * WHERE THE WORK COMES FROM
 *
 * The pending `draft` jobs. Every route that decides something should be written ends in one:
 * selection choosing an idea, the gate rejecting a draft, Josh pushing back from Telegram. Each job
 * carries what a rewrite needs — the previous body, the reasons it failed, his note — so reading the
 * queue rather than scanning idea statuses is what keeps that context attached to the work.
 *
 * Scanning statuses was also wrong on its own terms: selection moves an idea from `mined` to
 * `queued`, so a tool that only looked for `mined` could never see the ideas selection had actually
 * chosen.
 *
 * WHAT IT STILL CANNOT DO
 *
 * Start on its own. An MCP server only responds; something has to ask. That something is a person
 * in Claude saying "do the next piece of work".
 */

import { GATE_CHECKS } from "../../supabase/functions/_shared/prompts.ts";
import { z } from "zod";

import { tools } from "./index.mjs";
import { oneStepMode } from "../mode.mjs";
// Imported straight from brief.mjs rather than reached through the registry: brief.mjs does not
// import this file, so there is no cycle, and these two are plain functions rather than tools.
import { carriedBrief, seal } from "./brief.mjs";

/** Run another registered tool's handler. Keeps one implementation of every brief. */
async function viaTool(name, args, context) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return await tool.handler(args, context);
}

export const workTools = [
  {
    name: "next_work",
    config: {
      title: "Get the next draft to write, with its brief",
      description:
        "Returns the next idea waiting to be written — first drafts and rewrites alike — WITH the " +
        "brief needed to write it, in one call. A rewrite comes with what the last draft said and " +
        "why it was rejected or what Josh asked to change. Write it, file it with create_draft, " +
        "then ask again. The server runs the quality checks on its own after filing; do not " +
        "run them here.",
      inputSchema: {},
    },

    async handler(_args, context) {
      const { db } = context;

      /*
       * IN ONE-STEP MODE THERE IS NO QUEUE TO READ.
       *
       * This is the tool `/write` calls, and in one-step mode it must offer nothing rather than
       * offer something old. `worker-select` has already stopped filling the queue, so what is left
       * in it is whatever was pending when the mode went on — exactly the rows that produced a
       * draft about moment 68 while the idea he had just captured sat untouched.
       *
       * Before any read, so nothing is claimed, consumed or marked in passing. A pending job stays
       * pending and is waiting unchanged when the mode goes back off.
       *
       * The ungated-draft branch goes with it: in one-step mode the gate is driven straight from
       * the reply `create_draft` just returned, on that draft, rather than discovered later by
       * asking the queue what is outstanding.
       */
      if (await oneStepMode(db)) {
        /*
         * Still says what is waiting on him, because "there is no queue" and "four posts need your
         * decision" are different facts in this mode too — and the second is the one he would want
         * to hear. The drafts count is read; nothing in the idea bank is offered or touched.
         */
        const awaitingHim = await db.select("posts", {
          select: "id",
          status: "eq.draft",
          limit: 100,
        });

        return {
          work: "none",
          mode: "one_step",
          why: "One-step mode is on, so nothing is pulled from the idea bank. Ask him what he " +
            "wants written, or use what he just said, and call start_post with his words.",
          waiting_on_josh: {
            ideas_needing_answers: 0,
            drafts_with_the_gate_or_for_review: awaitingHim.length,
          },
          to_change_it: "set_writing_mode, and only if he asks for it.",
        };
      }

      /*
       * JUDGING COMES BEFORE WRITING.
       *
       * A filed draft that nobody has judged blocks its own idea: it cannot be approved, and it
       * cannot be rewritten until the checks say what is wrong with it. The server used to run the
       * gate itself on whatever free tier was configured, which on 5 October rejected a real post
       * for a phrase that was not in it. With `gate_runs_in_claude` on, the draft waits here instead
       * — for the strong model that is already writing them.
       */
      const ungated = await db.select("drafts", {
        select: "id,moment_id,created_at,gate_passed",
        gate_passed: "is.null",
        order: "id.asc",
        limit: 20,
      });

      for (const draft of ungated) {
        const [moment] = await db.select("moments", {
          select: "id,title,status,killed",
          id: `eq.${draft.moment_id}`,
          limit: 1,
        });
        if (!moment || moment.killed || moment.status === "parked") continue;

        // A draft part-way through the checks is still this job; one already finished is not.
        const verdicts = await db.select("gate_runs", {
          select: "check_key",
          draft_id: `eq.${draft.id}`,
        });
        const judged = new Set(verdicts.map((v) => v.check_key));
        // GATE_CHECKS.length, not 8. A ninth check was added on 14 Oct and a draft counted as
        // fully judged at eight would have been skipped here with shape never run on it.
        if (judged.size >= GATE_CHECKS.length) continue;

        const brief = await viaTool("get_gate_brief", { draft_id: draft.id }, context);
        /*
         * This response is the gate brief plus a wrapper, so it is the brief's size problem with a
         * wrapper on it: before 28 October that was over 100,000 characters on draft 90, against a
         * client that previews ~2 KB. The brief is pointerised now; the wrapper has to keep the same
         * discipline or it reintroduces the defect one layer out — the first key says how to recover
         * and the last key is the marker whose absence means "cut".
         */
        const carried = carriedBrief(brief, {
          tool: "next_work",
          recover: `call get_gate_brief with draft_id ${draft.id} and check_key, one check at a time`,
        });
        return seal((chars) => ({
          read_this_first: carried.firstKey(chars),
          work: "gate",
          draft_id: draft.id,
          moment_id: draft.moment_id,
          name: moment.title ?? null,
          checks_already_judged: [...judged],
          how: [
            "Judge each remaining check on its own rubric alone. Do not average across them, and do " +
              "not let a verdict on one influence another.",
            "Judge the POST. The material is context; a failure has to be something a reader would " +
              "see, and your reason must quote it from the post.",
            "The post is the brief's `body` field, once, and the source its `source_entry` field. " +
              "A check that names them is pointing at those fields, not asking you to find them.",
            "Read the library sections the brief names by URI before judging — get_library with the " +
              "key, or resources/read on library://<key>. A verdict reached without them is a " +
              "verdict against your own taste.",
            "Be adversarial — if you are genuinely unsure, that is a fail.",
            "Call record_gate_verdict once per check, naming the sentence rather than the rule.",
          ],
          then: "Run every check even after one fails: he should see everything wrong at once. The " +
            "server files the result and, if it was rejected, offers the rewrite here next.",
          brief: carried.brief,
        }));
      }

      // Oldest first. A rewrite Josh asked for yesterday should not wait behind a first draft that
      // arrived this morning.
      const jobs = await db.select("jobs", {
        select: "id,payload,created_at",
        type: "eq.draft",
        status: "eq.pending",
        order: "id.asc",
        limit: 50,
      });

      // One job per idea. Two pending jobs on the same idea — a gate retry landing next to a
      // pushback — are one piece of writing, answered by one draft.
      const seen = new Set();
      const queue = [];
      for (const j of jobs) {
        const momentId = Number(j.payload?.moment_id);
        if (!Number.isInteger(momentId) || seen.has(momentId)) continue;
        seen.add(momentId);
        queue.push({ job: j, momentId });
      }

      for (const { job, momentId } of queue) {
        const [moment] = await db.select("moments", {
          select: "id,title,status,killed",
          id: `eq.${momentId}`,
          limit: 1,
        });
        // A killed or parked idea can still have a job waiting from before. Skipping it here is
        // the difference between offering work and offering something Josh already said no to.
        if (!moment || moment.killed || moment.status === "parked") continue;

        const brief = await viaTool("get_drafting_brief", { moment_id: momentId }, context);
        const failures = Array.isArray(job.payload?.failures) ? job.payload.failures : [];
        const isRewrite = Boolean(job.payload?.previous_body) || failures.length > 0;

        // Same discipline as the gate branch above, and for the same measured reason.
        const carried = carriedBrief(brief, {
          tool: "next_work",
          recover: `call get_drafting_brief with moment_id ${momentId} and part: "material"`,
        });
        return seal((chars) => ({
          read_this_first: carried.firstKey(chars),
          work: isRewrite ? "rewrite" : "draft",
          moment_id: momentId,
          name: moment.title ?? null,
          attempt: Number(job.payload?.attempt ?? 1),
          also_waiting: queue.length - 1,
          ...(isRewrite
            ? {
              rewrite: {
                previous_body: job.payload?.previous_body ?? null,
                // Josh's pushback arrives as a failure beginning "Josh's note on the previous
                // version:". It is the most important line here and is listed with the rest so
                // nothing has to be reassembled.
                what_to_fix: failures,
                near_miss: job.payload?.near_miss ?? null,
              },
            }
            : {}),
          how: [
            "Write from the brief only: the idea's material and the library. Nothing else.",
            /*
             * THE LIBRARY IS NAMED, NOT PASTED. This used to be satisfied by reading the brief's
             * `system` text, which carried all eleven sections. It carries their addresses now, so
             * "write from the brief" has to say out loud that the addresses have to be followed —
             * otherwise it reads as permission to write from an index, which is writing against no
             * standard while believing otherwise.
             */
            "The brief's `library_pointers` names each section and its library:// URI. Read every " +
              "one that is not a placeholder BEFORE writing — get_library with the key, or " +
              "resources/read on the URI. The gate judges the draft against those sections.",
            "Missing detail stays missing. Write around a gap; never fill one.",
            ...(isRewrite
              ? ["This is a rewrite. Fix exactly what_to_fix names — do not write a different post."]
              : []),
            "Call measure_draft and scrub_draft before filing. Both are free and catch what the " +
              "checks would otherwise reject.",
            "File it with create_draft, every claim carrying the verbatim span it rests on.",
          ],
          then: "Call next_work again. The server gates what you filed; if it is rejected it comes " +
            "back here with the reasons.",
          brief: carried.brief,
        }));
      }

      // Nothing queued. Said with the reason, because "nothing to do" and "everything is waiting on
      // a person" are different facts and only one of them is good news.
      const [halfMined, captured, drafted, parked] = await Promise.all([
        db.select("moments", { select: "id", status: "eq.half_mined", killed: "is.false" }),
        db.select("moments", { select: "id", status: "eq.captured", killed: "is.false" }),
        db.select("moments", { select: "id", status: "eq.drafted", killed: "is.false" }),
        // Parked ideas are skipped silently in both loops above, which is right — Josh has not asked
        // for them. But "nothing to write" and "three ideas went quiet after three failures each"
        // read identically from here, and only one of them is a reason to look at the gate.
        db.select("moments", {
          select: "id,title,parked_reason",
          status: "eq.parked",
          killed: "is.false",
          order: "id.desc",
          limit: 5,
        }),
      ]);

      return {
        work: "none",
        why: halfMined.length > 0 || captured.length > 0
          ? `Nothing is waiting to be written. ${halfMined.length + captured.length} idea(s) still ` +
            `need Josh's answers before they can be drafted (4.3.3) — run their interviews with ` +
            `next_interview_question.`
          : "Nothing is waiting to be written, and no idea is waiting on an interview.",
        waiting_on_josh: {
          ideas_needing_answers: halfMined.length + captured.length,
          drafts_with_the_gate_or_for_review: drafted.length,
        },
        ...(parked.length > 0 && {
          parked: {
            count: parked.length,
            ideas: parked.map((m) => ({ moment_id: m.id, name: m.title ?? null, why: m.parked_reason })),
            means: "These are not offered as work and are not gone. An idea parks after three " +
              "rejected drafts (9.8) or when the material would not carry a post. reopen_idea " +
              "brings one back with its material intact, ready to draft.",
          },
        }),
      };
    },
  },
];
