/**
 * Job: `transcribe` — turn captured audio into text, then hand it on.
 *
 * 4.1.5: the moment must reach the idea bank as soon as the system reasonably can. Nothing waits
 * for a nightly run, so this is enqueued the instant the webhook acknowledges the message.
 *
 * THREE THINGS JOSH TALKS INTO, AND THEY ARE NOT THE SAME THING
 *
 *   interview   — a voice note about a moment. Transcript becomes material, interview follows.
 *   pushback    — 9.16, "by voice or typed". A voice reply to a draft. Transcript becomes his note.
 *   voice_guide — 8.1, the recorded interview. Transcript becomes library content, never material.
 *
 * They share the transcription and nothing else, so the branch is here rather than three near-copies
 * of the download-and-transcribe dance. `then` defaults to `interview`, which is both the common
 * case and what any job queued before this existed meant.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { noteProvider } from "../providers.ts";
import { autoName } from "../idea-names.ts";
import { logEvent } from "../db.ts";
import { enqueue } from "../jobs.ts";
import { pushBack } from "../pushback.ts";
import { transcribe, type Transcription } from "../stt.ts";
import { judgeTranscript, recentCaptures, type VoiceVerdict } from "../voice-triage.ts";
import { triageMessage } from "./chat.ts";
import { isChatter } from "../chatter.ts";
import { joshChatId, sendMessage } from "../telegram.ts";
import type { Job } from "../types.ts";

type Then = "interview" | "pushback" | "voice_guide";

export async function handleTranscribe(db: SupabaseClient, job: Job): Promise<void> {
  const then = (job.payload.then as Then | undefined) ?? "interview";

  if (then === "voice_guide") {
    await transcribeVoiceGuide(db, job);
    return;
  }

  const rawInputId = Number(job.payload.raw_input_id);
  const momentId = Number(job.payload.moment_id);

  const { data: raw, error } = await db
    .from("raw_inputs")
    .select("id, audio_path, kind, transcript")
    .eq("id", rawInputId)
    .single();
  if (error || !raw) throw new Error(`raw_input ${rawInputId} not found`);

  const text = raw.transcript ?? await transcribeStored(db, "voice-notes", raw.audio_path!, {
    onDone: async (result) => {
      await db.from("raw_inputs").update({
        transcript: result.text,
        duration_seconds: result.durationSeconds,
        transcribed_at: new Date().toISOString(),
      }).eq("id", rawInputId);

      await logEvent(db, "transcribed", "info", {
        moment_id: momentId,
        provider: result.provider,
        chars: result.text.length,
        then,
      });
    },
  });

  if (then === "pushback") {
    const draftId = Number(job.payload.draft_id);

    // 9.14 — an empty transcription is not silence to be shrugged off. He recorded something and is
    // owed an answer either way, or he is left waiting on a revision that was never queued.
    const sent = await pushBack(db, momentId, draftId, text);
    await sendMessage(
      joshChatId(),
      sent
        ? `Got it — "${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"\n\n` +
          `Running the revision back through the checks.`
        : `I could not make out that recording. Send it again, or type what you want changed.`,
    );
    return;
  }

  /*
   * NOW THERE ARE WORDS, SO NOW THEY CAN BE JUDGED.
   *
   * This used to name the moment and queue an interview unconditionally, which is how Josh's sweep on
   * 5 October put "What do you mean?" in his idea bank as an idea and then asked him a question about
   * it. A typed message gets checked at capture; a voice note cannot be, because at capture there is
   * nothing to read. The check belongs here, and it did not exist.
   *
   * See voice-triage.ts for what each verdict means and why each rule is as narrow as it is.
   */
  const { data: moment } = await db
    .from("moments")
    .select("title, chat_id, status")
    .eq("id", momentId)
    .maybeSingle();

  const chatId = (moment?.chat_id as number | null) ?? null;
  const verdict = judgeTranscript(
    text,
    await recentCaptures(db, chatId, momentId),
    { isChatter },
  );

  if (verdict.kind !== "moment") {
    await ruleOut(db, momentId, chatId, verdict, text);
    return;
  }

  // A voice note is captured before anything can read it, which is why naming happens here.
  if (!moment?.title) await autoName(db, momentId, text);

  // The interview picks it up from here. 4.1.3: Josh can talk for two minutes and be done — the
  // follow-up happens later, on his time.
  await enqueue(db, "interview_step", { moment_id: momentId });
}

/**
 * A transcript that is not a moment: close the idea it was captured into, and answer the person.
 *
 * Killed rather than deleted (6.3), with the reason in the row, so every one of these can be read
 * back and argued with — including by us, if a rule here turns out to be too eager.
 *
 * The reply matters as much as the cleanup. The failure Josh saw was not only a junk idea, it was
 * being asked an interview question in response to "What do you mean?" — the system talking past him.
 * Each branch below says something a person would say.
 */
async function ruleOut(
  db: SupabaseClient,
  momentId: number,
  chatId: number | null,
  // Every verdict except "moment" — a moment is interviewed, not ruled out, and the compiler should
  // say so rather than this function quietly accepting one.
  verdict: Exclude<VoiceVerdict, { kind: "moment" }>,
  text: string,
): Promise<void> {
  const reason = verdict.kind === "unheard"
    ? "The recording could not be transcribed, so there was nothing to put in the bank."
    : verdict.kind === "chatter"
    ? "A courtesy, not a moment."
    : verdict.kind === "question"
    ? "A question to the bot, not a thought about his work."
    : `The same thing he had just said, kept on idea ${verdict.of} instead.`;

  await db.from("moments").update({
    killed: true,
    parked_reason: reason,
    updated_at: new Date().toISOString(),
  }).eq("id", momentId);

  await logEvent(db, "capture_ruled_out", "info", {
    moment_id: momentId,
    kind: verdict.kind,
    ...(verdict.kind === "repeat" ? { same_as: verdict.of, overlap: verdict.overlap } : {}),
    chars: text.length,
  });

  // The audio and the transcript stay on the killed moment either way. For a repeat that is the
  // point: the second telling often has the detail the first one missed, and the interview on the
  // original idea can still be given it.
  if (!chatId) return;

  if (verdict.kind === "unheard") {
    await sendMessage(
      chatId,
      "I could not make out that recording — nothing of it reached the bank. Send it again, or type " +
        "it if it is easier.",
    );
    return;
  }

  if (verdict.kind === "question") {
    /*
     * ANSWER HIM.
     *
     * The same triage the typed path uses, so a question asked by voice gets the same answer a
     * question asked by typing would. It also writes his actual words into the conversation, which
     * is the other half of this fault: `chat_messages` records a voice note as "(a voice note)", so
     * everything that reads the conversation to understand the next message was blind to anything he
     * said out loud — and he says almost everything out loud.
     */
    await db.from("chat_messages").insert({ chat_id: chatId, direction: "in", body: text })
      .then(({ error }) => {
        if (error) console.error(`chat_messages(voice) failed: ${error.message}`);
      });

    const triaged = await triageMessage(db, text, null, chatId);
    const answer = triaged.reply?.trim();
    await sendMessage(
      chatId,
      answer ||
        "That one is a question rather than a thought to file, so I have not put it in the bank. Ask " +
          "me again and I will answer properly.",
    );
    return;
  }

  if (verdict.kind === "repeat") {
    const { data: original } = await db
      .from("moments")
      .select("title")
      .eq("id", verdict.of)
      .maybeSingle();

    await sendMessage(
      chatId,
      `That is the same one you just told me${original?.title ? ` — "${original.title}"` : ""}, so I ` +
        `have kept it there rather than starting a second idea about it.`,
    );
  }
  // Chatter says nothing, which is the existing behaviour for a typed courtesy and the right one: a
  // reply to "thanks" is noise in his pocket.
}

/**
 * 8.1 — the recorded interview, straight into the library section it is the source of truth for.
 *
 * Appended rather than replaced. The interview will not happen in one sitting, and losing the first
 * twenty minutes because he recorded a second thought later would be a poor way to treat the one
 * input the voice guide cannot be built without.
 */
async function transcribeVoiceGuide(db: SupabaseClient, job: Job): Promise<void> {
  const recordingId = Number(job.payload.recording_id);

  const { data: rec, error } = await db
    .from("library_recordings")
    .select("id, section_key, audio_path, transcript")
    .eq("id", recordingId)
    .single();
  if (error || !rec) throw new Error(`library_recording ${recordingId} not found`);
  if (rec.transcript) return; // already done; the job was retried after a partial failure

  const text = await transcribeStored(db, "voice-notes", rec.audio_path, {
    onDone: async (result) => {
      await db.from("library_recordings").update({
        transcript: result.text,
        duration_seconds: result.durationSeconds,
        transcribed_at: new Date().toISOString(),
      }).eq("id", recordingId);
    },
  });

  if (!text.trim()) {
    await sendMessage(
      joshChatId(),
      "I could not make anything out of that recording. The audio is kept — try again when you can.",
    );
    return;
  }

  const { data: section } = await db
    .from("library_sections")
    .select("body")
    .eq("key", rec.section_key)
    .single();

  const stamp = new Date().toISOString().slice(0, 10);
  const appended = `${(section?.body ?? "").trimEnd()}\n\n---\n\n## Recorded ${stamp}\n\n${text}\n`;

  // The ordinary section update path, so it versions like any other library edit (8.4) and the
  // change reaches the very next draft (8.6).
  await db.from("library_sections").update({ body: appended }).eq("key", rec.section_key);

  await sendMessage(
    joshChatId(),
    `Got it — ${text.split(/\s+/).length} words into the voice interview.\n\n` +
      `Keep going whenever you like, it appends. The voice guide gets written from this, and this ` +
      `is what wins if the two ever disagree.`,
  );
}

/** Download, transcribe, and hand the result to the caller to record however it needs to. */
async function transcribeStored(
  db: SupabaseClient,
  bucket: string,
  path: string,
  opts: { onDone: (r: Transcription) => Promise<void> },
): Promise<string> {
  const { data: file, error } = await db.storage.from(bucket).download(path);
  if (error || !file) throw new Error(`could not read audio: ${error?.message}`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await transcribe(bytes, file.type || "audio/ogg");
  // The provider that ANSWERED, not the one we asked first: `transcribe` falls back to Whisper when
  // Deepgram fails, and a fallback that quietly bills a different company is exactly what 15.3 is
  // about. Trimmed of the model suffix ("deepgram:nova-3") — the service is what Josh is told.
  await noteProvider(db, result.provider.split(":")[0], "transcription");
  await opts.onDone(result);
  return result.text;
}
