/**
 * The creator poll, twice a day on a weekday.
 *
 * A shell. Everything it does lives in `_shared/engage.ts` so that the cap, the off state, the
 * three checks, the ordering and — since 18 November — the detached run can be tested without
 * binding a port. See that file's header.
 *
 * Scheduled by `cron.schedule('creator-poll', '0 7,15 * * 1-5', ...)` in migration 0061, which
 * goes on unconditionally: an empty `creators` table is the off state, so there is no flag to
 * remember to put back.
 */

import { admin } from "../_shared/db.ts";
import { pollDetached } from "../_shared/engage.ts";

Deno.serve(() => pollDetached(admin()));
