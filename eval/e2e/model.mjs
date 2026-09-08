/**
 * The model tier's one model call.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `run.mjs` has advertised `--with-model    adds the model-driven journeys` since it was written.
 * The tier is declared in harness.mjs, validated in defineCase, filtered on at run.mjs:59 and
 * reported in the results JSON — and not one case has ever declared it. The flag was fully plumbed
 * and completely inert: running with it produced byte-identical output to running without it.
 *
 * So every join in this system was proven and the model in the middle of it never was.
 *
 * WHAT THIS TIER PROVES, AND WHAT IT DOES NOT
 *
 * It proves the contract between the REAL prompt and the REAL model: given what prompts.ts actually
 * says, does the configured provider produce something that obeys it. That is where this build's
 * problems have actually been — an interviewer asking a compound abstract question with an em dash
 * in it, a drafter inventing a three-part negation because the material was thin.
 *
 * It does NOT prove the wiring. The 95 deterministic cases already do that, against a database
 * built from the migrations and thrown away. A model case that also exercised the queue would be
 * testing both and telling you neither when it failed.
 *
 * WHY IT DOES NOT USE _shared/llm.ts
 *
 * llm.ts imports `npm:@anthropic-ai/sdk` and `npm:zod@4`, which are Deno specifiers Node cannot
 * resolve. prompts.ts imports nothing and is read verbatim, so the half that matters — the words
 * sent to the model — is the same text the edge function sends. The request envelope below is a
 * faithful copy of compatStructured(): same endpoint, same auth header, same json_schema response
 * format. The response schema is written out here rather than derived from schemas.ts, because
 * schemas.ts is Zod and Zod is a Deno import; each case therefore asks for the few fields it
 * actually asserts on rather than the full shape.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Same shape as live.mjs's credentials(): a real environment variable always wins. */
function field(key) {
  let file = "";
  try {
    file = readFileSync(join(ROOT, "eval", ".env"), "utf8");
  } catch { /* environment only */ }
  return process.env[key] ?? (file.match(new RegExp("^" + key + "=(.*)$", "m")) ?? [])[1]?.trim();
}

/**
 * The providers this tier can drive, mirroring PROVIDERS in llm.ts.
 *
 * Only the OpenAI-compatible ones. Anthropic uses a different envelope, and adding a second one
 * here to cover a key nobody has bought yet would be code written for a hypothetical.
 */
const COMPAT = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyName: "GEMINI_API_KEY",
    // llm.ts: every gemini 3.x flash model caps at 20 requests a day on the free tier, so all
    // three roles resolve here. Named rather than looked up, so this file states what it used.
    model: "gemini-3.1-flash-lite",
    minCompletionTokens: 6000,
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyName: "GROQ_API_KEY",
    model: "openai/gpt-oss-120b",
    minCompletionTokens: 2000,
  },
};

/** What the tier needs, or a plain sentence saying which part is missing. */
export function modelConfig() {
  const provider = field("LLM_PROVIDER") ?? "gemini";
  const spec = COMPAT[provider];
  if (!spec) {
    return { ready: false, why: `LLM_PROVIDER is "${provider}", which this tier cannot drive` };
  }
  const key = field(spec.keyName);
  if (!key) {
    return {
      ready: false,
      why: `${spec.keyName} is not in eval/.env, so the configured provider cannot be called`,
    };
  }
  return { ready: true, provider, spec, key };
}

/** True when a provider refused for load rather than for content. Matches isTransient in llm.ts. */
export function isRateLimit(message) {
  return /\b(429|rate.?limit|quota|RESOURCE_EXHAUSTED|503|overloaded)\b/i.test(String(message));
}

/**
 * One structured call, the same envelope compatStructured() sends.
 *
 * @param {object} opts
 * @param {string} opts.system      The real system prompt, from prompts.ts.
 * @param {string} opts.user        The real user message.
 * @param {object} opts.schema      JSON schema for the reply. Only the asserted fields.
 * @param {number} [opts.maxTokens]
 */
export async function askModel({ system, user, schema, maxTokens }) {
  const cfg = modelConfig();
  if (!cfg.ready) throw new Error(cfg.why);

  const res = await fetch(cfg.spec.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.spec.model,
      max_completion_tokens: Math.max(cfg.spec.minCompletionTokens, maxTokens ?? 4000),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${text.slice(0, 300)}`);

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${cfg.provider} returned no content`);

  return { model: cfg.spec.model, provider: cfg.provider, value: JSON.parse(content) };
}
