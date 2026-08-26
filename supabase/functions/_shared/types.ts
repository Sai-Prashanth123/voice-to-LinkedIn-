/** Domain types shared across every worker. Mirrors the schema in supabase/migrations. */

export type MomentSource =
  | "raw_capture"
  | "prompted_session"
  | "call_transcript"
  | "claude_code"
  | "slack";

/** The nine states from clause 6. `parked` is a destination, not a failure bin. */
export type MomentStatus =
  | "captured"
  | "half_mined"
  | "mined"
  | "queued"
  | "drafted"
  | "gated"
  | "scheduled"
  | "published"
  | "parked";

/** The depth ladder from clause 5, worked in order, stopping at the first that produces material. */
export type InterviewDepth = "none" | "scene" | "time_anchored" | "earned_perspective";

export type PostStatus = "draft" | "ready" | "scheduled" | "published" | "failed";

/** The automatic inputs. These produce candidates only — never drafts (4.3.3 / 4.4.4 / 4.5.4). */
export const AUTOMATIC_SOURCES: MomentSource[] = ["call_transcript", "claude_code", "slack"];

export interface Moment {
  id: number;
  ref: string;
  source: MomentSource;
  source_ref: string | null;
  captured_at: string;
  pillar: string | null;
  audience: string | null;
  audience_is_buyer: boolean | null;
  time_sensitive: boolean;
  decays_at: string | null;
  status: MomentStatus;
  depth_reached: InterviewDepth;
  strength: number | null;
  pinned: boolean;
  killed: boolean;
  not_before: string | null;
  parked_reason: string | null;
  notes: string | null;
}

/**
 * The material the interview produced. This — and only this, plus the reference library — is what
 * the drafter is allowed to see (9.1).
 */
export interface Material {
  moment_id: number;
  the_moment: string | null;
  the_detail: string | null;
  the_realisation: string | null;
  the_lesson: string | null;
  what_happened_before: string | null;
  who_was_there: string | null;
  their_actual_words: string | null;
  how_he_felt: string | null;
  what_changed: string | null;
  reader_takeaway: string | null;
}

export interface MomentName {
  id?: number;
  moment_id: number;
  name: string;
  kind: "person" | "company";
  cleared: boolean;
}

export interface InterviewTurn {
  moment_id: number;
  turn_no: number;
  role: "question" | "answer";
  body: string;
  question_key: string | null;
  depth: InterviewDepth | null;
  is_pushback: boolean;
  /* Set by the database. Used to tell this session's turns from an earlier one on a re-opened
     moment (6.4), so the budgets in 5.3 and 5.8 reset rather than arriving already spent. */
  created_at?: string;
}

export interface Draft {
  id: number;
  moment_id: number;
  version: number;
  attempt: number;
  body: string;
  hook: string | null;
  framework: string;
  library_version: number;
  model: string;
  claims: unknown[];
  claims_verified: boolean | null;
  gate_passed: boolean | null;
  gate_reason: string | null;
}

/** The six checks of 9.6, plus two we add. Each runs as its own call. */
export type GateCheckKey =
  | "anyone_else"
  | "claims_trace"
  | "hook_opens_loop"
  | "aimed_at_someone"
  | "voice_guide"
  | "names_cleared"
  | "banned_phrases"
  | "identifiable";

export interface Job {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
}

export type LibrarySectionKey =
  | "core_rules"
  | "pillars"
  | "frameworks"
  | "hooks"
  | "closes"
  | "audience"
  | "voice_guide"
  | "prompt_set"
  | "banned_phrases"
  | "formatting"
  | "gate_rules"
  | "visual_brand"
  /* 8.3 — other writers, for structure only. Drafting view only: a gate that has read another
     writer's posts starts judging against their voice. */
  | "reference_posts"
  /* 8.1 — the recorded interview the voice guide is built from, and the source of truth for it. */
  | "voice_transcript";

export interface Library {
  version: number;
  sections: Record<string, string>;
  /** Rendered once and cached as a prompt prefix, so drafting and gating see identical rules. */
  prompt: string;
}

/**
 * What the bot is waiting on, if anything.
 *
 * MUST match the CHECK constraint on `conversation_state.awaiting`. It lives here rather than
 * inline at the call site because it had already drifted: the webhook's local union was missing
 * `disambiguate` and `seeding` long after both were in the database and in use, so TypeScript was
 * quietly failing to check the one thing it could have checked.
 */
export type Awaiting =
  | "nothing"
  | "answer"              // an answer to an interview question
  | "visual_details"      // 10.2 what he is taking from the image
  | "visual_feedback"     // 10.6 another version, without starting again
  | "name_clearance"      // 9.12 the system must ask before a name is used
  | "candidate_choice"    // 4.3.4 which waiting candidate to dig into
  | "disambiguate"        // answering an old question, or starting something new
  | "seeding"             // clause 6 cold start: one moment straight into the next
  | "voice_guide_capture" // 8.1 the recorded interview, transcribed into the library
  | "draft_verdict";      // 12.4 one line on a draft, or silence. Never blocks anything.
