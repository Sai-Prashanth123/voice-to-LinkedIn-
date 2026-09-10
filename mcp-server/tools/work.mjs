/**
 * One tool that hands over a complete unit of work.
 *
 * WHY THIS EXISTS WHEN cc-agent/work.mjs ALREADY DOES IT
 *
 * work.mjs decides what to work on, spawns `claude --print`, and lets the run post back through
 * this server. That is a scheduler's shape: it needs Node, the repository, a shell and something to
 * start it. On a machine with none of those — a browser, a phone, a client that only speaks MCP —
 * there was no way to do a piece of work at all.
 *
 * This is the same decision, as a tool. Ask for the next piece of work and you get the item AND the
 * brief for it in one answer, so a single sentence in any client drives the whole loop.
 *
 * WHAT IT STILL CANNOT DO
 *
 * Start on its own. An MCP server only ever responds; it has no loop and no timer, and over the
 * stateless HTTP transport it cannot even push a notification. Something has to ask. If that
 * something is a person typing "do the next piece of work", this is the whole mechanism. If it has
 * to happen at 09:15 with nobody there, that is cc-agent/install.mjs and always will be.
 *
 * THE ORDER, AND WHY GATING COMES FIRST
 *
 * The same order work.mjs uses, for the same reason: a draft stuck at six of eight checks is the
 * cheapest work available and it is BLOCKING — nothing downstream of it can happen. Writing a new
 * draft while an old one sits unjudged adds to the pile rather than clearing it.
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
      title: "Get the next piece of work, with its brief",
      description:
        "Finds the highest-value unfinished item and returns it WITH the brief needed to do it, " +
        "in one call. Gating comes before drafting because a half-judged draft blocks everything " +
        "downstream of it. Do the work, call the tool it names, then ask again. This is how the " +
        "whole pipeline runs from a client with no repository, no shell and no scheduler.",
      inputSchema: {
        kind: z.enum(["gate", "draft"]).optional()
          .describe("Force a kind rather than taking the highest-value item"),
      },
    },

    async handler(args, context) {
      const { db } = context;

      // ── What is waiting ──────────────────────────────────────────────────────────────────────
      //
      // DISTINCT CHECKS, not rows. handlers/draft.ts once wrote one gate_runs row per failed claim,
      // so a draft could carry eight rows across six judged checks and read as finished to anything
      // counting rows. cc-agent/work.mjs had this bug too.
      const [drafts, runs, mined] = await Promise.all([
        db.select("drafts", {
          select: "id,moment_id,framework,model,created_at",
          order: "id.desc",
          limit: 50,
          /*
           * ACCEPTANCE FIXTURES ARE NOT WORK.
           *
           * Component test 8 seeds twenty deliberately generic drafts to prove the gate rejects
           * them, and they sit in the production table because 6.3 forbids removing anything. The
           * first version of this tool offered draft 27 — "Every B2B company is adding AI to their
           * pitch right now" — as the next thing to gate.
           *
           * Judging one by hand would not merely waste a run: test 8 measures how many of those
           * fixtures the gate rejected, so adding verdicts of my own changes the number a
           * component test reports. A tool that hands somebody work which corrupts a passing test
           * is worse than one that hands over nothing.
           *
           * Same exclusion scripts/smoke.mjs uses, and the same label create_draft refuses.
           */
          framework: "neq.acceptance-fixture",
        }),
        db.select("gate_runs", { select: "draft_id,check_key" }),
        db.select("moments", {
          select: "id,ref,status",
          status: "eq.mined",
          killed: "is.false",
          order: "id.asc",
        }),
      ]);

      const judged = new Map();
      for (const r of runs) {
        if (!judged.has(r.draft_id)) judged.set(r.draft_id, new Set());
        judged.get(r.draft_id).add(r.check_key);
      }
      const checksOn = (id) => judged.get(id)?.size ?? 0;

      const toGate = drafts.filter((d) => checksOn(d.id) < 8);
      const drafted = new Set(drafts.map((d) => d.moment_id));
      const toDraft = mined.filter((m) => !drafted.has(m.id));

      const wanted = args.kind;

      // ── Gating ───────────────────────────────────────────────────────────────────────────────
      if (toGate.length > 0 && wanted !== "draft") {
        const d = toGate[0];
        const brief = await viaTool("get_gate_brief", { draft_id: d.id }, context);

        return {
          work: "gate",
          draft_id: d.id,
          moment_id: d.moment_id,
          progress: `${checksOn(d.id)} of 8 checks judged`,
          also_waiting: {
            drafts_to_gate: toGate.length - 1,
            moments_to_draft: toDraft.length,
          },
          brief,
          how: [
            "Judge each remaining check against its own rubric alone. Do not average across them.",
            "Be adversarial: find the failure. If you are genuinely unsure, that is a FAIL.",
            "Call record_gate_verdict once per check, naming the sentence rather than the rule.",
            "Run every check even after one fails — Josh should see everything wrong at once.",
          ],
          then: "Call next_work again.",
        };
      }

      // ── Drafting ─────────────────────────────────────────────────────────────────────────────
      if (toDraft.length > 0 && wanted !== "gate") {
        const m = toDraft[0];
        const brief = await viaTool("get_drafting_brief", { moment_id: m.id }, context);

        return {
          work: "draft",
          moment_id: m.id,
          moment_ref: m.ref,
          also_waiting: {
            drafts_to_gate: toGate.length,
            moments_to_draft: toDraft.length - 1,
          },
          brief,
          how: [
            "Follow the brief exactly. You have two sources: the moment's material and the library.",
            "Missing detail stays missing. Write around a gap; never fill one.",
            "Call measure_draft before create_draft — it costs nothing and catches the mechanical " +
              "faults that otherwise take a whole gate run to find.",
            "Then call scrub_draft and rewrite what it finds. It runs every AI-tell rule line by " +
              "line, which is the one thing a model cannot do to its own output: reading a draft " +
              "back, it will tell you it checked and it will be wrong. Rewrite in his voice — the " +
              "tool hands you the voice guide alongside the findings for exactly that reason.",
            "Finish with create_draft, every claim carrying the verbatim span it rests on.",
          ],
          then: "Call next_work again — the draft you just wrote will come back to be gated.",
        };
      }

      // ── Nothing ──────────────────────────────────────────────────────────────────────────────
      //
      // Said with the reason, because "nothing to do" and "everything is blocked on a person" are
      // different facts and only one of them is good news.
      const [halfMined, captured] = await Promise.all([
        db.select("moments", {
          select: "id",
          status: "eq.half_mined",
          killed: "is.false",
        }),
        db.select("moments", { select: "id", status: "eq.captured", killed: "is.false" }),
      ]);

      return {
        work: "none",
        why: halfMined.length > 0 || captured.length > 0
          ? `Nothing can be written yet. ${halfMined.length} candidate(s) need Josh interviewed ` +
            `before they can be drafted (4.3.3), and ${captured.length} input(s) are still being ` +
            `asked about. A moment must reach 'mined' before anything downstream is possible.`
          : "Every draft is fully judged and every mined moment has a draft. The bank is empty of " +
            "work — send something in.",
        waiting_on_josh: {
          candidates_needing_an_interview: halfMined.length,
          inputs_still_being_asked_about: captured.length,
        },
        note: "This tool covers drafting and gating, which have unambiguous ready-states. " +
          "Extraction and triage are available as submit_extraction and submit_candidates, but " +
          "WHEN to run them is a judgement rather than a queue state — the interviewer decides it " +
          "has enough, and worker-dispatch claims that job within a minute.",
      };
    },
  },
];
