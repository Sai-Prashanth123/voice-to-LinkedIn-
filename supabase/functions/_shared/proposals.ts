/**
 * 12.9–12.12 — the dashed line back to the library, and the only hand on it.
 *
 *   "The system must look across these signals and propose specific changes to the reference
 *    library, each with the evidence behind it." (12.9)
 *   "Josh approves or rejects each one. The system never changes the library on its own." (12.10)
 *
 * `worker-learn` writes proposals every Monday at seven in the morning and then does nothing with
 * them. Josh lives in Telegram and has no reason to open a proposals page, so the closing step of
 * the whole loop depended on him remembering a URL existed. A proposal nobody sees is a proposal
 * nobody approves, and the library never tunes.
 *
 * So they are surfaced inside the pass he already does — the same reasoning that put the
 * conversation question there, and the same rule from 12.7: no new habit, no reminder, no second
 * place to go.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO
 *
 * Approving is the only path that touches `library_sections`, and it refuses to report success
 * unless a row actually changed. The previous version updated with `.eq("immutable", false)` and
 * marked the proposal approved regardless — so a proposal against the core rules would have been
 * recorded as accepted while changing nothing, which is the worst of both: a lie in the audit trail
 * about the one thing that must never move.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEvent } from "./db.ts";

export interface Proposal {
  id: number;
  section_key: string;
  claim: string;
  proposed_body: string;
  evidence: { post_ids?: number[]; observation?: string } | null;
  created_at: string;
}

export async function openProposals(db: SupabaseClient, limit = 5): Promise<Proposal[]> {
  const { data } = await db
    .from("library_proposals")
    .select("id, section_key, claim, proposed_body, evidence, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as Proposal[];
}

/**
 * Josh's decision, applied.
 *
 * @returns what actually happened, so the caller can tell him the truth rather than assuming.
 */
export async function decide(
  db: SupabaseClient,
  proposalId: number,
  approve: boolean,
  reason?: string | null,
): Promise<{ ok: boolean; sectionKey: string; version: number | null; error?: string }> {
  const { data: proposal } = await db
    .from("library_proposals")
    .select("section_key, proposed_body, status")
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) return { ok: false, sectionKey: "", version: null, error: "proposal not found" };
  if (proposal.status !== "open") {
    return { ok: false, sectionKey: proposal.section_key, version: null, error: "already decided" };
  }

  let version: number | null = null;
  let sectionVersion: number | null = null;

  if (approve) {
    // `select()` so the result says whether a row changed. An immutable section matches nothing, and
    // silently matching nothing must not be reported as an applied change.
    const { data: updated, error } = await db
      .from("library_sections")
      .update({ body: proposal.proposed_body })
      .eq("key", proposal.section_key)
      .eq("immutable", false)
      .select("key, version");

    if (error || !updated || updated.length === 0) {
      await logEvent(db, "proposal_apply_failed", "warn", {
        proposal_id: proposalId,
        section_key: proposal.section_key,
        error: error?.message ?? "section is immutable or does not exist",
      });
      return {
        ok: false,
        sectionKey: proposal.section_key,
        version: null,
        error: error?.message ??
          `${proposal.section_key} cannot be changed — the core rules are closed to the learning loop`,
      };
    }

    // Read AFTER the update: the trigger on library_sections has rolled the version forward, and
    // 12.11 wants the version the change actually took effect in.
    const { data: v } = await db
      .from("library_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = v?.version ?? null;
    sectionVersion = (updated[0] as { version?: number }).version ?? null;

    // 12.11 — "recorded with the date and the reason."
    //
    // The history trigger writes (key, version, body) and leaves `reason` null, because a trigger
    // cannot know why. Nothing ever filled it in, so the rollback list read "v5 v4 v3" with no way
    // to tell a version that came from a proposal from one Josh typed himself.
    if (sectionVersion) {
      await db.from("library_section_versions")
        .update({
          reason: `proposal #${proposalId} approved${reason?.trim() ? `: ${reason.trim()}` : ""}`,
        })
        .eq("key", proposal.section_key)
        .eq("version", sectionVersion);
    }
  }

  await db.from("library_proposals").update({
    status: approve ? "approved" : "rejected",
    decided_at: new Date().toISOString(),
    decided_reason: reason?.trim() || null,
    applied_library_version: version,
    // 12.12 — `applied_library_version` is the SNAPSHOT counter and this is the SECTION counter.
    // Without both, a rollback of section v5 cannot find the proposal that produced it.
    applied_section_version: sectionVersion,
  }).eq("id", proposalId);

  return { ok: true, sectionKey: proposal.section_key, version };
}

/** One proposal, short enough to read on a phone without scrolling past it. */
export function summarise(p: Proposal): string {
  const posts = p.evidence?.post_ids?.length
    ? `\nBased on posts ${p.evidence.post_ids.join(", ")}.`
    : "";
  const observation = p.evidence?.observation ? `\n${p.evidence.observation}` : "";
  return `${p.section_key.replace(/_/g, " ")}\n\n${p.claim}${observation}${posts}`;
}
