import { supabaseServer } from "@/lib/supabase";
import { SubmitButton } from "../submit-button";
import { revertSection, saveLibrarySection } from "../actions";

export const dynamic = "force-dynamic";

/**
 * THE REFERENCE LIBRARY (clause 8).
 *
 * 8.5 — editable with no build or deploy step.
 * 8.6 — a change applies to the very next draft. Nothing is cached; the workers read at call time.
 * 8.8 — "Josh must be able to add a rule in under a minute, because that is how it will actually
 *        get maintained." Hence plain markdown in a textarea rather than a structured editor.
 *
 * `core_rules` is shown but not editable. It holds the lived-experience test and the no-fabrication
 * rule, which clause 12 puts beyond the learning loop's reach. 8.7 says rules must not be hidden in
 * code where Josh cannot see them — so they are here, visible, and locked.
 */
export default async function Library() {
  const db = await supabaseServer();

  const [{ data: sections }, { data: history }, { data: version }] = await Promise.all([
    db.from("library_sections").select("*").order("sort_order"),
    db.from("library_section_versions")
      .select("key, version, created_at, reason")
      .order("version", { ascending: false })
      .limit(60),
    db.from("library_versions").select("version").order("version", { ascending: false }).limit(1)
      .maybeSingle(),
  ]);

  const historyByKey = new Map<
    string,
    { version: number; created_at: string; reason: string | null }[]
  >();
  for (const h of history ?? []) {
    const list = historyByKey.get(h.key) ?? [];
    list.push({ version: h.version, created_at: h.created_at, reason: h.reason ?? null });
    historyByKey.set(h.key, list);
  }

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">v{version?.version ?? 1}</span>
          <h2>Reference library</h2>
        </div>
        <p className="step-note">
          What the system reads when it writes and when it checks its own work. Edit anything here and
          the next draft uses it — there is nothing to deploy. Every version is kept with the reason
          it changed, so if the posts get worse you can find the change and roll it back.
        </p>

        <div className="section-list">
          {(sections ?? []).map((s) => {
            const versions = historyByKey.get(s.key) ?? [];
            return (
              <details key={s.key} className="section">
                <summary>
                  {s.title}
                  {s.immutable && <span className="locked">LOCKED</span>}
                  {!s.body?.trim() && <span className="locked">EMPTY</span>}
                  <span className="version">v{s.version}</span>
                </summary>

                {s.immutable
                  ? (
                    <>
                      <p className="step-note" style={{ marginTop: "0.85rem" }}>
                        These two are fixed. The learning loop cannot propose against them, whatever
                        the numbers say — a system optimising freely against engagement finds its way
                        to engagement bait, and that is the one outcome that would make the whole
                        thing worthless.
                      </p>
                      <pre className="evidence">{s.body}</pre>
                    </>
                  )
                  : (
                    <form action={saveLibrarySection}>
                      <input type="hidden" name="key" value={s.key} />
                      <textarea
                        className="markdown"
                        name="body"
                        defaultValue={s.body ?? ""}
                        placeholder={placeholderFor(s.key)}
                        aria-label={s.title}
                      />
                      <div className="row">
                        <SubmitButton className="primary" pendingLabel="Saving…">Save</SubmitButton>
                        {versions.length > 1 && (
                          <>
                            <span className="step-no">roll back to</span>
                            {versions.slice(1, 5).map((v) => (
                              <SubmitButton
                                key={v.version}
                                /* Bound, not read off name/value: React overrides a button's
                                   name when formAction is a function, so the version never
                                   reached the action and the rollback silently did nothing. */
                                formAction={revertSection.bind(null, s.key, v.version)}
                                pendingLabel="Rolling back…"
                                title={`${v.reason ?? "changed"} — ${
                                  new Date(v.created_at).toLocaleDateString()
                                }`}
                              >
                                v{v.version}
                              </SubmitButton>
                            ))}
                          </>
                        )}
                      </div>

                      {versions.length > 1 && (
                        <ul className="evidence">
                          {versions.slice(0, 5).map((v) => (
                            <li key={v.version}>
                              v{v.version} · {new Date(v.created_at).toLocaleDateString()} ·{" "}
                              {v.reason ?? "changed"}
                            </li>
                          ))}
                        </ul>
                      )}
                    </form>
                  )}
              </details>
            );
          })}
        </div>
      </section>
    </main>
  );
}

/** Prompts that describe what belongs here, so an empty section is an invitation rather than a void. */
function placeholderFor(key: string): string {
  const hints: Record<string, string> = {
    pillars: "What you write about, and what each pillar actually covers for you — not the generic version.",
    frameworks: "The post structures you want used, and when to reach for each.",
    hooks: "How an opening line is built.",
    closes: "How a post ends. One ask at most, matched to the post, never a request for engagement.",
    audience: "Who they are, what they are trying to do, what language they use, what they are sick of hearing.",
    voice_guide:
      "Built from a recording of you talking, at length, in your own words — never from your old posts.",
    prompt_set: "The questions a session asks, and the follow-ups used to mine a moment.",
    banned_phrases: "Constructions that make writing read as machine-produced. One per line.",
    formatting: "Line breaks, length, anything specific to how a post should sit on LinkedIn.",
    gate_rules: "Extra checks the gate should apply, beyond the six it already runs.",
    visual_brand: "Colours, type and rules for rebuilding a diagram in your brand.",
  };
  return hints[key] ?? "";
}
