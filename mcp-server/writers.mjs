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
 * ONLY WORDS THAT CARRY POLARITY COUNT.
 *
 * The first version of this listed "reads like", "sounds like", "feels like" and "copying" as
 * negative. They are not: "make it sound like Barker" and "copying Barker's structure is what I
 * want" are requests, and all four were being thrown away. That is the 26 October complaint again
 * — the drafter falling back to the default framework when he asked for a writer — reintroduced by
 * the fix for the opposite mistake. A verb that works in both directions decides nothing; the
 * negator next to it does.
 */
const NEGATOR =
  /\b(?:not|no|never|none|nothing|don'?t|dont|doesn'?t|didn'?t|can'?t|won'?t|shouldn'?t|stop|stops|avoid|avoiding|less|too|copied|ripped off|instead of|away from)\b/i;

/*
 * A complaint can also trail the name: "this reads like Matt Barker, stop". Kept to the three
 * words that can ONLY be closing a complaint about the thing just named.
 *
 * Nothing broader, because what usually follows a request is the start of the next instruction:
 * "go look at Barker and don't use a question" is an ask plus an unrelated rule, and a wider set
 * threw it away. "instead" was in here and is not a complaint at all — "use Barker instead" is one
 * of the plainest ways he could ask for a writer, and it was being discarded. Only "instead of"
 * negates, and that is in NEGATOR where it belongs.
 */
const TRAILING_COMPLAINT = /\b(?:stop|stops|shouldn'?t|no more)\b/i;

/*
 * WHERE A NEGATION STOPS APPLYING: AT THE END OF ITS CLAUSE.
 *
 * This counted tokens — six, then four — and both numbers were wrong in both directions at once.
 * Six reached back over a comma into the previous clause and threw away "less of the hook, more
 * like Barker". Four stopped short of the negator in "I don't want it to sound like Barker", so a
 * plain complaint asked for more of the cadence the library says is likeliest to leak. There is no
 * number that separates those two, because the thing that separates them is not distance.
 *
 * A clause is. "I don't want it to sound like Barker" is one clause and the negation applies;
 * "no questions, like Barker" is two and it does not. His notes are dictated, so the breaks are
 * mostly conjunctions rather than punctuation — which is why a sentence split failed here earlier
 * and a clause split does not.
 */
const CLAUSE_BREAK = /[,;:.!?]+|\b(?:but|and|so|then|however|although|though|plus)\b/i;

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

/** The note in clauses, each as its own token list. */
function clauses(text) {
  return String(text)
    .split(CLAUSE_BREAK)
    .map((c) => tokens(c))
    .filter((c) => c.length > 0);
}

/**
 * Any mention of `phrase` in a clause that is not complaining about it.
 *
 * A clause carrying a negator negates everything named in it. A clause followed by one that can
 * only be closing a complaint — "…, stop", "…and it shouldn't" — is negated too.
 */
function askedFor(parts, phrase) {
  return parts.some((toks, i) => {
    if (occurrences(toks, phrase).length === 0) return false;
    if (NEGATOR.test(toks.join(" "))) return false;
    const next = parts[i + 1];
    return !(next && TRAILING_COMPLAINT.test(next.join(" ")));
  });
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
  const parts = clauses(text);

  /*
   * A named writer beats a group reference: it is the narrower instruction. Both passes ignore a
   * mention that sits inside a complaint, so "I liked the Sentinel idea but this reads too much
   * like Barker" resolves to the group rather than to Barker.
   */
  for (const w of REFERENCE_WRITERS) {
    // The handle, the full name, or the surname alone — "look at how Barker opens".
    if (askedFor(parts, w.handle) || askedFor(parts, w.name) || askedFor(parts, w.surname)) {
      return { handle: w.handle };
    }
  }

  for (const phrase of CORPUS_PHRASES) {
    if (askedFor(parts, phrase)) return { corpus: true };
  }
  return null;
}
