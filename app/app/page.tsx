import { one } from "@/lib/embed";
import { SubmitButton } from "./submit-button";
import { supabaseServer } from "@/lib/supabase";
import {
  decideProposal,
  leaveVerdict,
  markReady,
  recordConversation,
  saveDraft,
  skipConversationQuestion,
  unschedule,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * THE WEEKLY PASS (clause 11, step 07).
 *
 * "Once a week I open the calendar, tweak the posts, and mark them ready to schedule."
 *
 * This is the only place Josh is asked for anything, and that is deliberate. 12.7: the conversation
 * question "must sit inside the weekly pass Josh already does. Never a separate task, a reminder, or
 * a second place to go. A separate habit will not survive." So it opens the page, before the drafts.
 *
 * The pass is genuinely a sequence — answer, then review, then confirm — so the steps are numbered.
 */
export default async function WeeklyPass() {
  const db = await supabaseServer();

  const threeWeeksAgo = new Date(Date.now() - 21 * 86_400_000).toISOString();

  const [{ data: drafts }, { data: recent }, { data: scheduled }, { count: minedCount }] =
    await Promise.all([
      db.from("posts")
        .select("id, body, moment_id, visual_id, visuals(rendered_path), moments!inner(ref, pillar, audience, killed)")
        .eq("status", "draft")
        // The published query below has filtered killed moments since a fixture post was twice
        // offered to Josh as something to react to. THIS query never did, so the weekly pass has
        // been opening with two drafts to review that are both verification fixtures on killed
        // moments — the same failure, one query along, hidden because the other one was fixed.
        .eq("moments.killed", false)
        .order("id"),
      db.from("posts")
        .select(
          "id, body, published_at, moments!inner(ref, killed), outcomes(conversation, conversation_answered_at, conversation_ask_count, impressions, reactions, comments, edit_class)",
        )
        .eq("status", "published")
        // Test fixtures live in the production tables, because 6.3 forbids deleting a moment —
        // they are killed and labelled instead. Without this the pass asks Josh whether a fixture
        // post led to a conversation, which it did twice before anyone noticed. The identical
        // filter runs in the shared conversation module for Telegram: 12.7 allows two surfaces,
        // never two different answers.
        .eq("moments.killed", false)
        .gte("published_at", threeWeeksAgo)
        .order("published_at", { ascending: false }),
      db.from("posts")
        .select("id, body, scheduled_for, moments!inner(ref)")
        .eq("status", "scheduled")
        .order("scheduled_for"),
      db.from("moments").select("*", { count: "exact", head: true }).eq("status", "mined"),
    ]);

  // 12.8 — not merely "unanswered", but "unanswered and not already asked twice".
  //
  // The old filter looked at `conversation_answered_at` alone, which is why "Skip this week" did
  // nothing: the same posts came back on every pass for three weeks. The cap lives in the database
  // (`conversation_max_asks`) and the identical rule runs in `_shared/conversation.ts` for
  // Telegram, so a skip on either surface is honoured on both.
  const MAX_ASKS = 2;
  const unanswered = (recent ?? []).filter((p) => {
    const o = one<{ conversation_answered_at: string | null; conversation_ask_count: number | null }>(
      p.outcomes as never,
    );
    if (o?.conversation_answered_at) return false;
    return (o?.conversation_ask_count ?? 0) < MAX_ASKS;
  });

  // 12.10 — what the system wants to change, raised inside the pass he already does rather than on
  // a page he has no reason to open.
  const { data: proposals } = await db
    .from("library_proposals")
    .select("id, section_key, claim, evidence, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(5);

  // 11.3 — signed URLs for the attached images. The renders bucket is private, so they are signed
  // here rather than linked: an image Josh is about to publish under his name has no business being
  // readable by anyone who guesses a path.
  const imageUrls = new Map<number, string>();
  for (const post of drafts ?? []) {
    // deno-lint-ignore no-explicit-any
    const v = one<{ rendered_path: string | null }>((post as any).visuals);
    if (!v?.rendered_path) continue;
    const { data: signed } = await db.storage
      .from("renders")
      .createSignedUrl(v.rendered_path, 60 * 60);
    if (signed?.signedUrl) imageUrls.set(post.id, signed.signedUrl);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main>
      {/* ── Where everything stands ───────────────────────────────────────
          Built from counts this page already fetches, and placed at the top of the surface Josh
          already opens rather than on an overview page of its own. 12.7 rules out a second place to
          go for the weekly question, and the reasoning holds for a summary too: a dashboard he has
          to remember to visit is a dashboard he does not visit.

          Each figure links to the thing it counts, so it is a way in rather than a readout. */}
      <section className="overview" aria-label="Where everything stands">
        <a className="ov" href="#drafts">
          <span className="ov-n">{(drafts ?? []).length}</span>
          <span className="ov-k">{(drafts ?? []).length === 1 ? "draft waiting" : "drafts waiting"}</span>
        </a>
        <a className="ov" href="/calendar">
          <span className="ov-n">{(scheduled ?? []).length}</span>
          <span className="ov-k">going out</span>
        </a>
        <a className="ov" href="/bank?status=mined">
          <span className="ov-n">{minedCount ?? 0}</span>
          <span className="ov-k">ready to write</span>
        </a>
        <a className="ov" href="/proposals">
          <span className="ov-n">{(proposals ?? []).length}</span>
          <span className="ov-k">{(proposals ?? []).length === 1 ? "proposal" : "proposals"}</span>
        </a>
      </section>

      {/* ── 00 · What the system wants to change (12.9 / 12.10) ───────────
          Above everything, because it is the only thing here that changes how every future post
          gets written — and because a proposal Josh never sees is one he never approves. It sits
          inside the pass he already does rather than on a page he has no reason to open. */}
      {(proposals ?? []).length > 0 && (
        <section className="step">
          <div className="step-head">
            <span className="step-no">00</span>
            <h2>I would like to change how I write</h2>
          </div>
          <p className="step-note">
            Each one names the posts behind it. Nothing changes unless you say so, and every change
            can be undone from the library.
          </p>

          {(proposals ?? []).map((p) => {
            const evidence = p.evidence as { post_ids?: number[]; observation?: string } | null;
            return (
              <article key={p.id} className="entry" data-mark="needs-you">
                <div className="entry-meta">
                  <span>{p.section_key.replace(/_/g, " ")}</span>
                  <span>{new Date(p.created_at).toLocaleDateString()}</span>
                </div>
                <p className="prose">{p.claim}</p>
                {(evidence?.observation || evidence?.post_ids?.length) && (
                  <div className="evidence">
                    {evidence?.observation && <div>{evidence.observation}</div>}
                    {evidence?.post_ids?.length
                      ? <div>Posts: {evidence.post_ids.join(", ")}</div>
                      : null}
                  </div>
                )}
                <form action={decideProposal} className="row">
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <SubmitButton name="decision" value="approve" className="primary">
                    Do it
                  </SubmitButton>
                  <SubmitButton name="decision" value="reject">Leave it</SubmitButton>
                  <a className="btn" href="/proposals">See the wording</a>
                </form>
              </article>
            );
          })}
        </section>
      )}

      {/* ── 01 · The one question (12.5) ─────────────────────────────────── */}
      <section className="step">
        <div className="step-head">
          <span className="step-no">01</span>
          <h2>Did any of these start a conversation?</h2>
        </div>
        <p className="step-note">
          The only signal that connects a post to the business. LinkedIn will never tell us a DM came
          from a post, so if you do not say it out loud, nobody can. Skip whenever you want to.
        </p>

        {unanswered.length === 0
          ? (
            <div className="quiet">
              Nothing to ask about — you are up to date on everything published in the last three
              weeks.
            </div>
          )
          : (
            <>
              {unanswered.map((post) => {
                const ref = (post.moments as unknown as { ref: string }).ref;
                return (
                  <div key={post.id} className="conversation-q">
                    <p className="hook">{firstLine(post.body)}</p>
                    <form action={recordConversation} className="row">
                      <input type="hidden" name="post_id" value={post.id} />
                      <span className="step-no">{ref}</span>
                      <select name="conversation" defaultValue="none" aria-label="What came of it">
                        <option value="none">Nothing came of it</option>
                        <option value="comment_thread">A comment thread worth having</option>
                        <option value="dm">A DM</option>
                        <option value="call">A call</option>
                        <option value="client">A client</option>
                      </select>
                      <input type="text" name="who" placeholder="Who, if you want to say" />
                      <SubmitButton>Record</SubmitButton>
                    </form>
                  </div>
                );
              })}
              <form action={skipConversationQuestion}>
                <input
                  type="hidden"
                  name="post_ids"
                  value={unanswered.map((p) => p.id).join(",")}
                />
                <SubmitButton pendingLabel="Skipping…">Skip this week</SubmitButton>
              </form>
            </>
          )}
      </section>

      {/* ── 02 · Drafts waiting ──────────────────────────────────────────── */}
      <section className="step">
        <div className="step-head">
          <span className="step-no" id="drafts">02</span>
          <h2>Drafts waiting on you</h2>
        </div>
        <p className="step-note">
          Edit anything here — your changes are what the system learns from. Nothing goes out until
          you set a date and mark it ready.
        </p>

        {(drafts ?? []).length === 0
          ? (
            <div className="quiet">
              {minedCount && minedCount > 0
                ? (
                  <>
                    No drafts right now, but <strong>{minedCount} mined moments</strong>{" "}
                    are waiting to be written. They will appear here shortly.
                  </>
                )
                : (
                  <>
                    Nothing to review, and nothing mined to write from.{" "}
                    <strong>Running short is the right outcome</strong>{" "}
                    when the material is not there — send a few voice notes when something happens,
                    or ask for a question session.
                  </>
                )}
            </div>
          )
          : (
            (drafts ?? []).map((post) => {
              const m = post.moments as unknown as {
                ref: string;
                pillar: string | null;
                audience: string | null;
              };
              return (
                <article key={post.id} className="entry" data-mark="clean">
                  <div className="entry-meta">
                    <span>{m.ref}</span>
                    {m.pillar && <span>{m.pillar}</span>}
                    {m.audience && <span>for {m.audience}</span>}
                    {post.visual_id && <span className="ok">image attached</span>}
                  </div>

                  {/* 11.3 — the entry carries its image, so he should be able to SEE it. Approving a
                      post without seeing the picture going out beside it is approving half of it. */}
                  {imageUrls.get(post.id) && (
                    <img
                      src={imageUrls.get(post.id)}
                      alt=""
                      style={{
                        display: "block",
                        maxWidth: "100%",
                        border: "1px solid var(--rule)",
                        borderRadius: "2px",
                        marginBottom: "0.9rem",
                      }}
                    />
                  )}

                  <form action={markReady}>
                    <input type="hidden" name="post_id" value={post.id} />
                    <textarea
                      className="prose"
                      name="body"
                      defaultValue={post.body}
                      aria-label={`Post ${m.ref}`}
                    />
                    <div className="row">
                      <input type="date" name="scheduled_for" defaultValue={today} required />
                      <input type="text" name="time" defaultValue="09:00" size={5} aria-label="Time" />
                      <SubmitButton className="primary" pendingLabel="Marking ready…">Mark ready</SubmitButton>
                      <SubmitButton formAction={saveDraft} pendingLabel="Saving…">Save, decide later</SubmitButton>
                    </div>
                  </form>

                  {/* 12.4 — "a short reaction on any DRAFT". It used to live only under "Recently
                      out", so the one case where the system got it most wrong — a draft rejected
                      outright, never published — could never be told why. */}
                  <form action={leaveVerdict} className="row">
                    <input type="hidden" name="post_id" value={post.id} />
                    <input
                      type="text"
                      name="verdict"
                      placeholder="Hook was wrong. / This one nailed it."
                      style={{ flex: 1, minWidth: "18rem" }}
                      aria-label={`One line on ${m.ref}`}
                    />
                    <SubmitButton pendingLabel="Noting…">Note it</SubmitButton>
                  </form>
                </article>
              );
            })
          )}
      </section>

      {/* ── 03 · Going out ───────────────────────────────────────────────── */}
      <section className="step">
        <div className="step-head">
          <span className="step-no">03</span>
          <h2>Going out</h2>
        </div>
        <p className="step-note">
          Scheduled because you marked them ready. Nothing else can put a post here.
        </p>

        {(scheduled ?? []).length === 0
          ? <div className="quiet">Nothing scheduled.</div>
          : (
            (scheduled ?? []).map((post) => (
              <article key={post.id} className="entry" data-mark="clean">
                <div className="entry-meta">
                  <span>{(post.moments as unknown as { ref: string }).ref}</span>
                  <span className="ok">
                    {new Date(post.scheduled_for as string).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="prose">{firstLine(post.body)}</p>
                <form action={unschedule} className="row">
                  <input type="hidden" name="post_id" value={post.id} />
                  <SubmitButton pendingLabel="Removing…">Take it back out</SubmitButton>
                </form>
              </article>
            ))
          )}
      </section>

      {/* ── 04 · Recently out, for a quick verdict (12.4) ────────────────── */}
      {(recent ?? []).length > 0 && (
        <section className="step">
          <div className="step-head">
            <span className="step-no">04</span>
            <h2>Recently out</h2>
          </div>
          <p className="step-note">
            A few words on any of these tells the system which of its guesses were right. Optional.
          </p>

          {(recent ?? []).slice(0, 8).map((post) => {
            const o = one<{
              impressions: number | null;
              reactions: number | null;
              comments: number | null;
              edit_class: string | null;
            }>(post.outcomes as never) ?? {} as Record<string, never>;
            const rewritten = o.edit_class === "rewrite";
            return (
              <article
                key={post.id}
                className="entry"
                data-mark={rewritten ? "needs-you" : "clean"}
              >
                <div className="entry-meta">
                  <span>{(post.moments as unknown as { ref: string }).ref}</span>
                  {o.impressions != null && <span>{o.impressions} impressions</span>}
                  {o.reactions != null && <span>{o.reactions} reactions</span>}
                  {o.comments != null && <span>{o.comments} comments</span>}
                  {o.edit_class && (
                    <span className={rewritten ? "flag" : "ok"}>
                      {rewritten ? "you rewrote this" : "light edit only"}
                    </span>
                  )}
                </div>
                <p className="hook">{firstLine(post.body)}</p>
                <form action={leaveVerdict} className="row">
                  <input type="hidden" name="post_id" value={post.id} />
                  <input
                    type="text"
                    name="verdict"
                    placeholder="Hook was wrong. / This one nailed it."
                    style={{ flex: 1, minWidth: "18rem" }}
                  />
                  <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                </form>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

function firstLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}
