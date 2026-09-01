/**
 * A thin PostgREST client.
 *
 * Not @supabase/supabase-js. That library is built for a browser session — auth refresh, realtime,
 * storage — and none of it applies to a process holding one scoped key. What is left after removing
 * all of that is a fetch call and some error handling, which is this file.
 *
 * WHY THE ERRORS GET THIS MUCH ATTENTION
 *
 * A model calling a tool cannot see a stack trace; it sees the string it is handed and decides what
 * to do next. PostgREST returns a JSON body with `message`, `hint` and `details`, and the useful
 * half is usually in `hint`. Collapsing that to "request failed" would turn every recoverable
 * mistake — a bad column name, a filter on a column that does not exist — into a dead end.
 *
 * Errors that mean "you are not allowed" are labelled as such rather than passed through raw,
 * because after task 1.4 that will be the most common failure and it is not a bug.
 */

const TIMEOUT_MS = Number(process.env.CONTENT_MCP_TIMEOUT_MS ?? 15000);

export class DbError extends Error {
  constructor(message, { status = 0, code = null, denied = false } = {}) {
    super(message);
    this.name = "DbError";
    this.status = status;
    this.code = code;
    this.denied = denied;
  }
}

export function createDb({ url, key }) {
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    // Ask PostgREST to count nothing unless a caller opts in — counting is a second query.
    Prefer: "count=none",
  };

  async function request(path, init = {}) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        signal,
      });
    } catch (err) {
      const why = err?.name === "TimeoutError"
        ? `No response in ${TIMEOUT_MS}ms`
        : err?.message ?? String(err);
      throw new DbError(`Could not reach the database: ${why}`);
    }

    const text = await res.text();

    if (!res.ok) {
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: text.slice(0, 400) };
      }
      const parts = [body.message, body.details, body.hint].filter(Boolean);
      const denied = res.status === 401 || res.status === 403 || body.code === "42501";
      const prefix = denied ? "Not permitted" : `Database error ${res.status}`;
      throw new DbError(
        `${prefix}: ${parts.join(" — ") || res.statusText || "no detail given"}`,
        { status: res.status, code: body.code ?? null, denied },
      );
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new DbError(`The database returned something that is not JSON: ${text.slice(0, 200)}`);
    }
  }

  return {
    /** Raw path against /rest/v1, for anything the helpers below do not cover. */
    request,

    /** GET a table. `query` is a plain object of PostgREST parameters. */
    async select(table, query = {}) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        params.append(k, String(v));
      }
      const qs = params.toString();
      return (await request(`/${table}${qs ? `?${qs}` : ""}`)) ?? [];
    },

    /** POST rows. Returns the inserted rows so a caller can report the id it just created. */
    async insert(table, rows, { returning = true } = {}) {
      return await request(`/${table}`, {
        method: "POST",
        headers: { Prefer: returning ? "return=representation" : "return=minimal" },
        body: JSON.stringify(rows),
      });
    },

    /** Call a Postgres function. */
    async rpc(name, args = {}) {
      return await request(`/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
    },

    /**
     * Proves the URL and the key work together.
     *
     * It probes a table rather than the PostgREST root, because the root is service_role-only —
     * the one key this server must never hold. A health check that can only pass with the
     * forbidden key is not a health check.
     *
     * Three outcomes are worth telling apart, and only the third is a fault:
     *   ok      — reachable, key valid, the role can read
     *   granted:false — reachable, key valid, the role has no grants yet. This is the EXPECTED
     *             state until task 1.4 creates the scoped role, and it is not an error.
     *   throws  — the key is wrong, or the project is unreachable.
     */
    async ping(probe = "moments") {
      let res, text;
      try {
        res = await fetch(`${base}/${probe}?select=id&limit=1`, {
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        text = await res.text();
      } catch (err) {
        const why = err?.name === "TimeoutError"
          ? `no response in ${TIMEOUT_MS}ms`
          : err?.message ?? String(err);
        throw new DbError(`Could not reach the project: ${why}`);
      }

      if (res.ok) return { reachable: true, granted: true };

      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }

      // A role with no grants is a different thing from a key the gateway refuses. PostgREST
      // reports the first as 42501 with a message it wrote itself; the gateway reports the second
      // before PostgREST is ever reached, so there is no code at all.
      if (body.code === "42501" || /permission denied/i.test(body.message ?? "")) {
        return { reachable: true, granted: false, detail: body.message ?? "permission denied" };
      }

      throw new DbError(
        `The key was not accepted: ${body.message ?? res.statusText ?? res.status}`,
        { status: res.status, code: body.code ?? null, denied: true },
      );
    },
  };
}
