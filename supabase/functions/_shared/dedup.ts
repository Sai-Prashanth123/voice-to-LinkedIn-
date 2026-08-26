/**
 * 7.2 — "check against what has already been published and not retell a story Josh has already
 * told. Rewriting an angle is fine. Repeating the anecdote is not."
 *
 * WHAT WAS WRONG WITH THE FIRST VERSION
 *
 * It compared against the published archive only. The spec asks for the archive *and* other mined
 * moments, and the gap was not academic: nothing is published for days after it is selected, so two
 * moments telling the same story would both be queued and both drafted before either could appear
 * in the archive to warn about the other.
 *
 * And it failed open. `embed()` threw because no provider was configured, the caller caught it,
 * returned null, and every candidate read as new ground. On the one system whose entire job is
 * saying something only Josh could say, a duplicate check that silently passes everything is worse
 * than no check at all — because the code, the comments and the settings all say it is running.
 *
 * So: three comparison sets, two methods, and a fourth verdict. `unavailable` holds the moment and
 * raises an error rather than shrugging it through. A story kept for four hours costs nothing. A
 * story Josh has already told, published under his name, costs him the thing he is paying for.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting, logEvent } from "./db.ts";
import { embed, embeddingModel, sourceHash } from "./embeddings.ts";
import { callStructured, MODELS } from "./llm.ts";
import { RetellingSchema } from "./schemas.ts";

export type Verdict = "block" | "warn" | "clear" | "unavailable";

export interface DedupResult {
  verdict: Verdict;
  /** 0–1 where it came from embeddings; null where the model made the call or nothing was found. */
  similarity: number | null;
  /** What it resembles, in words Josh could read. */
  against: string | null;
  /** Which method reached the verdict, so a surprising result can be traced. */
  method: "embeddings" | "model" | "none";
}

export interface DedupThresholds {
  block: number;
  warn: number;
}

/**
 * Thresholds are a property of the MODEL, not of the task.
 *
 * The first version inherited 0.88 / 0.78 from text-embedding-3-small and kept them when the
 * provider changed. Measured against BAAI/bge-m3 on real material, a straight retelling of the same
 * incident scores 0.71–0.79 and two genuinely different stories on the same theme top out at 0.64.
 * So the old numbers would have blocked nothing at all — the check would have run every four hours,
 * logged healthily, and caught not one duplicate.
 *
 * That is the failure mode this whole file exists to prevent, so a mismatch between the calibration
 * model and the active one is stated out loud rather than assumed harmless.
 */
export async function loadThresholds(db: SupabaseClient): Promise<DedupThresholds> {
  const block = await getSetting(db, "dedupe_block_similarity", 0.7);
  const warn = await getSetting(db, "dedupe_warn_similarity", 0.62);
  const calibratedFor = await getSetting<string | null>(db, "dedupe_thresholds_model", null);
  const active = embeddingModel();

  if (active && calibratedFor && active !== calibratedFor) {
    await logEvent(db, "dedup_thresholds_uncalibrated", "warn", {
      calibrated_for: calibratedFor,
      active_model: active,
      consequence:
        "similarity scales differ between embedding models — these thresholds are guesses until " +
        "they are re-measured against the model actually in use",
    });
  }

  return { block, warn };
}

/**
 * Has Josh told this story before?
 *
 * `text` is the moment's material, not a draft — the check happens before anything is written, so
 * a retelling costs nothing to catch.
 */
export async function checkRetelling(
  db: SupabaseClient,
  momentId: number,
  text: string,
  thresholds: DedupThresholds,
): Promise<DedupResult> {
  if (!text.trim()) {
    return { verdict: "clear", similarity: null, against: null, method: "none" };
  }

  try {
    return await byEmbeddings(db, momentId, text, thresholds);
  } catch (err) {
    await logEvent(db, "dedup_embeddings_failed", "warn", {
      moment_id: momentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // The spec allows either method — "needs embeddings or an LLM comparison pass". So a missing
  // embedding provider degrades the check rather than switching it off.
  try {
    return await byModel(db, momentId, text);
  } catch (err) {
    // Both routes gone. This is the branch that used to return "clear" and say nothing.
    await logEvent(db, "dedup_unavailable", "error", {
      moment_id: momentId,
      error: err instanceof Error ? err.message : String(err),
      consequence: "moment held rather than written — 7.2 could not be checked",
    });
    return { verdict: "unavailable", similarity: null, against: null, method: "none" };
  }
}

/* ── Embeddings ───────────────────────────────────────────────────────────── */

async function byEmbeddings(
  db: SupabaseClient,
  momentId: number,
  text: string,
  thresholds: DedupThresholds,
): Promise<DedupResult> {
  const model = embeddingModel();
  if (!model) throw new Error("no embedding provider configured");

  // Reuse the cached vector when the material has not changed. The selector runs every four hours
  // over the same shortlist, so without this every moment is re-embedded six times a day for no
  // reason — and Hugging Face is slow enough cold that it dominates the run.
  //
  // Keyed on a hash of the text, not on time: 6.1 makes editing material a first-class action, and a
  // vector for the previous wording would answer confidently about a story that has since changed.
  const hash = await sourceHash(text);
  const { data: cached } = await db
    .from("moment_embeddings")
    .select("embedding, source_hash, embedding_model")
    .eq("moment_id", momentId)
    .maybeSingle();

  let vector: number[];
  if (cached && cached.source_hash === hash && cached.embedding_model === model) {
    // pgvector comes back over PostgREST as its text form, "[0.1,0.2,...]".
    vector = typeof cached.embedding === "string"
      ? JSON.parse(cached.embedding)
      : cached.embedding as number[];
  } else {
    vector = (await embed(text)).vector;
    await db.from("moment_embeddings").upsert({
      moment_id: momentId,
      embedding: vector as unknown as string,
      embedding_model: model,
      source_hash: hash,
      updated_at: new Date().toISOString(),
    });
  }

  const [published, inFlight] = await Promise.all([
    db.rpc("match_published", {
      query_embedding: vector as unknown as string,
      model,
      match_count: 1,
    }),
    db.rpc("match_moments", {
      query_embedding: vector as unknown as string,
      model,
      exclude_moment: momentId,
      match_count: 1,
    }),
  ]);

  const topPublished = (published.data ?? [])[0];
  const topMoment = (inFlight.data ?? [])[0];

  const best = [
    topPublished
      ? { similarity: topPublished.similarity as number, against: describePublished(topPublished) }
      : null,
    topMoment
      ? { similarity: topMoment.similarity as number, against: describeMoment(topMoment) }
      : null,
  ].filter(Boolean).sort((a, b) => b!.similarity - a!.similarity)[0];

  if (!best) return { verdict: "clear", similarity: null, against: null, method: "embeddings" };

  const verdict: Verdict = best.similarity >= thresholds.block
    ? "block"
    : best.similarity >= thresholds.warn
    ? "warn"
    : "clear";

  return {
    verdict,
    similarity: best.similarity,
    against: best.against,
    method: "embeddings",
  };
}

// deno-lint-ignore no-explicit-any
function describePublished(row: any): string {
  const when = row.posted_on ? ` (${row.posted_on})` : "";
  return `a post you published${when}: "${firstLine(row.body)}"`;
}

// deno-lint-ignore no-explicit-any
function describeMoment(row: any): string {
  return `${row.ref}, which is already ${row.status}`;
}

/* ── The fallback: ask the model ──────────────────────────────────────────── */

const COMPARE_SYSTEM =
  `You are checking one thing: has this story already been told?

Josh publishes on LinkedIn. He must never publish the same anecdote twice. But writing about the
same THEME from a different angle, or reaching a different conclusion, is entirely fine and normal —
that is not a retelling.

A retelling means the same specific incident: the same conversation, the same person, the same
moment in time. Two posts about hiring are not a retelling. Two posts about the day a candidate
walked out of an interview, told from either end, are.

If you are not sure, say it is not a retelling. A false positive silences a story Josh has never
told, which is worse than a near-miss he can see for himself in the draft.`;

async function byModel(
  db: SupabaseClient,
  momentId: number,
  text: string,
): Promise<DedupResult> {
  const [{ data: published }, { data: inFlight }] = await Promise.all([
    db.from("published_archive").select("body, posted_on")
      .order("posted_on", { ascending: false, nullsFirst: false }).limit(25),
    db.from("moments")
      .select("ref, status, material(the_moment, the_detail, the_realisation)")
      .in("status", ["queued", "drafted", "gated", "scheduled"])
      .eq("killed", false)
      .neq("id", momentId)
      .limit(25),
  ]);

  const priorPosts = (published ?? []).map((p, i) => `[P${i + 1}] ${firstLine(p.body, 300)}`);
  const priorMoments = (inFlight ?? []).map((m, i) => {
    // deno-lint-ignore no-explicit-any
    const mat = (m as any).material;
    const one = Array.isArray(mat) ? mat[0] : mat;
    const summary = [one?.the_moment, one?.the_detail, one?.the_realisation]
      .filter(Boolean).join(" ");
    return `[${m.ref}] ${firstLine(summary, 300)}`;
  }).filter((line) => line.trim().length > 12);

  if (priorPosts.length === 0 && priorMoments.length === 0) {
    return { verdict: "clear", similarity: null, against: null, method: "model" };
  }

  const result = await callStructured(RetellingSchema, {
    model: MODELS.SONNET,
    system: COMPARE_SYSTEM,
    messages: [{
      role: "user",
      content: `THE NEW MOMENT:\n${text.slice(0, 4000)}\n\n` +
        `ALREADY PUBLISHED:\n${priorPosts.join("\n\n") || "(nothing yet)"}\n\n` +
        `ALREADY WAITING TO BE WRITTEN:\n${priorMoments.join("\n\n") || "(nothing)"}`,
    }],
    effort: "low",
    maxTokens: 700,
    purpose: "dedup",
    momentId,
  }, { db });

  return {
    verdict: result.is_retelling ? "block" : result.same_theme_different_angle ? "warn" : "clear",
    similarity: null,
    against: result.matches?.trim() || null,
    method: "model",
  };
}

function firstLine(body: string, max = 120): string {
  const line = (body ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
