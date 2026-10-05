/**
 * Josh's sweep of 5 October, as a test.
 *
 * Five voice notes in four minutes. One was a moment and became a post that cleared the gate. The
 * other four became idea bank entries that should never have existed, and he was asked an interview
 * question about two of them. These are his actual transcripts.
 *
 * The second half of the file is the part that matters more: the moments that MUST still get through.
 * A rule that throws away one of his real thoughts is far worse than one that keeps a junk entry, so
 * every narrowing here is paid for with a case proving it did not go too far.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isChatter } from "./chatter.ts";
import {
  isQuestionToTheBot,
  judgeTranscript,
  keyWords,
  REPEAT_WINDOW_MS,
  sameThing,
} from "./voice-triage.ts";

/** His five, verbatim from raw_inputs 65-69. */
const SWEEP = {
  moment: "I got a campaign angle from someone doing a campaign angle idea from someone doing " +
    "outreach to me.",
  whatDoYouMean: "What do you mean?",
  askingAboutTheQuestions: "Are these questions that you're asking dynamic in terms of, like, " +
    "responding? Are they written based on the previous... The response that I give?",
  unheard: "",
  repeat: "Like I said, I got a campaign idea from reading someone else's outreach that I... So " +
    "that I received.",
};

const judge = (text: string, recent: { moment_id: number; transcript: string; at: string }[] = []) =>
  judgeTranscript(text, recent, { isChatter });

test("the one real moment is still a moment", () => {
  assert.deepEqual(judge(SWEEP.moment), { kind: "moment" });
});

test('"What do you mean?" is a question to the bot, not an idea', () => {
  assert.equal(isQuestionToTheBot(SWEEP.whatDoYouMean), true);
  assert.equal(judge(SWEEP.whatDoYouMean).kind, "question");
});

test("asking whether the bot's questions are dynamic is a question about the system", () => {
  assert.equal(isQuestionToTheBot(SWEEP.askingAboutTheQuestions), true);
  assert.equal(judge(SWEEP.askingAboutTheQuestions).kind, "question");
});

test("an empty transcription is unheard, and never an idea with no words in it", () => {
  assert.equal(judge(SWEEP.unheard).kind, "unheard");
  assert.equal(judge("   ").kind, "unheard");
});

test("telling the same story again lands on the first idea, not a second one", () => {
  const recent = [{
    moment_id: 80,
    transcript: SWEEP.moment,
    at: new Date(Date.now() - 3 * 60_000).toISOString(),
  }];

  const verdict = judge(SWEEP.repeat, recent);
  assert.equal(verdict.kind, "repeat");
  assert.equal(verdict.kind === "repeat" && verdict.of, 80);

  // Jaccard scored these two 0.42 and would have missed it. Containment is the question being asked.
  assert.ok(sameThing(SWEEP.repeat, SWEEP.moment) >= 0.6);
});

test("the same story told tomorrow is its own idea", () => {
  const recent = [{
    moment_id: 80,
    transcript: SWEEP.moment,
    at: new Date(Date.now() - REPEAT_WINDOW_MS - 60_000).toISOString(),
  }];
  assert.equal(judge(SWEEP.repeat, recent).kind, "moment");
});

/* ── The other direction: what must still get through ─────────────────────── */

test("a question ABOUT HIS WORK is a moment, however it is phrased", () => {
  const moments = [
    "Why did that campaign fail? I think we picked the wrong segment entirely.",
    "How do you tell a client their ICP is wrong without losing the account?",
    "What happened was the prospect replied to the wrong thread and it closed anyway.",
    "Are SDRs even the right team to own this list? I am not sure any more.",
  ];
  for (const t of moments) {
    assert.equal(isQuestionToTheBot(t), false, `treated as a question to the bot: ${t}`);
    assert.equal(judge(t).kind, "moment", `ruled out: ${t}`);
  }
});

test("a short thought with no question in it is a moment", () => {
  for (const t of ["Lost a deal today on pricing.", "The clinician list came back at 15 of 100."]) {
    assert.equal(judge(t).kind, "moment", `ruled out: ${t}`);
  }
});

test("two ideas about the same client are not the same idea", () => {
  // Shares "client" and little else: the overlap must come from the story, not the vocabulary.
  const recent = [{
    moment_id: 90,
    transcript: "The client asked us to rebuild their outbound list from the booking sites.",
    at: new Date().toISOString(),
  }];
  const other = "The client said their CFO killed the renewal over one dashboard nobody opened.";
  assert.equal(judge(other, recent).kind, "moment");
});

test("a coincidental word or two is not a repeat", () => {
  const recent = [{
    moment_id: 91,
    transcript: "Outreach landed badly.",
    at: new Date().toISOString(),
  }];
  // High ratio against a tiny earlier note, which is exactly why a minimum of shared words exists.
  assert.equal(judge("Outreach works when the research is real.", recent).kind, "moment");
});

test("courtesy by voice is still courtesy, and silence is the right answer to it", () => {
  assert.equal(judge("Okay thanks").kind, "chatter");
  assert.equal(judge("Cheers mate").kind, "chatter");
});

test("keyWords keeps the topic and drops the scaffolding", () => {
  const words = keyWords(SWEEP.repeat);
  assert.ok(words.has("campaign"));
  assert.ok(words.has("outreach"));
  // "Like I said" is how he flagged the repeat, and it is not what the post would be about.
  assert.equal(words.has("like"), false);
  assert.equal(words.has("said"), false);
  assert.equal(words.has("got"), false);
});
