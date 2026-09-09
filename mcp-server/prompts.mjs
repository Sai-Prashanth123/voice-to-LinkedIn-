/**
 * The five workflows, as MCP prompts.
 *
 * WHY THIS IS WORTH HAVING
 *
 * `draft-post` and `gate-check` already exist as Claude Code skill files. Those only work in Claude
 * Code. Registered here they become slash commands in ANY client — including the connector on
 * claude.ai — and a person who has never seen this repository can run the same workflow with the
 * same standard.
 *
 * THIN BY DEFAULT, FULL WITH inline: "true"
 *
 * Thin returns a short instruction naming the brief tool and the finishing tool. That is right for
 * a client with a tool-calling loop: it fetches the brief itself, sees the current library, and the
 * standard is never copied anywhere.
 *
 * Inline calls the SAME brief handler the tool calls and returns its text as the message. That is
 * for a client without a loop, or a person who wants to read the standard before writing. Either
 * way the words come from prompts.ts through brief.mjs — never from a copy kept here, which is the
 * whole reason the skill files are thin too.
 *
 * ARGUMENTS ARE STRINGS
 *
 * MCP sends prompt arguments as strings, always. `inline` is compared against "true" rather than
 * treated as a boolean, and ids are parsed. A z.boolean() here would arrive as the string "true"
 * and be truthy either way, including when it said "false".
 */

import { z } from "zod";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

import { tools } from "./tools/index.mjs";

/** Run a registered tool's handler directly. The prompt and the tool cannot diverge this way. */
async function viaTool(name, args, context) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return await tool.handler(args, context);
}

const isInline = (v) => String(v ?? "").toLowerCase() === "true";

const text = (s) => ({ messages: [{ role: "user", content: { type: "text", text: s } }] });

/**
 * Autocomplete for an id argument.
 *
 * Without this a prompt cannot be used without first looking an id up with a different tool, which
 * is most of the friction in using one at all.
 */
function completableId(context, load, description) {
  // THE DESCRIPTION GOES INSIDE, NOT AFTER.
  //
  // `completable(...).describe(...)` looks equivalent and is not: Zod's .describe() returns a NEW
  // schema, which does not carry the COMPLETABLE_SYMBOL the SDK looks for. Written that way the
  // completions simply never appear, with no error anywhere — isCompletable() returns false and
  // the client is told there is nothing to complete. Caught by asserting isCompletable rather than
  // by anything going wrong.
  return completable(z.string().describe(description), async (value) => {
    try {
      const options = await load(context);
      const typed = String(value ?? "").toLowerCase();
      return options
        .filter((o) => !typed || o.toLowerCase().includes(typed))
        .slice(0, 20);
    } catch {
      // A failed lookup must not break the prompt — it degrades to typing the id by hand.
      return [];
    }
  });
}

async function momentOptions({ db }) {
  const rows = await db.select("moments", {
    select: "id,ref,status,notes",
    killed: "is.false",
    order: "id.desc",
    limit: 40,
  });
  return rows.map((m) =>
    `${m.id} · ${m.ref} · ${m.status}${m.notes ? ` · ${String(m.notes).split("\n")[0].slice(0, 50)}` : ""}`
  );
}

async function draftOptions({ db }) {
  const rows = await db.select("drafts", {
    select: "id,moment_id,framework,created_at",
    order: "id.desc",
    limit: 40,
  });
  return rows.map((d) => `${d.id} · moment ${d.moment_id} · ${d.framework ?? "no framework"}`);
}

/** The leading integer of a completion string, so "26 · M-000024 · mined" resolves to 26. */
const idOf = (v) => {
  const n = Number(String(v ?? "").trim().split(/[^0-9]/)[0]);
  if (!Number.isInteger(n)) throw new Error(`"${v}" does not start with an id`);
  return n;
};

export function promptsFor(context) {
  return [
    {
      name: "draft-post",
      config: {
        title: "Write a post from a moment",
        description:
          "Write a LinkedIn post for Josh from one moment in the idea bank, against the live " +
          "drafting standard. Add inline: true to receive the whole brief in the message.",
        argsSchema: {
          moment_id: completableId(context, momentOptions, "Which moment to write from"),
          inline: z.string().optional()
            .describe('"true" to embed the full brief rather than naming the tool to call'),
        },
      },
      async cb({ moment_id, inline }) {
        const id = idOf(moment_id);

        if (!isInline(inline)) {
          return text(
            `Write a LinkedIn post for Josh from moment ${id}.\n\n` +
            `Call get_drafting_brief with moment_id ${id} first and follow it exactly — the ` +
            `standard is there, not in this message, and it changes whenever Josh edits his ` +
            `library.\n\n` +
            `Then call measure_draft on what you have written: it costs nothing and catches the ` +
            `mechanical faults that otherwise take a whole gate run to find.\n\n` +
            `Finish with create_draft, including every factual claim and the verbatim span of the ` +
            `material it rests on. A claim you cannot point at is one you must not make.`,
          );
        }

        const brief = await viaTool("get_drafting_brief", { moment_id: id }, context);
        return text(
          `${brief.system}\n\n---\n\n${brief.user}\n\n---\n\n` +
          `Names that must not appear: ${brief.must_not_name.length ? brief.must_not_name.join(", ") : "none"}.\n\n` +
          `When the post is written, call measure_draft on it, then create_draft with the full ` +
          `claim ledger.`,
        );
      },
    },

    {
      name: "gate-check",
      config: {
        title: "Judge a draft against the eight checks",
        description:
          "Run the quality gate on one draft. Eight independent judgements; be adversarial, and " +
          "when unsure, fail it. Add inline: true to receive every rubric in the message.",
        argsSchema: {
          draft_id: completableId(context, draftOptions, "Which draft to judge"),
          inline: z.string().optional().describe('"true" to embed the rubrics'),
        },
      },
      async cb({ draft_id, inline }) {
        const id = idOf(draft_id);

        if (!isInline(inline)) {
          return text(
            `Run the gate on draft ${id}.\n\n` +
            `Call get_gate_brief with draft_id ${id}. Judge each remaining check on its own rubric ` +
            `alone — do not average across them, and do not let a verdict on one influence another.\n\n` +
            `Be adversarial: your job is to find the failure, not to be fair to the post. If you ` +
            `are genuinely unsure, that is a FAIL.\n\n` +
            `Call record_gate_verdict once per check, naming the sentence rather than the rule. ` +
            `Run every check even after one fails — Josh should see everything wrong at once.`,
          );
        }

        const brief = await viaTool("get_gate_brief", { draft_id: id }, context);
        const checks = (brief.checks ?? [])
          .map((c) => `### ${c.check_key}\n\n${c.user}`)
          .join("\n\n---\n\n");

        return text(
          `${brief.system}\n\n---\n\n${checks}\n\n---\n\n` +
          `Record each with record_gate_verdict, one call per check. A verdict is written once and ` +
          `cannot be overwritten.`,
        );
      },
    },

    {
      name: "extract-interview",
      config: {
        title: "Turn a finished interview into idea bank material",
        description:
          "Record what one interview produced. Every field becomes the source of truth a later " +
          "draft is checked against, so leaving a field empty is always allowed and is correct " +
          "whenever Josh did not say it.",
        argsSchema: {
          moment_id: completableId(context, momentOptions, "Whose interview to record"),
          inline: z.string().optional().describe('"true" to embed the standard and the transcript'),
        },
      },
      async cb({ moment_id, inline }) {
        const id = idOf(moment_id);

        if (!isInline(inline)) {
          return text(
            `Record what the interview on moment ${id} produced.\n\n` +
            `Call get_extraction_brief with moment_id ${id} and follow it exactly.\n\n` +
            `Leave a field EMPTY rather than filling it with something reasonable. The quote, the ` +
            `numbers and the names are checked against what Josh actually said before anything is ` +
            `written, and a paraphrased quote is refused.\n\n` +
            `Finish with submit_extraction.`,
          );
        }

        const brief = await viaTool("get_extraction_brief", { moment_id: id }, context);
        return text(
          `${brief.system}\n\n---\n\nWHAT JOSH SENT:\n\n${brief.what_josh_sent}\n\n` +
          `THE CONVERSATION:\n\n${brief.the_conversation}\n\n---\n\n` +
          `Checked mechanically before anything is stored:\n` +
          brief.will_be_checked_mechanically.map((c) => `  · ${c}`).join("\n") +
          `\n\nFinish with submit_extraction.`,
        );
      },
    },

    {
      name: "triage-source",
      config: {
        title: "Find what is worth asking Josh about",
        description:
          "Surface candidates from a call, session or thread. An empty result is the expected " +
          "outcome most of the time and is never a failed run.",
        argsSchema: {
          source: z.string().describe("claude_code, call_transcript or slack"),
          inline: z.string().optional().describe('"true" to embed the standard'),
        },
      },
      async cb({ source, inline }) {
        const s = String(source ?? "").trim();

        if (!isInline(inline)) {
          return text(
            `Find what is worth asking Josh about, from ${s}.\n\n` +
            `Call get_triage_brief with source "${s}" and apply its bar exactly.\n\n` +
            `Most material produces NOTHING and that is the intended result — a version surfacing ` +
            `ten candidates a day is worse than none, because he stops reading them.\n\n` +
            `Finish with submit_candidates. An empty list is a correct answer.`,
          );
        }

        const brief = await viaTool("get_triage_brief", { source: s }, context);
        return text(
          `${brief.system}\n\n---\n\nThe bar:\n` +
          brief.the_bar.map((b) => `  · ${b}`).join("\n") +
          `\n\n${brief.note}\n\nFinish with submit_candidates.`,
        );
      },
    },

    {
      name: "propose-learning",
      config: {
        title: "Propose an evidenced change to the library",
        description:
          "Look across what posts did and propose specific, evidenced changes. If the evidence is " +
          "thin, propose nothing — a quiet month is an honest outcome.",
        argsSchema: {
          inline: z.string().optional().describe('"true" to embed the standard'),
        },
      },
      async cb({ inline }) {
        if (!isInline(inline)) {
          return text(
            `Propose evidenced changes to Josh's reference library.\n\n` +
            `Call get_learning_brief and follow it exactly. Gather evidence with the read tools it ` +
            `names, then call propose_library_change once per proposal, each citing specific posts ` +
            `or drafts by id.\n\n` +
            `If the evidence does not support a change, propose nothing and say so plainly. That ` +
            `is a correct outcome, not a failed run.`,
          );
        }

        const brief = await viaTool("get_learning_brief", {}, context);
        return text(
          `${brief.system}\n\n---\n\n${brief.evidence_available}\n\n` +
          `Gather the evidence with:\n` +
          brief.gather_evidence_with.map((g) => `  · ${g}`).join("\n") +
          `\n\nAlready decided — do not raise a settled question again:\n` +
          (brief.already_decided.length
            ? brief.already_decided.map((d) => `  · [${d.status}] ${d.section_key}: ${d.claim}`).join("\n")
            : "  (nothing decided yet)") +
          `\n\n${brief.next}`,
        );
      },
    },
  ];
}
