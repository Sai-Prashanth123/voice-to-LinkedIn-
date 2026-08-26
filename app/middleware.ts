import { createServerClient, type CookieOptions } from "@supabase/ssr";
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

  const allowed = process.env.ALLOWED_EMAIL?.toLowerCase();
  if (user && allowed && user.email?.toLowerCase() !== allowed) {
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
