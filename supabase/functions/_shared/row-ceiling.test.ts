/**
 * No read of a table that can grow may be both unordered and limited.
 *
 * THE CLASS, not the instance. This repository has now paid for the same fault six times:
 *
 *   - the ninth gate check read 500 of 1,839 reference posts, so Matt Barker's median paragraphs
 *     came off 43 of his 241 and the band across the eight was wider than the truth;
 *   - `analyse_reference_writer` used `limit: 200` after the corpus grew to 250, and reported the
 *     newest 200 as the writer's habits;
 *   - `measure-structure.mjs` ordered by handle with a limit and reported 4 writers of 8;
 *   - `export_bank` — clause 6.2, "exports in full" — asked for 5,000 and got 1,000, losing 900 of
 *     his reference posts and returning ok: true;
 *   - `refreshSentinels` counted first and refused above 20,000, then asked for 20,000 and got
 *     1,000;
 *   - and `worker-select` ranked what Josh writes next over an UNORDERED 200.
 *
 * Two distinct mistakes, and a read can make either:
 *
 *   1. A limit at or above 1,000. PostgREST caps a response at 1,000 whatever is asked for, with no
 *      error and nothing in the body saying so. A bigger number is not a fix; it reads as one.
 *   2. A limit with no order. PostgREST makes no promise about WHICH rows an unordered limited
 *      select returns, so the result is arbitrary and every decision downstream treats it as whole.
 *
 * The fix in both cases is to page with an order. Where a read is deliberately a sample rather than
 * a whole — an operator report's "last 20" — it is listed in SAMPLES with a reason, so the choice is
 * visible rather than assumed.
 *
 * Asserted by source, because the alternative is a database with a million rows in it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads that are knowingly a sample rather than a population. Each would need a reason, not just
 * an entry — an allow-list without reasons becomes the place faults are hidden.
 *
 * EMPTY, and worth keeping that way. Every limited read in supabase/functions/ is now ordered, so
 * nothing needs excusing. The first entry here should have to argue for itself.
 */
const SAMPLES: Record<string, string> = {};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith(".ts") && !entry.includes(".test.")) found.push(full);
  }
  return found;
}

const FUNCTIONS_ROOT = fileURLToPath(new URL("../", import.meta.url));

test("no read is both limited and unordered on a table that grows", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(FUNCTIONS_ROOT)) {
    const rel = file.slice(FUNCTIONS_ROOT.length).split(/[\\/]/).join("/");
    if (Object.keys(SAMPLES).some((s) => rel.endsWith(s))) continue;

    const src = readFileSync(file, "utf8");
    // Each `.from("table")` up to the next one: roughly one query's chain.
    for (const chunk of src.split(".from(").slice(1)) {
      const query = chunk.slice(0, 600);
      const limit = query.match(/\.limit\((\d+)\)/);
      if (!limit) continue;

      const n = Number(limit[1]);
      // A single row needs no order, and `.single()` already asserts there is one.
      if (n === 1 || /\.single\(\)|\.maybeSingle\(\)/.test(query)) continue;

      if (n >= 1000) {
        offenders.push(`${rel}: .limit(${n}) is at or above PostgREST's silent 1,000-row cap`);
      } else if (!/\.order\(/.test(query)) {
        offenders.push(`${rel}: .limit(${n}) with no .order() returns an arbitrary ${n} rows`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A limited read must be ordered, and a limit of 1,000 or more cannot do what it says:\n  " +
      offenders.join("\n  "),
  );
});

test("every sample is declared with a reason, not merely listed", () => {
  // Empty today. If an entry ever appears, it argues for itself or this fails.
  for (const [file, why] of Object.entries(SAMPLES)) {
    assert.ok(why.length > 40, `${file} is allow-listed with no real reason given`);
  }
});
