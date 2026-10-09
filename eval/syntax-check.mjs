#!/usr/bin/env node
/**
 * Syntax check for the Edge Functions.
 *
 * They run on Deno and import via `npm:` specifiers, so a full type-check needs Deno. This at least
 * parses every file with the TypeScript compiler and reports syntax errors — the main risk in
 * hand-written code, and a class of failure that would otherwise only surface on deploy.
 *
 *   node eval/syntax-check.mjs
 */
/*
 * The TypeScript compiler came out of `app/node_modules` — the deleted desk's dependency tree. This
 * script is the runbook's "fallback parse check if Deno is absent", so it degrades to saying so
 * rather than crashing with a module-not-found that reads like the repo is broken.
 */
let ts;
try {
  ts = (await import("typescript")).default;
} catch {
  console.error(
    "This fallback needs the TypeScript compiler, which is no longer vendored in this repo.\n" +
      "Use the real check instead:  npx deno check supabase/functions/**/*.ts\n" +
      "Or install it for this one:  npm i -g typescript   (then re-run)",
  );
  process.exit(2);
}
import fs from "node:fs";
import path from "node:path";

const roots = ["supabase/functions", "cc-agent", "eval"];
const files = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  walk(root);
}
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(ts|mjs)$/.test(e.name)) files.push(full);
  }
}

let failed = 0;
for (const f of files) {
  const source = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics ?? [];
  if (diags.length > 0) {
    failed++;
    console.log(`\n✗ ${f}`);
    for (const d of diags.slice(0, 5)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      console.log(`   ${line + 1}:${character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
  }
}

console.log(`\n${files.length} files parsed, ${failed} with syntax errors.`);
process.exit(failed > 0 ? 1 : 0);
