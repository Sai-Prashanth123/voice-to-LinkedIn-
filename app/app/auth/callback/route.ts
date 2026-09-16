import { NextResponse, type NextRequest } from "next/server";

/**
 * Magic links no longer have anything to exchange, so this only forwards.
 *
 * WHY IT STILL EXISTS
 *
 * Links already sent are still in inboxes and still point here, carrying a `code` in the query
 * string. Supabase will keep verifying those codes and redirecting to this route until they expire.
 * A 404 at that moment is indistinguishable from a broken product, which is exactly the experience
 * this change was made to end.
 *
 * The code itself is ignored. There is no session to create.
 */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url));
}
