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
import { logEvent } from "../db.ts";
import { enqueue } from "../jobs.ts";
import { pushBack } from "../pushback.ts";
import { transcribe, type Transcription } from "../stt.ts";
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

  // The interview picks it up from here. 4.1.3: Josh can talk for two minutes and be done — the
  // follow-up happens later, on his time.
  await enqueue(db, "interview_step", { moment_id: momentId });
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
  await opts.onDone(result);
  return result.text;
}
