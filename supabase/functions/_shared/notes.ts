/**
 * What Josh said about a draft, marked so it can be told apart from what the gate said.
 *
 * WHY ITS OWN MODULE
 *
 * The marker is written by `pushback.ts` and read by `mcp-server/tools/brief.mjs`. Those run on
 * different runtimes — pushback.ts imports `npm:@supabase/supabase-js`, which Node cannot resolve —
 * so the string was spelled once in each, and the reader's copy was a regex.
 *
 * That is the "a value spelled twice" shape this repo keeps finding, and this one had teeth:
 * reword the sentence in pushback.ts and the reader silently stops matching. Nothing fails, no test
 * goes red, and the symptom is a drafter that has quietly forgotten what Josh asked for — which is
 * exactly the fault of 27 October, arriving by a second route.
 *
 * Nothing is imported here on purpose. That is what lets both runtimes share it, the same way
 * shape.ts and shingles.ts are shared.
 */

/** How his note is marked inside a draft job's `failures` array. */
export const JOSH_NOTE_PREFIX = "Josh's note on the previous version: ";

/**
 * His words back out of a `failures` entry.
 *
 * @returns the note, or null when the entry is a gate verdict rather than something he said. The
 *          distinction is the point: one is an instruction and the other is a judgement, and the
 *          drafting brief frames them differently.
 */
export function joshNote(failure: unknown): string | null {
  const text = String(failure ?? "");
  if (!text.startsWith(JOSH_NOTE_PREFIX)) return null;
  const note = text.slice(JOSH_NOTE_PREFIX.length).trim();
  return note || null;
}
