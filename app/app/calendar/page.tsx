import { supabaseServer } from "@/lib/supabase";
import { SubmitButton } from "../submit-button";
import { unschedule } from "../actions";

export const dynamic = "force-dynamic";

/**
 * THE CALENDAR (clause 11).
 *
 * A four-week view of what is going out and what already has. The weekly pass is where work happens;
 * this is where Josh checks the shape of it — pacing, gaps, whether one pillar is dominating.
 *
 * 11.1 — drafts sit at draft status and appear here unscheduled, never live.
 * 13.4 — if the queue is running low against the target, it says so here before the calendar runs
 *        dry rather than after.
 */
export default async function Calendar() {
  const db = await supabaseServer();
  const from = new Date(Date.now() - 14 * 86_400_000);

  const [{ data: posts }, { data: setting }, { count: drafts }] = await Promise.all([
    db.from("posts")
      .select("id, body, status, scheduled_for, published_at, moments!inner(ref, pillar)")
      .in("status", ["scheduled", "published"])
      .gte("scheduled_for", from.toISOString())
      .order("scheduled_for"),
    db.from("settings").select("value").eq("key", "queue_target_posts").maybeSingle(),
    db.from("posts").select("*", { count: "exact", head: true }).eq("status", "draft"),
  ]);

  const target = Number(setting?.value ?? 10);
  const inHand = (posts ?? []).filter((p) => p.status === "scheduled").length + (drafts ?? 0);

  // Group by ISO week so pacing is visible at a glance.
  const weeks = new Map<string, typeof posts>();
  for (const p of posts ?? []) {
    const when = new Date((p.scheduled_for ?? p.published_at) as string);
    const key = weekLabel(when);
    const list = weeks.get(key) ?? [];
    list.push(p);
    weeks.set(key, list);
  }

  return (
    <main>
      <section className="step">
        <div className="step-head">
          <span className="step-no">{inHand}/{target}</span>
          <h2>Calendar</h2>
        </div>

        {inHand < Math.ceil(target / 2)
          ? (
            <div className="quiet" style={{ marginBottom: "2rem" }}>
              <strong>The queue is running short.</strong>{" "}
              {inHand} in hand against a target of {target}. That is worth knowing now rather than
              when the calendar is empty — but fewer posts is the right answer if the material is not
              there. Send a few thoughts, or ask for a question session.
            </div>
          )
          : (
            <p className="step-note">
              {inHand} posts in hand against a target of {target} — roughly two weeks ahead.
            </p>
          )}

        {weeks.size === 0
          ? <div className="quiet">Nothing scheduled or published yet.</div>
          : [...weeks.entries()].map(([label, list]) => (
            <div key={label} style={{ marginBottom: "2.5rem" }}>
              <div className="step-no" style={{ marginBottom: "0.75rem" }}>{label}</div>
              {(list ?? []).map((p) => {
                const m = p.moments as unknown as { ref: string; pillar: string | null };
                const when = new Date((p.scheduled_for ?? p.published_at) as string);
                return (
                  <article key={p.id} className="entry" data-mark="clean">
                    <div className="entry-meta">
                      <span>
                        {when.toLocaleDateString(undefined, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                      <span>{m.ref}</span>
                      {m.pillar && <span>{m.pillar}</span>}
                      <span className={p.status === "published" ? "ok" : undefined}>
                        {p.status === "published" ? "out" : "scheduled"}
                      </span>
                    </div>
                    <p className="prose">{firstLine(p.body)}</p>
                    {p.status === "scheduled" && (
                      <form action={unschedule} className="row">
                        <input type="hidden" name="post_id" value={p.id} />
                        <SubmitButton pendingLabel="Removing…">Take it back out</SubmitButton>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          ))}
      </section>
    </main>
  );
}

function weekLabel(d: Date): string {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `Week of ${monday.toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

function firstLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}
