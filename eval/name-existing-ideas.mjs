#!/usr/bin/env node
/**
 * One-off: give a handle to every live idea captured before ideas had names (0037/0038).
 *
 * Run against the deployed project, because naming goes through cc-submit's `name` route — the same
 * door Claude uses — rather than writing `moments.title` directly from a script. A backfill that
 * wrote the column itself would skip the clash check and the length rule, and would be a second
 * implementation of naming that nobody reads.
 *
 *   node eval/name-existing-ideas.mjs --dry-run     print the handles it would set
 *   node eval/name-existing-ideas.mjs               set them
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Prints every name for review: these are read
 * back to a person, so a bad one is worth catching here rather than in his Telegram.
 */

import process from "node:process";

const URL_BASE = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const rows = await (await fetch(
  `${URL_BASE}/rest/v1/moments?select=id,status,source,raw_inputs(text_body,transcript),material(the_moment)` +
    `&title=is.null&killed=is.false&status=neq.published&order=captured_at.desc`,
  { headers },
)).json();

if (!Array.isArray(rows) || rows.length === 0) {
  console.log("Every live idea already has a name.");
  process.exit(0);
}

console.log(`${rows.length} idea(s) without a name.\n`);

for (const m of rows) {
  const raw = (m.raw_inputs ?? [])[0] ?? {};
  const material = (m.material ?? [])[0] ?? {};
  const gist = String(raw.text_body ?? raw.transcript ?? material.the_moment ?? "")
    .replace(/\s+/g, " ").trim();

  if (dryRun) {
    console.log(`${m.id} (${m.status}, ${m.source})\n    ${gist.slice(0, 120)}\n`);
    continue;
  }

  // Empty name: cc-submit derives one from the idea's own words, which is the same path a capture
  // takes. Nothing here decides what an idea is called.
  const res = await fetch(`${URL_BASE}/functions/v1/cc-submit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "name", moment_id: m.id, name: "", derive: true }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`${m.id}  ${res.ok ? `→ "${body.name}"` : `FAILED ${res.status}: ${body.error ?? ""}`}`);
}
