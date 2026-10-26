/**
 * Every reference post that kept its line breaks, loaded in pages.
 *
 * WHY THIS IS A FILE RATHER THAN A LINE
 *
 * PostgREST caps a response at 1,000 rows whatever limit is asked for. Measured 26 October:
 * `limit: "2000"` and `limit: "5000"` both return exactly 1,000, with no error and no indication
 * that anything was left behind. There are 1,839 posts with their line breaks intact.
 *
 * The ninth gate check — added on 14 October to answer Josh's "wall of text" complaint — was asking
 * for 500. So every `shape` verdict it has ever recorded was judged against per-writer medians
 * computed from roughly 43 of Matt Barker's 241 measurable posts, and the band across the eight came
 * out 7 to 23 where the truth is 8 to 21. Wider than real, which makes the check more permissive
 * than it was written to be. Raising the number would not have fixed it, because the ceiling belongs
 * to the server and it is silent.
 *
 * Three callers need these rows now — get_gate_brief, the drafting brief's writer target, and the
 * edge function's own gate — and a target the drafter aims at that differs from the one the gate
 * judges against is not a target, it is a coincidence. The Deno side has its own loader because the
 * two clients differ; the constants both use live in _shared/shape.ts, which is the arrangement
 * entry.ts's note on HIS_WORDS_TABLE describes and the reason for it.
 */

import {
  SHAPE_ROWS_PAGE,
  SHAPE_ROWS_SELECT,
} from "../supabase/functions/_shared/shape.ts";

/**
 * @param db the Node wrapper from mcp-server/db.mjs
 * @returns every row, not the first page of them
 */
export async function shapedWriterRows(db) {
  const out = [];
  for (let offset = 0;; offset += SHAPE_ROWS_PAGE) {
    const page = await db.select("reference_writer_posts", {
      select: SHAPE_ROWS_SELECT,
      has_line_breaks: "is.true",
      // Ordered so the pages cannot overlap or skip. Without an order PostgREST makes no promise
      // about which rows a given offset returns, which is how a paged read quietly loses some.
      order: "activity_id.asc",
      offset: String(offset),
      limit: String(SHAPE_ROWS_PAGE),
    });
    out.push(...page);
    if (page.length < SHAPE_ROWS_PAGE) break;
  }
  return out;
}
