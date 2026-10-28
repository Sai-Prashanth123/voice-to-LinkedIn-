/**
 * Jobs: `interview_step` and `interview_extract` — the part that makes the whole thing work.
 *
 * A moment arrives as a sentence or two. This turns it into something only Josh could have written,
 * or establishes honestly that there is nothing there and parks it.
 *
 * The hard limits from clause 5 are enforced HERE, in code, not asked for in the prompt:
 *   5.3  at most one pushback per session      — a prompt asking politely will drift under rewriting
 *   5.8  a question budget well under fifteen  — "a session that runs to fifteen questions gets abandoned"
 *   5.5  the interviewer cannot write prose    — its output schema has no field for a draft
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { callStructured, MODELS } from "../llm.ts";
import { getSetting, logEvent, park } from "../db.ts";
import { enqueue } from "../jobs.ts";
import { loadLibrary, parsePillars } from "../library.ts";
import {
  EXTRACT_SYSTEM,
  INTERVIEWER_SYSTEM,
  NEXT_QUESTION_USER,
  PROMPT_VERSION,
} from "../prompts.ts";
import { creditSession, recordAsked, type SetKey, syncQuestions } from "../questions.ts";
import { type Extraction, ExtractionSchema, NextQuestionSchema } from "../schemas.ts";
import { appendTurn, deepest, loadSession, renderTranscript } from "../session.ts";
import { notice } from "../notices.ts";
import { joshSaid, verifyExtraction } from "../extraction.ts";
import { writingSources } from "./draft.ts";
import { isRealName, unclearedNames } from "../names.ts";
import type { InterviewDepth, Job } from "../types.ts";

/**
 * What choosing the next question decided. Returned rather than sent.
 *
 * WHY THIS SPLIT EXISTS
 *
 * handleInterviewExtract was split into a pure applyExtraction for exactly this reason, and that
 * split is what made cc-submit — and therefore Claude Code extraction — possible. handleInterviewStep
 * never got the same treatment, so asking a question and putting it on Telegram were one function.
 *
 * That was fine while Telegram was the only surface. It stopped being fine the day Josh's Claude
 * session showed him "Waiting on an interview with you (6)" and gave him no way to answer one: the
 * bot could ask but could not reach him, and Claude could reach him but could not ask. All six
 * expired at seven days and parked.
 *
 * So the decision is here and delivery is the caller's. The alternative — duplicating this logic in
 * a second surface — would duplicate the three hard limits below, every one of which is written up
 * in this file as a bug found in production.
 */
export interface NextStep {
  /** asked = a question is waiting. finished/parked = the interview is over. nothing = no-op. */
  action: "asked" | "finished" | "parked" | "nothing";
  momentId: number;
  /** The question itself, when action is "asked". Already recorded as a turn. */
  question?: string;
  /** "3 of at most 8." Counted in code; a model asked to report it would eventually report it wrong. */
  progress?: string;
  /** 5.12 — said only when an answer earned it. */
  encouragement?: string;
  parkReason?: string;
  /** Why nothing happened, for a caller that has to explain itself to a person. */
  note?: string;
  /** The question was already waiting for an answer; nothing new was asked and nothing should be sent. */
  alreadyOpen?: boolean;
}

/**
 * The queued step. It chooses the next question and records it; asking is the caller's job.
 *
 * ONE CONVERSATION AT A TIME.
 *
 * Four of Josh's ideas were being interviewed at once on 22 September. Every question is numbered
 * per idea, so what arrived in his chat read "6 of at most 8" and then, six minutes later, "3 of at
 * most 8" — and he reported it as the bot resetting its questions. It was not resetting; it was
 * holding four conversations in one thread with nothing to tell them apart.
 *
 * So a step whose chat is busy with a DIFFERENT idea goes back on the queue rather than being asked.
 * Nothing is lost: the question has not been written yet, and the idea keeps its place.
 */
export async function handleInterviewStep(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);

  /*
   * IT CHOOSES THE QUESTION. IT NO LONGER DELIVERS IT.
   *
   * `deliverQuestion` sent the chosen question to a Telegram chat. With that gone there is nobody to
   * send to — nothing can push into Claude Code — but the choosing still has to happen unattended,
   * because both callers are: `closeStaleConversations` nudging an interview that never started, and
   * an idea being reopened. So the question is recorded as a turn and waits, and
   * `next_interview_question` is how it gets asked.
   *
   * The "is this chat busy elsewhere" guard went with it. It existed because four of Josh's ideas
   * were once mid-interview at once and the thread read 6 then 3. One session is one conversation,
   * so the problem it solved cannot arise.
   */
  await chooseNextQuestion(db, momentId);
}


/**
 * Everything that decides what happens next, and nothing that sends anything.
 *
 * Every write it performs — the turn, depth_reached, the park, the extract job — is work that must
 * happen regardless of which surface asked. Only the telling is left out.
 */
export async function chooseNextQuestion(
  db: SupabaseClient,
  momentId: number,
): Promise<NextStep> {
  const session = await loadSession(db, momentId);
  const maxQuestions = await getSetting(db, "interview_max_questions", 8);

  const { data: moment } = await db.from("moments").select("*").eq("id", momentId).single();
  if (!moment) return { action: "nothing", momentId, note: "No such moment." };
  if (moment.killed) return { action: "nothing", momentId, note: "That moment was killed." };
  if (["mined", "parked", "queued", "drafted", "gated", "scheduled", "published"].includes(moment.status)) {
    // already finished with; a retried job must not reopen it
    return {
      action: "nothing",
      momentId,
      note: `That interview is already finished — the moment is ${moment.status}.`,
    };
  }

  // A question already waiting is never followed by another. Found by a live test: a thought
  // captured in Claude queued the Telegram interview step, Claude asked its first question
  // straight away, and when the queued step ran it asked the model for a SECOND question and sent
  // it to Telegram — two open questions on one idea, one budget slot wasted, and the next Telegram
  // message filed as an answer to an interview happening somewhere else.
  const last = session.turns[session.turns.length - 1];
  if (last?.role === "question") {
    return {
      action: "asked",
      momentId,
      question: last.body,
      alreadyOpen: true,
      progress: `${session.questionsAsked} of at most ${maxQuestions}.`,
    };
  }

  // 5.8 — take what you have and move on rather than running the session into the ground.
  if (session.questionsAsked >= maxQuestions) {
    await enqueue(db, "interview_extract", { moment_id: momentId });
    return {
      action: "finished",
      momentId,
      note: `${maxQuestions} questions is the limit (5.8). Extracting what it has.`,
    };
  }

  // 6.4 — the first question of a re-opened session is not the model's to choose.
  //
  // Left to it, the interviewer reads a transcript that ends with Josh saying "I cannot remember,
  // leave it" and quite sensibly concludes there is nothing more — so re-opening would go straight
  // back to extraction without asking him anything, which is the promise broken in a new way. He
  // tapped the button because he DOES remember more; he simply has not said it yet. Asking is the
  // whole of what the button offered, so it is asked directly rather than requested from a model.
  if (session.reopened && session.questionsAsked === 0) {
    const question = await askReopeningQuestion(db, momentId);
    return { action: "asked", momentId, question, progress: `1 of at most ${maxQuestions}.` };
  }

  const library = await loadLibrary(db, "interview");
  const seed = await seedText(db, momentId);

  // 4.2.6 — the prompt set is Josh's, edited in the library, and each question carries its own
  // record of whether it has ever produced anything.
  const questions = await syncQuestions(db, library.sections.prompt_set ?? "");
  const alreadyAsked = new Set(session.turns.map((t) => t.question_key).filter(Boolean));

  /*
   * THE RIGHT SET FOR THE JOB (0039).
   *
   * Josh's document is four sets doing four different jobs, and the bank used to be all of them at
   * once — so mining one idea could be offered "What happened this week that surprised you?", which
   * is set 2's job of finding a NEW idea, asked in the middle of digging into an existing one.
   *
   *   ordinary idea      set 1, the mining questions, which is what clause 5 is
   *   seeding sitting    set 4, because clause 6 says the thirty prompts are what seeding runs on
   *   prompted session   sets 3 and 4: he asked to be taken looking, so the doors are the point
   *
   * Set 1 is always allowed: once the session has a scene in it, the depth ladder is what takes it
   * further whatever door it came through. Set 2 is never in here — the sweep asks its own five.
   */
  /*
   * WHICH DOOR THE IDEA CAME THROUGH, NOT WHICH CHAT IS BUSY.
   *
   * This asked the conversation's state whether a seeding sitting was running, because seeding was a
   * Telegram flow: one moment rolled into the next inside a chat. That state is gone with the chat,
   * and `moment.source` answers the same question from the idea itself — which is the more honest
   * place for it, since the set a question comes from is a fact about the idea rather than about
   * whichever surface is open.
   *
   * Clause 6's thirty prompts are untouched. A prompted session still draws on them.
   */
  const allowed = new Set<SetKey>(
    moment.source === "prompted_session" ? ["sitting", "thirty", "mine"] : ["mine"],
  );

  const bank = questions
    .filter((q) => !alreadyAsked.has(q.key))
    .filter((q) => allowed.has((q.set_key ?? "mine") as SetKey))
    .map((q) => ({ key: q.key, text: q.current_text }));

  const next = await callStructured(NextQuestionSchema, {
    model: MODELS.SONNET,
    system: INTERVIEWER_SYSTEM(library.prompt),
    messages: [{
      role: "user",
      content: NEXT_QUESTION_USER({
        transcript: `WHAT JOSH SENT:\n${seed}\n\n${renderTranscript(session)}`,
        questionsAsked: session.questionsAsked,
        maxQuestions,
        depthReached: session.depthReached,
        pushbackUsed: session.pushbackUsed,
        questionBank: bank,
      }),
    }],
    effort: "medium",
    // A question is two sentences and an optional one-line encouragement. 1200 was headroom nobody
    // used, and on a nearly-empty provider account the ASKED-FOR ceiling is what gets refused:
    // "you requested up to 1200 tokens, but can only afford 1068" stopped every interview while
    // there was credit for the answer it would actually have produced.
    maxTokens: 700,
    purpose: "interview",
    momentId,
    promptVersion: PROMPT_VERSION,
  }, { db });

  // 5.3 is a hard limit, not a request. If the model asks for a second pushback, it does not get one.
  const isPushback = next.is_pushback && !session.pushbackUsed;
  if (next.is_pushback && session.pushbackUsed) {
    await enqueue(db, "interview_extract", { moment_id: momentId });
    return {
      action: "finished",
      momentId,
      note: "One pushback per interview is the limit (5.3). Extracting what it has.",
    };
  }

  if (next.action === "park") {
    // None of the three depths produced anything. That is a real answer (clause 5), and the depth
    // reached is genuinely none however many rungs were tried.
    const reason = next.park_reason || "No specific moment behind this yet.";
    await db.from("moments").update({ depth_reached: "none" }).eq("id", momentId);
    await park(db, momentId, reason);
    return { action: "parked", momentId, parkReason: reason };
  }

  if (next.action === "finish") {
    // THE ONLY PLACE depth_reached IS WRITTEN.
    //
    // Clause 5 works the ladder "in order, and stops as soon as one produces material" — so the
    // field records what PRODUCED something, never what was attempted. Writing it per question
    // credited a moment with a scene merely because a scene question had been asked, and
    // worker-select scores scene +8 against time_anchored +4, so weaker moments outranked stronger
    // ones. Seen live on M-000005, whose entire content was the words "Okay thanks".
    await db.from("moments").update({
      depth_reached: deepest(session.depthReached, next.depth as InterviewDepth),
    }).eq("id", momentId);
    await enqueue(db, "interview_extract", { moment_id: momentId });
    return { action: "finished", momentId, note: "Enough material. Extracting it." };
  }

  const questionKey = next.question_key?.trim() || null;

  await appendTurn(db, momentId, {
    role: "question",
    body: next.question,
    question_key: questionKey,
    depth: next.depth as InterviewDepth,
    is_pushback: isPushback,
  });

  if (questionKey) await recordAsked(db, questionKey);

  // Deliberately does NOT touch depth_reached. The rung being probed is recorded on the turn itself
  // (interview_turns.depth), which is where "what did it try" belongs. What the moment achieved is
  // decided at finish, above.
  await db.from("moments").update({
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  // 5.12 — tell him when he has given something strong, so he learns what good material feels like.
  /*
   * Where he is, counted in code rather than asked for in the prompt.
   *
   * 5.12 already tells him when an answer was good. What it never told him was how much longer this
   * goes on, and an interview with no visible end is one it is always rational to put off — which
   * is what five stalled conversations look like from the inside.
   *
   * Deterministic on purpose. The count is a fact this function already holds, and a model asked to
   * report it would eventually report it wrongly, which is worse than not saying it at all.
   */
  const askedNow = session.questionsAsked + 1;
  const left = Math.max(0, maxQuestions - askedNow);
  const progress = left === 0
    ? "Last one."
    : left === 1
    ? "One more after this, at most."
    : `${askedNow} of at most ${maxQuestions}.`;

  return {
    action: "asked",
    momentId,
    question: next.question,
    progress,
    encouragement: next.encouragement?.trim() || undefined,
  };
}

/**
 * 5.9 — write structured material back to the idea bank, and record every name for clearance (5.7).
 */
export async function handleInterviewExtract(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);
  const session = await loadSession(db, momentId);
  const seed = await seedText(db, momentId);
  const library = await loadLibrary(db, "interview");
  const source = `${seed}\n\n${renderTranscript(session)}`;
  const said = joshSaid(seed, session.turns);

  const ask = (feedback?: string) =>
    callStructured(ExtractionSchema, {
      model: MODELS.SONNET,
      // Only pillars Josh has actually defined. With none, extraction returns empty rather than
      // inventing a category that would then be counted in the pillar balance (7.1).
      system: `${EXTRACT_SYSTEM(parsePillars(library.sections.pillars ?? ""))}\n\n${library.prompt}`,
      messages: [{
        role: "user",
        content: `WHAT JOSH SENT:\n${seed}\n\nTHE CONVERSATION:\n${renderTranscript(session)}` +
          (feedback ? `\n\nYOUR LAST EXTRACTION WAS REFUSED. Fix exactly this:\n${feedback}` : ""),
      }],
      effort: "medium",
      maxTokens: 2500,
      purpose: "extract",
      momentId,
      promptVersion: PROMPT_VERSION,
    }, { db });

  /*
   * The same three checks cc-submit has always run on Claude Code's extractions, plus the dropped
   * number check. This path ran none of them: the automatic write-up, which is most of them, was
   * stored on trust.
   *
   * One retry, naming what failed. If it still fails the entry is filed anyway, as it always was,
   * and Josh is told what is wrong with it. Stalling the interview would be the worse outcome.
   */
  let extracted = await ask();
  let verdict = verifyExtraction(extracted, source, said);
  if (!verdict.ok) {
    extracted = await ask(verdict.failures.map((f) => `- ${f}`).join("\n"));
    verdict = verifyExtraction(extracted, source, said);
  }

  if (!verdict.ok) {
    // A paraphrase stored as a verbatim quote is the one fault that can be removed safely here.
    if (verdict.failures.some((f) => f.startsWith("their_actual_words"))) {
      extracted = { ...extracted, their_actual_words: "" };
    }
    await logEvent(db, "extraction_unverified", "warn", { moment_id: momentId, failures: verdict.failures });
  }

  const filed = await applyExtraction(db, momentId, extracted);

  if (!verdict.ok && !filed.parked) {
    await notice(
      db,
      "extraction_unverified",
      `The write-up of "${filed.title ?? `moment ${momentId}`}" still fails a check after a retry: ` +
        verdict.failures.join(" ") + " Redo it in a session before drafting from it.",
      { severity: "warn", momentId, actedOn: ["get_moment", "get_extraction_brief"] },
    );
  }
}

/**
 * Everything that happens once an extraction exists, whoever produced it.
 *
 * Split out so Claude Code can do the reading (12c's sibling: the model call moves, the write
 * authority does not) without a second copy of the parking rules, the pillar confirmation, the name
 * clearance question and the seeding advance. Those are five decisions with real consequences, and
 * a second implementation of them would diverge on the first one anybody improved.
 *
 * The caller supplies the extraction. It does NOT supply what happens next.
 */
export interface Filed {
  momentId: number;
  title: string | null;
  pillar: string | null;
  audience: string | null;
  /** 9.12 — names that need a decision before this can be drafted. Blocks the drafter if ignored. */
  uncleared: { id: number; name: string; kind: string }[];
  /**
   * Set when the interview produced nothing worth writing and the idea was parked instead.
   *
   * Clause 1: "if the material is not there in a given week, fewer posts is the correct outcome." A
   * park is a real result and the caller has to be able to say so, rather than reporting a filed
   * idea that is not there.
   */
  parked?: string;
}

/** The parked outcome, reported the same way as a filed one. */
function parkedResult(momentId: number, reason: string): Filed {
  return { momentId, title: null, pillar: null, audience: null, uncleared: [], parked: reason };
}

/**
 * What this function is actually handed, as opposed to what it used to claim.
 *
 * The parameter was typed `Extraction`, where all six of these are required — and nothing on either
 * caller's path parses against `ExtractionSchema`. cc-submit takes `body.extracted` straight off the
 * request and casts it; the MCP tool is the only thing that validates, and until 28 Oct 2026 its
 * `write_post` schema declared the whole object as a record of strings, so none of the six could
 * arrive at all. The type said they were always there; the wire delivered them never.
 *
 * Saying so in the type is not pedantry. Every bug in the table below was a line reading one of
 * these as though the type were true: `extracted.strength <= 2` on `undefined`, which is false and
 * silently skipped a park; `extracted.audience_known ? ... : null`, which discarded an audience
 * that had been supplied. TypeScript would have caught both the moment the type was honest.
 */
type FiledExtraction =
  & Omit<
    Extraction,
    "strength" | "audience_known" | "audience_is_buyer" | "time_sensitive" | "decays_in_days" | "names"
  >
  & Partial<
    Pick<
      Extraction,
      "strength" | "audience_known" | "audience_is_buyer" | "time_sensitive" | "decays_in_days" | "names"
    >
  >;

export async function applyExtraction(
  db: SupabaseClient,
  momentId: number,
  extracted: FiledExtraction,
  opts: { quiet?: boolean } = {},
): Promise<Filed> {
  const blank = (s: string) => (s && s.trim().length > 0 ? s.trim() : null);

  await db.from("material").upsert({
    moment_id: momentId,
    the_moment: blank(extracted.the_moment),
    the_detail: blank(extracted.the_detail),
    the_realisation: blank(extracted.the_realisation),
    the_lesson: blank(extracted.the_lesson),
    what_happened_before: blank(extracted.what_happened_before),
    who_was_there: blank(extracted.who_was_there),
    their_actual_words: blank(extracted.their_actual_words),
    how_he_felt: blank(extracted.how_he_felt),
    what_changed: blank(extracted.what_changed),
    reader_takeaway: blank(extracted.reader_takeaway),
    updated_at: new Date().toISOString(),
  });

  // 5.7 — every name recorded, none cleared by default. Clearance is per post (9.10).
  //
  // Filtered through `isRealName` rather than trusted: the prompt says "record PROPER NAMES only,
  // not job titles" and the model recorded "CFO" twice and "Josh" once anyway. Three of the first
  // eight names on file were not names, in the one question 9.12 depends on him reading.
  /*
   * "NO NAMES" AND "NO NAMES FIELD" ARE RECORDED AS DIFFERENT FACTS.
   *
   * `extracted.names ?? []` reads both as an empty loop, and they are not the same thing at all.
   * An empty array is a model saying "he named nobody". An absent field is a caller that could not
   * send names — which is what `write_post` was, for fifteen days — and it is the one where 9.10 is
   * being enforced by nothing. There is no row to look at afterwards that can tell them apart, so
   * the difference is written down here while it still exists.
   *
   * Logged rather than refused: refusing would strand the session, and cc-submit reports the scan
   * of his own words back to the caller in the same reply (missingNames). This is the record for
   * anyone reading the project afterwards and asking how 31 of 48 moments ended up with no names.
   */
  if (extracted.names === undefined) {
    await logEvent(db, "names_not_supplied", "warn", {
      moment_id: momentId,
      reason: "the extraction carried no names field at all, which is not the same as naming nobody",
      consequence: "9.10 is enforced by an empty array on this moment, and an empty array cannot fail",
    });
  }

  for (const n of extracted.names ?? []) {
    if (!n.name?.trim()) continue;
    if (!isRealName(n.name)) continue;
    await db.from("moment_names").upsert(
      { moment_id: momentId, name: n.name.trim(), kind: n.kind, cleared: false },
      { onConflict: "moment_id,name", ignoreDuplicates: true },
    );
  }

  // If nothing real came out, park it rather than letting a hollow entry reach the drafter.
  const hasSubstance = [extracted.the_moment, extracted.the_detail, extracted.the_realisation]
    .some((v) => v && v.trim().length > 0);

  /*
   * THIN IS NOT THE SAME AS EMPTY, ONCE THERE ARE RECEIPTS.
   *
   * This parked anything the extractor could not split into a moment, a detail or a realisation —
   * correct when one message was the only thing a claim could ever rest on. It is wrong now. Since
   * 14 Oct a claim may also cite his_words (what he actually typed) and receipts (what he has told
   * us about his career, method and numbers), so "write about why tool-built TAMs miss SMB" has two
   * real sources behind it even though it contains no scene.
   *
   * Still parks when there is genuinely nothing: no substance, nothing typed, and no receipts on
   * file. Clause 1 is untouched — fewer posts is still the right answer when the material is not
   * there. What changed is that we now look in all three places before saying it is not there.
   */
  if (!hasSubstance) {
    const wider = await writingSources(db, momentId);
    const haveWider = Boolean(wider.his_words?.trim()) && Boolean(wider.receipts?.trim());

    if (haveWider) {
      await logEvent(db, "extraction_thin_but_sourced", "info", {
        moment_id: momentId,
        reason: "no moment, detail or realisation, but his own words and receipts are on file",
      });
    } else {
      const why = "The interview did not surface a specific moment, detail or realisation.";
      await park(db, momentId, why);
      await logEvent(db, "moment_parked", "info", { moment_id: momentId, reason: "no substance" });
      if (!opts.quiet) {
        await notice(db, "parked", why, { momentId, actedOn: ["reopen_idea"] });
      }
      return parkedResult(momentId, why);
    }
  }

  // A scene with nothing learned from it is not a post.
  //
  // Observed in the first real session: the interview got a specific moment and a verbatim quote,
  // but no realisation and no lesson, and honestly scored it 1/5. Left alone that would have gone to
  // the drafter and burned three full draft-and-gate cycles before the three-strike rule parked it
  // anyway (9.8) — the most expensive possible route to the right answer.
  //
  // Parking here is the same outcome, reached for a tenth of the cost. Clause 1: "if the material is
  // not there in a given week, fewer posts is the correct outcome."
  /*
   * `strength` IS READ AS A NUMBER OR NOT READ AT ALL, AND IT USED NOT TO BE EITHER.
   *
   * `undefined <= 2` is false, so when `strength` did not arrive this guard silently did not fire
   * — and that is exactly what happened on every one-step call from 13 to 28 October, because
   * `write_post` declared `extracted` as a record of strings and no number could get through it.
   * A guard whose condition is unevaluable must not read as "the condition was false": the park
   * that clause 1 calls for simply never happened, and nothing anywhere said so.
   *
   * So the two cases are now separated. A number decides. No number is recorded as not judged, with
   * its reason, which is the discipline handlers/gate.ts applies to a check it has no basis for: a
   * green verdict with no basis is worse than no verdict, because it is indistinguishable from an
   * earned one everywhere it is later read. There is deliberately no default — a 3 invented here
   * would be a fabricated judgement that then decides whether a real idea is parked.
   */
  const strength = typeof extracted.strength === "number" ? extracted.strength : null;
  const nothingLearned = !extracted.the_realisation?.trim() && !extracted.the_lesson?.trim();

  if (nothingLearned && strength === null) {
    await logEvent(db, "park_guard_not_judged", "warn", {
      moment_id: momentId,
      reason: "nothing was learned from this moment, and no strength was supplied to judge it by",
      consequence: "it was NOT parked — clause 1's park needs a number and did not get one",
    });
  }

  if (nothingLearned && strength !== null && strength <= 2) {
    await park(
      db,
      momentId,
      "There is a moment here but nothing you took from it yet — no realisation, nothing that " +
        "changed. Send me more about it whenever it clicks and I will reopen this one.",
    );
    await logEvent(db, "moment_parked", "info", {
      moment_id: momentId,
      reason: "scene without a realisation",
      strength,
    });
    /*
     * The park reason promises he can add to it later, and that promise needs somewhere to live.
     * It was a Telegram message with a Reopen button under it; it is a notice carrying the tool that
     * does the same thing. Either way the point is that the promise is keepable.
     */
    const why = "There is a moment here but nothing you took from it yet — no realisation, nothing " +
      "that changed. Add to it whenever it clicks and I will pick it back up.";
    if (!opts.quiet) {
      await notice(db, "parked", why, { momentId, actedOn: ["reopen_idea"] });
    }
    return parkedResult(momentId, why);
  }

  /*
   * THE THIRD THING THE HONEST TYPE CAUGHT, and it had the same shape as the other two.
   *
   * `extracted.time_sensitive && extracted.decays_in_days > 0` compared `undefined > 0`, which is
   * false, so a moment he had marked as decaying got `decays_at: null` and never aged out of the
   * queue. Both schemas default this field to 0, and until 28 October nothing on the one-step path
   * ever applied a default: `write_post` reached `submit_extraction`'s handler directly, past the
   * zod that holds them. Read as a number here or not used, so the failure cannot come back as
   * silence.
   */
  const decaysInDays = typeof extracted.decays_in_days === "number" ? extracted.decays_in_days : 0;
  const decays = extracted.time_sensitive && decaysInDays > 0
    ? new Date(Date.now() + decaysInDays * 86_400_000).toISOString().slice(0, 10)
    : null;

  await db.from("moments").update({
    status: "mined",
    pillar: blank(extracted.pillar),
    /*
     * 5.6 — a guessed reader is worse than an admitted gap: it steers the drafter and the
     * aimed_at_someone gate check. The drafter already handles "not recorded".
     *
     * `=== false` RATHER THAN TRUTHINESS, which is a different rule than it looks.
     *
     * This was `extracted.audience_known ? blank(...) : null`. When the flag did not arrive at all
     * — which was every one-step call from 13 to 28 October, because `write_post`'s schema could
     * not carry a boolean — it discarded an audience string that HAD been supplied. The moment was
     * stored with no reader on any of them, and "a post aimed at everyone" is the second most
     * common reason drafts are rejected here: 8 of 13. The field that prevents it was being thrown
     * away by the code that reads it.
     *
     * Only an explicit `false` now suppresses the audience, because only an explicit false is a
     * model saying "I am guessing". A missing flag is not that claim; it is a caller that did not
     * answer, and answering for it in the suppressing direction loses real information while
     * looking like caution. An explicit true and an explicit false behave exactly as before, so
     * the interview and worker paths are untouched.
     */
    audience: extracted.audience_known === false ? null : blank(extracted.audience),
    audience_is_buyer: extracted.audience_is_buyer,
    strength: strength ?? undefined,
    time_sensitive: extracted.time_sensitive,
    decays_at: decays,
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  // 4.2.6 — credit every question asked in a session that produced material. Attribution to a
  // single question would be false precision: an answer three turns later often belongs to a
  // question asked earlier.
  await creditSession(db, momentId);

  const { data: m } = await db.from("moments").select("title").eq("id", momentId).single();

  // 9.12 — every name it would need, asked about once, while the moment is fresh in his mind.
  // 9.10 — not simply `cleared = false`. A name cleared before this moment was last re-opened is
  // back to needing a decision, because re-opening is where it becomes a different post.
  const uncleared = await unclearedNames(db, momentId);

  /*
   * IT REPORTS WHAT IT FILED. IT DOES NOT ANNOUNCE IT.
   *
   * This used to end by sending Josh a message — what it was filed as, which pillar, and a row of
   * buttons for any name needing clearance. That made the one write path Claude Code depends on
   * reach into Telegram: `submit_extraction` → here → `confirmFiled` → `sendMessage`. Deleting the
   * Telegram transport would therefore have broken capture, the interview and extraction all at
   * once, which is the opposite of what removing a surface should cost.
   *
   * So the facts come back to the caller, which knows whether a person is waiting. Claude Code says
   * them in the session; the queue path leaves a notice, because an extraction that happened while
   * he was away is exactly the kind of fact that has nowhere else to go.
   *
   * The name question goes with it. It was asked here, as buttons, while the moment was fresh —
   * good reasoning for a phone. In a session the caller asks it in words and `clear_names` records
   * the answer, and silence still leaves them uncleared, which 9.12 calls the safe default.
   */
  const { data: filedRow } = await db
    .from("moments")
    .select("pillar, audience")
    .eq("id", momentId)
    .maybeSingle();

  const filed: Filed = {
    momentId,
    title: (m?.title as string | null) ?? null,
    pillar: (filedRow?.pillar as string | null) ?? null,
    audience: (filedRow?.audience as string | null) ?? null,
    uncleared: uncleared.map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
  };

  if (!opts.quiet) {
    const lines = [filed.title ? `"${filed.title}" is mined and ready to write.` : "An idea is mined."];
    if (filed.pillar) lines.push(`Filed under ${filed.pillar}.`);
    if (filed.uncleared.length > 0) {
      lines.push(
        `It mentions ${filed.uncleared.map((n) => n.name).join(", ")}. Nothing can be drafted from ` +
          `it until you say whether those may be named.`,
      );
    }
    await notice(db, "idea_mined", lines.join(" "), {
      momentId,
      actedOn: filed.uncleared.length > 0 ? ["clear_names", "next_work"] : ["next_work"],
    });
  }

  return filed;
}

/** What Josh originally sent, whether typed or transcribed. */
export async function seedText(db: SupabaseClient, momentId: number): Promise<string> {
  const { data } = await db
    .from("raw_inputs")
    .select("transcript, text_body")
    .eq("moment_id", momentId)
    .order("id");
  return (data ?? [])
    .map((r) => r.transcript ?? r.text_body ?? "")
    .filter((s) => s.length > 0)
    .join("\n\n") || "(nothing captured)";
}



/** The one fixed question in the system: what he came back to say. */
async function askReopeningQuestion(db: SupabaseClient, momentId: number): Promise<string> {
  const question = "What came back to you about this one?";

  await appendTurn(db, momentId, {
    role: "question",
    body: question,
    question_key: null,
    // Deliberately unranked. It probes nothing in particular, so it must not credit a rung of the
    // ladder — depth_reached is only ever written by what actually produces material.
    depth: null,
    is_pushback: false,
  });

  // Recorded, not sent. deliverQuestion puts it on Telegram when that is the surface; the MCP
  // interview tools return it to whoever asked instead.
  return question;
}
