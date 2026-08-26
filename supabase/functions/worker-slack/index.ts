/**
 * 4.5 — SLACK. Optional, and off by default.
 *
 *   4.5.2 "Must be switchable off entirely, and off by default until Josh says otherwise."
 *
 * So the first thing this does is check the flag, and the flag ships as false. Nothing about Slack
 * runs until Josh turns it on himself, from the settings table or the app.
 *
 *   4.5.3 "Slack contains other people's words in places they did not expect to be quoted. The
 *          naming rule in clause 9c applies with particular force here."
 *
 * Every name found is recorded and none is ever cleared automatically — the same as every other
 * input, but it matters more here. And like the other automatic inputs, this produces candidates
 * only (4.5.4): a Slack thread records what was said, never what Josh thought about it.
 *
 * Reads only conversations Josh already has access to, using HIS token. It joins nothing, posts
 * nothing, and reads no DMs unless the token he issues includes them.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets, secret } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";

const SLACK = "https://slack.com/api";

/** Kept small on purpose: this is a low-signal input and 4.4.3's warning about volume applies. */
const MAX_CHANNELS_PER_RUN = 8;
const MAX_MESSAGES_PER_CHANNEL = 60;

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);

  // 4.5.2 — the switch, checked first, defaulting to off.
  const enabled = await getSetting(db, "slack_enabled", false);
  if (!enabled) return json({ ok: true, skipped: "slack is off" });

  const token = secret("SLACK_USER_TOKEN");
  if (!token) {
    await logEvent(db, "slack_unconfigured", "warn", {
      detail: "slack_enabled is true but SLACK_USER_TOKEN is not set",
    });
    return json({ ok: false, error: "SLACK_USER_TOKEN not set" }, 400);
  }

  const channels = await listChannels(db, token);
  if (channels.length === 0) return json({ ok: true, channels: 0 });

  let queued = 0;
  for (const channel of channels.slice(0, MAX_CHANNELS_PER_RUN)) {
    try {
      const digest = await readChannel(db, token, channel);
      if (!digest) continue;

      const key = `triage:slack:${channel.id}:${digest.latestTs}`;
      const { data: seen } = await db
        .from("jobs").select("id").eq("dedupe_key", key).maybeSingle();
      if (seen) continue;

      await db.from("jobs").insert({
        type: "triage_digest",
        payload: {
          source: "slack",
          source_ref: `${channel.id}:${digest.latestTs}`,
          digest: digest.text,
        },
        dedupe_key: key,
      });
      queued++;

      await db.from("slack_state").upsert({
        channel_id: channel.id,
        channel_name: channel.name,
        last_ts: digest.latestTs,
        last_read_at: new Date().toISOString(),
        messages_seen: digest.count,
      });
    } catch (err) {
      // 13.2 — one bad channel must not stop the sweep, and must not vanish either.
      await logEvent(db, "slack_channel_failed", "warn", {
        channel: channel.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json({ ok: true, channels: channels.length, queued });
});

interface Channel {
  id: string;
  name: string;
  lastTs: string | null;
}

async function listChannels(db: SupabaseClient, token: string): Promise<Channel[]> {
  const res = await call(token, "conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: "200",
  });

  const { data: state } = await db.from("slack_state").select("channel_id, last_ts, enabled");
  const known = new Map((state ?? []).map((s) => [s.channel_id, s]));

  // deno-lint-ignore no-explicit-any
  return (res.channels ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((c: any) => c.is_member) // only what Josh is actually in (4.5.1)
    // deno-lint-ignore no-explicit-any
    .filter((c: any) => known.get(c.id)?.enabled !== false)
    // deno-lint-ignore no-explicit-any
    .map((c: any) => ({
      id: c.id as string,
      name: c.name as string,
      lastTs: known.get(c.id)?.last_ts ?? null,
    }))
    // Channels never read before go last: catching up on history is lower value than what is
    // being said now, and doing it all at once would bury Josh.
    .sort((a: Channel, b: Channel) => (a.lastTs ? 0 : 1) - (b.lastTs ? 0 : 1));
}

async function readChannel(
  db: SupabaseClient,
  token: string,
  channel: Channel,
): Promise<{ text: string; latestTs: string; count: number } | null> {
  const params: Record<string, string> = {
    channel: channel.id,
    limit: String(MAX_MESSAGES_PER_CHANNEL),
  };
  if (channel.lastTs) {
    params.oldest = channel.lastTs;
  } else {
    // First read of a channel: the last day only, not its entire history.
    params.oldest = String(Math.floor((Date.now() - 86_400_000) / 1000));
  }

  const res = await call(token, "conversations.history", params);
  // deno-lint-ignore no-explicit-any
  const messages: any[] = (res.messages ?? []).filter((m: any) => m.type === "message" && m.text);
  if (messages.length < 3) return null; // not a conversation, just noise

  const names = await resolveUsers(token, messages.map((m) => m.user).filter(Boolean));

  messages.reverse(); // Slack returns newest first; a conversation reads better forwards
  const lines = messages.map((m) => `${names.get(m.user) ?? "someone"}: ${collapse(m.text)}`);
  const latestTs = messages[messages.length - 1].ts as string;

  return {
    latestTs,
    count: messages.length,
    text: [
      `SLACK CHANNEL: #${channel.name}`,
      `Messages: ${messages.length}`,
      "",
      "These are other people's words, written where they did not expect to be quoted.",
      "Record every name. Treat all of them as off-limits unless Josh clears them.",
      "",
      lines.join("\n"),
    ].join("\n").slice(0, 40_000),
  };
}

/** Display names, so the digest reads as a conversation rather than as user IDs. */
async function resolveUsers(token: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(ids)].slice(0, 30)) {
    try {
      const res = await call(token, "users.info", { user: id });
      const name = res.user?.profile?.display_name || res.user?.profile?.real_name || res.user?.name;
      if (name) out.set(id, name);
    } catch {
      // A name we cannot resolve stays anonymous, which is the safer failure here anyway.
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function call(token: string, method: string, params: Record<string, string>): Promise<any> {
  const url = `${SLACK}/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`slack ${method}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`slack ${method}: ${data.error}`);
  return data;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}
