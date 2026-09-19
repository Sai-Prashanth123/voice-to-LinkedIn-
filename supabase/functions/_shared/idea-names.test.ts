import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cleanName, firstWords, ideaLabel, MAX_NAME } from "./idea-names.ts";

Deno.test("a name is tidied, not rewritten", () => {
  assertEquals(cleanName('  "CFO reads the first line."  '), "CFO reads the first line");
  assertEquals(cleanName("onboarding   felt like\ntaxes"), "onboarding felt like taxes");
  assertEquals(cleanName("“Filing taxes”"), "Filing taxes");
  // Case and wording are theirs.
  assertEquals(cleanName("the SEC questionnaire"), "the SEC questionnaire");
});

Deno.test("an idea is never referred to by its internal code", () => {
  assertEquals(ideaLabel({ title: "Filing taxes" }), '"Filing taxes"');
  assertEquals(ideaLabel({ title: null }).includes("M-"), false);
});

Deno.test("the length limit matches the database constraint", () => {
  assertEquals(MAX_NAME, 80);
});

/*
 * autoName's own path needs a database and a model, so what is tested here is the part that must
 * hold when both are unavailable: the capture still gets a handle, built from their words.
 *
 * The real function is exported and called here rather than reimplemented: a test that holds a copy
 * of the thing it tests can only ever agree with itself.
 */
Deno.test("the fallback handle is the person's own opening words, cut at a word boundary", () => {
  assertEquals(firstWords("lost a deal today"), "lost a deal today");

  const long = firstWords(
    "a prospect told me our onboarding felt like filing taxes and we rebuilt the first call",
  );
  assertStringIncludes(long, "a prospect told me our onboarding");
  assertEquals(long.length <= 48, true);
  assertEquals(long.endsWith(" "), false);

  // A single unbroken run of characters still yields something rather than nothing.
  assertEquals(firstWords("x".repeat(90)).length, 48);
});
