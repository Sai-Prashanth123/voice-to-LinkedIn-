-- 0031 — LETTING CLAUDE CODE REBUILD A DIAGRAM
--
-- Clause 10 rebuilds an image Josh has seen into his own visual brand, as an SVG. Component test 10
-- wants five of them and the system has built one, because every rebuild spends a model on a task
-- that Claude Code can do directly and well.
--
-- 0028 gave `content_mcp` select on `visuals` and no way to write one. This adds the fourth insert,
-- and nothing else.
--
-- WHY A FOURTH INSERT IS ACCEPTABLE WHERE A FIRST UPDATE WOULD NOT BE
--
-- The shape of 0028's grant is that this role may CREATE records and never alter them: a draft is
-- superseded by a new version rather than edited, and a gate verdict that could be rewritten is not
-- a record of anything. `visuals` already works the same way — 10.6 offers Josh another version, and
-- the table carries `unique (moment_id, version)` to make that a new row rather than an overwrite.
--
-- So this stays inside the existing rule. There is still no UPDATE and no DELETE anywhere for this
-- role, and nothing here lets it approve, schedule, publish or touch the library.
--
-- WHAT IT STILL CANNOT DO
--
-- Attach a visual to a post. `posts.visual_id` is on `posts`, which `content_mcp` may read and not
-- write. A rebuilt image therefore sits in the bank until Josh's own calendar path picks it up —
-- which is 11.3's job and remains his.

grant insert on public.visuals to content_mcp;
grant usage, select on sequence public.visuals_id_seq to content_mcp;

drop policy if exists mcp_insert on public.visuals;
create policy mcp_insert on public.visuals
  for insert to content_mcp with check (true);

comment on table public.visuals is
  'Clause 10. Rebuilt diagrams, one row per version — 10.6 means another attempt is a new row, not '
  'an edit. Written by handlers/visual.ts and, since 0031, by the MCP server so Claude Code can '
  'produce the SVG directly. Never attached to a post from here: posts.visual_id is Josh''s (11.3).';
