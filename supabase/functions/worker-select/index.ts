/**
 * Step 3 — choosing what gets written next (clause 7).
 *
 *   "The bank will hold more moments than get written, and three of the five inputs run on their
 *    own. Something has to decide what becomes a post and in what order, or the queue becomes
 *    whatever surfaced most recently."
 *
 * Scoring is plain arithmetic in `_shared/scoring.ts` rather than a model call: inspectable, free,
 * the same every run, and — the part that matters for 7.4 — explainable. Josh can pin a moment to
 * the front, kill one, or say "not this month", and an override on a ranking he cannot see is a
 * guess. So every run writes back what it thought and why.
 *
 * The one judgement that genuinely needs semantics — has he told this story before — is in
 * `_shared/dedup.ts`, and it now refuses to fail open.
 *
 * 7.7 governs the whole thing: if the queue cannot be filled to target without dropping the bar, it
 * runs short and says so. It never reaches for something thin to hit a number. That is a PASS, and
 * `selection_runs` records it as one.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { checkRetelling, loadThresholds, type DedupResult } from "../_shared/dedup.ts";
import { canSeeImages } from "../_shared/llm.ts";
import { recordEditDiff } from "../_shared/outcome.ts";
import { notice } from "../_shared/notices.ts";
import { enqueue, json } from "../_shared/jobs.ts";
import {
  applyRecencySpacing,
  ineligible,
  rank,
  scoreMoment,
  type ScorableMoment,
  type Scored,
  type ScoringContext,
} from "../_shared/scoring.ts";

/** How many of the ranked shortlist to run the expensive checks on. */
const SHORTLIST = 20;

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);

  const target = await getSetting(db, "queue_target_posts", 10);
  const maxUnreviewed = await getSetting(db, "max_unreviewed_drafts", 6);
  const ageOutDays = await getSetting(db, "candidate_age_out_days", 45);
  const thresholds = await loadThresholds(db);

  await ageOutStaleCandidates(db, ageOutDays);
  await expireDecayedMoments(db);
  await rescueStranded(db);
  // Before the close, not after: a moment must have had its chance to be reminded about before the
  // system gives up on it. rescueStranded runs first so anything the SYSTEM broke is fixed before
  // Josh is asked about anything.
  await remindStalledInterviews(db);
  await closeStaleConversations(db);
  await resumeDeferredVisuals(db);
  await backfillEditDiffs(db);

  // 7.3 — "roughly two weeks of APPROVED posts". A draft is not approved: R3 is explicit that
  // `marked_ready_at` is the only thing that authorises a post, and until Josh has passed on it in
  // the weekly pass it may still be rewritten or held. Counting drafts here meant a pile he had not
  // looked at read as a full queue while the calendar was empty.
  const { count: approved } = await db
    .from("posts")
    .select("*", { count: "exact", head: true })
    .in("status", ["ready", "scheduled"]);

  const { count: unreviewed } = await db
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "draft");

  const inHand = approved ?? 0;
  const waiting = unreviewed ?? 0;

  // They still must not pile up. Twenty drafts is not a queue, it is a wall — and 12.4 wants the
  // weekly pass to take minutes. Stopping here and saying why is a nudge toward the pass; silently
  // writing more is how the wall gets built.
  if (waiting >= maxUnreviewed) {
    await recordRun(db, {
      target,
      in_hand: inHand,
      unreviewed: waiting,
      considered: 0,
      wrote: 0,
      ran_short: true,
      short_reason:
        `${waiting} draft${waiting === 1 ? " is" : "s are"} waiting on you. Nothing new was ` +
        `written until you have been through ${waiting === 1 ? "it" : "them"} — /review whenever ` +
        `you have ten minutes.`,
      skipped: [],
    });
    return json({ ok: true, inHand, unreviewed: waiting, wrote: 0, reason: "drafts awaiting review" });
  }

  const need = target - inHand;
  if (need <= 0) {
    await recordRun(db, {
      target, in_hand: inHand, unreviewed: waiting, considered: 0, wrote: 0,
      ran_short: false, short_reason: null, skipped: [],
    });
    return json({ ok: true, inHand, target, wrote: 0, reason: "queue is at target" });
  }

  const { ranked, context } = await shortlist(db);

  if (ranked.length === 0) {
    await recordRun(db, {
      target, in_hand: inHand, unreviewed: waiting, considered: 0, wrote: 0,
      ran_short: true,
      short_reason:
        "There is nothing mined to write from. Running short is the right outcome when the " +
        "material is not there — worth sending me a few thoughts, or asking me for questions.",
      skipped: [],
    });
    return json({ ok: true, inHand, target, wrote: 0, reason: "nothing worth writing" });
  }

  let wrote = 0;
  const skipped: { ref: string; reason: string }[] = [];
  const handled = new Set<number>();

  for (const candidate of ranked) {
    if (wrote >= need) break;

    const m = candidate.moment;
    const text = candidate.text;

    // 7.2 — has he already told this story? Against the published archive AND against moments
    // already in flight, because nothing is published for days after it is selected.
    const dedup = await checkRetelling(db, m.id, text, thresholds);

    if (dedup.verdict === "unavailable") {
      // The check could not run. The moment WAITS. It used to go through, which meant 7.2 was
      // unenforced for as long as nothing was configured, and nothing said so.
      skipped.push({ ref: m.ref, reason: "held — the retelling check could not run" });
      await writeBack(db, candidate, ["held until the retelling check can run again"]);
      handled.add(m.id);
      continue;
    }

    // 7.4 — "Josh can override. The system ranks, he has final say."
    //
    // A pin outranks the retelling check too, not just the scoring. The check is a judgement about
    // whether he has told this story, and he is better placed to make it than a cosine distance: he
    // knows whether the second telling is the same post or a different one. It is recorded rather
    // than waved through silently, so the near-miss still reaches the drafter as a warning.
    if (dedup.verdict === "block" && m.pinned) {
      // Added to the candidate rather than written straight out: the status update below writes the
      // reasons again, and a `writeBack` here would be silently overwritten by it a few lines later.
      candidate.reasons.push(
        `close to ${dedup.against ?? "something already published"} — written anyway because you ` +
          `pinned it`,
      );
    } else if (dedup.verdict === "block") {
      skipped.push({
        ref: m.ref,
        reason: `already told${dedup.similarity ? ` (${pct(dedup.similarity)} similar)` : ""}`,
      });
      // Deliberately NOT moments.notes. That column is Josh's (6.1) and the old code overwrote
      // whatever he had written there every time a moment was skipped.
      await writeBack(db, candidate, [
        `skipped — too close to ${dedup.against ?? "something already published"}`,
      ]);
      handled.add(m.id);
      continue;
    }

    // Factor 4 of 7.1: how much this resembles what went out recently. Below the block and warn
    // thresholds the same number is spacing rather than a verdict — one mechanism, three uses.
    const spaced = applyRecencySpacing(candidate, dedup.similarity, context);

    await db.from("moments").update({
      status: "queued",
      last_score: round(spaced.score),
      last_score_reasons: spaced.reasons,
      last_scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", m.id);

    // Enqueued AFTER the status change, and that order is deliberate. `queued` is what stops the
    // next run four hours later from selecting the same moment again; setting it second would let
    // two runs both queue it. The cost is that a failure between the two leaves a moment marked
    // queued with nothing to write it — which `rescueStranded` above picks up on the next run.

    // The dedupe key must be unique per PASS through the cycle, not per moment.
    //
    // `draft:<id>:1` looked right and was not: 6.4 made the status graph cyclic, so a moment that
    // was drafted in August, parked, reopened, re-mined and re-queued in November hits a key that
    // already exists. `enqueue` then silently does nothing, and the moment sits in `queued` forever
    // — invisible to selection, which only reads `mined`, and with no job to write it. Seen exactly
    // that way on M-000003, the first moment ever to go round the loop.
    //
    // Counting existing drafts gives a value two concurrent runs would compute identically, which is
    // all the guard was ever for, while still changing on the next pass.
    const { count: priorDrafts } = await db
      .from("drafts").select("*", { count: "exact", head: true }).eq("moment_id", m.id);

    await enqueue(db, "draft", {
      moment_id: m.id,
      attempt: 1,
      // 7.2's other half: "rewriting an angle is fine". If this sits in the warn band, the drafter
      // is told what it resembles so it can take a different angle rather than retell the anecdote.
      // A pinned moment that overrode a block gets the warning too — more so, not less: Josh has
      // said write it, so the drafter needs to know what it must not become.
      near_miss: dedup.verdict === "warn" || dedup.verdict === "block" ? dedup.against : null,
    }, { dedupeKey: `draft:${m.id}:v${(priorDrafts ?? 0) + 1}` });

    handled.add(m.id);
    wrote++;
  }

  // Everything else considered this run keeps its score too, so the bank page can explain the whole
  // ORDER rather than only the outcome — "why was this one not written" is the question 7.4 exists
  // to let him answer.
  for (const candidate of ranked) {
    if (handled.has(candidate.moment.id)) continue;
    await writeBack(db, candidate, []);
  }

  /*
   * TELL HIM THERE IS SOMETHING TO WRITE, BECAUSE NOTHING ELSE WILL.
   *
   * When the server wrote drafts, choosing an idea was followed within minutes by a draft arriving
   * in Telegram, and that arrival was the notification. Drafting moved to Claude, so choosing an
   * idea now only puts a job in a queue that nobody is watching — and a queue nobody is watching is
   * the same as no queue.
   *
   * One message per run, however many were chosen: ten "ready to write" messages from one selection
   * would be the notification equivalent of the ten-candidates-a-day failure 4.4.3 warns about.
   */
  if (wrote > 0) {
    try {
      await notice(
        db,
        "ready_to_write",
        `${wrote === 1 ? "An idea is" : `${wrote} ideas are`} ready to write.\n\n` +
          `Say "write the next one" — it will pick ${wrote === 1 ? "it" : "them"} up with ` +
          `everything you told me, and every draft is checked eight ways before you see it.`,
        { actedOn: ["next_work"] },
      );
    } catch (err) {
      // A notification failure must not undo a selection that already happened.
      await logEvent(db, "ready_to_write_notice_failed", "warn", {
        wrote,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ranShort = wrote < need;
  await recordRun(db, {
    target,
    in_hand: inHand,
    unreviewed: waiting,
    considered: ranked.length,
    wrote,
    ran_short: ranShort,
    short_reason: ranShort ? shortReason(wrote, need, skipped) : null,
    skipped,
  });

  return json({ ok: true, inHand, target, wrote, skipped });
});

/* ── Ranking ──────────────────────────────────────────────────────────────── */

interface Candidate extends Scored {
  text: string;
}

async function shortlist(
  db: SupabaseClient,
): Promise<{ ranked: Candidate[]; context: ScoringContext }> {
  const { data: moments } = await db
    .from("moments")
    .select(
      "id, ref, pillar, audience, strength, pinned, killed, time_sensitive, decays_at, not_before, captured_at, depth_reached",
    )
    .eq("status", "mined")
    .eq("killed", false)
    .limit(200);

  const context = await buildContext(db);
  if (!moments || moments.length === 0) return { ranked: [], context };

  const scored: Scored[] = [];
  for (const raw of moments as ScorableMoment[]) {
    const why = ineligible(raw, context);
    if (why) continue;
    scored.push(scoreMoment(raw, context));
  }

  // Material is fetched only for the shortlist: embedding two hundred moments to write one would be
  // absurd, and the ordering above already decides which twenty are worth the cost.
  const top = rank(scored).slice(0, SHORTLIST);
  const ranked: Candidate[] = [];

  for (const s of top) {
    const { data: mat } = await db
      .from("material")
      .select("the_moment, the_detail, the_realisation, the_lesson, their_actual_words")
      .eq("moment_id", s.moment.id)
      .maybeSingle();

    const text = [
      mat?.the_moment,
      mat?.the_detail,
      mat?.their_actual_words,
      mat?.the_realisation,
      mat?.the_lesson,
    ].filter(Boolean).join(" ");

    if (text.trim().length === 0) continue; // nothing to write from, and nothing to compare
    ranked.push({ ...s, text });
  }

  return { ranked, context };
}

/**
 * Everything the scorer needs about the world, gathered once.
 *
 * Pillar and audience counts come from what has actually been PUBLISHED in the last eight weeks —
 * what Josh's readers have seen, not what the system happens to have written. The in-flight sets are
 * separate and deliberately so: a queued post has not been read by anyone yet, but it will be, and
 * two posts on one theme back to back is exactly what 7.1 exists to prevent.
 */
async function buildContext(db: SupabaseClient): Promise<ScoringContext> {
  const since = new Date(Date.now() - 56 * 86_400_000).toISOString();

  const [{ data: recent }, { data: flight }] = await Promise.all([
    db.from("posts")
      .select("published_at, moments!inner(pillar, audience)")
      .eq("status", "published")
      .gte("published_at", since),
    db.from("moments")
      .select("pillar, audience")
      .in("status", ["queued", "drafted", "gated"])
      .eq("killed", false),
  ]);

  const pillarCounts = new Map<string, number>();
  const audienceCounts = new Map<string, number>();
  for (const r of recent ?? []) {
    // deno-lint-ignore no-explicit-any
    const m = (r as any).moments;
    const one = Array.isArray(m) ? m[0] : m;
    if (one?.pillar) pillarCounts.set(one.pillar, (pillarCounts.get(one.pillar) ?? 0) + 1);
    if (one?.audience) audienceCounts.set(one.audience, (audienceCounts.get(one.audience) ?? 0) + 1);
  }

  const inFlightPillars = new Set<string>();
  const inFlightAudiences = new Set<string>();
  for (const f of flight ?? []) {
    if (f.pillar) inFlightPillars.add(f.pillar);
    if (f.audience) inFlightAudiences.add(f.audience);
  }

  return {
    pillarCounts,
    audienceCounts,
    inFlightPillars,
    inFlightAudiences,
    today: new Date().toISOString().slice(0, 10),
    now: Date.now(),
    recencySpacingWeight: await getSetting(db, "recency_spacing_weight", 12),
  };
}

/** Keep the score and the reasoning on a moment that was considered but not written. */
async function writeBack(db: SupabaseClient, c: Candidate, extra: string[]): Promise<void> {
  await db.from("moments").update({
    last_score: round(c.score),
    last_score_reasons: [...c.reasons, ...extra],
    last_scored_at: new Date().toISOString(),
  }).eq("id", c.moment.id);
}

/* ── 7.7 ──────────────────────────────────────────────────────────────────── */

interface RunRecord {
  target: number;
  in_hand: number;
  unreviewed: number;
  considered: number;
  wrote: number;
  ran_short: boolean;
  short_reason: string | null;
  skipped: { ref: string; reason: string }[];
}

/**
 * One row per run, so 7.7 can say so ONCE.
 *
 * The old version logged an identical `queue_short` warning every four hours — fourteen of them, all
 * saying the same thing, read by nothing. A record with a `notified_at` lets ops tell Josh the first
 * time and then leave him alone.
 */
async function recordRun(db: SupabaseClient, run: RunRecord): Promise<void> {
  await db.from("selection_runs").insert(run);

  if (run.ran_short && run.short_reason) {
    await logEvent(db, "queue_short", "info", {
      target: run.target,
      in_hand: run.in_hand,
      wrote: run.wrote,
      reason: run.short_reason,
    });
  }
}

function shortReason(
  wrote: number,
  need: number,
  skipped: { ref: string; reason: string }[],
): string {
  const held = skipped.filter((s) => s.reason.startsWith("held")).length;
  const retold = skipped.filter((s) => s.reason.startsWith("already told")).length;

  if (held > 0) {
    return `${held} moment${held === 1 ? " is" : "s are"} on hold because the retelling check ` +
      `could not run. Nothing was written from ${held === 1 ? "it" : "them"} rather than risk ` +
      `repeating a story — this needs looking at.`;
  }
  if (retold > 0) {
    return `${retold} moment${retold === 1 ? " was" : "s were"} too close to something you have ` +
      `already published, so ${retold === 1 ? "it was" : "they were"} left alone. That is the ` +
      `check working, not a problem.`;
  }
  return `Wrote ${wrote} of the ${need} the queue was short. Nothing else in the bank was strong ` +
    `enough yet, and fewer posts is the right outcome when the material is not there.`;
}

/* ── Ageing ───────────────────────────────────────────────────────────────── */

/**
 * A moment marked `queued` with nothing on its way to write it.
 *
 * `queued` is a claim by this worker that a draft is coming. If the enqueue behind it never landed —
 * a swallowed dedupe key, a crash between the two writes — the moment becomes invisible: selection
 * reads `mined` and will never look at it again, and no job exists to move it on. It would sit there
 * indefinitely, and 6.3 means it sits there visibly.
 *
 * Cheap to check and cheap to fix, so it runs first, every time.
 */
async function rescueStranded(db: SupabaseClient): Promise<void> {
  const { data: queued } = await db
    .from("moments").select("id, ref").eq("status", "queued").eq("killed", false).limit(50);
  if (!queued || queued.length === 0) return;

  for (const m of queued) {
    const { count: live } = await db
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .in("type", ["draft", "gate"])
      .in("status", ["pending", "running"])
      .eq("payload->>moment_id", String(m.id));

    if ((live ?? 0) > 0) continue;

    const { count: priorDrafts } = await db
      .from("drafts").select("*", { count: "exact", head: true }).eq("moment_id", m.id);

    await enqueue(db, "draft", { moment_id: m.id, attempt: 1 }, {
      dedupeKey: `draft:${m.id}:v${(priorDrafts ?? 0) + 1}`,
    });
    await logEvent(db, "queued_moment_rescued", "warn", {
      moment_id: m.id,
      ref: m.ref,
      note: "marked queued with no draft job — re-enqueued",
    });
  }
}

/** 7.6 — candidates that go unmined for an extended period age quietly to parked. */
async function ageOutStaleCandidates(db: SupabaseClient, days: number): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await db.from("moments").update({
    status: "parked",
    parked_reason: `Surfaced ${days} days ago and never mined. Kept, not deleted — send me more ` +
      `about it any time and it goes back in the queue.`,
  }).eq("status", "half_mined").lt("captured_at", cutoff);
}

/**
 * A time-sensitive moment past its date is parked rather than written late.
 *
 * The reason NAMES THE DATE, because the date was a guess. Extraction decides on every moment
 * whether it decays and roughly when, and it is wrong sometimes — so the old reason, "this one was
 * time sensitive and its moment has passed", could be a flat untruth that quietly removed good
 * material from the queue. Saying which date it acted on makes a wrong one obvious at a glance, and
 * 6.4 gives him the way back.
 */
async function expireDecayedMoments(db: SupabaseClient): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: expiring } = await db
    .from("moments")
    .select("id, decays_at")
    .eq("status", "mined")
    .eq("time_sensitive", true)
    .lt("decays_at", today);

  for (const m of expiring ?? []) {
    await db.from("moments").update({
      status: "parked",
      parked_reason:
        `Marked as stopping being worth posting on ${m.decays_at}, and that has passed. If that ` +
        `date was wrong, reopen it and correct it in the bank — the date was my guess, not yours.`,
    }).eq("id", m.id);
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round = (n: number) => Math.round(n * 100) / 100;

export type { DedupResult };

/**
 * 7.6, via 5.8 — an interview Josh never came back to needs an ending.
 *
 * M-000004 held an unanswered question for two days with nothing in the system that would ever
 * resolve it: `openCandidate` moves a candidate to `captured`, `ageOutStaleCandidates` only looks at
 * `half_mined`, selection only reads `mined`, and no job existed for it. The one thing 7.6 exists to
 * prevent — candidates accumulating in front of him forever — was reachable, and opening a candidate
 * was the way in.
 *
 * The rule already existed and simply had no timer. 5.8: "Must know when to stop. Josh is busy...
 * It takes what it has and moves on." That is the policy at fifteen questions; it is the same policy
 * at a fortnight of silence. Extraction handles a thin conversation honestly by parking it, and 6.4
 * means nothing is lost either way.
 *
 * WHICH SIDE IS WAITING IS THE WHOLE DISCRIMINATOR
 *
 *   last turn is a QUESTION — waiting on Josh. Can go stale. This is the case 4.1.3 blesses ("talk
 *                             for two minutes and be done, with the follow-up happening later"), so
 *                             the timer has to be generous rather than tidy.
 *   last turn is an ANSWER  — waiting on the SYSTEM. A timer is the wrong answer to that: he replied
 *                             and nothing came back. That is a job that died, and it gets resumed.
 */
/**
 * Remind Josh about interviews he has stopped answering — once a day, in one message, with a way
 * out of each.
 *
 * WHAT THIS REPLACES
 *
 * Nothing. `closeStaleConversations` below has always handled every case except this one: it starts
 * interviews that never started, resumes ones the system stranded, and after 7 to 14 days of
 * silence takes what it has. What it never did was tell Josh any of that was happening. Five
 * interviews were stalled mid-question when this was written, the oldest since 26 August, and each
 * was heading for a silent close that would produce a thin moment or a park he never heard about.
 *
 * WHY ONE MESSAGE A DAY AND NOT ONE PER MOMENT
 *
 * The interviewer prompt is explicit that pressing on "does not get better material; it costs you
 * the next session, because he will remember this one as an interrogation". Five stalled moments
 * times a per-moment reminder is five notifications, which is precisely that. So the cap is on the
 * MESSAGE, not on the moment: at most one a day no matter how many are open, and it lists them.
 *
 * The cap is read from system_events rather than kept in a counter column. That is where every
 * other operational fact lives (13.2), it is auditable after the fact, and a counter that drifts is
 * indistinguishable from a counter that is right.
 *
 * WHY IT COSTS NOTHING
 *
 * No model call. The text is the question he was already asked, quoted back. A reminder that spent
 * a request would stop working on the day the free tier ran out, which is exactly the day it is
 * most needed.
 */
async function remindStalledInterviews(db: SupabaseClient): Promise<void> {
  // An off switch, because this is the only thing in the system that messages Josh without him
  // having done something first. Defaults ON so a rebuild from this repository behaves as designed
  // (14.3), and is set to false in the live project until the operator arms it.
  if (!(await getSetting(db, "nudge_enabled", true))) return;

  const afterHours = await getSetting(db, "nudge_after_hours", 36);
  const maxListed = await getSetting(db, "nudge_max_listed", 3);

  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count: alreadySent } = await db
    .from("system_events")
    .select("*", { count: "exact", head: true })
    .eq("kind", "interview_roundup_sent")
    .gte("created_at", dayAgo);
  if ((alreadySent ?? 0) > 0) return;

  const { data: open } = await db
    .from("moments")
    .select("id, ref, title, status")
    .in("status", ["captured", "half_mined"])
    .eq("killed", false)
    .limit(100);

  const waiting: {
    id: number;
    ref: string;
    title: string | null;
    question: string;
    about: string;
    silentHours: number;
  }[] = [];

  for (const m of open ?? []) {
    // Same guard as closeStaleConversations: queued work means it is not waiting on him.
    const { count: live } = await db
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .in("type", ["interview_step", "interview_extract", "transcribe"])
      .in("status", ["pending", "running"])
      .eq("payload->>moment_id", String(m.id));
    if ((live ?? 0) > 0) continue;

    const { data: last } = await db
      .from("interview_turns")
      .select("role, body, created_at")
      .eq("moment_id", m.id)
      .order("turn_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only an unanswered QUESTION is his to act on. No turns at all, or a trailing answer, are the
    // system's own problems and closeStaleConversations already fixes both.
    if (!last || last.role !== "question") continue;

    const silentHours = (Date.now() - new Date(last.created_at as string).getTime()) / 3_600_000;
    if (silentHours < afterHours) continue;

    // His own first words about it, which is the only label he will recognise. The ref means
    // nothing to him and the question alone does not say which moment it belongs to.
    const { data: first } = await db
      .from("interview_turns")
      .select("body")
      .eq("moment_id", m.id)
      .eq("role", "answer")
      .order("turn_no", { ascending: true })
      .limit(1)
      .maybeSingle();

    waiting.push({
      id: m.id as number,
      ref: m.ref as string,
      title: (m.title as string | null) ?? null,
      question: String(last.body ?? "").trim(),
      about: String(first?.body ?? "").trim(),
      silentHours,
    });
  }

  if (waiting.length === 0) return;

  // Longest-waiting first, because only `maxListed` of them fit and the query above has no ORDER BY
  // — which would have made "which three" a question about physical row order. The one that has
  // been ignored longest is the one closest to being closed unanswered, so it is the one to show.
  waiting.sort((a, b) => b.silentHours - a.silentHours);

  const listed = waiting.slice(0, maxListed);
  const only = listed.length === 1;

  const lines = listed.map((w, i) => {
    const label = only ? "" : `${i + 1}. `;
    // The name they gave it; their own first words only for an idea not yet named.
    const about = w.title ? `"${w.title}"\n   ` : w.about ? `${snippet(w.about, 70)}\n   ` : "";
    return `${label}${about}${snippet(w.question, 140)}`;
  });

  const more = waiting.length > listed.length
    ? `\n\n(${waiting.length - listed.length} more, but this is plenty for one message.)`
    : "";

  const text =
    (only ? "One thing still open:" : `${listed.length} things still open:`) +
    `\n\n${lines.join("\n\n")}${more}` +
    `\n\nNo rush, and no need to answer all of them. ` +
    `Leave them and I will close them on their own.`;

  try {
    /*
     * The buttons under this message were the useful part of it — resume, skip, that's enough, park.
     * They become the tools that do the same things, which is also more honest: a button only worked
     * while the message was the newest thing in the chat.
     *
     * This reminder is why the function exists. Five interviews once sat open for a month with
     * nobody noticing, and nothing else in the system was looking.
     */
    await notice(db, "stalled_interviews", text, {
      actedOn: ["next_interview_question", "skip_question", "end_interview", "park_idea"],
    });
  } catch (err) {
    // 13.2 — a reminder that failed to send must not look like a reminder that was not due. Logged
    // as an error and NOT recorded as sent, so the next sweep tries again in four hours.
    await logEvent(db, "interview_roundup_failed", "error", { error: String(err) });
    return;
  }

  // Written only after the send succeeded. This row IS the once-a-day cap.
  await logEvent(db, "interview_roundup_sent", "info", {
    listed: listed.map((w) => w.ref),
    waiting: waiting.length,
    silent_after_hours: afterHours,
  });
}

/** Telegram truncation that does not cut a word in half. */
function snippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

async function closeStaleConversations(db: SupabaseClient): Promise<void> {
  const ownDays = await getSetting(db, "stale_own_days", 14);
  const candidateDays = await getSetting(db, "stale_candidate_days", 7);

  const { data: open } = await db
    .from("moments")
    .select("id, ref, source, status")
    .in("status", ["captured", "half_mined"])
    .eq("killed", false)
    .limit(100);

  for (const m of open ?? []) {
    // A moment with work already queued is not abandoned, whatever its turns look like.
    const { count: live } = await db
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .in("type", ["interview_step", "interview_extract", "transcribe"])
      .in("status", ["pending", "running"])
      .eq("payload->>moment_id", String(m.id));
    if ((live ?? 0) > 0) continue;

    const { data: last } = await db
      .from("interview_turns")
      .select("role, created_at")
      .eq("moment_id", m.id)
      .order("turn_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Nothing asked yet and no job to ask it: the interview never started. Start it.
    if (!last) {
      await enqueue(db, "interview_step", { moment_id: m.id });
      await logEvent(db, "interview_never_started", "warn", { moment_id: m.id, ref: m.ref });
      continue;
    }

    if (last.role === "answer") {
      // He replied and nothing came back. Not stale — stranded.
      await enqueue(db, "interview_step", { moment_id: m.id });
      await logEvent(db, "interview_resumed", "warn", {
        moment_id: m.id,
        ref: m.ref,
        note: "his answer had no follow-up and no live job",
      });
      continue;
    }

    // His own thought gets longer than something a model dug out of a transcript.
    const own = m.source === "raw_capture" || m.source === "prompted_session";
    const days = own ? ownDays : candidateDays;
    const silentFor = (Date.now() - new Date(last.created_at as string).getTime()) / 86_400_000;
    if (silentFor < days) continue;

    // Take what it has. Extraction decides whether that is material or a park, and says so.
    await enqueue(db, "interview_extract", { moment_id: m.id });
    await logEvent(db, "interview_closed_stale", "info", {
      moment_id: m.id,
      ref: m.ref,
      silent_days: Math.round(silentFor),
      threshold: days,
    });
  }
}

/**
 * 10.3 — the rebuild Josh was promised, once the provider can actually do it.
 *
 * When an image arrives on a provider that cannot carry one, `visual.ts` records the deferral on the
 * moment and tells him it is on the list. This is the half that makes that true: the moment a
 * vision-capable provider is configured, every waiting image is rebuilt without him doing anything
 * or remembering anything.
 *
 * Before this existed the message was simply false. The job was marked done, no state remembered the
 * image, and switching provider would not have produced it — the same shape as the parked-moment
 * promise found on the first day of this build, where the system said "send me more and I will
 * reopen this one" and nothing reopened anything.
 *
 * Cheap when idle: one indexed query returning nothing, four times a day.
 */
async function resumeDeferredVisuals(db: SupabaseClient): Promise<void> {
  if (!canSeeImages()) return;

  const { data: waiting } = await db
    .from("moments")
    .select("id, ref, visual_pending")
    .not("visual_pending", "is", null)
    .eq("killed", false)
    .limit(20);

  if (!waiting || waiting.length === 0) return;

  const resumed: string[] = [];

  for (const m of waiting) {
    // `visual_pending` is only cleared on SUCCESS, which is right — a failed rebuild should still be
    // waiting. But without this check the sweep re-queues it every four hours whether or not the
    // last attempt is still running or has just died, so a rebuild that cannot succeed becomes an
    // endless loop of five-attempt job chains. Same guard as `rescueStranded`.
    const { count: live } = await db
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("type", "visual")
      .in("status", ["pending", "running"])
      .eq("payload->>moment_id", String(m.id));
    if ((live ?? 0) > 0) continue;

    const pending = m.visual_pending as
      | { source_path?: string; taking?: string; post_doing?: string }
      | null;
    if (!pending?.source_path) {
      // Nothing to rebuild from. Clear it rather than sweeping it forever.
      await db.from("moments").update({ visual_pending: null }).eq("id", m.id);
      continue;
    }

    await enqueue(db, "visual", {
      moment_id: m.id,
      source_path: pending.source_path,
      taking: pending.taking ?? "idea",
      post_doing: pending.post_doing ?? "",
    });

    await logEvent(db, "deferred_visual_resumed", "info", { moment_id: m.id, ref: m.ref });
    resumed.push(m.ref as string);
  }

  // Only when something was actually queued. Announcing a sweep that skipped everything already in
  // flight would be a message every four hours saying the same thing.
  if (resumed.length === 0) return;

  await notice(
    db,
    "visuals_resumed",
    resumed.length === 1
      ? `The image you sent for ${resumed[0]} can be rebuilt now — doing it.`
      : `${resumed.length} images you sent can be rebuilt now — doing them.`,
  );
}

/**
 * 12.2 — a safety net over the two writers that take the edit measurement.
 *
 * The diff is captured when Josh marks a post ready, and there are exactly two places that happens:
 * `schedulePost` in Telegram and `markReady` in the app. Two writers of one fact have drifted apart
 * before in this build — the conversation question had its own copy on each surface and the copies
 * disagreed about what Josh had already been asked — and the failure mode here is invisible: a post
 * approved without a measurement looks exactly like a post that was never approved.
 *
 * So anything approved and unmeasured is measured on the next selection run. This is the same shape
 * as `rescueStranded` above, and for the same reason: the fix for a signal that must work "every
 * time" is a sweep, not a promise that both call sites are correct.
 */
async function backfillEditDiffs(db: SupabaseClient): Promise<void> {
  const { data: approved } = await db
    .from("posts")
    .select("id, outcomes(edit_class), moments!inner(killed)")
    .not("marked_ready_at", "is", null)
    .not("draft_id", "is", null)
    // A fixture post carries a hand-written body bearing no relation to its draft. Measuring one
    // would put a fabricated "rewrite" into the 17a acceptance number. See worker-ops.
    .eq("moments.killed", false)
    .order("id", { ascending: false })
    .limit(50);

  const missing = (approved ?? []).filter((p) => {
    // deno-lint-ignore no-explicit-any
    const raw = (p as any).outcomes;
    const o = Array.isArray(raw) ? raw[0] : raw;
    return !o?.edit_class;
  });

  if (missing.length === 0) return;

  let filled = 0;
  for (const post of missing) {
    const result = await recordEditDiff(db, post.id, "approved");
    if (result.measured) filled++;
  }

  // Logged whether or not anything was filled, because "found five and measured none" is a problem
  // and "found none" is not. A sweep that reports only its successes cannot tell you it is failing.
  await logEvent(db, "edit_diff_backfilled", filled < missing.length ? "warn" : "info", {
    found: missing.length,
    measured: filled,
    post_ids: missing.map((p) => p.id),
  });
}
