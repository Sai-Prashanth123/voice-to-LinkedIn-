import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

/**
 * 6.2 — "Must export in full to a plain, portable format on demand. No format that only one vendor
 * can read."
 *
 * The idea bank is described in the spec as the asset — "the thing that has to survive" every tool
 * around it. So this produces one JSON document containing every row of every table, plus a manifest
 * of every stored file with a download URL. JSON because it opens in anything; one file because an
 * export split across a dozen downloads is one nobody takes.
 *
 * `pg_dump` remains the fuller answer for restoring into another Postgres, and the runbook covers
 * it. This is the version Josh can use without a terminal.
 */

/**
 * WHICH TABLES, AND WHY IT IS NOT A LIST HERE
 *
 * This used to hold a hard-coded list of nineteen. Three tables added by later migrations were
 * silently absent from every export — including `library_recordings`, the recorded voice interview,
 * which 8.1 calls the source of truth for the voice guide and which is the one artefact in the whole
 * system that cannot be regenerated from anything else.
 *
 * An allow-list has to be remembered. A deny-list has to be justified. `exportable_tables()` returns
 * every table in `public` with a reason where one is deliberately withheld, so a table added
 * tomorrow is in the export because it exists — and the bundle says out loud what was left out,
 * rather than leaving a reader to wonder whether a gap is a decision or a bug.
 */

const BUCKETS = ["voice-notes", "images", "renders"] as const;

export async function GET() {
  const db = await supabaseServer();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const bundle: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    note:
      "Complete export of the content system. Every table except those listed under 'excluded', " +
      "plus a manifest of stored audio and images with signed links. Nothing here needs the system " +
      "that produced it to be readable.",
    tables: {},
    files: {},
  };

  // 6.2 — the list comes from the database, not from this file.
  const { data: catalogue, error: catalogueError } = await db.rpc("exportable_tables");
  if (catalogueError) {
    return NextResponse.json({ error: `could not list tables: ${catalogueError.message}` }, { status: 500 });
  }

  const all = (catalogue ?? []) as { table_name: string; excluded_reason: string | null }[];
  const tables = all.filter((t) => !t.excluded_reason).map((t) => t.table_name);

  // Stated in the bundle so the boundaries of the export are part of the export.
  bundle.excluded = Object.fromEntries(
    all.filter((t) => t.excluded_reason).map((t) => [t.table_name, t.excluded_reason]),
  );

  for (const table of tables) {
    // Paged, because the idea bank only ever grows — 6.3 forbids deleting anything.
    const rows: unknown[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from(table).select("*").range(from, from + pageSize - 1);
      if (error) {
        (bundle.tables as Record<string, unknown>)[table] = { error: error.message };
        break;
      }
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) {
        (bundle.tables as Record<string, unknown>)[table] = rows;
        break;
      }
    }
  }

  // Storage objects are listed with signed URLs rather than inlined: base64 audio would make the
  // export enormous and unreadable, and links Josh can click are more use than bytes he cannot.
  for (const bucket of BUCKETS) {
    const files: { path: string; url: string | null; size: number | null }[] = [];
    const { data: top } = await db.storage.from(bucket).list("", { limit: 1000 });
    for (const entry of top ?? []) {
      // Objects are stored under a per-moment folder.
      const { data: inner } = await db.storage.from(bucket).list(entry.name, { limit: 1000 });
      for (const file of inner ?? []) {
        const path = `${entry.name}/${file.name}`;
        const { data: signed } = await db.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7);
        files.push({
          path,
          url: signed?.signedUrl ?? null,
          size: (file.metadata as { size?: number } | null)?.size ?? null,
        });
      }
    }
    (bundle.files as Record<string, unknown>)[bucket] = files;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="idea-bank-${stamp}.json"`,
    },
  });
}
