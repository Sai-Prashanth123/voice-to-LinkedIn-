import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The chatter filter, tested against THE REAL FUNCTION.
 *
 * This file used to carry a hand-copied duplicate of isChatter and test the copy. It passed
 * cheerfully while the real one let "Hello" through twice, because a copy cannot diverge from
 * itself. The duplicate is gone and the import is the point of the file.
 *
 * The filter has an asymmetric cost, which is what sets the bar. Letting a courtesy reply through
 * creates a junk moment that 6.3 forbids the system from ever deleting - annoying but visible.
 * Swallowing a real thought loses material Josh will never think to send twice, and he would never
 * know. So: reject only messages that are ENTIRELY acknowledgement.
 */

import { isChatter } from "../telegram-webhook/index.ts";

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

/**
 * THE FOUR STRINGS FROM THE SCREENSHOT.
 *
 * Every one of these became a permanent idea-bank entry. They are the acceptance criteria for this
 * change because they are what actually happened, not what somebody imagined might.
 */
test("the messages that filled the bank with junk are chatter", () => {
  for (
    const t of [
      "Hello", // M-000030, and again as M-000033
      "@userinfobot", // M-000031 and M-000032 — pasted instead of messaged
      "post*", // M-000034 — a typo correction
      "hi",
      "Hey",
      "good morning",
      "sorry",
    ]
  ) {
    assert.equal(isChatter(t), true, `"${t}" should not become a moment`);
  }
});

test("a greeting attached to a real thought is still material", () => {
  // The whole risk of widening the list. "Hi" is chatter; "Hi, we lost the renewal" is not, and
  // losing the second to catch the first would be a far worse trade than the one being fixed.
  for (
    const t of [
      "Hi, we lost the renewal today",
      "morning — the CFO stopped me four minutes in",
      "hello again, that pricing call went sideways",
      "post mortem on the demo: nobody could describe what it did",
      "sorry I missed your question about the pipeline",
    ]
  ) {
    assert.equal(isChatter(t), false, `"${t}" must still become a moment`);
  }
});
