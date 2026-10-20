/**
 * "Take the shape. Never the words." — the part of it a machine can check.
 *
 * WHAT THIS IS FOR
 *
 * CLAUDE.md's rule about the eight reference writers is the strongest one in the file and was, until
 * 20 October, the only never-negotiable with nothing mechanical behind it. The nine gate checks
 * cannot help: views.ts withholds `reference_posts` from the gate on purpose, on the grounds that a
 * judge who has read another writer begins measuring against their voice. So the rule rested on the
 * text being absent from the drafting prompt — which it is, until a session calls
 * `get_reference_posts`, as CLAUDE.md explicitly invites it to. After that the words are in context
 * and nothing downstream looks.
 *
 * This looks. It answers one question: does this draft contain a run of words that has appeared,
 * exactly, in a post by one of the eight.
 *
 * WHAT IT IS NOT
 *
 * Not a similarity score and not a paraphrase detector. Two posts about pricing will always look
 * alike to an embedding, and dedup.ts says so in its own thresholds: "two different stories on the
 * same theme top out at 0.64". Resemblance of topic is not the offence. A recognisable run of
 * somebody else's words is, and that is an exact-match question, so it gets an exact-match answer
 * with no threshold to tune and no judgement to get wrong.
 *
 * WHY IT HOLDS HASHES AND NOT SENTENCES
 *
 * Shipping their sentences in order to catch their sentences would hand the drafter the very thing
 * the design withholds, and reference-split.test.ts would be right to fail the build. A hash of a
 * seven-word run cannot be read, quoted or paraphrased from.
 *
 * The only text this module ever returns is taken from the draft it was given. When the check fires
 * that run is, by definition, also the reference writer's — but the caller is holding it already,
 * because it is in the draft they just submitted. Naming it adds nothing they did not have and is
 * the only way to say which words to remove. What never happens is this module revealing a run the
 * caller had not already written down.
 *
 * SEVEN WORDS
 *
 * Long enough that ordinary English does not collide, short enough to catch a lifted clause. Six
 * catches idiom; eight lets a lightly reworded opening through.
 *
 * Pure, sync, and import-free, so it runs in Deno beside cc-submit and in Node beside the MCP tools
 * without a second implementation to drift from this one.
 */

/** Runs shorter than this are ordinary English, not anybody's writing. */
export const SHINGLE_WORDS = 7;

/** Fixed width, so a hash is the same length however small the number inside it happened to be. */
export const HASH_WIDTH = 11;

/**
 * The same normalisation claims.ts applies, plus punctuation removal.
 *
 * It has to agree with claims.ts on smart quotes and dashes or the two modules would disagree about
 * whether the same sentence is the same sentence. Punctuation goes further here because a borrowed
 * clause is still borrowed when the comma moves.
 */
export function normaliseRun(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every overlapping run of `n` words, normalised. */
export function shinglesOf(text: string, n: number = SHINGLE_WORDS): string[] {
  const words = normaliseRun(text).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

/**
 * A 53-bit hash, as fixed-width base 36.
 *
 * Not a cryptographic one, deliberately: SubtleCrypto is async in both runtimes and this has to run
 * inside a synchronous verify. 53 bits against a corpus of 400,000 runs puts the chance of any one
 * run colliding at about 4 in 100 billion, so a draft of 200 words carries a false-positive risk
 * around one in a hundred million. That is far below the rate at which a human reviewer is wrong,
 * which is the standard worth meeting for something that refuses a draft.
 */
export function hashRun(run: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < run.length; i++) {
    const ch = run.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(HASH_WIDTH, "0");
}

/**
 * The runs in this draft that have appeared verbatim in a reference writer's post.
 *
 * Overlapping matches are merged, so a lifted sentence is reported as one borrowed passage rather
 * than as the nine separate seven-word windows inside it. The returned text is the draft's, which is
 * what makes it safe to print in a refusal.
 */
export function borrowedRuns(
  draftBody: string,
  index: Set<string> | null | undefined,
  n: number = SHINGLE_WORDS,
): string[] {
  if (!index || index.size === 0) return [];
  const words = normaliseRun(draftBody).split(" ").filter(Boolean);
  const hits: Array<[number, number]> = [];

  for (let i = 0; i + n <= words.length; i++) {
    if (index.has(hashRun(words.slice(i, i + n).join(" ")))) {
      const last = hits[hits.length - 1];
      if (last && i <= last[1]) last[1] = i + n;
      else hits.push([i, i + n]);
    }
  }

  return hits.map(([from, to]) => words.slice(from, to).join(" "));
}
