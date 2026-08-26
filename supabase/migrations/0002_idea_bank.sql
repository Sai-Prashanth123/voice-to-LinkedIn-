-- 0002 — THE IDEA BANK (clause 6)
-- "The idea bank is the asset. Tools get swapped over the years. This is the thing that has to
--  survive all of them, so it is specified in full and Josh owns it outright."
--
-- Design notes:
--   * bigint identity PKs internally; `ref` (M-000123) is the stable public id that appears in the
--     calendar and survives a tool migration (clause 6 `id`).
--   * Every FK is ON DELETE RESTRICT. 6.3: "Nothing may be deleted by the system." Deletion is made
--     impossible at the schema level, not merely unimplemented.

create sequence public.moment_ref_seq;

create table public.moments (
  id                bigint generated always as identity primary key,
  ref               text not null unique
                      default ('M-' || lpad(nextval('public.moment_ref_seq')::text, 6, '0')),

  source            public.moment_source not null,
  source_ref        text,                       -- which call / session / thread. Null for raw capture.
  captured_at       timestamptz not null default now(),

  pillar            text,                       -- 5.10, set by the interview, correctable by Josh
  audience          text,                       -- 5.6 / 9.2
  audience_is_buyer boolean,                    -- 6: "or a note that it is deliberately not the buyer"

  time_sensitive    boolean not null default false,
  decays_at         date,                       -- roughly when it stops being worth posting

  status            public.moment_status not null default 'captured',
  depth_reached     public.interview_depth not null default 'none',
  strength          smallint check (strength between 1 and 5),   -- 7.1 "how strong the material is"

  -- 7.4 Josh's overrides
  pinned            boolean not null default false,
  killed            boolean not null default false,
  not_before        date,

  parked_reason     text,                       -- 9.8 plain-language reason
  notes             text,                       -- 6: Josh's own, and anything the system leaves

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- clause 6: source_ref is "Empty for raw capture"
  constraint moments_raw_capture_has_no_ref
    check (source <> 'raw_capture' or source_ref is null),

  -- Only the automatic inputs may sit at half_mined (4.3.2). Josh's own inputs never do.
  constraint moments_half_mined_is_automatic
    check (status <> 'half_mined'
           or source in ('call_transcript', 'claude_code', 'slack')),

  constraint moments_parked_has_reason
    check (status <> 'parked' or parked_reason is not null),

  constraint moments_decay_needs_flag
    check (decays_at is null or time_sensitive)
);

comment on table public.moments is
  'The idea bank. One row per moment. Clause 6 of the build spec. Nothing is ever deleted (6.3).';

create index moments_status_idx      on public.moments (status);
create index moments_pillar_idx      on public.moments (pillar) where pillar is not null;
create index moments_captured_at_idx on public.moments (captured_at desc);
create index moments_decays_at_idx   on public.moments (decays_at) where decays_at is not null;
create index moments_queue_idx       on public.moments (status, pinned desc, strength desc nulls last)
                                     where status in ('mined', 'queued');
create index moments_source_idx      on public.moments (source, captured_at desc);

-- ---------------------------------------------------------------------------
-- NAMES (clause 9c)
-- 9.10: permission is granted "for that post", not for the person forever.
-- Clearance therefore lives per moment, never as a global flag on a person.
-- ---------------------------------------------------------------------------
create table public.moment_names (
  id           bigint generated always as identity primary key,
  moment_id    bigint not null references public.moments(id) on delete restrict,
  name         text not null,
  kind         text not null check (kind in ('person', 'company')),
  cleared      boolean not null default false,
  cleared_at   timestamptz,
  cleared_note text,
  created_at   timestamptz not null default now(),
  unique (moment_id, name),
  constraint moment_names_cleared_has_timestamp
    check (cleared = false or cleared_at is not null)
);

create index moment_names_moment_idx on public.moment_names (moment_id);

comment on table public.moment_names is
  'Per-moment name clearance (9.10-9.13). Uncleared names must never reach a published draft.';

-- ---------------------------------------------------------------------------
-- RAW INPUT (4.1.2 — store BOTH the audio and the transcript)
-- ---------------------------------------------------------------------------
create table public.raw_inputs (
  id                  bigint generated always as identity primary key,
  moment_id           bigint not null references public.moments(id) on delete restrict,
  kind                text not null check (kind in ('voice', 'text', 'image')),
  audio_path          text,        -- Supabase Storage object path
  image_path          text,
  transcript          text,
  text_body           text,
  duration_seconds    numeric(8,2),
  telegram_message_id bigint,
  transcribed_at      timestamptz,
  created_at          timestamptz not null default now(),

  constraint raw_inputs_has_content
    check (audio_path is not null or image_path is not null
           or transcript is not null or text_body is not null),

  -- 4.1.2 is explicit: a voice note keeps the audio, not just the words.
  constraint raw_inputs_voice_keeps_audio
    check (kind <> 'voice' or audio_path is not null)
);

create index raw_inputs_moment_idx on public.raw_inputs (moment_id);

-- ---------------------------------------------------------------------------
-- THE INTERVIEW (clause 5) — full Q&A, resumable (5.11)
-- ---------------------------------------------------------------------------
create table public.interview_turns (
  id           bigint generated always as identity primary key,
  moment_id    bigint not null references public.moments(id) on delete restrict,
  turn_no      int not null,
  role         text not null check (role in ('question', 'answer')),
  body         text not null,
  question_key text,                                  -- links to question_stats (4.2.6)
  depth        public.interview_depth,                -- which rung this question was probing
  is_pushback  boolean not null default false,        -- 5.3 — at most one per question
  audio_path   text,                                  -- 4.2.4 spoken answers
  created_at   timestamptz not null default now(),
  unique (moment_id, turn_no)
);

create index interview_turns_moment_idx on public.interview_turns (moment_id, turn_no);

-- ---------------------------------------------------------------------------
-- MATERIAL — what the interview produced (5.2 asks six things, 5.9 stores four)
-- ---------------------------------------------------------------------------
create table public.material (
  moment_id            bigint primary key references public.moments(id) on delete restrict,

  -- 5.9 the structured output written back to the idea bank
  the_moment           text,
  the_detail           text,
  the_realisation      text,
  the_lesson           text,

  -- 5.2 what a found moment is mined for
  what_happened_before text,
  who_was_there        text,
  their_actual_words   text,
  how_he_felt          text,
  what_changed         text,
  reader_takeaway      text,

  updated_at           timestamptz not null default now()
);

comment on column public.material.their_actual_words is
  'Verbatim only. 5.4 / 9.4: never invented. The claim ledger verifies drafts against this text.';
