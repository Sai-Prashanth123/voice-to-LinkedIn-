/**
 * Reads the live database and reduces it to the counts clause 17 is scored from.
 *
 * Extracted from eval/acceptance.mjs when the MCP server needed the same numbers. Two copies of
 * this would drift within a week, and the failure would be silent: the scorecard Josh reads in his
 * monthly message and the scorecard a model reads through the MCP server would simply disagree,
 * with nothing to say which was right.
 *
 * Takes a query function rather than credentials, so the caller decides what it authenticates as.
 * The harness uses the service role; the MCP server uses its own scoped key and sees only what
 * that key is granted.
 *
 * The names count used to be computed by the caller, after gather() had already returned. That
 * left namesOnFile: 0 sitting in the middle of the object as a lie the caller was trusted to
 * correct - and worker-ops, which does not run this file, never did. It is folded in here now.
 */
/** Rows, with killed moments excluded wherever a moment is involved. */
export async function gather(q) {
  const [
    moments, rawInputs, material, answers, drafts, gateRuns, selectionRuns,
    visuals, posts, outcomes, proposals, sections,
  ] = await Promise.all([
    q("moments?select=id,source,status,depth_reached,killed"),
    q("raw_inputs?select=moment_id,kind,transcript"),
    q("material?select=moment_id,the_moment,the_detail,the_realisation"),
    q("interview_turns?select=moment_id,role&role=eq.answer"),
    q("drafts?select=moment_id,gate_passed,framework"),
    q("gate_runs?select=check_key,passed"),
    q("selection_runs?select=ran_at"),
    q("visuals?select=id"),
    q("posts?select=id,moment_id,status,marked_ready_at,published_at"),
    q("outcomes?select=post_id,moment_id,edit_class,metrics_pulled_at,draft_body," +
      "conversation_ask_count,edit_measured_at"),
    q("library_proposals?select=id"),
    q("library_sections?select=key,body"),
  ]);

  const live = new Set(moments.filter((m) => !m.killed).map((m) => m.id));
  const liveMoments = moments.filter((m) => !m.killed);
  const ofLive = (rows) => rows.filter((r) => live.has(r.moment_id));

  const weeksSince = (dates) => {
    const times = dates.filter(Boolean).map((d) => new Date(d).getTime());
    if (times.length === 0) return 0;
    return Math.floor((Date.now() - Math.min(...times)) / (7 * 86_400_000));
  };

  // Moments Josh actually replied to. Anything else is the interview waiting, not failing.
  const engaged = new Set(ofLive(answers).map((a) => a.moment_id));

  const voice = ofLive(rawInputs).filter((r) => r.kind === "voice");
  const liveMaterial = ofLive(material);
  const livePosts = ofLive(posts);
  const liveOutcomes = ofLive(outcomes);

  return {
    voiceNotes: voice.length,
    voiceTranscribed: voice.filter((r) => r.transcript).length,
    promptedSessions: liveMoments.filter((m) => m.source === "prompted_session").length,
    promptedFullDepth: liveMaterial.filter((m) =>
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
    gatePassedDrafts: ofLive(drafts)
      .filter((d) => d.framework !== "acceptance-fixture" && d.gate_passed).length,
    namesOnFile: 0, // filled below
    gateChecksRun: gateRuns.length,
    gateAcceptanceRun: false, // set by gate-acceptance.mjs when it writes its result
    selectionRuns: selectionRuns.length,
    selectionWeeks: weeksSince(selectionRuns.map((r) => r.ran_at)),
    visualsBuilt: visuals.length,
    realPublished: livePosts.filter((p) => p.status === "published").length,
    // R3, measured rather than assumed: a published row with no marked_ready_at would be an
    // exception. The schema refuses to store one, and this is the count that proves it.
    publishedWithoutJosh: livePosts.filter((p) => p.published_at && !p.marked_ready_at).length,
    calendarWeeks: weeksSince(livePosts.map((p) => p.published_at)),
    proposals: proposals.length,
    outcomesWithMetrics: liveOutcomes.filter((o) => o.metrics_pulled_at).length,
    outcomesWithDiff: liveOutcomes.filter((o) => o.draft_body).length,
    conversationAsked: liveOutcomes.filter((o) => (o.conversation_ask_count ?? 0) > 0).length,
    editClasses: liveOutcomes
      .filter((o) => o.edit_class)
      .sort((a, b) => new Date(b.edit_measured_at ?? 0) - new Date(a.edit_measured_at ?? 0))
      .map((o) => o.edit_class),
    voiceGuideSupplied: !!(sections.find((s) => s.key === "voice_guide")?.body ?? "")
      .replace(/DELIBERATELY EMPTY[\s\S]*/, "").trim(),
  };
}

/** Everything score() needs, including the names count that used to be the caller's job. */
export async function gatherAll(q) {
  const counts = await gather(q);

  const names = await q("moment_names?select=moment_id,kind");
  const liveIds = new Set(
    (await q("moments?select=id,killed")).filter((m) => !m.killed).map((m) => m.id),
  );
  counts.namesOnFile = names
    .filter((n) => liveIds.has(n.moment_id) && n.kind !== "not_a_name").length;

  return counts;
}
