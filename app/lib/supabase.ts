import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for a desk with no sign-in.
 *
 * WHY THIS IS NO LONGER A PER-USER CLIENT
 *
 * The desk used to read and write through RLS as the signed-in user, which is the right shape when
 * there is a signed-in user. Sign-in has been removed by an explicit decision, and that breaks the
 * old arrangement completely rather than partially: every RLS policy on this project is
 * `auth.uid() IS NOT NULL`, and the `anon` role holds no table grants at all. With no session the
 * previous client returned zero rows from every table — not an error, just an empty desk, which is
 * the worst way for this to fail.
 *
 * So the app now connects as `service_role`, server-side only.
 *
 * WHAT THAT DOES AND DOES NOT GIVE UP
 *
 * It bypasses RLS. It does NOT bypass the grants, and that distinction is what saves clause 6.3:
 *
 *   service_role: SELECT, INSERT, UPDATE, REFERENCES, TRIGGER on 29 tables
 *   DELETE:       granted to nobody, on any table, in any role
 *
 * "Nothing is ever deleted, only killed and labelled" was never enforced by a policy — it is a
 * revoked grant. Removing RLS from the path leaves it standing. The desk still cannot delete a
 * moment, and neither can anyone who reaches it.
 *
 * THE KEY MUST NEVER BE PUBLIC
 *
 * SUPABASE_SERVICE_ROLE_KEY, with no NEXT_PUBLIC_ prefix, deliberately. Next.js compiles any
 * NEXT_PUBLIC_ variable into the browser bundle, so naming it that way would ship full database
 * access to every visitor. This module is imported only by server components, server actions and
 * route handlers; if it is ever imported by a client component the build will fail, which is the
 * behaviour we want.
 *
 * WHO CAN REACH THIS
 *
 * Anyone with the URL. That was the decision. The desk holds a named client's transcripts, drafts
 * and interview answers, and there is now nothing between them and a stranger except the obscurity
 * of the address. public/robots.txt asks crawlers to stay out, which is a request rather than a
 * control.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Loud rather than empty. A missing key used to surface as a desk with no content, which reads
    // as "there is no data" instead of "this is misconfigured" — and somebody acts on the first.
    throw new Error(
      `${name} is not set. The desk cannot reach the database without it. ` +
        `Set it in the Vercel project's environment variables and redeploy — it is compiled in at ` +
        `build time, so saving the variable alone changes nothing.`,
    );
  }
  return value;
}

export async function supabaseServer() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        // No session to persist and nothing to refresh: every request builds a fresh client and
        // there is no user to keep signed in.
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

/**
 * Kept so the handful of callers that destructure `{ db }` keep working. `user` is always null now;
 * nothing reads it, and returning it rather than removing it avoids a rename across a dozen files
 * for no behavioural gain.
 */
export async function requireUser() {
  const db = await supabaseServer();
  return { db, user: null };
}
