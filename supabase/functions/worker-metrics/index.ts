/**
 * 12.1 — engagement numbers pulled seven days after publishing and written against the originating
 * moment, with no action from Josh at any point.
 *
 * Runs from the `metrics` jobs that worker-publish scheduled seven days out. Nothing here asks Josh
 * for anything, and nothing here fails a post: if the analytics scope has not been granted yet, the
 * gap is recorded and the learning loop carries on with draft-vs-published (12.3).
 */

import { admin, logEvent } from "../_shared/db.ts";
import { noteProvider } from "../_shared/providers.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { runWorker } from "../_shared/jobs.ts";
import { fetchMetrics, getAuth } from "../_shared/linkedin.ts";

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);

  // Sweep for anything overdue that the queue missed, then let the harness run the due jobs.
  const { data: stale } = await db
    .from("posts")
    .select("id, published_at")
    .eq("status", "published")
    .lte("published_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .limit(50);

  for (const p of stale ?? []) {
    const { data: outcome } = await db
      .from("outcomes")
      .select("metrics_pulled_at")
      .eq("post_id", p.id)
      .maybeSingle();
    if (outcome?.metrics_pulled_at) continue;

    await db.from("jobs").insert({
      type: "metrics",
      payload: { post_id: p.id },
      dedupe_key: `metrics:${p.id}`,
    }).select().maybeSingle();
  }

  return await runWorker({ name: "metrics", types: ["metrics"], batch: 10 }, async (db, job) => {
    const postId = Number(job.payload.post_id);

    const { data: post } = await db
      .from("posts")
      .select("id, moment_id, linkedin_urn")
      .eq("id", postId)
      .single();
    if (!post) return;

    // Published with no URN is an anomaly rather than a normal state, but silently returning left
    // the sweep to find it again tomorrow and every day after. Recorded, so it stops and is visible.
    if (!post.linkedin_urn) {
      await db.from("outcomes").upsert({
        post_id: postId,
        moment_id: post.moment_id,
        metrics_pulled_at: new Date().toISOString(),
        metrics_error: "No LinkedIn URN on this post — it was not published through the system.",
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Two different ways to have no numbers, and neither is a failure of this post.
    //
    // 12.1 says the pull needs nothing from Josh, and 12.3 says the learning carries on regardless.
    // `getAuth` THROWS when LinkedIn was never connected, which failed the job, retried it five
    // times and killed it — and because the dedupe key is one per post, that post's numbers were
    // then lost for good. A missing connection is the same situation as a missing scope: we cannot
    // read metrics, so record why and move on.
    //
    // Deliberately unlike worker-publish, where a missing connection SHOULD fail loudly. There a
    // post did not go out and Josh needs to know. Here nothing is broken except a number.
    let metrics = null;
    let unavailable: string | null = null;

    try {
      const auth = await getAuth(db);
      metrics = await fetchMetrics(auth, post.linkedin_urn);
      await noteProvider(db, "linkedin", "publishing");
      if (!metrics) {
        unavailable =
          "r_member_postAnalytics not granted — Community Management API access is still pending.";
      }
    } catch (err) {
      unavailable = err instanceof Error ? err.message : String(err);
    }

    if (unavailable || !metrics) {
      // Recorded once. `metrics_pulled_at` being set is what stops the daily sweep re-queueing it.
      await db.from("outcomes").upsert({
        post_id: postId,
        moment_id: post.moment_id,
        metrics_pulled_at: new Date().toISOString(),
        metrics_error: unavailable,
        updated_at: new Date().toISOString(),
      });
      await logEvent(db, "metrics_unavailable", "info", { post_id: postId, reason: unavailable });
      return;
    }

    await db.from("outcomes").upsert({
      post_id: postId,
      moment_id: post.moment_id,
      impressions: metrics.impressions,
      reach: metrics.reach,
      reactions: metrics.reactions,
      comments: metrics.comments,
      reshares: metrics.reshares,
      metrics_pulled_at: new Date().toISOString(),
      metrics_error: null,
      updated_at: new Date().toISOString(),
    });
  });
});

