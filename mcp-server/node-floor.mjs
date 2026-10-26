/**
 * Refuse an old Node with a sentence, before an import throws a riddle.
 *
 * WHY THIS FILE EXISTS
 *
 * This server imports TypeScript straight out of `supabase/functions/_shared/` — `prompts.ts`,
 * `views.ts`, `entry.ts`, `shape.ts`, `claims.ts` and more, from `tools/brief.mjs`, `resources.mjs`,
 * `aitells.mjs`, `shape-rows.mjs` and six others. That is deliberate and documented: a measurement
 * or a rule spelled twice is the defect this whole repository keeps paying for, so the two runtimes
 * read one definition.
 *
 * It relies on Node stripping the types, which is on by default from **22.18**. Below that, the
 * first `.ts` import throws:
 *
 *   ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"
 *
 * — before a single tool registers, with no mention of Node, no mention of a version, and nothing a
 * reader could act on. `package.json` said `>=20` and the README said "Node.js 20 or newer", both
 * wrong, and CI pins 22 so it was never going to be caught there.
 *
 * It is a separate module rather than a check at the top of `index.mjs` because ES module imports
 * are hoisted and evaluated before any of the importing file's own code runs. A guard written inside
 * `index.mjs` would execute *after* the import that fails. Imported first, this runs first.
 */

/** Where native type stripping became the default. Not a preference — a hard requirement. */
export const NODE_FLOOR = [22, 18, 0];

const [needMajor, needMinor] = NODE_FLOOR;

/**
 * Exported so the comparison can be tested on versions this machine is not running. A guard whose
 * logic has never been exercised against a failing input is the thing this file exists to prevent.
 *
 * 23.x and later pass at any minor; 22.x needs .18 or above.
 */
export function meetsFloor(version) {
  const [major, minor] = String(version ?? "").split(".").map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > needMajor || (major === needMajor && minor >= needMinor);
}

if (!meetsFloor(process.versions.node)) {
  process.stderr.write(
    `\n  This needs Node ${needMajor}.${needMinor} or newer. You are on ${process.versions.node}.\n\n` +
      `  Why: the server reads its rules straight from the TypeScript files the server-side code\n` +
      `  uses, so a rule is spelled once rather than twice. Node strips those types itself from\n` +
      `  ${needMajor}.${needMinor}; below that the first import fails with "Unknown file extension\n` +
      `  .ts", which says nothing about the real cause.\n\n` +
      `  Install Node ${needMajor}.${needMinor}+ (or any 23/24/25) and run it again.\n\n`,
  );
  process.exit(2);
}
