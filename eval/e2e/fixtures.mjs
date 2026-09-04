/**
 * Rows to assert against, on the throwaway database.
 *
 * WHY THESE ARE HELPERS RATHER THAN INLINE SQL
 *
 * A case that hand-writes its own insert tends to prove the wrong thing. The first ad-hoc attempt
 * at "a post cannot publish without Josh" inserted a row with a null moment_id and was refused by
 * the NOT NULL constraint — which looks like a pass and tests nothing about R3. A fixture that is
 * valid in every respect EXCEPT the one under test is the only way the refusal means anything.
 *
 * Everything here builds the legal version. A case then breaks exactly one thing.
 */

let counter = 0;
const uniq = () => `${Date.now().toString(36)}-${++counter}`;

/** Single-quote escaping for inline SQL. These are fixtures, not user input, but a body with an
 *  apostrophe in it would otherwise end the run with a syntax error rather than a verdict. */
export const q = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;

/** A moment at whatever stage a case needs, with `ref` left to the trigger that generates it. */
export async function makeMoment(db, {
  source = "raw_capture",
  status = "captured",
  pillar = null,
  audience = null,
  strength = 4,
  depth = "scene",
  killed = false,
  pinned = false,
  timeSensitive = false,
  decaysAt = null,
  notBefore = null,
  // A parked moment must carry a reason - the constraint says so, and a fixture that ignored it
  // was refused before it could test anything.
  parkedReason = null,
  notes = "e2e fixture",
} = {}) {
  const [row] = await db.sql(`
    insert into public.moments
      (source, status, pillar, audience, strength, depth_reached, killed, pinned,
       time_sensitive, decays_at, not_before, parked_reason, notes)
    values
      (${q(source)}::moment_source, ${q(status)}::moment_status, ${q(pillar)}, ${q(audience)},
       ${strength}, ${q(depth)}::interview_depth, ${killed}, ${pinned},
       ${timeSensitive}, ${q(decaysAt)}::date, ${q(notBefore)}::date, ${q(parkedReason)}, ${q(notes)})
    returning id, ref, status::text, source::text
  `);
  return row;
}

/** The ten fields a drafter is allowed to see. Anything absent stays absent — 5.6 prefers an
 *  admitted gap to a guessed one, and a fixture that fills everything hides that. */
export async function makeMaterial(db, momentId, fields = {}) {
  const f = {
    the_moment: "The CFO stopped me halfway through the deck.",
    the_detail: "The slide referenced a book nobody in the room had read.",
    the_realisation: "The question was about dependency, not about the deck.",
    ...fields,
  };
  const cols = Object.keys(f);
  const [row] = await db.sql(`
    insert into public.material (moment_id, ${cols.join(", ")})
    values (${momentId}, ${cols.map((c) => q(f[c])).join(", ")})
    returning moment_id
  `);
  return row;
}

/** A draft. `library_version` is NOT NULL by 8.4, so it is resolved rather than guessed. */
export async function makeDraft(db, momentId, {
  body = "A post body that says something only one person could have said.",
  hook = "A post body that says something",
  framework = "story-lesson",
  attempt = 1,
  version = null,
  model = "e2e-fixture",
  claims = "[]",
  claimsVerified = true,
  gatePassed = null,
} = {}) {
  const [{ v: libraryVersion }] = await db.sql(
    "select coalesce(max(version), 1) as v from public.library_versions",
  );
  const [{ v: next }] = await db.sql(
    `select coalesce(max(version), 0) + 1 as v from public.drafts where moment_id = ${momentId}`,
  );
  const [row] = await db.sql(`
    insert into public.drafts
      (moment_id, version, attempt, body, hook, framework, library_version, model,
       claims, claims_verified, gate_passed)
    values
      (${momentId}, ${version ?? next}, ${attempt}, ${q(body)}, ${q(hook)}, ${q(framework)},
       ${libraryVersion}, ${q(model)}, ${q(claims)}::jsonb, ${claimsVerified},
       ${gatePassed === null ? "null" : gatePassed})
    returning id, version, library_version, model
  `);
  return row;
}

/**
 * A calendar row. Approving is deliberately a separate call — the whole point of R3 is that
 * `marked_ready_at` is a distinct act, so a fixture that sets it at insert would erase the thing
 * being tested.
 */
/**
 * A calendar row.
 *
 * `draft_id` is NOT NULL — a post on the calendar always came from a draft, and the schema says so.
 * A fixture that passed null was refused before it could test anything, which is the same trap as
 * the first R3 attempt: the row has to be legal in every respect except the one under test.
 */
export async function makePost(db, { momentId, draftId, body = "On the calendar." } = {}) {
  const draft = draftId ?? (await makeDraft(db, momentId, { body })).id;
  const [row] = await db.sql(`
    insert into public.posts (moment_id, draft_id, body, status)
    values (${momentId}, ${draft}, ${q(body)}, 'draft')
    returning id, draft_id, status::text, marked_ready_at
  `);
  return row;
}

/** What `schedulePost()` and `markReady()` both do: the only thing that authorises publishing. */
export async function approvePost(db, postId, { when = "now()" } = {}) {
  const [row] = await db.sql(`
    update public.posts
       set status = 'scheduled', marked_ready_at = now(), scheduled_for = ${when}
     where id = ${postId}
    returning id, status::text, marked_ready_at is not null as authorised
  `);
  return row;
}

export async function makeName(db, momentId, name, { kind = "person", cleared = false } = {}) {
  const [row] = await db.sql(`
    insert into public.moment_names (moment_id, name, kind, cleared)
    values (${momentId}, ${q(name)}, ${q(kind)}, ${cleared})
    returning id, name, cleared
  `);
  return row;
}

/** Library sections exist from migration 0004; a case edits one rather than creating it. */
export async function setSection(db, key, body) {
  const [row] = await db.sql(`
    update public.library_sections set body = ${q(body)} where key = ${q(key)}
    returning key, version
  `);
  return row;
}

export async function getSection(db, key) {
  const [row] = await db.sql(
    `select key, title, body, version, immutable, sort_order from public.library_sections where key = ${q(key)}`,
  );
  return row ?? null;
}

/** A queue job, for the cases about claiming, backoff and dedupe. */
export async function makeJob(db, type, payload = {}, { dedupeKey = null, runAfter = "now()" } = {}) {
  const [row] = await db.sql(`
    insert into public.jobs (type, payload, status, dedupe_key, run_after)
    values (${q(type)}, ${q(JSON.stringify(payload))}::jsonb, 'pending',
            ${q(dedupeKey ?? `e2e:${type}:${uniq()}`)}, ${runAfter})
    returning id, type, status::text, dedupe_key
  `);
  return row;
}

/** A whole moment ready to be drafted from: moment + material + an uncleared name. */
export async function minedMoment(db, options = {}) {
  const moment = await makeMoment(db, { status: "mined", strength: 5, ...options });
  await makeMaterial(db, moment.id, options.material);
  return moment;
}
