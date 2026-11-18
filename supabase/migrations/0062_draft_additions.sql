-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- What a draft added that he did not say, recorded per draft and read back before he approves.
--
-- Josh, 18 November 2026, after thirteen days on the 5 November build:
--
--   "The no-invention rule still stops posts before the review sees them... on 12 November Claude
--    wouldn't write a pros and cons post until I supplied the pros and cons, and when I said 'you
--    can add this' on the next one, it asked me to pick from options instead. Neither got as far as
--    the review. I want Claude to add detail, examples and argument I haven't given, and to fill a
--    gap when I say it can. Mark each addition in the ledger and read them back to me before I
--    approve, so I'm checking them rather than being blocked by them. Keep a hard line on numbers,
--    quotes and client names if you think it's needed."
--
-- `drafts.claims` cannot carry this. Its entries require a `source_span` that is checked as a
-- verbatim substring of a named entry field, so a claim resting on nothing is not expressible
-- there — which is why the two posts above were refused before the gate ever saw them rather than
-- being flagged for him.
--
-- WHY A SECOND COLUMN AND NOT A FLAG ON THE CLAIM
--
-- Because the point of it is to be READ. `claims` is machinery: it is written by the drafter,
-- verified mechanically, and nothing surfaces it to Josh. This is the opposite — a short list, in
-- plain words, that `list_calendar` puts ahead of the post body so he reviews the additions rather
-- than discovering them. A value nothing reads is this repository's signature defect, and the
-- version of this change that stored additions inside `claims` would have been exactly that.
--
-- Per-draft, on the `gate_advisory` precedent above (0047): a rewrite is a new draft row, so what
-- the previous attempt added cannot follow a post he has already read, and a draft filed before
-- this column existed reads as `[]` rather than as unknown.
--
-- R2 IS NOT TOUCHED BY THIS. Every factual claim, quote, number and name still has to trace, and
-- `claims.ts` refuses an addition that carries a figure, a quotation, an uncleared name, or a new
-- first-person claim about something Josh did, saw or was told. What changes is that an argument is
-- no longer treated as a claim about the world. The core rules live in an immutable library section
-- and are his alone; nothing here proposes against them.

alter table public.drafts
  add column if not exists additions jsonb not null default '[]'::jsonb;

-- Same guard `claims` carries (0003): an object or a scalar here would break every reader.
alter table public.drafts
  drop constraint if exists drafts_additions_is_array;
alter table public.drafts
  add constraint drafts_additions_is_array
  check (jsonb_typeof(additions) = 'array');

comment on column public.drafts.additions is
  'What the drafter supplied that rests on nothing Josh said: argument, an implication, a general '
  'example. Each entry carries the claim and a one-line reason, and list_calendar reads them out '
  'ahead of the body so he checks them before approving. An empty array means the post rests '
  'entirely on his own material, which is a different fact from never having been checked. '
  'Numbers, quotes, client names and first-person accounts are refused outright by claims.ts and '
  'never appear here. Added 18 November 2026 at his request.';
