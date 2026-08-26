-- 0025 — THE TWO SIGNALS THAT ARE SUPPOSED TO WORK ON THEIR OWN (clause 12a), AND THE ONE THAT
--        COSTS JOSH SECONDS (12.4)
--
-- 12.3: "These two must be enough on their own to drive the learning in clause 12c. Everything below
--        improves it and nothing below is a dependency."
--
-- Both were dependencies. The draft-vs-published diff (12.2) was written from exactly one place —
-- inside the successful LinkedIn publish loop — so with LinkedIn unconnected it produced nothing at
-- all, and 12.1 is separately blocked on Community Management review. The automatic layer, the layer
-- the spec REQUIRES to work, was entirely dead: two published posts, zero diffs.
--
-- The edit is knowable the moment Josh approves. It needs no LinkedIn, and now it is measured there.

-- ---------------------------------------------------------------------------
-- 12.2 — measured at approval, refreshed at publish
-- ---------------------------------------------------------------------------
alter table public.outcomes
  add column if not exists approved_body    text,
  add column if not exists edit_measured_at timestamptz,
  add column if not exists edit_stage       text
    check (edit_stage is null or edit_stage in ('approved', 'published'));

comment on column public.outcomes.approved_body is
  '12.2. The body as Josh approved it, captured when he marks the post ready. This is what makes the '
  'diff independent of LinkedIn: 12.3 requires the automatic signals to stand on their own.';

comment on column public.outcomes.edit_stage is
  'Which measurement the edit_ratio/edit_class currently describe. "approved" is Josh''s edit before '
  'anything went out; "published" means the body moved again between approval and publishing.';

-- ---------------------------------------------------------------------------
-- 12.4 — a one-line verdict, on a DRAFT
--
--   "A short reaction on any draft. 'Hook was wrong.' 'This one nailed it.'"
--
-- The verdict names the draft it judged. A moment produces several drafts — a push-back revision is
-- a new one — and "the hook was wrong" against a moment rather than a version tells the learning
-- loop nothing about which attempt it is describing.
-- ---------------------------------------------------------------------------
alter table public.outcomes
  add column if not exists verdict_draft_id bigint references public.drafts(id) on delete restrict;

comment on column public.outcomes.verdict_draft_id is
  '12.4. Which draft version the verdict is about. Null for a verdict left on a post that has '
  'already gone out, where the published body is the thing being judged.';

-- An outcomes row for a post that has not published yet is now normal rather than an anomaly: a
-- verdict on a rejected draft is precisely the signal 12.4 exists to collect. Nothing downstream
-- assumed otherwise -- `postsToAskAbout` and the metrics sweep both filter on posts.status --
-- but the index that finds pending metrics work should not start returning drafts.
drop index if exists public.outcomes_pending_idx;
create index outcomes_pending_idx on public.outcomes (post_id)
  where metrics_pulled_at is null and published_body is not null;

-- ---------------------------------------------------------------------------
-- 12.4 — the state that holds "he is about to tell me what was wrong"
-- ---------------------------------------------------------------------------
alter table public.conversation_state
  drop constraint conversation_state_awaiting_check;

alter table public.conversation_state
  add constraint conversation_state_awaiting_check
  check (awaiting in (
    'nothing',
    'answer',              -- an answer to an interview question
    'visual_details',      -- 10.2 what he is taking from the image
    'visual_feedback',     -- 10.6 another version, without starting again
    'name_clearance',      -- 9.12 the system must ask before a name is used
    'candidate_choice',    -- 4.3.4 which waiting candidate to dig into
    'disambiguate',        -- answering an old question, or starting something new
    'seeding',             -- the cold-start sitting: one moment straight into the next
    'voice_guide_capture', -- 8.1 the recorded interview, transcribed into the library
    'draft_verdict'        -- 12.4 one line on a draft, or silence. Never blocks anything.
  ));

-- ---------------------------------------------------------------------------
-- 12.12 — "Josh can see WHICH change and undo it"
--
-- The undo worked; the "which" did not. `library_proposals.applied_library_version` is the SNAPSHOT
-- number and `library_section_versions.version` is the SECTION number -- different counters. With
-- only the first, a rollback of section v5 has no way to find the proposal that produced it, so an
-- approved change that Josh then reverted went on reading "approved" forever and the learning loop
-- could propose it again.
-- ---------------------------------------------------------------------------
alter table public.library_proposals
  add column if not exists applied_section_version int;

comment on column public.library_proposals.applied_section_version is
  '12.12. The library_section_versions.version this proposal produced, so a rollback can find it and '
  'mark it reverted. The proposal_status enum has always had ''reverted''; nothing used to set it.';
