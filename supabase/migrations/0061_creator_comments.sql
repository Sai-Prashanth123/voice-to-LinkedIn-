-- 0061 — COMMENT OPTIONS ON CREATORS JOSH PICKS
--
-- WHY
--
-- Josh, 30 October: "I know I should spend more time commenting, but I already feel like I spend
-- enough time on LinkedIn as is... I'd be open to it for sure. I'm very keen to see what that looks
-- like."
--
-- The `josh-comment` skill shipped on 2 November as the half that needs no infrastructure: he pastes
-- a post, it drafts a reply. This is the other half. He names creators, a job polls them twice a
-- day, and each new post arrives with comment options already written.
--
-- WHAT THIS IS NOT
--
-- Not a publishing path. Nothing here reaches LinkedIn: he reads an option and pastes it himself,
-- exactly as he does today. R3 is untouched and no row in these tables can become a `posts` row.
--
-- Not a second reference corpus. `reference_writer_posts` (0044) is the measured shape standard for
-- the eight writers clause 8.3 names, and it is deliberately unreachable from the drafting and gate
-- library views. These are different people for a different reason — people he wants to be seen
-- replying to, not people whose structure we measure — so they get their own table. Conflating them
-- would put strangers into a corpus that feeds every structural claim this system makes.
--
-- Not the system choosing. The skill attributes "whose posts are worth his time" to Josh
-- specifically: "a judgement about his market that he has and this does not". So `creators` is only
-- ever written from his own instruction, and nothing in this system adds a row to it on its own.

-- ── His list ──────────────────────────────────────────────────────────────────

create table public.creators (
  handle        text primary key,
  display_name  text,
  profile_url   text not null,

  -- 6.3: deactivated, never deleted. A creator he stops following is a decision worth keeping, and
  -- the posts already stored point at this row.
  active        boolean not null default true,

  added_at      timestamptz not null default now(),

  -- Set on EVERY poll, whether or not it found anything. Without it, "the poll stopped running" and
  -- "nobody posted today" are the same observation — which is the failure 0042's header describes
  -- and the one worker-ops' sentinel-freshness check exists to catch.
  last_polled_at      timestamptz,
  last_seen_posted_at timestamptz,

  constraint creators_handle_shape check (handle ~ '^[A-Za-z0-9._-]{2,100}$'),
  constraint creators_url_is_linkedin check (profile_url ~ '^https://(www\.)?linkedin\.com/in/')
);

comment on table public.creators is
  'People Josh wants comment options for. HIS list: nothing in this system adds to it. An empty '
  'table is the off state for worker-engage.';

-- ── What they posted ──────────────────────────────────────────────────────────

create table public.creator_posts (
  -- LinkedIn's own activity id, so the twice-daily poll updates rather than duplicates. The poll is
  -- not incremental: the console accepts a `since` and silently returns zero rows (probed
  -- 3 Nov 2026), so every run re-fetches recent posts and this key is what makes that safe.
  activity_id   text primary key,

  handle        text not null references public.creators(handle) on delete restrict,
  author_name   text,
  url           text,
  posted_at     timestamptz,
  text          text not null check (length(trim(text)) > 0),

  seen_at       timestamptz not null default now(),

  -- null means "not drafted yet", which IS the queue the per-run cap draws from, oldest first.
  drafted_at    timestamptz
);

create index creator_posts_undrafted_idx
  on public.creator_posts (posted_at) where drafted_at is null;

create index creator_posts_by_author_idx
  on public.creator_posts (handle, posted_at desc);

comment on table public.creator_posts is
  'Other people''s posts, stored so a comment can be drafted against one. NOT reference_writer_posts '
  'and never used for shape measurement: the console strips line breaks, so the shape of anything '
  'here is an artefact of the fetch.';

-- ── The options ───────────────────────────────────────────────────────────────

create table public.comment_options (
  id            bigint generated always as identity primary key,
  activity_id   text not null references public.creator_posts(activity_id) on delete restrict,

  body          text not null check (length(trim(body)) > 0),

  -- "one line on why that one is his to leave rather than anyone's" — josh-comment SKILL.md.
  why           text,

  /*
   * What the deterministic checks caught, and why this column exists at all.
   *
   * The skill is explicit that nothing checks a comment: "create_draft's claim ledger, the nine gate
   * checks and the shingle guard all read drafts, and a comment is none of those. You are the only
   * check there is." That sentence was addressed to a writer in a session. With a worker drafting
   * instead, it names nobody — so worker-engage runs three cheap deterministic checks and records
   * what they found HERE rather than blocking on them.
   *
   * Advisory on purpose. A flag is a prompt for him, not a verdict: the composite that actually
   * identifies a client — a figure plus a niche plus a date — is not something a string search can
   * find, so a clean `flags` must never be read as "this is safe to post".
   */
  flags         jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(flags) = 'array'),

  status        text not null default 'offered'
                  check (status in ('offered', 'used', 'discarded')),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),

  -- Same shape as library_proposals' constraint: a decision carries its timestamp or it did not
  -- happen. Without it "used" can be recorded with no record of when, and the learning signal that
  -- tells a comment he left from one he ignored is the whole point of the column.
  constraint comment_options_decided_has_timestamp
    check (status = 'offered' or decided_at is not null)
);

create index comment_options_offered_idx
  on public.comment_options (created_at desc) where status = 'offered';

create index comment_options_by_post_idx on public.comment_options (activity_id);

comment on table public.comment_options is
  'Drafted comments waiting for Josh. UNCHECKED by the gate: see the flags column. Nothing here '
  'publishes — he pastes what he wants into LinkedIn himself.';

-- ── Grants, and the policies without which they read as empty ────────────────
--
-- 0045 is the cautionary tale: `notices` and `reference_writer_posts` both shipped with RLS on and a
-- SELECT grant to content_mcp and NO policy naming that role. A grant gets you to the table; the
-- policy decides which rows you see. With none, the answer is none — and nobody noticed for weeks
-- because the connector falls back to the service role, which bypasses RLS entirely. So both halves
-- go in together here.
--
-- SELECT only, on all three. Every write goes through cc-submit: `content_mcp` has no UPDATE or
-- DELETE anywhere in this schema and that is not relaxed for a convenience.

alter table public.creators        enable row level security;
alter table public.creator_posts   enable row level security;
alter table public.comment_options enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'content_mcp') then
    grant select on public.creators        to content_mcp;
    grant select on public.creator_posts   to content_mcp;
    grant select on public.comment_options to content_mcp;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'content_mcp') then
    execute 'create policy mcp_read on public.creators        for select to content_mcp using (true)';
    execute 'create policy mcp_read on public.creator_posts   for select to content_mcp using (true)';
    execute 'create policy mcp_read on public.comment_options for select to content_mcp using (true)';
  end if;
end $$;

drop policy if exists creators_select on public.creators;
create policy creators_select on public.creators
  for select to authenticated using ((select auth.uid()) is not null);

drop policy if exists creator_posts_select on public.creator_posts;
create policy creator_posts_select on public.creator_posts
  for select to authenticated using ((select auth.uid()) is not null);

drop policy if exists comment_options_select on public.comment_options;
create policy comment_options_select on public.comment_options
  for select to authenticated using ((select auth.uid()) is not null);

-- Nothing is deletable, which eval case S0-04 asserts of every table in this schema. 0044 granted
-- DELETE on reference posts and 0046 took it back for exactly this reason; these three never get it.
revoke delete, truncate on public.creators        from service_role, anon, authenticated, public;
revoke delete, truncate on public.creator_posts   from service_role, anon, authenticated, public;
revoke delete, truncate on public.comment_options from service_role, anon, authenticated, public;

-- ── The switch, and the schedule ──────────────────────────────────────────────
--
-- SETTINGS-GATE, NOT CRON-GATE. 0013's header and worker-select both argue the same point: schedule
-- unconditionally and have the worker check a row, because "a cron change is invisible from a
-- session" and there is then nothing to remember to put back.
--
-- There is no on/off row here on purpose: an empty `creators` table IS the off state, so the feature
-- costs nothing and does nothing until Josh names someone. What the settings control is volume.

insert into public.settings (key, value, note) values
  ('comment_posts_per_run', '3'::jsonb,
   'How many newly seen posts get comment options in one run. The cap exists because cc-agent '
   'learned the lesson first: "a version of this that surfaces ten candidates a day is worse than '
   'no version at all, because Josh will stop reading them." Posts above the cap stay stored and '
   'undrafted, and the next run takes them oldest first.'),
  ('comment_options_per_post', '3'::jsonb,
   'Options drafted per post. He asked for "a few"; the josh-comment skill argues for two - "more '
   'than that is a menu, and he is not short of options, he is short of time." Three against a cap '
   'of three posts is nine comments a run. Lower this before raising the post cap.')
on conflict (key) do nothing;

-- 0013 is the twice-daily precedent: '0 9,17 * * 1-5'. Weekdays only, because his market does not
-- post much at the weekend and two runs that find nothing still pay for the fetch — the poll cannot
-- narrow by date, so every run is a full fetch of each profile.
select cron.schedule('creator-poll', '0 7,15 * * 1-5',
  $$select public.invoke_worker('worker-engage')$$);
