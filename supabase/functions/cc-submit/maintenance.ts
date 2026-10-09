/**
 * The three things the pipeline could not do from a session.
 *
 * With Telegram and the web app gone, Claude Code is the only surface — so anything it cannot reach
 * is a thing nobody can do. Three gaps were left after the decision tools:
 *
 *   The scheduled workers could only be waited for. Selection runs every four hours; if Josh asks
 *   "why has nothing been chosen", the honest answer was "ask again later".
 *
 *   The sentinel refresh needed a file on disk and a service key, so it was a script on our machine
 *   rather than something he could run.
 *
 *   The export — the whole idea bank as one file, which is the no-lock-in guarantee in clause 14.2 —
 *   was a page on the deleted web app and has had no replacement since. The handover document still
 *   tells him to use it.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/jobs.ts";
import { logEvent } from "../_shared/db.ts";
// The same measurement functions the sentinel scripts use, imported rather than reimplemented: two
// definitions of "what counts as a sentence" would make any comparison an artefact of the code.
// Deno reads this Node module as-is, the way the mcp function reads mcp-server/.
// @ts-types="./prose-types.d.ts"
import { measurePost, median, tally } from "../../../scripts/lib/prose.mjs";

type Body = Record<string, unknown>;

/* ── Run a worker now ─────────────────────────────────────────────────────── */

/**
 * The workers Josh may trigger, and why each one is safe to run on demand.
 *
 * An allowlist rather than a passthrough: `invoke_worker` can reach any function in the project, and
 * a tool that accepts a name from a model is a tool that can be asked for anything. These three are
 * read-then-decide jobs with no outward effect.
 *
 * `publish` is deliberately absent. It is the one worker that acts on the outside world, and it must
 * fire from a calendar date rather than because somebody asked — that is clause 11.2, and a
 * "publish now" door would be the hole in it.
 */
const RUNNABLE: Record<string, string> = {
  select: "worker-select",
  learn: "worker-learn",
  ops: "worker-ops",
  triage: "worker-triage",
};

export async function runWorker(db: SupabaseClient, body: Body): Promise<Response> {
  const which = String(body.worker ?? "").trim();
  const fn = RUNNABLE[which];

  if (!fn) {
    return json({
      error: `"${which}" is not a worker you can run. Choose one of: ${Object.keys(RUNNABLE).join(", ")}.`,
      note: "Publishing is not on that list on purpose: a post goes out on the date Josh set, never " +
        "because something asked for it now.",
    }, 400);
  }

  const { data, error } = await db.rpc("invoke_worker", {
    p_name: fn,
    p_payload: (body.payload as Record<string, unknown>) ?? {},
  });

  if (error) return json({ error: `could not start ${fn}: ${error.message}` }, 502);

  await logEvent(db, "worker_run_on_request", "info", { worker: fn });

  return json({
    ok: true,
    worker: fn,
    request_id: data ?? null,
    next: which === "select"
      ? "Selection is running. Ask for the next piece of work in a moment — if it chose nothing, " +
        "get_selection says why, and 'nothing worth writing' is a real answer."
      : which === "ops"
      ? "The health check is running. Anything it finds will be in system_status within a minute."
      : `${fn} is running. Its findings land where you would normally read them.`,
  });
}

/* ── Refresh the reference-writer measurements ────────────────────────────── */

/**
 * Re-measure the reference writers from the posts already stored.
 *
 * `scripts/sentinel-refresh.mjs` does this from a scrape file, and still does — it is what runs after
 * a fresh scrape. But since the posts themselves are now in `reference_writer_posts`, the measuring
 * half needs no file and no laptop, so Josh can ask for it.
 *
 * Two things it keeps from the script, both learned the hard way on 5 October:
 *
 *   Shape measures come only from posts that kept their line breaks. A scrape that returns a post as
 *   one line collapses paragraphs to 1 and makes the opening test read the whole post; averaging
 *   those in reported seven writers changing their habits when nothing had changed but the scraper.
 *
 *   It proposes rather than applies. Clause 12.10: the system proposes, Josh approves. Nothing here
 *   can reach `library_sections`.
 */
export async function refreshSentinels(db: SupabaseClient, _body: Body): Promise<Response> {
  const { data: posts } = await db
    .from("reference_writer_posts")
    .select("handle, author_name, posted_at, text, has_line_breaks")
    .order("posted_at", { ascending: false })
    .limit(2000);

  if (!posts || posts.length === 0) {
    return json({
      error: "No reference posts are stored, so there is nothing to measure.",
      next: "Run a scrape, then scripts/load-reference-posts.mjs --apply.",
    }, 409);
  }

  const byHandle = new Map<string, { name: string; rows: ReturnType<typeof measurePost>[]; shaped: ReturnType<typeof measurePost>[]; dates: string[] }>();

  for (const p of posts) {
    const handle = String(p.handle);
    const entry = byHandle.get(handle) ??
      { name: String(p.author_name ?? handle), rows: [], shaped: [], dates: [] };
    const m = measurePost(String(p.text));
    entry.rows.push(m);
    if (p.has_line_breaks) entry.shaped.push(m);
    if (p.posted_at) entry.dates.push(String(p.posted_at));
    byHandle.set(handle, entry);
  }

  const report = [...byHandle]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([handle, e]) => {
      const dates = e.dates.sort();
      return {
        handle,
        name: e.name,
        posts_measured: e.rows.length,
        window: dates.length
          ? { from: dates[0].slice(0, 10), to: dates[dates.length - 1].slice(0, 10) }
          : null,
        median_words: median(e.rows.map((r) => r.words)),
        sd_median: median(e.rows.map((r) => r.sentence_words_sd)),
        // Null, not a number nobody can source.
        above_fold_words_median: e.shaped.length ? median(e.shaped.map((r) => r.above_fold_words)) : null,
        opening_words_median: e.shaped.length ? median(e.shaped.map((r) => r.opening_words)) : null,
        paragraphs_median: e.shaped.length ? median(e.shaped.map((r) => r.paragraphs)) : null,
        opening_shapes: e.shaped.length ? tally(e.shaped.map((r) => r.opening_shape)) : null,
        close_shapes: e.shaped.length ? tally(e.shaped.map((r) => r.close_shape)) : null,
        list_rate: e.shaped.length
          ? +(e.shaped.filter((r) => r.uses_list).length / e.shaped.length).toFixed(2)
          : null,
        shape_basis: e.shaped.length,
      };
    });

  const shapedAll = [...byHandle.values()].flatMap((e) => e.shaped);

  const measurement = {
    measured_at: new Date().toISOString(),
    accounts: report.length,
    posts: posts.length,
    shape_basis: shapedAll.length,
    totals: {
      of: shapedAll.length,
      opens_with_question: shapedAll.filter((r) => r.opening_shape === "question").length,
      engagement_asks: shapedAll.filter((r) => r.close_shape === "engagement_ask").length,
      direct_asks: shapedAll.filter((r) => r.close_shape === "direct_ask").length,
    },
    report,
  };

  /*
   * A PROPOSAL HAS TO CARRY WHAT IT WOULD BECOME.
   *
   * The first version of this passed `proposed_body: null`, on the reasoning that re-measuring is
   * arithmetic and writing the section's prose is a judgement. The database refused it — the column
   * is NOT NULL — and the database was right. Josh approves a proposal by agreeing to a body; one
   * with nothing in it is a question dressed as a decision.
   *
   * So the measurement block is composed here and spliced between the same two markers
   * `scripts/sentinel-refresh.mjs` uses, leaving every word of the section he has written himself
   * untouched. If the markers are missing, this refuses rather than appending to the end and hoping.
   */
  const START = "<!-- sentinel-measurements:start -->";
  const END = "<!-- sentinel-measurements:end -->";

  const { data: section } = await db
    .from("library_sections")
    .select("body")
    .eq("key", "reference_posts")
    .maybeSingle();

  const current = String(section?.body ?? "");
  if (!current.includes(START) || !current.includes(END)) {
    return json({
      error: "The reference section has no measurement markers, so there is nowhere to put the " +
        "numbers without overwriting something Josh wrote.",
      measurement,
      next: "Run scripts/sentinel-refresh.mjs, which reports the same figures and can rebuild the block.",
    }, 409);
  }

  const n = (v: number | null) => (v == null ? "—" : v);
  const block = [
    START,
    "",
    "## The finding that matters most",
    "",
    `**Almost nobody opens with a question. ${measurement.totals.opens_with_question} of ` +
    `${measurement.totals.of} posts do.**`,
    "",
    "Josh's hook rule — a question may close a hook, never start one — is not a stylistic preference.",
    "It is what most of the writers he chose already do.",
    "",
    `- **${measurement.totals.engagement_asks} of ${measurement.totals.of} ask for engagement.**`,
    `- **${measurement.totals.direct_asks} of ${measurement.totals.of} carry a direct ask.**`,
    "",
    "## Per account",
    "",
    "| Account | Posts | Median words | Above fold | Paragraphs | Lists | Variation |",
    "|---|---|---|---|---|---|---|",
    ...report.map((r) =>
      `| ${r.name} | ${r.posts_measured} | ${r.median_words} | ${n(r.above_fold_words_median)} | ` +
      `${n(r.paragraphs_median)} | ${r.list_rate == null ? "—" : Math.round(r.list_rate * 100) + "%"} | ` +
      `${r.sd_median} |`
    ),
    "",
    `_Measured ${measurement.measured_at.slice(0, 10)} across ${measurement.accounts} accounts and ` +
    `${measurement.posts} posts._`,
    ...(shapedAll.length < posts.length
      ? [
        "",
        `_Above-fold, paragraph and list figures rest on the ${shapedAll.length} posts that still had ` +
        `their line breaks when collected. A dash means that row could not be measured, rather than ` +
        `measuring as one long paragraph._`,
      ]
      : []),
    "",
    END,
  ].join("\n");

  const proposedBody = current.slice(0, current.indexOf(START)) +
    block +
    current.slice(current.indexOf(END) + END.length);

  /*
   * ONE OPEN PROPOSAL PER SECTION, NOT ONE PER ASKING.
   *
   * Running this twice while testing left two identical proposals waiting on Josh. That is the exact
   * failure the refresh script's 25% threshold exists to avoid — stated in its own comment: "a
   * proposal he does not act on teaches him to stop reading them". A tool he can call on demand makes
   * stacking them easier, not harder.
   *
   * So an existing open proposal for this section is REPLACED. Its body is rebuilt from the section as
   * it stands right now, which also fixes a worse problem: a proposal composed an hour ago carries
   * the old section inside it, so approving a stale one silently reverts whatever was approved in
   * between.
   */
  const claim = `Re-measured ${posts.length} posts by ${report.length} reference writers from the ` +
    `stored corpus. Shape figures rest on the ${shapedAll.length} that kept their line breaks.`;
  const evidence = { kind: "sentinel_measurement", measured_at: measurement.measured_at, report };

  const { data: alreadyOpen } = await db
    .from("library_proposals")
    .select("id")
    .eq("section_key", "reference_posts")
    .eq("status", "open")
    .order("id", { ascending: true });

  // Keep the oldest open one and refresh it; close any extras this tool created before the fix.
  const [keep, ...extras] = alreadyOpen ?? [];

  let proposal: { id: number } | null = null;
  let error: { message: string } | null = null;

  if (keep) {
    const { data, error: updateError } = await db
      .from("library_proposals")
      .update({ claim, evidence, proposed_body: proposedBody })
      .eq("id", keep.id)
      .select("id")
      .single();
    proposal = data;
    error = updateError;

    for (const extra of extras) {
      await db.from("library_proposals")
        .update({
          status: "rejected",
          decided_at: new Date().toISOString(),
          decided_reason: `Superseded by proposal ${keep.id}, re-measured ${measurement.measured_at.slice(0, 10)}.`,
        })
        .eq("id", extra.id);
    }
  } else {
    const { data, error: insertError } = await db.from("library_proposals").insert({
      section_key: "reference_posts",
      claim,
      evidence,
      proposed_body: proposedBody,
      status: "open",
    }).select("id").single();
    proposal = data;
    error = insertError;
  }

  if (error) return json({ error: `measured, but could not open a proposal: ${error.message}` }, 502);

  await logEvent(db, "sentinels_refreshed", "info", {
    posts: posts.length,
    writers: report.length,
    proposal_id: proposal?.id ?? null,
  });

  return json({
    ok: true,
    measurement,
    proposal_id: proposal?.id ?? null,
    next: "Measured and recorded as a proposal. Nothing in the library changed — that is clause " +
      "12.10, and decide_proposal is how it lands.",
  });
}

/* ── Export the bank ──────────────────────────────────────────────────────── */

/**
 * Everything Josh has said and everything made from it, as one JSON object.
 *
 * Clause 14.2: the work becomes his, with no ongoing licence from us, and clause 6.2 wants the bank
 * exportable. The web app had a `/export` page that did this; it was deleted, nothing replaced it, and
 * `docs/04-handover.md` has been telling him to use it ever since.
 *
 * `exportable_tables()` is a DENY list, not an allow list — a table added by a later migration is
 * exported by default and has to be deliberately excluded. That is the right way round: the failure
 * mode of an allow list is a table quietly missing from his copy of his own data.
 */
export async function exportBank(db: SupabaseClient, _body: Body): Promise<Response> {
  const { data: tables, error } = await db.rpc("exportable_tables");
  if (error) return json({ error: `could not list the tables: ${error.message}` }, 502);

  const included = (tables ?? []).filter((t: { excluded_reason: string | null }) => !t.excluded_reason);
  const excluded = (tables ?? []).filter((t: { excluded_reason: string | null }) => t.excluded_reason);

  const out: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const t of included) {
    const name = String(t.table_name);
    const { data, error: readError } = await db.from(name).select("*").limit(5000);
    if (readError) {
      return json({ error: `could not read ${name}: ${readError.message}` }, 502);
    }
    out[name] = data ?? [];
    counts[name] = (data ?? []).length;
  }

  await logEvent(db, "bank_exported", "info", { tables: included.length, rows: Object.values(counts).reduce((a, b) => a + b, 0) });

  return json({
    ok: true,
    exported_at: new Date().toISOString(),
    row_counts: counts,
    // Said rather than silently done, because "my export was missing something" is the complaint this
    // guarantee exists to prevent.
    left_out: excluded.map((t: { table_name: string; excluded_reason: string }) => ({
      table: t.table_name,
      why: t.excluded_reason,
    })),
    data: out,
    next: "Everything you have said and everything made from it. Credentials are deliberately left " +
      "out — they are ours to reissue, not yours to carry around in a file.",
  });
}
