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
 * server-side, uncleared names still stop a draft, and the eight checks still run. The only thing
 * one-step mode changes about quality is who decides what to do about a failing check.
 */

import { z } from "zod";
import { tools } from "./index.mjs";
import { oneStepMode, modeName } from "../mode.mjs";

/** Run another registered tool's handler. Keeps one implementation of every brief. */
async function viaTool(name, args, context) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return await tool.handler(args, context);
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
        "two steps later. The reply carries the extraction brief; fill the ten fields from his own " +
        "words and call write_post. This works whether or not one-step mode is on.",
      inputSchema: {
        text: z.string().min(1).describe("What he said, verbatim"),
        name: z.string().max(80).optional()
          .describe("Only if he said what to call it. Never invent one and never ask"),
      },
    },

    async handler(args, context) {
      const { url, key } = context;

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
          "Fill the ten fields from the text he gave you. Every span copied exactly, never " +
            "paraphrased — they are checked as substrings before anything is stored.",
          "A field with nothing behind it stays empty. That is allowed and it is the right answer.",
          "Do not ask him anything. If the material genuinely will not carry a post, say which one " +
            "thing is missing and stop — that is one sentence, not an interview.",
        ],
        then: "write_post with moment_id and the extracted fields.",
      };
    },
  },

  {
    name: "write_post",
    config: {
      title: "File what he said as material, and get the brief to write from it",
      description:
        "The second half of start_post. Stores the ten fields against the idea and returns the " +
        "drafting brief — his voice guide, his rules, his structures, and the material itself. " +
        "Write the post from that brief and file it with create_draft. If any name came back " +
        "uncleared, ask him about that ONE name in one line before writing: it is the only thing " +
        "that still stops a draft, and it stops it whichever mode is on.",
      inputSchema: {
        moment_id: z.number().int().describe("From start_post"),
        extracted: z.record(z.string()).describe(
          "The ten fields, each a verbatim span of his text. Empty ones may be left out",
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

      const brief = await viaTool("get_drafting_brief", { moment_id: args.moment_id }, context);

      return {
        moment_id: args.moment_id,
        mode: modeName(await oneStepMode(context.db)),
        uncleared_names: brief?.must_not_name ?? [],
        drafting_brief: brief,
        how: [
          "Read the brief's system text in full. It is the live library — his voice guide, his " +
            "banned phrases, his hook and closing rules — and it is what the eight checks judge " +
            "against, so a draft that ignores it fails for reasons you could have read first.",
          "measure_draft and scrub_draft are free and catch most of what the checks would reject.",
          "Then create_draft, with every claim carrying the span it rests on.",
        ],
        then: "create_draft, then run the gate-check skill on it in a fresh breath.",
      };
    },
  },
];
