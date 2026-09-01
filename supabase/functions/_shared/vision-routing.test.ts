/**
 * Image requests must reach a model that can actually see them.
 *
 * Two failures this guards against, both of which have already happened once:
 *
 *   1. The visual rebuild being handed a model that returns 429 for anything containing an image,
 *      and reporting it as a quality failure five times over.
 *   2. The swap leaking — a text call quietly going to the cheap vision model because the rule was
 *      written as "on Gemini, use flash-lite" rather than "for an image, use flash-lite".
 *
 * The second is the one that would not be noticed. Every draft would still get written; they would
 * just be written by the wrong model, and nothing in the output would say so.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPAT, modelFor } from "./llm.ts";

const IMAGE = {
  role: "user",
  content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "text", text: "rebuild this" },
  ],
};
const TEXT = { role: "user", content: "just words" };
const TEXT_BLOCKS = { role: "user", content: [{ type: "text", text: "words in a block" }] };

// deno-lint-ignore no-explicit-any
const call = (messages: any[], model = "STRONG") =>
  ({ model, system: "", messages, purpose: "test" } as never);

test("an image request goes to the vision model", () => {
  assert.equal(modelFor(COMPAT.gemini, call([IMAGE])), COMPAT.gemini.visionModel);

  // Deliberately NOT asserting that the vision model differs from the role model. It did when
  // STRONG was a full flash model that returns 429 for images; it does not now that the free
  // tier's daily cap has pushed every tier down to flash-lite, which sees images itself. The
  // routing is what must hold — whether it currently changes anything is a fact about the tier.
  assert.ok(COMPAT.gemini.visionModel, "the swap is declared, so it still works if STRONG moves up");
});

test("a text request keeps the role model — the swap must not leak", () => {
  assert.equal(modelFor(COMPAT.gemini, call([TEXT])), COMPAT.gemini.models.STRONG);
  assert.equal(modelFor(COMPAT.gemini, call([TEXT_BLOCKS])), COMPAT.gemini.models.STRONG);
});

test("the swap is scoped to the provider that needs it", () => {
  // Groq and Hugging Face carry no images at all, so there is nothing to route.
  assert.equal(modelFor(COMPAT.groq, call([IMAGE])), COMPAT.groq.models.STRONG);
  assert.equal(modelFor(COMPAT.huggingface, call([IMAGE])), COMPAT.huggingface.models.STRONG);
});

test("the role is still honoured for text on every provider", () => {
  for (const name of ["groq", "huggingface", "gemini"] as const) {
    for (const role of ["STRONG", "MID", "CHEAP"] as const) {
      assert.equal(
        modelFor(COMPAT[name], call([TEXT], role)),
        COMPAT[name].models[role],
        `${name} ${role}`,
      );
    }
  }
});

test("only providers that can see images declare a vision model", () => {
  for (const [name, p] of Object.entries(COMPAT)) {
    if (p.visionModel) {
      assert.equal(p.vision, true, `${name} routes images but says it cannot carry them`);
    }
  }
});
