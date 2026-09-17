import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Search behind the command palette (clause 6.1).
 *
 * Thin on purpose. The ranking lives in `search_moments` in migration 0027, so the palette and the
 * bank page get identical results from one implementation — the rule this build has had to learn
 * twice, once when the conversation question disagreed across two surfaces and once when the edit
 * classifier had to be copied.
 *
 * SECURITY: there is no sign-in any more, so this reaches the same rows any page on the desk
 * reaches. The 401 that used to stand here was removed with the rest of the auth, not overlooked —
 * leaving it would have made search the one part of an open desk that refused to answer, which
 * reads as a broken feature rather than a protected one.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ moments: [] });

  const db = await supabaseServer();

  const { data: hits, error } = await db.rpc("search_moments", { q, limit_to: 8 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids: number[] = (hits ?? []).map((h: { moment_id: number }) => h.moment_id);
  if (ids.length === 0) return NextResponse.json({ moments: [] });

  const { data: moments } = await db
    .from("moments")
    .select("id, title, status, pillar, material(the_moment)")
    .in("id", ids);

  // Re-ordered to the ranking, which `in()` does not preserve. flatMap rather than
  // map().filter(Boolean) because only flatMap narrows away the undefined.
  const byId = new Map((moments ?? []).map((m) => [m.id, m]));

  return NextResponse.json({
    moments: ids.flatMap((id: number) => {
      const m = byId.get(id);
      if (!m) return [];
      // deno-lint-ignore no-explicit-any
      const raw = (m as any).material;
      const mat = Array.isArray(raw) ? raw[0] : raw;
      return [{
        id: m.id,
        title: m.title,
        status: m.status,
        pillar: m.pillar,
        line: String(mat?.the_moment ?? "").split(/\r?\n/)[0].slice(0, 90),
      }];
    }),
  });
}
