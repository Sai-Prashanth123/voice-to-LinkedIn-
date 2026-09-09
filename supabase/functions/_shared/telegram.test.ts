/**
 * Who the bot answers.
 *
 * This is the only thing standing between the idea bank and anyone who finds the bot, and it used
 * to be a single string comparison. The failure it now has to avoid is subtle: a list that fails
 * OPEN on an unset variable would authorise the world, and would look identical in every test that
 * only checked the happy path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorised, joshChatId } from "./telegram.ts";

/** secret() reads from a cache the workers fill; the tests drive it through the environment. */
function withChatId(value: string | undefined, fn: () => void) {
  const before = Deno.env.get("TELEGRAM_CHAT_ID");
  if (value === undefined) Deno.env.delete("TELEGRAM_CHAT_ID");
  else Deno.env.set("TELEGRAM_CHAT_ID", value);
  try {
    fn();
  } finally {
    if (before === undefined) Deno.env.delete("TELEGRAM_CHAT_ID");
    else Deno.env.set("TELEGRAM_CHAT_ID", before);
  }
}

test("one id still works, exactly as before", () => {
  withChatId("12345", () => {
    assert.equal(isAuthorised(12345), true);
    assert.equal(isAuthorised(99999), false);
  });
});

test("two ids both work, which is what makes a handover possible", () => {
  // Before this, giving the bot to Josh meant taking it from whoever was testing — and the loser
  // got total silence, indistinguishable from a broken bot.
  withChatId("12345, 67890", () => {
    assert.equal(isAuthorised(12345), true);
    assert.equal(isAuthorised(67890), true);
    assert.equal(isAuthorised(11111), false);
  });
});

test("whitespace and trailing commas do not authorise nobody", () => {
  withChatId(" 12345 , 67890 , ", () => {
    assert.equal(isAuthorised(67890), true);
  });
});

test("an unset or empty list authorises NOBODY", () => {
  // FAILS CLOSED. A list that treated empty as "allow all" would look correct in every other test
  // here and open the bank to anyone who found the bot.
  withChatId(undefined, () => assert.equal(isAuthorised(12345), false));
  withChatId("", () => assert.equal(isAuthorised(12345), false));
  withChatId("  ,  ", () => assert.equal(isAuthorised(12345), false));
});

test("an empty entry does not match an empty-ish chat id", () => {
  withChatId("12345,,67890", () => {
    assert.equal(isAuthorised(0), false);
    assert.equal(isAuthorised(NaN as unknown as number), false);
  });
});

test("the system sends to the FIRST id, not to all of them", () => {
  // Reading is shared during a handover; writing is not. Broadcasting a draft to every authorised
  // chat would put Josh's unpublished writing in front of whoever else was testing.
  withChatId("12345,67890", () => assert.equal(joshChatId(), 12345));
});

test("sending with no id configured throws rather than guessing", () => {
  withChatId("", () => assert.throws(() => joshChatId(), /TELEGRAM_CHAT_ID/));
});
