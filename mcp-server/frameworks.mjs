/**
 * Which body framework a draft used, read back so clause 9.3 means something.
 *
 * 9.3 asks the writer to pick a framework and record which one, "so it can be reviewed". The column
 * has existed since migration 0003 and is NOT NULL, so every draft has carried a value. Nothing
 * ever read it, and on 19 October Josh asked to keep 9.3 precisely because he wants to see whether
 * posts are varying. Reading the column answered him before we could: 11 distinct values across 49
 * drafts, 20 of them under "The scene" — which is not one of his three structures — two spellings
 * of "what, why, how", two of "problem, agitate, solve" (one carrying a U+2011 non-breaking hyphen),
 * and 19 of the 20 drafts since 1 October all on the same structure.
 *
 * So two things are needed, and neither is a new standard:
 *
 *   - a comparison key, so one framework spelled two ways counts once. Without it any variety
 *     number is wrong by construction and wrong in the flattering direction.
 *   - the set of names Josh actually sanctioned, taken from the live `frameworks` section rather
 *     than hardcoded here. He is rewriting that section this week; a list in this file would be
 *     stale on approval and would quietly judge drafts against a standard he had replaced.
 *
 * Nothing here refuses a draft. An unrecognised framework is reported, because the advisory
 * decision of 13 October applies to this for the same reason it applies to the gate: he decides.
 */

/**
 * The comparison key for a framework name. Case, surrounding space, inner runs of space, and the
 * punctuation people vary without meaning to — commas, the five dash characters, underscores — all
 * collapse. "What, why, how", "what, why, how" and "what—why—how" are one framework; "the scene"
 * stays a different one, which is the point.
 */
export function frameworkKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    // U+2010 to U+2015 are the hyphen/dash block, U+2011 among them: the character that made
    // "Problem‑Agitate‑Solution" a twelfth framework.
    .replace(/[‐-―_]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The value as stored: his words, tidied of stray whitespace only. Never lowercased. */
export function tidyFramework(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The frameworks Josh has named, read off the section body. His structures are `##` headings, which
 * is how the section has been written since it was loaded and how proposal 15 keeps writing it. A
 * section with no headings returns nothing, and callers treat that as "cannot judge" rather than as
 * "nothing is allowed" — an empty library must not start flagging every draft.
 */
export function namedFrameworks(body) {
  const names = [];
  for (const line of String(body ?? "").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) names.push(heading[1]);
  }
  return names;
}

/** True when the value is one of the section's own headings, compared on the key. */
export function isNamedFramework(value, body) {
  const key = frameworkKey(value);
  return namedFrameworks(body).some((name) => frameworkKey(name) === key);
}

/**
 * The mix across a set of drafts, newest-first order preserved for the label. Returns one entry per
 * distinct framework with the spelling the drafts used, its count, and whether the section names it.
 */
export function frameworkMix(drafts, body) {
  const seen = new Map();
  for (const d of drafts) {
    const key = frameworkKey(d.framework);
    if (!key) continue;
    const entry = seen.get(key) ?? { framework: tidyFramework(d.framework), used: 0 };
    entry.used += 1;
    seen.set(key, entry);
  }

  const named = namedFrameworks(body);
  return [...seen.values()]
    .sort((a, b) => b.used - a.used)
    .map((entry) => ({
      ...entry,
      // Undefined rather than true when the section has no headings to compare against: a claim
      // about his library that his library cannot support should not be made at all.
      in_library: named.length === 0 ? undefined : isNamedFramework(entry.framework, body),
    }));
}
