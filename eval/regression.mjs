#!/usr/bin/env node
/**
 * THE REGRESSION HARNESS.
 *
 * Tuning the reference library is the work that gets the build to 17a's finish line — five of the
 * last six drafts needing only light editing. Without a harness, that tuning is done on feel: change
 * a hook rule, read one draft, decide it seems better. This re-drafts a fixed set of real moments
 * against the current library and compares them to the last run, so a change can be judged on
 * evidence.
 *
 * It is also what makes 12.12 ("a change must be reversible") mean something: if posts get worse
 * after a change, this is what shows which change and by how much.
 *
 * Nothing here touches production. It reads the library and the golden moments, calls the drafter
 * exactly as the worker does, and writes results to eval/results/. It never writes a draft row,
 * never enqueues a job, and never schedules anything.
 *
 *   node eval/regression.mjs              # run against the current library
 *   node eval/regression.mjs --compare    # run, then diff against the previous run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../app/node_modules/@supabase/supabase-js/dist/main/index.js";
import { DRAFT_USER, DRAFTER_SYSTEM, PROMPT_VERSION } from "../supabase/functions/_shared/prompts.ts";
import { verifyDraft } from "../supabase/functions/_shared/claims.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(here, "golden");
const RESULTS_DIR = path.join(here, "results");

const MODEL = "claude-opus-5";

async function main() {
  const compare = process.argv.includes("--compare");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !key || !anthropicKey) {
    console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const library = await loadLibrary(db);
  const golden = loadGolden();

  if (golden.length === 0) {
    console.error(
      `No golden moments in ${GOLDEN_DIR}.\n` +
        `Export 20-30 mined moments from the seeding session first — that set is what everything ` +
        `downstream is tuned against.`,
    );
    process.exit(1);
  }

  console.log(`Library v${library.version} · ${golden.length} golden moments · ${MODEL}\n`);

  const results = [];
  for (const moment of golden) {
    process.stdout.write(`  ${moment.ref} … `);
    try {
      const draft = await draftOne(anthropicKey, library.prompt, moment);
      const verification = verifyDraft(draft.body, draft.claims ?? [], moment.entry, moment.names ?? []);
      results.push({
        ref: moment.ref,
        hook: draft.hook,
        body: draft.body,
        framework: draft.framework,
        claims: (draft.claims ?? []).length,
        claims_ok: verification.ok,
        failures: verification.failures,
      });
      console.log(verification.ok ? "ok" : `CLAIMS FAILED (${verification.failures.length})`);
    } catch (err) {
      results.push({ ref: moment.ref, error: String(err) });
      console.log(`error: ${err.message}`);
    }
  }

  const run = {
    at: new Date().toISOString(),
    library_version: library.version,
    prompt_version: PROMPT_VERSION,
    model: MODEL,
    results,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `run-${run.at.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));

  const clean = results.filter((r) => r.claims_ok).length;
  console.log(`\n${clean}/${results.length} passed claim verification.`);
  console.log(`Saved ${path.relative(process.cwd(), file)}`);

  if (compare) compareWithPrevious(run, file);
}

/** The same two inputs the worker gives the drafter: the entry, and the library. Nothing else. */
async function draftOne(apiKey, libraryPrompt, moment) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: DRAFTER_SYSTEM(libraryPrompt), cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: DRAFT_USER({
          entry: moment.entry,
          audience: moment.audience ?? null,
          pillar: moment.pillar ?? null,
          clearedNames: (moment.names ?? []).filter((n) => n.cleared).map((n) => n.name),
          unclearedNames: (moment.names ?? []).filter((n) => !n.cleared).map((n) => n.name),
        }),
      }],
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              hook: { type: "string" },
              body: { type: "string" },
              framework: { type: "string" },
              claims: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    claim: { type: "string" },
                    kind: { type: "string" },
                    source_field: { type: "string" },
                    source_span: { type: "string" },
                  },
                  required: ["claim", "kind", "source_field", "source_span"],
                  additionalProperties: false,
                },
              },
              audience_note: { type: "string" },
            },
            required: ["hook", "body", "framework", "claims", "audience_note"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

async function loadLibrary(db) {
  const { data } = await db.from("library_sections").select("key, title, body, sort_order")
    .order("sort_order");
  const { data: v } = await db.from("library_versions").select("version")
    .order("version", { ascending: false }).limit(1).maybeSingle();

  const wanted = new Set([
    "core_rules", "pillars", "frameworks", "hooks", "closes", "audience",
    "voice_guide", "banned_phrases", "formatting",
  ]);
  const prompt = (data ?? [])
    .filter((s) => wanted.has(s.key))
    .map((s) =>
      s.body?.trim()
        ? `## ${s.title}\n\n${s.body.trim()}`
        : `## ${s.title}\n\n(Not yet supplied by Josh. Do not invent one — work without it.)`
    )
    .join("\n\n---\n\n");

  return { version: v?.version ?? 1, prompt };
}

function loadGolden() {
  if (!fs.existsSync(GOLDEN_DIR)) return [];
  return fs.readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), "utf8")));
}

function compareWithPrevious(run, currentFile) {
  const runs = fs.readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .sort();
  const previousFile = runs[runs.length - 2];
  if (!previousFile) {
    console.log("\nNo earlier run to compare against — this one becomes the baseline.");
    return;
  }

  const previous = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, previousFile), "utf8"));
  console.log(
    `\nAgainst ${previousFile} (library v${previous.library_version} → v${run.library_version}):\n`,
  );

  const prevByRef = new Map(previous.results.map((r) => [r.ref, r]));
  for (const now of run.results) {
    const before = prevByRef.get(now.ref);
    if (!before) continue;

    const changed = before.hook !== now.hook || before.framework !== now.framework;
    console.log(`  ${now.ref}  ${changed ? "CHANGED" : "same shape"}`);
    if (before.hook !== now.hook) {
      console.log(`    hook was:  ${before.hook}`);
      console.log(`    hook now:  ${now.hook}`);
    }
    if (before.framework !== now.framework) {
      console.log(`    framework: ${before.framework} → ${now.framework}`);
    }
    if (before.claims_ok !== now.claims_ok) {
      console.log(`    claims:    ${before.claims_ok ? "passed" : "failed"} → ${now.claims_ok ? "passed" : "failed"}`);
    }
  }

  const beforeClean = previous.results.filter((r) => r.claims_ok).length;
  const nowClean = run.results.filter((r) => r.claims_ok).length;
  console.log(
    `\n  Claim verification: ${beforeClean}/${previous.results.length} → ${nowClean}/${run.results.length}`,
  );
  if (nowClean < beforeClean) {
    console.log("  This library change made fabrication MORE likely. Consider rolling it back.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
