/*
 * `not_a_name` is a legal kind. The live database has always known that and no migration said so.
 *
 * WHAT WAS WRONG
 *
 * `0002_idea_bank.sql:80` declares:
 *
 *     kind text not null check (kind in ('person', 'company'))
 *
 * The live constraint, read off `pg_constraint` on 28 October 2026, is:
 *
 *     CHECK ((kind = ANY (ARRAY['person'::text, 'company'::text, 'not_a_name'::text])))
 *
 * No migration in this repository widens it. Every `alter` and `check` touching `moment_names` was
 * grepped: the only other hit is RLS in `0006_security.sql`. So the live schema was widened out of
 * band, and the repository has been describing a database that does not exist for as long as the
 * third value has.
 *
 * WHY IT IS NOT COSMETIC
 *
 * ELEVEN call sites filter on it — `names.ts:116,160,198`, `write.mjs:289`, `read.mjs:175`,
 * `inspect.mjs:179`, `brief.mjs:219,513`, `resources.mjs:130`, `acceptance-data.ts:102`,
 * `eval/gather.mjs:112` — all of them `.neq("kind", "not_a_name")`, and all of them correct: three
 * live rows carry it ("Josh", "CFO", "CFO", recorded on 24 August before `isRealName` existed), and
 * `names.ts:115` explains it as "Roles recorded before the filter existed."
 *
 * Nothing in the codebase ever WRITES that value. It was applied by hand, to data that was already
 * wrong, to stop three non-names being put to Josh for clearance. That was the right call. It was
 * never written down.
 *
 * WHAT BREAKS WITHOUT THIS, AND IT IS THE THING WE ARE ABOUT TO DO
 *
 * A fresh clone applies the migrations and then restores `data/local` through `local/load.mjs`.
 * Under `0002`'s constraint, the three `not_a_name` rows in `data/local/moment_names.jsonl` are
 * REJECTED — and the loader refuses a partial table rather than appending, so the restore fails on
 * `moment_names` and the clone comes up with no name guard at all. The guarantee that would be
 * missing is the one this week has been spent on.
 *
 * It is also the fourth instance this week of the same defect class, and the most quietly dangerous
 * of them: the migrations and the database disagreed, every test passed, and the disagreement was
 * invisible until something tried to build the schema from scratch. "It works on the live project"
 * and "the repository describes the live project" are different facts, and only the second one
 * survives a clone.
 *
 * IDEMPOTENT ON PURPOSE
 *
 * On the live project this is a no-op that writes itself into the migration ledger, which is the
 * point: the ledger is what a fresh build reads. On a fresh build it is the thing that makes the
 * restore possible. Either way the end state is one constraint, spelled the same way in both
 * places.
 *
 * `0002` IS NOT EDITED. It has shipped, and CLAUDE.md says never to edit one that has.
 */

alter table public.moment_names
  drop constraint if exists moment_names_kind_check;

alter table public.moment_names
  add constraint moment_names_kind_check
  check (kind in ('person', 'company', 'not_a_name'));

comment on column public.moment_names.kind is
  'person | company | not_a_name. The third is applied by hand to rows that were recorded as names '
  'before isRealName existed — three of them, on 24 August 2026 ("Josh", "CFO", "CFO") — and eleven '
  'read sites filter it out so Josh is never asked to clear something that is not a name. Nothing '
  'in the codebase writes it. Added to the migrations on 28 October 2026, having existed in the '
  'live database for weeks without any migration declaring it: a fresh build rejected the rows that '
  'the live project holds.';
