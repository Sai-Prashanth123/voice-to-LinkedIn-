/**
 * Embeddings, used for one thing only: 7.2 — "not retell a story Josh has already told".
 *
 *   "Rewriting an angle is fine. Repeating the anecdote is not."
 *
 * The vectors live on `published_archive` and `moment_embeddings`, read by the selector and by
 * nothing else. This is NOT a retrieval source for the drafter. Clause 8a is explicit that Josh's
 * back catalogue must never inform how a post is written — it is there to tell us what has already
 * been said, and that is the whole of its job.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT
 *
 * Every vector carries the model that produced it, and `EMBEDDING_DIMENSIONS` is asserted on the way
 * out. Cosine similarity between two different embedding spaces is a meaningless number that still
 * comes back looking confident — and a confidently wrong 0.91 would block a moment that shares
 * nothing with anything, or let a straight retelling through. The model is stored so comparison can
 * be restricted to vectors that are actually comparable.
 *
 * And it throws rather than returning null. The previous version's caller caught the throw and
 * carried on, which meant 7.2 was silently unenforced for as long as no key was configured. Callers
 * must now decide what to do about a failure, and `dedup.ts` decides to hold the moment.
 */

import { secret } from "./secrets.ts";

/** Must match the vector() column width in migration 0018. */
export const EMBEDDING_DIMENSIONS = 1024;

export interface Embedding {
  vector: number[];
  /** What produced it. Only ever compare vectors sharing this value. */
  model: string;
}

/**
 * Hugging Face first, because that is what is configured; OpenAI if a key for it appears.
 *
 * Both are 1024-dimension choices deliberately, so a provider swap does not silently write vectors
 * the column cannot hold — text-embedding-3-small is asked for 1024 rather than its default 1536.
 * Old vectors still become uncomparable on a swap, which is what `embedding_model` records.
 */
export function embeddingProvider(): "huggingface" | "openai" | null {
  if (secret("HUGGINGFACE_API_KEY")) return "huggingface";
  if (secret("OPENAI_API_KEY")) return "openai";
  return null;
}

const HF_MODEL = "BAAI/bge-m3";
const OPENAI_MODEL = "text-embedding-3-small";

export function embeddingModel(): string | null {
  const p = embeddingProvider();
  if (p === "huggingface") return HF_MODEL;
  if (p === "openai") return OPENAI_MODEL;
  return null;
}

export async function embed(text: string): Promise<Embedding> {
  const provider = embeddingProvider();
  if (!provider) {
    throw new Error("no embedding provider configured (HUGGINGFACE_API_KEY or OPENAI_API_KEY)");
  }

  const vector = provider === "huggingface"
    ? await embedHuggingFace(text)
    : await embedOpenAI(text);

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    // Storing this would poison every future comparison, so it fails here instead.
    throw new Error(
      `embedding returned ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  return { vector, model: provider === "huggingface" ? HF_MODEL : OPENAI_MODEL };
}

async function embedHuggingFace(text: string): Promise<number[]> {
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret("HUGGINGFACE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      // wait_for_model because a cold model returns 503 rather than queueing, and a 503 here would
      // read as "cannot check" and hold a perfectly good moment.
      body: JSON.stringify({ inputs: clip(text), options: { wait_for_model: true } }),
    },
  );
  if (!res.ok) throw new Error(`huggingface embeddings ${res.status}: ${await res.text()}`);

  const data = await res.json();
  // The feature-extraction pipeline returns either a flat vector or a one-element batch.
  const vector = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : data;
  if (!Array.isArray(vector) || typeof vector[0] !== "number") {
    throw new Error("huggingface embeddings returned no vector");
  }
  return vector as number[];
}

async function embedOpenAI(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: clip(text),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("openai embeddings returned no vector");
  return vector as number[];
}

function clip(text: string): string {
  return text.slice(0, 8000);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * A stable fingerprint of the text a stored vector was made from.
 *
 * Material gets edited — 6.1 makes that a first-class action now — and a cached vector for the old
 * text would keep answering "has he told this story" about a story that has since changed.
 */
export async function sourceHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
