/**
 * Is this message entirely courtesy, with nothing of his work in it?
 *
 * MOVED OUT OF THE WEBHOOK, AND WHY THAT MATTERED
 *
 * It lived inside telegram-webhook/index.ts, which is a deployed function rather than a module. Its
 * own test already had to import from that function to reach it, and on 5 October the transcribe
 * worker needed it too: a voice note cannot be checked for courtesy at capture, because at capture
 * there are no words. A worker importing a webhook to borrow one predicate is the kind of edge that
 * eventually gets copied instead, and this repo has lost a day to each of its copied definitions.
 *
 * So: one definition here, re-exported from the webhook so nothing that already imported it breaks.
 */
export function isChatter(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;

  // A bare @handle: somebody told to message @userinfobot who pasted it here instead. It happened
  // twice and both are permanent entries in the bank, because 6.3 does not care how it got there.
  if (/^@[A-Za-z0-9_]{3,}$/.test(t)) return true;

  // A typo correction on its own line — "post*", "*posts". Only when the whole message is one
  // starred word: "post* ideas" is somebody correcting themselves mid-thought and is material.
  if (/^\*?[\p{L}]+\*$|^\*[\p{L}]+$/u.test(t)) return true;

  // Emoji-only replies ("👍") are acknowledgements too.
  if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u.test(t)) return true;

  // Chatter is a message made ENTIRELY of courtesy words, checked token by token. A single-token
  // regex misses "okay thanks" — which is the exact phrase that created a junk moment.
  //
  // Any word outside the set means there is something real in there and it becomes a moment, so
  // "no one asked about pricing" and "ok so the demo fell over" both survive.
  const COURTESY = new Set([
    "ok", "okay", "k", "kk", "thanks", "thank", "you", "thankyou", "ty", "ta", "cool", "nice",
    "great", "good", "got", "it", "sure", "fine", "yep", "yup", "yeah", "yes", "no", "nope",
    "done", "perfect", "lovely", "cheers", "np", "worries", "alright", "brilliant", "super",
    // GREETINGS, absent until "Hello" became M-000030 and then M-000033. The set was built from
    // acknowledgement-after-the-fact — "okay thanks" — and at that point nobody had said hello to
    // it. A list assembled from one incident only covers that incident.
    "hi", "hey", "hello", "hiya", "yo", "morning", "afternoon", "evening", "gm", "howdy",
    "there", "sorry", "please", "welcome", "bye", "goodbye", "night",
    // "Cheers mate" came back as material from a voice note on 5 October. He is Australian and the
    // address is part of the courtesy, not a topic. A message still has to be ENTIRELY courtesy
    // words, so "mate, the demo fell over" is untouched.
    "mate", "man", "dude", "buddy",
  ]);

  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => COURTESY.has(w));
}
