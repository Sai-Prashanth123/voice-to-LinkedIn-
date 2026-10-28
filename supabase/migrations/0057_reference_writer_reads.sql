-- A home for a structural reading of one reference writer, which is NOT a drafting section.
--
-- WHY THIS SECTION EXISTS
--
-- `scripts/matt-barker-structure.mjs` spliced a deep structural read of Matt Barker into
-- `reference_posts` on 20 October. It was 8,287 of that section's 10,924 characters, and
-- `reference_posts` is in `DRAFTING_SECTIONS` — so one writer's shape shipped on EVERY drafting
-- brief, whichever handle had been passed and whether one had been passed at all. A control run
-- with no handle read it as its shape target.
--
-- That is Josh's recorded complaint that "the default framework gets used anyway", arriving as the
-- mechanism rather than as a symptom: the cadence clause 8.3 names as the most likely to leak was
-- the default shape target, and a draft that agrees with Matt proves nothing about Josh's voice.
--
-- WHY A SECTION RATHER THAN DELETING IT
--
-- The read is good work and Josh asked for it — "lean most into Matt Barker, his frameworks,
-- structures and methods, in my voice". What was wrong was its reach, not its content. A drafter
-- that has been handed a handle gets that writer's measured shape through `writerShapeBlock` in
-- `mcp-server/tools/voice.mjs`, with the one exclusion that must never be dropped — the
-- renamed-problem turn — carried in the same object. This section is where the fuller reading lives
-- for Josh to read and for that channel to draw on.
--
-- WHY IT IS SAFE: IT IS IN NO VIEW, AND THAT IS THE DEFAULT RATHER THAN A RULE
--
-- `renderLibrary` in `supabase/functions/_shared/views.ts` filters by `wanted.has(row.key)`. A key
-- that appears in no entry of `VIEWS` reaches no prompt — not the drafter's, not the gate's, not the
-- interview's, not the visual one. So this needs no exclusion to be maintained and no list to be
-- kept in sync; it is invisible unless somebody deliberately adds it, and the note in views.ts says
-- why nobody should.
--
-- 12.10 is untouched. This seeds an EMPTY section. The reading reaches it the way every other change
-- to the library reaches it: as a `library_proposals` row that Josh approves.

insert into library_sections (key, title, body, sort_order, immutable)
values (
  'reference_writer_reads',
  'Structural readings of individual reference writers (not a drafting section)',
  '',
  132,
  false
)
on conflict (key) do nothing;
