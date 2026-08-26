-- Behavioural assertions against the schema.
--
-- These test the requirements that must hold structurally rather than by convention. Each block
-- raises P0001 if the rule did NOT hold, so the run fails loudly.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.moments (source, pillar, audience, status, strength)
values ('raw_capture', 'positioning', 'founders', 'mined', 4);

insert into public.material (moment_id, the_moment, their_actual_words)
values (1, 'A call where the buyer said the quiet part out loud.',
           'we already tried that and it did not work');

insert into public.drafts (moment_id, version, body, framework, library_version, model, claims)
values (1, 1, 'draft body', 'scene-first', 1, 'claude-opus-5',
        '[{"claim":"they said it did not work","source_field":"their_actual_words",
           "source_span":"it did not work"}]'::jsonb);

-- ---------------------------------------------------------------------------
-- 6 — the stable public ref
-- ---------------------------------------------------------------------------
do $$
begin
  if (select ref from public.moments where id = 1) <> 'M-000001' then
    raise exception 'ASSERTION FAILED (clause 6): moment ref should be M-000001, got %',
      (select ref from public.moments where id = 1);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11.2 / R3 — the system never publishes. Publishing follows only from Josh marking a post ready.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.posts (moment_id, draft_id, body, status, published_at, scheduled_for)
    values (1, 1, 'body', 'published', now(), now());
    raise exception
      'ASSERTION FAILED (11.2/R3): a post reached published without Josh marking it ready';
  exception when check_violation then null;
  end;

  begin
    insert into public.posts (moment_id, draft_id, body, status, scheduled_for)
    values (1, 1, 'body', 'scheduled', now());
    raise exception
      'ASSERTION FAILED (11.2/R3): a post was scheduled without Josh marking it ready';
  exception when check_violation then null;
  end;

  begin
    insert into public.posts (moment_id, draft_id, body, status)
    values (1, 1, 'body', 'ready');
    raise exception 'ASSERTION FAILED (11.2/R3): ready status accepted with no marked_ready_at';
  exception when check_violation then null;
  end;
end $$;

-- The legitimate path must still work.
insert into public.posts (moment_id, draft_id, body, status, marked_ready_at, scheduled_for,
                          published_at, linkedin_urn)
values (1, 1, 'body', 'published', now() - interval '1 day', now(), now(), 'urn:li:share:1');

-- ---------------------------------------------------------------------------
-- 6.3 — nothing may be deleted by the system
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  begin
    delete from public.moments where id = 1;
    reset role;
    raise exception 'ASSERTION FAILED (6.3): service_role was able to delete a moment';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Clause 12 callout — the lived-experience test and the no-fabrication rule are never tunable
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.library_proposals (section_key, claim, evidence, proposed_body)
    values ('core_rules', 'engagement would improve without the lived-experience test',
            '{"posts":[1,2,3]}'::jsonb, 'anything goes');
    raise exception
      'ASSERTION FAILED (clause 12): the learning loop was able to propose against core_rules';
  exception when check_violation then null;
  end;
end $$;

-- A proposal against a tunable section must be accepted — "everything else can move".
insert into public.library_proposals (section_key, claim, evidence, proposed_body)
values ('hooks', 'the last six posts opening with a question underperformed the six opening with a scene',
        '{"question_hooks":[1,2,3],"scene_hooks":[4,5,6]}'::jsonb, '# Hook rules (revised)');

-- ---------------------------------------------------------------------------
-- 8.4 / 8.6 / 12.11 — versioned library, snapshot rolls forward on every change
-- ---------------------------------------------------------------------------
do $$
declare
  v_before int;
  v_after  int;
  v_sec    int;
begin
  select max(version) into v_before from public.library_versions;

  update public.library_sections set body = '# Pillars\n\nPositioning.' where key = 'pillars';

  select version into v_sec   from public.library_sections where key = 'pillars';
  select max(version) into v_after from public.library_versions;

  if v_sec <> 2 then
    raise exception 'ASSERTION FAILED (8.4): section version should bump to 2, got %', v_sec;
  end if;
  if v_after <= v_before then
    raise exception 'ASSERTION FAILED (8.6): library snapshot did not roll forward on edit';
  end if;
  if not exists (select 1 from public.library_section_versions
                 where key = 'pillars' and version = 2) then
    raise exception 'ASSERTION FAILED (12.12): no history row written, change is not reversible';
  end if;

  -- A no-op write must not manufacture a version.
  update public.library_sections set body = '# Pillars\n\nPositioning.' where key = 'pillars';
  if (select version from public.library_sections where key = 'pillars') <> 2 then
    raise exception 'ASSERTION FAILED (8.4): unchanged body bumped the version';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4.3.2 / 4.4.4 — only the automatic inputs may sit at half_mined
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.moments (source, status) values ('raw_capture', 'half_mined');
    raise exception 'ASSERTION FAILED (4.3.2): a raw capture was stored as half_mined';
  exception when check_violation then null;
  end;
end $$;

insert into public.moments (source, source_ref, status)
values ('claude_code', 'sess-abc', 'half_mined');

-- ---------------------------------------------------------------------------
-- 9.8 — three strikes and the moment parks
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.drafts (moment_id, version, attempt, body, framework, library_version, model)
    values (1, 99, 4, 'b', 'f', 1, 'claude-opus-5');
    raise exception 'ASSERTION FAILED (9.8): a fourth gate attempt was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 9.8 — parking requires a plain-language reason
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.moments (source, status) values ('raw_capture', 'parked');
    raise exception 'ASSERTION FAILED (9.8): a moment parked with no reason given';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4.1.2 — a voice note keeps the audio, not just the words
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.raw_inputs (moment_id, kind, transcript)
    values (1, 'voice', 'just the words');
    raise exception 'ASSERTION FAILED (4.1.2): a voice note was stored without its audio';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Queue — SKIP LOCKED claim is atomic and does not hand the same job out twice
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  perform public.enqueue('draft', '{"moment_id":1}'::jsonb);
  perform public.enqueue('draft', '{"moment_id":2}'::jsonb);

  select count(*) into n from public.claim_jobs('worker-a', array['draft'], 5);
  if n <> 2 then
    raise exception 'ASSERTION FAILED: claim_jobs returned % jobs, expected 2', n;
  end if;

  select count(*) into n from public.claim_jobs('worker-b', array['draft'], 5);
  if n <> 0 then
    raise exception 'ASSERTION FAILED: claim_jobs handed out already-claimed work (% rows)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4.2.6 — a question that does not land is rephrased, never retired
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'question_stats'
               and column_name in ('retired', 'is_retired', 'active')) then
    raise exception
      'ASSERTION FAILED (4.2.6): question_stats has a retire flag; questions must only be rephrased';
  end if;
end $$;

select 'all assertions passed' as result;
