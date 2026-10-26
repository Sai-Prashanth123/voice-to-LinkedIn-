/*
 * What Josh has actually said about drafts, in one read, for the thing that writes the next one.
 *
 * WHY THIS EXISTS
 *
 * The system has never been shown a post he approved, so the standing assumption was that it has
 * nothing positive to aim at — only a very long list of things to avoid. `banned_phrases` is 8,936
 * characters of "never"; `frameworks`, the section on how to actually build a post, is 664.
 *
 * That assumption was wrong, and this migration is the correction. The system holds, today:
 *
 *   - FIVE pushback notes in his own dictated words, including "I want to try and keep everything
 *     that sits under the different methods on one line, so there's no line break" and "you can be
 *     closer to my voice" (26 October);
 *   - THREE verdicts in his words — "Hook was generic — anyone could have opened with that line";
 *   - THREE before-and-after pairs. On post 27 he was given "My holidays used to have client
 *     meetings in them. Now I say no." and changed it to "My holidays used to have client meetings
 *     in them." He deleted the sentence that answered his own hook — which is precisely what the
 *     hook_opens_loop check had flagged on that draft. His taste and the check agreeing, in the
 *     data, demonstrable.
 *
 * None of it reached the drafter. `push_back_on_draft` carries his note into the next draft of THAT
 * MOMENT through the job payload, and nowhere else — so a preference he stated on Monday is
 * invisible to Tuesday's post about something different. `outcomes.edit_diff` is written and
 * selected by nothing at all.
 *
 * WHY AN RPC RATHER THAN A GRANT
 *
 * The notes live in `system_events`, where `content_mcp` holds no privilege of any kind — not even
 * SELECT — and that is correct: it is the operations log. Granting it to the drafting role to reach
 * five rows would widen the read surface far past the question. This returns those rows and nothing
 * else, the same shape as `exportable_tables()`.
 *
 * WHAT IT IS NOT
 *
 * Not a library section and not a rule. The library is the standard and only Josh changes it
 * (12.10). This is a record of things he said, handed over as evidence of taste the way the
 * moment's material is handed over as evidence of fact. Nothing here is enforced and nothing here
 * can refuse a draft.
 */

create or replace function public.joshs_notes(p_limit integer default 12)
returns table (said_at timestamptz, source text, note text, before_text text, after_text text)
language sql
stable
security definer
set search_path = ''
as $$
  -- What he said when he sent a draft back.
  select e.created_at,
         'pushback'::text,
         (e.detail->>'note')::text,
         null::text,
         null::text
    from public.system_events e
   where e.kind = 'pushback'
     and coalesce(e.detail->>'note', '') <> ''

  union all

  -- What he said when he judged a post, and what he changed it to. The pair is the useful part:
  -- a verdict says what was wrong, a diff says what right looked like.
  select coalesce(o.verdict_at, o.edit_measured_at),
         'verdict'::text,
         o.verdict,
         o.draft_body,
         o.approved_body
    from public.outcomes o
   where o.verdict is not null
      or (o.draft_body is not null and o.approved_body is not null and o.draft_body <> o.approved_body)

   order by 1 desc nulls last
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

revoke execute on function public.joshs_notes(integer) from public, anon;
grant  execute on function public.joshs_notes(integer) to authenticated, service_role, content_mcp;

comment on function public.joshs_notes is
  'Everything Josh has said about a draft, and every line he changed, newest first. Read by '
  'get_drafting_brief so a preference he stated on one post is not invisible to the next. An RPC '
  'rather than a grant because the notes live in system_events, where content_mcp holds no '
  'privilege at all and should not. Evidence of taste, never a rule: only Josh changes the library '
  '(12.10).';
