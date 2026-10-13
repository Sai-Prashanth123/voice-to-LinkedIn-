/**
 * The two sources outside the ten fields, loaded the way this runtime reaches the database.
 *
 * WHY THERE ARE TWO OF THESE AND NOT ONE
 *
 * The twin is `writingSources` in supabase/functions/_shared/handlers/draft.ts. Deno reaches
 * Postgres through SupabaseClient and this server through its own wrapper, so the two loaders
 * genuinely have to be separate functions — the same reason `isSupplied` and the gate's input rule
 * live in views.ts while their callers do not.
 *
 * What they must never disagree on is WHICH rows they load, and that is why neither of them names
 * a table or a key itself: both import `HIS_WORDS_TABLE` and `RECEIPTS_SECTION` from entry.ts, and
 * sources.test.mjs fails if either grows its own copy. Every "two readers of one rule" bug in this
 * repository looked exactly like a second copy of a string.
 *
 * WHAT THIS IS NOT
 *
 * It is not the thing that decides. The server rebuilds both sources from the database before it
 * verifies a claim, and ignores whatever a caller passes. This copy exists so the drafting brief
 * can SHOW the writer what it may cite, and so `create_draft` can tell a caller a span is wrong
 * before spending a round trip to find out. If these two ever disagree, the server wins.
 */

import { HIS_WORDS_TABLE, RECEIPTS_SECTION } from "../supabase/functions/_shared/entry.ts";
import { isSupplied } from "../supabase/functions/_shared/views.ts";

/**
 * @returns `{ his_words, receipts }` — empty strings where absent, which sourceEntry drops.
 */
export async function writingSources(db, momentId) {
  const raw = await db.select(HIS_WORDS_TABLE, {
    select: "transcript,text_body",
    moment_id: `eq.${momentId}`,
    order: "id.asc",
  });

  const hisWords = (raw ?? [])
    .map((r) => r.transcript ?? r.text_body ?? "")
    .filter((s) => s.trim().length > 0)
    .join("\n\n");

  const [receipts] = await db.select("library_sections", {
    select: "body",
    key: `eq.${RECEIPTS_SECTION}`,
    limit: 1,
  });

  return {
    his_words: hisWords,
    // isSupplied, not a truthiness check. A placeholder in receipts is text Josh did not write, and
    // a span quoted from a placeholder would be a fabricated claim that verified cleanly.
    receipts: isSupplied(receipts?.body) ? (receipts?.body ?? "") : "",
  };
}
