/**
 * One tool that hands over a complete unit of writing work.
 *
 * WHO DOES WHAT, NOW
 *
 * Drafts are written in Claude. The server does not write them any more — worker-dispatch leaves
 * `draft` jobs pending — but it still judges every draft, running the eight checks by itself the
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

import { z } from "zod";

import { tools } from "./index.mjs";

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
        "then ask again. The server runs the eight quality checks on its own after filing; do not " +
        "run them here.",
      inputSchema: {},
    },

    async handler(_args, context) {
      const { db } = context;

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

        // Nothing is written from an idea its owner has not named (migration 0037). Offered as the
        // work instead, because the draft cannot be filed until it is done.
        if (!moment.title) {
          return {
            work: "name",
            moment_id: momentId,
            also_waiting: queue.length - 1,
            gist: await ideaGist(db, momentId),
            how: [
              "This idea is ready to write but has no name. Show them what it is about (gist) and ask " +
                "what they want to call it.",
              "Call name_idea with exactly what they say. Never make a name up.",
            ],
            then: "Call next_work again; the draft is offered once it is named.",
          };
        }

        const brief = await viaTool("get_drafting_brief", { moment_id: momentId }, context);
        const failures = Array.isArray(job.payload?.failures) ? job.payload.failures : [];
        const isRewrite = Boolean(job.payload?.previous_body) || failures.length > 0;

        return {
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
          brief,
          how: [
            "Write from the brief only: the idea's material and the library. Nothing else.",
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
        };
      }

      // Nothing queued. Said with the reason, because "nothing to do" and "everything is waiting on
      // a person" are different facts and only one of them is good news.
      const [halfMined, captured, drafted] = await Promise.all([
        db.select("moments", { select: "id", status: "eq.half_mined", killed: "is.false" }),
        db.select("moments", { select: "id", status: "eq.captured", killed: "is.false" }),
        db.select("moments", { select: "id", status: "eq.drafted", killed: "is.false" }),
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
      };
    },
  },
];

/** What an unnamed idea is about, in their own first words, so they know which one they are naming. */
async function ideaGist(db, momentId) {
  const [raw] = await db.select("raw_inputs", {
    select: "text_body,transcript",
    moment_id: `eq.${momentId}`,
    order: "id.asc",
    limit: 1,
  });
  const said = String(raw?.text_body ?? raw?.transcript ?? "").trim();
  if (said && !said.startsWith("(")) return said.slice(0, 220);
  const [material] = await db.select("material", { select: "the_moment", moment_id: `eq.${momentId}`, limit: 1 });
  return String(material?.the_moment ?? "").slice(0, 220);
}
