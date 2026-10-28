#!/usr/bin/env node
/**
 * Give the 31 unguarded moments a name guard, from the words he actually used.
 *
 *   node scripts/backfill-moment-names.mjs              # dry run. Prints, writes nothing
 *   node scripts/backfill-moment-names.mjs --apply       # writes
 *   node scripts/backfill-moment-names.mjs --moment 110  # one moment
 *
 * WHY
 *
 * `write_post` declared `extracted` as `z.record(z.string())` where the real shape carries
 * `names: z.array(...)`, so in one-step mode — the mode he has used since 13 October — no name could
 * be passed and `moment_names` stayed empty. 31 of 48 moments with material have zero rows.
 * `unclearedNames()` then returns `[]`, `must_not_name` is `[]`, and `create_draft`'s refusal and the
 * claim ledger both `.filter()` an empty array, which cannot fail.
 *
 * The schema is fixed, so NEW moments are guarded. This is for the 31 that are not. Moment 110's
 * material contains "My client Thermal doesn't want me to mention Shoden… so let's drop them" and
 * nothing in the system knows it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *   NOT `submit_extraction --redo`. That overwrites `material`, and 89 drafts plus 694 gate verdicts
 *   were verified against the current rows. A backfill must not need forgiveness.
 *   NOT a new `cc-submit` route. That is a permanent write surface, reachable by anything holding the
 *   key, for a job that runs once.
 *   NOT an INSERT grant to `content_mcp`. `0028_mcp_role.sql` gives it SELECT on this table on
 *   purpose: the model gets a door, not keys. Widening it permanently for a one-off is the wrong
 *   trade, so this runs as an operator script with whatever key the operator holds.
 *   NOT clearing anything. `eval/e2e/cases/s2-interview.mjs:126` asserts in as many words that
 *   "clearance is something Josh grants, never a default", and prior clearance on another moment is
 *   not evidence for this one — 9.10 is per post.
 *
 * WHAT IT COSTS HIM, SAID UP FRONT
 *
 * Every name inserted is a clearance question. Measured over all 48 moments the detector finds about
 * 1.2 candidates each and is spurious on four in forty-eight — so the pile is real but small, and
 * `--dry-run` exists so the junk is struck before he ever sees it. A clearance question he stops
 * reading is worse than no question, which is the failure `isRealName`'s own comment records.
 *
 * The blast radius is smaller than it looks, and this was checked rather than assumed: nothing in the
 * approve or publish path reads `moment_names`, so a backfilled name cannot un-approve a post or stop
 * a scheduled publish. `create_draft` and the claim ledger refuse only when the name APPEARS IN THE
 * BODY BEING FILED, so the 89 existing drafts are not re-judged. The only new refusal is a NEW draft
 * on one of these moments that contains one of these names — which is the guard doing its job.
 */

import { loadEnv } from "../mcp-server/env.mjs";
import { createDb } from "../mcp-server/db.mjs";
import { candidateNames } from "../supabase/functions/_shared/extraction.ts";

const APPLY = process.argv.includes("--apply");
const ONE = (() => {
  const i = process.argv.indexOf("--moment");
  return i === -1 ? null : Number(process.argv[i + 1]);
})();

/*
 * The strike list, and why this is a parameter rather than a cleverer detector.
 *
 * The first full dry run found 51 candidates over 16 moments and about thirty of them were not
 * names to clear: "Pilot" five times (a fragment of "Thought Pilot", split because "thought" is an
 * English verb in lower case), "Department" and "Defense" (one organisation, split by the "of"),
 * "Australian", "Finding LinkedIn", and a row of public tools — Google, Meta, Claude, the Wayback
 * Machine.
 *
 * Tightening the detector until those vanish is the wrong instinct twice over. It would lose real
 * finds with them — the names he drops are usually his sentence subjects — and, more importantly,
 * WHICH OF THESE NEEDS CLEARANCE IS HIS CALL, NOT A REGEX'S. "Google" plainly does not. "Slingshot
 * GTM" is his own company. "Thermal" is a client who has asked not to be connected to a vendor.
 * Those three look identical to a scanner and could not be more different to him.
 *
 * So the detector stays permissive, prints everything, and a human strikes the list. Per
 * `isRealName`'s own comment the asymmetry is deliberate: a role kept costs one tap, a real name
 * dropped means someone gets named without anyone asking.
 *
 *   node scripts/backfill-moment-names.mjs --strike "Pilot,Department,Defense" --apply
 */
const STRUCK = new Set(
  (() => {
    const i = process.argv.indexOf("--strike");
    return i === -1 ? [] : String(process.argv[i + 1] ?? "").split(",");
  })().map((s) => s.trim().toLowerCase()).filter(Boolean),
);

const env = loadEnv();
const db = createDb(env);

/* ── Who needs one ────────────────────────────────────────────────────────── */

/*
 * Filtered on `kind != not_a_name` rather than a bare row count, so the three rows that were
 * relabelled by hand in August ("Josh", "CFO", "CFO") do not mask a moment that has no real guard.
 * A moment whose only rows are non-names is exactly as unguarded as one with no rows at all.
 */
const allNames = await db.select("moment_names", {
  select: "moment_id,name,kind",
  kind: "neq.not_a_name",
  limit: 1000,
});
const guarded = new Map();
for (const n of allNames) {
  const k = String(n.moment_id);
  if (!guarded.has(k)) guarded.set(k, new Set());
  guarded.get(k).add(n.name.toLowerCase());
}

const material = await db.select("material", { select: "*", limit: 1000 });
const haveMaterial = material.filter((m) =>
  Object.entries(m).some(([k, v]) => k !== "moment_id" && k !== "search_text" && v)
);

const targets = haveMaterial
  .filter((m) => (ONE ? Number(m.moment_id) === ONE : !guarded.has(String(m.moment_id))))
  .map((m) => Number(m.moment_id))
  .sort((a, b) => a - b);

console.log(
  `${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}\n` +
    `${haveMaterial.length} moments have material; ${targets.length} to scan.\n`,
);

/* ── What he actually said ────────────────────────────────────────────────── */

/*
 * Rebuilt the way `cc-submit/index.ts:212-215` rebuilds it, not reimplemented: the raw input he
 * pasted or dictated, plus his own interview answers. HIS words only — a name the interviewer used
 * and he never did is not his to clear, which is the same asymmetry `missingNumbers` draws.
 */
/*
 * Retried, because the connection to the hosted project drops.
 *
 * Measured over this session: three `fetch failed` errors across maybe forty reads, each on a
 * different query, each succeeding immediately on a re-run. CLAUDE.md already says to re-run before
 * believing a failure. A script that walks 31 moments does ~60 reads, so a 1-in-15 transient makes
 * a full pass fail more often than it succeeds — and a half-finished scan is worse than none here,
 * because the printed list is what somebody strikes names from.
 *
 * Two attempts, not five: a real outage should still fail fast and say so.
 */
async function reread(label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!/could not reach|fetch failed/i.test(err.message)) throw err;
    console.error(`  (${label}: ${err.message} — retrying once)`);
    return await fn();
  }
}

async function joshWords(momentId) {
  const raws = await reread(`raw_inputs ${momentId}`, () =>
    db.select("raw_inputs", {
      select: "transcript,text_body",
      moment_id: `eq.${momentId}`,
      limit: 50,
    }));
  // `body`, not `text` — and `role: answer`, because a name the interviewer used and he never did
  // is not his to clear.
  const turns = await reread(`interview_turns ${momentId}`, () =>
    db.select("interview_turns", {
      select: "body,role",
      moment_id: `eq.${momentId}`,
      role: "eq.answer",
      limit: 200,
    }));
  const mat = material.find((m) => Number(m.moment_id) === momentId) ?? {};
  return [
    ...raws.map((r) => r.transcript ?? r.text_body ?? ""),
    ...turns.map((t) => t.body ?? ""),
    ...Object.entries(mat)
      .filter(([k]) => k !== "moment_id" && k !== "search_text")
      .map(([, v]) => String(v ?? "")),
  ].join("\n");
}

/*
 * person or company, by a conservative rule, and the guess is declared as one.
 *
 * The detector cannot tell them apart and must not pretend to. `kind` affects only how a name is
 * described to him; `cleared` is the field with teeth, and it is false either way. An `unknown` kind
 * would mean altering a CHECK constraint to change a word.
 */
/*
 * A company, by three signals, and the guess is declared as one.
 *
 * The detector cannot tell a person from a company and must not pretend to. `kind` affects only
 * how a name is described to Josh; `cleared` is the field with teeth and it is false either way.
 *
 * TWO PATTERNS, NOT ONE WITH A FLAG, and it took two wrong goes to see why. The suffix list must
 * be case-insensitive or "Hardy Relations" — a company that says so in its own name — reads as a
 * person. The all-caps clause must be case-SENSITIVE or `[A-Z]{2,}` matches any two letters and
 * every name becomes a company, "Dan" included. One regex with /i cannot be both.
 *
 * (The first attempt was worse and quieter: written through a shell heredoc, the backslashes
 * collapsed and `\\b` became the BACKSPACE character, so the clause compiled and matched nothing
 * while the run reported success. Written as a file edit since.)
 */
const COMPANY_SUFFIX =
  /\b(?:inc|ltd|llc|plc|gmbh|pty|corp|group|labs?|technologies|systems|software|relations|agency|partners|solutions|media|health|capital)\b/i;
const ALL_CAPS_TOKEN = /\b[A-Z]{2,}\b/;
const INNER_CAPS = /[a-z][A-Z]/;
const kindOf = (name) =>
  COMPANY_SUFFIX.test(name) || ALL_CAPS_TOKEN.test(name) || INNER_CAPS.test(name)
    ? "company"
    : "person";

/* ── Scan ─────────────────────────────────────────────────────────────────── */

const found = [];
for (const id of targets) {
  const said = await joshWords(id);
  if (!said.trim()) continue;
  const already = guarded.get(String(id)) ?? new Set();
  const names = candidateNames(said)
    .filter((n) => !already.has(n.toLowerCase()))
    .filter((n) => !STRUCK.has(n.toLowerCase()));
  if (names.length === 0) continue;
  found.push({ moment_id: id, names });
  console.log(`  ${String(id).padStart(4)}  ${names.map((n) => `${n} (${kindOf(n)})`).join(", ")}`);
}

const total = found.reduce((n, f) => n + f.names.length, 0);
console.log(
  `\n${total} candidate name(s) across ${found.length} moment(s). ` +
    `${targets.length - found.length} moment(s) came back with none, which is a real answer.`,
);

if (!APPLY) {
  console.log(
    `\nNothing written. Read the list above and strike anything that is not a name before ` +
      `applying — every row inserted is a clearance question put to Josh, and a question he stops ` +
      `reading is worse than no question.\n\n  node scripts/backfill-moment-names.mjs --apply\n`,
  );
  process.exit(0);
}

/* ── Write ────────────────────────────────────────────────────────────────── */

let inserted = 0;
const failures = [];

for (const { moment_id, names } of found) {
  const rows = names.map((name) => ({ moment_id, name, kind: kindOf(name), cleared: false }));
  try {
    // cleared_at stays null, which satisfies moment_names_cleared_has_timestamp (0002:86-87).
    await db.insert("moment_names", rows, { returning: false });
    inserted += rows.length;
  } catch (err) {
    failures.push(`moment ${moment_id}: ${err.message}`);
    continue;
  }

  /*
   * Provenance goes in system_events, NOT in cleared_note.
   *
   * `names.ts:132-135` documents cleared_note as "the record of what he actually said". Machine
   * provenance in it would corrupt the one field that distinguishes "yes" from "yes, but not his
   * company name".
   */
  await db.insert("system_events", [{
    kind: "names_backfilled",
    severity: "info",
    detail: { moment_id, names, script: "backfill-moment-names.mjs", found_by: "candidateNames" },
  }], { returning: false }).catch(() => {});
}

console.log(`\n${inserted} row(s) inserted.`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    `\nIf these say permission denied, the key in mcp-server/.env is the scoped content_mcp role, ` +
      `which holds SELECT only on this table by design (0028_mcp_role.sql). Run this with the ` +
      `service-role key, from eval/.env, rather than widening that grant.`,
  );
  process.exit(1);
}

console.log(
  `\nEvery name is UNCLEARED, so nothing can be drafted naming any of them until he says so. ` +
    `Tell him these are waiting and use clear_names with his answer — do not clear them for him.`,
);
