/**
 * The parser reads Josh's own document, so a question that silently stops matching disappears from
 * the bank with nothing to show it ever existed. These assert counts per set rather than "something
 * parsed", because "something parsed" is true right up until half his questions vanish.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { parsePromptSet } from "./questions.ts";

// The shape of his v1.0: four sets, a depth ladder inside set 1, categories inside set 3.
const PROMPT_SET = `# The prompt set

| Set | Job | Runs when |
|---|---|---|
| 1. Mining a moment | Turn a sentence into something only he could have written | After every input |

## Set 1 — mining a moment

### First, how deep does the material go

#### Depth 1 — a specific scene

- Was there a specific moment where this actually happened?
- Who was in the room when it happened?

#### Depth 2 — time-anchored

- What month was that, roughly?

## Set 2 — the weekly sweep

1. What happened this week that surprised you, even slightly?
2. What did you have to work out that you did not know before?
3. What did a client or a colleague say that stuck with you?

## Set 3 — the longer sitting

### Recent moments

- Did a client do or say something you did not expect?

### Wins and progress

- What worked recently, even something small?

## Set 4 — the thirty prompts

1. A client said something in passing that changed how you run engagements. What did they say?
2. A mistake inside the method itself. What did you get wrong?

## How to edit this

Write each question as a bullet, and give it a question mark.
`;

const parsed = parsePromptSet(PROMPT_SET);
const inSet = (set: string) => parsed.filter((q) => q.set === set);

Deno.test("each question carries the set it was written for", () => {
  assertEquals(inSet("mine").length, 3);
  assertEquals(inSet("sweep").length, 3);
  assertEquals(inSet("sitting").length, 2);
  assertEquals(inSet("thirty").length, 2);
});

Deno.test("the weekly sweep's questions are his, in his order", () => {
  assertEquals(inSet("sweep").map((q) => q.text), [
    "What happened this week that surprised you, even slightly?",
    "What did you have to work out that you did not know before?",
    "What did a client or a colleague say that stuck with you?",
  ]);
});

Deno.test("set 1 keeps its depth ladder", () => {
  const depths = inSet("mine").map((q) => q.depth);
  assertEquals(depths, ["scene", "scene", "time_anchored"]);
});

Deno.test("set 3's questions know which category they sit under", () => {
  assertEquals(inSet("sitting").map((q) => q.category), ["Recent moments", "Wins and progress"]);
});

Deno.test("a set number is what identifies a set, not the words after the dash", () => {
  const renamed = parsePromptSet("## Set 2 — Monday questions\n\n- What surprised you this week?\n");
  assertEquals(renamed[0].set, "sweep");
});

Deno.test("prose after the last set does not inherit it", () => {
  // "Write each question as a bullet, and give it a question mark." is an instruction, and it sits
  // under its own heading. If it parsed at all it must not arrive tagged `thirty`.
  const strays = parsed.filter((q) => q.text.startsWith("Write each question"));
  assertEquals(strays.map((q) => q.set), strays.map(() => null));
});

Deno.test("a question is keyed by its wording, so the same line is the same row", () => {
  const again = parsePromptSet(PROMPT_SET);
  assertEquals(parsed.map((q) => q.key), again.map((q) => q.key));
  assertEquals(new Set(parsed.map((q) => q.key)).size, parsed.length);
});
