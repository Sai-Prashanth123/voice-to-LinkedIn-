/**
 * Speech to text (4.1.2).
 *
 * Josh's voice notes are the primary input, so this runs on every capture. Both the audio AND the
 * transcript are kept — 4.1.2 is explicit, and the audio is the only recoverable record if a
 * transcription is poor.
 *
 * Deepgram by default (cheapest per minute at this volume, good on conversational speech and
 * accents). Swappable: the provider is behind one function, and OpenAI Whisper is wired as a
 * fallback so a single provider outage does not lose a capture.
 */

import { secret } from "./secrets.ts";
export interface Transcription {
  text: string;
  provider: string;
  durationSeconds: number | null;
}

export async function transcribe(bytes: Uint8Array<ArrayBuffer>, mimeType: string): Promise<Transcription> {
  const deepgram = secret("DEEPGRAM_API_KEY");
  const openai = secret("OPENAI_API_KEY");

  if (deepgram) {
    try {
      return await viaDeepgram(bytes, mimeType, deepgram);
    } catch (err) {
      if (!openai) throw err;
      // Fall through — losing a captured moment is worse than paying more for one transcription.
    }
  }
  if (openai) return await viaWhisper(bytes, mimeType, openai);

  throw new Error("No transcription provider configured (DEEPGRAM_API_KEY or OPENAI_API_KEY)");
}

async function viaDeepgram(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  key: string,
): Promise<Transcription> {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    // Josh is the only speaker on a voice note; diarisation is wasted cost here.
    diarize: "false",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": mimeType },
    body: bytes,
  });
  if (!res.ok) throw new Error(`deepgram ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  const text = (alt?.transcript ?? "").trim();
  if (!text) throw new Error("deepgram returned an empty transcript");

  return {
    text,
    provider: "deepgram:nova-3",
    durationSeconds: data?.metadata?.duration ?? null,
  };
}

async function viaWhisper(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  key: string,
): Promise<Transcription> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), "note.ogg");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = (data?.text ?? "").trim();
  if (!text) throw new Error("whisper returned an empty transcript");
  return { text, provider: "openai:whisper-1", durationSeconds: null };
}
