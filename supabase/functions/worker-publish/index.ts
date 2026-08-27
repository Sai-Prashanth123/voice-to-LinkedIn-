/**
 * Step 8 — published to LinkedIn, on the date Josh set (clause 11).
 *
 *   "The system never publishes on its own, under any circumstance."
 *
 * Read that carefully alongside 11.2: "Publishing follows only from Josh marking a post ready."
 * Scheduled publishing IS intended — what is forbidden is publishing anything he has not approved.
 * So this worker only ever acts on rows that are `status = 'scheduled'` with a `marked_ready_at`,
 * and the database will not let such a row exist otherwise (migration 0003 check constraints).
 *
 * Acceptance test 11 allows zero exceptions across four weeks, which is why the guarantee lives in
 * the schema rather than in this file.
 */

import { admin, logEvent } from "../_shared/db.ts";
import { noteProvider } from "../_shared/providers.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { recordEditDiff } from "../_shared/outcome.ts";
import { embed, embeddingProvider } from "../_shared/embeddings.ts";
import { json } from "../_shared/jobs.ts";
import { getAuth, publish } from "../_shared/linkedin.ts";
import { joshChatId, sendMessage } from "../_shared/telegram.ts";

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);

  const { data: due } = await db
    .from("posts")
    .select("id, moment_id, draft_id, body, visual_id, scheduled_for, marked_ready_at")
    .eq("status", "scheduled")
    .not("marked_ready_at", "is", null)
    .lte("scheduled_for", new Date().toISOString())
    .limit(5);

  if (!due || due.length === 0) return json({ ok: true, published: 0 });

  const results: { id: number; ok: boolean; error?: string }[] = [];

  for (const post of due) {
    try {
      const auth = await getAuth(db);

      let image: { bytes: Uint8Array<ArrayBuffer>; altText: string } | undefined;
      if (post.visual_id) {
        const { data: visual } = await db
          .from("visuals")
          .select("rendered_path")
          .eq("id", post.visual_id)
          .maybeSingle();
        if (visual?.rendered_path) {
          const { data: file } = await db.storage.from("renders").download(visual.rendered_path);
          if (file) {
            image = {
              bytes: new Uint8Array(await file.arrayBuffer()),
              altText: post.body.slice(0, 300),
            };
          }
        }
      }

      const urn = await publish(auth, post.body, image);
      await noteProvider(db, "linkedin", "publishing");

      await db.from("posts").update({
        status: "published",
        published_at: new Date().toISOString(),
        linkedin_urn: urn,
        publish_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", post.id);

      await db.from("moments").update({ status: "published" }).eq("id", post.moment_id);

      await recordOutcome(db, post);

      // 12.1 — the metrics pull is scheduled now, seven days out, so it needs nothing from Josh.
      await db.from("jobs").insert({
        type: "metrics",
        payload: { post_id: post.id },
        run_after: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        dedupe_key: `metrics:${post.id}`,
      });

      results.push({ id: post.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from("posts").update({ status: "failed", publish_error: message }).eq("id", post.id);
      // 13.2 — Josh hears about it rather than finding a gap in his feed.
      await logEvent(db, "publish_failed", "error", { post_id: post.id, error: message });
      try {
        await sendMessage(
          joshChatId(),
          `A post did not go out and needs you: ${message}\n\nIt is still in the calendar.`,
        );
      } catch { /* logged above */ }
      results.push({ id: post.id, ok: false, error: message });
    }
  }

  return json({ ok: true, published: results.filter((r) => r.ok).length, results });
});

/**
 * 12.2 at publish time, plus the dedup archive.
 *
 * The diff itself has already been taken — `recordEditDiff` runs when Josh MARKS THE POST READY, on
 * both surfaces, because that is the moment the edit exists and it needs nothing from LinkedIn. This
 * call refreshes it only if the body moved again between approval and publishing.
 *
 * That split is the whole point. This function used to be the ONLY writer of the diff, so with
 * LinkedIn unconnected the signal 12.3 requires to stand on its own produced nothing at all: two
 * published posts, zero rows with a draft body, `edit_class` null everywhere.
 */
// deno-lint-ignore no-explicit-any
async function recordOutcome(db: any, post: any): Promise<void> {
  await recordEditDiff(db, post.id, "published");

  // Everything published joins the dedup index, so the system will not retell this story (7.2).
  try {
    const { vector, model } = await embed(post.body);
    await noteProvider(db, embeddingProvider() ?? "", "embeddings");
    await db.from("published_archive").insert({
      origin: "system",
      moment_id: post.moment_id,
      body: post.body,
      posted_on: new Date().toISOString().slice(0, 10),
      embedding: vector,
      // Stored with the vector because comparison only ever happens within one model — see
      // `_shared/embeddings.ts`. A row without it can never be compared against anything.
      embedding_model: model,
    });
  } catch (err) {
    // The post is published; that is not in doubt and must not be undone by a dedup failure. But it
    // is now a story the selector cannot see, so it is recorded rather than swallowed: a silently
    // missing archive row is a retelling waiting to happen (7.2).
    await logEvent(db, "archive_embedding_failed", "warn", {
      post_id: post.id,
      error: err instanceof Error ? err.message : String(err),
      consequence: "published, but not in the retelling index until this is backfilled",
    });
    await db.from("published_archive").insert({
      origin: "system",
      moment_id: post.moment_id,
      body: post.body,
      posted_on: new Date().toISOString().slice(0, 10),
    });
  }
}
