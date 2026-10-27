/**
 * The eight, as data — and reading an ask for one of them out of what Josh actually said.
 *
 * WHY THIS EXISTS
 *
 * Twice in two days he asked for a reference writer's shape in a pushback note, and nothing read
 * either one:
 *
 *   26 Oct — "go look at the Sentinel accounts to see how others who have done lists like this
 *             would write it"
 *   27 Oct — "give me three go look at like what makes a good opening hook from the Sentinel
 *             accounts as well as everything else you know"
 *
 * `writer_handle` has existed on get_drafting_brief since 26 October and is optional, so a session
 * that does not think to pass it gets the default framework — which is the complaint he opened with
 * on 26 October, one layer further in. His note is the instruction; it should not need repeating as
 * a parameter.
 *
 * TWO KINDS OF ASK, AND THEY ARE NOT THE SAME THING
 *
 * Naming ONE writer is a request for that writer's measured shape, and it is the dangerous one:
 * clause 8.3, and Matt Barker's cadence is the one most likely to leak because the library is
 * already aligned to his thinking.
 *
 * Saying "the Sentinel accounts" is not that. It is a request for how the eight of them handle a
 * problem — a band, not a voice. That is answered by the corpus-wide target the gate already judges
 * shape against, so the drafter aims at the number the gate measures instead of at one person's
 * habits. Safer AND more useful, which is why the two are kept apart here.
 *
 * The handle-to-name map lived in two prose descriptions (tools/brief.mjs and tools/voice.mjs) and
 * nowhere as data, so it could not be matched against. It is here once now.
 */

/** The eight he chose, per clause 8.3. `surname` is what he actually says out loud. */
export const REFERENCE_WRITERS = [
  { handle: "mattjbarker1", name: "Matt Barker", surname: "Barker" },
  { handle: "demandjen1", name: "Jen Allen-Knuth", surname: "Allen-Knuth" },
  { handle: "outboundphd", name: "Eric Nowoslawski", surname: "Nowoslawski" },
  { handle: "juliacarter98", name: "Julia Carter", surname: "Carter" },
  { handle: "ryanscarlin", name: "Ryan Carlin", surname: "Carlin" },
  { handle: "curtishowland", name: "Curtis Howland", surname: "Howland" },
  { handle: "amangrowth", name: "Aman Ghataura", surname: "Ghataura" },
  { handle: "adam-treboutat", name: "Adam Treboutat", surname: "Treboutat" },
];

/** "mattjbarker1 (Matt Barker), demandjen1 (Jen Allen-Knuth), …" — for tool descriptions. */
export const WRITER_CHOICES = REFERENCE_WRITERS
  .map((w) => `${w.handle} (${w.name})`)
  .join(", ");

/**
 * The names he uses for the group rather than for a person. "Sentinel accounts" is his own term and
 * the one he has used both times.
 */
const CORPUS_ASK =
  /\bsentinel(?:s| accounts?)?\b|\breference writers?\b|\bthe eight\b|\bother writers\b|\bothers who have\b/i;

/**
 * What a note is asking for, if anything.
 *
 * @param note one of his pushback notes, as he dictated it
 * @returns `{ handle }` when he named one writer, `{ corpus: true }` when he pointed at the group,
 *          or `null` when the note is not about the reference writers at all. A named writer wins
 *          over a group reference: it is the more specific instruction.
 */
export function writerAskFrom(note) {
  const text = String(note ?? "");
  if (!text.trim()) return null;

  /*
   * Matched on whole words rather than with a built regex. He dictates these notes, so they arrive
   * lower-cased, unpunctuated and run together; and a handle like `adam-treboutat` is three regex
   * metacharacters away from matching nothing. Tokenising once is both safer and easier to read.
   */
  const spaced = ` ${words(text).join(" ")} `;
  const says = (phrase) => spaced.includes(` ${words(phrase).join(" ")} `);

  for (const w of REFERENCE_WRITERS) {
    // The handle, the full name, or the surname alone — "look at how Barker opens".
    if (says(w.handle) || says(w.name) || says(w.surname)) return { handle: w.handle };
  }

  return CORPUS_ASK.test(text) ? { corpus: true } : null;
}

/** Lower-cased word tokens. Hyphens split, so `adam-treboutat` matches "Adam Treboutat" too. */
function words(s) {
  return (String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
