/**
 * Which way this project writes today.
 *
 * Josh, 13 October: "It's still asking me interview questions. And referencing the idea bank. As
 * I've mentioned multiple times now, I want to scrap all that for the time being."
 *
 * `one_step_mode` is that "for the time being", expressed as one row in `settings` rather than as
 * deleted code. When it is on:
 *
 *   - `capture` asks nothing. The paste is the material.
 *   - `worker-select` enqueues nothing, so no old idea is ever handed to him unasked.
 *   - `next_work` offers nothing from the queue.
 *   - the eight checks run and are recorded, and the draft reaches him anyway with its flags.
 *
 * Nothing is removed. Every interview tool still works if he asks for one, and turning this off
 * restores the behaviour the build specification describes, exactly.
 *
 * ONE FUNCTION, so the key is spelled once. The last time this codebase had four copies of one
 * rule, two of them drifted and the drafting brief and get_library spent six weeks disagreeing
 * about whether his voice transcript existed.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSetting } from "./db.ts";

export const ONE_STEP_MODE = "one_step_mode";

export async function oneStepMode(db: SupabaseClient): Promise<boolean> {
  return await getSetting<boolean>(db, ONE_STEP_MODE, false);
}

/** What to call it in a reply, so every surface says the same word back to him. */
export function modeName(oneStep: boolean): "one_step" | "interviewed" {
  return oneStep ? "one_step" : "interviewed";
}
