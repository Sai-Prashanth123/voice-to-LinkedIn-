/*
 * The notes window was capped at 50, and the pairs are rarer than that.
 *
 * WHAT WENT WRONG
 *
 * Migration 0056 ends `limit greatest(1, least(coalesce(p_limit, 12), 50))`. On 2 November
 * get_drafting_brief was changed to ask for 120 so that Josh's before-and-after pairs could not
 * drift out of the window again — and silently got 50. The code comment, the commit message and a
 * test all said "a 120-note window". It worked only because the first pair sat at position 15.
 *
 * WHY THE CAP IS THE WRONG INSTRUMENT HERE
 *
 * There are THREE before/after pairs in the project's entire history, against hundreds of notes.
 * They are the only record this system holds of what BETTER looked like rather than what wrong
 * looked like — he rewrites a line far less often than he rejects one. Any recency window will
 * therefore lose them eventually, and had already lost all three at a cap of 10.
 *
 * The brief keeps every pair inside the window regardless of age and takes the ten most recent of
 * anything else, so the size it asks for has to actually arrive. 50 is not a safety property, it is
 * a number somebody picked; 500 is still a bounded read over a table that grows slowly, and the
 * caller is the only thing deciding how much it wants.
 *
 * Nothing else about the function changes. The body below is 0056's, verbatim, with one number
 * moved — migrations are append-only and 0056 is not edited.
 */

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
   limit greatest(1, least(coalesce(p_limit, 12), 500));
$$;

revoke execute on function public.joshs_notes(integer) from public, anon;
grant  execute on function public.joshs_notes(integer) to authenticated, service_role, content_mcp;

comment on function public.joshs_notes is
  'Everything Josh has said about a draft, every line he changed, and WHICH POST each one was '
  'about, newest first. Read by get_drafting_brief so a preference he stated on one post is not '
  'invisible to the next — and so a note about another post cannot be read as an instruction for '
  'this one, which is what happened to six drafters on 28 October 2026. An RPC rather than a grant '
  'because the notes live in system_events, where content_mcp holds no privilege at all and should '
  'not. Evidence of taste, never a rule: only Josh changes the library (12.10). The cap was raised '
  'from 50 to 500 on 2 November: the brief asks for a window wide enough to keep every before/after '
  'pair, and there are three of them in the whole project.';
