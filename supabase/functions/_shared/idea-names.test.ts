import { assertEquals } from "jsr:@std/assert@1";
import { cleanName, ideaLabel, MAX_NAME, namePrompt } from "./idea-names.ts";

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
  assertEquals(namePrompt("a prospect said onboarding felt like filing taxes", true).includes("M-"), false);
});

Deno.test("the prompt for an older idea quotes what it is about", () => {
  const p = namePrompt("a prospect said onboarding felt like filing taxes", false);
  assertEquals(p.includes("filing taxes"), true);
  assertEquals(p.includes("What should we call it?"), true);
});

Deno.test("the length limit matches the database constraint", () => {
  assertEquals(MAX_NAME, 80);
});
