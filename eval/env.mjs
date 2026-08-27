/**
 * Credentials for the evaluation harnesses.
 *
 * All of them need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and the service role bypasses RLS
 * entirely — so it lives in a gitignored `eval/.env` rather than a shell export, where it would sit
 * in shell history for the life of the machine.
 *
 * Real environment variables win, so CI can set them without a file.
 *
 * Shared rather than copied into each script: `acceptance.mjs` had this loader and
 * `gate-acceptance.mjs` did not, so the first thing the newer script proved was that the older one
 * could not be run the same way.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  let lines = [];
  try {
    lines = readFileSync(join(HERE, ".env"), "utf8").split("\n");
  } catch {
    // No file is fine — the variables may already be in the environment.
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim();
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or copy eval/.env.example to eval/.env\n" +
        "and fill it in. Both values are on the Supabase dashboard under Project Settings -> API.",
    );
    process.exit(2);
  }

  return { url, key };
}
