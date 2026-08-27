/**
 * Gathering the numbers clause 17 is scored against.
 *
 * Split from `acceptance.ts` for one reason: that module must stay import-free so Node can strip its
 * types and share it verbatim with `eval/acceptance.mjs`. This half needs a Supabase client, so it
 * lives here and the scoring stays portable.
 *
 * KILLED MOMENTS ARE EXCLUDED THROUGHOUT. Nine of the moments on the development project are
 * verification fixtures, kept and labelled rather than deleted (6.3). A scorecard that counted them
 * would repeat exactly the failure found in the clause 12 pass, where the 17a acceptance bar was one
 * sweep away from being computed off hand-written test text.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Counts } from "./acceptance.ts";

function weeksSince(dates: (string | null)[]): number {
  const times = dates.filter(Boolean).map((d) => new Date(d as string).getTime());
  if (times.length === 0) return 0;
  return Math.floor((Date.now() - Math.min(...times)) / (7 * 86_400_000));
}

export async function gatherCounts(db: SupabaseClient): Promise<Counts> {
  const [
    moments,
    rawInputs,
    material,
    answers,
    drafts,
    gateRuns,
    selectionRuns,
    visuals,
    posts,
    outcomes,
    proposals,
    names,
    sections,
  ] = await Promise.all([
    db.from("moments").select("id, source, depth_reached, killed"),
    db.from("raw_inputs").select("moment_id, kind, transcript"),
    db.from("material").select("moment_id, the_moment, the_detail, the_realisation"),
    db.from("interview_turns").select("moment_id, role").eq("role", "answer"),
    // `acceptance-fixture` is what eval/gate-acceptance.mjs writes: ten deliberately generic drafts
    // hung off a REAL moment, because testing the gate against an empty source entry proves nothing.
    // The harness does not clean them up, so without this they would be counted as drafts the system
    // produced — the same leak as the killed moments, arriving from a different direction.
    db.from("drafts").select("moment_id, gate_passed, framework"),
    db.from("gate_runs").select("check_key", { count: "exact", head: true }),
    db.from("selection_runs").select("ran_at"),
    db.from("visuals").select("id", { count: "exact", head: true }),
    db.from("posts").select("id, moment_id, status, marked_ready_at, published_at"),
    db.from("outcomes").select(
      "post_id, moment_id, edit_class, edit_measured_at, metrics_pulled_at, draft_body, conversation_ask_count",
    ),
    db.from("library_proposals").select("id", { count: "exact", head: true }),
    db.from("moment_names").select("moment_id, kind"),
    db.from("library_sections").select("key, body").eq("key", "voice_guide").maybeSingle(),
  ]);

  const all = moments.data ?? [];
  const live = new Set(all.filter((m) => !m.killed).map((m) => m.id as number));
  const liveMoments = all.filter((m) => !m.killed);
  // deno-lint-ignore no-explicit-any
  const ofLive = <T extends { moment_id: any }>(rows: T[] | null): T[] =>
    (rows ?? []).filter((r) => live.has(r.moment_id));

  const voice = ofLive(rawInputs.data).filter((r) => r.kind === "voice");
  const livePosts = ofLive(posts.data);
  const liveOutcomes = ofLive(outcomes.data);

  // Moments Josh actually replied to. Anything else is the interview waiting, not failing.
  const engaged = new Set(ofLive(answers.data).map((a) => a.moment_id as number));

  const guide = ((sections.data as { body?: string } | null)?.body ?? "")
    .replace(/DELIBERATELY EMPTY[\s\S]*/, "").trim();

  return {
    voiceNotes: voice.length,
    voiceTranscribed: voice.filter((r) => r.transcript).length,
    promptedSessions: liveMoments.filter((m) => m.source === "prompted_session").length,
    promptedFullDepth: ofLive(material.data).filter((m) =>
      m.the_moment && m.the_detail && m.the_realisation
    ).length,
    callMoments: liveMoments.filter((m) => m.source === "call_transcript").length,
    ccMoments: liveMoments.filter((m) => m.source === "claude_code").length,
    reachedDepth: liveMoments.filter((m) => m.depth_reached && m.depth_reached !== "none").length,
    reachedNone: liveMoments.filter((m) => !m.depth_reached || m.depth_reached === "none").length,
    interviewEngaged: engaged.size,
    interviewEngagedWithDepth: liveMoments.filter((m) =>
      engaged.has(m.id) && m.depth_reached && m.depth_reached !== "none"
    ).length,
    gatePassedDrafts: ofLive(drafts.data)
      .filter((d) => d.framework !== "acceptance-fixture" && d.gate_passed).length,
    namesOnFile: ofLive(names.data).filter((n) => n.kind !== "not_a_name").length,
    gateChecksRun: gateRuns.count ?? 0,
    gateAcceptanceRun: false,
    selectionRuns: (selectionRuns.data ?? []).length,
    selectionWeeks: weeksSince((selectionRuns.data ?? []).map((r) => r.ran_at)),
    visualsBuilt: visuals.count ?? 0,
    realPublished: livePosts.filter((p) => p.status === "published").length,
    // R3, measured rather than assumed. A published row with no `marked_ready_at` is the exception
    // acceptance test 11 forbids; the schema refuses to store one, and this is the count that says so.
    publishedWithoutJosh: livePosts.filter((p) => p.published_at && !p.marked_ready_at).length,
    calendarWeeks: weeksSince(livePosts.map((p) => p.published_at)),
    proposals: proposals.count ?? 0,
    outcomesWithMetrics: liveOutcomes.filter((o) => o.metrics_pulled_at).length,
    outcomesWithDiff: liveOutcomes.filter((o) => o.draft_body).length,
    conversationAsked: liveOutcomes.filter((o) => (o.conversation_ask_count ?? 0) > 0).length,
    editClasses: liveOutcomes
      .filter((o) => o.edit_class)
      .sort((a, b) =>
        new Date(b.edit_measured_at ?? 0).getTime() - new Date(a.edit_measured_at ?? 0).getTime()
      )
      .map((o) => o.edit_class as "light" | "rewrite"),
    voiceGuideSupplied: guide.length > 0,
  };
}
