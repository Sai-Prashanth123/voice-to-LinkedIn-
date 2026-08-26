-- 0004 — THE REFERENCE LIBRARY (clause 8) and the LEARNING LOOP (clause 12c)
--
-- 8.5  editable by Josh with no build or deploy step
-- 8.6  a change applies to the very next draft            -> read at runtime, never cached past a write
-- 8.7  read at drafting AND at gating; rules are not to be copied into code where Josh cannot see them
-- 8.8  add a rule in under a minute                       -> markdown prose, not YAML
-- 8.4  versioned; every draft records which version wrote it
-- 12.12 reversible; Josh can see which change and undo it

create table public.library_sections (
  key        text primary key,
  title      text not null,
  body       text not null default '',
  version    int  not null default 1,
  immutable  boolean not null default false,
  sort_order int  not null default 100,
  updated_at timestamptz not null default now()
);

comment on table public.library_sections is
  'Clause 8. Markdown prose, edited by Josh in the app. Read at drafting and at gating (8.7).';

-- Append-only history of every section body ever active. Rollback reads from here.
create table public.library_section_versions (
  id         bigint generated always as identity primary key,
  key        text not null references public.library_sections(key) on delete restrict,
  version    int  not null,
  body       text not null,
  reason     text,                                   -- 12.11 recorded with the date and the reason
  created_at timestamptz not null default now(),
  unique (key, version)
);

-- A snapshot pinning one version of every section. This integer is what drafts record (8.4).
create table public.library_versions (
  version    int primary key,
  sections   jsonb not null,                         -- {section_key: section_version}
  reason     text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Keep the history and the snapshot honest, automatically.
-- ---------------------------------------------------------------------------
-- Two triggers, deliberately. The version bump has to happen BEFORE the row is written; the history
-- row and the snapshot have to happen AFTER, because library_section_versions carries a foreign key
-- to library_sections and on INSERT the parent row does not exist yet at BEFORE time.
create or replace function public.library_section_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.body is not distinct from old.body then
      return new;                                     -- nothing changed, no new version
    end if;
    new.version    := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.library_section_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next int;
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return null;
  end if;

  insert into public.library_section_versions (key, version, body)
  values (new.key, new.version, new.body)
  on conflict (key, version) do nothing;

  -- Roll the library snapshot forward so the very next draft picks the change up (8.6).
  select coalesce(max(version), 0) + 1 into v_next from public.library_versions;
  insert into public.library_versions (version, sections, reason)
  select v_next,
         jsonb_object_agg(s.key, s.version),
         'section updated: ' || new.key
    from public.library_sections s;

  return null;
end;
$$;

create trigger library_sections_bump
  before insert or update on public.library_sections
  for each row execute function public.library_section_bump();

create trigger library_sections_snapshot
  after insert or update on public.library_sections
  for each row execute function public.library_section_snapshot();

-- ---------------------------------------------------------------------------
-- THE ONE THING THAT IS NEVER TUNABLE (clause 12 callout)
--
-- "The lived experience test in clause 1 and the no-fabrication rule in clause 9.4 are not open to
--  adjustment by the learning loop, whatever the numbers say. A system optimising freely against
--  LinkedIn engagement finds its way to engagement bait, because that is what the metric rewards."
--
-- They live in the library so Josh can SEE them (8.7 forbids hiding rules in code), but the learning
-- loop is structurally unable to propose against them. This trigger is that guarantee.
-- ---------------------------------------------------------------------------
create or replace function public.reject_proposal_on_immutable_section()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.library_sections
             where key = new.section_key and immutable) then
    raise exception
      'Section % is immutable. The lived-experience test (clause 1) and the no-fabrication rule '
      '(clause 9.4) are not open to adjustment by the learning loop.', new.section_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create table public.library_proposals (
  id                    bigint generated always as identity primary key,
  section_key           text not null references public.library_sections(key) on delete restrict,

  -- 12.9: not "posts are underperforming", but a specific claim with the posts named.
  claim                 text not null,
  evidence              jsonb not null,
  proposed_body         text not null,

  status                public.proposal_status not null default 'open',
  decided_at            timestamptz,
  decided_reason        text,
  applied_library_version int references public.library_versions(version),

  created_at            timestamptz not null default now(),

  constraint proposals_decided_has_timestamp
    check (status = 'open' or decided_at is not null),
  constraint proposals_evidence_not_empty
    check (jsonb_typeof(evidence) = 'object' and evidence <> '{}'::jsonb)
);

create trigger library_proposals_respect_immutable
  before insert or update on public.library_proposals
  for each row execute function public.reject_proposal_on_immutable_section();

create index library_proposals_open_idx on public.library_proposals (created_at desc)
  where status = 'open';

comment on table public.library_proposals is
  'Clause 12c. The system proposes; Josh approves or rejects (12.10). It never changes the library '
  'on its own. Proposals against immutable sections are rejected by trigger.';

-- ---------------------------------------------------------------------------
-- Seed the sections. Bodies are filled in by Josh (clause 8) except core_rules, which is ours
-- and is locked.
-- ---------------------------------------------------------------------------
insert into public.library_sections (key, title, immutable, sort_order, body) values
  ('core_rules', 'Core rules (never tunable)', true, 0,
E'# Core rules\n\nThese two are not open to adjustment by the learning loop, whatever the numbers say.\n\n## R1 — The lived experience test (clause 1)\nCould anyone else have written this? If yes, it fails. If no, because only Josh was in that room and\nhad that conversation, it passes.\n\n## R2 — No fabrication (clauses 5.4, 9.4)\nEvery factual claim, quote, number and name must trace to something in the idea bank entry. Nothing\nelse may appear. Missing detail stays missing and the draft works without it. If Josh did not say it,\nit does not go in.\n'),

  ('pillars',        'Content pillars',                  false, 10, ''),
  ('frameworks',     'Body frameworks',                  false, 20, ''),
  ('hooks',          'Hook rules',                       false, 30, ''),
  ('closes',         'Closing lines',                    false, 40, ''),
  ('audience',       'Who he is talking to',             false, 50, ''),
  ('voice_guide',    'Voice guide (from speech, not the archive)', false, 60, ''),
  ('prompt_set',     'The prompt set',                   false, 70, ''),
  ('banned_phrases', 'Banned phrases and AI tells',      false, 80, ''),
  ('formatting',     'LinkedIn formatting rules',        false, 90, ''),
  ('gate_rules',     'Gate rules',                       false, 100, ''),
  ('visual_brand',   'Visual brand',                     false, 110, '');

comment on column public.library_sections.body is
  'Markdown. 8.8: Josh must be able to add a rule in under a minute, which prose allows and a '
  'structured format does not.';
