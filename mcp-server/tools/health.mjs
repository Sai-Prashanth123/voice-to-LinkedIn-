/**
 * Proves the server can reach the database with the key it was given.
 *
 * Worth a tool of its own because the two ways this server fails look identical from the outside:
 * a wrong key and an unreachable project both end as "the tool returned nothing useful". This
 * separates them, and it is also what task 1.6 calls first.
 */

import { buildStamp } from "../build-stamp.mjs";

/**
 * The connector's build and the write door's, side by side, and whether they agree.
 *
 * Never throws. A health check that fails because one of its readings failed tells you less than
 * one that reports the reading it could not take — and the whole point of this tool is that three
 * failures which look identical from outside are told apart.
 */
async function bothBuilds(url, contextKey) {
  const connector = buildStamp();
  const key = contextKey ?? process.env.CONTENT_MCP_KEY;

  let writeDoor;
  if (!url || !key) {
    writeDoor = { commit: null, source: "not_asked", means: "No URL or key here to ask it with." };
  } else {
    try {
      const res = await fetch(`${url}/functions/v1/cc-submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "build" }),
        signal: AbortSignal.timeout(4000),
      });
      const body = await res.json().catch(() => ({}));
      writeDoor = body?.build ?? {
        commit: null,
        source: "unreadable",
        means: `cc-submit answered ${res.status} without a build. If it says the kind is unknown, ` +
          "the deployed cc-submit predates the build route and is older than this connector.",
      };
    } catch (err) {
      writeDoor = {
        commit: null,
        source: "unreachable",
        means: `Could not ask cc-submit (${err?.message ?? err}). Unconfirmed, not confirmed bad.`,
      };
    }
  }

  const agree = Boolean(connector.commit) && connector.commit === writeDoor.commit;
  return {
    connector,
    write_door: writeDoor,
    agree,
    means: agree
      ? `Both surfaces are on ${connector.commit}.`
      : "THESE DO NOT AGREE, so half of a change may be live. `git push` reaches Josh through " +
        "neither of these; only a deploy does, and the two functions deploy separately. Run " +
        "`node scripts/deploy.mjs` before trusting either reading. A null commit on the write " +
        "door with source `unreadable` means the deployed cc-submit is older than this route.",
  };
}

export const health = [
  {
    name: "health",
    config: {
      title: "Health check",
      description:
        "Check that the content system's database is reachable and the key is accepted. " +
        "Returns the project URL and how long the round trip took. Call this first if any other " +
        "tool fails in a way that looks like a connection problem.",
    },
    async handler(_args, { db, url, key }) {
      const started = Date.now();
      const { granted, detail } = await db.ping();
      return {
        ok: true,
        url,
        round_trip_ms: Date.now() - started,
        can_read: granted,
        /*
         * WHICH CODE IS ANSWERING, on both sides of the write door.
         *
         * `system_status` reports the connector's build. It cannot report cc-submit's, because
         * cc-submit does not serve it — so until 2 November the function holding every write in
         * the system had no readable version at all, and a deploy of it could not be told from a
         * deploy that silently did nothing.
         *
         * They are reported together because the failure that matters is them DISAGREEING: a push
         * reaches Josh through neither surface, a deploy of one reaches him through one, and two
         * halves of one change can be live on one side and absent on the other. That is what
         * happened on 27 October, and the only thing that would have shown it is this comparison.
         */
        builds: await bothBuilds(url, key),
        note: granted
          ? undefined
          : `The key works but its role has no grants yet (${detail}). Task 1.4 creates the ` +
            `scoped role. Until then every read tool will return a permission error, and that ` +
            `is configuration rather than a fault.`,
      };
    },
  },
];
