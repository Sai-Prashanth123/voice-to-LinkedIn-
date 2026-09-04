-- 0030 — the column production has and the migrations did not.
--
-- HOW THIS WAS MISSED, AND WHY IT MATTERED
--
-- `posts.announced_at` exists on the live project and is read and written by worker-dispatch:
-- `notifyDraftReady()` marks it after sending a draft, and `sendDraftDigest()` selects on it being
-- null so a draft is announced once rather than on every sweep. It was added straight to the
-- database during development and never written down as a migration.
--
-- Nothing noticed, because nothing compares the two. `run-migrations.sh` proved the migrations
-- apply cleanly to an empty database — which they do — and the live system worked, because it had
-- the column. Both halves were fine. Only the relationship between them was wrong, which is the
-- same shape as every other bug found in this build.
--
-- The consequence was reserved entirely for handover. Clause 14.1 moves everything into Josh's
-- account, and `docs/04-handover.md` is written from a rehearsal of exactly this migration
-- sequence. That rebuild would have produced a database with no `posts.announced_at`, and the first
-- draft to reach the calendar would have failed to announce itself — Josh would never have been
-- told a post was ready, and the queue would have looked healthy throughout.
--
-- Found by eval/e2e on its first full run, comparing the schema the migrations build against the
-- schema that is actually deployed.

alter table public.posts
  add column if not exists announced_at timestamptz;

comment on column public.posts.announced_at is
  'When Josh was told this draft exists. Null means not yet announced, which is what the digest '
  'selects on — set by both the immediate and the batched path so switching draft_delivery '
  'mid-week cannot announce the same draft twice.';

-- The digest reads `status = 'draft' and marked_ready_at is null and announced_at is null` on every
-- sweep. Partial, because an announced post is never of interest to it again.
create index if not exists posts_unannounced_idx
  on public.posts (id)
  where announced_at is null;
