-- Two tables had a grant and no policy, which is a read that silently returns nothing.
--
-- `notices` (0042) and `reference_writer_posts` (0044) were both added with row-level security on
-- and a SELECT grant to `content_mcp`, but no policy naming that role. A grant gets you to the
-- table; the policy decides which rows you see. With none, the answer is none.
--
-- Nobody noticed because the hosted connector falls back to the service role when no scoped key
-- exists, and the service role bypasses RLS entirely. So both tables read perfectly all session.
-- The day a scoped key is minted, `get_reference_posts` returns an empty list and Matt Barker goes
-- dark — which is the exact complaint this corpus was stored to answer — and `unread_notices`
-- returns nothing, so `/waiting` reports all clear forever, which is worse than an error.
--
-- Found on 9 October while minting that key, by auditing grants against policies rather than by
-- the feature breaking in front of Josh.
--
-- SELECT only. These two are read-only to the connector: notices are written by the workers and
-- marked read through `cc-submit`, and reference posts are loaded by a script running as the
-- service role. Nothing here gives the connector a way to write.

create policy mcp_read on public.notices
  for select to content_mcp using (true);

create policy mcp_read on public.reference_writer_posts
  for select to content_mcp using (true);
