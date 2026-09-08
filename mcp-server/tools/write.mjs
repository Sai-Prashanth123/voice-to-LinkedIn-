/**
 * Write tools — task 1.3.
 *
 * WHAT THESE CAN AND CANNOT DO
 *
 * Three verbs: add a draft, record a check result, propose a library change. Nothing here can
 * publish, approve, schedule, edit the library directly, or remove anything. That is not a policy
 * this file follows — it is the whole set of grants the role has (migration 0028), so a bug here
 * fails with a permission error rather than doing damage.
 *
 * The worst outcome available to a confused model is a draft nobody asked for, which Josh declines
 * exactly as he would any other draft.
 *
 * WHY create_draft COMPUTES SO MUCH ITSELF
 *
 * `version`, `attempt` and `library_version` are NOT NULL, and every one of them is a fact about
 * the system rather than a judgement the writer should be making. Asking a model to supply them
 * invites it to guess, and a wrong library_version would attribute a draft to a standard it was
 * never written against — which is exactly the sort of quiet wrongness clause 8.4 exists to stop.
 * So they are read from the database at insert time and the model is not offered the choice.
 *
 * WHY create_draft NOW VERIFIES THE LEDGER ITSELF
 *
 * This tool's description has always said the system "verifies these mechanically before any model
 * gives an opinion, so an unsupported claim is caught whether or not the gate would have noticed".
 * Until 8 September that sentence was false. `verifyDraft` was never called on this path, the
 * ledger was stored in a shape it could not read, and `claims_verified` was left null on every
 * draft Claude Code wrote — 2 of 2, against 19 of 19 checked on the edge-function path.
 *
 * Nothing read the column, so nothing ever contradicted the promise. Clause 9.4 is the one rule the
 * build allows zero tolerance on at acceptance, and on this path it was enforced only by whichever
 * model happened to be writing being careful — which is exactly the guarantee the ledger exists to
 * replace.
 *
 * WHY THIS REFUSES WHERE THE EDGE FUNCTION STORES
 *
 * handlers/draft.ts keeps a draft that fails verification, records a failed `claims_trace` and
 * retries (9.8). That is right for a worker: there is no one to tell, and attempt two needs to see
 * attempt one.
 *
 * Here the caller is an agent that can fix the ledger and call again in the same breath, so the
 * draft is refused and the failures come back as the error. The reasoning is the one at the top of
 * this file: the worst outcome available to a confused model should be a draft nobody asked for,
 * and an unverifiable draft is worse than none.
 */

import { z } from "zod";

import { verifyDraft } from "../../supabase/functions/_shared/claims.ts";
import { SOURCE_FIELDS, sourceEntry } from "../../supabase/functions/_shared/entry.ts";

/**
 * THE LEDGER SHAPE, WHICH IS NOT NEGOTIABLE AND USED TO BE
 *
 * This was `{ kind, text, source }` — three keys chosen here, in isolation, that happened to be the
 * obvious names. `verifyDraft` reads `claim`, `source_field` and `source_span`. Neither side was
 * wrong on its own and nothing ever compared them, so every draft written through Claude Code
 * stored a ledger that the verifier could not read a single field of.
 *
 * `source_field` is the key that was missing rather than merely misnamed. Verification pins a span
 * to ONE named field, so that a claim cannot cite a true sentence from an unrelated part of the
 * entry and pass. With only a free-text `source` there is nothing to pin to, which is why this
 * could not be fixed by renaming: the shape was missing the fact the check is built on.
 *
 * It is an enum rather than a string because these ten fields are the whole of what a drafter is
 * allowed to see (9.1). A wrong field name now fails at the schema, with the valid ones listed,
 * rather than at verification with "does not exist in the entry".
 */
const CLAIM = z.object({
  kind: z.enum(["quote", "number", "name", "event", "detail"])
    .describe("What sort of claim this is"),
  claim: z.string().min(1)
    .describe("The assertion the draft makes, in the draft's own words"),
  source_field: z.enum([...SOURCE_FIELDS])
    .describe("Which field of the moment's material the span below is copied from"),
  source_span: z.string().min(1)
    .describe(
      "The VERBATIM span from that field. Copied exactly, never paraphrased — it is checked as a " +
      "substring of that field before the draft is stored, so a paraphrase is refused even when " +
      "it is perfectly accurate.",
    ),
});

export const writeTools = [
  {
    name: "create_draft",
    config: {
      title: "Create a draft",
      description:
        "Store a draft against a moment. Every factual claim must be listed with the field it rests " +
        "on and the verbatim span copied out of it. Those spans are checked mechanically before the " +
        "draft is stored and before any model gives an opinion: if one does not appear in the field " +
        "it names, nothing is written and the failures come back for you to fix. " +
        "Call get_moment first: the material is the only thing a draft may claim from, and any " +
        "uncleared name must not appear. This creates a draft only — it does not publish, schedule " +
        "or approve anything.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment this draft is written from"),
        body: z.string().min(1).describe("The post itself, as it would appear on LinkedIn"),
        hook: z.string().optional().describe("The opening line, if it is worth naming separately"),
        framework: z.string().min(1)
          .describe("The shape used, e.g. 'story-lesson'. Never 'acceptance-fixture'."),
        claims: z.array(CLAIM)
          .describe("Every factual claim in the body, each with its verbatim source span"),
        model: z.string().optional().describe("What wrote it. Defaults to claude-code."),
      },
    },
    async handler(args, { db }) {
      // 6.3 again: a killed moment is one Josh has already said no to.
      const [moment] = await db.select("moments", {
        select: "id,killed,status,ref",
        id: `eq.${args.moment_id}`,
        limit: 1,
      });
      if (!moment) throw new Error(`No moment with id ${args.moment_id}.`);
      if (moment.killed) {
        throw new Error(
          `Moment ${args.moment_id} has been killed. Josh has already declined it, so it must not ` +
          `be drafted from. Pick another from list_moments.`,
        );
      }

      // Reserved for the acceptance harness, which counts drafts and must be able to exclude its
      // own fixtures. A real draft carrying this label would corrupt component test 8.
      if (args.framework === "acceptance-fixture") {
        throw new Error(
          "'acceptance-fixture' is reserved for the acceptance harness. Use the name of the " +
          "shape the post actually uses.",
        );
      }

      // The whole list, not just the uncleared half: verifyDraft below is handed every real name
      // with its clearance, because a name's absence from this array reads to it as "no such name
      // to worry about" rather than "cleared".
      const realNames = (await db.select("moment_names", {
        select: "name,kind,cleared",
        moment_id: `eq.${args.moment_id}`,
      })).filter((n) => n.kind !== "not_a_name");
      const uncleared = realNames.filter((n) => !n.cleared);

      // Checked here as well as at the gate. The gate is a model reading prose and can miss one;
      // this is a string search and cannot. Clause 9.10 makes an uncleared name a hard stop, not a
      // judgement call, so it is worth catching before the draft exists rather than after.
      const named = uncleared.filter((n) =>
        new RegExp(`\\b${n.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(args.body)
      );
      if (named.length > 0) {
        throw new Error(
          `The draft names ${named.map((n) => n.name).join(", ")}, which ${named.length === 1 ? "is" : "are"} ` +
          `not cleared (9.10). Rewrite without ${named.length === 1 ? "it" : "them"} — a role or a ` +
          `description usually carries the point without the name.`,
        );
      }

      // ── The claim ledger, checked before the draft exists (9.4) ──────────────────────────────
      //
      // Runs after the guards above on purpose. "You named someone uncleared" and "that label is
      // reserved" are more useful than a list of unsupported claims, and neither is fixed by
      // mending a ledger.
      //
      // Note this is STRICTER than the name guard above, which matches on word boundaries:
      // verifyDraft matches on substrings, so an uncleared "Dan" is caught inside "redundant" too.
      // That is the edge function's behaviour as well, and the two paths now refuse the same drafts.
      const [material] = await db.select("material", {
        select: "*",
        moment_id: `eq.${args.moment_id}`,
        limit: 1,
      });
      const entry = sourceEntry(material);
      if (Object.keys(entry).length === 0) {
        throw new Error(
          `Moment ${args.moment_id} has no mined material, so there is nothing for a claim to rest ` +
          `on. It needs interviewing first — get_drafting_brief refuses it for the same reason.`,
        );
      }

      const verification = verifyDraft(
        args.body,
        args.claims,
        entry,
        realNames.map((n) => ({ name: n.name, cleared: Boolean(n.cleared) })),
      );
      if (!verification.ok) {
        throw new Error(
          `The claim ledger does not hold, so nothing was stored (9.4).\n\n` +
          verification.failures.map((f) => `  · ${f}`).join("\n") +
          `\n\nEvery span must be copied verbatim out of the field it names. Fix the ledger, or ` +
          `take the claim out of the post, then call create_draft again.`,
        );
      }

      const [{ version: latest } = {}] = await db.select("drafts", {
        select: "version",
        moment_id: `eq.${args.moment_id}`,
        order: "version.desc",
        limit: 1,
      });

      const [library] = await db.select("library_versions", {
        select: "version",
        order: "version.desc",
        limit: 1,
      });
      if (!library) throw new Error("The library has no versions, so a draft cannot be attributed.");

      const [row] = await db.insert("drafts", {
        moment_id: args.moment_id,
        version: (latest ?? 0) + 1,
        attempt: 1,
        body: args.body,
        hook: args.hook ?? null,
        framework: args.framework,
        library_version: library.version,
        model: args.model ?? "claude-code",
        claims: args.claims,
        // Never null again. Null meant "nobody looked", and it read as indistinguishable from a
        // draft that had been checked — which is how this path went unverified for its whole life.
        claims_verified: true,
      });

      return {
        draft_id: row.id,
        moment_ref: moment.ref,
        version: row.version,
        library_version: row.library_version,
        next: "Run the eight checks and record each with record_gate_verdict.",
      };
    },
  },

  {
    name: "record_gate_verdict",
    config: {
      title: "Record one gate check",
      description:
        "Record the outcome of a single check against a draft. One call per check — the gate is " +
        "eight independent judgements and collapsing them into one loses which one rejected and " +
        "why. A rejection needs a reason a person can act on: name the sentence, not the rule. " +
        "Verdicts are written as they are reached, so an interrupted run resumes rather than " +
        "starting over.",
      inputSchema: {
        draft_id: z.number().int().describe("The draft being checked"),
        check_key: z.enum([
          "anyone_else", "claims_trace", "hook_opens_loop", "aimed_at_someone",
          "voice_guide", "names_cleared", "identifiable", "banned_phrases",
        ]).describe("Which of the eight checks this is"),
        passed: z.boolean().describe("Whether the draft cleared this check"),
        reason: z.string().optional()
          .describe("Required when passed is false. What specifically is wrong, and where."),
        changed: z.string().optional().describe("A suggested rewrite, if there is an obvious one"),
        model: z.string().optional().describe("What made the judgement. Defaults to claude-code."),
      },
    },
    async handler(args, { db }) {
      if (!args.passed && !args.reason?.trim()) {
        throw new Error(
          "A rejection without a reason cannot be acted on. Say what is wrong and where — the " +
          "reason is what the rewrite is built from.",
        );
      }

      const [draft] = await db.select("drafts", {
        select: "id,moment_id",
        id: `eq.${args.draft_id}`,
        limit: 1,
      });
      if (!draft) throw new Error(`No draft with id ${args.draft_id}.`);

      const existing = await db.select("gate_runs", {
        select: "check_key,passed",
        draft_id: `eq.${args.draft_id}`,
      });
      if (existing.some((r) => r.check_key === args.check_key)) {
        throw new Error(
          `Check "${args.check_key}" already has a verdict on draft ${args.draft_id}. Verdicts are ` +
          `written once; re-running a check would hide the first answer. Draft a new version instead.`,
        );
      }

      const [row] = await db.insert("gate_runs", {
        draft_id: args.draft_id,
        check_key: args.check_key,
        passed: args.passed,
        reason: args.reason ?? null,
        changed: args.changed ?? null,
        model: args.model ?? "claude-code",
      });

      // COUNTED BY DISTINCT CHECK, NOT BY ROW.
      //
      // It used to be `existing.length + 1`, and that is wrong wherever a check has more than one
      // row. The deterministic claim ledger in handlers/draft.ts wrote one gate_runs row per FAILED
      // CLAIM, all keyed claims_trace — draft 49 had three of them, 65 milliseconds apart.
      //
      // The count therefore read 8 while only 6 distinct checks had been judged, and this function
      // replied "All eight recorded, 0 remaining". names_cleared and banned_phrases had never run.
      // Worse, cc-agent/work.mjs finds work by "drafts with fewer than 8 gate_runs", so that draft
      // was finished forever with two checks silently missing.
      //
      // A draft that has been judged on six of eight checks and reports itself complete is the
      // exact failure clause 9b exists to prevent.
      const all = [...existing, { check_key: args.check_key, passed: args.passed }];
      const byCheck = new Map();
      for (const r of all) {
        // A later verdict does not overwrite an earlier one — the insert above is append-only and
        // the first recorded answer is the one that stands.
        if (!byCheck.has(r.check_key)) byCheck.set(r.check_key, r);
      }
      const done = byCheck.size;
      const failed = [...byCheck.values()].filter((r) => !r.passed).map((r) => r.check_key);

      return {
        gate_run_id: row.id,
        checks_recorded: done,
        checks_remaining: Math.max(0, 8 - done),
        failed_so_far: failed,
        note: done < 8
          ? `${8 - done} check(s) still to record. Every check runs even after one rejects — Josh ` +
            `should see everything wrong with a draft at once, not one fault per round trip.`
          : failed.length === 0
            ? "All eight checks passed. The draft is ready for Josh's calendar."
            : `All eight recorded. Rejected by: ${failed.join(", ")}.`,
      };
    },
  },

  {
    name: "propose_library_change",
    config: {
      title: "Propose a library change",
      description:
        "Suggest a change to a reference library section, with the evidence behind it. This creates " +
        "a proposal for Josh to approve or reject — it never changes the library. Sections holding " +
        "the non-negotiable rules are immutable and a proposal against one is refused by the " +
        "database, not by this tool.",
      inputSchema: {
        section_key: z.string().describe("Which section, from get_library"),
        claim: z.string().min(1).describe("What you believe should change, in one sentence"),
        evidence: z.array(z.string()).min(1)
          .describe("What supports it — specific drafts, edits or outcomes, not general reasoning"),
        proposed_body: z.string().min(1).describe("The full new body for the section"),
      },
    },
    async handler(args, { db }) {
      const [section] = await db.select("library_sections", {
        select: "key,title,immutable,version",
        key: `eq.${args.section_key}`,
        limit: 1,
      });
      if (!section) throw new Error(`No library section "${args.section_key}".`);

      // The database refuses this too, by trigger. Saying so here gives a reason rather than a
      // constraint name, and the refusal itself is what clause 12 relies on.
      if (section.immutable) {
        throw new Error(
          `"${section.key}" is immutable. It holds a rule the learning loop is structurally unable ` +
          `to loosen, whatever the evidence says. That is deliberate: a system free to tune its own ` +
          `limits against engagement finds its way to engagement bait.`,
        );
      }

      const [row] = await db.insert("library_proposals", {
        section_key: args.section_key,
        claim: args.claim,
        evidence: args.evidence,
        proposed_body: args.proposed_body,
        status: "open",
      });

      return {
        proposal_id: row.id,
        section: section.title,
        status: row.status,
        next: "It appears on Josh's proposals screen. He approves or rejects it; nothing changes until he does.",
      };
    },
  },
];
