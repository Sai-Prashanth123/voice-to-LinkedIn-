#!/usr/bin/env node
/**
 * Load the receipts file into the library section a claim can actually cite.
 *
 *   node scripts/load-receipts.mjs            # show what would change
 *   node scripts/load-receipts.mjs --apply    # write it
 *
 * WHY THIS SCRIPT EXISTS
 *
 * data/josh/law/receipts.md has said since it was written that it may be used as a source. Nothing
 * could use it: the live library had fourteen sections and receipts was not one of them, so the
 * claim ledger refused every span from it — not by deciding against it, but by never having been
 * told it was there. Migration 0048 creates the section as a placeholder; this fills it.
 *
 * WHAT YOU ARE AGREEING TO BY RUNNING IT
 *
 * Every sentence in that file becomes a fact a post may assert under Josh's name, quoted word for
 * word by `verifyDraft`. That is the whole point and it is also the risk: a line written about him
 * rather than by him is indistinguishable, afterwards, from something he said. Read the file before
 * applying, and treat it the way the voice guide is treated — his to correct, ours to keep honest.
 *
 * It is deliberately not part of load-josh-library.mjs. That script loads the RULES; this loads a
 * SOURCE, and the two have different failure modes: a wrong rule produces a bad post you can see,
 * and a wrong receipt produces a confident false claim you cannot.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const SECTION = "receipts";

const field = (text, key) => (text.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]?.trim();
const read = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

const env = [
  read(join(HERE, "..", ".env")),
  read(join(HERE, "..", "mcp-server", ".env")),
  read(join(HERE, "..", "eval", ".env")),
].join("\n");

const url = field(env, "SUPABASE_URL");
const key = field(env, "SUPABASE_SERVICE_ROLE_KEY") ?? field(env, "CONTENT_MCP_KEY");

if (!url || !key) {
  console.error("\n  Set SUPABASE_URL and a key with write access on library_sections.\n");
  process.exit(1);
}

const body = read(join(HERE, "..", "data", "josh", "law", "receipts.md"));
if (!body.trim()) {
  console.error("\n  data/josh/law/receipts.md is empty or missing. Nothing to load.\n");
  process.exit(1);
}

const api = async (method, path, payload) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
};

const [current] = await api("GET", `library_sections?select=key,title,body&key=eq.${SECTION}`);

console.log("\n  Receipts\n");
console.log("  ──────────────────────────────────────────────────────────────");

if (!current) {
  console.error(
    `  The "${SECTION}" section does not exist. Apply migration 0048 first:\n` +
      "    supabase db push\n",
  );
  process.exit(1);
}

const now = (current.body ?? "").trim();
const next = body.trim();

console.log(`  on file        ${next.length.toLocaleString()} chars`);
console.log(`  in the library ${now.length.toLocaleString()} chars${
  now.startsWith("# Receipts\n\nFOR JOSH") ? "  (still the placeholder)" : ""
}`);

if (now === next) {
  console.log("\n  Identical. Nothing to do.\n");
  process.exit(0);
}

if (!APPLY) {
  console.log("\n  Nothing written. Re-run with --apply.\n");
  console.log("  Read data/josh/law/receipts.md first: every line in it becomes a fact a post may");
  console.log("  state under his name, quoted verbatim by the claim check.\n");
  process.exit(0);
}

await api("PATCH", `library_sections?key=eq.${SECTION}`, {
  body: next,
  updated_at: new Date().toISOString(),
});

console.log("\n  Written. A draft may now cite source_field \"receipts\", span by span.\n");
console.log("  It is a source, not a rule: the drafting brief shows it beside the moment's");
console.log("  material, and every claim resting on it is still checked word for word.\n");
