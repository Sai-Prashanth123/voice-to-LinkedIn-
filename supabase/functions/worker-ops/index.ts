/**
 * Operations (clause 13) and the monthly reports (12.14, 13.3).
 *
 *   "The main operational risk is not that the system breaks. It is that it breaks quietly and Josh
 *    finds out three weeks later when the calendar is empty."
 *
 * Daily:   silence check (13.1), input health (13.2), queue-low warning (13.4), token expiry.
 * Monthly: what is working and what is not (12.14), and the system's report on itself (13.3).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callStructured, MODELS } from "../_shared/llm.ts";
import { admin, embedOne, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { meetsAcceptanceBar } from "../_shared/diff.ts";
import { json } from "../_shared/jobs.ts";
import { LEARN_SYSTEM, PROMPT_VERSION } from "../_shared/prompts.ts";
import { rephraseDeadQuestions } from "../_shared/questions.ts";
import { ReportSchema } from "../_shared/schemas.ts";
import { joshChatId, sendMessage } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  const db = admin();
  await loadSecrets(db);
  let mode = "daily";
  try {
    const body = await req.json();
    if (body?.mode) mode = String(body.mode);
  } catch { /* default to daily */ }

  return mode === "monthly" ? await monthly(db) : await daily(db);
});

async function daily(db: SupabaseClient): Promise<Response> {
  const alerts: string[] = [];

  const silenceDays = await getSetting(db, "silence_alert_days", 4);
  const target = await getSetting(db, "queue_target_posts", 10);

  // 13.1 — silence is not the same as nothing happening.
  const since = new Date(Date.now() - silenceDays * 86_400_000).toISOString();
  const [{ count: captured }, { count: drafted }, { count: scheduled }] = await Promise.all([
    db.from("moments").select("*", { count: "exact", head: true }).gte("captured_at", since),
    db.from("drafts").select("*", { count: "exact", head: true }).gte("created_at", since),
    db.from("posts").select("*", { count: "exact", head: true }).gte("updated_at", since)
      .in("status", ["scheduled", "published"]),
  ]);

  if ((captured ?? 0) === 0 && (drafted ?? 0) === 0 && (scheduled ?? 0) === 0) {
    alerts.push(
      `Nothing has been captured, drafted or scheduled in ${silenceDays} days. That might just be a ` +
        `quiet week — but if you have been sending things and not hearing back, something is broken.`,
    );
  }

  // 7.7 — "if the queue cannot be filled to target without dropping the bar, it must run short and
  // say so."
  //
  // It used to say so to `system_events` and nowhere else: fourteen identical warnings, four hours
  // apart, read by nothing. Read first here because it is the REASON behind 13.4's number, and the
  // two together would otherwise say the same thing twice in one message.
  //
  // The distinction is worth keeping. 13.4 reports that the queue is low, which reads as a problem.
  // 7.7 is the opposite: the system had the chance to fill it and declined, because clause 1 says
  // fewer posts is the correct outcome when the material is not there. That is a pass, and it should
  // sound like one.
  const { data: short } = await db
    .from("selection_runs")
    .select("id, short_reason")
    .eq("ran_short", true)
    .is("notified_at", null)
    .not("short_reason", "is", null)
    .order("ran_at", { ascending: false })
    .limit(24);

  let shortReason: string | null = null;
  if (short && short.length > 0) {
    shortReason = short[0].short_reason as string;
    // Newest only. The older rows are marked seen without being repeated — six runs reaching the
    // same conclusion is one piece of news, not six.
    await db.from("selection_runs")
      .update({ notified_at: new Date().toISOString() })
      .in("id", short.map((r) => r.id));
  }

  // 13.4 — say so BEFORE the calendar runs dry.
  //
  // Counts APPROVED posts only, matching what 7.3 targets and what the selector now measures. A
  // draft Josh has not passed on is not something the calendar can rely on.
  const { count: inHand } = await db
    .from("posts")
    .select("*", { count: "exact", head: true })
    .in("status", ["ready", "scheduled"]);

  if ((inHand ?? 0) < Math.ceil(target / 2)) {
    const { count: mined } = await db
      .from("moments")
      .select("*", { count: "exact", head: true })
      .eq("status", "mined");

    alerts.push(
      `The queue is down to ${inHand ?? 0} approved posts against a target of ${target}. ` +
        (shortReason
          // The selector already explained itself this morning; do not contradict it with a guess.
          ? shortReason
          : mined && mined > 0
          ? `There are ${mined} mined moments waiting, so it should refill on its own.`
          : `There is nothing mined to write from — worth sending me a few thoughts, or asking me ` +
            `to run you through some questions. Running short is better than writing something thin.`),
    );
    shortReason = null; // said once, inside the alert above
  }

  // 13.2 — failures surface rather than being swallowed.
  //
  // The count and the drain must cover the SAME set. They did not: ten rows were read, ten were
  // reported, and ten were marked seen — so a burst left a backlog that trickled out ten a day
  // forever. Found with 1,581 stale `worker_dispatch_unconfigured` events queued up from a problem
  // fixed days earlier: at ten a day that was five months of daily alerts about nothing, which is
  // precisely how a person learns to ignore the channel that is meant to tell them something broke.
  const { count: errorCount } = await db
    .from("system_events")
    .select("*", { count: "exact", head: true })
    .eq("severity", "error")
    .is("notified_at", null);

  if ((errorCount ?? 0) > 0) {
    // Read a sample for the wording, but clear everything.
    const { data: sample } = await db
      .from("system_events")
      .select("kind")
      .eq("severity", "error")
      .is("notified_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    const kinds = [...new Set((sample ?? []).map((p) => p.kind))].slice(0, 5).join(", ");
    const n = errorCount ?? 0;
    alerts.push(
      `${n} error${n === 1 ? "" : "s"} since you were last told: ${kinds}. ` +
        `Told once — this will not repeat tomorrow unless something new goes wrong.`,
    );

    await db.from("system_events")
      .update({ notified_at: new Date().toISOString() })
      .eq("severity", "error")
      .is("notified_at", null);
  }

  // The queue was healthy enough not to trip 13.4, but the last run still declined to fill it. Worth
  // saying on its own — it is the difference between "nothing happened" and "I chose not to".
  if (shortReason) alerts.push(shortReason);

  // 4.2.6 — "a question that does not land gets rephrased, not retired."
  //
  // This was imported and never called. The prompt set would have decayed exactly as
  // `_shared/questions.ts` warns in its own header: a question that never lands kept being asked,
  // forever, in the same words — and nothing would have shown it happening, because a loop that
  // silently does nothing looks identical to a loop with nothing to do.
  //
  // Reported when it acts, so it is a visible loop rather than an invisible one. Its own daily run
  // is the right home: rephrasing is cheap, it must not be tied to whether Josh shows up, and the
  // ops message is already the place the system tells him what it did on its own.
  // Wrapped as well as guarded inside. This message is the whole of clause 13 — it is how Josh finds
  // out something broke — and nothing optional that happens to run alongside it may take it down.
  let rephrased = 0;
  try {
    rephrased = await rephraseDeadQuestions(db);
  } catch (err) {
    await logEvent(db, "rephrase_failed", "warn", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (rephrased > 0) {
    alerts.push(
      `${rephrased} interview question${rephrased === 1 ? "" : "s"} kept producing nothing, so ` +
        `${rephrased === 1 ? "it has" : "they have"} been reworded rather than dropped. The prompt ` +
        `set is yours — edit it in the library if you would rather word ${
          rephrased === 1 ? "it" : "them"
        } yourself.`,
    );
  }

  // 6.1 — say it BEFORE it happens.
  //
  // `expireDecayedMoments` parks a mined moment the day after its decay date, and that date is the
  // extraction model's guess. Announcing it afterwards is no use: the material has already left the
  // queue. Named a few days ahead, a wrong guess is a thing he can correct in the bank and a right
  // one stops being deletion-by-timeout.
  const warnDays = await getSetting(db, "decay_warning_days", 3);
  const horizon = new Date(Date.now() + warnDays * 86_400_000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: decaying } = await db
    .from("moments")
    .select("ref, decays_at")
    .eq("status", "mined")
    .eq("time_sensitive", true)
    .gte("decays_at", todayIso)
    .lte("decays_at", horizon)
    .order("decays_at");

  if (decaying && decaying.length > 0) {
    alerts.push(
      `${decaying.length === 1 ? "A moment goes" : `${decaying.length} moments go`} stale soon and ` +
        `will be parked unless written:\n` +
        decaying.map((m) => `  ${m.ref} — ${m.decays_at}`).join("\n") +
        `\n\nThose dates are my guess. If one is wrong, change it in the bank and it stays in the queue.`,
    );
  }

  // A LinkedIn token expiring is exactly the kind of quiet break clause 13 exists to prevent.
  const { data: auth } = await db
    .from("linkedin_auth")
    .select("access_expires_at, has_post_analytics")
    .eq("id", true)
    .maybeSingle();
  if (auth?.access_expires_at) {
    const days = (new Date(auth.access_expires_at).getTime() - Date.now()) / 86_400_000;
    if (days < 10) {
      alerts.push(
        `The LinkedIn connection expires in ${Math.max(0, Math.round(days))} days. ` +
          `Reconnect it or scheduled posts will stop going out.`,
      );
    }
  }

  if (alerts.length > 0) {
    await sendMessage(joshChatId(), alerts.join("\n\n"));
  }

  return json({ ok: true, mode: "daily", alerts: alerts.length });
}

async function monthly(db: SupabaseClient): Promise<Response> {
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString();

  // ── 13.3 — the system reports on itself ────────────────────────────────────
  const { data: bySource } = await db
    .from("moments")
    .select("source, status")
    .gte("captured_at", since);

  const captured: Record<string, number> = {};
  let mined = 0, parked = 0;
  for (const m of bySource ?? []) {
    captured[m.source] = (captured[m.source] ?? 0) + 1;
    if (["mined", "queued", "drafted", "gated", "scheduled", "published"].includes(m.status)) mined++;
    if (m.status === "parked") parked++;
  }

  const [{ count: draftsWritten }, { count: rejected }, { count: published }] = await Promise.all([
    db.from("drafts").select("*", { count: "exact", head: true }).gte("created_at", since),
    db.from("gate_runs").select("*", { count: "exact", head: true })
      .eq("passed", false).gte("created_at", since),
    db.from("posts").select("*", { count: "exact", head: true })
      .eq("status", "published").gte("published_at", since),
  ]);

/**
 * WHY KILLED MOMENTS ARE EXCLUDED FROM EVERYTHING THAT LEARNS
 *
 * Test fixtures live in the production tables, because 6.3 forbids deleting a moment — they are
 * killed and labelled instead. Nine of the seventeen moments on this project are fixtures, and every
 * post on file descends from one of them.
 *
 * Nothing that learns was reading that flag. Two consequences, both live:
 *
 *   - The acceptance measurement. 17a is "five of the last six drafts need only light editing", read
 *     off `outcomes.edit_class`. The fixture posts have hand-written bodies bearing no relation to
 *     the drafts they point at, so measuring them would score three rewrites out of three and report
 *     a fabricated failure as the number the engagement is judged on.
 *   - 12.5's question. Josh was asked TWICE whether "FIXTURE B — what the finance director actually
 *     asked" led to a conversation. It was never a post.
 *
 * `killed` is the only label available and it carries two meanings: test data, and 7.4's "this one,
 * no". Excluding both is right here — a moment Josh has disowned should not tune how he is written
 * either. The error direction is also the safe one: at worst this drops one real data point, where
 * the alternative injects fabricated ones into the contractual number.
 */
  const { data: outcomes } = await db
    .from("outcomes")
    .select("edit_class, post_id, moments!inner(killed)")
    .not("edit_class", "is", null)
    .eq("moments.killed", false)
    .order("post_id", { ascending: false })
    .limit(20);

  const classes = (outcomes ?? []).map((o) => o.edit_class as "light" | "rewrite");
  const bar = meetsAcceptanceBar(classes);
  const rewritten = classes.filter((c) => c === "rewrite").length;

  const { data: cost } = await db
    .from("llm_calls")
    .select("cost_usd")
    .gte("created_at", since);
  const spend = (cost ?? []).reduce((sum, c) => sum + Number(c.cost_usd ?? 0), 0);

  const stats =
    `Last month, by the numbers.\n\n` +
    `Captured: ${Object.entries(captured).map(([s, n]) => `${s} ${n}`).join(", ") || "nothing"}\n` +
    `Mined into usable material: ${mined}\n` +
    `Parked (kept, not deleted): ${parked}\n` +
    `Drafts written: ${draftsWritten ?? 0}\n` +
    `Gate rejections: ${rejected ?? 0}\n` +
    `You rewrote: ${rewritten} of the last ${classes.length}\n` +
    `Published: ${published ?? 0}\n` +
    `Model spend: $${spend.toFixed(2)}\n\n` +
    `Acceptance bar (five of the last six needing only light editing): ` +
    `${bar.light}/${bar.of} — ${bar.passing ? "met" : "not yet"}`;

  // 12.12 — "If posts get worse after a change, Josh can see WHICH change and undo it."
  //
  // The undo lives in the library page, and it always worked. What was missing is the half that
  // makes it usable: being told, in the message that reports the numbers, what actually changed
  // this month. A rollback list read "v5 v4 v3" and nothing anywhere connected a version to a
  // month the posts got worse.
  //
  // Named here rather than only in the app because this is where he finds out things declined,
  // and the change is only useful next to the decline.
  const { data: changes } = await db
    .from("library_section_versions")
    .select("key, version, reason, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(12);

  if (changes && changes.length > 0) {
    await sendMessage(
      joshChatId(),
      `What changed in the library this month:\n\n` +
        changes
          .map((c) =>
            `  ${String(c.key).replace(/_/g, " ")} v${c.version} — ${
              c.reason ?? "changed"
            } (${new Date(c.created_at as string).toLocaleDateString("en-GB")})`,
          )
          .join("\n") +
        `\n\nIf any of that made things worse, you can roll it back in the library and the next ` +
          `draft uses the old wording.`,
    );
  }

  await sendMessage(joshChatId(), stats);

  // ── 12.14 — what is working and what is not, with the posts NAMED ──────────
  const { data: posts } = await db
    .from("posts")
    .select(`id, body, published_at, moments!inner(ref, pillar, killed), outcomes(impressions,
             reactions, comments, edit_class, verdict, conversation)`)
    .eq("status", "published")
    .eq("moments.killed", false)
    .gte("published_at", since)
    .limit(40);

  if (posts && posts.length >= 3) {
    const report = await callStructured(ReportSchema, {
      model: MODELS.OPUS,
      system: LEARN_SYSTEM,
      messages: [{
        role: "user",
        content: `Write the monthly review. Name the specific posts behind every claim — by ref and ` +
          `by their opening line — rather than summarising.\n\n${JSON.stringify(
            posts.map((p) => ({
              // deno-lint-ignore no-explicit-any
              ref: embedOne<{ ref: string }>((p as any).moments)?.ref,
              // deno-lint-ignore no-explicit-any
              pillar: embedOne<{ pillar: string }>((p as any).moments)?.pillar,
              hook: p.body.split("\n")[0],
              // deno-lint-ignore no-explicit-any
              ...(embedOne<Record<string, unknown>>((p as any).outcomes) ?? {}),
            })),
            null,
            2,
          )}`,
      }],
      effort: "high",
      maxTokens: 3000,
      purpose: "monthly_report",
      promptVersion: PROMPT_VERSION,
    }, { db });

    await sendMessage(
      joshChatId(),
      `What worked:\n${report.what_is_working}\n\nWhat did not:\n${report.what_is_not}\n\n` +
        `${report.recommendation}`,
    );
  }

  await logEvent(db, "monthly_report", "info", { published, drafts: draftsWritten, spend });
  return json({ ok: true, mode: "monthly", published, spend });
}
