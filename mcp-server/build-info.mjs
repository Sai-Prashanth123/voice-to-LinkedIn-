/**
 * The build stamp, as a MODULE rather than a data file.
 *
 * It was `build.json`, read with readFileSync at runtime. The hosted connector reported
 * `source: "unknown"` on the very first deploy after it shipped, because the edge bundler includes
 * the import graph and nothing else — a file nobody imports does not travel. Exactly the failure
 * the stamp exists to expose, found by the stamp, an hour after writing it.
 *
 * Committed as null on purpose. A real commit hash in git is wrong the moment the next commit
 * lands, and `scripts/deploy.mjs` rewrites this immediately before deploying and restores it
 * straight after — so the bundle carries the stamp and the repository never does.
 *
 * Null here is not a failure: a clone falls back to git, which knows better than any stamp.
 */
export const BUILD = null;
