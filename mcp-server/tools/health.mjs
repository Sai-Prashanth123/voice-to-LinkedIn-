/**
 * Proves the server can reach the database with the key it was given.
 *
 * Worth a tool of its own because the two ways this server fails look identical from the outside:
 * a wrong key and an unreachable project both end as "the tool returned nothing useful". This
 * separates them, and it is also what task 1.6 calls first.
 */

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
    async handler(_args, { db, url }) {
      const started = Date.now();
      const { granted, detail } = await db.ping();
      return {
        ok: true,
        url,
        round_trip_ms: Date.now() - started,
        can_read: granted,
        note: granted
          ? undefined
          : `The key works but its role has no grants yet (${detail}). Task 1.4 creates the ` +
            `scoped role. Until then every read tool will return a permission error, and that ` +
            `is configuration rather than a fault.`,
      };
    },
  },
];
