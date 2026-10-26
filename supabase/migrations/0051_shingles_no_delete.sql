/*
 * Take DELETE on reference_shingles back off service_role.
 *
 * 0050 granted `select, insert, delete` so the builder could replace the index wholesale. That
 * broke a guarantee Josh has in writing, and the e2e harness caught it: S0-04 "no application role
 * can delete or truncate anything" and S3-04 both went red against
 *
 *   [{"table":"reference_shingles","grantee":"service_role","privilege":"DELETE"}]
 *
 * The builder's reason for wanting it was stated and is real as far as it goes: "a run that is no
 * longer anywhere in the corpus must stop being a borrowing, or an index built today would keep
 * refusing drafts on the strength of a post that was removed months ago."
 *
 * But a post cannot be removed. 0046 revoked DELETE on reference_writer_posts from every role, for
 * the same reason this migration exists. So the corpus only ever grows, and the case the delete was
 * protecting against cannot arise that way.
 *
 * WHAT IS GIVEN UP, SAID PLAINLY
 *
 * One narrow case remains: `load-reference-posts.mjs` upserts on activity_id with
 * merge-duplicates, so a re-scrape CAN change a stored post's `text`. Shingles from the old wording
 * would then linger in the index, and a draft could be refused for a run nobody holds any more.
 *
 * That is accepted rather than hidden, for three reasons. It is rare — it needs the same post to
 * come back worded differently. The failure is visible: the refusal quotes the exact run, so a
 * human reading it can see the draft does not borrow anything. And it is recoverable the way every
 * other irreversible change in this repository is recoverable — by a migration, which is a
 * deliberate act with a name on it, rather than by a script holding a standing permission to empty
 * a table.
 *
 * A standing DELETE grant is a worse trade than a rare false positive with a legible message.
 */

revoke delete on public.reference_shingles from service_role;

comment on table public.reference_shingles is
  'Hashed seven-word runs from the eight reference writers (8.3). Append-only: no role holds '
  'DELETE, and the corpus it derives from is append-only too (0046). Rebuilt by '
  'scripts/build-reference-shingles.mjs, which inserts with merge-duplicates and is idempotent. '
  'Emptying it is a migration, not a script.';
