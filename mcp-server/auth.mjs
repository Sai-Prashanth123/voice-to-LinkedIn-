/**
 * Who may call the content system over HTTP, and what they may do with it.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Over stdio there is no auth question: the server runs as a child process of the person who
 * started it, on their machine, reachable by nothing. Put the same 24 tools on a URL and the only
 * thing between them and the internet is this file.
 *
 * TWO TOKENS, NOT ONE
 *
 * A read token reaches the reads and the briefs. A write token reaches those plus create_draft,
 * submit_extraction, submit_candidates, record_gate_verdict and propose_library_change. That split
 * costs almost nothing and means access to LOOK can be handed out without access to WRITE — which
 * is most of what remote access is actually wanted for.
 *
 * It limits what a legitimate holder can do. It does not limit what a compromised one can reach:
 * behind both tokens sits one database, one library and 27 policies that ask "are you signed in"
 * rather than "is this yours". Scoping is not tenancy and must not be mistaken for it.
 *
 * WHY THE COMPARISON IS TIMING-SAFE
 *
 * `a === b` on a secret returns as soon as two bytes differ, and the time it took says how many
 * matched. That is a real attack on a public URL and a pointless one to leave open, since the fix
 * is one function from a standard library.
 */

import { timingSafeEqual } from "node:crypto";
// Explicitly imported rather than taken as a global. `Buffer` is ambient in Node and NOT in Deno,
// so relying on the global worked on a laptop and threw on every request in the deployed function —
// turning "that token is not recognised" into an opaque 500. Found by probing the live endpoint,
// which is the only place the difference exists.
import { Buffer } from "node:buffer";

/** Tool names that change something. Everything else is a read. */
export const WRITE_TOOLS = new Set([
  "create_draft",
  "record_gate_verdict",
  "propose_library_change",
  "create_visual",
  "submit_extraction",
  "submit_candidates",
  // The interview, from a surface that is not Telegram. Both write turns to the idea bank.
  "capture_thought",
  "answer_interview",
  "name_idea",
  "scan_sessions",
  // Returns a command that installs a scheduled reporter holding this token.
  "setup_session_tracking",
]);

/**
 * The hints a client uses to decide what to auto-approve.
 *
 * DERIVED FROM WRITE_TOOLS, NOT HAND-LABELLED
 *
 * Two lists of "which tools write" would be two lists that eventually disagree, and the symptom
 * would be a client silently auto-approving something that writes to Josh's bank. So there is one
 * list and this reads it.
 *
 * `destructiveHint: false` is true of EVERY tool here and is not a nicety: 6.3 is a revoked grant
 * rather than a policy, and neither the scoped role nor service_role holds DELETE or TRUNCATE on
 * any table. Nothing this server can do is destructive, and saying so lets a client treat a
 * refusable write differently from an irreversible one.
 *
 * idempotentHint is deliberately omitted rather than guessed. create_draft is not idempotent;
 * record_gate_verdict is, because it refuses to overwrite a verdict. Claiming it wrongly would be
 * worse than leaving a client to ask.
 */
export function annotationsFor(name) {
  return {
    readOnlyHint: !WRITE_TOOLS.has(name),
    destructiveHint: false,
  };
}

/**
 * Constant-time string comparison.
 *
 * Length is compared first and NOT in constant time, which is deliberate and safe: token length is
 * not a secret, and timingSafeEqual throws on a length mismatch rather than returning false.
 */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * What this request is allowed to do.
 *
 * @returns {{ ok: true, scope: "read"|"write" } | { ok: false, status: number, error: string }}
 */
export function authorise(headerValue, env = process.env) {
  const readToken = env.MCP_READ_TOKEN ?? "";
  const writeToken = env.MCP_WRITE_TOKEN ?? "";

  // FAILS CLOSED. With neither token configured this refuses everything rather than accepting
  // everything — the exact inversion that made the desk's own middleware let every signed-in user
  // through for months, which its comments now describe at length.
  if (readToken.length === 0 && writeToken.length === 0) {
    return { ok: false, status: 503, error: "No MCP tokens are configured, so nothing is accepted." };
  }

  const presented = String(headerValue ?? "").replace(/^Bearer\s+/i, "").trim();
  if (presented.length === 0) {
    return { ok: false, status: 401, error: "Authorization: Bearer <token> is required." };
  }

  // Write is checked first so a token that is somehow both resolves to the greater scope rather
  // than to whichever comparison happened to run first.
  if (writeToken.length > 0 && sameSecret(presented, writeToken)) {
    return { ok: true, scope: "write" };
  }
  if (readToken.length > 0 && sameSecret(presented, readToken)) {
    return { ok: true, scope: "read" };
  }

  return { ok: false, status: 401, error: "That token is not recognised." };
}

/** The tools a scope may call. */
export function toolsForScope(tools, scope) {
  if (scope === "write") return tools;
  return tools.filter((t) => !WRITE_TOOLS.has(t.name));
}

/**
 * Refusing a write on a read token.
 *
 * Returned as a tool error rather than silently hiding the tool, because a model told "that tool
 * does not exist" will try to achieve the same thing another way. Told "you are on a read token"
 * it stops and says so, which is the outcome a person actually wants.
 */
export function refuseWrite(name) {
  return new Error(
    `${name} changes something, and this connection is authorised to read only. ` +
    `Nothing was written. A write token is needed for this tool.`,
  );
}
