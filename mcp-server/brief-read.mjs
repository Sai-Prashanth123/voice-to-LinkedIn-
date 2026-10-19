/**
 * "The standard was read for this moment", recorded where the write door can see it.
 *
 * WHY THIS IS NOT A HOOK
 *
 * The writing order is guarded locally by .claude/hooks/writing-order.mjs, which runs only in a
 * clone of this repo with Claude Code and fails open by design. Josh works through the hosted
 * connector, where it does nothing at all. Two of the four steps were already enforced durably by
 * the server — fileDraft refuses a moment that was never mined, and submit_extraction verifies
 * spans against a source rebuilt from the database — but nothing recorded whether the BRIEF had
 * been read, so create_draft could not refuse a draft written against no standard. That is the
 * 14 October failure: the voice files were read off disk instead, three of them were missed, and
 * nothing objected.
 *
 * WHY IT POSTS RATHER THAN INSERTING
 *
 * content_mcp holds insert on drafts, gate_runs and library_proposals and nothing else (0028), so
 * it cannot write system_events even if it wanted to. That is the right boundary and the repo's own
 * convention: write through cc-submit. The guard then lives behind the write door as service_role,
 * which is why it cannot fail open the way the hook can.
 *
 * A FAILED RECORD MUST NEVER COST SOMEONE THE BRIEF. The brief is the work; this is bookkeeping.
 * So every error here is swallowed deliberately — the consequence of losing one is a refusal at
 * create_draft naming the brief to read, which is recoverable in one call.
 */
export async function recordBriefRead(momentId, which, { url, key: contextKey }) {
  const key = contextKey ?? process.env.CONTENT_MCP_KEY;
  if (!key || !url || !Number.isInteger(momentId)) return;

  try {
    await fetch(`${url}/functions/v1/cc-submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "brief_read", moment_id: momentId, which }),
    });
  } catch {
    // Deliberately silent. See the note above.
  }
}
