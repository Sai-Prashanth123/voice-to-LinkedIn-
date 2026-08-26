import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server-side Supabase client bound to Josh's session.
 *
 * Deliberately NOT the service role. The app reads and writes through RLS as the signed-in user,
 * which means the guarantees in migration 0006 apply to everything this app does — including 6.3:
 * there is no DELETE policy on any table, so the app cannot delete a moment even by accident.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

export async function requireUser() {
  const db = await supabaseServer();
  const { data } = await db.auth.getUser();
  return { db, user: data.user };
}
