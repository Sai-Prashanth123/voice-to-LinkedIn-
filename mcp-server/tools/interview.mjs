/**
 * The interview, and capture, from wherever Claude is running.
 *
 * WHY THESE EXIST
 *
 * Josh connected the MCP, and his own session told him:
 *
 *   Waiting on an interview with you (6). All came from call transcripts.
 *
 * There was no tool that could take an answer. Nine tools mentioned interviews and every one of them
 * only read. So the system could show him the question and not hear him — while Telegram, the only
 * surface that could hear him, was not reaching him. Both halves worked and the pair did nothing.
 *
 * All six questions expired at seven days and parked. That is every call transcript he has sent.
 *
 * WHAT THIS COMPLETES
 *
 * With these three, the whole pipeline runs from a client that has no shell, no repository and no
 * Telegram:
 *
 *   capture_thought   -> a moment, and its first question
 *   next_interview_question / answer_interview -> the conversation
 *   submit_extraction -> material          (already existed)
 *   create_draft      -> a post            (already existed)
 *   record_gate_verdict -> judged          (already existed)
 *
 * WHY THEY POST RATHER THAN WRITE
 *
 * Same reason submit_extraction does, and worth restating because it is the property that makes
 * handing these to a model safe: content_mcp holds INSERT on drafts, gate_runs and library_proposals
 * and nothing else. Not moments, not raw_inputs, not interview_turns. A confused model gets a
 * permission error instead of a corrupted idea bank. The model call moved off the server; the write
 * authority never did.
 */

import { z } from "zod";

/** One door, so the key check and the error shape are written once. */
async function post(url, contextKey, payload) {
  // From the context first. On the hosted connector the key lives in the env object the edge
  // function builds, not in process.env, so reading process.env alone made every write from
  // Claude Desktop and claude.ai fail with "not set" while the local server worked.
  const key = contextKey ?? process.env.CONTENT_MCP_KEY;
  if (!key) throw new Error("CONTENT_MCP_KEY is not set, so nothing can be submitted.");

  const res = await fetch(`${url}/functions/v1/cc-submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.error ?? JSON.stringify(body).slice(0, 300);
    throw new Error(`${detail}${body.next ? `\n\n${body.next}` : ""}`);
  }
  return body;
}

export const interviewTools = [
  {
    name: "capture_thought",
    config: {
      title: "Put a thought into the idea bank",
      description:
        "Capture something that happened to Josh — a scene, a line someone said, a thing that " +
        "changed his mind — and start its interview. This is the same door Telegram uses, so a " +
        "thought captured here is indistinguishable from one sent to the bot. " +
        "Capture his OWN words as closely as you can: everything downstream is checked against " +
        "this text span by span, and a tidied-up paraphrase is a worse source than a rough " +
        "sentence. Do not capture questions, instructions or your own summaries. " +
        "The reply carries the FIRST interview question: ask him that, then pass his answer to " +
        "answer_interview. The interview happens here only; nothing is sent to Telegram.",
      inputSchema: {
        text: z.string().min(1).describe(
          "What happened, in his words. A fragment is fine — the interview is what fills it out.",
        ),
      },
    },
    async handler(args, { url, key }) {
      return await post(url, key, { kind: "capture", text: args.text });
    },
  },

  {
    name: "next_interview_question",
    config: {
      title: "Get the open interview question for a moment",
      description:
        "Returns the question waiting on a moment, asking a new one if the last turn was an " +
        "answer. Use this on anything at status 'captured' or 'half_mined' — list_moments will " +
        "show you which. Calling it twice does NOT spend two questions: an already-open question " +
        "comes back as it is, because the budget is eight for the whole interview (5.8). " +
        "Read the question to Josh in his own words rather than paraphrasing it; it was chosen " +
        "against the prompt set he wrote.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment to interview about"),
      },
    },
    async handler(args, { url, key }) {
      return await post(url, key, { kind: "interview_next", moment_id: args.moment_id });
    },
  },

  {
    name: "answer_interview",
    config: {
      title: "Answer an interview question, and get the next one",
      description:
        "Records Josh's answer and returns whatever comes next — another question, or the news " +
        "that the interview is finished and extraction has been queued. " +
        "SUBMIT WHAT HE ACTUALLY SAID. Do not tidy it, do not complete his sentences, and do not " +
        "add the detail you think he meant: this text becomes the source every later claim is " +
        "verified against, so an improvement here is a fabrication three steps downstream. " +
        "If he did not answer the question, say so in his words rather than inventing an answer.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment being interviewed"),
        answer: z.string().min(1).describe("His answer, verbatim"),
      },
    },
    async handler(args, { url, key }) {
      return await post(url, key, {
        kind: "interview_answer",
        moment_id: args.moment_id,
        answer: args.answer,
      });
    },
  },
];
