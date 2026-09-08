#!/usr/bin/env node
/**
 * Is it working? — the whole system in one command, in plain English.
 *
 *   node scripts/smoke.mjs
 *
 * WHO THIS IS FOR
 *
 * Josh, and anyone else who needs to satisfy themselves the thing runs without reading a line of
 * code. `eval/acceptance.mjs` answers "has it met the contract", which is a different and harsher
 * question — most of its twelve tests are waiting on elapsed time and will read as red for weeks
 * even when everything is healthy. `eval/e2e/run.mjs` answers "is the code correct", in the
 * vocabulary of someone who wrote it.
 *
 * This answers "is it alive, and what is it waiting for", which is the question people actually
 * have. Every line either says something is fine or says exactly whose turn it is.
 *
 * IT IS READ-ONLY, AND THAT IS THE POINT
 *
 * It writes nothing, queues nothing and spends no model quota. Somebody worried about whether the
 * system is behaving should be able to check without changing what they are checking.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not grade quality. Whether a draft is any good is the gate's job and ultimately Josh's,
 * and a green tick here would be the same false comfort as a `voice_guide` check passing eighteen
 * drafts against an empty section.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function credentials() {
  let file = "";
  try { file = readFileSync(join(ROOT, "eval", ".env"), "utf8"); } catch { /* env only */ }
  const field = (k) =>
    process.env[k] ?? (file.match(new RegExp("^" + k + "=(.*)$", "m")) ?? [])[1]?.trim();
  const url = field("SUPABASE_URL"), key = field("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("\n  Cannot reach the system: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.");
    console.error("  They belong in eval/.env. Nothing below could run without them.\n");
    process.exit(2);
  }
  return { url: url.replace(/\/+$/, ""), key };
}

const { url, key } = credentials();
const H = { apikey: key, Authorization: "Bearer " + key };

/** One count, or null if the table cannot be read at all. */
async function count(path) {
  const res = await fetch(url + "/rest/v1/" + path + "&select=id", {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return null;
  const cr = res.headers.get("content-range");
  return cr ? Number(cr.split("/")[1]) : 0;
}

async function rows(path) {
  const res = await fetch(url + "/rest/v1/" + path, { headers: H });
  return res.ok ? await res.json() : null;
}

/* ── Output ───────────────────────────────────────────────────────────────── */

const lines = [];
let worst = "ok";
const say = (state, text, detail) => {
  const mark = { ok: "  ok  ", wait: "  ..  ", you: "  YOU ", bad: "  !!  " }[state];
  lines.push(mark + text + (detail ? "\n        " + detail : ""));
  if (state === "bad") worst = "bad";
  else if (state === "you" && worst === "ok") worst = "you";
};

/* ── The checks ───────────────────────────────────────────────────────────── */

console.log("\n  Is it working?\n  " + "─".repeat(66));

// 1. Can we reach it at all.
const health = await rows("rpc/system_health");
if (!health) {
  console.log("  !!  The database did not answer. Nothing else below can be trusted.\n");
  process.exit(1);
}
say("ok", "The database answers.");

// 2. The scheduled jobs. Nine of them; if they stop, everything stops silently.
const h = Array.isArray(health) ? health[0] : health;
const cron = (h?.cron_jobs ?? []).length;
say(cron >= 9 ? "ok" : "bad", `${cron} scheduled jobs registered.`,
  cron >= 9 ? null : "Expected nine. Without them nothing runs on its own.");

// 3. Nothing can delete anything. The guarantee Josh has in writing (6.3).
const destructive = (h?.destructive_grants ?? []).length;
say(destructive === 0 ? "ok" : "bad", "No part of the system can delete or truncate anything.",
  destructive === 0 ? null : destructive + " role(s) have destructive grants. This should be zero.");

// 4. Queue health. A stuck queue is the failure that looks like nothing happening.
const pending = await count("jobs?status=eq.pending");
const dead = await count("jobs?status=eq.dead");
say(pending > 40 ? "bad" : "ok", `${pending} jobs waiting, ${dead} given up on.`,
  pending > 40 ? "That backlog is large enough to be a stall rather than a queue." : null);

// 5. The reference library — the standard everything is judged against.
const sections = await rows("library_sections?select=key,body");
const empty = (sections ?? []).filter((s) => {
  const t = (s.body ?? "").trim();
  if (!t) return true;
  const placeheld = /DELIBERATELY EMPTY/.test(t) || /^#[^\n]*\n+\s*FOR JOSH\b/.test(t);
  if (!placeheld) return false;
  const [, ...rest] = t.split(/(?:^|\n)---(?:\n|$)/);
  return !rest.some((c) => c.trim());
});
say(empty.length === 0 ? "ok" : "you",
  `${(sections ?? []).length - empty.length} of ${(sections ?? []).length} library sections are filled in.`,
  empty.length ? "Still empty: " + empty.map((s) => s.key).join(", ") + ". A draft cannot be judged against a section that is not there." : null);

// 6. The idea bank, and specifically whose turn it is.
const captured = await count("moments?status=eq.captured&killed=is.false");
const halfMined = await count("moments?status=eq.half_mined&killed=is.false");
const mined = await count("moments?status=eq.mined&killed=is.false");
const parked = await count("moments?status=eq.parked&killed=is.false");
say("ok", `Idea bank: ${mined} ready to write, ${halfMined} waiting to be asked about, ` +
  `${captured} just arrived, ${parked} parked.`);

if (halfMined > 0) {
  say("you", `${halfMined} candidate(s) need Josh.`,
    "These came from calls and Claude Code. None can become a post until he answers questions about them — " +
    "that is the rule, not a bug.");
}

// 7. Drafts and the gate.
//
// VERIFICATION FIXTURES ARE EXCLUDED, and the first version of this file did not exclude them.
// It reported "2 posts published" on a system with no LinkedIn connection, which is exactly the
// kind of reassuring nonsense this script exists to avoid. `acceptance-data.ts` has always done
// this; the marker is `framework = 'acceptance-fixture'` on a draft, and a FIXTURE-prefixed body
// or urn on a post.
const drafts = await count("drafts?framework=not.eq.acceptance-fixture");
const fixtures = await count("drafts?framework=eq.acceptance-fixture");
const judged = await count("gate_runs?id=gt.0");
const refused = await count("gate_runs?passed=is.false");
say("ok", `${drafts} real drafts written; ${judged} gate judgements on record, ${refused} of them refusals.`,
  fixtures ? `${fixtures} deliberately generic fixtures are excluded from that count.` : null);

// 8. Nothing published without Josh. The rule the whole engagement rests on.
const published = await count("posts?status=eq.published&body=not.like.FIXTURE*");
const unauthorised = await count("posts?status=eq.published&marked_ready_at=is.null&body=not.like.FIXTURE*");
say(unauthorised === 0 ? "ok" : "bad",
  published === 0
    ? "Nothing has been published yet, and nothing can publish without Josh."
    : `${published} posts published, ${unauthorised} of them without Josh's approval.`,
  unauthorised === 0
    ? "The database refuses it four different ways, so this cannot be otherwise."
    : "This should be impossible. Stop and investigate before anything else.");

// 9. Proposals waiting on a decision.
const proposals = await count("library_proposals?status=eq.open");
if (proposals > 0) {
  say("you", `${proposals} proposed change(s) to the library are waiting for Josh.`,
    "Nothing changes until he approves or rejects each one.");
} else {
  say("ok", "No library changes are waiting for a decision.");
}

// 10. What is simply not connected yet. Named, so absence is never mistaken for breakage.
const [li] = (await rows("linkedin_auth?select=member_urn,access_expires_at")) ?? [];
if (!li?.member_urn) {
  say("you", "LinkedIn is not connected, so nothing can publish.",
    "Two of the twelve acceptance tests cannot start their four-week windows until it is.");
} else {
  const days = li.access_expires_at
    ? Math.round((new Date(li.access_expires_at) - Date.now()) / 86400000) : null;
  say(days !== null && days < 7 ? "bad" : "ok",
    "LinkedIn connected as " + li.member_urn + (days !== null ? `, token good for ${days} more days.` : "."));
}

/* ── Verdict ──────────────────────────────────────────────────────────────── */

console.log(lines.join("\n"));
console.log("  " + "─".repeat(66));

if (worst === "bad") {
  console.log("\n  Something is wrong. The lines marked !! are the ones to look at.\n");
  process.exitCode = 1;
} else if (worst === "you") {
  console.log("\n  Working. The lines marked YOU are waiting on a person, not on the system.\n");
} else {
  console.log("\n  Working, and nothing is waiting on anyone.\n");
}
