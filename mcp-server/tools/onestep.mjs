/**
 * Paste in, post out. The path Josh asked for on 13 October.
 *
 * "It's still asking me interview questions. And referencing the idea bank. As I've mentioned
 * multiple times now, I want to scrap all that for the time being."
 *
 * WHAT "ONE STEP" MEANS, AND WHAT IT CANNOT MEAN
 *
 * Drafts are written in Claude, not on the server — the server only judges them. So no tool can
 * take a paragraph and return a finished post: the model has to write it in between. One step is
 * one step FOR HIM. He says a thing; nothing asks him anything; a post comes back. These two tools
 * are what the model walks through to make that true, and each reply carries the next brief so
 * there is nothing to look up and nothing to remember.
 *
 * WHY THE IDEA BANK IS STILL UNDERNEATH
 *
 * `drafts.moment_id` is `not null references moments(id)`, and the claim ledger verifies every span
 * against the stored material rather than against anything the caller passes. Keeping the moment is
 * what keeps that honest, so the moment stays — as a container he never sees or is asked about. He
 * asked not to be sent back to the idea bank for his material, which is a different thing from
 * asking for his material not to be stored, and the second would cost him the only guarantee that
 * a draft cannot invent a quote.
 *
 * It also means "for the time being" is real: turn the mode off and everything written this way is
 * sitting there, named, interviewable, exactly like anything else.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * Soften anything. The extraction still goes through verifyExtraction against a source rebuilt
 * server-side, uncleared names still stop a draft, and the checks still run. The only thing
 * one-step mode changes about quality is who decides what to do about a failing check.
 */

import { z } from "zod";
import { tools } from "./index.mjs";
import { oneStepMode, modeName } from "../mode.mjs";
// The one declaration of the extraction, in a leaf module so this file and write.mjs can both have
// it without either importing the other. See extraction-shape.mjs for why that matters here.
import { EXTRACTION, FIELD_COUNT } from "./extraction-shape.mjs";

/**
 * Run another registered tool's handler. Keeps one implementation of every brief.
 *
 * THE ARGUMENTS ARE PARSED AGAINST THE TARGET TOOL'S OWN SCHEMA FIRST, WHICH THEY WERE NOT.
 *
 * `server.mjs` is what applies `z.object(inputSchema)` — `registerTool` builds it and the SDK parses
 * `params.arguments` against it before a handler runs. Reaching `tool.handler` directly, as this
 * function does, walks straight past that. So for every tool reached this way the declared schema
 * was documentation and nothing else: no validation, and — the half that actually bit — no
 * defaults. `decays_in_days: z.number().int().min(0).default(0)` never materialised, so
 * `applyExtraction` evaluated `extracted.decays_in_days > 0` on `undefined` and a time-sensitive
 * idea could not record when it decays.
 *
 * In production this cannot refuse anything that was not already refused: a real call arrives
 * through the MCP boundary, which parses `write_post`'s own schema before this handler exists. The
 * refusal path below is a belt on a brace. Its value is the defaults, and the fact that two tools'
 * schemas can no longer disagree IN EFFECT even if somebody lets them disagree in text.
 *
 * The issues are spelled out rather than re-thrown, because a zod error read raw by a model is a
 * stack of nested objects and this is a message that has to be actionable in one read.
 */
async function viaTool(name, args, context) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);

  const parsed = z.object(tool.config.inputSchema ?? {}).safeParse(args ?? {});
  if (!parsed.success) {
    throw new Error(
      `${name} was called with arguments it does not accept, so nothing was done.\n\n` +
      parsed.error.issues
        .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n") +
      `\n\nFix the named field and call again. Nothing has been stored.`,
    );
  }
  return await tool.handler(parsed.data, context);
}

export const oneStepTools = [
  {
    name: "start_post",
    config: {
      title: "Write a post from what he just said, with no questions",
      description:
        "Takes his words and comes back with everything needed to turn them into a post — no " +
        "interview, no idea bank, nothing pulled from a queue. Use it whenever he gives you " +
        "material and wants it written: a paragraph, a pasted transcript, a thought he just said " +
        "out loud. Pass HIS words, not a tidied version: every claim in the finished post is " +
        "checked back against this text span by span, so an improvement here becomes a fabrication " +
        `two steps later. The reply carries the extraction brief; fill all ${FIELD_COUNT} fields ` +
        "from his own words — including every name he mentioned — and call write_post. This works " +
        "whether or not one-step mode is on.",
      inputSchema: {
        text: z.string().min(1).describe("What he said, verbatim"),
        name: z.string().max(80).optional()
          .describe("Only if he said what to call it. Never invent one and never ask"),
        writer_handle: z.string().optional().describe(
          "Only if he named one of his reference writers to build this post after — \"write this " +
          "one like Matt Barker would\". e.g. mattjbarker1. Never chosen for him.",
        ),
      },
    },

    async handler(args, context) {
      /*
       * THE KEY FALLS BACK TO THE ENVIRONMENT, BECAUSE OVER STDIO THERE IS NO KEY IN THE CONTEXT.
       *
       * `index.mjs` builds `{ db, url: env.url }` for a local run — no `key`. The hosted connector
       * adds one (`http.mjs`), so `const { url, key } = context` worked on every path we ever ran
       * and failed on the one Josh is moving to. Measured 26 October: this request returns
       * HTTP 401 UNAUTHORIZED_INVALID_JWT_FORMAT, because `Bearer undefined` is not a JWT.
       *
       * start_post is the FIRST tool in one-step mode — the mode he asked for on 13 October and the
       * one he is in. So a clone could not begin. `system_events` shows 396 mcp_http_call rows and
       * no local equivalent: every session has gone through the connector, which is why nothing
       * caught it.
       *
       * Every sibling already does this — josh.mjs, interview.mjs, visual.mjs and four sites in
       * write.mjs. This file was the only one that did not, and `loadEnv()` has already populated
       * process.env by the time any handler runs (env.mjs).
       */
      const { url } = context;
      const key = context.key ?? process.env.CONTENT_MCP_KEY;
      if (!key) throw new Error("CONTENT_MCP_KEY is not set, so nothing can be submitted.");

      // interview: false explicitly, so this tool behaves the same whether or not the mode is on.
      // He asked for one-step writing; a tool named start_post should not depend on a setting to
      // keep its promise.
      // `${url}/functions/v1/cc-submit`, the way josh.mjs posts. `url` in the context is the
      // project base, not the write door, and treating it as the door fails with "requested path
      // is invalid" — which is PostgREST answering, not cc-submit refusing.
      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "capture", text: args.text, name: args.name, interview: false }),
      });
      const captured = await res.json().catch(() => ({}));
      if (!res.ok || captured?.error) {
        throw new Error(captured?.error ?? `capture failed: ${res.status}`);
      }

      const brief = await viaTool("get_extraction_brief", { moment_id: captured.moment_id }, context);

      return {
        moment_id: captured.moment_id,
        name: captured.name,
        mode: modeName(await oneStepMode(context.db)),
        extraction_brief: brief,
        how: [
          `Fill all ${FIELD_COUNT} fields from the text he gave you. Every text span copied ` +
            "exactly, never paraphrased — they are checked as substrings before anything is stored.",
          "A text field with nothing behind it stays empty. That is allowed and it is the right " +
            "answer. The ones that are NOT text are not like that: audience_known, " +
            "audience_is_buyer, strength and time_sensitive are judgements you have to make, and " +
            "`names` must list every person and company he mentioned. A name left out of that " +
            "array is a name nothing downstream can stop — the clearance question, the draft " +
            "refusal and the gate all filter it, and an empty array passes every one of them. " +
            "Recording a name does not name anybody: it asks him.",
          "Do not ask him anything. If the material genuinely will not carry a post, say which one " +
            "thing is missing and stop — that is one sentence, not an interview.",
        ],
        /*
         * Echoed back rather than stored, because he names the writer in the same breath as the
         * material — "write this one like Matt Barker would, here's what happened" — and the
         * parameter it belongs to is two calls away. A handle that arrives at start_post and is
         * not carried forward is the default framework getting used anyway, which is the thing
         * he wrote in about.
         */
        ...(args.writer_handle && { writer_handle: args.writer_handle }),
        then: args.writer_handle
          ? `write_post with moment_id, the extracted fields, and writer_handle: ` +
            `"${args.writer_handle}" — pass it on or the shape is lost.`
          : "write_post with moment_id and the extracted fields.",
      };
    },
  },

  {
    name: "write_post",
    config: {
      title: "File what he said as material, and get the brief to write from it",
      description:
        `The second half of start_post. Stores all ${FIELD_COUNT} fields against the idea and ` +
        "returns the drafting brief — his voice guide, his rules, his structures, and the material " +
        "itself. Write the post from that brief and file it with create_draft. If any name came " +
        "back uncleared, ask him about that ONE name in one line before writing: it is the only " +
        "thing that still stops a draft, and it stops it whichever mode is on. Nothing comes back " +
        "uncleared if nothing was recorded, so the `names` array below is what makes that sentence " +
        "mean anything.",
      inputSchema: {
        moment_id: z.number().int().describe("From start_post"),
        /*
         * THE SAME OBJECT submit_extraction DECLARES, NOT A SECOND DESCRIPTION OF IT.
         *
         * This was `z.record(z.string())` from 13 October until 28 October: strings only, against
         * a real shape with eighteen fields, six of them not strings. The MCP boundary parses this,
         * so `names` — an array — was answered with "expected string, received array" and a caller
         * that tried to pass the names he had just said was told it could not. Everything that
         * enforces "never name a client" filters that array, and an empty array cannot fail a
         * filter: 31 of 48 moments with material carry no name rows at all.
         *
         * Identity, not similarity. conformance.test.mjs asserts
         * `write_post.extracted === submit_extraction.extracted`, so the two cannot be made to
         * disagree again by editing one of them — there is only one of them.
         */
        extracted: EXTRACTION,
        writer_handle: z.string().optional().describe(
          "Pass it on from start_post, or set it here if he named a reference writer whose shape " +
          "he wants this post built in. e.g. mattjbarker1",
        ),
      },
    },

    async handler(args, context) {
      const filed = await viaTool(
        "submit_extraction",
        { moment_id: args.moment_id, extracted: args.extracted },
        context,
      );

      /*
       * A PARK HAS TO BE SAID OUT LOUD HERE, OR IT BECOMES THE SILENCE HE COMPLAINED ABOUT.
       *
       * applyExtraction parks an idea when nothing substantive came out of it, or when there is a
       * scene but nothing taken from it and the strength is 2 or less. That is the right call and
       * clause 1 says so: "if the material is not there in a given week, fewer posts is the
       * correct outcome."
       *
       * What was wrong was ignoring it. get_drafting_brief does not refuse a parked moment — only
       * a killed one — so a thin paste would have been parked, drafted anyway, pushed to his
       * calendar, and then withheld from his review by list_calendar, which skips drafts sitting
       * on parked ideas. Three correct behaviours composing into the exact thing he wrote in to
       * complain about: he gives it something and nothing comes back.
       *
       * So the chain stops here and the reason is handed over in his own terms. He gets a
       * sentence instead of a post, which is an answer.
       */
      if (filed?.status === "parked") {
        return {
          moment_id: args.moment_id,
          mode: modeName(await oneStepMode(context.db)),
          wrote_nothing: true,
          why: filed.note,
          tell_him: "Say in one line that there is not enough in it to write from yet, say which " +
            "part is missing, and ask for that part. Do not ask him a list of questions and do " +
            "not write the post anyway — a post built on this would fail the claims check and " +
            "reach him as a silence rather than as this sentence.",
          to_continue: "When he adds to it, call start_post again with the new words. Nothing is " +
            "lost: the idea is kept, parked, and reopens when there is more in it.",
        };
      }

      /*
       * The writer target travels with the brief, because in one_step mode the caller never
       * calls get_drafting_brief itself — this is the only place it can be handed over. A handle
       * dropped here is the complaint Josh made on 26 October arriving one step later.
       */
      const brief = await viaTool(
        "get_drafting_brief",
        {
          moment_id: args.moment_id,
          ...(args.writer_handle && { writer_handle: args.writer_handle }),
        },
        context,
      );

      return {
        moment_id: args.moment_id,
        mode: modeName(await oneStepMode(context.db)),
        uncleared_names: brief?.must_not_name ?? [],
        /*
         * AN EMPTY uncleared_names MEANT TWO DIFFERENT THINGS AND SAID NEITHER.
         *
         * "He named nobody" and "nobody was recorded, so there is nothing to clear" came back as
         * the same empty array, and the second one is the dangerous one: every check that enforces
         * 9.10 filters that list, so nothing recorded means nothing enforced. This is the scan in
         * the other direction, reported and never blocking — the gate's notJudged discipline, and
         * see missingNames in extraction.ts for what it does and does not catch.
         */
        names_not_recorded: filed?.names_not_recorded ?? [],
        ...(filed?.names_note && { names_note: filed.names_note }),
        ...(filed?.names_scanned === undefined && {
          names_not_recorded_note: "The write door did not report whether it scanned his words for " +
            "names, which means it is older than this check. Treat the empty list as 'nobody " +
            "looked', not as 'he named nobody'.",
        }),
        // Numbers he gave that no field carries. A post cannot state them, so say which before
        // writing around a figure he expected to see.
        numbers_not_carried: filed?.numbers_not_carried ?? [],
        ...(filed?.numbers_note && { numbers_note: filed.numbers_note }),
        drafting_brief: brief,
        how: [
          "Read the brief's system text in full. It is the live library — his voice guide, his " +
            "banned phrases, his hook and closing rules — and it is what the checks judge " +
            "against, so a draft that ignores it fails for reasons you could have read first.",
          "measure_draft and scrub_draft are free and catch most of what the checks would reject.",
          "Then create_draft, with every claim carrying the span it rests on.",
        ],
        then: "create_draft, then run the gate-check skill on it in a fresh breath.",
      };
    },
  },
];
