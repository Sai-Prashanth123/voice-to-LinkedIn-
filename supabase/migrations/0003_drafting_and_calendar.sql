-- 0003 — DRAFTING, THE GATE, VISUALS, THE CALENDAR (clauses 9, 10, 11)

-- ---------------------------------------------------------------------------
-- DRAFTS (clause 6 `drafts`, clause 9a)
-- "Every version, in order, with the framework used, the gate result, and which version of the
--  reference library wrote it." Append-only across the moment's whole life, including re-openings (6.4).
-- ---------------------------------------------------------------------------
create table public.drafts (
  id              bigint generated always as identity primary key,
  moment_id       bigint not null references public.moments(id) on delete restrict,
  version         int not null,                     -- monotonic per moment, never reused
  attempt         int not null default 1,           -- 9.8 gate attempt within this cycle, max 3

  body            text not null,
  hook            text,
  framework       text not null,                    -- 9.3 record which one, so it can be reviewed
  library_version int not null,                     -- 8.4 without this, tuning is guesswork
  model           text not null,

  -- THE CLAIM LEDGER — the mechanism that turns 9.4 from a judgement into a check.
  -- Each entry: {claim, kind, source_field, source_span}. `source_span` must appear verbatim in the
  -- named field of the idea bank entry. A fabricated quote, number or name has no span to point at.
  claims          jsonb not null default '[]'::jsonb,
  claims_verified boolean,                          -- set by the deterministic verifier, not a model

  gate_passed     boolean,
  gate_reason     text,

  created_at      timestamptz not null default now(),
  unique (moment_id, version),

  constraint drafts_attempt_max_three
    check (attempt between 1 and 3),                -- 9.8 three strikes and the moment parks

  constraint drafts_claims_is_array
    check (jsonb_typeof(claims) = 'array')
);

create index drafts_moment_idx on public.drafts (moment_id, version desc);

comment on column public.drafts.claims is
  'The claim ledger. Every factual claim, quote, number and name with the verbatim source span it '
  'rests on (9.4). Verified mechanically before any model judgement is involved.';

-- ---------------------------------------------------------------------------
-- THE GATE (clause 9b)
-- "It is a rejection mechanism, not a scoring exercise."
-- Each check in 9.6 runs as its own call with its own rubric. Blended into one prompt a model
-- averages them and passes marginal work. Any single fail fails the draft (9.7 — no pass-with-a-note).
-- ---------------------------------------------------------------------------
create table public.gate_runs (
  id         bigint generated always as identity primary key,
  draft_id   bigint not null references public.drafts(id) on delete restrict,
  check_key  text not null,
  passed     boolean not null,
  reason     text,                                  -- 9.9 what it caught
  changed    text,                                  -- 9.9 what it changed
  model      text,
  created_at timestamptz not null default now(),

  constraint gate_runs_known_check check (check_key in (
    'anyone_else',        -- 9.6a could anyone else have written this
    'claims_trace',       -- 9.6b does every claim trace to the source
    'hook_opens_loop',    -- 9.6c does the hook open a loop rather than close one
    'aimed_at_someone',   -- 9.6d is it aimed at someone in particular
    'voice_guide',        -- 9.6e does it obey the voice guide
    'names_cleared',      -- 9.6f does it use a name that has not been cleared
    'banned_phrases',     -- added by us: the AI-tells list
    'identifiable'        -- 9.13 identifiable by implication even when anonymised
  )),
  constraint gate_runs_failure_has_reason
    check (passed = true or reason is not null)
);

create index gate_runs_draft_idx on public.gate_runs (draft_id);

-- ---------------------------------------------------------------------------
-- VISUALS (clause 10)
-- Rebuild-from-reference only. 10.4: never a version close enough to be recognisable as theirs.
-- ---------------------------------------------------------------------------
create table public.visuals (
  id            bigint generated always as identity primary key,
  moment_id     bigint not null references public.moments(id) on delete restrict,
  version       int not null default 1,             -- 10.6 another version without starting again

  source_path   text not null,                      -- the image Josh sent
  taking        text not null                       -- 10.2 what he is taking from it
                  check (taking in ('idea', 'structure', 'look')),
  post_doing    text,                               -- 10.2 what the post is doing
  svg_body      text,                               -- generated, on-brand, deterministic
  rendered_path text,                               -- PNG in Storage

  created_at    timestamptz not null default now(),
  unique (moment_id, version)
);

create index visuals_moment_idx on public.visuals (moment_id, version desc);

-- ---------------------------------------------------------------------------
-- THE CALENDAR (clause 11)
-- 11.1 drafts arrive at draft status. Never scheduled, never live.
-- 11.2 / R3 THE SYSTEM NEVER PUBLISHES. Publishing follows only from Josh marking a post ready.
--      Enforced below as a table constraint, not as application logic — acceptance test 11 allows
--      zero exceptions across four weeks of running.
-- ---------------------------------------------------------------------------
create table public.posts (
  id              bigint generated always as identity primary key,
  moment_id       bigint not null references public.moments(id) on delete restrict,
  draft_id        bigint not null references public.drafts(id) on delete restrict,
  visual_id       bigint references public.visuals(id) on delete restrict,

  body            text not null,                    -- 11.4 Josh edits this in the app
  status          public.post_status not null default 'draft',

  scheduled_for   timestamptz,
  marked_ready_at timestamptz,                      -- the ONLY thing that authorises publishing
  published_at    timestamptz,
  linkedin_urn    text unique,
  publish_error   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- R3, at the schema level.
  constraint posts_ready_requires_josh
    check (status <> 'ready'     or marked_ready_at is not null),
  constraint posts_scheduled_requires_josh
    check (status <> 'scheduled' or (marked_ready_at is not null and scheduled_for is not null)),
  constraint posts_published_requires_josh
    check (status <> 'published' or (marked_ready_at is not null
                                     and scheduled_for is not null
                                     and published_at is not null)),
  -- A post cannot be marked published before Josh marked it ready.
  constraint posts_ready_precedes_publish
    check (published_at is null or published_at >= marked_ready_at)
);

create index posts_status_idx    on public.posts (status);
create index posts_schedule_idx  on public.posts (scheduled_for)
                                 where status = 'scheduled';
create index posts_moment_idx    on public.posts (moment_id);

comment on table public.posts is
  'The calendar. Clause 11. The check constraints are the enforcement of 11.2: the system never '
  'publishes on its own, under any circumstance.';

-- ---------------------------------------------------------------------------
-- WHAT COMES BACK (clause 12)
-- 12a runs on its own and must work with zero effort from Josh.
-- 12b is best effort; 12.8 forbids stalling, nagging or degrading if he skips it for weeks.
-- ---------------------------------------------------------------------------
create table public.outcomes (
  post_id                 bigint primary key references public.posts(id) on delete restrict,
  moment_id               bigint not null references public.moments(id) on delete restrict,

  -- 12.1 automatic, pulled at seven days, no action from Josh
  impressions             int,
  reach                   int,
  reactions               int,
  comments                int,
  reshares                int,
  metrics_pulled_at       timestamptz,
  metrics_error           text,

  -- 12.2 automatic, every time. The most direct evidence of what the system gets wrong,
  -- and the measurement behind the 17a acceptance test.
  draft_body              text,
  published_body          text,
  edit_diff               jsonb,
  edit_ratio              numeric(5,4),             -- 0 = untouched, 1 = fully rewritten
  edit_class              text check (edit_class in ('light', 'rewrite')),

  -- 12.4 best effort, must take a couple of seconds
  verdict                 text,
  verdict_at              timestamptz,

  -- 12.5/12.6 best effort, asked inside the weekly pass and nowhere else (12.7)
  conversation            text check (conversation in
                            ('none', 'comment_thread', 'dm', 'call', 'client')),
  conversation_who        text,
  conversation_asked_at   timestamptz,
  conversation_answered_at timestamptz,

  updated_at              timestamptz not null default now()
);

create index outcomes_moment_idx  on public.outcomes (moment_id);
create index outcomes_pending_idx on public.outcomes (post_id) where metrics_pulled_at is null;

comment on column public.outcomes.edit_class is
  'The 17a acceptance measurement. light = word and line level, story/angle/hook/structure survive. '
  'rewrite = different moment, angle, hook, or restructured body.';
