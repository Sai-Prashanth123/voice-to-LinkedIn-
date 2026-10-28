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

import { GATE_CHECKS } from "../../supabase/functions/_shared/prompts.ts";
import { z } from "zod";

import { verifyDraft } from "../../supabase/functions/_shared/claims.ts";
// The clearance-expiry rule, shared with the Deno side. Pure and synchronous, so this Node path
// runs the same rule the edge functions do rather than its own reading of `cleared` — see
// clearanceSurvivesReopen in that file for what was wrong with reading the boolean alone.
import { isClearedNow, needsAClearanceDecision } from "../../supabase/functions/_shared/names.ts";
// 8.3 — "Take the shape. Never the words." The index holds hashes of the reference writers' word
// runs, never their sentences, so consulting it puts none of their text near a drafter.
import { hashRun, shinglesOf } from "../../supabase/functions/_shared/shingles.ts";
import { CLAIMABLE_FIELDS, sourceEntry } from "../../supabase/functions/_shared/entry.ts";
/*
 * ONE DECLARATION, SHARED WITH write_post.
 *
 * It used to live in this file, and `write_post` in onestep.mjs declared the same parameter as
 * `z.record(z.string())` — so the tool Josh uses could not pass the names array that the entire
 * never-name-a-client chain filters on. The two are now the same object, not two objects that
 * agree, and conformance.test.mjs asserts that by identity: a second declaration cannot be written
 * without a test naming it. See extraction-shape.mjs for the measurement.
 */
import { EXTRACTION, FIELD_COUNT } from "./extraction-shape.mjs";
import { writingSources } from "../sources.mjs";
import { HIGH_CONFIDENCE, scan } from "../aitells.mjs";
import { PREFILE_CHECKS, prefileVerdict } from "../prefile.mjs";
// 9.3 — the recorded framework, normalised on the way in and checked against his own section.
import { isNamedFramework, namedFrameworks, tidyFramework } from "../frameworks.mjs";

/**
 * Which of this draft's seven-word runs are already one of the reference writers' (8.3).
 *
 * ASKED OF THE DATABASE, AND IN THIS DIRECTION ONLY.
 *
 * The draft's own run hashes go out; the ones that are known come back. Nothing is read INTO the
 * session — there is no query here that could return a sentence, or even a hash the draft did not
 * already contain, so the check cannot become a route to the text it exists to protect.
 *
 * Two earlier shapes were wrong and are worth recording. A `readFileSync` of a data file would have
 * worked in a clone and done nothing on the connector, because the edge function deploys its own
 * module graph — the same failure as the hooks that only ran locally. A static import fixed that and
 * then exceeded Supabase's 5MB function limit, so it shipped nowhere, which the deploy caught. A
 * table is the answer to both, and better than either: the corpus grows, and an index in a row needs
 * no deploy to catch up.
 *
 * Returns null when the index is empty — not an empty set. "We could not check" and "nothing
 * borrowed" are different answers and the caller is told which one it got.
 */
async function borrowedIndexFor(db, body) {
  const wanted = [...new Set(shinglesOf(body).map(hashRun))];
  if (wanted.length === 0) return new Set();

  /*
   * IS THERE AN INDEX AT ALL? Added 26 October, because the contract above was a lie.
   *
   * Everything below asks "which of THIS draft's runs are in the index". An empty answer means
   * either nothing was borrowed or the index is empty, and those are different facts. The comment
   * above has promised to tell them apart since the day it was written, and the code returned an
   * empty Set in both cases — so a draft came back `found: 0` with the index missing, directly
   * under another comment saying a check must report that it ran "or nobody can tell the difference
   * between 'nothing borrowed' and 'nothing looked'".
   *
   * `reference_shingles` is populated only by scripts/build-reference-shingles.mjs, run by hand. A
   * fresh project, a restored database, or a clone pointed at a project where that was never run all
   * produce the same silence. One cheap row settles it.
   */
  const any = await db.select("reference_shingles", { select: "hash", limit: "1" });
  if (any.length === 0) return null;

  const known = new Set();
  // PostgREST puts the filter in the URL, so this goes in chunks a URL can hold.
  for (let i = 0; i < wanted.length; i += 150) {
    const rows = await db.select("reference_shingles", {
      select: "hash",
      hash: `in.(${wanted.slice(i, i + 150).join(",")})`,
      limit: "150",
    });
    for (const r of rows) known.add(r.hash);
  }
  return known;
}

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
 * It is an enum rather than a string because these fields are the whole of what a drafter is
 * allowed to see (9.1). A wrong field name now fails at the schema, with the valid ones listed,
 * rather than at verification with "does not exist in the entry".
 *
 * Twelve of them since 14 Oct 2026, not ten: `his_words` is what he actually typed, and
 * `receipts` is what he has told us about his own career, method and numbers. Both are his, both
 * are still checked word for word, and adding them is what lets a claim rest on a sentence he
 * wrote rather than only on a model's summary of it. See entry.ts for why.
 */
const CLAIM = z.object({
  kind: z.enum(["quote", "number", "name", "event", "detail"])
    .describe("What sort of claim this is"),
  claim: z.string().min(1)
    .describe("The assertion the draft makes, in the draft's own words"),
  source_field: z.enum([...CLAIMABLE_FIELDS])
    .describe(
      "Which source the span below is copied from: one of the ten material fields, or his_words " +
      "for what he actually typed, or receipts for what he has told us about himself.",
    ),
  source_span: z.string().min(1)
    .describe(
      "The VERBATIM span from that field. Copied exactly, never paraphrased — it is checked as a " +
      "substring of that field before the draft is stored, so a paraphrase is refused even when " +
      "it is perfectly accurate.",
    ),
});

/**
 * One candidate, in the shape TriageSchema defines it.
 *
 * `strength` carries the describe() that matters most: the server discards anything under 4 before
 * Josh sees it, so a caller inflating a score to get something through only wastes its own run.
 */
const CANDIDATE = z.object({
  summary: z.string()
    .describe("What happened, in a sentence or two. Neutral. Never what Josh concluded."),
  why_interesting: z.string().describe("Which of the brief's criteria this meets, and how."),
  strength: z.number().int().min(1).max(5)
    .describe("Honestly. Anything under 4 is discarded server-side, whatever is claimed for it."),
  opening_question: z.string()
    .describe("The one question to put to Josh to start mining this. Stored, not sent."),
  names: z.array(z.object({
    name: z.string(),
    kind: z.enum(["person", "company"]),
  })).default([]).describe("Every person and company mentioned. Recording one does not clear it."),
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
        "uncleared name must not appear. " +
        "Drafts are written HERE, in Claude, and SO ARE THE CHECKS. " +
        // This line said the opposite until 14 Oct 2026: "the server runs the eight quality checks
        // by itself; do not run them yourself." That was true when the server held the gate and
        // stopped being true when `gate_runs_in_claude` was turned on, which is the default. A
        // caller that obeyed it filed a draft and walked away, and nothing else ever judged it —
        // 10 of the first 59 drafts carry no verdict at all, and Josh found a pile of them before
        // we did. The skill and the one-step tools said the right thing; this description did not,
        // and a tool description is what a model reads first.
        "When you have filed it, run the gate-check skill on it in a FRESH context — never in the " +
        "same breath as writing it. A draft nobody has judged is not finished and nothing " +
        "downstream will pick it up. " +
        "If it is rejected it comes back through next_work with the reasons attached. " +
        "This creates a draft only — it does not publish, schedule or approve anything.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment this draft is written from"),
        body: z.string().min(1).describe("The post itself, as it would appear on LinkedIn"),
        hook: z.string().optional().describe("The opening line, if it is worth naming separately"),
        framework: z.string().min(1)
          .describe(
            "Which body framework from the library you used, named as the frameworks section " +
            "names it. Not a description you invent: get_drafting_brief carries the section, and " +
            "9.3 records this so Josh can see whether the structure is varying. Never " +
            "'acceptance-fixture'.",
          ),
        claims: z.array(CLAIM)
          .describe("Every factual claim in the body, each with its verbatim source span"),
        model: z.string().optional().describe("What wrote it. Defaults to claude-code."),
      },
    },
    async handler(args, { db, url, key: contextKey }) {
      // 6.3 again: a killed moment is one Josh has already said no to.
      // `reopened_at` because clearance is per POST (9.10), and re-opening is the point at which a
      // moment becomes a different one. This select had four columns and the expiry rule in
      // names.ts could not reach any of them — see the note on clearanceSurvivesReopen.
      const [moment] = await db.select("moments", {
        select: "id,killed,status,title,reopened_at",
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
      // Tidied first, so the reservation cannot be walked past with a trailing space, and so that
      // one structure spelled two ways does not count as two when 9.3 is read back.
      const framework = tidyFramework(args.framework);
      if (framework.toLowerCase() === "acceptance-fixture") {
        throw new Error(
          "'acceptance-fixture' is reserved for the acceptance harness. Use the name of the " +
          "shape the post actually uses.",
        );
      }
      if (!framework) {
        throw new Error("A draft has to record which framework it used (9.3).");
      }

      // The whole list, not just the uncleared half: verifyDraft below is handed every real name
      // with its clearance, because a name's absence from this array reads to it as "no such name
      // to worry about" rather than "cleared".
      //
      // `cleared_at` is here for the expiry rule. `cleared` alone was a permanent boolean on this
      // path: a name cleared in August for one post came back cleared in November for a post
      // written from the same moment after a re-open, and this refusal let it through.
      const realNames = (await db.select("moment_names", {
        select: "name,kind,cleared,cleared_at",
        moment_id: `eq.${args.moment_id}`,
      })).filter((n) => n.kind !== "not_a_name");
      const uncleared = realNames.filter((n) => needsAClearanceDecision(moment.reopened_at, n));

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
      const extra = await writingSources(db, args.moment_id);
      const entry = sourceEntry(material, extra);
      if (Object.keys(entry).length === 0) {
        throw new Error(
          `Moment ${args.moment_id} has no mined material, so there is nothing for a claim to rest ` +
          `on. It needs interviewing first — get_drafting_brief refuses it for the same reason.`,
        );
      }

      // 8.3, before the ledger, because "you have used his words" is the more useful refusal and
      // is not fixed by mending a ledger either.
      const borrowedIndex = await borrowedIndexFor(db, args.body);
      const shingleRuns = shinglesOf(args.body).length;

      const verification = verifyDraft(
        args.body,
        args.claims,
        entry,
        // The LIVE clearance, not the stored boolean. verifyDraft is the stricter of the two name
        // checks here — it matches substrings where the guard above matches word boundaries — so
        // handing it a clearance that expired at the last re-open would make the stricter check
        // the more permissive one on exactly the drafts the expiry exists for.
        realNames.map((n) => ({ name: n.name, cleared: isClearedNow(moment.reopened_at, n) })),
        borrowedIndex,
      );
      if (!verification.ok) {
        /*
         * The headline and the advice have to match the failure, and they stopped matching the day
         * verifyDraft learned a second kind. A borrowed run was announced as "the claim ledger does
         * not hold" and answered with "fix the ledger", which is advice for a different problem
         * entirely — a caller following it would edit a ledger that was already correct and call
         * again with the same borrowed sentence. Named rather than inferred, because a refusal that
         * misdescribes itself wastes the attempt it refused.
         */
        const onlyBorrowed = verification.borrowedPhrases.length > 0 &&
          verification.failures.length === 1;
        throw new Error(
          (onlyBorrowed
            ? `The draft uses a reference writer's words, so nothing was stored (8.3).`
            : `The claim ledger does not hold, so nothing was stored (9.4).`) +
          `\n\n` + verification.failures.map((f) => `  · ${f}`).join("\n") + `\n\n` +
          (onlyBorrowed
            ? `Take the shape and write the line again in his words, then call create_draft again. ` +
              `The ledger is fine — nothing about it needs changing.`
            : `Every span must be copied verbatim out of the field it names. Fix the ledger, or ` +
              `take the claim out of the post, then call create_draft again.`),
        );
      }

      /*
       * THE MECHANICAL TELLS, BEFORE THE DRAFT IS STORED RATHER THAN AFTER.
       *
       * scrub_draft runs these same rules and costs nothing, and a writer can still file straight
       * past it. That happened on 14 Oct 2026: scrub flagged the filler word "actually", the draft
       * was filed anyway, and the row is in the database with a word from his own banned list in it.
       * Reading a warning and not acting on it is a choice a model makes constantly.
       *
       * So the findings come back attached to the result, where they cannot be skipped, and the
       * handful where the construction is simply wrong refuse outright. HIGH_CONFIDENCE is already
       * defined as exactly that subset — "the construction is simply wrong and the fix is
       * mechanical" — so this does not invent a new standard, it enforces the one measure_draft
       * already uses to decide what is worth interrupting a writer for.
       *
       * Everything else is reported, not refused. A filler word is a judgement ("delete it and read
       * the sentence again"), and a check that cannot be overruled on a judgement is a check that
       * will eventually be wrong with no way back.
       */
      const tells = scan(args.body);
      /*
       * The refusal set now lives in prefile.mjs, so that measure_draft and scrub_draft can report
       * the SAME list before a call is spent. A free look that does not predict the refusal is how
       * scrub_draft came to be ignored.
       *
       * It still composes HIGH_CONFIDENCE exactly as this block did, and it still runs here, before
       * the post to cc-submit below, so a refused draft is never stored.
       */
      const prefileSections = await (async () => {
        try {
          const rows = await db.select("library_sections", { select: "key,body" });
          return Object.fromEntries(rows.map((r) => [r.key, r.body ?? ""]));
        } catch {
          // No library in hand means the library-derived checks report rather than refuse. "We
          // could not check" and "this breaks a rule" are different answers.
          return null;
        }
      })();
      const prefile = prefileVerdict(args.body, { sections: prefileSections });
      const blocking = prefile.blocking;
      if (blocking.length > 0) {
        throw new Error(
          `The draft uses ${blocking.length} construction(s) the library rules out, so nothing was ` +
          `stored.\n\n` +
          blocking.map((f) =>
            `  · ${f.line ? `line ${f.line}: ` : ""}"${f.matched}" — ${f.name}. ${f.fix}`
          ).join("\n") +
          `\n\nThese are the mechanical ones: the construction is wrong rather than arguable. Fix ` +
          "them and call create_draft again.",
        );
      }

      /*
       * FILED BY THE SERVER, THEN GATED BY THE SERVER.
       *
       * This used to insert the row itself and hand back "run the eight checks and record each with
       * record_gate_verdict" — so a draft written here was the only kind the server never judged.
       * The checks above stay because they are instant; the filing moved to cc-submit, which runs
       * the same applyDraft the server's own drafter uses and queues the gate afterwards.
       *
       * It also closes the waiting draft job for this idea, which carries the attempt number. That
       * number is what parks an idea after its third failed draft (9.8), and reading it from the job
       * rather than from here means it cannot be reset by calling this again.
       */
      const key = contextKey ?? process.env.CONTENT_MCP_KEY;
      if (!key) throw new Error("CONTENT_MCP_KEY is not set, so the draft cannot be filed.");

      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "draft",
          moment_id: args.moment_id,
          body: args.body,
          hook: args.hook ?? "",
          framework,
          claims: args.claims,
          model: args.model ?? "claude-code",
        }),
      });
      const filed = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = filed.error ?? `cc-submit ${res.status}`;
        throw new Error(filed.next ? `${detail}\n\n${filed.next}` : detail);
      }

      /*
       * 9.3, SAID OUT LOUD WHEN IT IS WRONG — AND NOT ENFORCED.
       *
       * The draft is already filed above, deliberately. A framework name outside his library is a
       * labelling mistake, not a reason to throw away a post that passed the claim ledger; and the
       * advisory decision of 13 October covers this for the same reason it covers the gate. The
       * names are read from the live section rather than listed here, so the day Josh approves a
       * rewrite of `frameworks` this check follows him with no deploy.
       *
       * What it catches: 20 of 49 drafts were filed under "The scene", which has never been one of
       * his structures, and nothing said a word.
       */
      let frameworkNote;
      try {
        const [section] = await db.select("library_sections", {
          select: "body",
          key: "eq.frameworks",
          limit: 1,
        });
        const named = namedFrameworks(section?.body);
        if (named.length > 0 && !isNamedFramework(framework, section?.body)) {
          frameworkNote =
            `Filed, but "${framework}" is not one of the frameworks his library names. His are: ` +
            `${named.map((n) => `"${n}"`).join(", ")}. 9.3 records this so he can see whether the ` +
            `structure is varying, and a name from outside the section makes that unreadable — ` +
            `use one of his, or tell him the section is missing a structure he wants.`;
        }
      } catch {
        // A section read that fails must not turn a filed draft into an error. The note is a
        // courtesy; the draft is the work.
      }

      /*
       * THE ARGUABLE TELLS TRAVEL WITH THE DRAFT.
       *
       * `blocking` above already refused the mechanical ones. What is left is judgement, so it is
       * attached to the result rather than left for someone to go and ask for: the next thing read
       * after "filed" is what is still wrong with it.
       *
       * This block used to sit at the end of submit_candidates, which has no `tells` in scope and
       * no body to scan — so every successful call threw a ReferenceError after cc-submit had
       * already stored the candidates, and create_draft never reported a tell at all.
       */
      const arguable = tells.findings.length > 0
        ? {
          ai_tells: tells.findings.map((f) => ({
            line: f.line,
            matched: f.matched,
            rule: f.name,
            fix: f.fix,
          })),
          ai_tells_mean: "Mechanical, from the same rules scrub_draft runs. None of them blocked " +
            "the draft. Fix them with edit_post before Josh reads it, or say why you are keeping " +
            "one — a filler word is a judgement, and the library says to delete it and read the " +
            "sentence again.",
        }
        : {};

      return {
        ...filed,
        name: moment.title ?? null,
        framework,
        framework_note: frameworkNote,
        /*
         * Said on every draft, including the ones that pass. A check reports that it ran, or nobody
         * can tell the difference between "nothing borrowed" and "nothing looked" — which is how
         * the retelling check went 49 drafts without running and the gate went five days without
         * closing.
         */
        borrowed_phrases: borrowedIndex === null
          ? {
            checked: false,
            why: "The reference index is empty, so 8.3 was NOT enforced on this draft. It is built " +
              "by scripts/build-reference-shingles.mjs and that has not been run against this " +
              "project. Nothing is wrong with the draft — nothing looked at it. Say so rather " +
              "than letting it read as clean.",
          }
          : {
            checked: `${shingleRuns} seven-word run(s) of this draft, against the reference index (8.3)`,
            found: 0,
          },
        /*
         * Same discipline, for the same reason. Josh wrote on 26 October that he gives the same
         * notes every time; two of the things he was re-raising were checks that had run and found
         * nothing to say because they could not see the marker he uses. A check that reports it ran
         * is a check whose silence means something.
         */
        pre_filing_checks: {
          ran: PREFILE_CHECKS,
          refused_on: 0,
          ...(prefile.advisory.length > 0 && {
            reported_not_refused: prefile.advisory.map((f) => `${f.source}: ${f.matched}`),
          }),
        },
        ...arguable,
      };
    },
  },

  {
    name: "submit_extraction",
    config: {
      title: "Record what an interview produced",
      description:
        `Turn one finished interview into idea bank material (5.9). Call get_extraction_brief ` +
        `first and follow it exactly. All ${FIELD_COUNT} fields: the ten material ones, the ` +
        `pillar, the audience and its two flags, the strength, the two time fields, and the names. ` +
        `Every text field becomes the source of truth a later draft is checked against claim by ` +
        `claim, so LEAVE ONE EMPTY rather than filling it with something reasonable — empty is ` +
        `always allowed and is correct whenever Josh did not say it. The names array is the one ` +
        `that is not like the others: it is what the never-name-a-client rule reads, and a name ` +
        `left out of it is a name no later check can stop. The quote, the numbers and the names ` +
        `are checked against what he actually said before anything is written, and a submission ` +
        `that fails comes back with reasons rather than being stored badly.`,
      inputSchema: {
        moment_id: z.number().int().describe("The moment whose interview this records"),
        extracted: EXTRACTION,
        redo: z.boolean().optional().describe(
          "Only when Josh asked for an idea already written up to be written up again. The " +
            "entry it replaces is kept on the record.",
        ),
      },
    },

    async handler(args, { url, key: contextKey }) {
      // Posted to cc-submit rather than written here, and that is the whole design rather than an
      // inconvenience. content_mcp has insert on four tables and the idea bank is none of them; the
      // edge function validates and writes with its own admin client. The model call moved off the
      // free tier, the write authority did not.
      const key = contextKey ?? process.env.CONTENT_MCP_KEY;
      if (!key) throw new Error("CONTENT_MCP_KEY is not set, so the extraction cannot be submitted.");

      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "extraction",
          moment_id: args.moment_id,
          extracted: args.extracted,
          redo: args.redo === true,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (res.status === 422) {
        // The refusal is the useful outcome, so it is raised with its reasons rather than returned
        // as a result a caller might read as success.
        throw new Error(
          `The extraction does not match what Josh said, so nothing was written (5.9).\n\n` +
          (body.failures ?? []).map((f) => `  · ${f}`).join("\n") +
          `\n\nFix it against the transcript, or leave the field empty. Empty is always allowed.`,
        );
      }
      if (!res.ok) {
        throw new Error(`cc-submit ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
      }

      return body;
    },
  },

  {
    name: "submit_candidates",
    config: {
      title: "Surface content candidates from one source",
      description:
        "Store what is genuinely worth putting in front of Josh from one call, session or thread " +
        "(4.3, 4.4). Call get_triage_brief first. AN EMPTY LIST IS THE EXPECTED RESULT most of the " +
        "time and is never a failed run — a version surfacing ten candidates a day is worse than " +
        "none, because he stops reading them. The strength bar and the daily cap are applied " +
        "server-side, so submitting more than there is room for does no harm: the strongest are " +
        "kept and the rest are simply not surfaced. Nothing here reaches Josh directly; each " +
        "candidate waits until he next opens a session (4.3.4).",
      inputSchema: {
        source: z.enum(["claude_code", "call_transcript", "slack"])
          .describe("Where this material came from"),
        source_ref: z.string().min(1)
          .describe("The id of the call, session or thread. Re-submitting one already triaged does nothing."),
        candidates: z.array(CANDIDATE)
          .describe("What is worth asking Josh about. Empty is correct most of the time."),
      },
    },

    async handler(args, { url, key: contextKey }) {
      const key = contextKey ?? process.env.CONTENT_MCP_KEY;
      if (!key) throw new Error("CONTENT_MCP_KEY is not set, so candidates cannot be submitted.");

      // Posted rather than inserted: content_mcp cannot write `moments`, and that is the point.
      // The cap in 4.4.3 is the only thing standing between Josh and a wall of candidates, so it
      // is applied by the server from the same code worker-triage runs — never by the caller.
      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "candidates",
          source: args.source,
          source_ref: args.source_ref,
          candidates: args.candidates,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`cc-submit ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
      }

      // The AI-tells attachment that used to sit here was pasted in from create_draft, and `tells`
      // is declared in that handler, not this one. Every successful call therefore threw a
      // ReferenceError AFTER cc-submit had already stored the candidates: the work landed and the
      // tool reported failure. Candidates are not a draft and have no body to scan, so the right
      // answer is the server's own.
      return body;
    },
  },

  {
    name: "record_gate_verdict",
    config: {
      title: "Record one gate check",
      description:
        "Record the outcome of a single check against a draft. One call per check — the gate is " +
        "a set of independent judgements and collapsing them into one loses which one rejected " +
        "and why. A rejection needs a reason a person can act on: name the sentence, not the " +
        "rule. " +
        "Verdicts are written as they are reached, so an interrupted run resumes rather than " +
        "starting over.",
      inputSchema: {
        draft_id: z.number().int().describe("The draft being checked"),
        // DERIVED, NEVER RESTATED. This list was written out by hand and fell one behind when the
        // ninth check arrived on 14 October: the branch below required nine verdicts while this
        // enum accepted eight, so gate_passed stayed null on every draft for five days and
        // mark_ready refused all of them. Read off GATE_CHECKS, the two cannot disagree again.
        check_key: z.enum(GATE_CHECKS.map((c) => c.key))
          .describe(`Which of the ${GATE_CHECKS.length} checks this is`),
        passed: z.boolean().describe("Whether the draft cleared this check"),
        reason: z.string().optional()
          .describe("Required when passed is false. What specifically is wrong, and where."),
        changed: z.string().optional().describe("A suggested rewrite, if there is an obvious one"),
        model: z.string().optional().describe("What made the judgement. Defaults to claude-code."),
      },
    },
    async handler(args, { db, url, key: contextKey }) {
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

      // GATE_CHECKS.length, not 8 — see the note in work.mjs. Closing a draft out at eight would
      // have left the ninth verdict unrecorded and the draft permanently one short.
      if (done < GATE_CHECKS.length) {
        return {
          gate_run_id: row.id,
          checks_recorded: done,
          checks_remaining: GATE_CHECKS.length - done,
          failed_so_far: failed,
          note: `${GATE_CHECKS.length - done} check(s) still to record. Every check runs even ` +
            `after one rejects — ` +
            `Josh should see everything wrong with a draft at once, not one fault per round trip.`,
        };
      }

      /*
       * THE EIGHTH VERDICT HAS TO DO SOMETHING.
       *
       * This used to answer "All eight checks passed. The draft is ready for Josh's calendar." and
       * that sentence was false: nothing put it in the calendar, nothing set gate_passed, nothing
       * queued the rewrite a rejection needs, and Josh was never told. Draft 57 sat in exactly that
       * state — eight verdicts, one rejection, and no consequence.
       *
       * This tool cannot do it itself. content_mcp may insert a gate_runs row and may not touch a
       * draft, a moment or the calendar, which is the right boundary: the judgement moved to Claude,
       * the write authority did not. So the ending is asked for through cc-submit, the one write
       * door, which runs the same finishGate the server's own gate worker runs.
       *
       * If that call fails, the verdicts are still recorded and this says so rather than pretending.
       * The draft can be closed out by asking again.
       */
      const key = contextKey ?? process.env.CONTENT_MCP_KEY;
      if (!key) {
        return {
          gate_run_id: row.id,
          checks_recorded: done,
          checks_remaining: 0,
          failed_so_far: failed,
          note: "Every verdict is recorded, but no key is configured to close the draft out, " +
            "so nothing has been decided yet: gate_passed is unset and no rewrite is queued.",
        };
      }

      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "gate_done", draft_id: args.draft_id }),
      });
      const closed = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          gate_run_id: row.id,
          checks_recorded: done,
          failed_so_far: failed,
          note: `All eight verdicts are recorded, but closing the draft out failed: ` +
            `${closed.error ?? `cc-submit ${res.status}`}. Nothing is decided — gate_passed is ` +
            `unset and no rewrite is queued. Ask again to finish it.`,
        };
      }

      return {
        gate_run_id: row.id,
        checks_recorded: done,
        checks_remaining: 0,
        failed_so_far: failed,
        outcome: closed.outcome,
        note: closed.next,
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

      /*
       * THE EVIDENCE IS WRAPPED, BECAUSE THE TABLE REQUIRES AN OBJECT AND THIS SENT AN ARRAY.
       *
       * `proposals_evidence_not_empty` (0004_reference_library.sql:149) checks
       * `jsonb_typeof(evidence) = 'object'`. This tool's schema is `z.array(z.string())`, so every
       * call it has ever made was refused by the database with a constraint name and nothing else.
       *
       * It had never been noticed because nothing had ever used it. All nine proposals on file were
       * written by the sentinel refresh script, which builds its own `{kind: "sentinel_measurement",
       * report: [...]}` object and so satisfies the constraint by accident of shape. The one entry
       * point a model has into clause 12.10 — the system proposes, Josh decides — has been broken
       * since it was written.
       *
       * `kind` names who proposed it, matching the script's convention, so a reader of the table can
       * tell a measured refresh from a judgement made in a session.
       */
      const [row] = await db.insert("library_proposals", {
        section_key: args.section_key,
        claim: args.claim,
        evidence: { kind: "claude_code", points: args.evidence },
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
