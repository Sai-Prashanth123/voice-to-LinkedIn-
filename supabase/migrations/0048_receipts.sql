-- 0048 — receipts: the things about himself a post may rest on
--
-- WHY THIS SECTION DID NOT EXIST, AND WHY THAT COST SOMETHING
--
-- data/josh/law/receipts.md has been in the repository since the law set was built, and it says in
-- its own text that it may be used as a source. The live library had fourteen sections and receipts
-- was not one of them, so the server refused every claim that rested on it — not by deciding
-- against it, but by never having heard of it. A file nobody loaded, asserting a permission nobody
-- implemented.
--
-- The effect on his drafts was specific. A claim may only cite a named source, the named sources
-- were the ten fields of one interview, and so a post could state nothing about his career, his
-- method or his numbers unless he happened to repeat it in the message he was writing from. "Write
-- about why tool-built TAMs miss SMB" was refused with "not enough to write from" while a file of
-- exactly that material sat on disk.
--
-- WHAT THIS IS NOT
--
-- It is not a licence to invent. Every claim resting on this section is still checked word for word
-- against it, the same as every claim resting on the ten fields — see `verifyDraft`. What changes is
-- where a true thing may come from, not whether it has to be true.
--
-- It is also not the published archive, which clause 8a keeps out of drafting for good: the archive
-- was written with heavy AI help and has drifted from how he sounds. This is what he has TOLD us,
-- not what was posted under his name.
--
-- Seeded as a placeholder. `isSupplied` reads the FOR JOSH head as empty, so until the real file is
-- loaded this section contributes nothing and no claim can rest on it — which is the correct
-- behaviour for a section nobody has filled in yet.

insert into public.library_sections (key, title, body, sort_order)
values (
  'receipts',
  'Receipts (his career, method and numbers)',
$$# Receipts

FOR JOSH. The things about you that a post may state as fact without you repeating them every time:
your career, your method, and the numbers you have actually run.

This is a SOURCE, not a rule. Nothing here tells the writer how to write. It tells the writer what
is true, so that a post about your method does not have to be assembled from scratch out of one
message.

## What belongs here

- What you have done, with dates. Roles, how long, what you were responsible for.
- How you work. The method, named plainly, the way you would explain it to a client.
- Numbers you have run yourself, with what they cover and when you ran them.
- Positions you hold and would defend, in your words rather than ours.

## What does not

- Anything you have not said. This file is quoted verbatim by the claim check, so a sentence written
  into it on your behalf becomes a fact a post can assert under your name.
- Client names and client numbers. Those live against the moment they came from, with their own
  clearance, because permission is per post.
- Anything from your LinkedIn archive. Clause 8a keeps it out of drafting.

## How it is used

A draft may cite this section the same way it cites the material from an interview: by naming it and
copying the span word for word. If the span is not here, the claim is refused and nothing is stored.

Load it with: node scripts/load-receipts.mjs --apply
$$,
  115
)
on conflict (key) do nothing;
