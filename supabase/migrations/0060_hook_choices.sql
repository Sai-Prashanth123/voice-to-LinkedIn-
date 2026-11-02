/*
 * Which openings Josh picked, and which he turned down.
 *
 * THE SIGNAL THAT WAS BEING DISCARDED. `josh-hook-lab` offers six openings for one moment and he
 * chooses one. `drafts.hook` has always stored the winner — so the system knew what he wrote and
 * never once knew what he rejected. A choice between six is worth more than six separate
 * approvals, because the alternatives are controls: same moment, same material, same minute, and
 * he preferred one of them.
 *
 * It is also the only evidence about hooks in this system that comes from Josh. The 3,261 measured
 * openings in data/josh/hooks/latest.json say what other people do; this says what he picks.
 *
 * AN RPC RATHER THAN A GRANT, for the same reason as joshs_notes (0054, 0056): the events live in
 * `system_events`, where `content_mcp` holds no privilege at all and should not.
 *
 * EVIDENCE OF TASTE, NEVER A RULE. The hooks section is his (12.10) and nothing reads this to
 * amend it. If a pattern appears it goes to him as a proposal with the count attached — six
 * choices are six choices.
 */

create or replace function public.hook_choices(p_limit integer default 40)
returns table (
  chosen_at   timestamptz,
  moment_id   bigint,
  chosen      text,
  rejected    jsonb,
  why         text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The moment id is read with a digits-only guard rather than a bare cast, for the reason 0056
  -- gives: `detail` is jsonb with no shape enforced on it, and one malformed row would turn a
  -- brief that merely lacks hook history into a brief that errors.
  select e.created_at,
         case
           when e.detail->>'moment_id' ~ '^[0-9]+$' then (e.detail->>'moment_id')::bigint
         end,
         (e.detail->>'chosen')::text,
         coalesce(e.detail->'rejected', '[]'::jsonb),
         (e.detail->>'why')::text
    from public.system_events e
   where e.kind = 'hook_chosen'
     and coalesce(e.detail->>'chosen', '') <> ''
   order by e.created_at desc
   limit greatest(1, least(coalesce(p_limit, 40), 500));
$$;

revoke execute on function public.hook_choices(integer) from public, anon;
grant  execute on function public.hook_choices(integer) to authenticated, service_role, content_mcp;

comment on function public.hook_choices is
  'Openings Josh chose and the ones he turned down, newest first. Read by get_hook_brief so the '
  'next set of candidates is written knowing what he has rejected before. The only hook evidence '
  'in this system that comes from him rather than from a measured corpus of other people. '
  'Evidence of taste, never a rule: only Josh changes the library (12.10).';
