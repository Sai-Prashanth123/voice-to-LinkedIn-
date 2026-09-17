import Link from "next/link";
import { many, one } from "@/lib/embed";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The material fields, in the order the story is told. */
const MATERIAL_FIELDS = [
  ["the_moment", "The moment"],
  ["the_detail", "The detail"],
  ["their_actual_words", "Their actual words"],
  ["the_realisation", "The realisation"],
  ["the_lesson", "The lesson"],
] as const;

type Material = Record<(typeof MATERIAL_FIELDS)[number][0], string | null>;

/**
 * THE IDEA BANK — READ ONLY.
 *
 * This page used to be where ideas were corrected, pinned, killed, re-opened and cleared for names.
 * All of that moved. The desk is now a place to LOOK: every idea and what came out of its interview,
 * and — one click away — the drafts written from it.
 *
 * Changing anything happens in Claude or in Telegram. That is a single place to change the bank, which
 * matters for 6.3: with two editors, "nothing is ever deleted, only killed and labelled" had to be
 * enforced twice and argued about twice.
 *
 * Search stays because it writes nothing. It is a plain GET, so a result is a real URL.
 */
export default async function Bank({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? "mined";
  const q = (params.q ?? "").trim();
  const db = await supabaseServer();

  const COLUMNS =
    "id, title, source, status, pillar, audience, strength, depth_reached, pinned, killed, not_before, parked_reason, notes, captured_at, decays_at, last_score, last_score_reasons, material(the_moment, the_detail, the_realisation, the_lesson, their_actual_words), moment_names(id, name, cleared, kind), drafts(id)";

  // A search looks ACROSS every status. Searching inside the current tab would hide the idea being
  // looked for whenever it had moved on — and a drafted idea is exactly the one you go looking for.
  const searchIds = q
    ? ((await db.rpc("search_moments", { q, limit_to: 50 })).data ?? [])
      .map((r: { moment_id: number }) => r.moment_id)
    : null;

  const { data: moments } = searchIds
    ? await db.from("moments").select(COLUMNS).in("id", searchIds.length ? searchIds : [-1])
    : await db
      .from("moments")
      .select(COLUMNS)
      .eq("status", status)
      .order("captured_at", { ascending: false })
      .limit(50);

  const today = new Date().toISOString().slice(0, 10);

  const statuses = [
    ["mined", "Ready to write"],
    ["queued", "Queued for Claude"],
    ["half_mined", "Waiting on answers"],
    ["captured", "Just in"],
    ["drafted", "Drafted"],
    ["published", "Published"],
    ["parked", "Parked"],
  ] as const;

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">{(moments ?? []).length}</span>
          <h2>Idea bank</h2>
        </div>

        <p className="step-note">
          A view of every idea and what came out of its interview. To add, change or write from one,
          use Claude or the Telegram bot.
        </p>

        <form className="row bank-search" method="get" action="/bank">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search everything — a phrase, a name, something they said"
            aria-label="Search the idea bank"
          />
          <button type="submit" className="primary">Search</button>
          {q && <a className="btn" href={`/bank?status=${status}`}>Clear</a>}
        </form>

        {q && (
          <p className="step-note">
            {(moments ?? []).length === 0
              ? `Nothing matched "${q}". Nothing is ever deleted, so try a word he actually said.`
              : `${(moments ?? []).length} ${(moments ?? []).length === 1 ? "match" : "matches"} for "${q}", across every status.`}
          </p>
        )}

        <div className="row" style={{ marginBottom: "1.5rem", opacity: q ? 0.45 : 1 }}>
          {statuses.map(([key, label]) => (
            <a
              key={key}
              className="btn"
              href={`/bank?status=${key}`}
              aria-current={status === key ? "page" : undefined}
              style={status === key ? { borderColor: "var(--ink)", fontWeight: 600 } : undefined}
            >
              {label}
            </a>
          ))}
        </div>

        {(moments ?? []).length === 0
          ? <div className="quiet">Nothing here.</div>
          : (moments ?? []).map((m) => {
            const material = one<Material>(m.material as never);
            const names = many<{ id: number; name: string; cleared: boolean; kind: string }>(
              m.moment_names as never,
            ).filter((n) => n.kind !== "not_a_name");
            const draftCount = many<{ id: number }>(m.drafts as never).length;

            return (
              <article key={m.id} id={`m${m.id}`} className="entry" data-mark={m.killed ? undefined : "clean"}>
                <div className="entry-meta">
                  <span className={m.title ? undefined : "flag"}>{m.title ?? "Not named yet"}</span>
                  <span>{m.source.replace("_", " ")}</span>
                  {m.pillar && <span>{m.pillar}</span>}
                  {m.strength && <span>strength {m.strength}/5</span>}
                  {m.depth_reached !== "none" && <span>{m.depth_reached.replace("_", " ")}</span>}
                  {m.pinned && <span className="ok">pinned</span>}
                  {m.killed && <span className="flag">killed</span>}
                  {m.not_before && <span className="flag">not before {m.not_before}</span>}
                  {m.decays_at && (
                    <span className={m.decays_at < today ? "flag" : "ok"}>
                      {m.decays_at < today ? `expired ${m.decays_at}` : `decays ${m.decays_at}`}
                    </span>
                  )}
                </div>

                {material
                  ? MATERIAL_FIELDS.map(([key, label]) =>
                    material[key]
                      ? (
                        <div className="field" key={key}>
                          <label>{label}</label>
                          <p className={key === "the_realisation" ? "hook" : "prose"}>{material[key]}</p>
                        </div>
                      )
                      : null
                  )
                  : m.notes && <p className="prose">{m.notes}</p>}

                {m.parked_reason && <p className="hook">{m.parked_reason}</p>}

                {m.audience && <p className="quiet">For: {m.audience}</p>}

                {Array.isArray(m.last_score_reasons) && m.last_score_reasons.length > 0 && (
                  <p className="quiet" style={{ marginTop: "0.6rem" }}>
                    Ranked {m.last_score}: {(m.last_score_reasons as string[]).join(" · ")}
                  </p>
                )}

                {names.length > 0 && (
                  <p className="quiet">
                    Names: {names.map((n) => `${n.name} (${n.cleared ? "cleared" : "not cleared"})`).join(", ")}
                  </p>
                )}

                {draftCount > 0 && (
                  <div className="row">
                    <Link className="btn" href={`/drafts?moment=${m.id}`}>
                      {draftCount === 1 ? "See its draft" : `See its ${draftCount} drafts`}
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
      </section>
    </main>
  );
}
