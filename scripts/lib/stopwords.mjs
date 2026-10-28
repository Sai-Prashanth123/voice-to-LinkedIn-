/**
 * Words that carry no topic, for the vocabulary contrasts.
 *
 * Lifted out of scripts/build-voiceprint.mjs on 28 October so that the script WRITING the contrast
 * and the tool READING it filter with the same set. They have to: the stored artefact was computed
 * on 2026-09-08 against a 59-post corpus that is not on disk any more, so it carries the list
 * unfiltered and measure_draft filters it again at read time. Two copies of this set would let the
 * builder and the reader disagree about which words are function words, and both would still be
 * reporting "the measurement".
 *
 * Import-free on purpose, like scripts/lib/prose.mjs beside it, so it loads unchanged under Node in
 * a clone and under Deno on the hosted connector.
 */

/**
 * Words that carry no topic — the stopword pass the PEER list never got.
 *
 * WHY THIS IS A SECOND LIST AND NOT AN ADDITION TO SPEECH_ONLY
 *
 * SPEECH_ONLY exists because the contrast is speech against writing, and its argument — "left in,
 * they would crowd out the words that actually distinguish him" — was applied to `signature` and
 * `spokenFiller` and never to `avoided`. Nobody made the case for the peer list, so nobody made it.
 *
 * The case is the same one, and it is stronger, because `avoided` has no ratio floor protecting it.
 * `signature` is ranked by `distinctive()`, where a word has to beat the peer rate to appear at
 * all. `avoided` is raw rate: count >= 12 in their corpus and `mineRate * 3 < theirRate`. Written
 * register uses more subordination and more possessives than speech does, for everybody, so
 * function words clear that bar trivially — and they did. Measured on the stored 2026-09-08
 * contrast, 7 of the 25 entries were `your, by, who, every, same, down, before`, and a draft was
 * told it was "drifting toward their voice" for containing the word "who".
 *
 * THE MEMBERSHIP TEST, which is narrower than "common word"
 *
 * A word belongs here only if it carries no topic: an article, determiner, pronoun, preposition,
 * conjunction, auxiliary, modal or degree word. A word he could be talking ABOUT stays, which is
 * the same test SPEECH_ONLY states for "consulting" and "Melbourne".
 *
 * The list is written from those categories rather than from the output it produces, deliberately.
 * A stoplist reverse-engineered from one run's 25 entries would be a judgement about those 25
 * dressed up as a rule, and the next corpus would need the judgement made again.
 *
 * WHAT THIS DOES NOT FIX, said here because the list looks finished afterwards and is not.
 *
 * After the filter most of what survives is the material's own domain vocabulary — `sales`,
 * `marketing`, `ads`, `revenue`, `pipeline`, `content`, `target`, `cpa`, `day`, `days`. Those are
 * not function words and they are not removed, because removing them would be a judgement about
 * what Josh's subject is rather than a measurement. They score because of a CORPUS MISMATCH: his
 * side is six calls about building this system, theirs is his market writing about his market. The
 * honest answer is to say so where the list is read, not to prune it by taste — so measure_draft
 * reports that limitation beside the list rather than this script hiding it.
 */
export const FUNCTION_WORDS = new Set([
  // Determiners and quantifiers.
  "a", "an", "the", "this", "that", "these", "those", "each", "every", "all", "both", "either",
  "neither", "any", "some", "such", "another", "other", "others", "same", "own", "few", "fewer",
  "many", "most", "more", "less", "least", "much", "several", "enough", "half", "whole", "next",
  "last", "first", "second",
  // Pronouns, including the possessives written register reaches for and speech does not.
  "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "ourselves", "you", "your",
  "yours", "yourself", "he", "him", "his", "she", "her", "hers", "it", "its", "itself", "they",
  "them", "their", "theirs", "themselves", "who", "whom", "whose", "which", "what", "someone",
  "somebody", "anyone", "anybody", "everyone", "everybody", "nobody", "something", "anything",
  "everything", "nothing",
  // Prepositions and particles.
  "about", "above", "across", "after", "against", "along", "among", "around", "as", "at",
  "before", "behind", "below", "beneath", "beside", "between", "beyond", "but", "by", "down",
  "during", "except", "for", "from", "in", "inside", "into", "near", "of", "off", "on", "onto",
  "out", "outside", "over", "past", "per", "since", "than", "through", "throughout", "to",
  "toward", "towards", "under", "until", "up", "upon", "via", "with", "within", "without",
  // Conjunctions and the subordinators that carry a clause and no topic.
  "and", "or", "nor", "so", "yet", "because", "although", "though", "while", "whilst", "whereas",
  "unless", "if", "whether", "when", "whenever", "where", "wherever", "why", "how",
  // Auxiliaries and modals.
  "be", "am", "is", "are", "was", "were", "been", "being", "have", "has", "had", "having", "do",
  "does", "did", "doing", "will", "would", "shall", "should", "can", "could", "may", "might",
  "must", "ought",
  // Degree, place and time adverbs with no subject of their own.
  "very", "too", "quite", "rather", "almost", "nearly", "also", "just", "only", "even", "still",
  "again", "ever", "never", "always", "often", "sometimes", "usually", "here", "there", "then",
  "now", "soon", "already", "back", "away", "yes", "no", "not",
]);

