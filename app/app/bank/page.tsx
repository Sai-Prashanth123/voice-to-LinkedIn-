import { many, one } from "@/lib/embed";
import { SubmitButton } from "../submit-button";
import { parsePillars } from "@/lib/pillars";
import { supabaseServer } from "@/lib/supabase";
import { editMoment, overrideMoment, reopenMoment, setNameClearance } from "../actions";

export const dynamic = "force-dynamic";

/** The material fields, in the order Josh would tell the story. */
const MATERIAL_FIELDS = [
  ["the_moment", "The moment", "What actually happened"],
  ["the_detail", "The detail", "The specific thing that makes it yours and nobody else's"],
  ["their_actual_words", "Their actual words", "Verbatim only — every draft is checked against this"],
  ["the_realisation", "The realisation", "What you saw that you had not seen before"],
  ["the_lesson", "The lesson", "What a reader takes from it"],
] as const;

type Material = Record<(typeof MATERIAL_FIELDS)[number][0], string | null>;

/**
 * THE IDEA BANK (clause 6).
 *
 * 6.1 — "readable and editable by Josh directly, without a developer and without going through the
 *        chat interface." The Supabase table editor already satisfies the letter of that; this view
 *        satisfies the intent, by showing a moment as a moment rather than as a row — and by making
 *        the fields that change what gets written correctable here. `material` is the only thing the
 *        drafter ever reads, so a mangled quote left uncorrectable would be inherited by every
 *        future draft of that moment.
 * 6.3 — nothing is deleted. "Kill" sets a flag; parked moments stay, "because something that was not
 *        ready in August is often the right post in November."
 * 6.4 — and because they stay, they can come back: re-open puts a moment in front of the interviewer
 *        again, the same thing the "Add to this one" button does on a parked message in Telegram.
 * 9.10 — name clearance is granted per moment, deliberately, one name at a time.
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
    "id, ref, source, status, pillar, audience, strength, depth_reached, pinned, killed, not_before, parked_reason, notes, captured_at, time_sensitive, decays_at, last_score, last_score_reasons, last_scored_at, material(the_moment, the_detail, the_realisation, the_lesson, their_actual_words), moment_names(id, name, kind, cleared)";

  // A search looks ACROSS every status. Searching inside the current tab would hide the moment being
  // looked for whenever it had moved on — and a moment that has been drafted is exactly the one you
  // go looking for later.
  const searchIds = q
    ? ((await db.rpc("search_moments", { q, limit_to: 50 })).data ?? [])
      .map((r: { moment_id: number }) => r.moment_id)
    : null;

  const [{ data: moments }, { data: pillarSection }] = await Promise.all([
    searchIds
      ? db.from("moments").select(COLUMNS).in("id", searchIds.length ? searchIds : [-1])
      : db
        .from("moments")
        .select(COLUMNS)
        .eq("status", status)
        .order("captured_at", { ascending: false })
        .limit(50),
    db.from("library_sections").select("body").eq("key", "pillars").maybeSingle(),
  ]);

  // His own pillars, from his own library — a free-text box would let a typo invent a category that
  // then counts in the pillar balance (7.1) as though it were real.
  const pillars = parsePillars(pillarSection?.body ?? "");

  // Compared as ISO strings, which sorts correctly and avoids a timezone shifting a date by a day.
  const today = new Date().toISOString().slice(0, 10);

  const statuses = [
    ["mined", "Ready to write"],
    ["half_mined", "Waiting on you"],
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

        {/* A plain GET form, so search works with JavaScript off and every result is a real URL
            Josh can bookmark or send himself. The palette is the fast path; this is the browsing one. */}
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
            const names = many<{
              id: number;
              name: string;
              kind: string;
              cleared: boolean;
            }>(m.moment_names as never);
            const uncleared = names.filter((n) => !n.cleared).length;

            return (
              <article
                key={m.id}
                className="entry"
                data-mark={uncleared > 0 ? "needs-you" : m.killed ? undefined : "clean"}
              >
                <div className="entry-meta">
                  <span>{m.ref}</span>
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

                {material?.the_moment && <p className="prose">{material.the_moment}</p>}
                {material?.the_realisation && <p className="hook">{material.the_realisation}</p>}
                {!material && m.notes && <p className="prose">{m.notes}</p>}
                {m.parked_reason && <p className="hook">{m.parked_reason}</p>}

                {/* 7.1 / 7.4 — the ranking, in words. He gets three overrides over this order;
                    overriding a ranking he cannot see is a guess. */}
                {Array.isArray(m.last_score_reasons) && m.last_score_reasons.length > 0 && (
                  <p className="quiet" style={{ marginTop: "0.6rem" }}>
                    Ranked {m.last_score}: {(m.last_score_reasons as string[]).join(" · ")}
                  </p>
                )}

                {names.length > 0 && (
                  <div className="evidence">
                    <div style={{ marginBottom: "0.4rem" }}>
                      Names in this moment — clearance is per post, so nothing here is permanent.
                    </div>
                    {names.map((n) => (
                      <form
                        key={n.id}
                        action={setNameClearance}
                        style={{ display: "inline-flex", gap: "0.4rem", marginRight: "0.75rem" }}
                      >
                        <input type="hidden" name="name_id" value={n.id} />
                        <input type="hidden" name="cleared" value={String(!n.cleared)} />
                        <SubmitButton className={n.cleared ? undefined : "danger"}>
                          {n.name} · {n.cleared ? "cleared" : "not cleared"}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                )}

                <form action={overrideMoment} className="row">
                  <input type="hidden" name="moment_id" value={m.id} />
                  <SubmitButton name="action" value={m.pinned ? "unpin" : "pin"}>
                    {m.pinned ? "Unpin" : "Write this next"}
                  </SubmitButton>
                  <SubmitButton name="action" value="not_this_month" pendingLabel="Updating…">Not this month</SubmitButton>
                  {!m.killed && (
                    <SubmitButton name="action" value="kill" className="danger">
                      Do not write this
                    </SubmitButton>
                  )}
                </form>

                {/* 6.4 — parked is not the end of a moment, and this is the way back. */}
                {(m.status === "parked" || m.status === "published") && (
                  <form action={reopenMoment} className="row">
                    <input type="hidden" name="moment_id" value={m.id} />
                    <SubmitButton>
                      {m.status === "parked"
                        ? "Re-open — I remember more"
                        : "Re-open — there is more in this"}
                    </SubmitButton>
                    <span className="quiet">
                      Goes back in front of the interviewer, and back into the queue.
                    </span>
                  </form>
                )}

                {/* 6.1 — correcting the moment, not just deciding about it. */}
                <details className="edit">
                  <summary>Correct this entry</summary>
                  <form action={editMoment}>
                    <input type="hidden" name="moment_id" value={m.id} />

                    <div className="field">
                      <label htmlFor={`pillar-${m.id}`}>Pillar</label>
                      <select id={`pillar-${m.id}`} name="pillar" defaultValue={m.pillar ?? ""}>
                        <option value="">— not set —</option>
                        {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
                        {m.pillar && !pillars.includes(m.pillar) && (
                          <option value={m.pillar}>{m.pillar} (no longer in your library)</option>
                        )}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor={`audience-${m.id}`}>
                        Audience
                        <span className="why">who this is for, in your words</span>
                      </label>
                      <input
                        id={`audience-${m.id}`}
                        type="text"
                        name="audience"
                        defaultValue={m.audience ?? ""}
                        style={{ width: "100%" }}
                      />
                    </div>

                    {MATERIAL_FIELDS.map(([key, label, why]) => (
                      <div className="field" key={key}>
                        <label htmlFor={`${key}-${m.id}`}>
                          {label}
                          <span className="why">{why}</span>
                        </label>
                        <textarea
                          id={`${key}-${m.id}`}
                          className="field-body"
                          name={key}
                          defaultValue={material?.[key] ?? ""}
                        />
                      </div>
                    ))}

                    <div className="field">
                      <label htmlFor={`decays-${m.id}`}>
                        Stops being worth posting
                        <span className="why">
                          leave empty if it does not go stale — with a date, it parks itself after
                        </span>
                      </label>
                      <input
                        id={`decays-${m.id}`}
                        type="date"
                        name="decays_at"
                        defaultValue={m.decays_at ?? ""}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor={`notes-${m.id}`}>Notes</label>
                      <textarea
                        id={`notes-${m.id}`}
                        className="field-body"
                        name="notes"
                        defaultValue={m.notes ?? ""}
                      />
                    </div>

                    <div className="row">
                      <SubmitButton className="primary" pendingLabel="Saving…">Save</SubmitButton>
                      <span className="quiet">
                        Drafts are written from these fields and checked against them. Nothing is
                        deleted — this corrects the entry in place.
                      </span>
                    </div>
                  </form>
                </details>
              </article>
            );
          })}
      </section>
    </main>
  );
}
