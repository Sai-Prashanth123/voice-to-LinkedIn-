#!/usr/bin/env node
/**
 * Export the live project into the repo, so a clone arrives with the system and not just its
 * furniture.
 *
 *   node scripts/export-local.mjs            # everything includable, into data/local/
 *   node scripts/export-local.mjs --dry-run  # say what would be written, write nothing
 *
 * WHY THIS EXISTS
 *
 * A fresh local cluster takes all 54 migrations and comes up with 15 `library_sections`, which is
 * exactly the number the live project has. Ten of those fifteen are ZERO CHARACTERS LONG. The
 * migrations build the shelves; Josh wrote the rules into them himself over two months, which is
 * the entire reason the standard lives in the database instead of in the prompts.
 *
 * So `select count(*) from library_sections` returns 15 against an empty library, and any check
 * written that way passes while the system cannot do its job. Measured 28 October 2026:
 *
 *     section          local  production        section          local  production
 *     audience             0       1,866        pillars              0         933
 *     closes               0       1,052        prompt_set           0      12,635
 *     formatting           0       1,166        visual_brand         0       5,792
 *     frameworks           0         664        voice_guide          0       8,341
 *     gate_rules           0       2,657        reference_posts  1,191      10,924
 *
 * Plus 0 of 1,900 reference-writer posts, 0 of 111 moments, and `one_step_mode` false where Josh
 * set it true on 13 October — so `start_post` runs the interview path and nothing says so.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED, AND WHY
 *
 * Three different reasons, and collapsing them would be the mistake this file is here to avoid:
 *
 *   SECRETS      never committed, at any size. `linkedin_auth` holds OAuth tokens and
 *                `telegram_access` holds the chat ids that ARE the access control. A git history is
 *                forever and this repo was public until recently.
 *   REGENERABLE  `reference_shingles` is 398,803 rows and 32 MB, derived entirely from
 *                `reference_writer_posts` by scripts/build-reference-shingles.mjs. Committing a
 *                derived index that large is how a repo becomes unclonable.
 *   NEEDS WHAT   `moment_embeddings` is `vector(1024)`, and the local build substitutes a domain
 *   LOCAL LACKS  over float8[] with no index and no dimension enforcement. Six rows, model-specific,
 *                and restoring them would imply a similarity search that is not really there.
 *   LOGS         `llm_calls`, `system_events` and `jobs` are what the system DID, not what it IS.
 *                A clone does not need September's queue to write a post in November.
 *
 * Each exclusion is named in the manifest with its reason, so the next reader sees a decision
 * rather than an absence.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv } from "../mcp-server/env.mjs";
import { createDb } from "../mcp-server/db.mjs";

const REPO = join(import.meta.dirname, "..");
const OUT = join(REPO, "data/local");
const DRY = process.argv.includes("--dry-run");

/*
 * Load order, which is FK order. A restore that inserts gate_runs before drafts fails on every
 * row, and the error it gives names the constraint rather than the ordering, so this list is the
 * documentation as much as the configuration.
 *
 * `order` is the primary key, read off pg_constraint rather than guessed: PostgREST paginates with
 * limit/offset and an unordered page boundary silently drops and duplicates rows as the planner
 * changes its mind. Four of these are not `id` — library_sections is keyed by `key`,
 * library_versions by `version`, material by `moment_id`, reference_writer_posts by `activity_id`.
 */
export const TABLES = [
  // Tier 1 — the standard and the reference corpus. Nothing here depends on anything.
  { table: "settings", order: "key", why: "one_step_mode lives here, and 30 other decisions" },
  { table: "library_sections", order: "key", why: "THE STANDARD. Without this nothing can judge" },
  { table: "library_versions", order: "version", why: "what changed when" },
  { table: "reference_writer_posts", order: "activity_id", why: "the eight writers' 1,900 posts" },
  { table: "providers_seen", order: "provider", why: "which LLM providers have answered" },
  { table: "question_stats", order: "key", why: "which interview questions earn their place" },

  // Tier 2 — depends on tier 1.
  { table: "library_section_versions", order: "id", why: "every version of every section" },
  { table: "library_proposals", order: "id", why: "6 of these are waiting on his decision" },
  { table: "library_recordings", order: "id", why: "his own recordings about the library" },
  { table: "moments", order: "id", why: "the idea bank: 111 of them" },
  { table: "conversation_state", order: "chat_id", why: "where each conversation got to" },

  // Tier 3 — depends on moments.
  { table: "material", order: "moment_id", why: "the extracted ten fields. Drafting reads this" },
  { table: "moment_names", order: "id", why: "names he gave, and names needing clearance" },
  { table: "interview_turns", order: "id", why: "198 turns, in his own words" },
  { table: "raw_inputs", order: "id", why: "what arrived before anything was made of it" },
  { table: "posts", order: "id", why: "23 posts" },
  { table: "drafts", order: "id", why: "89 drafts, with their gate verdicts" },
  { table: "selection_runs", order: "id", why: "what the selector chose and why" },
  { table: "notices", order: "id", why: "things that happened while nobody was looking" },
  { table: "chat_messages", order: "id", why: "the conversation itself" },

  // Tier 4 — depends on drafts and posts.
  { table: "gate_runs", order: "id", why: "694 per-check verdicts. The quality history" },
  { table: "outcomes", order: "post_id", why: "what happened after publishing" },
  { table: "visuals", order: "id", why: "8 renders" },
  { table: "sent_messages", order: "telegram_message_id", why: "what was sent, to avoid resending" },
];

/** Named, with reasons, because an unexplained absence reads as an oversight. */
export const EXCLUDED = [
  { table: "linkedin_auth", reason: "SECRET — OAuth tokens. Never committed, at any size." },
  { table: "telegram_access", reason: "SECRET — the chat ids ARE the access control." },
  { table: "slack_state", reason: "SECRET-adjacent, and empty. Per-channel state." },
  {
    table: "reference_shingles",
    reason:
      "REGENERABLE — 398,803 rows / 32 MB, derived from reference_writer_posts. " +
      "Rebuild with: node scripts/build-reference-shingles.mjs",
  },
  {
    table: "moment_embeddings",
    reason:
      "NEEDS PGVECTOR — vector(1024), and the local build substitutes a domain over float8[] " +
      "with no index and no dimension enforcement. Restoring 6 rows would imply a similarity " +
      "search that is not really there.",
  },
  { table: "llm_calls", reason: "LOG — what the system did, not what it is." },
  { table: "system_events", reason: "LOG — 3,948 rows of operational history." },
  { table: "jobs", reason: "LOG — the worker queue. A clone starts with an empty one." },
  { table: "published_archive", reason: "EMPTY — nothing has ever published." },
];

/* A guard, not a comment. If a table lands in both lists the export must stop rather than guess. */
{
  const excluded = new Set(EXCLUDED.map((e) => e.table));
  const both = TABLES.filter((t) => excluded.has(t.table)).map((t) => t.table);
  if (both.length) {
    console.error(`${both.join(", ")} is both included and excluded. Decide, then run again.`);
    process.exit(2);
  }
}

/*
 * PostgREST caps a response, and the cap is server configuration this script cannot read. So every
 * table is paged regardless of how small it looks: reference_writer_posts is 1,900 rows and a
 * single unpaged request would return the first N with no indication that it had stopped.
 *
 * A short page is the only reliable end-of-data signal, and that is why PAGE is compared against
 * the rows returned rather than against a count queried separately — the count could change
 * between the two calls.
 */
const PAGE = 500;

async function fetchAll(db, table, order) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.select(table, { order: `${order}.asc`, limit: PAGE, offset });
    rows.push(...page);
    if (page.length < PAGE) return rows;
    if (rows.length > 500_000) throw new Error(`${table}: over 500k rows, refusing to continue`);
  }
}

const env = loadEnv();
const db = createDb(env);

if (!DRY) mkdirSync(OUT, { recursive: true });

console.log(`${DRY ? "DRY RUN — nothing will be written" : `writing to data/local/`}\n`);

const manifest = {
  exported_at: new Date().toISOString(),
  project: env.url.replace(/^https?:\/\//, "").split(".")[0],
  format: "jsonl — one JSON object per line, ordered by primary key, so a diff is readable",
  tables: [],
  excluded: EXCLUDED,
  restore: "node local/load.mjs   (after the migrations have been applied)",
};

let total = 0;
const failures = [];

for (const { table, order, why } of TABLES) {
  try {
    const rows = await fetchAll(db, table, order);
    // One object per line rather than one big array: a 1,900-row array reformats as a single line
    // in most diffs, so a one-row change looks like the whole file changed.
    const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
    if (!DRY) writeFileSync(join(OUT, `${table}.jsonl`), body, "utf8");
    manifest.tables.push({ table, order, rows: rows.length, bytes: body.length, why });
    total += rows.length;
    console.log(`  ${table.padEnd(26)} ${String(rows.length).padStart(7)} rows  ` +
      `${String(Math.round(body.length / 1024)).padStart(5)} kB`);
  } catch (err) {
    failures.push(`${table}: ${err.message}`);
    console.log(`  ${table.padEnd(26)} FAILED  ${err.message}`);
  }
}

if (!DRY) {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

console.log(`\n${total} rows across ${manifest.tables.length} tables.`);
console.log(`${EXCLUDED.length} tables deliberately excluded — see data/local/manifest.json.`);

if (failures.length) {
  console.error(`\n${failures.length} table(s) failed:`);
  for (const f of failures) console.error(`  ${f}`);
  console.error("\nA partial export is worse than none, because a restore from it looks complete.");
  process.exit(1);
}
