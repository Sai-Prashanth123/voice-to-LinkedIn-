import { supabaseServer } from "@/lib/supabase";
import { decideProposal } from "../actions";

export const dynamic = "force-dynamic";

/**
 * WHAT THE SYSTEM WANTS TO CHANGE (12c).
 *
 * 12.9  — every proposal names the posts behind it. "Not 'posts are underperforming', but 'the last
 *          six posts opening with a question underperformed the six that opened with a scene, here
 *          they are, propose changing the hook rule'."
 * 12.10 — Josh approves or rejects. The system never changes the library on its own, and there is
 *          no code path here that could: approving writes the section, rejecting writes nothing.
 * 12.11 — an approved change takes effect on the next draft and increments the library version.
 */
export default async function Proposals() {
  const db = await supabaseServer();

  const [{ data: open }, { data: decided }] = await Promise.all([
    db.from("library_proposals").select("*").eq("status", "open").order("created_at", {
      ascending: false,
    }),
    db.from("library_proposals")
      .select("*")
      .neq("status", "open")
      .order("decided_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">{(open ?? []).length}</span>
          <h2>Waiting for your call</h2>
        </div>
        <p className="step-note">
          Changes the system wants to make to how it writes, with the evidence behind each. Nothing
          changes unless you approve it.
        </p>

        {(open ?? []).length === 0
          ? (
            <div className="quiet">
              Nothing proposed. The system only raises a change when the evidence supports one —{" "}
              <strong>a quiet month is an honest outcome</strong>.
            </div>
          )
          : (open ?? []).map((p) => {
            const evidence = p.evidence as { post_ids?: number[]; observation?: string };
            return (
              <article key={p.id} className="entry" data-mark="needs-you">
                <div className="entry-meta">
                  <span>{p.section_key}</span>
                  <span>{new Date(p.created_at).toLocaleDateString()}</span>
                </div>

                <p className="prose">{p.claim}</p>

                <div className="evidence">
                  {evidence?.observation && <div>{evidence.observation}</div>}
                  {evidence?.post_ids?.length
                    ? <div>Posts: {evidence.post_ids.join(", ")}</div>
                    : null}
                </div>

                <details>
                  <summary>See the proposed wording</summary>
                  <pre className="evidence">{p.proposed_body}</pre>
                </details>

                <form action={decideProposal} className="row">
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <input
                    type="text"
                    name="reason"
                    placeholder="Why, if you want to note it"
                    style={{ flex: 1, minWidth: "16rem" }}
                  />
                  <button type="submit" name="decision" value="approve" className="primary">
                    Approve
                  </button>
                  <button type="submit" name="decision" value="reject" className="danger">
                    Reject
                  </button>
                </form>
              </article>
            );
          })}
      </section>

      {(decided ?? []).length > 0 && (
        <section className="step">
          <div className="step-head">
            <span className="step-no">past</span>
            <h2>Already decided</h2>
          </div>
          <p className="step-note">
            If posts got worse after a change, this is where you find which change. Roll it back from
            the library.
          </p>
          {(decided ?? []).map((p) => (
            <article key={p.id} className="entry">
              <div className="entry-meta">
                <span>{p.section_key}</span>
                <span className={p.status === "approved" ? "ok" : "flag"}>{p.status}</span>
                {p.applied_library_version && <span>library v{p.applied_library_version}</span>}
                <span>{p.decided_at ? new Date(p.decided_at).toLocaleDateString() : ""}</span>
              </div>
              <p className="prose">{p.claim}</p>
              {p.decided_reason && <p className="hook">{p.decided_reason}</p>}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
