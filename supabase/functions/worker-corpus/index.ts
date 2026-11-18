/**
 * The reference-writer corpus refresh, weekly.
 *
 * A shell. Everything it does lives in `_shared/corpus.ts`, so the backend choice, the two merge
 * guards and the detached run can be tested without binding a port — see that file's header.
 *
 * Josh asked for this on 18 November: "collect all nine on a schedule, keeping line breaks and
 * counts." Until today the only path was two scripts run by hand on a laptop, and seven of his nine
 * writers had carried no reaction count since 20 October.
 *
 * WHICH KEY IS IN THE VAULT DECIDES WHAT THIS CAN DO, and the run says so rather than implying it
 * worked. Apify refreshes the whole corpus; the console can only add posts not already held,
 * because it strips line breaks and six columns here are counted from them.
 */

import { admin } from "../_shared/db.ts";
import { refreshDetached } from "../_shared/corpus.ts";

Deno.serve(() => refreshDetached(admin()));
