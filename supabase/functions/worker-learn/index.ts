/**
 * 12c — what it does with all of it.
 *
 *   "The system must look across these signals and propose specific changes to the reference
 *    library, each with the evidence behind it. Not 'posts are underperforming', but 'the last six
 *    posts opening with a question underperformed the six that opened with a scene, here they are,
 *    propose changing the hook rule'." (12.9)
 *
 * Two hard boundaries:
 *
 *   12.10 — Josh approves or rejects each proposal. The system NEVER changes the library on its own.
 *           So this writes to `library_proposals` and nothing else. It has no path to
 *           `library_sections`.
 *
 *   Clause 12 callout — the lived-experience test and the no-fabrication rule are not open to
 *           adjustment by the learning loop, whatever the numbers say. Those live in the immutable
 *           `core_rules` section, and a database trigger rejects any proposal against it. The schema
 *           enforces this, not this file's good intentions.
 */

import { callStructured, callText, MODELS } from "../_shared/llm.ts";
import { admin, embedOne, getSetting, logEvent } from "../_shared/db.ts";
import { loadSecrets } from "../_shared/secrets.ts";
import { json } from "../_shared/jobs.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { LEARN_SYSTEM, PROMPT_VERSION, VOICE_GUIDE_SYSTEM } from "../_shared/prompts.ts";
import { ProposalsSchema } from "../_shared/schemas.ts";

Deno.serve(async () => {
  const db = admin();
  await loadSecrets(db);

  // Everything published in the last quarter, with what came back.
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: posts } = await db
    .from("posts")
    .select(
      `id, body, published_at, moment_id,
       moments!inner(ref, pillar, audience, strength, depth_reached, source, killed),
       outcomes(impressions, reach, reactions, comments, edit_ratio, edit_class, verdict,
                conversation, draft_body, published_body)`,
    )
    .eq("status", "published")
    // Fixtures and moments Josh killed do not tune how he is written. See worker-ops.
    .eq("moments.killed", false)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(60);

  const proposedGuide = await proposeVoiceGuide(db);

  if (!posts || posts.length < 6) {
    // 12.3 says the automatic signals must be enough on their own — but "enough" still needs a few
    // posts to compare. Proposing from two data points would be noise dressed as evidence.
    return json({
      ok: true,
      proposals: proposedGuide ? 1 : 0,
      voice_guide_proposed: proposedGuide,
      reason: "not enough published posts to draw from yet",
    });
  }

  // Which framework and hook each post came from — 12.13 extends learning past voice.
  const { data: drafts } = await db
    .from("drafts")
    .select("moment_id, framework, hook, library_version, gate_passed")
    .eq("gate_passed", true)
    .limit(200);
  const byMoment = new Map<
    number,
    { framework: string; hook: string | null; libraryVersion: number | null }
  >();
  for (const d of drafts ?? []) {
    if (!byMoment.has(d.moment_id)) {
      byMoment.set(d.moment_id, {
        framework: d.framework,
        hook: d.hook,
        // 8.4 / 12.12 — which library wrote this post. It was being SELECTED and then discarded,
        // so nothing anywhere could tell whether a run of weak posts started at a particular
        // change. "Josh can see which change" needs this visible somewhere.
        libraryVersion: d.library_version ?? null,
      });
    }
  }

  // 12.10 / 12.12 — what Josh has already decided.
  //
  // This was never sent. So a rejected "change the hook rule" could arrive again the following
  // Monday with the same evidence, and he would reject it again — the nagging 12.8 rules out
  // everywhere else, aimed at the one message in the system that is meant to be worth reading.
  const halfYear = new Date(Date.now() - 182 * 86_400_000).toISOString();
  const { data: decided } = await db
    .from("library_proposals")
    .select("section_key, claim, status, decided_reason, decided_at")
    .neq("status", "open")
    .gte("created_at", halfYear)
    .order("decided_at", { ascending: false })
    .limit(30);

  // Which gate checks actually fire — 9.9 says the library should be tuned against real failures.
  const { data: gateFailures } = await db
    .from("gate_runs")
    .select("check_key, reason")
    .eq("passed", false)
    .gte("created_at", since)
    .limit(200);
  const failureCounts = new Map<string, number>();
  for (const g of gateFailures ?? []) {
    failureCounts.set(g.check_key, (failureCounts.get(g.check_key) ?? 0) + 1);
  }

  const dossier = posts.map((p) => {
    // deno-lint-ignore no-explicit-any
    const o = embedOne<Record<string, number | string | null>>((p as any).outcomes) ?? {};
    // deno-lint-ignore no-explicit-any
    const m = embedOne<{
      ref: string;
      pillar: string | null;
      audience: string | null;
      strength: number | null;
      depth_reached: string | null;
      source: string | null;
    }>(
      // deno-lint-ignore no-explicit-any
      (p as any).moments,
    ) ?? { ref: "", pillar: null, audience: null, strength: null, depth_reached: null, source: null };

    // 12.13's last item — "which moments were worth writing at all" — needs what the moment WAS,
    // not only what the post did with it. Without strength, depth and source, the loop can tell you
    // which hook landed and never that the interview reached a scene, or that the moments worth
    // writing all arrived as voice notes rather than from a call transcript. That is the one signal
    // here that improves the INTERVIEW rather than the drafts.
    const published = new Date(p.published_at as string);
    // Keyed off posts.moment_id, not the embedded row: the moments select does not include `id`,
    // so reading it from there silently produced "unknown" for every framework.
    const meta = byMoment.get(p.moment_id) ??
      { framework: "unknown", hook: null, libraryVersion: null };
    return {
      post_id: p.id,
      ref: m.ref,
      pillar: m.pillar,
      audience: m.audience,
      framework: meta.framework,
      hook: meta.hook ?? p.body.split("\n")[0],
      library_version: meta.libraryVersion,
      published_at: p.published_at,
      // Raw timestamps make a model do date arithmetic before it can see a pattern. 12.13 asks
      // what times work, so the answer is handed over already in the shape of the question.
      day_of_week: published.toLocaleDateString("en-GB", { weekday: "long" }),
      hour: published.getUTCHours(),
      strength: m.strength,
      depth_reached: m.depth_reached,
      source: m.source,
      impressions: o.impressions ?? null,
      reactions: o.reactions ?? null,
      comments: o.comments ?? null,
      // The strongest signal available, and it needs nothing from Josh (12.2).
      edit_class: o.edit_class ?? null,
      edit_ratio: o.edit_ratio ?? null,
      josh_verdict: o.verdict ?? null,
      started_a_conversation: o.conversation ?? null,
    };
  });

  const result = await callStructured(ProposalsSchema, {
    model: MODELS.OPUS,
    system: LEARN_SYSTEM,
    messages: [{
      role: "user",
      content: `POSTS AND WHAT CAME BACK:\n${JSON.stringify(dossier, null, 2)}\n\n` +
        `GATE REJECTIONS BY CHECK (last 90 days):\n${
          JSON.stringify(Object.fromEntries(failureCounts), null, 2)
        }\n\n` +
        `WHAT JOSH HAS ALREADY DECIDED — do not raise a settled question again:\n${
          decided && decided.length > 0 ? JSON.stringify(decided, null, 2) : "(nothing decided yet)"
        }\n\n` +
        `A status of "reverted" means he approved that change, the posts then got worse, ` +
        `and he rolled it back. Treat it as a STRONGER rejection than "rejected".\n\n` +
        `The library_version on each post is the version of the library that wrote it. If ` +
        `the posts that stopped working all sit on one side of a version boundary, say so ` +
        `and name the version — that is what 12.12 means by "which change".\n\n` +
        `Weigh edit_class and josh_verdict above engagement numbers. A post Josh published almost ` +
        `untouched worked, whatever its impressions did. A post he rewrote failed, however well it ` +
        `performed.\n\n` +
        `12.13 — look past voice. Which PILLARS land, which FRAMEWORKS land, which HOOKS land, ` +
                `what TIMES work, and which MOMENTS were worth writing at all. That last one is the ` +
                `strength, depth_reached and source fields: if the posts that worked all came from ` +
                `moments where the interview reached a scene, or all arrived by voice note rather than ` +
                `from a call transcript, say so and propose changing the prompt set — that improves ` +
                `what gets CAPTURED, not just how it gets written.

` +
                `Propose only what the evidence supports. Proposing nothing is a valid answer.`,
    }],
    effort: "high",
    maxTokens: 6000,
    purpose: "learn",
    promptVersion: PROMPT_VERSION,
  }, { db });

  let written = 0;
  for (const p of result.proposals ?? []) {
    if (!p.evidence?.post_ids?.length) continue; // 12.9 — no claim without evidence
    const { error } = await db.from("library_proposals").insert({
      section_key: p.section_key,
      claim: p.claim,
      evidence: p.evidence,
      proposed_body: p.proposed_body,
      status: "open",
    });
    // A proposal against core_rules is rejected by trigger. If the model reached for it anyway,
    // that is worth knowing about.
    if (error) {
      await logEvent(db, "proposal_rejected_by_schema", "warn", {
        section_key: p.section_key,
        error: error.message,
      });
      continue;
    }
    written++;
  }

  await logEvent(db, "learning_run", "info", { considered: dossier.length, proposals: written });
  return json({ ok: true, considered: dossier.length, proposals: written });
});

/**
 * 8.1 — propose a voice guide built from the recorded interview.
 *
 * The transcript lands in its own library section and then nothing happens to it. The voice guide —
 * the one input the entire quality argument rests on, sitting on the critical path with no date
 * against it — stays a blank box, and a blank box is a poor thing to ask anyone to fill.
 *
 * So the system does the reading and hands him something to react to. It is a PROPOSAL like any
 * other: 12.10 keeps every library change behind his approval, and 8.2 makes the guide his to
 * supply. Reacting to a draft is a far easier job than writing from nothing, and he can reject it
 * outright with one tap.
 *
 * It proposes ONCE. Raising the same thing every Monday would be the nagging 12.8 rules out
 * elsewhere, and a guide he has already decided about is not an open question.
 */
async function proposeVoiceGuide(db: SupabaseClient): Promise<boolean> {
  const minWords = await getSetting(db, "voice_guide_min_words", 400);

  const { data: sections } = await db
    .from("library_sections")
    .select("key, body")
    .in("key", ["voice_guide", "voice_transcript"]);

  const guide = sections?.find((s) => s.key === "voice_guide")?.body ?? "";
  const transcript = sections?.find((s) => s.key === "voice_transcript")?.body ?? "";

  // Only while the guide is still the placeholder. Once it is real, this is his document.
  if (!guide.includes("DELIBERATELY EMPTY")) return false;

  // Only the recorded parts, never the instructions the section ships with.
  const recorded = String(transcript)
    .split(/\n---\n/)
    .filter((part: string) => /^\s*##\s+(Recorded|Added)\b/m.test(part))
    .join("\n\n")
    .trim();

  const words = recorded.split(/\s+/).filter(Boolean).length;
  if (words < minWords) return false;

  // And only once. An open or already-decided proposal means he has it, or has answered.
  const { count: existing } = await db
    .from("library_proposals")
    .select("*", { count: "exact", head: true })
    .eq("section_key", "voice_guide");
  if ((existing ?? 0) > 0) return false;

  const body = await callText({
    model: MODELS.OPUS,
    system: VOICE_GUIDE_SYSTEM,
    messages: [{ role: "user", content: `TRANSCRIPT OF JOSH TALKING:\n\n${recorded}` }],
    effort: "high",
    maxTokens: 3000,
    purpose: "voice_guide",
    promptVersion: PROMPT_VERSION,
  }, { db });

  if (!body.trim()) return false;

  const { error } = await db.from("library_proposals").insert({
    section_key: "voice_guide",
    claim:
      `You have ${words} words of recorded interview and no voice guide yet. This is a first draft ` +
      `of one, built only from how you actually speak — not from your posts, which 8a says have ` +
      `drifted. Change anything, or reject it and write your own.`,
    evidence: {
      post_ids: [],
      observation: `Built from ${words} words in the voice interview section. No other source was read.`,
    },
    proposed_body: body.trim(),
    status: "open",
  });

  if (error) {
    await logEvent(db, "voice_guide_proposal_failed", "warn", { error: error.message });
    return false;
  }

  await logEvent(db, "voice_guide_proposed", "info", { words });
  return true;
}
