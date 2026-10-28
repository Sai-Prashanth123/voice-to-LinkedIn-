/*
 * Which post each of his notes was about. The notes were right; the page they landed on was not.
 *
 * WHAT WENT WRONG
 *
 * `joshs_notes` (0054) returns the ten most recent things Josh said about any draft, and that is
 * deliberate: the whole point of 0054 was that "a preference he stated on Monday was invisible to
 * Tuesday's post about something different". The read is correct.
 *
 * What it did not return is WHICH POST each note was about. `get_drafting_brief` rendered them as
 *
 *     - 2026-10-28 — "I don't like the opening hook. Maybe something more provocative like
 *                     'This is why cold email is broken:'"
 *
 * under the heading "WHAT JOSH HAS SAID ABOUT PREVIOUS DRAFTS, in his words, newest first" —
 * directly above a second bullet list in the identical style whose framing reads "These are
 * INSTRUCTIONS … and they are cumulative: an earlier one still stands unless a later one replaces
 * it." That second list IS correctly scoped to the moment. The first was not, and nothing on the
 * page said so.
 *
 * Measured 28 October 2026: six independent drafters were given six different moments. Every one of
 * them read the unscoped list as instructions for the post in front of them. On a brief for a post
 * about board papers at public bodies, the most prominent "feedback" was hook direction for an
 * unrelated post about cold email. One drafter stated that following it "would corrupt the draft".
 * They each worked out that it did not apply by reading the content of the notes and noticing they
 * were about something else — which is a drafter rescuing the system, not the system working.
 *
 * WHY ATTRIBUTION RATHER THAN SCOPING
 *
 * The obvious fix is to filter the read to one moment. That would undo 0054 and bring back the
 * silence it was written to end: he said "you can be closer to my voice" once, about one post, and
 * it is true of every post he will ever be sent.
 *
 * So the notes stay cross-post and gain a label. A note about THIS post is an instruction; a note
 * about another post is evidence of taste. Those are different things that happen to be the same
 * sentence, and until now the page made them look identical.
 *
 * BOTH BRANCHES ALREADY HAD THE ANSWER AND DISCARDED IT
 *
 *   pushback — `pushback.ts:61-65` writes `{ moment_id, draft_id, note }` into `system_events.detail`
 *              on every single one. The jsonb has carried the moment id all along.
 *   verdict  — `public.outcomes` has had `moment_id bigint not null references public.moments(id)`
 *              since 0003_drafting_and_calendar.sql:152.
 *
 * Neither was projected. This is the fourth time on this project that the fix has been to read a
 * value that was already being written: the build stamp that never shipped, the grants that were
 * never granted, `extraction_applied` which is logged and read by nothing. The class is "a value
 * nothing reads", and it always reports success.
 *
 * ADDITIVE, SO THE CALLERS DO NOT BREAK
 *
 * `moment_id` and `moment_title` go on the END of the return table. `said_at, source, note,
 * before_text, after_text` keep their names and their order, so `mcp-server/writer-shape.test.mjs`
 * — which calls this RPC directly and reads `before_text`/`after_text` — still passes unchanged.
 *
 * A return-type change needs the drop: `create or replace` cannot widen `returns table`. The drop is
 * safe in flight because the only caller wraps the read in try/catch and builds the brief without it
 * (`mcp-server/tools/brief.mjs:201-207`) — a new input is not worth making the write path fragile
 * for, which is the comment that is there now and it earns its keep here.
 */

drop function if exists public.joshs_notes(integer);

create or replace function public.joshs_notes(p_limit integer default 12)
returns table (
  said_at      timestamptz,
  source       text,
  note         text,
  before_text  text,
  after_text   text,
  moment_id    bigint,
  moment_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- What he said when he sent a draft back.
  --
  -- The moment id is read with a digits-only guard rather than a bare cast. `detail` is jsonb with
  -- no shape enforced on it, and one malformed row would turn a brief that merely lacks taste notes
  -- into a brief that errors — on the read whose own rationale is that it must never fail a draft.
  select e.created_at,
         'pushback'::text,
         (e.detail->>'note')::text,
         null::text,
         null::text,
         case
           when e.detail->>'moment_id' ~ '^[0-9]+$' then (e.detail->>'moment_id')::bigint
         end,
         m.title
    from public.system_events e
    left join public.moments m
      on e.detail->>'moment_id' ~ '^[0-9]+$'
     and m.id = (e.detail->>'moment_id')::bigint
   where e.kind = 'pushback'
     and coalesce(e.detail->>'note', '') <> ''

  union all

  -- What he said when he judged a post, and what he changed it to. The pair is the useful part:
  -- a verdict says what was wrong, a diff says what right looked like.
  select coalesce(o.verdict_at, o.edit_measured_at),
         'verdict'::text,
         o.verdict,
         o.draft_body,
         o.approved_body,
         o.moment_id,
         m.title
    from public.outcomes o
    left join public.moments m on m.id = o.moment_id
   where o.verdict is not null
      or (o.draft_body is not null and o.approved_body is not null and o.draft_body <> o.approved_body)

   order by 1 desc nulls last
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

revoke execute on function public.joshs_notes(integer) from public, anon;
grant  execute on function public.joshs_notes(integer) to authenticated, service_role, content_mcp;

comment on function public.joshs_notes is
  'Everything Josh has said about a draft, every line he changed, and WHICH POST each one was '
  'about, newest first. Read by get_drafting_brief so a preference he stated on one post is not '
  'invisible to the next — and so a note about another post cannot be read as an instruction for '
  'this one, which is what happened to six drafters on 28 October 2026. An RPC rather than a grant '
  'because the notes live in system_events, where content_mcp holds no privilege at all and should '
  'not. Evidence of taste, never a rule: only Josh changes the library (12.10).';
