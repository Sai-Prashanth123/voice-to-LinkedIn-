/**
 * What refuses a draft before it is filed, decided in one place.
 *
 * WHY THIS EXISTS
 *
 * On 26 October Josh wrote that he gives the same editorial notes on every post, and that three of
 * them were already filed as rules: "which tells me the first draft isn't applying them. If the
 * drafter got those right first time, I'd stop raising them."
 *
 * The rules were applying. What was missing was anything that acted on them. The nine gate checks
 * caught four of his six notes on the post he was complaining about — and then `one_step` mode,
 * which he asked for on 13 October, pushed the draft to his calendar anyway. He read the body, not
 * the verdicts, and gave the note the gate had already given.
 *
 * So the correction has to happen BEFORE the draft is filed, not after. `create_draft` is the only
 * call the drafter cannot avoid, and it already refuses two classes outright — the claim ledger and
 * the high-confidence AI tells. This module is that refusal set, named, so that:
 *
 *   - `create_draft` throws on `blocking`,
 *   - `measure_draft` and `scrub_draft` report the SAME list as `will_refuse` beforehand.
 *
 * The free look has to predict the refusal exactly. A warning that does not match what happens next
 * is how `scrub_draft` came to be ignored: it flagged "actually" on 14 October and the draft was
 * filed anyway.
 *
 * WHY NOT A NEW TOOL, OR A HOOK
 *
 * A `check_draft` tool cannot be compelled: nothing makes a model call it, and `scrub_draft` and
 * `measure_draft` are already two free looks that get skipped.
 *
 * The hook is not the answer either, and not for the reason first written here. Josh runs a clone of
 * this repo, so `.claude/hooks/writing-order.mjs` DOES run for him. But it enforces the ORDER of the
 * writing steps, not the content of a draft, and it fails open on purpose — CLAUDE.md calls it "a
 * sequence, not a safeguard", and says the rules that must never fail open live in Postgres.
 *
 * So a thrown error on the one call the drafter cannot avoid is the forcing function. It is also the
 * precedent: `create_draft` already refuses the claim ledger and the high-confidence tells this way.
 *
 * THE RULES STAY HIS
 *
 * Every library-derived check below is gated on the live rule still being in the section. Delete the
 * line from `banned_phrases` and the refusal disappears with it, with no deploy and no code change.
 * That is deliberate, and it is the same device as `isSupplied` and `unjudgeableChecks`: this file
 * can only ever be NARROWER than the library, never broader. A refusal that outlived the rule it
 * came from would be the system inventing a standard of its own.
 */

import { HIGH_CONFIDENCE, scan } from "./aitells.mjs";

/**
 * Closing by asking the room for a reaction.
 *
 * NOT `close_shape`, and that matters. `closeShape()` tests for a trailing `?` first, so every one
 * of the three examples Josh's own rule names — "Agree?", "Thoughts?", "What would you add?" —
 * comes back as `question`, and `engagement_ask` only ever fires on the words like, repost, follow
 * or share. The classification was right there and could not see the thing the rule describes.
 *
 * It cannot hang off `question` either: `gate_rules` says a question may close a hook, never start
 * one, and a genuine question is the DEFAULT close in the `closes` section.
 *
 * So: a solicitation on the last non-empty line, and only when that line is a question. Drafts 89
 * and 90 both ended "Which ones have I missed?" — first person, so a pattern keyed on "you" would
 * have missed the live case that prompted all of this.
 */
const ENGAGEMENT_ASK = new RegExp(
  [
    "thoughts",
    "agree|disagree",
    "what (?:do|would) you (?:think|add|say)",
    "what (?:am i|are we) missing",
    "what have i missed",
    "which ones? have i missed",
    "anyone else",
    "your take",
    "let me know",
    "curious (?:what|how|if)",
    "(?:add|share) yours",
  ].join("|"),
  "i",
);

/** The line the reader actually ends on. */
function lastLine(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * The library line each check rests on. A check only applies while its rule is still there.
 *
 * Matched loosely on purpose — Josh edits these sections in his own words, and a refusal that
 * vanished because he reworded a sentence would be worse than one that outlived a deletion.
 */
const RULE_PRESENT = {
  engagement_ask: (sections) =>
    /never end by asking for engagement/i.test(sections?.banned_phrases ?? ""),
};

/**
 * @param body the draft, as it would be filed
 * @param sections the live library, keyed by section — `banned_phrases` is the only one read today.
 *                 Pass nothing and the library-derived checks are skipped rather than guessed at.
 * @returns blocking — refuse and store nothing; advisory — report, file anyway
 */
export function prefileVerdict(body, { sections = null } = {}) {
  const blocking = [];
  const advisory = [];

  /*
   * The AI tells, unchanged. HIGH_CONFIDENCE decides which RULES may refuse; a finding carrying
   * `blocking: false` is a detector saying one of its own arms is weaker than the rest of its rule.
   * See the note in aitells.mjs scan().
   */
  const tells = scan(body);
  for (const f of tells.findings) {
    if (!HIGH_CONFIDENCE.has(f.rule)) continue;
    const entry = {
      source: f.rule,
      name: f.name,
      line: f.line,
      matched: f.matched,
      fix: f.fix,
    };
    (f.blocking === false ? advisory : blocking).push(entry);
  }

  // ── The close ───────────────────────────────────────────────────────────────
  const last = lastLine(body);
  if (/\?\s*$/.test(last) && ENGAGEMENT_ASK.test(last)) {
    const entry = {
      source: "engagement_ask",
      name: "Closes by asking for engagement",
      line: null,
      matched: last,
      fix: "Delete the last line. The close before it is the close, and the post does not need a "
        + "question it does not want the answer to.",
    };
    if (sections && RULE_PRESENT.engagement_ask(sections)) {
      blocking.push(entry);
    } else if (!sections) {
      // No library in hand: report it, never refuse on it. "We could not check" and "this breaks a
      // rule" are different answers and only one of them is true.
      advisory.push({ ...entry, note: "Not checked against the live library on this call." });
    }
    // sections present and the rule gone: Josh removed it. Say nothing.
  }

  return { blocking, advisory };
}

/** What `create_draft` will refuse on, named for a writer looking before they spend a call. */
export function willRefuse(body, opts) {
  return prefileVerdict(body, opts).blocking.map(
    (f) => `${f.source} — "${f.matched}"${f.line ? ` (line ${f.line})` : ""}. ${f.fix}`,
  );
}

/** Every class this module can refuse on, so a clean draft can report that the checks ran. */
export const PREFILE_CHECKS = [
  "repeated bullet scaffolds (four or more sharing an opening word)",
  "the mechanical AI tells the library rules out",
  "closing by asking for engagement",
];
