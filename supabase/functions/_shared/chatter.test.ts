import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors isChatter() in telegram-webhook/index.ts.
 *
 * Kept as a test because the filter has an asymmetric cost. Letting a courtesy reply through creates
 * a junk moment that 6.3 forbids the system from ever deleting — annoying but visible. Swallowing a
 * real thought loses material Josh will never think to send twice, and he would never know. So the
 * bar is: reject only messages that are ENTIRELY acknowledgement.
 */
function isChatter(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u.test(t)) return true;

  const COURTESY = new Set([
    "ok", "okay", "k", "kk", "thanks", "thank", "you", "thankyou", "ty", "ta", "cool", "nice",
    "great", "good", "got", "it", "sure", "fine", "yep", "yup", "yeah", "yes", "no", "nope",
    "done", "perfect", "lovely", "cheers", "np", "worries", "alright", "brilliant", "super",
  ]);

  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => COURTESY.has(w));
}

test("courtesy replies are not moments", () => {
  for (
    const t of [
      "Okay thanks", // the one that actually happened
      "ok",
      "Thanks!",
      "thank you",
      "got it",
      "cheers",
      "yep",
      "No",
      "  Perfect.  ",
      "👍",
      "🙏🙏",
      "",
    ]
  ) {
    assert.equal(isChatter(t), true, `should have been treated as chatter: ${JSON.stringify(t)}`);
  }
});

test("short real thoughts still become moments", () => {
  for (
    const t of [
      "lost a deal today",
      "no one asked about pricing",           // starts with "no"
      "ok so the demo fell over live",        // starts with "ok"
      "yes and then he walked out",           // starts with "yes"
      "great call with a founder just now",   // starts with "great"
      "done with discovery calls forever",    // starts with "done"
      "thanks to Priya I finally get it",     // starts with "thanks"
      "fine, I was wrong about the pricing",  // starts with "fine"
      "CFO stopped me mid-deck",
    ]
  ) {
    assert.equal(isChatter(t), false, `should have been kept as material: ${JSON.stringify(t)}`);
  }
});

test("an emoji attached to real words is still material", () => {
  assert.equal(isChatter("👍 shipped the pricing page"), false);
});
