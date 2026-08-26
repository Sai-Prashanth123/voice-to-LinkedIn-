-- 0024 — A DEFERRED REBUILD IS REMEMBERED, NOT JUST ANNOUNCED (clause 10)
--
-- The rebuild in `_shared/handlers/visual.ts` needs to SEE the image, and the OpenAI-compatible path
-- drops image blocks in `toOpenAIMessages`. On a provider that cannot carry one, the system told
-- Josh his image "will be rebuilt as soon as that is switched over" — and nothing kept that promise.
-- The job was marked done, no state remembered the image, and switching provider would not have
-- produced it.
--
-- So the deferral is recorded on the moment. `resumeDeferredVisuals` in worker-select sweeps it the
-- moment a vision-capable provider is configured, and clears it on success.
--
-- On `moments` rather than in a new table: it is one small fact about a moment, and clause 6 already
-- says everything about a moment hangs off it.
--
-- Written idempotently. This migration was applied to the live project before it was committed, so
-- it has to be safe to re-run against a database that already has the column.

alter table public.moments
  add column if not exists visual_pending jsonb;

comment on column public.moments.visual_pending is
  'Clause 10. The source path and intent of a rebuild waiting on a vision-capable model provider. '
  'Set when the rebuild is deferred, cleared when a visual is produced. Null means nothing waiting.';
