#!/usr/bin/env node
/**
 * CLAUSE 17 — THE SCORECARD.
 *
 *   node eval/acceptance.mjs
 *
 * Answers "how far along is this?" from the live database, for all twelve component tests and the
 * overall test in 17a. Until this existed, nobody could answer that question without querying by
 * hand, which meant the contractual finish line was invisible to both parties.
 *
 * The scoring lives in `supabase/functions/_shared/acceptance.ts` and is shared verbatim with
 * `worker-ops`, which folds the same summary into Josh's monthly message. Node 22+ strips types
 * natively, so the module is imported rather than copied — `app/lib/diff.ts` had to be copied and
 * needed its own test to stop the two drifting.
 *
 * Reads through PostgREST with the service role, the same way `gate-acceptance.mjs` does. Set
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or put them in a gitignored `eval/.env`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { overall, score, summarise, voiceGuideWarning } from "../supabase/functions/_shared/acceptance.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// A gitignored file rather than a shell export, because this key opens everything and a shell
// history is a poor place for it.
for (const line of readEnvFile(join(HERE, ".env"))) {
  const eq = line.indexOf("=");
  if (eq > 0 && !process.env[line.slice(0, eq).trim()]) {
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

function readEnvFile(path) {
  try {
    return readFileSync(path, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_BASE || !KEY) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or copy eval/.env.example to eval/.env.",
  );
  process.exit(2);
}

async function q(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

/** Rows, with killed moments excluded wherever a moment is involved. */
async function gather() {
  const [
    moments, rawInputs, material, drafts, gateRuns, selectionRuns,
    visuals, posts, outcomes, proposals, sections,
  ] = await Promise.all([
    q("moments?select=id,source,status,depth_reached,killed"),
    q("raw_inputs?select=moment_id,kind,transcript"),
    q("material?select=moment_id,the_moment,the_detail,the_realisation"),
    q("drafts?select=moment_id,gate_passed"),
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
    gatePassedDrafts: ofLive(drafts).filter((d) => d.gate_passed).length,
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

const MARK = { passing: "PASS", failing: "FAIL", blocked: "----" };

const counts = await gather();

// Names live on a separate table; one more read rather than a join through PostgREST.
const names = await q("moment_names?select=moment_id,kind");
const liveIds = new Set(
  (await q("moments?select=id,killed")).filter((m) => !m.killed).map((m) => m.id),
);
counts.namesOnFile = names.filter((n) => liveIds.has(n.moment_id) && n.kind !== "not_a_name").length;

const results = score(counts);
const finish = overall(counts);

console.log("\nCLAUSE 17 — COMPONENT TESTS");
console.log("Verification fixtures excluded. Every number read from the live database.\n");

for (const r of [...results, finish]) {
  console.log(`  ${MARK[r.verdict]}  ${r.n.padEnd(4)} ${r.name}`);
  console.log(`        needs:  ${r.requires}`);
  console.log(`        actual: ${r.actual}`);
  if (r.blocker) console.log(`        blocked on: ${r.blocker}`);
  console.log("");
}

console.log(`  ${summarise(results)}`);
console.log(`  17a: ${finish.actual}\n`);

const warning = voiceGuideWarning(counts);
if (warning) console.log(`  NOTE  ${warning}\n`);

// Non-zero while anything is outstanding, so this can gate a handover checklist rather than being
// read by eye and misremembered.
process.exit(results.every((r) => r.verdict === "passing") && finish.verdict === "passing" ? 0 : 1);
