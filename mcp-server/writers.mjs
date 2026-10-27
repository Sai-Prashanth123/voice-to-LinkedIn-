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
/*
 * His own term for the group, and only that.
 *
 * This matched "the eight", "other writers" and "others who have" until the first review of it.
 * All three are ordinary English: "the eight reasons are too many" and "others who have run SDR
 * teams will disagree" are notes he could plausibly write about any post, and either would have
 * restructured every later draft toward a reference-writer band he never asked for — while telling
 * him, in the brief, that he had asked for it.
 *
 * "Sentinel accounts" is what he actually says, both times he has said it. The 26 October note
 * contains it, so "others who have" was never needed to catch the real case.
 */
const CORPUS_PHRASES = [
  "sentinel",
  "sentinels",
  "sentinel account",
  "sentinel accounts",
  "reference writer",
  "reference writers",
];

/*
 * A MENTION IS NOT A REQUEST.
 *
 * "This reads like Matt Barker, stop" names Matt Barker. So does "build it the way Barker would".
 * Taking the first for the second is the worst available failure here: the library says his is the
 * cadence most likely to leak and that a draft agreeing with him proves nothing about Josh's voice
 * (8.3), so a complaint about sounding like him would have produced more of him.
 *
 * Judged per sentence, because one note can hold both — "I liked the Sentinel idea but this reads
 * too much like Barker" should resolve to the group, not to Barker.
 */
const NEGATIVE =
  /\b(?:too much like|too close to|stop|stops|don'?t|do not|doesn'?t|does not|didn'?t|not|avoid|avoiding|less|nothing like|no more|reads? like|sounds? like|sounding like|feels? like|copying|copied|ripped off|shouldn'?t)\b/i;

/*
 * HOW CLOSE THE NEGATION HAS TO BE.
 *
 * Scoped to a window around the mention rather than to its sentence, because his notes are
 * dictated and barely punctuated. The 26 October note runs for 400 characters with one full stop
 * in it: "I don't know what you suggest with the hook ... and go look at the Sentinel accounts".
 * A sentence-scoped check read the "don't" and threw away the ask — which is the same fault as
 * before, just failing in the safe direction.
 *
 * Six words back catches "too much like Barker" and "this reads like Matt Barker"; two forward
 * catches a trailing "stop" or "shouldn't".
 */
const LOOK_BACK = 6;
const LOOK_FORWARD = 2;

/** Lower-cased tokens, apostrophes kept so "don't" survives for the negation test. */
function tokens(s) {
  return String(s).toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** A token reduced for name matching: possessives and apostrophes dropped. */
function key(t) {
  return t.replace(/'s$/, "").replace(/'/g, "");
}

/** Lower-cased words with no apostrophes — the form writer names are matched in. */
function words(s) {
  return tokens(s).map(key).filter(Boolean);
}

/**
 * Where `phrase` occurs in `toks`, as token indices. Empty when it does not.
 *
 * Hyphens split, so `adam-treboutat` matches "Adam Treboutat" and vice versa.
 */
function occurrences(toks, phrase) {
  const want = words(phrase);
  if (want.length === 0) return [];
  const at = [];
  for (let i = 0; i + want.length <= toks.length; i++) {
    if (want.every((w, j) => key(toks[i + j]) === w)) at.push(i);
  }
  return at;
}

/** True when this particular mention sits inside a complaint rather than a request. */
function negated(toks, at, length) {
  const window = toks
    .slice(Math.max(0, at - LOOK_BACK), at)
    .concat(toks.slice(at + length, at + length + LOOK_FORWARD))
    .join(" ");
  return NEGATIVE.test(window);
}

/** Any mention of `phrase` that is not inside a complaint. */
function askedFor(toks, phrase) {
  const len = words(phrase).length;
  return occurrences(toks, phrase).some((at) => !negated(toks, at, len));
}

export function writerAskFrom(notes) {
  /*
   * NEWEST FIRST, AND THE NEWEST ONE THAT ASKS FOR ANYTHING WINS.
   *
   * This took a single string of every recent note joined together, so the answer depended on the
   * order of REFERENCE_WRITERS rather than on when he said it: Matt Barker is first in that list,
   * so a note about him from three drafts ago beat one about Julia Carter from a minute ago. An
   * instruction he has replaced is not an instruction.
   *
   * Accepts a string for a single note, so callers that have only one do not have to wrap it.
   */
  const list = (Array.isArray(notes) ? notes : [notes])
    .map((n) => String(n ?? ""))
    .filter((n) => n.trim());
  if (list.length === 0) return null;

  for (const note of list) {
    const ask = askFromOne(note);
    if (ask) return ask;
  }
  return null;
}

function askFromOne(text) {
  const toks = tokens(text);

  /*
   * A named writer beats a group reference: it is the narrower instruction. Both passes ignore a
   * mention that sits inside a complaint, so "I liked the Sentinel idea but this reads too much
   * like Barker" resolves to the group rather than to Barker.
   */
  for (const w of REFERENCE_WRITERS) {
    // The handle, the full name, or the surname alone — "look at how Barker opens".
    if (askedFor(toks, w.handle) || askedFor(toks, w.name) || askedFor(toks, w.surname)) {
      return { handle: w.handle };
    }
  }

  for (const phrase of CORPUS_PHRASES) {
    if (askedFor(toks, phrase)) return { corpus: true };
  }
  return null;
}
