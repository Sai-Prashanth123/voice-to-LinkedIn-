/**
 * The creator poll, twice a day on a weekday.
 *
 * A shell. Everything it does lives in `_shared/engage.ts` so that the cap, the off state, the
 * three checks and the ordering can be tested without binding a port — see that file's header.
 *
 * Scheduled by `cron.schedule('creator-poll', '0 7,15 * * 1-5', ...)` in migration 0061, which
 * goes on unconditionally: an empty `creators` table is the off state, so there is no flag to
 * remember to put back.
 */

import { admin, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import { poll } from "../_shared/engage.ts";

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);
  try {
    return await poll(db);
  } catch (err) {
    /*
     * A thrown worker is a worker that ran and left nothing behind saying so. 13.2 is that failures
     * surface rather than being swallowed, and this one has no job row to carry `last_error`.
     */
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(db, "creator_poll_failed", "error", { error: message.slice(0, 500) });
    return json({ ok: false, error: message }, 500);
  }
});
