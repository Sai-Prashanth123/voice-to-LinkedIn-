/**
 * Enough of a PostgREST client to drive a route against in-memory rows.
 *
 * TEST SUPPORT ONLY. Nothing in the running system imports this, which is also why it is safe to
 * have in `_shared/`: an edge bundle carries the import graph, so a module nobody imports never
 * travels.
 *
 * WHY A FAKE AND NOT THE LOCAL STACK
 *
 * The local stack is the better test and it cannot be relied on for this. It brings up real
 * Postgres, real PostgREST and the real cc-submit, then refuses to finish booting because the
 * `data/local` snapshot has ten empty library sections — deliberately, because a cluster that
 * applied every migration and has an empty voice guide is a system that cannot judge a draft while
 * reporting itself healthy. So it is the right tool for the drafting path and unavailable for a
 * route that has nothing to do with the library.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not enforce a constraint, a grant or a policy. Those are the database's job and they are
 * asserted against real Postgres by `local/probe-0061.mjs`, which applies every migration to a
 * fresh cluster and then tries to break each one. A fake that pretended to enforce them would be
 * the worst of both: green here, and no evidence about the thing that actually guards the data.
 *
 * **And it does not supply column defaults.** A row arrives with exactly the keys the caller sent.
 * That is deliberate and it is load-bearing: it is what lets a test assert that a worker leaves
 * `status` alone and lets the database default it. A fake that helpfully filled in `status:
 * 'offered'` made that assertion pass no matter what the worker did — the check with nothing left
 * to check, in the tool built to find them. Seed the defaults you need.
 */

/** A thenable query builder over one array of rows. */
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface FakeDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  tables: Record<string, Row[]>;
  calls: { upserts: number; inserts: number; updates: number };
}

/**
 * `seed` is the starting rows per table. Any table read that was not seeded answers empty rather
 * than throwing, because a route reading a table it does not write is normal.
 *
 * Returns `any` deliberately. Every caller hands it to something that wants a real
 * `SupabaseClient`, and structurally satisfying that interface would mean stubbing dozens of
 * members no route touches — pure ceremony, and it would hide which methods are actually exercised.
 * `FakeDb` above is the shape that matters, for reading.
 */
// deno-lint-ignore no-explicit-any
export function fakeDb(seed: Record<string, Row[]> = {}): any {
  const tables: Record<string, Row[]> = {
    creators: [],
    creator_posts: [],
    comment_options: [],
    moment_names: [],
    library_sections: [{ key: "core_rules", title: "Core", body: "the rules", sort_order: 0 }],
    library_versions: [{ version: 7 }],
    settings: [],
    notices: [],
    system_events: [],
    ...seed,
  };

  const calls = { upserts: 0, inserts: 0, updates: 0 };

  const builder = (table: string) => {
    tables[table] ??= [];
    const rows = () => tables[table];
    const filters: Array<(r: Row) => boolean> = [];
    let limit: number | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let headCount = false;
    let mode: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | Row[] = {};

    const apply = () => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const { col, asc } = orderBy;
        out = [...out].sort((a, b) => {
          const x = a[col] ?? "", y = b[col] ?? "";
          if (x === y) return 0;
          return (x < y ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (limit != null) out = out.slice(0, limit);
      return out;
    };

    const run = () => {
      if (mode === "update") {
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, payload);
        calls.updates++;
        return { data: hit, error: null, count: hit.length };
      }
      if (mode === "insert" || mode === "upsert") {
        const list = Array.isArray(payload) ? payload : [payload];
        if (mode === "upsert") {
          calls.upserts++;
          for (const p of list) {
            // Conflict on whichever key the row carries as its identity here. Enough for the two
            // tables this is used against; not a general implementation.
            const key = p.activity_id !== undefined ? "activity_id" : "handle";
            const existing = rows().find((r) => r[key] === p[key]);
            if (existing) Object.assign(existing, p);
            else rows().push({ ...p });
          }
        } else {
          calls.inserts++;
          for (const p of list) rows().push({ ...p });
        }
        return { data: list, error: null, count: list.length };
      }
      const out = apply();
      /*
       * COPIES, because PostgREST hands back JSON over HTTP and a real client cannot give you a
       * live reference into the table.
       *
       * Returning the row objects themselves made a route look wrong that was only slightly
       * fragile: it read a field off the row it had just upserted, `Object.assign` had mutated the
       * very object the earlier read returned, and the pre-write value was gone. A fake that
       * differs from the real client produces false failures and, worse, false passes.
       */
      const copied = out.map((r) => ({ ...r }));
      return { data: headCount ? null : copied, error: null, count: out.length };
    };

    const self: Row = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) headCount = true;
        return self;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return self;
      },
      neq(col: string, val: unknown) {
        filters.push((r) => r[col] !== val);
        return self;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
        return self;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return self;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, asc: opts?.ascending !== false };
        return self;
      },
      limit(n: number) {
        limit = n;
        return self;
      },
      maybeSingle() {
        return Promise.resolve({ data: apply()[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: apply()[0] ?? null, error: null });
      },
      update(p: Row) {
        mode = "update";
        payload = p;
        return self;
      },
      insert(p: Row | Row[]) {
        mode = "insert";
        payload = p;
        return self;
      },
      upsert(p: Row | Row[]) {
        mode = "upsert";
        payload = p;
        return self;
      },
      // deno-lint-ignore no-explicit-any
      then(resolve: any, reject: any) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e);
        }
      },
    };
    return self;
  };

  // deno-lint-ignore no-explicit-any
  return { from: (table: string) => builder(table), tables, calls } as any;
}
