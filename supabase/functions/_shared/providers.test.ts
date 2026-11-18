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

/*
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE LEDGER SAYS WHO ANSWERED, NOT WHO WAS CONFIGURED — 18 November 2026.
 *
 * Everything above holds the DECLARED list against the document. This holds the recorded list
 * against reality, which is the other half of 15.3 and was wrong the whole time.
 *
 * `record()` stamped every row with `provider()` — the LLM_PROVIDER secret, i.e. process
 * configuration. The fallback chain had already handed the call to somebody else. Measured on the
 * live project: rows reading `provider: "gemini"` against models "openai/gpt-oss-120b" and
 * "openai/gpt-oss-20b", which only Groq serves.
 *
 * Worse than a value nothing reads: a value that reads back a confident wrong answer. The header
 * on `withFallback` asserted the opposite of what the code did, in writing, for weeks.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

const LLM = Deno.readTextFileSync("supabase/functions/_shared/llm.ts");

test("the recorded provider is the one that answered, not the one configured", () => {
  const fn = LLM.slice(LLM.indexOf("async function record("), LLM.indexOf("function purposeOf("));
  assert.ok(fn.length > 400, "record() is not where this test expects it");

  assert.match(fn, /provider: answeredBy,/, "the row is not stamped with the answering provider");
  assert.ok(
    !/provider:\s*provider\(\)/.test(fn),
    "record() still stamps the CONFIGURED provider, so a Groq fallback is billed to Gemini",
  );
  // 15.3 is about what Josh is TOLD, and noteProvider is the half he reads.
  assert.match(fn, /noteProvider\(db, answeredBy,/, "Josh is still told the configured provider");
  assert.ok(
    !/noteProvider\(db, provider\(\)/.test(fn),
    "the provider announcement still names the configured service",
  );
});

test("every call site names who answered, and none of them can guess", () => {
  const sites = LLM.match(/await record\(acc\.db, opts, model, [^,]+,/g) ?? [];
  assert.equal(sites.length, 8, `expected 8 record() call sites, found ${sites.length}`);

  for (const site of sites) {
    // Either the provider object's own name, or the literal for the direct Anthropic client.
    assert.match(
      site,
      /model, (p\.name|"anthropic"),/,
      `a record() call passes something other than the answering provider: ${site}`,
    );
  }

  // And the parameter is typed, so a misspelling cannot become a new provider in the ledger —
  // noteProvider takes a bare string and would have accepted one for ever.
  assert.match(LLM, /answeredBy: ProviderName,/, "the answering provider is not a typed name");
});

test("the provider is never inferred from the model name", () => {
  // "openai/gpt-oss-120b" is served by Groq. Any rule that reads the model string would call it
  // OpenAI, which is a service this system has never been keyed for. providers.ts forbids it and
  // the fix must not have quietly introduced it.
  const fn = LLM.slice(LLM.indexOf("async function record("), LLM.indexOf("function purposeOf("));
  assert.ok(
    !/model\.(startsWith|includes|split|match)/.test(fn),
    "record() inspects the model name to decide the provider, which providers.ts forbids",
  );
});

test("withFallback's claim about the ledger is now true", () => {
  // The comment promised "a month where Groq covered an outage shows Groq". It is quoted here so
  // that if the behaviour is ever reverted, the sentence and the test fail together rather than
  // the sentence surviving alone — which is how it went wrong the first time.
  // The sentence wraps across comment lines, so the gap tolerates a newline and a ` * `.
  assert.match(LLM, /a month where Groq\s*\*?\s*covered an outage shows Groq/);
  assert.match(LLM, /return await call\(provider\)/, "withFallback no longer passes the provider");
});
