import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

/** Exchanges the magic-link code for a session cookie, then drops Josh into the weekly pass. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?failed=1", request.url));

  const db = await supabaseServer();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?failed=1", request.url));

  return NextResponse.redirect(new URL("/", request.url));
}
