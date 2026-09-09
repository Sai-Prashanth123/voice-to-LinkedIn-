/**
 * The fourth input, without an installer.
 *
 * WHY THIS EXISTS ALONGSIDE cc-agent
 *
 * Clause 4.4 reads Claude Code sessions for content candidates. The agent that does it was built,
 * calibrated and documented — and never ran, because running it meant Josh installing Node, keeping
 * a folder somewhere permanent, pasting a service_role key and registering a scheduled task. Zero
 * candidates have ever arrived. The input looked finished and produced nothing.
 *
 * If Josh uses Claude Code at all — and the input is worthless if he does not — then the MCP server
 * is already on his machine, already has his credentials, and already runs as him. So this is the
 * same work with nothing to install.
 *
 * WHAT IS SHARED AND WHAT IS NOT
 *
 * The scan is IMPORTED from cc-agent/index.mjs, not reimplemented. That local filter is what keeps
 * 625 MB of logs and anything resembling client code off the wire (15.4), and a second copy of it
 * would drift silently — the reader would look fine and be sending more than it should. This file
 * decides only WHEN to scan and WHERE to put the result.
 *
 * WHY IT POSTS TO worker-triage RATHER THAN WRITING A MOMENT
 *
 * Two reasons, and the second is the one that matters.
 *
 * The role cannot: content_mcp has insert on drafts, gate_runs, library_proposals and visuals, and
 * `moments` is deliberately not among them.
 *
 * And worker-triage applies the SECOND filter and the hard daily cap. 4.4.3 says a version that
 * surfaces ten candidates a day is worse than none, because Josh stops reading them. The local pass
 * is a heuristic calibrated against somebody else's corpus; the server pass is the backstop for
 * when that heuristic is wrong. A tool that wrote straight to the bank would skip it.
 *
 * WHY IT REFUSES A PRIVILEGED KEY
 *
 * cc-agent's installer asks for the service_role key. It never needed one: worker-triage builds its
 * own admin client internally and the caller only has to satisfy verify_jwt, which the anon key
 * does. Since the whole point of doing this here is that nothing has to be installed, nothing
 * privileged should have to be pasted either — so a service key is refused rather than accepted
 * quietly and used for a job the public key can do.
 */

import { z } from "zod";
import { saveState, scan, send } from "../../cc-agent/index.mjs";

/**
 * What sort of key this is, without trusting its name.
 *
 * Supabase JWTs carry the role in the payload; the newer secret keys are prefixed instead. Both
 * shapes are checked because a project can be issuing either.
 */
export function keyKind(key) {
  if (typeof key !== "string" || key.length === 0) return "missing";
  if (key.startsWith("sb_secret_")) return "service_role";
  if (key.startsWith("sb_publishable_")) return "anon";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return String(payload.role ?? "unknown");
  } catch {
    return "unknown";
  }
}

/** Where the digests go, and with what. Never the key this server talks to Postgres with. */
function uploadCredentials() {
  const base = process.env.CONTENT_SYSTEM_URL ??
    (process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/functions/v1` : null);
  const key = process.env.CONTENT_SYSTEM_KEY ?? process.env.SUPABASE_ANON_KEY ?? null;

  // The key is judged BEFORE anything else is missing-checked, deliberately. Ordering these the
  // other way round meant "you have not set a URL" masked "you have handed me a key that bypasses
  // row-level security" — so whether the security refusal fired depended on an unrelated variable
  // happening to be set. A guard that reports only when the rest of the configuration is complete
  // is a guard that is silent exactly when someone is still setting things up.
  const kind = keyKind(key);
  if (kind === "service_role") {
    throw new Error(
      "CONTENT_SYSTEM_KEY is a service_role key and this refuses to use one. worker-triage " +
      "builds its own admin client and only requires a valid JWT, so the anon key is enough — " +
      "and a key that bypasses row-level security should not sit on a laptop to do a job the " +
      "public key can do.",
    );
  }

  if (!base || !key) {
    throw new Error(
      "Uploading needs CONTENT_SYSTEM_KEY (the project's anon / publishable key) in the MCP " +
      "server's environment, and a URL it can derive from SUPABASE_URL. Use dry_run to see what " +
      "would be sent without setting either.",
    );
  }

  return { url: base.replace(/\/+$/, ""), key, kind };
}

export const sessionTools = [
  {
    name: "scan_sessions",

    /*
     * THIS MACHINE ONLY. Dropped from the HTTP surface by http.mjs.
     *
     * It reads ~/.claude/projects, which over stdio is the caller's own machine and is the whole
     * point. Served remotely it would read the edge function's container and answer "nothing to
     * do" forever — indistinguishable from a real quiet result, which is worse than not offering
     * it at all.
     */
    localOnly: true,
    config: {
      title: "Scan Claude Code sessions for content candidates",
      description:
        "Read this machine's recent Claude Code sessions, keep only the genuinely unusual ones, " +
        "and send a digest of what was said and decided to the content system (clause 4.4). " +
        "Runs entirely locally: session logs never leave this machine, and the digest carries no " +
        "code and no tool output. Most sessions produce nothing, which is the intended result — " +
        "a version surfacing ten candidates a day is worse than none. Use dry_run first on a new " +
        "machine to see what the filter would pass before anything is sent.",
      inputSchema: {
        dry_run: z.boolean().optional()
          .describe(
            "Show what would be sent and send nothing. Leaves the seen-list untouched, so a real " +
            "run afterwards still has every session to look at. Default false.",
          ),
      },
    },

    async handler(args, _context) {
      const dryRun = args.dry_run === true;

      // Credentials are checked BEFORE the scan on a real run. Reading several hundred session
      // files and then discovering there is nowhere to send them wastes the work and, worse,
      // tempts a retry that scans them all again.
      const creds = dryRun ? null : uploadCredentials();

      const result = await scan();

      if (!result.available) {
        return {
          scanned: 0,
          note: `No Claude Code sessions at ${result.dir}. Nothing to do — this input only ` +
            `produces candidates on a machine where Claude Code is actually used.`,
        };
      }

      const { digests, skipped, overflow, allScores, state } = result;

      const summary = {
        sessions_changed: result.changed,
        passed_the_filter: digests.length,
        set_aside: skipped + overflow,
        held_back_by_the_cap: overflow,
        // The distribution is how the threshold was chosen, and how it should be re-chosen against
        // this machine's sessions rather than assumed. eval/calibrate-cc.mjs prints it in full.
        scores_seen: allScores.length,
        highest_score: allScores.length > 0 ? Math.max(...allScores) : null,
      };

      if (dryRun) {
        return {
          ...summary,
          dry_run: true,
          would_send: digests.map((d) => ({
            session_id: d.session_id,
            score: d.score,
            started_at: d.started_at,
            preview: String(d.digest).slice(0, 600),
          })),
          note: digests.length === 0
            ? "Nothing passed the filter. On most days that is correct. If it is never anything, " +
              "run eval/calibrate-cc.mjs — the default threshold was set against a corpus that is " +
              "not this machine's."
            : "Nothing was sent and the seen-list is unchanged. Run again without dry_run to send.",
        };
      }

      if (digests.length === 0) {
        // Still mark them seen: they were read and judged, and re-reading them tomorrow would cost
        // the same and reach the same answer.
        saveState(state);
        return { ...summary, sent: 0, note: "Nothing was interesting enough to send." };
      }

      await send(digests, { url: creds.url, key: creds.key });
      saveState(state);

      return {
        ...summary,
        sent: digests.length,
        sent_as: creds.kind,
        note: "worker-triage applies a second filter and a daily cap, so fewer than this may " +
          "reach the idea bank. Anything that does needs Josh interviewed before it can be drafted.",
      };
    },
  },
];
