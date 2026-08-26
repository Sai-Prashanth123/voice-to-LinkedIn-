/**
 * DRAFT vs APPROVED vs PUBLISHED (12.2), for the web app.
 *
 * A deliberate copy of `supabase/functions/_shared/diff.ts`, which is the source of truth. It cannot
 * be imported: that tree is Deno and sits outside the Next root. Same reasoning as
 * `app/lib/pillars.ts`.
 *
 * UNLIKE that precedent, this copy is not held together by a comment. `diff.test.ts` next to the
 * original runs both implementations over the same fixtures and fails if they disagree, because the
 * thresholds below ARE the 17a acceptance measurement — two surfaces quietly classifying the same
 * edit differently would corrupt the number the whole engagement is judged on.
 */

export interface DiffResult {
  /** 0 = untouched, 1 = nothing survived. */
  editRatio: number;
  /** Similarity of the opening line specifically. A replaced hook is a rewrite by definition. */
  hookSimilarity: number;
  paragraphsBefore: number;
  paragraphsAfter: number;
  editClass: "light" | "rewrite";
  reasons: string[];
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/[^a-z0-9'"%$-]+/)
    .filter((w) => w.length > 0);
}

export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** First non-empty line. On LinkedIn the hook is the opening line, not the opening paragraph. */
export function hookOf(text: string): string {
  return text.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

/** Length of the longest common subsequence of two word arrays. */
function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  // Rolling two-row DP: posts are short, but this keeps memory linear regardless.
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  return (2 * lcsLength(wa, wb)) / (wa.length + wb.length);
}

/** Tuned to 17a's definitions, and revisable once Josh's own verdicts give us ground truth. */
const HOOK_REPLACED_BELOW = 0.5;
const BODY_REWRITTEN_ABOVE = 0.5;
const STRUCTURE_SHIFT_PARAGRAPHS = 2;

export function classifyEdit(draft: string, published: string): DiffResult {
  const editRatio = 1 - similarity(draft, published);
  const hookSimilarity = similarity(hookOf(draft), hookOf(published));
  const pa = paragraphs(draft).length;
  const pb = paragraphs(published).length;

  const reasons: string[] = [];

  if (hookSimilarity < HOOK_REPLACED_BELOW) {
    reasons.push(`hook replaced (opening line ${Math.round(hookSimilarity * 100)}% retained)`);
  }
  if (Math.abs(pa - pb) >= STRUCTURE_SHIFT_PARAGRAPHS) {
    reasons.push(`body restructured (${pa} paragraphs became ${pb})`);
  }
  if (editRatio > BODY_REWRITTEN_ABOVE) {
    reasons.push(`${Math.round(editRatio * 100)}% of the wording changed`);
  }

  return {
    editRatio: Number(editRatio.toFixed(4)),
    hookSimilarity: Number(hookSimilarity.toFixed(4)),
    paragraphsBefore: pa,
    paragraphsAfter: pb,
    editClass: reasons.length > 0 ? "rewrite" : "light",
    reasons,
  };
}

/**
 * The 17a finish line: five of the last six drafts needing only light editing.
 * Ordered newest first.
 */
export function meetsAcceptanceBar(classes: ("light" | "rewrite")[]): {
  passing: boolean;
  light: number;
  of: number;
} {
  const window = classes.slice(0, 6);
  const light = window.filter((c) => c === "light").length;
  return { passing: window.length >= 6 && light >= 5, light, of: window.length };
}
