#!/usr/bin/env node
/**
 * Put Josh's call transcripts into the idea bank (clause 4.3).
 *
 *   node scripts/ingest-transcripts.mjs            # show what would be sent
 *   node scripts/ingest-transcripts.mjs --apply    # send them
 *   node scripts/ingest-transcripts.mjs --apply --include-held   # also the 31 August call
 *
 * WHY THIS EXISTS
 *
 * Six real call transcripts arrived on 7 September and were used for exactly one thing: deriving
 * the voice guide. That is evidence of how Josh SOUNDS. It is not the same as mining them for
 * moments, which is what 4.3 is actually about, and which nothing had done — the newest moment in
 * the bank was from 31 August, and `raw_inputs` had not grown since.
 *
 * Six calls of Josh losing a deal, turning work down, qualifying a prospect out and sitting in a
 * room he does not chair is the richest material this system has ever been offered, and it was
 * sitting on disk.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not create material, and it must not. `transcript-webhook` enqueues a `triage_digest`
 * job; `worker-triage` turns that into `half_mined` moments and nothing further. 4.3.3 is explicit:
 * a candidate cannot be drafted until Josh has been interviewed about it. The database agrees —
 * `moments_half_mined_is_automatic` restricts that status to the three automatic sources, and the
 * selector only ever picks up `mined`.
 *
 * So the honest description of this script is: it gives Josh things to be asked about.
 *
 * THE ONE HELD BACK
 *
 * 2026-08-31 keeps its clinical vertical language. Josh's own README says anyone in that market
 * could infer the client, and he has not yet answered whether to use four calls or five. Clause 6.3
 * means nothing is ever deleted — only killed and labelled — so ingesting it before he answers
 * cannot be undone, only annotated. It waits behind --include-held.
 *
 * IDEMPOTENT
 *
 * The webhook dedupes twice: on `jobs.dedupe_key` (which carries a unique constraint) and on an
 * existing `moments` row with the same `source_ref`. Re-running is safe and reports `duplicate`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TRANSCRIPTS = join(ROOT, "docs", "from-josh", "transcripts");

/** Held until Josh rules on it. See the note above. */
const HELD = "2026-08-31-client-internal-list-building.md";

const APPLY = process.argv.includes("--apply");
const INCLUDE_HELD = process.argv.includes("--include-held");

/* ── Credentials ──────────────────────────────────────────────────────────── */

function credentials() {
  let file = "";
  try {
    file = readFileSync(join(ROOT, "eval", ".env"), "utf8");
  } catch { /* environment only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();

  const url = field("SUPABASE_URL");
  const key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or fill in eval/.env.");
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/**
 * The webhook's shared secret, read from the vault rather than asked for.
 *
 * It is never printed, never logged and never written anywhere. `read_secrets()` is service_role
 * only by grant (migration 0014), which is the identity this script already holds.
 */
async function webhookSecret(url, key) {
  const res = await fetch(url + "/rest/v1/rpc/read_secrets", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    console.error("Could not read the vault: " + res.status + " " + (await res.text()).slice(0, 200));
    process.exit(1);
  }
  const rows = await res.json();
  const row = (rows ?? []).find((r) => r.name === "TRANSCRIPT_WEBHOOK_SECRET");
  return row?.value ?? null;
}

/* ── Reading the transcripts ──────────────────────────────────────────────── */

/**
 * Strip the YAML frontmatter the exports carry, and take a title from it if there is one.
 *
 * The body is sent whole. The webhook caps the digest at 50,000 characters and the triage model
 * sees 60,000, so a 38 KB transcript arrives complete — but a longer one would be cut, and that is
 * worth knowing rather than discovering later.
 */
function readTranscript(name) {
  const raw = readFileSync(join(TRANSCRIPTS, name), "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = fm ? raw.slice(fm[0].length) : raw;

  const meta = {};
  for (const line of (fm?.[1] ?? "").split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, "").trim();
  }

  return {
    // The filename is the stable identity. It is what makes a re-run a duplicate rather than a
    // second copy, so it must not be derived from anything that could change between runs.
    id: "josh-call-" + name.replace(/\.md$/, ""),
    title: meta.type ? `${meta.type} — ${name.slice(0, 10)}` : name.replace(/\.md$/, ""),
    created_at: /^\d{4}-\d{2}-\d{2}/.test(name) ? name.slice(0, 10) : null,
    participants: (meta.participants ?? "")
      .replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean),
    transcript: body.trim(),
  };
}

/* ── Sending ──────────────────────────────────────────────────────────────── */

async function main() {
  let names;
  try {
    names = readdirSync(TRANSCRIPTS).filter((n) => n.endsWith(".md")).sort();
  } catch {
    console.error("No transcripts at " + TRANSCRIPTS);
    process.exit(1);
  }

  const chosen = names.filter((n) => INCLUDE_HELD || n !== HELD);
  const calls = chosen.map(readTranscript);

  console.log("\n  Call transcripts into the idea bank (4.3)\n");
  console.log("  " + "─".repeat(72));
  for (const c of calls) {
    const chars = c.transcript.length;
    console.log(
      "  " + (chars >= 200 ? "ok " : "!! ") + c.id.padEnd(52) +
        String(chars).padStart(6) + " chars" + (chars > 50_000 ? "  (digest will be cut)" : ""),
    );
  }
  if (!INCLUDE_HELD && names.includes(HELD)) {
    console.log("\n  held back: " + HELD);
    console.log("            Josh has not yet said four calls or five. --include-held overrides.");
  }

  // Under 200 characters the webhook returns 200 with {ignored:true} and does nothing at all. A
  // silent no-op is worse than an error, so it is caught here instead.
  const tooShort = calls.filter((c) => c.transcript.length < 200);
  if (tooShort.length > 0) {
    console.error("\n  " + tooShort.length + " transcript(s) under 200 chars would be silently ignored.");
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\n  Dry run. Nothing sent. Re-run with --apply.\n");
    return;
  }

  const { url, key } = credentials();
  const secret = await webhookSecret(url, key);
  if (!secret) {
    console.error("\n  TRANSCRIPT_WEBHOOK_SECRET is not in the vault. Refusing to send.");
    console.error("  The webhook accepts anything when that secret is unset — do not use that.\n");
    process.exit(1);
  }

  const endpoint = url + "/functions/v1/transcript-webhook";

  console.log("\n  " + "─".repeat(72));
  let sent = 0, duplicate = 0, ignored = 0, failed = 0;

  for (const call of calls) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": secret,
        // The function is deployed with JWT verification on, so the platform gate needs satisfying
        // before the function's own shared-secret check is ever reached.
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify(call),
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.log("  FAIL      " + call.id + "  " + res.status + " " + JSON.stringify(body).slice(0, 120));
      failed += 1;
    } else if (body.duplicate) {
      console.log("  already   " + call.id);
      duplicate += 1;
    } else if (body.ignored) {
      console.log("  IGNORED   " + call.id + "  adapter=" + body.adapter);
      ignored += 1;
    } else {
      console.log("  queued    " + call.id);
      sent += 1;
    }
  }

  console.log("\n  " + "─".repeat(72));
  console.log("  " + sent + " queued, " + duplicate + " already there, " + ignored + " ignored, " +
    failed + " failed");
  console.log("\n  Nothing is visible yet. worker-triage runs on the triage-sweep cron every 15");
  console.log("  minutes, and surfaces at most `cc_candidates_per_day` (default 3) in 24 hours —");
  console.log("  the rest are deferred, not dropped. Candidates arrive as half_mined moments with");
  console.log("  an opening question, and cannot be drafted until Josh answers.\n");

  if (failed > 0 || ignored > 0) process.exitCode = 1;
}

await main();
