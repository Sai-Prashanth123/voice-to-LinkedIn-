-- 0033 — claims_verified stops meaning "nobody looked"
--
-- WHAT WENT WRONG
--
-- 0003 declared this column as a plain nullable boolean: "set by the deterministic verifier, not a
-- model". Two writers set it and a third did not. handlers/draft.ts wrote verification.ok on all 19
-- drafts it produced. mcp-server's create_draft never ran the verifier at all, stored its ledger in
-- a shape verifyDraft cannot read a single field of, and left this column null on 2 of 2.
--
-- Null and false are not the same fact, and only one of them was ever visible. A reader looking at
-- the drafts table saw a column that was mostly populated and did not distinguish "checked and
-- clean" from "nobody ever checked". Clause 9.4 is the rule the build allows zero tolerance on at
-- acceptance, and on the Claude Code path it was held up by nothing but the writer being careful.
--
-- The code fix is in mcp-server/tools/write.mjs. This is the half that makes the column unable to
-- carry the ambiguity again.
--
-- ── Why a default and not NOT NULL ────────────────────────────────────────────────────────────
--
-- NOT NULL is the constraint this deserves, and it cannot be had cheaply. Three rows are null and
-- 6.3 forbids deleting them to make room. A NOT VALID check would exempt those three and bind
-- everything after, which is the right shape — but eight fixture inserts across eval/e2e and
-- supabase/tests omit the column entirely, so it would fail the harness rather than the bug.
--
-- A default of false binds every one of those writers instead, costs nothing, and fails in the safe
-- direction: an insert that does not say the ledger was checked now records that it was not, rather
-- than recording nothing. Metadata only — no rewrite, no existing row touched.

alter table public.drafts alter column claims_verified set default false;

comment on column public.drafts.claims_verified is
  'Did the deterministic claim ledger (9.4) verify? Set by verifyDraft, never by a model. '
  'Defaults to false so a writer that omits it records "not known to hold" rather than nothing. '
  'Three rows predate this and are null, meaning the check never ran on them: drafts 51 and 52 '
  'from before mcp-server ran the verifier, and one test fixture. Null is not a verdict.';
