/**
 * 4.3 — CALL TRANSCRIPTS. In scope, and not optional.
 *
 *   4.3.1 "Must ingest new transcripts automatically, with no action from Josh."
 *
 * Which recorder Josh uses is not stated in the spec and is still open, so this is built to accept
 * any of them rather than betting on one. Every recorder worth using can POST a webhook when a call
 * finishes; the shapes differ, so each is normalised here and anything unrecognised falls back to a
 * generic reader that looks for the obvious fields.
 *
 * Adding a new recorder is one function in ADAPTERS. Nothing downstream changes.
 *
 * 4.3.3 — this NEVER produces a draft. It creates a triage job, which produces candidates, which
 * only become writable material after Josh has been interviewed about them.
 */

import { admin, logEvent } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";

interface Normalised {
  externalId: string;
  title: string;
  startedAt: string | null;
  participants: string[];
  transcript: string;
}

Deno.serve(async (req) => {
  // Shared secret in a header or the query string — recorders differ in what they can send.
  const db = admin();
  await loadSecrets(db);

  const expected = secret("TRANSCRIPT_WEBHOOK_SECRET");
  const provided = req.headers.get("x-webhook-secret") ??
    new URL(req.url).searchParams.get("secret");
  if (expected && provided !== expected) return json({ ok: false }, 401);

  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }

  let call: Normalised | null = null;
  let adapter = "generic";
  for (const [name, fn] of Object.entries(ADAPTERS)) {
    const result = fn(payload);
    if (result) {
      call = result;
      adapter = name;
      break;
    }
  }

  if (!call || call.transcript.trim().length < 200) {
    // A call with almost nothing said is not a failure worth alerting on, but it is worth recording
    // so a silently mis-shaped integration is visible rather than looking like quiet weeks.
    await logEvent(db, "transcript_ignored", "info", {
      adapter,
      reason: call ? "transcript too short" : "unrecognised payload shape",
      keys: Object.keys(payload).slice(0, 20),
    });
    return json({ ok: true, ignored: true, adapter });
  }

  // Same call arriving twice — recorders retry — must not produce two candidates.
  const { data: existing } = await db
    .from("moments")
    .select("id")
    .eq("source", "call_transcript")
    .eq("source_ref", call.externalId)
    .maybeSingle();

  const { data: queued } = await db
    .from("jobs")
    .select("id")
    .eq("dedupe_key", `triage:call_transcript:${call.externalId}`)
    .maybeSingle();

  if (existing || queued) return json({ ok: true, duplicate: true });

  await db.from("jobs").insert({
    type: "triage_digest",
    payload: {
      source: "call_transcript",
      source_ref: call.externalId,
      digest: buildDigest(call),
    },
    dedupe_key: `triage:call_transcript:${call.externalId}`,
  });

  await logEvent(db, "transcript_received", "info", {
    adapter,
    call: call.externalId,
    title: call.title,
    chars: call.transcript.length,
  });

  return json({ ok: true, adapter, queued: true });
});

/**
 * The digest sent to triage. Deliberately the whole transcript rather than a summary: unlike a
 * Claude Code log (which is enormous and mostly machine output), a call transcript is the actual
 * words people said, and that is exactly what a candidate needs to be judged on.
 *
 * Capped so one three-hour call cannot blow the triage budget.
 */
function buildDigest(call: Normalised): string {
  return [
    `CALL: ${call.title}`,
    `When: ${call.startedAt ?? "unknown"}`,
    `Who was on it: ${call.participants.join(", ") || "not recorded"}`,
    "",
    "TRANSCRIPT:",
    call.transcript.slice(0, 50_000),
  ].join("\n");
}

/* ── Adapters ─────────────────────────────────────────────────────────────── */

type Adapter = (p: Record<string, unknown>) => Normalised | null;

// deno-lint-ignore no-explicit-any
const get = (o: any, ...path: string[]): any =>
  path.reduce((acc, k) => (acc == null ? acc : acc[k]), o);

const ADAPTERS: Record<string, Adapter> = {
  /** Fireflies — `meeting_id`, sentences with speaker names. */
  fireflies: (p) => {
    const id = get(p, "meeting_id") ?? get(p, "meetingId");
    const sentences = get(p, "transcript", "sentences") ?? get(p, "sentences");
    if (!id || !Array.isArray(sentences)) return null;
    return {
      externalId: String(id),
      title: String(get(p, "title") ?? get(p, "meeting_title") ?? "Call"),
      startedAt: get(p, "date") ?? null,
      participants: uniq(sentences.map((s) => s?.speaker_name).filter(Boolean)),
      // deno-lint-ignore no-explicit-any
      transcript: sentences.map((s: any) => `${s.speaker_name ?? "?"}: ${s.text ?? ""}`).join("\n"),
    };
  },

  /** Fathom — a `recording` object with a `transcript` array. */
  fathom: (p) => {
    const id = get(p, "recording", "id") ?? get(p, "recording_id");
    const lines = get(p, "recording", "transcript") ?? get(p, "transcript");
    if (!id || !Array.isArray(lines)) return null;
    return {
      externalId: String(id),
      title: String(get(p, "recording", "title") ?? get(p, "title") ?? "Call"),
      startedAt: get(p, "recording", "started_at") ?? null,
      participants: uniq(lines.map((l) => l?.speaker?.name ?? l?.speaker).filter(Boolean)),
      // deno-lint-ignore no-explicit-any
      transcript: lines.map((l: any) =>
        `${l.speaker?.name ?? l.speaker ?? "?"}: ${l.text ?? l.transcript ?? ""}`
      ).join("\n"),
    };
  },

  /** Otter / Granola style — a flat `transcript` string plus an id. */
  flat: (p) => {
    const id = get(p, "id") ?? get(p, "conversation_id") ?? get(p, "note_id");
    const text = get(p, "transcript") ?? get(p, "text") ?? get(p, "content");
    if (!id || typeof text !== "string") return null;
    return {
      externalId: String(id),
      title: String(get(p, "title") ?? get(p, "name") ?? "Call"),
      startedAt: get(p, "created_at") ?? get(p, "start_time") ?? null,
      participants: Array.isArray(get(p, "participants"))
        // deno-lint-ignore no-explicit-any
        ? uniq(get(p, "participants").map((x: any) => x?.name ?? x).filter(Boolean))
        : [],
      transcript: text,
    };
  },

  /**
   * Last resort: find an id-like field and the longest string in the payload and treat it as the
   * transcript. Crude, but it means an unfamiliar recorder still works on day one rather than
   * silently dropping every call until someone writes an adapter.
   */
  generic: (p) => {
    const id = get(p, "id") ?? get(p, "uuid") ?? get(p, "call_id") ?? get(p, "meeting_id");
    if (!id) return null;
    let longest = "";
    const walk = (v: unknown, depth: number): void => {
      if (depth > 4) return;
      if (typeof v === "string") {
        if (v.length > longest.length) longest = v;
      } else if (Array.isArray(v)) {
        v.forEach((x) => walk(x, depth + 1));
      } else if (v && typeof v === "object") {
        Object.values(v).forEach((x) => walk(x, depth + 1));
      }
    };
    walk(p, 0);
    if (longest.length < 200) return null;
    return {
      externalId: String(id),
      title: String(get(p, "title") ?? "Call"),
      startedAt: null,
      participants: [],
      transcript: longest,
    };
  },
};

function uniq(values: unknown[]): string[] {
  return [...new Set(values.map(String))];
}
