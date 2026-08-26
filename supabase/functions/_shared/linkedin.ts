/**
 * LinkedIn (clause 11, 12.1).
 *
 * Two scopes with very different access paths, which is why this is built rather than bought:
 *
 *   w_member_social        — posting. SELF-SERVE: add the "Share on LinkedIn" product in the
 *                            developer portal, no review. This is the part that must work.
 *   r_member_postAnalytics — impressions, reach, reactions, comments for a personal profile
 *                            (memberCreatorPostAnalytics). GATED behind Community Management API
 *                            review, requiring a registered company and a Page admin.
 *
 * The system therefore publishes from day one and degrades gracefully on analytics: clause 12.3
 * says the two automatic signals must be enough on their own, and draft-vs-published (12.2) is
 * entirely within our control. A missing metrics pull is recorded, not fatal.
 *
 * R3 IS NOT ENFORCED HERE. It is enforced by check constraints on `posts` (migration 0003), because
 * "the system never publishes on its own, under any circumstance" should not depend on a caller
 * remembering to check a flag.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { secret } from "./secrets.ts";

const API = "https://api.linkedin.com";
const VERSION = "202608";

export interface LinkedInAuth {
  member_urn: string;
  access_token: string;
  has_post_analytics: boolean;
}

export async function getAuth(db: SupabaseClient): Promise<LinkedInAuth> {
  const { data } = await db.from("linkedin_auth").select("*").eq("id", true).single();
  if (!data?.access_token || !data?.member_urn) {
    throw new Error("LinkedIn is not connected: no access token stored");
  }

  const expires = data.access_expires_at ? new Date(data.access_expires_at).getTime() : 0;
  if (expires && expires < Date.now() + 5 * 60_000) {
    const refreshed = await refresh(db, data.refresh_token);
    if (refreshed) return refreshed;
    throw new Error("LinkedIn access token has expired and could not be refreshed");
  }

  return {
    member_urn: data.member_urn,
    access_token: data.access_token,
    has_post_analytics: data.has_post_analytics,
  };
}

async function refresh(db: SupabaseClient, refreshToken: string | null): Promise<LinkedInAuth | null> {
  const clientId = secret("LINKEDIN_CLIENT_ID");
  const clientSecret = secret("LINKEDIN_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) return null;

  const res = await fetch(`${API}/oauth/v2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    await db.from("linkedin_auth").update({
      last_error: `refresh failed: ${res.status} ${await res.text()}`,
    }).eq("id", true);
    return null;
  }

  const t = await res.json();
  const { data } = await db.from("linkedin_auth").update({
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? refreshToken,
    access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", true).select("*").single();

  return data
    ? {
      member_urn: data.member_urn,
      access_token: data.access_token,
      has_post_analytics: data.has_post_analytics,
    }
    : null;
}

function headers(auth: LinkedInAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.access_token}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": VERSION,
    "Content-Type": "application/json",
  };
}

/** Publish. Returns the post URN. Called only for posts Josh has marked ready (11.2). */
export async function publish(
  auth: LinkedInAuth,
  text: string,
  image?: { bytes: Uint8Array<ArrayBuffer>; altText: string },
): Promise<string> {
  let mediaUrn: string | null = null;
  if (image) mediaUrn = await uploadImage(auth, image.bytes);

  const body: Record<string, unknown> = {
    author: auth.member_urn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (mediaUrn) {
    body.content = { media: { id: mediaUrn, altText: image!.altText.slice(0, 300) } };
  }

  const res = await fetch(`${API}/rest/posts`, {
    method: "POST",
    headers: headers(auth),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`);

  const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  if (!urn) throw new Error("LinkedIn accepted the post but returned no id");
  return urn;
}

async function uploadImage(auth: LinkedInAuth, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const init = await fetch(`${API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(auth),
    body: JSON.stringify({ initializeUploadRequest: { owner: auth.member_urn } }),
  });
  if (!init.ok) throw new Error(`image init failed: ${init.status} ${await init.text()}`);

  const { value } = await init.json();
  const put = await fetch(value.uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${auth.access_token}` },
    body: bytes,
  });
  if (!put.ok) throw new Error(`image upload failed: ${put.status}`);
  return value.image as string;
}

export interface PostMetrics {
  impressions: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  reshares: number | null;
}

/**
 * 12.1 — pulled at seven days, with no action from Josh at any point.
 *
 * Returns null when the analytics scope has not been granted, so the caller records the gap rather
 * than failing the post. The learning loop is designed to survive this (12.3).
 */
export async function fetchMetrics(
  auth: LinkedInAuth,
  postUrn: string,
): Promise<PostMetrics | null> {
  if (!auth.has_post_analytics) return null;

  const url = `${API}/rest/memberCreatorPostAnalytics` +
    `?q=memberAndPost&member=${encodeURIComponent(auth.member_urn)}` +
    `&post=${encodeURIComponent(postUrn)}`;

  const res = await fetch(url, { headers: headers(auth) });
  if (!res.ok) throw new Error(`LinkedIn analytics failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const e = data?.elements?.[0] ?? data;
  return {
    impressions: num(e?.impressionCount ?? e?.impressions),
    reach: num(e?.uniqueImpressionsCount ?? e?.membersReached ?? e?.reach),
    reactions: num(e?.reactionCount ?? e?.likeCount),
    comments: num(e?.commentCount),
    reshares: num(e?.shareCount ?? e?.reshareCount),
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
