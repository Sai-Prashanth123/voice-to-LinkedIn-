/**
 * A busy provider must cost seconds, not a person's afternoon.
 *
 * Josh's interview questions took an average of 5.6 attempts and up to 23 minutes 39 seconds on
 * 22 September, every one of them a gemini 503 that was over within a second. These cover the two
 * decisions behind the fix, imported from the module that makes them rather than restated here.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { retryableStatus, shouldHandOver } from "./llm.ts";

Deno.test("a busy or rate-limited provider is retried; a refused request is not", () => {
  assertEquals(retryableStatus(503), true, "gemini's overloaded response, the one Josh hit");
  assertEquals(retryableStatus(429), true, "rate limited");
  assertEquals(retryableStatus(500), true);
  assertEquals(retryableStatus(502), true);

  assertEquals(retryableStatus(400), false, "a malformed request fails the same however long we wait");
  assertEquals(retryableStatus(404), false);
  assertEquals(retryableStatus(200), false);
});

Deno.test("another provider is tried only when this one FAILED", () => {
  assertEquals(shouldHandOver("TRANSIENT gemini 503: overloaded"), true);
  assertEquals(shouldHandOver("TRANSIENT gemini 429 (tried 4 keys): rate limited"), true);
  assertEquals(shouldHandOver("TRANSIENT openrouter 402: insufficient credits"), true);

  // These come back identically from every provider, so handing over would turn one clear failure
  // into three slow ones.
  assertEquals(shouldHandOver("gemini 400: json_schema is invalid"), false);
  assertEquals(shouldHandOver("gemini returned no content"), false);
  assertEquals(shouldHandOver("could not create moment: null value in column"), false);
});
