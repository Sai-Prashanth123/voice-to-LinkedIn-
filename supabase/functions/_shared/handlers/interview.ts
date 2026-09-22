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
import { type Button, joshChatId, sendMessage } from "../telegram.ts";
import { questionOuts } from "../interviewouts.ts";
import { chatForMoment, getState, setState, statesFor } from "../chat-state.ts";
import { sendParked } from "../parked.ts";
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

/** The Telegram job. Chooses, then delivers. */
export async function handleInterviewStep(db: SupabaseClient, job: Job): Promise<void> {
  const step = await chooseNextQuestion(db, Number(job.payload.moment_id));
  await deliverQuestion(db, step);
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
  const seeding = (await statesFor(db, momentId)).some((s) => s.awaiting === "seeding");
  const allowed = new Set<SetKey>(
    seeding
      ? ["thirty", "mine"]
      : moment.source === "prompted_session"
      ? ["sitting", "thirty", "mine"]
      : ["mine"],
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
 * Putting a chosen question on Telegram. The only Telegram-aware half of the old function.
 *
 * A surface that is not Telegram — the MCP interview tools — calls chooseNextQuestion and skips
 * this entirely, which is the whole point of the split.
 */
export async function deliverQuestion(db: SupabaseClient, step: NextStep): Promise<void> {
  const { action, momentId } = step;

  if (action === "parked") {
    // These two were inside the park branch before. They are Telegram, so they live here now.
    await advanceSeeding(db);
    await sendParked(
      db,
      momentId,
      `Parked that one — ${step.parkReason || "there is no story behind it yet"}.\n\n` +
        `It stays in the bank. Something that is not ready now is often the right post later.`,
    );
    return;
  }

  if (action !== "asked" || !step.question || step.alreadyOpen) return;

  const text = (step.encouragement
    ? `${step.encouragement}\n\n${step.question}`
    : step.question) + (step.progress ? `\n\n${step.progress}` : "");

  /*
   * Every question carries a way out that is not silence.
   *
   * Before these buttons a question had exactly two responses: type an answer, or say nothing. Five
   * interviews were sitting on the second, and the system read all five the same way — as Josh
   * being busy — when they are three different facts: the question is wrong, there is nothing more
   * to say, or the moment is not worth it. Silence cannot tell them apart, so nothing downstream
   * could either.
   *
   * "That is enough" is the one the prompt already believes in and could never hear: it tells the
   * interviewer to stop and write up what it has, which clause 5 calls a real outcome rather than a
   * failure. It is also the answer to "how do I know when an interview is finished" — he decides.
   */
  const messageId = await sendMessage(await chatForMoment(db, momentId), text, questionOuts(momentId));

  // So that a reply is unambiguously an answer to THIS question, even days later (5.11).
  if (messageId) {
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: "question",
      moment_id: momentId,
    });
  }

  await pointStateAtMoment(db, momentId);
}

/**
 * Point the conversation at the moment a question was just asked about.
 *
 * Asking and waiting are the same event, so this belongs here rather than only at the call sites
 * that happen to start an interview. Without it, an interview started anywhere other than the
 * webhook — a re-open from the bank page (6.4), for instance — asks its question and then files the
 * answer as a brand new moment, which is the exact failure re-opening exists to prevent. The bank
 * page cannot do it itself: `conversation_state` grants `authenticated` select only, deliberately,
 * because the bot owns what it is waiting on.
 *
 * Only overwrites states that mean "waiting on an answer, or waiting on nothing". A pending name
 * clearance or a half-answered image question is a different thing Josh is mid-way through, and
 * stealing it would lose his reply.
 */
async function pointStateAtMoment(db: SupabaseClient, momentId: number): Promise<void> {
  const chatId = await chatForMoment(db, momentId);
  const state = await getState(db, chatId);

  const awaiting = state.awaiting ?? "nothing";
  if (!["nothing", "answer", "seeding"].includes(awaiting)) return;

  await db.from("conversation_state").upsert({
    chat_id: chatId,
    // A seeding sitting stays seeding: that is what tells extract to open the next moment.
    awaiting: awaiting === "seeding" ? "seeding" : "answer",
    moment_id: momentId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "chat_id" });
}

/**
 * 5.9 — write structured material back to the idea bank, and record every name for clearance (5.7).
 */
export async function handleInterviewExtract(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);
  const session = await loadSession(db, momentId);
  const seed = await seedText(db, momentId);
  const library = await loadLibrary(db, "interview");

  const extracted = await callStructured(ExtractionSchema, {
    model: MODELS.SONNET,
    // Only pillars Josh has actually defined. With none, extraction returns empty rather than
    // inventing a category that would then be counted in the pillar balance (7.1).
    system: `${EXTRACT_SYSTEM(parsePillars(library.sections.pillars ?? ""))}\n\n${library.prompt}`,
    messages: [{
      role: "user",
      content: `WHAT JOSH SENT:\n${seed}\n\nTHE CONVERSATION:\n${renderTranscript(session)}`,
    }],
    effort: "medium",
    maxTokens: 2500,
    purpose: "extract",
    momentId,
    promptVersion: PROMPT_VERSION,
  }, { db });

  await applyExtraction(db, momentId, extracted);
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
export async function applyExtraction(
  db: SupabaseClient,
  momentId: number,
  extracted: Extraction,
): Promise<void> {
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

  if (!hasSubstance) {
    await park(db, momentId, "The interview did not surface a specific moment, detail or realisation.");
    await logEvent(db, "moment_parked", "info", { moment_id: momentId, reason: "no substance" });
    await advanceSeeding(db);
    return;
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
  const nothingLearned = !extracted.the_realisation?.trim() && !extracted.the_lesson?.trim();
  if (nothingLearned && extracted.strength <= 2) {
    await park(
      db,
      momentId,
      "There is a moment here but nothing you took from it yet — no realisation, nothing that " +
        "changed. Send me more about it whenever it clicks and I will reopen this one.",
    );
    await logEvent(db, "moment_parked", "info", {
      moment_id: momentId,
      reason: "scene without a realisation",
      strength: extracted.strength,
    });
    // The message above promises he can add to it later. That promise now has a button behind it.
    await sendParked(
      db,
      momentId,
      "There is a moment here but nothing you took from it yet — no realisation, nothing that " +
        "changed. Add to it whenever it clicks and I will pick it back up.",
    );
    await advanceSeeding(db);
    return;
  }

  const decays = extracted.time_sensitive && extracted.decays_in_days > 0
    ? new Date(Date.now() + extracted.decays_in_days * 86_400_000).toISOString().slice(0, 10)
    : null;

  await db.from("moments").update({
    status: "mined",
    pillar: blank(extracted.pillar),
    // 5.6 — a guessed reader is worse than an admitted gap: it steers the drafter and the
    // aimed_at_someone gate check. The drafter already handles "not recorded".
    audience: extracted.audience_known ? blank(extracted.audience) : null,
    audience_is_buyer: extracted.audience_is_buyer,
    strength: extracted.strength,
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

  // ONE message: what it was filed as, and who it mentions. These used to be two paths, and the name
  // path returned before reaching the pillar confirmation — so 5.10 never fired on a moment with a
  // person in it, which is most moments worth writing.
  await confirmFiled(db, momentId, m?.title ?? null, uncleared);

  // Only claim the conversation when there is nothing else going on.
  //
  // Setting `name_clearance` used to overwrite `seeding`, which ended a cold-start sitting without a
  // word at the first moment involving a person. The clearance question does not need the state: the
  // message is recorded as `names`, so a reply to it is unambiguous whatever else is happening, and
  // the buttons carry the name id directly. Silence leaves them uncleared, which 9.12 already calls
  // the safe default.
  if (uncleared.length > 0) {
    const chatId = await chatForMoment(db, momentId);
    const state = await getState(db, chatId);

    if (state.awaiting === "nothing" || state.awaiting === "answer") {
      await setState(db, chatId, "name_clearance", momentId, {
        name_ids: uncleared.map((n) => n.id),
      });
    }
  }

  // The cold start: one moment rolls straight into the next rather than ending the sitting. Runs on
  // EVERY path out of extract now, including the one with names.
  await advanceSeeding(db);
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

/**
 * 5.10 — "Must tag the moment to a pillar AND SAY WHICH, so Josh can correct it."
 *
 * The tagging was already happening; the saying was not. The confirmation used to read only "Got it
 * — saved as M-000003", so Josh never learned what the system had decided and the "so he can correct
 * it" half of the requirement — the whole reason it exists — never happened.
 *
 * Where he has defined pillars, each becomes a tap. Where he has not, the message says so plainly
 * rather than showing a category the system invented.
 *
 * IT ALSO CARRIES THE NAME QUESTION (9.12), AND THAT MATTERS MORE THAN IT LOOKS
 *
 * These used to be two separate paths, and the name path `return`ed before reaching this one. So a
 * moment mentioning a person — which is most moments worth writing — never got its pillar
 * confirmation at all. 5.10's "so Josh can correct it" simply did not happen on the material most
 * likely to need correcting. M-000003 has four uncleared names and never once received one.
 *
 * One message rather than two, because he is being asked about one moment: what it was filed under,
 * who it mentions, and both sets of buttons together. Two notifications for one thought is how a
 * system starts feeling like work.
 */
async function confirmFiled(
  db: SupabaseClient,
  momentId: number,
  title: string | null,
  uncleared: { id: number; name: string; kind: string }[] = [],
): Promise<number | null> {
  const { data: moment } = await db
    .from("moments")
    .select("pillar, audience, strength")
    .eq("id", momentId)
    .maybeSingle();

  const library = await loadLibrary(db, "interview");
  const pillars = parsePillars(library.sections.pillars ?? "");

  const lines = [title ? `Got it — "${title}" is saved.` : `Got it — saved.`];

  if (moment?.pillar) lines.push(`Filed under ${moment.pillar}.`);
  else if (pillars.length > 0) lines.push(`I could not place it in one of your pillars.`);

  if (moment?.audience) lines.push(`Written for ${moment.audience}.`);
  else lines.push(`I was not sure who it is for — I will work that out when I write it.`);

  // 9.12 — "Where a moment does not work without naming someone, the system must ask Josh."
  // Asked here, while the moment is fresh, rather than at drafting time when he may be nowhere near
  // his phone. Silence leaves them uncleared, which is the safe default and blocks nothing.
  if (uncleared.length > 0) {
    const list = uncleared.map((n) => n.name).join(", ");
    lines.push(
      "",
      `It mentions ${list}. May I name ${uncleared.length === 1 ? "them" : "any of them"}?`,
      `If you leave this, I write it without naming anyone — and without describing them closely ` +
        `enough to be recognised.`,
    );
  } else {
    lines.push("", "I will pick it up when it is the right one to write.");
  }

  // Buttons only where there is something real to choose between. Offering a picker of categories
  // the system made up would be worse than saying nothing.
  const rows: Button[][] = [];

  // Clearance is per NAME and per post (9.10), so each one is its own decision rather than a blanket
  // yes. A tap beats a sentence: he is usually walking.
  for (const n of uncleared) {
    rows.push([
      { text: `Name ${n.name}`, data: `name:${n.id}:y` },
      { text: `Not ${n.name}`, data: `name:${n.id}:n` },
    ]);
  }

  if (pillars.length > 0) {
    rows.push(...chunk(pillars.map((p, i) => ({ text: p, data: `pil:${momentId}:${i}` })), 2));
    rows.push([{ text: "Leave the pillar as is", data: `pil:${momentId}:-1` }]);
  }

  const buttons = rows.length > 0 ? rows : undefined;

  const messageId = await sendMessage(
    await chatForMoment(db, momentId),
    pillars.length > 0 ? `${lines.join("\n")}\n\nWrong pillar? Change it here.` : lines.join("\n"),
    buttons,
  );

  if (messageId) {
    // Recorded as `names` when there is something to clear, so a typed REPLY to this message is
    // unambiguous clearance whatever else the conversation is doing — which is what lets a seeding
    // sitting carry on instead of stopping to wait for an answer.
    await db.from("sent_messages").insert({
      telegram_message_id: messageId,
      kind: uncleared.length > 0 ? "names" : "other",
      moment_id: momentId,
    });
  }

  return messageId;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}


/**
 * The cold start (clause 6).
 *
 * "The build must include a seeding session: a long, deliberate interview aimed at filling the bank
 * with twenty to thirty mined moments before anything else runs."
 *
 * One moment finishing rolls straight into the next rather than stopping, because the point is a
 * single sitting rather than twenty-five separate decisions to continue. Progress is reported so it
 * feels finite. Clause 1 still governs: if the moments are not there, stopping short is correct, and
 * /stop ends it at any point with everything kept (4.2.5).
 *
 * Called at EVERY point a moment reaches its end, including the ones that park. A parked moment is
 * an ordinary outcome — "if the material is not there, fewer posts is the correct outcome" — and if
 * only the successful path rolled on, the first thin thought would quietly end the sitting and Josh
 * would be left waiting on a bot that had stopped. Returns false when no sitting is running, which
 * is how every one of those call sites stays a no-op the rest of the time.
 */
export async function advanceSeeding(db: SupabaseClient): Promise<boolean> {
  // A seeding sitting belongs to whoever started it, which is the chat whose state says so.
  const { data: sitting } = await db
    .from("conversation_state").select("chat_id").eq("awaiting", "seeding").limit(1).maybeSingle();
  if (!sitting) return false;
  const chatId = Number(sitting.chat_id);

  const target = await getSetting(db, "seed_target", 25);
  const { count: mined } = await db
    .from("moments")
    .select("*", { count: "exact", head: true })
    .in("status", ["mined", "queued", "drafted", "gated", "scheduled", "published"]);

  const done = mined ?? 0;
  if (done >= target) {
    await setState(db, chatId, "nothing", null);

    await sendMessage(
      chatId,
      `That is ${done} moments in the bank — enough to tune everything else against.\n\n` +
        `Well done, that was the hard part.`,
    );
    return true;
  }

  await sendMessage(chatId, `${done} of ${target}. Next one.`);
  await startNextSeedMoment(db);
  return true;
}

/**
 * Open the next moment in a seeding sitting.
 *
 * Kept here rather than in the webhook because seeding continues from wherever the previous moment
 * finished — which is a worker, not a message. The state stays `seeding` so the next answer routes
 * to this moment and the sitting continues rather than ending after one.
 */
export async function startNextSeedMoment(db: SupabaseClient, chatId?: number): Promise<void> {
  const sittingChat = chatId ?? Number(
    (await db.from("conversation_state").select("chat_id").eq("awaiting", "seeding").limit(1)
      .maybeSingle()).data?.chat_id ?? joshChatId(),
  );
  const { data: moment } = await db.from("moments").insert({
    source: "prompted_session",
    status: "captured",
    chat_id: sittingChat,
  }).select("id").single();
  if (!moment) return;

  await db.from("raw_inputs").insert({
    moment_id: moment.id,
    kind: "text",
    text_body: "(seeding session — filling the bank before anything else runs)",
  });

  await setState(db, sittingChat, "seeding", moment.id);

  await enqueue(db, "interview_step", { moment_id: moment.id });
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

