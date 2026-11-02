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
 * Which vector provider is configured, if any. **An optional accelerator, not a dependency.**
 *
 * HUGGING FACE WAS DROPPED ON 2 NOVEMBER. Its key had been returning a billing error for weeks, and
 * every retelling check since raised a standing warning that nobody reading it could clear. The
 * check never stopped working — clause 7.2 allows "embeddings OR an LLM comparison pass", and
 * `dedup.ts` now runs the model comparison as the primary path. See the long note there.
 *
 * So this returns null on a normal deployment, and that is the intended state rather than a fault.
 * Nothing calls `embed()` unless this returns a provider.
 *
 * OpenAI is kept as the one remaining option because `text-embedding-3-small` can be asked for 1024
 * dimensions, which is what the column holds — a provider whose natural width is different would
 * silently write vectors that cannot be compared with the ones already stored. `embedding_model` is
 * what records which produced a given row, and vectors are only ever compared within one model.
 *
 * Re-adding a provider is one line. Do it for cost, never because the check is broken without one.
 */
export function embeddingProvider(): "openai" | null {
  if (secret("OPENAI_API_KEY")) return "openai";
  return null;
}

/*
 * BAAI/bge-m3 was the model here until 2 November, and the dedup thresholds were calibrated against
 * it: 0.70 to block, 0.62 to warn. Any row still carrying that model name was measured on that
 * scale, which is exactly why vectors are only ever compared within one `embedding_model`. The
 * name is gone from the code and stays on the rows.
 */
const OPENAI_MODEL = "text-embedding-3-small";

export function embeddingModel(): string | null {
  return embeddingProvider() === "openai" ? OPENAI_MODEL : null;
}

export async function embed(text: string): Promise<Embedding> {
  const provider = embeddingProvider();
  if (!provider) {
    /*
     * Not an error condition on a normal deployment. Since 2 November the retelling check runs the
     * model comparison as its primary path and only reaches here when a provider is configured, so
     * a caller should test embeddingProvider() rather than catch this.
     */
    throw new Error("no embedding provider configured (OPENAI_API_KEY)");
  }

  const vector = await embedOpenAI(text);

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    // Storing this would poison every future comparison, so it fails here instead.
    throw new Error(
      `embedding returned ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  return { vector, model: OPENAI_MODEL };
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
