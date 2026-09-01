/**
 * One model layer for every worker, so provider choice, caching, cost accounting and error handling
 * are decided in a single place.
 *
 * ROLE TIERING (clause 16 decision 4) — expressed as roles, not model names, so the provider can
 * change without touching a single caller:
 *
 *   STRONG — the drafter and the gate. Where quality decides the outcome.
 *   MID    — the interviewer and transcript/Slack triage. High turn count, still needs judgement.
 *   CHEAP  — Claude Code session classification. ~700/month, so cost dominates (4.4.3).
 *
 * PROVIDERS
 *
 * Anthropic is what ships, and what the cost model and the whole quality argument assume. Clause 16
 * says "cheaper alternatives are welcome", so three OpenAI-compatible providers are supported for
 * exercising the pipeline without spending on Claude:
 *
 *   groq        — fastest, but the free tier allows 8,000 tokens per MINUTE, which the eight-check
 *                 gate cannot fit into one invocation however it is scheduled. Fine for the
 *                 interviewer, painful for the gate.
 *   huggingface — large open models through the inference router, no comparable per-minute wall, so
 *                 the full gate completes in one pass. The better of the two for anything where the
 *                 judgement matters rather than the plumbing. No vision.
 *   gemini      — Google, through its OpenAI-compatible endpoint. No per-minute wall either, and
 *                 currently free. The 3.x models think before answering and bill that thinking as
 *                 completion tokens, so they need real headroom - see GEMINI_MODELS. The only
 *                 OpenAI-compatible provider here that can see an image, so clause 10 works on it.
 *
 * READ THIS BEFORE TRUSTING ANY OF THEM. They prove the plumbing — that jobs flow, that the claim ledger
 * verifies, that a calendar entry appears. They do NOT prove the product:
 *
 *   - The gate is an adversarial judge. Acceptance test 8 wants 9 of 10 deliberately generic drafts
 *     rejected, and a weaker model is markedly more agreeable. A gate that passes under Groq tells
 *     you nothing about whether it passes under Claude.
 *   - "Could anyone else have written this?" is the hardest judgement in the system and the one the
 *     whole build exists to make. It is not a judgement to delegate to the cheapest available model.
 *   - Prompt caching, adaptive thinking and effort control do not exist on the OpenAI-compatible
 *     path, so latency and cost measured there do not transfer.
 *
 * Switch with:  update vault.secrets set secret = 'huggingface' where name = 'LLM_PROVIDER';
 *               (or 'groq', or 'anthropic')
 *
 * Adding a provider is a URL, a key name and a model map in COMPAT below. Nothing else changes,
 * because callers ask for a ROLE and never for a model.
 */

import Anthropic from "npm:@anthropic-ai/sdk@0";
import { noteProvider, type ProviderPurpose } from "./providers.ts";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0/helpers/zod";
import { z } from "npm:zod@4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireSecret, secret } from "./secrets.ts";

export type Role = "STRONG" | "MID" | "CHEAP";

/**
 * Callers ask for a role. These names are kept for readability at the call sites that already use
 * them; both spellings resolve to the same three tiers.
 */
export const MODELS = {
  OPUS: "STRONG",
  SONNET: "MID",
  HAIKU: "CHEAP",
} as const;

export type ModelId = Role;

const ANTHROPIC_MODELS: Record<Role, string> = {
  STRONG: "claude-opus-5",
  MID: "claude-sonnet-5",
  CHEAP: "claude-haiku-4-5",
};

/** Groq's strongest general models at the time of writing. Verified present on the account. */
const GROQ_MODELS: Record<Role, string> = {
  STRONG: "openai/gpt-oss-120b",
  MID: "openai/gpt-oss-120b",
  CHEAP: "openai/gpt-oss-20b",
};

/**
 * Hugging Face, through the inference router. Verified responding with strict JSON schema.
 *
 * A genuine middle tier rather than a second Groq: these are large open models, and the router has
 * no 8,000-tokens-per-minute wall, so the full eight-check gate completes in one pass. Still not
 * the product — see the note at the top of this file — but far closer to it than gpt-oss-20b, and
 * enough to tune the library against without spending on Claude.
 */
const HF_MODELS: Record<Role, string> = {
  STRONG: "Qwen/Qwen3-235B-A22B-Instruct-2507",
  MID: "Qwen/Qwen2.5-72B-Instruct",
  CHEAP: "meta-llama/Llama-3.3-70B-Instruct",
};

/**
 * Google Gemini, through its OpenAI-compatible endpoint.
 *
 * The best free option measured so far: no per-minute ceiling of Groq's kind, and the flash models
 * answer the full eight-check gate in one pass.
 *
 * MEASURED, NOT ASSUMED — the 3.x models think before answering, and the thinking is billed as
 * completion tokens. Asked for a two-field JSON verdict with max_tokens 200, gemini-3.5-flash spent
 * 293 tokens reasoning, hit the limit mid-sentence, and returned the words "Here is the JSON
 * requested:" followed by an unterminated code fence. It looked exactly like a model that cannot
 * follow a schema. Given 3,000 tokens it complied first time.
 *
 * That is why tpmBudget is null here: clamping the completion to fit a per-minute budget, which is
 * the right thing for Groq, would strangle these models before they answer.
 */
const GEMINI_MODELS: Record<Role, string> = {
  // Deliberately pinned rather than the -latest aliases: 8.4 records which model wrote each draft,
  // and an alias makes that record mean something different next month.
  STRONG: "gemini-3.5-flash",
  MID: "gemini-3.5-flash",
  CHEAP: "gemini-3.1-flash-lite",
};

/**
 * A free-tier quirk worth writing down, because it took three wrong guesses to find.
 *
 * On this tier gemini-3.5-flash answers text and returns 429 for anything containing an image —
 * at 2,000, 8,000 and 16,000 max_tokens alike, seconds after a plain text call to the same model
 * succeeded. So it is not request size, and it is not the account being out of quota. Image
 * requests have their own allowance on this model and it is effectively zero.
 *
 * gemini-3.1-flash-lite answers the same image request at 16,000 tokens without complaint.
 *
 * So `visionModel` sends IMAGE REQUESTS ONLY to flash-lite, and nothing else moves — the drafter
 * and the gate keep the stronger model. Josh chose this over paying, knowing the trade: a weaker
 * model draws the first diagram, and he reviews it before it goes anywhere near a post.
 *
 * It is an accommodation, not the design. On Anthropic or a paid Gemini tier `visionModel` is null
 * and the role model does the work, which is what clause 10 assumes.
 */

/** USD per million tokens, for the cost line in the monthly self-report (13.3). */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "openai/gpt-oss-120b": { in: 0.15, out: 0.6 },
  "openai/gpt-oss-20b": { in: 0.05, out: 0.2 },
  // Router pricing at the time of writing. Approximate, and only ever used for the cost line.
  "Qwen/Qwen3-235B-A22B-Instruct-2507": { in: 0.13, out: 0.6 },
  "Qwen/Qwen2.5-72B-Instruct": { in: 0.13, out: 0.4 },
  "meta-llama/Llama-3.3-70B-Instruct": { in: 0.1, out: 0.25 },
  // Free tier at the time of writing. Listed so the monthly cost line stays arithmetic
  // rather than a special case, and so it is not zero by accident if the tier changes.
  "gemini-3.5-flash": { in: 0, out: 0 },
  "gemini-3.1-flash-lite": { in: 0, out: 0 },
};

export type ProviderName = "anthropic" | "groq" | "huggingface" | "gemini";

export function provider(): ProviderName {
  const set = secret("LLM_PROVIDER");
  if (set === "groq") return "groq";
  if (set === "huggingface" || set === "hf") return "huggingface";
  if (set === "gemini" || set === "google") return "gemini";
  return "anthropic";
}

/** The OpenAI-compatible provider in use, or null when Anthropic is. */
function compat(): CompatProvider | null {
  const p = provider();
  return p === "anthropic" ? null : COMPAT[p];
}

/**
 * How fast the current provider may be driven.
 *
 * Exported so callers ask the provider rather than checking its name. gate.ts used to decide this
 * by comparing provider() against the literal "groq", which meant a provider added later with a
 * different limit silently got Anthropic pacing and failed on its first real run. Gemini did
 * exactly that: eight concurrent checks, 429 on the first one.
 */
export function pacing(): { parallel: number; spacingMs: number } {
  const p = compat();
  return p
    ? { parallel: p.maxConcurrent, spacingMs: p.spacingMs }
    : { parallel: 8, spacingMs: 0 };
}

export function modelName(role: Role): string {
  return compat()?.models[role] ?? ANTHROPIC_MODELS[role];
}

export interface CallOptions {
  model: ModelId;
  /** Stable prefix — the reference library. Cached on Anthropic, so drafting and gating pay once. */
  system: string;
  // deno-lint-ignore no-explicit-any
  messages: any[];
  maxTokens?: number;
  /** "low" for mechanical work, "high" for the gate and the drafter. Anthropic only. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** What this call is for, recorded against llm_calls. */
  purpose: string;
  momentId?: number;
  draftId?: number;
  promptVersion?: string;
}

interface Accounting {
  db?: SupabaseClient;
}

function priceOf(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inTok / 1_000_000) * p.in + (outTok / 1_000_000) * p.out;
}

/**
 * Structured call. The schema is enforced at the API layer, so a malformed response is retried by
 * the model rather than crashing a worker on JSON.parse.
 */
export async function callStructured<S extends z.ZodType>(
  schema: S,
  opts: CallOptions,
  acc: Accounting = {},
): Promise<z.infer<S>> {
  const p = compat();
  return p ? await compatStructured(p, schema, opts, acc) : await anthropicStructured(schema, opts, acc);
}

/** Free-text call. Used only where the output genuinely is prose (a question, an SVG). */
export async function callText(opts: CallOptions, acc: Accounting = {}): Promise<string> {
  const p = compat();
  return p ? await compatText(p, opts, acc) : await anthropicText(opts, acc);
}

/**
 * Was that the service failing, or an answer?
 *
 * The distinction is not cosmetic. A gate check that "could not be completed" is recorded as a
 * FAILURE — deliberately, because failing open defeats the point of a gate — and three failures park
 * the moment (9.8). So anything that is really the provider misbehaving must be marked transient and
 * retried, or a perfectly good moment gets parked for reasons that have nothing to do with its
 * quality.
 *
 * 429 and 5xx are obvious. Two others are not, and both were found by watching real drafts fail for
 * reasons that had nothing to do with the writing:
 *
 *   `json_validate_failed` — a 400. The model burned its output budget reasoning before it emitted
 *   the JSON. Seen on the banned_phrases check, which reasons over a long list. The post was fine.
 *
 *   401 / 402 / 403 — the ACCOUNT failing: a bad key, an expired one, or credits run out. Seen live
 *   when a Hugging Face account hit its monthly limit mid-gate: four checks were recorded as
 *   failures, and three of those would have parked the moment (9.8) for a billing problem. A moment
 *   Josh spent ten minutes on must not be destroyed because someone forgot to top up an account.
 *
 * These retry rather than answering. Jobs have a bounded attempt count, so a genuinely wrong key
 * ends as a dead job and a loud error — which is a problem to fix, not a verdict to act on.
 */
function isTransient(status: number, detail: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status === 401 || status === 402 || status === 403) return true;
  return status === 400 &&
    (detail.includes("json_validate_failed") || detail.includes("max completion tokens"));
}

/* ── Anthropic — what ships ───────────────────────────────────────────────── */

function anthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireSecret("ANTHROPIC_API_KEY") });
}

async function anthropicStructured<S extends z.ZodType>(
  schema: S,
  opts: CallOptions,
  acc: Accounting,
): Promise<z.infer<S>> {
  const started = Date.now();
  const model = ANTHROPIC_MODELS[opts.model];

  const request: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: opts.messages,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high", format: zodOutputFormat(schema) },
  };

  // Opus can decline via stop_reason "refusal"; server-side fallback keeps a worker from stalling.
  if (opts.model === "STRONG") {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }

  try {
    // deno-lint-ignore no-explicit-any
    const res: any = await (anthropicClient().messages as any).parse(request);
    await record(acc.db, opts, model, res, started, null);
    if (res.parsed_output == null) {
      throw new Error(`structured output did not parse (stop_reason: ${res.stop_reason})`);
    }
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    await record(acc.db, opts, model, null, started, String(err));
    throw err;
  }
}

async function anthropicText(opts: CallOptions, acc: Accounting): Promise<string> {
  const started = Date.now();
  const model = ANTHROPIC_MODELS[opts.model];

  const request: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: opts.messages,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high" },
  };
  if (opts.model === "STRONG") {
    request.betas = ["server-side-fallback-2026-07-01"];
    request.fallbacks = "default";
  }

  try {
    // deno-lint-ignore no-explicit-any
    const res: any = await (anthropicClient().messages as any).create(request);
    await record(acc.db, opts, model, res, started, null);
    if (res.stop_reason === "refusal") {
      throw new Error(`model declined: ${res.stop_details?.category ?? "unknown"}`);
    }
    // deno-lint-ignore no-explicit-any
    return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  } catch (err) {
    await record(acc.db, opts, model, null, started, String(err));
    throw err;
  }
}

/* ── Groq — OpenAI-compatible, for exercising the pipeline only ───────────── */

/**
 * The OpenAI-compatible providers, described rather than hard-coded, because there are now two and
 * the only differences between them are a URL, a key and a model map.
 *
 * `tpmBudget` is the thing that actually distinguishes them in practice. Groq's free tier allows
 * 8,000 tokens per minute, which eight gate checks cannot fit into however they are scheduled —
 * that constraint is why the gate had to learn to resume. Hugging Face has no comparable ceiling on
 * this account, so a null budget means "do not clamp the completion to fit a minute".
 */
export interface CompatProvider {
  name: "groq" | "huggingface" | "gemini";
  url: string;
  keyName: string;
  models: Record<Role, string>;
  tpmBudget: number | null;
  /**
   * How many calls may be in flight at once, and how long to wait between starting them.
   *
   * Separate from tpmBudget because they are separate limits and conflating them cost a whole
   * debugging pass. Groq caps TOKENS per minute, so its completions are clamped. Gemini caps
   * REQUESTS per minute, so clamping does nothing and the eight gate checks simply have to be
   * spread out. A provider can have either, both or neither.
   */
  maxConcurrent: number;
  spacingMs: number;
  /** Whether this provider carries image blocks. Clause 10 is dead without it. */
  vision: boolean;
  /** Model to use when a request contains an image, if the role model cannot. Usually null. */
  visionModel: string | null;
}

export const COMPAT: Record<"groq" | "huggingface" | "gemini", CompatProvider> = {
  groq: {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyName: "GROQ_API_KEY",
    models: GROQ_MODELS,
    tpmBudget: 7500,
    maxConcurrent: 1,
    spacingMs: 9000,
    vision: false,
    visionModel: null,
  },
  huggingface: {
    name: "huggingface",
    url: "https://router.huggingface.co/v1/chat/completions",
    keyName: "HUGGINGFACE_API_KEY",
    models: HF_MODELS,
    tpmBudget: null,
    maxConcurrent: 8,
    spacingMs: 0,
    vision: false,
    visionModel: null,
  },
  gemini: {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyName: "GEMINI_API_KEY",
    models: GEMINI_MODELS,
    tpmBudget: null,
    // Measured: eight concurrent gate checks return 429 immediately. The free tier limits
    // requests per minute, not tokens, so the fix is spacing rather than smaller completions.
    maxConcurrent: 2,
    spacingMs: 7000,
    // Measured against the compat endpoint with a solid red image: it answered "Red".
    vision: true,
    // Free-tier accommodation, see modelFor(). Remove it the moment billing is on.
    visionModel: "gemini-3.1-flash-lite",
  },
};

/**
 * Groq's free tier counts prompt + max_completion_tokens against a per-minute budget and rejects the
 * request outright if the sum exceeds it — it does not truncate. Asking for a large completion
 * "just in case" therefore fails calls that would comfortably have fitted.
 *
 * So the requested completion is clamped to what is actually left. Rough token estimate: English
 * averages close to four characters per token, and erring high is the safe direction here.
 */
function clampCompletion(
  p: CompatProvider,
  system: string,
  messages: unknown,
  wanted: number,
): number {
  if (p.tpmBudget === null) return wanted;
  const chars = system.length + JSON.stringify(messages).length;
  const promptTokens = Math.ceil(chars / 3.5);
  return Math.max(256, Math.min(wanted, p.tpmBudget - promptTokens));
}

/**
 * Anthropic message content can be a string or an array of blocks; the OpenAI chat format takes
 * either a string or a list of parts.
 *
 * IMAGES USED TO BE DROPPED HERE, SILENTLY
 *
 * The old version flattened every message to text, so an image block vanished on the way out and
 * the visual rebuild was asked to redraw a picture it had never been shown. It failed schema
 * validation five times reaching a conclusion that was knowable before the first attempt.
 *
 * Providers that can see images now get them as content parts. Providers that cannot still get
 * text only — and canSeeImages() stops the job before it starts, so the drop is never the thing a
 * caller discovers. Verified against Gemini with a solid red image: it answered "Red".
 */
// deno-lint-ignore no-explicit-any
function toOpenAIMessages(system: string, messages: any[], vision = false): any[] {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [{ role: "system", content: system }];

  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";

    if (typeof m.content === "string") {
      out.push({ role, content: m.content });
      continue;
    }

    // deno-lint-ignore no-explicit-any
    const blocks: any[] = m.content ?? [];
    // deno-lint-ignore no-explicit-any
    const hasImage = vision && blocks.some((b: any) => b.type === "image");

    if (!hasImage) {
      out.push({
        role,
        // deno-lint-ignore no-explicit-any
        content: blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n"),
      });
      continue;
    }

    // deno-lint-ignore no-explicit-any
    const parts = blocks.map((b: any) => {
      if (b.type === "text") return { type: "text", text: b.text };
      if (b.type === "image" && b.source?.type === "base64") {
        return {
          type: "image_url",
          image_url: {
            url: `data:${b.source.media_type ?? "image/png"};base64,${b.source.data}`,
          },
        };
      }
      return null;
    }).filter(Boolean);

    out.push({ role, content: parts });
  }

  return out;
}

/**
 * Strict JSON-schema mode rejects a schema that permits unspecified keys, and requires every
 * property to be listed as required. zod's own JSON Schema output does neither, so it is tightened
 * here rather than by hand-maintaining a second copy of every schema.
 */
function tighten(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tighten);
  if (node && typeof node === "object") {
    const o = { ...(node as Record<string, unknown>) };
    for (const [k, v] of Object.entries(o)) o[k] = tighten(v);
    if (o.type === "object" && o.properties && typeof o.properties === "object") {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as Record<string, unknown>);
    }
    return o;
  }
  return node;
}

async function compatStructured<S extends z.ZodType>(
  p: CompatProvider,
  schema: S,
  opts: CallOptions,
  acc: Accounting,
): Promise<z.infer<S>> {
  const started = Date.now();
  const model = modelFor(p, opts);
  const jsonSchema = tighten(z.toJSONSchema(schema, { io: "output" }));

  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireSecret(p.keyName)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: clampCompletion(p, opts.system, opts.messages, opts.maxTokens ?? 4000),
        messages: toOpenAIMessages(opts.system, opts.messages, p.vision),
        response_format: {
          type: "json_schema",
          json_schema: { name: "result", strict: true, schema: jsonSchema },
        },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`${isTransient(res.status, detail) ? "TRANSIENT " : ""}${p.name} ${res.status}: ${detail}`);
    }

    const data = await res.json();
    await record(acc.db, opts, model, normaliseUsage(data), started, null);

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${p.name} returned no content`);
    return schema.parse(JSON.parse(text)) as z.infer<S>;
  } catch (err) {
    await record(acc.db, opts, model, null, started, String(err));
    throw err;
  }
}

/**
 * Which model this request goes to.
 *
 * Normally the role map. The exception is an image on a provider whose role model cannot carry
 * one: gemini-3.5-flash returns 429 for anything containing an image on the free tier, at every
 * token budget, seconds after a text call to the same model succeeds. Its own flash-lite handles
 * the identical request.
 *
 * So the swap is scoped to requests that actually contain an image, and nothing else moves. The
 * drafter and the gate keep the stronger model. This is a free-tier accommodation and is written
 * down as one - on a paid tier or on Anthropic, visionModel is null and this does nothing.
 */
// deno-lint-ignore no-explicit-any
export function modelFor(p: CompatProvider, opts: CallOptions): string {
  const role = p.models[opts.model];
  if (!p.visionModel) return role;
  // deno-lint-ignore no-explicit-any
  const hasImage = (opts.messages ?? []).some((m: any) =>
    Array.isArray(m?.content) && m.content.some((b: any) => b?.type === "image")
  );
  return hasImage ? p.visionModel : role;
}

async function compatText(p: CompatProvider, opts: CallOptions, acc: Accounting): Promise<string> {
  const started = Date.now();
  // Was GROQ_MODELS regardless of provider, so a text call under Hugging Face or Gemini asked
  // for a Groq model name. It only ever produced a provider error, never a wrong answer - but it
  // meant no non-Groq provider could serve a plain text call at all.
  const model = modelFor(p, opts);

  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireSecret(p.keyName)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_completion_tokens: clampCompletion(p, opts.system, opts.messages, opts.maxTokens ?? 2000),
        messages: toOpenAIMessages(opts.system, opts.messages, p.vision),
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`${isTransient(res.status, detail) ? "TRANSIENT " : ""}${p.name} ${res.status}: ${detail}`);
    }

    const data = await res.json();
    await record(acc.db, opts, model, normaliseUsage(data), started, null);
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    await record(acc.db, opts, model, null, started, String(err));
    throw err;
  }
}

// deno-lint-ignore no-explicit-any
function normaliseUsage(data: any) {
  return {
    usage: {
      input_tokens: data?.usage?.prompt_tokens ?? 0,
      output_tokens: data?.usage?.completion_tokens ?? 0,
    },
    stop_reason: data?.choices?.[0]?.finish_reason ?? null,
  };
}

/* ── Accounting ───────────────────────────────────────────────────────────── */

async function record(
  db: SupabaseClient | undefined,
  opts: CallOptions,
  model: string,
  // deno-lint-ignore no-explicit-any
  res: any,
  started: number,
  error: string | null,
): Promise<void> {
  if (!db) return;
  const usage = res?.usage ?? {};
  const inTok = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const outTok = usage.output_tokens ?? 0;
  try {
    await db.from("llm_calls").insert({
      purpose: opts.purpose,
      model,
      // 15.9 — which service was BILLED, as against which model was asked for. The two stopped
      // matching the moment Groq began serving a model called "openai/gpt-oss-120b".
      provider: provider(),
      moment_id: opts.momentId ?? null,
      draft_id: opts.draftId ?? null,
      prompt_version: opts.promptVersion ?? null,
      input_tokens: inTok,
      output_tokens: outTok,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      cost_usd: priceOf(model, inTok, outTok),
      latency_ms: Date.now() - started,
      stop_reason: res?.stop_reason ?? null,
      error,
    });
  } catch {
    // Never let accounting failures take down real work.
  }

  // 15.3 — Josh is told at the time about a service he was not told about before. Same swallow-all
  // rule as above: this is bookkeeping attached to real work and must not be able to break it.
  await noteProvider(db, provider(), purposeOf(opts.purpose));
}

/** Map an internal purpose onto the plain words Josh gets told (15.3). */
function purposeOf(purpose: string): ProviderPurpose {
  switch (purpose) {
    case "draft":
      return "drafting";
    case "gate":
      return "gate";
    case "interview_step":
    case "interview_extract":
    case "voice_guide":
      return "interview";
    case "triage":
      return "triage";
    case "learn":
    case "monthly_report":
      return "learning";
    case "visual":
      return "visual";
    default:
      return "drafting";
  }
}

/* ── Living inside a per-minute token budget ─────────────────────────────── */

/**
 * How much of the provider's per-minute allowance is left, or null when it has no meaningful one.
 *
 * WHY THE QUEUE NEEDS TO KNOW THIS
 *
 * The dispatcher used to claim a batch and race the provider. Nothing anywhere knew there was a
 * ceiling, so a burst of genuine use guaranteed rate limits — which is exactly what happened the
 * first time the system was used properly: a voice note, an image and a prompted session arrived
 * together, and every job behind them sat pending on 429s, burning retry attempts on a problem no
 * amount of retrying solves.
 *
 * Discovering a budget by failing against it is the wrong shape. `llm_calls` already records every
 * call's tokens with a `created_at` index, so the spend of the last minute is one cheap query and
 * the queue can simply decline to start work it cannot finish.
 *
 * On Anthropic — or any provider without a per-minute wall — this returns null and every caller
 * treats that as "no limit". None of it is wasted work when the key changes; it just stops applying.
 */
export async function budgetRemaining(db: SupabaseClient): Promise<number | null> {
  const p = compat();
  if (!p?.tpmBudget) return null;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { data } = await db
    .from("llm_calls")
    .select("input_tokens, output_tokens")
    .gte("created_at", since)
    .limit(500);

  const spent = (data ?? []).reduce(
    (sum, c) => sum + (c.input_tokens ?? 0) + (c.output_tokens ?? 0),
    0,
  );
  return Math.max(0, p.tpmBudget - spent);
}

/**
 * What one more job of this kind will cost, in tokens.
 *
 * MEASURED, not guessed. From `llm_calls` over three days of real running:
 *
 *   draft            avg 4,689   max 5,788
 *   extract          avg 2,751   max 4,156
 *   interview        avg 2,191   max 3,384
 *   gate, per check  avg 1,500–2,000, and a gate job runs up to eight of them
 *   triage           avg 1,057
 *   rephrase         avg 459
 *
 * The first version of this table was invented and put `gate` at 3,500 — for a job that spends
 * closer to 15,000 across its eight checks. Under-estimating is the failure that matters here:
 * the queue lets work start that it cannot finish, which is precisely the 429 the budget exists
 * to avoid.
 *
 * So these are MAXIMA rounded up, not averages. Reserving too much costs a minute of delay;
 * reserving too little costs a rate limit and a burnt retry.
 */
export function estimatedCost(jobType: string): number {
  switch (jobType) {
    case "gate":
      // Eight checks. It resumes across invocations, so a run may spend less — but the queue must
      // assume the full cost or it will start one it cannot finish.
      return 16000;
    case "draft":
      return 6000;
    case "visual":
      return 6000; // an image goes in with the prompt, where the provider carries one
    case "interview_extract":
      return 4500;
    case "interview_step":
      return 3500;
    case "learn":
      return 8000;
    case "triage":
      return 1500;
    default:
      return 1500;
  }
}

/**
 * Whether the active provider can realistically run a job of this kind at all.
 *
 * A full gate needs about 16,000 tokens and Groq's free tier allows 8,000 a minute, so no amount of
 * scheduling makes it fit into one invocation — which is why the gate learned to resume. Saying so
 * out loud beats discovering it as a rate limit every four hours.
 */
export function exceedsProviderCeiling(jobType: string): boolean {
  const p = compat();
  return p?.tpmBudget != null && estimatedCost(jobType) > p.tpmBudget;
}

/**
 * Can the active provider actually carry an image?
 *
 * Only Anthropic today. `toOpenAIMessages` drops image blocks, because the OpenAI-compatible chat
 * shape this file speaks takes a string per message — so on Groq or Hugging Face the visual rebuild
 * is asked to redraw a picture it was never shown, and fails schema validation five times arriving
 * at a conclusion that was knowable before the first attempt.
 *
 * One function rather than a provider-name check scattered through the callers: adding a
 * vision-capable provider should be one edit in one place, and clause 10 should start working the
 * moment it is.
 */
export function canSeeImages(): boolean {
  const p = compat();
  return p ? p.vision : true; // no compat provider means Anthropic, which sees images
}
