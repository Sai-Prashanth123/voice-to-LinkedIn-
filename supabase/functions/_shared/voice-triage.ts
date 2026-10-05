/**
 * What to do with a voice note once there are finally words in it.
 *
 * WHY THIS EXISTS, FROM JOSH'S SWEEP ON 5 OCTOBER
 *
 * The weekly sweep asked him five questions and he answered all five by voice. Four minutes later his
 * idea bank held this:
 *
 *   "What do you mean?"                         → an idea named "What do you mean", and the bot then
 *                                                 asked him a question about it
 *   "Are these questions ... dynamic?"           → answered, AND filed as an idea called
 *                                                 "Questions responding previous response"
 *   (transcription came back empty)              → an unnamed idea with nothing in it, interviewed
 *   "Like I said, I got a campaign idea from
 *    reading someone else's outreach"            → a SECOND idea for the story he had already given
 *
 * One of the five was a real moment and became a post that cleared the gate. The other four were
 * noise, and "Like I said" is him telling us he had already answered.
 *
 * The cause is one line of reasoning that was true and is not. At capture a typed message is checked
 * against `isChatter` and a voice note is exempt, on the grounds that "nobody records audio to say
 * thanks". That is right about thanks and wrong about everything else: people absolutely record audio
 * to ask a question, and at capture time there are no words to judge. So the judgement has to happen
 * when the transcript arrives, which is here.
 *
 * WHAT IT WILL NOT DO
 *
 * Decide that a real moment is noise. Every rule below is narrow and each one has to be wrong in an
 * obvious, inspectable way: an empty string, a question aimed at the system, a courtesy, or a near
 * repeat of something he said minutes ago in the same conversation. Anything else is a moment and is
 * interviewed exactly as before. Dropping one of his moments is far worse than keeping a junk one,
 * and nothing here deletes: a moment ruled out is killed and labelled (6.3), so it can be read back.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** What the transcript turned out to be. */
export type VoiceVerdict =
  | { kind: "moment" }
  | { kind: "unheard" }
  | { kind: "chatter" }
  | { kind: "question" }
  | { kind: "repeat"; of: number; overlap: number };

/** Words that carry no topic, so they cannot be evidence that two things are the same thing. */
const STOPWORDS = new Set([
  "a", "about", "actually", "all", "also", "am", "an", "and", "any", "are", "as", "at", "back", "be",
  "because", "been", "but", "by", "can", "did", "do", "does", "for", "from", "get", "got", "had",
  "has", "have", "he", "her", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just",
  "like", "me", "my", "no", "not", "of", "on", "one", "or", "our", "out", "really", "said", "say",
  "she", "so", "some", "someone", "something", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "up", "us", "was", "we", "were", "what", "when", "which", "who",
  "will", "with", "would", "you", "your",
]);

/** The topic words in a piece of speech, lowercased and stripped of punctuation. */
export function keyWords(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * How much two pieces of speech are about the same thing, 0 to 1.
 *
 * The overlap coefficient rather than Jaccard, deliberately. Josh's two answers were the same story
 * told at different lengths, and Jaccard punishes the extra words in the longer telling: it scored
 * them 0.42 while the shorter one was 71% contained in the longer. Containment is the question being
 * asked — "has he already said this?" — so containment is what is measured.
 */
export function sameThing(a: string, b: string): number {
  const x = keyWords(a), y = keyWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** Two topic words in common is a coincidence, not a repeat, however high the ratio. */
const MIN_SHARED_WORDS = 3;
const REPEAT_OVERLAP = 0.6;
/** Long enough to cover one sweep or one train of thought; short enough that tomorrow is its own. */
export const REPEAT_WINDOW_MS = 25 * 60_000;

/**
 * A question aimed at the system rather than a thought about his work.
 *
 * Deliberately crude and deliberately narrow, because the model-backed triage is the real judge and
 * this is the floor under it: it has to hold when the free tier is exhausted, which is exactly when
 * Josh is most likely to be mid-sweep and least likely to forgive a junk idea.
 *
 * "What do you mean?" is the canonical case. So is asking about the system itself — "are these
 * questions dynamic", "did you get that", "can you hear me". A question ABOUT HIS WORK is not this:
 * "why did that campaign fail?" has a topic and is a moment.
 */
export function isQuestionToTheBot(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (!t) return false;

  // "What do you mean", "sorry what", "come again" — a request to repeat, with no topic of its own.
  if (/^(sorry,?\s+)?(what|come again|pardon|huh|say that again|repeat that)( do you mean| was that| sorry)?\??$/.test(t)) {
    return true;
  }

  const asksSomething = t.endsWith("?") ||
    /^(are|is|do|does|did|can|could|will|would|should|have|has|was|were|why|how|what|who|when|where)\b/.test(t);
  if (!asksSomething) return false;

  /*
   * IT HAS TO NAME SOMETHING OF OURS.
   *
   * The first version asked whether the question mentioned "you", and that is far too much: "how
   * would you handle a boss who keeps changing the number" is one of his moments and says "you" in
   * the ordinary way people do. What distinguishes a question to the bot is that its SUBJECT is this
   * system — the questions it asks, the recording it took, the app itself.
   *
   * It also had a cap of eight topic words, which threw out the real case it was written for: his
   * "are these questions that you're asking dynamic in terms of, like, responding?" carries ten. The
   * cap is now only a backstop against a long story that happens to mention the app in passing.
   */
  const namesTheSystem =
    /\b(these|those|the|your) (questions?|prompts?)\b|\byou('re| are)? (asking|sending|recording)\b|\b(the|this) (bot|system|app|tool)\b|\bthat recording\b|\bmy (voice note|recording)\b|\byou (get|hear|receive)\b/
      .test(t);
  if (!namesTheSystem) return false;

  // His work, not ours: if the question is about a client or a campaign, it is a moment even when it
  // also mentions the app.
  const aboutHisWork =
    /\b(client|prospect|campaign|deal|team|sdr|bdr|list|data|account|post|linkedin|pricing|renewal)\b/
      .test(t);

  return !aboutHisWork && keyWords(t).size <= 25;
}

/**
 * Judge one freshly transcribed voice note, with the conversation it arrived in.
 *
 * `recent` is what else was captured in the same chat shortly before, newest first. The caller
 * supplies it rather than this reaching for it, so the rule stays testable without a database.
 */
export function judgeTranscript(
  text: string,
  recent: { moment_id: number; transcript: string; at: string }[] = [],
  opts: { now?: Date; isChatter?: (t: string) => boolean } = {},
): VoiceVerdict {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { kind: "unheard" };

  if (opts.isChatter?.(trimmed)) return { kind: "chatter" };
  if (isQuestionToTheBot(trimmed)) return { kind: "question" };

  const now = opts.now ?? new Date();
  for (const prior of recent) {
    if (!prior.transcript?.trim()) continue;
    if (now.getTime() - new Date(prior.at).getTime() > REPEAT_WINDOW_MS) continue;

    const overlap = sameThing(trimmed, prior.transcript);
    const shared = [...keyWords(trimmed)].filter((w) => keyWords(prior.transcript).has(w)).length;
    if (overlap >= REPEAT_OVERLAP && shared >= MIN_SHARED_WORDS) {
      return { kind: "repeat", of: prior.moment_id, overlap: +overlap.toFixed(2) };
    }
  }

  return { kind: "moment" };
}

/** The moments captured in this chat just before, with their transcripts. Newest first. */
export async function recentCaptures(
  db: SupabaseClient,
  chatId: number | null,
  exceptMomentId: number,
): Promise<{ moment_id: number; transcript: string; at: string }[]> {
  if (!chatId) return [];

  const since = new Date(Date.now() - REPEAT_WINDOW_MS).toISOString();
  const { data } = await db
    .from("moments")
    .select("id, captured_at, killed, raw_inputs(transcript, text_body)")
    .eq("chat_id", chatId)
    .eq("killed", false)
    .gte("captured_at", since)
    .order("id", { ascending: false })
    .limit(10);

  return (data ?? [])
    .filter((m) => Number(m.id) !== exceptMomentId)
    .map((m) => {
      const inputs = (m.raw_inputs ?? []) as { transcript: string | null; text_body: string | null }[];
      const transcript = inputs.map((r) => r.transcript ?? r.text_body ?? "").join(" ").trim();
      return { moment_id: Number(m.id), transcript, at: String(m.captured_at) };
    })
    .filter((r) => r.transcript.length > 0);
}
