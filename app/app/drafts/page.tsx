import Link from "next/link";
import { many, one } from "@/lib/embed";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The eight checks, in the words a person reads them. Keys match GATE_CHECKS in prompts.ts. */
const CHECK_LABELS: Record<string, string> = {
  anyone_else: "Could anyone else have written this?",
  claims_trace: "Every claim traces to what he said",
  hook_opens_loop: "The opening line opens a loop",
  aimed_at_someone: "Aimed at someone in particular",
  voice_guide: "Sounds like him",
  names_cleared: "No uncleared names",
  identifiable: "Nobody identifiable by implication",
  banned_phrases: "No banned phrases or AI tells",
};

/**
 * GENERATED DRAFTS — READ ONLY.
 *
 * Drafts are written in Claude and judged by the server. This page shows the result of both: the post,
 * which idea it came from, and every check the server ran with its reason. Nothing here edits a draft.
 * A rewrite starts in Claude ("rewrite <the idea's name>") or by replying to the draft in Telegram.
 *
 * Acceptance fixtures are left out. They are twenty deliberately generic drafts that component test 8
 * uses to prove the gate rejects generic writing, and showing them here would put fake posts next to
 * real ones with nothing to tell them apart.
 */
export default async function Drafts({
  searchParams,
}: {
  searchParams: Promise<{ moment?: string }>;
}) {
  const params = await searchParams;
  const momentId = Number(params.moment);
  const db = await supabaseServer();

  let query = db
    .from("drafts")
    .select(
      "id, moment_id, version, attempt, body, hook, framework, model, claims_verified, gate_passed, gate_reason, created_at, moments!inner(title, killed), gate_runs(check_key, passed, reason)",
    )
    .neq("framework", "acceptance-fixture")
    .eq("moments.killed", false)
    .order("created_at", { ascending: false })
    .limit(60);

  if (Number.isInteger(momentId)) query = query.eq("moment_id", momentId);

  const { data: drafts, error } = await query;

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">{(drafts ?? []).length}</span>
          <h2>Drafts</h2>
        </div>

        <p className="step-note">
          Every draft written in Claude, with what the server's eight checks said about it. To rewrite
          one, say "rewrite" and the idea's name in Claude, or reply to it in Telegram.
        </p>

        {Number.isInteger(momentId) && (
          <div className="row" style={{ marginBottom: "1rem" }}>
            <a className="btn" href="/drafts">Show all drafts</a>
          </div>
        )}

        {error && <div className="quiet">Could not load drafts: {error.message}</div>}

        {!error && (drafts ?? []).length === 0
          ? <div className="quiet">No drafts yet. They appear here once written in Claude.</div>
          : (drafts ?? []).map((d) => {
            const moment = one<{ title: string | null }>(d.moments as never);
            const runs = many<{ check_key: string; passed: boolean; reason: string | null }>(
              d.gate_runs as never,
            );
            const judged = new Set(runs.map((r) => r.check_key)).size;
            const failed = runs.filter((r) => !r.passed);

            // gate_passed is the draft's recorded verdict, but a draft can have all eight checks run and
            // that field still empty — M-000003 read "Being checked — 8 of 8" forever. When every
            // check is in, the checks themselves are the verdict.
            const passed = d.gate_passed ?? (judged >= 8 ? failed.length === 0 : null);

            const verdict = passed === true
              ? { label: "Passed all checks", mark: "ok" }
              : passed === false
              ? { label: "Rejected", mark: "flag" }
              : judged > 0
              ? { label: `Being checked — ${judged} of 8`, mark: undefined }
              : { label: "Waiting to be checked", mark: undefined };

            return (
              <article
                key={d.id}
                className="entry"
                data-mark={passed === false ? "needs-you" : passed ? "clean" : undefined}
              >
                <div className="entry-meta">
                  <span>
                    {moment?.title
                      ? <Link href={`/bank?q=${encodeURIComponent(moment.title)}`}>{moment.title}</Link>
                      : "Not named yet"}
                  </span>
                  <span>draft {d.version}</span>
                  {d.attempt > 1 && <span>attempt {d.attempt}</span>}
                  {d.framework && <span>{d.framework}</span>}
                  <span>{new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  <span className={verdict.mark}>{verdict.label}</span>
                </div>

                <div className="prose" style={{ whiteSpace: "pre-wrap" }}>{d.body}</div>

                {failed.length > 0 && (
                  <div className="evidence">
                    <div style={{ marginBottom: "0.4rem" }}>What the checks said:</div>
                    {failed.map((r) => (
                      <p key={r.check_key} className="quiet" style={{ margin: "0.3rem 0" }}>
                        <strong>{CHECK_LABELS[r.check_key] ?? r.check_key}</strong>
                        {r.reason ? ` — ${r.reason}` : ""}
                      </p>
                    ))}
                  </div>
                )}

                {passed === false && failed.length === 0 && d.gate_reason && (
                  <p className="quiet">{d.gate_reason}</p>
                )}
              </article>
            );
          })}
      </section>
    </main>
  );
}
