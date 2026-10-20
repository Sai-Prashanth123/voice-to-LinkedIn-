-- "Take the shape. Never the words." (8.3), as something a machine can check.
--
-- The rule is the strongest one in CLAUDE.md about the eight reference writers and had nothing
-- mechanical behind it. The nine gate checks cannot help: _shared/views.ts withholds
-- `reference_posts` from the gating view on purpose, because a judge that has read another writer
-- starts measuring against their voice. So the rule rested on their text being absent from the
-- drafting prompt — and it is absent, until a session calls `get_reference_posts`, which CLAUDE.md
-- invites it to do. After that the words are in context and nothing downstream ever looks.
--
-- WHY HASHES AND NOT SENTENCES
--
-- Storing their sentences in order to catch their sentences would put the thing the design
-- withholds one join away from a drafter, and `reference-split.test.ts` would be right to fail the
-- build. A hash of a seven-word run cannot be read, quoted or paraphrased from. It answers the only
-- question being asked — has this exact run of words been seen before — and nothing else.
--
-- Seven words is long enough that ordinary English does not collide and short enough to catch a
-- lifted clause. Six catches idiom; eight lets a lightly reworded opening through.
--
-- WHY A TABLE AND NOT A FILE
--
-- It was a 4.4MB JSON file imported into the MCP tools, which is the honest way to make something
-- deploy rather than silently go missing on the connector. Supabase refuses a function over 5MB, so
-- that version shipped nowhere. A table is better anyway: the corpus grows, and an index in a file
-- needs a deploy to catch up while an index in a row does not. The check at `create_draft` sends
-- the hashes of the draft's own runs and asks which of them are known, so no part of this is ever
-- read back into a prompt.

create table if not exists public.reference_shingles (
  -- cyrb53 of a normalised seven-word run, base36, fixed width. See _shared/shingles.ts.
  hash text primary key,
  created_at timestamptz not null default now()
);

comment on table public.reference_shingles is
  'Hashed seven-word runs from the eight reference writers (8.3). Never their text: this exists so '
  'a draft that reuses one of their runs can be refused without the system holding a sentence of '
  'theirs. Written by scripts/build-reference-shingles.mjs, read by create_draft.';

alter table public.reference_shingles enable row level security;

-- SELECT only, and membership is all a drafter can learn: "is this run known". The connector cannot
-- enumerate the table into anything readable, and could not read a sentence out of it if it did.
grant select on public.reference_shingles to content_mcp;

create policy mcp_read on public.reference_shingles
  for select to content_mcp using (true);

-- Rebuilt wholesale after every scrape, so the builder needs to clear it. Nobody else does: a row
-- removed by hand would quietly stop catching one run with no record of why.
grant select, insert, delete on public.reference_shingles to service_role;
