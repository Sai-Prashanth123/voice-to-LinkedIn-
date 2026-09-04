import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAllowed } from "./lib/allowlist";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * One user, and only one.
 *
 * The idea bank holds transcripts, session logs and drafts, including material belonging to Josh's
 * clients (15.4). So this refuses anyone who is not him, by address, rather than merely requiring
 * "an account" — a Supabase project with sign-ups enabled would otherwise let any stranger who
 * registers read the lot.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser revalidates against the auth server; getSession would trust the cookie.
  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 15.4 — "the idea bank holds call transcripts and client material, so 'has an account' is not
  // sufficient — it must be Josh, by address."
  //
  // FAILS CLOSED. This used to read `if (user && allowed && ...)`, so an unset ALLOWED_EMAIL made
  // the condition short-circuit and let every signed-in user straight through. On a laptop with the
  // variable always set it looked correct for months; on a public deployment where it was missing,
  // anyone holding an account on this Supabase project could have read the whole bank.
  //
  // A missing allowlist is now a locked door, not an open one. The rule itself lives in
  // lib/allowlist.ts, because the sign-in page has to apply the identical one before it posts a
  // magic link - and two copies of an access rule is one copy too many.
  if (user && !isAllowed(user.email)) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except public assets.
     *
     * `manifest.webmanifest` has to be here: a browser fetches it WITHOUT credentials when deciding
     * whether a site is installable, so auth-gating it silently breaks "add to home screen" with no
     * error anywhere. It contains nothing private — a name, a colour and some icon paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
