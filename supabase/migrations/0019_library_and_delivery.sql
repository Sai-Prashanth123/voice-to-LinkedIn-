-- 0019 — TWO MISSING LIBRARY SECTIONS, AND WHEN DRAFTS ARRIVE
--
-- Clause 8 names inputs Josh is contractually going to supply that had nowhere to land, and 9.5
-- leaves a timing decision open that was never made.

-- ---------------------------------------------------------------------------
-- 8.3 — REFERENCE POSTS BY OTHER WRITERS
--
-- "Josh will supply reference posts by other writers whose storytelling structure he wants to
--  borrow. Structural reference only. Never a source of voice, never copied, never quoted."
--
-- This is the most dangerous section in the library, because the failure mode is invisible: a
-- drafter given someone else's posts will absorb their cadence along with their structure, and the
-- result reads fine while being exactly what clause 8a exists to prevent. So the section states its
-- own rules in the body, where the drafter reads them, rather than only in a comment here.
--
-- It goes into the DRAFTING view and nothing else. The gate must not see it: a gate that has read
-- another writer's posts starts judging against their voice.
-- ---------------------------------------------------------------------------

insert into public.library_sections (key, title, body, sort_order, immutable) values
  ('reference_posts', 'Reference posts by other writers (structure only)',
$$# Reference posts — structure only

FOR JOSH (8.3). Paste posts by other writers whose STORYTELLING STRUCTURE you want borrowed.

## The rule that governs this whole section

These are read for SHAPE and for nothing else:

- how the writer gets in — what the first line does before the reader knows the subject
- the order they reveal things in, and what they hold back
- where the turn happens, and how much space they give it
- how they land it, and what they leave unsaid

Nothing else about them may reach a post. Not a phrase, not a cadence, not a rhythm, not a
transition, not an image. **Never quoted, never near-quoted, never paraphrased.** If any run of
words from a reference post could be recognised in a draft, the reference has been used wrongly.

Voice comes from ONE place: the voice guide, built from Josh talking (8.1). Never from here.

## Format

For each one, paste the post and add a line saying what you want taken from it. "The way she does
not explain the situation until the fourth line" is useful. "I like this one" is not — it gives the
drafter nothing to borrow and everything to imitate.

## Currently

Empty. Nothing is borrowed until Josh puts something here.
$$, 130, false),

-- ---------------------------------------------------------------------------
-- 8.1 — THE RECORDED INTERVIEW BEHIND THE VOICE GUIDE
--
-- "The voice guide comes from a recorded interview where he talks at length in his own words, and
--  that transcript is the source of truth."
--
-- The guide had a home; the transcript it must be built from did not. That matters later rather
-- than now: clause 12's learning loop proposes changes to the voice guide, and a proposal about how
-- Josh sounds needs to be checkable against a recording of Josh sounding like that. Without it, the
-- guide drifts on the loop's own opinion — the archive problem again, one level up.
--
-- It is voice EVIDENCE for the drafter, never a source of claims. A post cannot cite it.
-- ---------------------------------------------------------------------------

  ('voice_transcript', 'The voice interview (source of truth for the guide)',
$$# The voice interview

FOR JOSH (8.1). The transcript of you talking at length, in your own words.

This is the SOURCE OF TRUTH for the voice guide. The guide is the summary; this is the evidence. If
the two ever disagree, this wins and the guide gets corrected.

## Why it is not the post archive

Clause 8a: the archive was written with heavy AI assistance and has drifted from how you actually
sound. Training on it would reproduce the exact problem this system exists to solve. Speech has not
drifted, which is the whole reason the interview is recorded rather than assembled from what you
have already published.

## How it gets here

Send `/voiceguide` in Telegram and then talk. Long is good — twenty minutes of you telling stories
is worth more than an hour of you describing how you write. It transcribes straight into this
section. Or paste a transcript in directly, if it was recorded elsewhere.

## What reads it

The drafter, as evidence of how you sound. **Not as a source of facts** — nothing in a post may cite
this. Every claim still traces to the idea bank entry (9.4), with no exceptions for this section.

## Currently

Empty. Until it is filled, the voice guide has nothing behind it.
$$, 135, false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 9.5 — WHEN DRAFTS REACH HIM
--
-- "Timing is open, immediate or batched, because Josh does not want to wait after a session but
--  also does not want pinging all day."
--
-- Nothing implemented it: every passing draft fired its own message the moment it passed. That is
-- fine for one draft written just after a session and wrong for the four-hourly selection run, which
-- can queue ten and deliver ten separate messages in a burst — precisely the pinging the clause is
-- written to avoid.
--
-- Batched by default. The digest fires soon enough after a session that nothing feels like waiting,
-- and a burst arrives as one message rather than ten.
-- ---------------------------------------------------------------------------

insert into public.settings (key, value, note) values
  ('draft_delivery', '"batched"'::jsonb,
   '9.5 — "batched" (one digest listing what is ready) or "immediate" (a message per draft as it '
   'passes). Batched by default: a burst of ten from one selection run should be one message.'),
  ('draft_digest_minutes', '45'::jsonb,
   '9.5 — how long a passing draft waits for others to join its digest. Short enough that a draft '
   'written just after a session still feels immediate.')
on conflict (key) do nothing;

-- The voice-guide interview is a capture mode, not a moment: it produces library content, not a
-- post, so it must not be filed as material and must not reach the drafter as a claim source.
alter table public.conversation_state
  drop constraint conversation_state_awaiting_check;

alter table public.conversation_state
  add constraint conversation_state_awaiting_check
  check (awaiting in (
    'nothing',
    'answer',
    'visual_details',
    'visual_feedback',
    'name_clearance',
    'candidate_choice',
    'disambiguate',
    'seeding',
    'voice_guide_capture'   -- 8.1 the recorded interview, transcribed into the library
  ));

-- ---------------------------------------------------------------------------
-- 8.1 — WHERE THE RECORDING LIVES
--
-- It cannot go in `raw_inputs`: that table hangs off a moment (NOT NULL), and this recording is not
-- a moment. It produces library content rather than a post, and it must never become a source of
-- claims — the claim ledger only accepts spans from an idea bank entry, and that has no exception.
--
-- The audio is kept for the same reason 4.1.2 keeps voice notes. The transcript is the source of
-- truth for the voice guide, so if the transcription came out poorly it must be possible to go back
-- to what Josh actually said rather than to a machine's best guess at it.
-- ---------------------------------------------------------------------------

create table public.library_recordings (
  id                  bigint generated always as identity primary key,
  section_key         text not null references public.library_sections(key) on delete restrict,
  audio_path          text not null,
  transcript          text,
  duration_seconds    numeric(8,2),
  telegram_message_id bigint,
  transcribed_at      timestamptz,
  created_at          timestamptz not null default now()
);

create index library_recordings_section_idx on public.library_recordings (section_key, created_at);

comment on table public.library_recordings is
  '8.1 - recordings behind a library section, principally the voice interview. NOT raw_inputs: this '
  'is not a moment, produces library content rather than a post, and is never a source of claims.';

alter table public.library_recordings enable row level security;

create policy library_recordings_select on public.library_recordings
  for select to authenticated using ((select auth.uid()) is not null);
create policy library_recordings_insert on public.library_recordings
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy library_recordings_update on public.library_recordings
  for update to authenticated using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

revoke delete on public.library_recordings from anon, authenticated, service_role;
revoke all on public.library_recordings from anon;
