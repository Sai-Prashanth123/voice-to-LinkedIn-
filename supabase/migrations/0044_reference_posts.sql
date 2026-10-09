-- The reference writers' posts, held so Josh can read them.
--
-- WHY THIS REVERSES A DELIBERATE DECISION
--
-- Clause 8.3 names eight writers whose storytelling structure Josh wants to borrow, "structural
-- reference only, never a source of voice, never copied, never quoted". This build held that by not
-- storing their words at all: `sentinel-structure.mjs` and `sentinel-refresh.mjs` both refuse to emit
-- anything containing a run of the source text, and `get_sentinels` told the model "their words are
-- not here and never will be".
--
-- The cost of that showed up the first time Josh used it. He asked for Matt Barker and got nothing,
-- and wrote: "I tried testing with Matt Barker and it returned nothing, and I can't get to the posts
-- through Claude Code." He is right to want them. He chose these writers, he wants to study how they
-- build a post, and a system that will not show him what he asked for is not protecting him from
-- anything he did not ask to be protected from.
--
-- So the posts are stored, and the protection moves rather than disappearing:
--
--   The DRAFTING and GATE views still receive measurements only. `_shared/views.ts` already does this
--   for `voice_transcript`, and it is the thing that stops his posts reading like Matt's — which is
--   what he is actually paying for. A gate that has read another writer's posts starts judging
--   against their voice.
--
--   Reading them is a tool Josh calls in a session. `get_reference_posts` returns text; nothing in
--   the drafting path can reach this table.
--
-- That trade is a rule in code rather than an absence of data, which is weaker. It is tested
-- (reference-split.test.ts) and it is the first thing to check if his drafts ever start sounding like
-- somebody else.
--
-- One honest note on what was already true: the raw scrape has been committed in
-- `data/josh/sentinels/scrape-2026-10-05.json` since 5 October — 112 posts, every one with its full
-- text. The claim that the system held none of their words was already false on disk; this makes the
-- holding deliberate, bounded and queryable instead of incidental.

create table if not exists public.reference_writer_posts (
  -- LinkedIn's own activity id. The natural key, so re-running a scrape updates rather than duplicates.
  activity_id   text        primary key,

  handle        text        not null,
  author_name   text,
  url           text,
  posted_at     timestamptz,
  text          text        not null check (length(trim(text)) > 0),

  -- The measurements, computed once at load by scripts/lib/prose.mjs rather than per query. Same
  -- functions the sentinel refresh uses, so a per-post figure and an aggregate cannot disagree.
  words             integer,
  paragraphs        integer,
  above_fold_words  integer,
  opening_words     integer,
  opening_shape     text,
  close_shape       text,
  uses_list         boolean,
  sentence_words_sd numeric,

  -- False when the scrape returned the post as one unbroken line. The 5 October scrape did exactly
  -- that, which collapsed every line-derived measure to 1 and would have been reported as seven
  -- writers changing their habits. Shape measures must exclude these rather than average them in.
  has_line_breaks   boolean     not null default true,

  reaction_count    integer,
  comment_count     integer,

  scraped_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists reference_writer_posts_handle_idx
  on public.reference_writer_posts (handle, posted_at desc);

alter table public.reference_writer_posts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'content_mcp') then
    grant select on public.reference_writer_posts to content_mcp;
  end if;
end $$;

drop policy if exists reference_writer_posts_select on public.reference_writer_posts;
create policy reference_writer_posts_select on public.reference_writer_posts
  for select to authenticated
  using ((select auth.uid()) is not null);

-- These are somebody else's words. They can be refreshed and they can be removed, which is the one
-- place in this schema where deletion is the right answer — unlike Josh's own material, nothing here
-- is a record of something he said.
grant delete on public.reference_writer_posts to service_role;

comment on table public.reference_writer_posts is
  'Posts by the eight reference writers (8.3). Readable by Josh through get_reference_posts. NEVER '
  'reachable from the drafting or gate library views — see _shared/views.ts and reference-split.test.ts.';
