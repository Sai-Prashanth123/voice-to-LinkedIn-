import { test } from "node:test";
import assert from "node:assert/strict";
import { announcement, DECLARED } from "./providers.ts";

/**
 * THE DOCUMENT AND THE CODE CANNOT DRIFT APART SILENTLY.
 *
 * 15.1 makes the tool list a deliverable. It went wrong the ordinary way: the list was written once,
 * accurately, and then the system changed underneath it. Anthropic and OpenAI stayed on the list
 * without ever being keyed; Groq and Hugging Face ran the drafter, the gate and the embeddings
 * without appearing on it. Nothing failed, because nothing was checking.
 *
 * This is the check. It reads the tool table Josh actually receives and fails if it disagrees with
 * `DECLARED`, which is the list the running system compares itself against. Adding a provider to one
 * and not the other now breaks the build instead of surfacing on a bill.
 */

const DOC = "docs/01-recommendations.md";

/** The service names out of the markdown table in section 2, lowercased. */
function declaredInDoc(markdown: string): Set<string> {
  const section = markdown.split(/^## /m).find((s) => s.startsWith("2. The full tool list"));
  assert.ok(section, `${DOC} no longer has a "## 2. The full tool list" section`);

  const names = new Set<string>();
  for (const line of section.split("\n")) {
    // | **Supabase** (Pro) | what it does | $25/mo |
    const cell = /^\|\s*\*\*([^*]+)\*\*/.exec(line.trim());
    if (!cell) continue;
    // "LinkedIn developer app" -> linkedin; "Vercel" -> vercel; "Hugging Face" -> huggingface
    names.add(cell[1].trim().toLowerCase().replace(/\s+/g, "").replace(/developerapp$/, ""));
  }
  return names;
}

test("the tool list Josh holds matches the list the system checks itself against", async () => {
  const markdown = await Deno.readTextFile(DOC);
  const inDoc = declaredInDoc(markdown);
  const inCode = new Set(Object.keys(DECLARED));

  const missingFromDoc = [...inCode].filter((n) => !inDoc.has(n));
  const missingFromCode = [...inDoc].filter((n) => !inCode.has(n));

  assert.deepEqual(
    missingFromDoc,
    [],
    `these are declared in providers.ts but absent from ${DOC}, so Josh has not been told about ` +
      `them: ${missingFromDoc.join(", ")}`,
  );
  assert.deepEqual(
    missingFromCode,
    [],
    `these appear in ${DOC} but not in providers.ts, so the system would announce them as ` +
      `undeclared: ${missingFromCode.join(", ")}`,
  );
});

test("every declared service says what it does, because 15.1 asks for that too", () => {
  for (const [name, does] of Object.entries(DECLARED)) {
    assert.ok(does.trim().length > 20, `"${name}" needs a real description, not "${does}"`);
  }
});

test("the announcement names the service, what it does and when it started", () => {
  const text = announcement([
    { provider: "groq", purposes: ["drafting", "gate"], firstSeen: "2026-08-24T10:00:00Z" },
  ]);

  assert.match(text, /groq/);
  assert.match(text, /drafting, gate/);
  assert.match(text, /24 August/);
  // 15.3's whole point: the bill must not be how he finds out.
  assert.match(text, /statement/i);
});

test("more than one reads as a list rather than as one run-on sentence", () => {
  const text = announcement([
    { provider: "groq", purposes: ["drafting"], firstSeen: "2026-08-24T10:00:00Z" },
    { provider: "huggingface", purposes: ["embeddings"], firstSeen: "2026-08-25T10:00:00Z" },
  ]);
  assert.match(text, /2 services are/);
  assert.equal(text.split("\n").filter((l) => l.trim().startsWith("groq") ||
    l.trim().startsWith("huggingface")).length, 2);
});
