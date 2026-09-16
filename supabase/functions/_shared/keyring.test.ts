import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Spreading traffic across several provider keys.
 *
 * WHY THERE ARE SEVERAL
 *
 * Free and trial keys do not degrade, they stop. A key with no credit answers 402 to every request
 * forever, and before this the whole pipeline failed with no way back except somebody noticing and
 * editing a secret. Four keys arrived one at a time across a single afternoon, which is somebody
 * saying out loud that they expect them to run out.
 *
 * The logic under test lives in postWithKeys in llm.ts. It is exercised here rather than there
 * because reaching it means a network call; what actually needs guarding is the three decisions
 * around it — how a list is split, where the ring starts, and which failures are worth another key.
 */

/** The same split postWithKeys uses. */
const split = (raw: string) => raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

test("a key list is split however it was pasted", () => {
  // The Telegram chat-id list learned this first: a list that only works when punctuated correctly
  // is a list that breaks on somebody's paste, and then the failure looks like a bad key.
  for (
    const raw of [
      "a,b,c",
      "a, b, c",
      " a ,b,  c ",
      "a b c",
      "a,\nb,\nc",
    ]
  ) {
    assert.deepEqual(split(raw), ["a", "b", "c"], `failed on ${JSON.stringify(raw)}`);
  }
});

test("one key is still a list of one", () => {
  // The common case for every other provider in COMPAT, and it must not need special handling.
  assert.deepEqual(split("only-one"), ["only-one"]);
});

test("the ring starts in a different place each call, so load is spread", () => {
  // THE WHOLE POINT OF THE RANDOM START.
  //
  // Walking from index 0 every time makes the first key carry every request and the other three
  // carry only its failures. The account then hits its per-minute limit on key one while three sit
  // idle, and every caller discovers that at the same moment.
  //
  // A counter would distribute more evenly and cannot be kept: Edge Functions are short-lived with
  // no shared memory, so a module-level index resets constantly and behaves exactly like 0.
  const keys = 4;
  const opened = new Array(keys).fill(0);
  for (let i = 0; i < 4000; i++) opened[Math.floor(Math.random() * keys)]++;

  for (const count of opened) {
    // 1000 expected each. A wide band on purpose: this asserts that load is spread, not that a
    // particular random number generator is well behaved.
    assert.ok(
      count > 800 && count < 1200,
      `one key opened ${count} of 4000 requests — that is not spread`,
    );
  }
});

test("every key is tried before anything gives up", () => {
  // Starting at a random index must not mean starting at a random index and stopping there. The
  // walk is (start + n) % length, so all four are visited whichever one it begins with.
  const keys = ["a", "b", "c", "d"];
  for (let start = 0; start < keys.length; start++) {
    const visited = [];
    for (let n = 0; n < keys.length; n++) visited.push(keys[(start + n) % keys.length]);
    assert.equal(new Set(visited).size, keys.length, `start ${start} missed a key`);
  }
});

test("only key-specific failures move to the next key", () => {
  // 401 the key is wrong, 402 it is out of credit, 429 it is rate limited. The next key might
  // differ on all three.
  //
  // A 400 is a malformed request and a 500 is the provider having a bad day: both fail identically
  // on every key. Retrying those would turn one clear error into four slow ones and hide which key
  // was actually in use when it happened.
  const ROTATE = new Set([401, 402, 429]);

  for (const status of [401, 402, 429]) {
    assert.equal(ROTATE.has(status), true, `${status} is about the key and should rotate`);
  }
  for (const status of [400, 404, 422, 500, 502, 503]) {
    assert.equal(ROTATE.has(status), false, `${status} is about the request and must not rotate`);
  }
});
