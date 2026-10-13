/**
 * Which way this project writes today, on the MCP side.
 *
 * The twin of supabase/functions/_shared/mode.ts. Two runtimes, one key, and the key is spelled in
 * exactly these two files — see the comment there for why that matters here specifically.
 *
 * Reading this needs `select` on `settings`, which `content_mcp` did not have until migration 0047
 * added a policy listing the four rows that are operating modes rather than facts about Josh.
 * Before that, every settings read from a tool worked only because the hosted connector falls back
 * to the service key when no scoped key is set — so `cc_candidates_per_day` would have started
 * silently returning its fallback the day that key was minted.
 */

export const ONE_STEP_MODE = "one_step_mode";

/** One setting, read the way getSetting reads it, with the same fallback. */
export async function setting(db, key, fallback) {
  const [row] = await db.select("settings", { select: "value", key: `eq.${key}`, limit: 1 });
  return row?.value ?? fallback;
}

export async function oneStepMode(db) {
  return Boolean(await setting(db, ONE_STEP_MODE, false));
}

/** What to call it in a reply, so every surface says the same word back to him. */
export function modeName(oneStep) {
  return oneStep ? "one_step" : "interviewed";
}
