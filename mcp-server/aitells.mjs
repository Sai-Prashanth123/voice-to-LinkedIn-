/**
 * The AI-trait detection library, as code rather than as a paragraph of advice.
 *
 * WHY THIS EXISTS
 *
 * docs/reference/ai-trait-scrubber.md states the problem better than a comment can: loading rules as context is
 * not enforcement. A model handed a list of banned constructions and asked to check itself will
 * report that it checked itself. It is not lying — it has no mechanism to run thirty-one rules
 * against a hundred lines and count.
 *
 * This file is that mechanism. Every rule here is decided by a regex or by arithmetic, so it
 * returns the same answer every time, costs nothing, and cannot invent a violation that is not
 * there or miss one that is.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Rewrite. The tool that wraps this returns findings to the model that called it, and that model
 * does the rewriting with the voice guide in hand. Two reasons. There is no model behind the MCP
 * server, so a "rewrite" here could only be a find-and-replace, and find-and-replace is how you get
 * the failure the scrubber names in its own anti-patterns: over-sanitized, flat prose with the
 * specifics filed off.
 *
 * And judgement rules — false agency, narrator distance, whether a moment earned its weight — are
 * not attempted at all. They are returned as questions. A regex guessing at whether an abstract
 * noun is performing a human action produces confident nonsense, which is worse than silence
 * because somebody will act on it.
 *
 * WHY IT LIVES HERE AND NOT IN _shared/
 *
 * It needs prose.mjs's sentence splitter. An import-free .ts module in _shared cannot reach into
 * scripts/lib, and writing a second splitter is the bug this build keeps removing — two readers of
 * one thing, drifting apart in silence. The gate does not need these detectors: it judges against
 * the banned_phrases library section, which carries the same rules as prose.
 *
 * RULE IDS MATCH THE SOURCE DOCUMENT
 *
 * A finding cites 2C-2, and 2C-2 is a real heading in docs/reference/ai-trait-scrubber.md. Anyone can go and read
 * why. Paraphrasing the rule into a new numbering would make the document and the code two
 * standards, and then the question "which one is right" has no answer.
 */

import { sentences, tokens, words } from "../scripts/lib/prose.mjs";
// What a bullet is, spelled once. See the note on BULLET_MARKER: this file and shape.ts each had
// their own answer, the two disagreed, and neither could see the marker Josh's drafts use.
import { BULLET_MARKER, PUNCTUATION_DASH } from "../supabase/functions/_shared/shape.ts";

/* ── What the voiceprint proves he actually says ──────────────────────────────────────────────
 *
 * The scrubber's own anti-pattern list warns against flattening a client's signature phrasing in
 * the pursuit of AI removal. That is not a hypothetical here.
 *
 * data/josh/law/voiceprint.json computes signature_terms from six recorded calls — words he uses
 * far more than the seven reference writers do. Two of them are hedges: `potentially` and `might`.
 * Rule 2C-31 strips padding hedges. Applied without this list, the first thing this scanner would
 * do is delete the words that most reliably identify him.
 *
 * Each exemption names its evidence, so a future reader can check whether it is still true rather
 * than trusting that somebody once had a reason.
 */
export const EXEMPTIONS = [
  {
    term: "potentially",
    rule: "2C-31",
    evidence: "voiceprint.contrast.signature_terms — measured across 11,022 words of his speech",
  },
  {
    term: "might",
    rule: "2C-31",
    evidence: "voiceprint.contrast.signature_terms — measured across 11,022 words of his speech",
  },
  {
    term: "guys",
    rule: "2A",
    evidence: "voiceprint.contrast.signature_terms — how he addresses a room, not filler",
  },
  {
    term: "appreciate",
    rule: "2B",
    evidence: "voiceprint.contrast.signature_terms — his word, not corporate warmth",
  },
];

export const EXEMPT = new Set(EXEMPTIONS.map((e) => e.term));

/*
 * WHETHER EACH EXEMPTION ACTUALLY DOES ANYTHING — computed, never asserted.
 *
 * Measured 28 October: not one of `potentially`, `might`, `guys` or `appreciate` appears in any
 * VOCAB list, and 2C-31 — the rule three of them cite — lives in JUDGEMENT and has no detector. So
 * `scan("We might potentially do it guys and I appreciate that.")` returns nothing, and would
 * return nothing with this whole list deleted. The test that guarded it asserted exactly that
 * empty result, so it passed whether the mechanism worked or the terms were never reachable.
 *
 * A safeguard that reads as active and is not is worse than none. The list STAYS — it holds the
 * recorded reasoning, and if a padding-hedge detector is ever written these are the words it must
 * not touch. But each entry now says whether it is load-bearing TODAY, and the answer is computed
 * from the rules as they stand rather than written down, so it cannot go stale on its own:
 *
 *   active   — some executing rule would match this term, and the exemption is what stops it.
 *   reserved — nothing in RULES can match it, so the exemption changes no output at all.
 *
 * Deliberately NOT fixed by inventing a detector for 2C-31. It is a judgement rule on purpose: his
 * guide says he hedges hardest immediately before his most useful sentence, and the instruction is
 * to compress the hedge, never to delete it. A regex that strips hedges would be the exact
 * regression this list was written to prevent.
 */
export function exemptionStanding() {
  const bare = new Set();
  return EXEMPTIONS.map((e) => {
    // The honest probe: run the rules with this term UNPROTECTED and see whether any of them
    // actually reaches for it. Anything else would be a claim about the mechanism rather than a
    // reading of it.
    const probe = `We ${e.term} did it and the number held.`;
    const would = RULES.some((r) =>
      r.detect(probe, { exempt: bare }).some((hit) =>
        String(hit.matched ?? "").toLowerCase().includes(e.term.toLowerCase())
      )
    );
    return {
      ...e,
      status: would ? "active" : "reserved",
      ...(would
        ? {}
        : {
          means: `No rule in this file matches "${e.term}", so this exemption suppresses nothing ` +
            `today. ${e.rule} ` +
            (RULES.some((r) => r.id === e.rule)
              ? "runs, but its word list does not carry the term"
              : "is a judgement rule and has no detector") +
            ". Kept because it records why the word must survive if one is ever written.",
        }),
    };
  });
}

/* ── Vocabulary (scrubber 2A and 2B) ─────────────────────────────────────────────────────────── */

export const VOCAB = {
  /** 2A — remove on sight. Test: delete it; if the meaning is identical it was filler. */
  filler: [
    "actually", "basically", "essentially", "literally", "simply", "really", "truly", "honestly",
    "obviously", "clearly", "certainly", "definitely", "importantly", "interestingly", "ultimately",
    "fundamentally", "incredibly", "absolutely", "indeed", "notably", "furthermore", "moreover",
    "additionally", "consequently",
  ],

  /** 2B verbs — the consultant register. */
  verbs: [
    "leverage", "leveraging", "utilize", "utilise", "delve", "harness", "navigate", "navigating",
    "embrace", "elevate", "unlock", "cultivate", "foster", "streamline", "underscore", "embark",
    "empower", "elucidate", "facilitate", "revolutionize", "reimagine", "supercharge",
  ],

  adjectives: [
    "groundbreaking", "revolutionary", "transformative", "cutting-edge", "robust", "scalable",
    "pivotal", "seamless", "comprehensive", "innovative", "meticulous", "profound", "dynamic",
    "holistic", "next-level", "pioneering", "disruptive", "unprecedented",
  ],

  nouns: [
    "landscape", "realm", "tapestry", "synergy", "testament", "paradigm", "ecosystem", "catalyst",
    "cornerstone",
  ],

  /** Multi-word, so matched as phrases rather than tokens. */
  phrases: [
    "in today's landscape", "in today's fast-paced world", "it's important to note",
    "as we navigate", "the reality is", "here's the thing", "let me be honest", "make no mistake",
    "let that sink in", "read that again", "full stop", "it's worth noting", "in conclusion",
    "i wanted to share", "circle back", "touch base", "move the needle",
    "think outside the box", "the truth is", "something shifted", "everything changed",
    "at its core", "at the end of the day", "when it comes to", "in a world where", "let's dive in",
    "let's explore", "let's unpack", "moving forward", "deep dive", "key takeaways",
    "actionable insights", "best practices", "game-changer", "double down",
  ],

  /** Meta-commentary — the post narrating itself. */
  meta: [
    "hint:", "plot twist:", "spoiler:", "you already know this but", "but that's another post",
    "the rest of this post explains", "let me walk you through", "in this post",
  ],

  /** 2C-30 — no human writes these in a LinkedIn post. */
  cutoff: [
    "as of my last update", "based on available information", "i do not have real-time access",
    "to the best of my knowledge as of",
  ],
};

/* ── Helpers ─────────────────────────────────────────────────────────────────────────────────── */

/** Line number (1-based) for a character offset, so a finding can be pointed at. */
function lineAt(body, index) {
  let line = 1;
  for (let i = 0; i < index && i < body.length; i++) if (body[i] === "\n") line++;
  return line;
}

/** Every match of a global regex, with its line and the text that matched. */
function matches(body, re) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = rx.exec(body)) !== null) {
    out.push({ matched: m[0].trim(), line: lineAt(body, m.index) });
    if (m.index === rx.lastIndex) rx.lastIndex++; // zero-width guard
  }
  return out;
}

/*
 * WHAT SITS INSIDE QUOTATION MARKS — found 28 October, and DOWNGRADED rather than suppressed.
 *
 * A draft that carries a client's own sentence was told "say the plain thing instead" about the
 * client's words. The construction really is there, so suppressing the finding would be a lie; the
 * fix is what is wrong, because the only honest choice about a verbatim quote is whether to carry
 * it at all.
 *
 * Suppression would also open a laundering channel: wrap a generic paragraph in quotes and the
 * scanner goes quiet with nothing reporting that it had. So a quoted finding keeps its rule and its
 * line, and gains `in_quote` plus a fix that names the real decision.
 *
 * THREE RULES, EACH STOPPING A SPECIFIC FAILURE:
 *
 *  - Pairs are matched in DOCUMENT ORDER across the whole body, not per line. Draft 95 quotes a
 *    multi-paragraph email inside one pair of marks, and per-line pairing would see none of it.
 *  - Only when the count of marks is EVEN. One stray `"` must mark nothing rather than silence
 *    every finding after it.
 *  - Capped at 60% of the body, and the cap is reported rather than applied silently. Past that
 *    point the "quote" is the post and there is nothing left to judge.
 *
 * THE CAP NEEDS A POST'S WORTH OF TEXT TO MEAN ANYTHING, the same way the re-voice ratio in
 * scrub_draft needs three lines: `She put it plainly: "It is not the tools, it is the people."` is
 * 65% quoted and perfectly ordinary. A share is a claim about a post, so below three non-blank
 * lines the cap does not apply — otherwise one quoted sentence in a one-line draft would be read
 * as a post made of somebody else's words.
 *
 * `>` is deliberately NOT treated as a block-quote marker: it is in BULLET_MARKER on purpose, and
 * overloading it would break 2C-17 and uses_list.
 */
const QUOTE_MARK = /["“”]/g;
export const QUOTED_SHARE_CAP = 0.6;
const QUOTED_CAP_MIN_LINES = 3;

export function quotedRanges(body) {
  const text = String(body ?? "");
  const marks = [...text.matchAll(QUOTE_MARK)].map((m) => m.index);
  if (marks.length < 2 || marks.length % 2 !== 0) {
    return { ranges: [], share: 0, ...(marks.length % 2 !== 0 && { unpaired: marks.length }) };
  }

  const ranges = [];
  let covered = 0;
  for (let i = 0; i + 1 < marks.length; i += 2) {
    ranges.push([marks[i], marks[i + 1]]);
    covered += marks[i + 1] - marks[i];
  }
  const share = text.length ? +(covered / text.length).toFixed(2) : 0;
  const postLines = text.split(/\n/).filter((l) => l.trim()).length;
  if (share > QUOTED_SHARE_CAP && postLines >= QUOTED_CAP_MIN_LINES) {
    return { ranges: [], share, over_cap: true };
  }
  return { ranges, share };
}

/** Which raw lines (1-based) any quoted run touches. A finding is located by line, not by offset. */
function quotedLines(body, ranges) {
  const out = new Set();
  for (const [from, to] of ranges) {
    for (let line = lineAt(body, from); line <= lineAt(body, to); line++) out.add(line);
  }
  return out;
}

/** Any of a list of literal phrases, whole-word where the phrase is a single word. */
function anyOf(body, list, exempt = EXEMPT) {
  const out = [];
  for (const phrase of list) {
    if (exempt.has(phrase)) continue;
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = /\s/.test(phrase) ? new RegExp(esc, "gi") : new RegExp(`\\b${esc}\\b`, "gi");
    out.push(...matches(body, re));
  }
  return out;
}

const paragraphs = (body) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/*
 * THE LINE BASE, DECLARED ONCE AND NAMED IN THE OUTPUT.
 *
 * `lineAt` counts RAW newlines, blanks included, because that is what a writer sees in an editor
 * and a finding has to be findable. `scrub_draft` built its denominator from the non-blank lines
 * only, so on 28 October it printed "3 of 21 lines carry a finding" and then put findings on line
 * 25 and line 36 — numbers outside their own total.
 *
 * Both numbers are real and neither replaces the other: the raw number locates the line, the
 * non-blank number is the one a share can be computed against. So every finding carries both, each
 * labelled, and `nonBlankIndexes` is the one map between them.
 */
const lines = (body) => body.split(/\n/);

/**
 * For each raw line number (1-based), the non-blank line it counts against.
 *
 * A blank line maps to the NEXT non-blank one rather than to null. Two rules anchor a whole-post
 * finding at `line: 1` — 2C-16 for a wall of text, 2C-18 for an opening question — and on a body
 * that begins with a newline that line is blank. Dropping those from the count would quietly shrink
 * the numerator of the re-voice ratio, which is the kind of correction that looks like a fix.
 */
function nonBlankIndexes(body) {
  const raw = lines(body);
  const map = new Map();
  let n = 0;
  raw.forEach((text, i) => {
    if (text.trim()) map.set(i + 1, ++n);
  });
  // Walk backwards so each blank line inherits the next real line's index.
  let next = null;
  for (let i = raw.length; i >= 1; i--) {
    if (map.has(i)) next = map.get(i);
    else if (next !== null) map.set(i, next);
  }
  return { map, total: n };
}

/*
 * ONE TOKENISER FOR EVERY REPORTED LENGTH — changed 28 October.
 *
 * This was `tokens(s).length`. `tokens` is the LEXICON tokeniser: it requires a leading a-z and at
 * least two characters, so it drops "I", "a" and every number on purpose, because a writer's
 * distinctive vocabulary is not the figures they happen to cite.
 *
 * As a sentence length that is simply wrong, and wrong in two directions at once. measure_draft
 * reported longest 24 on the same body where scrub_draft reported 23, and — the part that matters —
 * every sentinel median in data/josh/sentinels/latest.json was produced by `words()` through
 * `measurePost`, so `rubric()`'s thresholds were comparing a shorter count against a corpus
 * measured with a longer one.
 *
 * `words()`, therefore: the counter the stored medians rest on. It is deliberately ONE-DIRECTIONAL.
 * `tokens` and `words` are both unchanged, because `writerShapeTargets`, `shapeAgainst` and the
 * ninth gate check all rest on `words` already and harmonising the other way would mean
 * re-measuring 1,899 posts for nothing.
 */
const wordCount = (s) => words(s);

/* ── The rules ───────────────────────────────────────────────────────────────────────────────
 *
 * Each is { id, standing, name, why, fix, detect }. `detect` returns [{ matched, line }] and
 * nothing else — no severity, no score. Whether three em dashes matter more than one
 * rule-of-three is a judgement, and this file does not make judgements.
 *
 * WHAT `standing` IS, AND WHY IT WAS ADDED ON 28 OCTOBER
 *
 * `mechanical` — the construction is simply wrong and the fix does not need a reader. An em dash,
 * a hashtag, a semicolon, "let me explain". Every id in HIGH_CONFIDENCE is one of these, and a
 * test asserts that, because a rule that can REFUSE a draft must not rest on a heuristic.
 *
 * `judgement` — the detector is a proxy for something a person decides. Three nouns in a row may
 * be three real things; a narrow sentence spread may be three deliberate short sentences; "say the
 * plain thing instead" is wrong advice about a verbatim quote.
 *
 * It exists because scrub_draft's own rewrite_discipline already says "when a flag is a judgement
 * call, say so and leave it" — and until now no finding carried a field that could say so. The
 * only machine-readable thing on a finding was an imperative `fix` string, so on 28 October a
 * drafter obeyed "Say the plain thing instead" on a line that was a client's own words. A rule's
 * standing is per-RULE; a detector with one weaker arm may lower its own finding to "judgement",
 * the same way it may already lower `blocking` — only ever downwards.
 */

/**
 * 2C-2 — negative parallelism. The headline rule, and the one the user named first.
 *
 * Five families, because the construction survives being disguised. "It's not X, it's Y" is the one
 * everybody knows; "Most people think X…" doing the same work three sentences later is the one that
 * gets through. Each family is its own pattern so a false positive can be narrowed without
 * loosening the rest.
 */
const NEGATIVE_PARALLELISM = [
  // Direct: "It's not X, it's Y." / "This is not X. This is Y."
  /\b(?:it'?s|it is|this is|that'?s|that is|they'?re|they are|we'?re|we are)\s+not\s+(?:just\s+|only\s+|merely\s+)?[^.!?\n]{2,80}[,.;]\s*(?:it'?s|it is|this is|that'?s|that is|they'?re|they are|we'?re|we are)\b/gi,
  // Contracted negation across a full stop: "This isn't X. This is Y."
  /\b(?:this|that|it|they|we|you)\s+(?:isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t)\b[^.!?\n]{0,80}[.!?]\s+(?:this|that|it|they|we|you)\b[^.!?\n]{0,80}\b(?:is|are|was|were|does|do)\b/gi,
  // Noun subject rather than a pronoun: "Positioning is not a tagline. It is a decision..."
  // The pronoun-led pattern above missed this entirely, and acceptance fixture 24 — a deliberately
  // generic post seeded to prove the gate rejects generic posts — is built on it.
  /\b\w[\w'’-]*(?:\s+\w[\w'’-]*){0,3}\s+is\s+not\s+[^.!?\n]{2,60}[.!?]\s+(?:it|this|that|they)\s+(?:is|are)\b/gi,
  // "Not because X, but because Y." Two things the first version got wrong: the halves are usually
  // split by a full stop, which [^.!?] cannot cross, and the "but" is frequently absent —
  // "Not because the content is wrong. Because the problem is rarely skill." (fixture 25).
  /\bnot\s+because\b[^\n]{2,90}?[.!?,]\s*(?:but\s+)?because\b/gi,
  // Cohort reframe: "Most teams do X. The best do Y." / "Nobody is X. Most people are Y."
  /\b(?:most|many|nobody|no one|everyone|the average)\b[^.!?\n]{2,80}[.!?]\s+(?:but\s+)?(?:the\s+(?:best|winners|top|great|smart|good)|the\s+ones\s+who)\b/gi,
  // Imperative: "Forget X. This is Y." / "Stop doing X. Start doing Y."
  /\b(?:forget|stop)\s+[^.!?\n]{2,60}[.!?]\s+(?:this is|start|instead|here)\b/gi,
  // Comparative: "Less X, more Y." / "X is dead. Y is the future."
  /\bless\s+\w+[^.!?\n]{0,30},\s*more\s+\w+/gi,
  /\bis\s+dead\b[^.!?\n]{0,60}\bis\s+the\s+future\b/gi,
  // Question reframe: "Is it X? No. It's Y."
  /\?\s+(?:no|nope|not quite|wrong)\.\s+/gi,
  // Softened — the sneaky ones the doc says to flag too.
  /\b(?:most people think|most founders think|at first glance|conventional wisdom says)\b/gi,
  /\bwhile\s+[^.!?\n]{2,60}\bmight\s+seem\b/gi,
  /\bsure,\s+[^.!?\n]{2,60}\bbut\b/gi,
];

export const RULES = [
  {
    id: "2C-2",
    standing: "mechanical",
    name: "Negative parallelism (Not X but Y)",
    why: "AI's most recognisable structural tell. It announces a reframe instead of stating the "
      + "point. Real writers state Y; AI stages the reveal.",
    fix: "Delete the rejected frame entirely. State Y as a direct observation with a specific detail.",
    detect: (body) => NEGATIVE_PARALLELISM.flatMap((re) => matches(body, re)),
  },

  {
    id: "2C-17",
    standing: "mechanical",
    name: "Repeated bullet sentences",
    why: "Three bullets that open with the same word, run to the same length, or land on the same "
      + "grammatical shape read as generated. Real lists are uneven because real items are.",
    fix: "Break the pattern. Vary the opening, the length, or cut the weakest bullet entirely.",
    detect: (body) => {
      const bullets = lines(body)
        .map((text, i) => ({ text: text.trim(), line: i + 1 }))
        .filter((l) => BULLET_MARKER.test(l.text))
        .map((l) => ({ ...l, content: l.text.replace(BULLET_MARKER, "") }));

      if (bullets.length < 3) return [];
      const out = [];

      // Same opening word across three or more.
      const byFirst = new Map();
      for (const b of bullets) {
        const first = (tokens(b.content)[0] ?? "").toLowerCase();
        if (!first) continue;
        if (!byFirst.has(first)) byFirst.set(first, []);
        byFirst.get(first).push(b);
      }
      /*
       * THREE REPORTS, FOUR REFUSES — and this is a deliberate loosening of the rule as written.
       *
       * The rule above says three. It is kept at three for reporting, because three identical
       * openings is the pattern and the rule is right about that. But this rule is in
       * HIGH_CONFIDENCE, so from 26 October it can actually refuse a draft before filing (the
       * marker fix in shape.ts is what unblocked it), and Josh's own formatting section asks for
       * the shape it would now refuse: "System and how-to posts: sub-headers with bullets under
       * each", added by him on 21 October. A pros-and-cons list is parallel because the thing being
       * compared is parallel.
       *
       * So three is reported and four refuses. Draft 90 had eight bullets opening on "Pro", which
       * is not a three-item list being unlucky. If he wants the line drawn elsewhere it moves
       * through propose_library_change on banned_phrases, never a code edit (12.10).
       */
      for (const [first, group] of byFirst) {
        if (group.length >= 3) {
          out.push({
            matched: `${group.length} bullets all open with "${first}"`,
            line: group[0].line,
            ...(group.length < 4 && { blocking: false }),
          });
        }
      }

      // Uniform length: three or more within two words of each other.
      const lengths = bullets.map((b) => wordCount(b.content));
      let run = 1;
      for (let i = 1; i < lengths.length; i++) {
        if (Math.abs(lengths[i] - lengths[i - 1]) <= 2) {
          run++;
          if (run === 3) {
            out.push({
              matched: `${run} consecutive bullets of near-identical length (${lengths.slice(i - 2, i + 1).join(", ")} words)`,
              line: bullets[i - 2].line,
              // Reported, never refused. Three short items of similar length is what a real short
              // list looks like; "vary the length" is advice, not a wrong construction.
              blocking: false,
            });
          }
        } else {
          run = 1;
        }
      }

      return out;
    },
  },

  {
    id: "2C-22",
    standing: "mechanical",
    name: "Throat-clearing opener",
    why: "Announcing that something is about to be said, instead of saying it. `here's` is also on "
      + "the list of words the reference writers use far more than Josh does.",
    fix: "Delete the opener. The sentence after it is the sentence.",
    detect: (body) => matches(
      body,
      /\b(?:here'?s (?:the thing|what|why|how|something)|the truth is|let me be clear|i'?ll say it again|can we talk about|it turns out|the reality is)\b/gi,
    ),
  },

  {
    id: "2C-8",
    standing: "mechanical",
    name: "Formulaic reveal",
    why: "\"Let me explain\" is a sentence that explains nothing. Just explain.",
    fix: "Cut the line. Keep what follows it.",
    detect: (body) => matches(
      body,
      /\b(?:let me explain|here'?s why|here'?s what happened|let me tell you|so what happened)\b/gi,
    ),
  },

  {
    id: "2C-7",
    standing: "mechanical",
    name: "Unearned profundity",
    why: "Weight applied to a moment that has not earned it. If the previous line carried a specific "
      + "detail, the reader already feels the weight and does not need to be told.",
    fix: "Delete it, or replace it with the specific thing that changed.",
    detect: (body) => matches(
      body,
      /\b(?:something shifted|everything changed|that was the moment|and that changed everything|let that sink in|read that again)\b/gi,
    ),
  },

  {
    id: "2C-10",
    standing: "mechanical",
    name: "Vague attribution",
    why: "An unnamed authority is not evidence. It is the shape of evidence.",
    fix: "Name the source, or cut the claim.",
    detect: (body) => matches(
      body,
      /\b(?:experts?\s+(?:say|argue|agree|suggest)|studies\s+show|research\s+shows|industry\s+reports?\s+(?:say|suggest)|data\s+(?:shows|suggests)|it'?s\s+well\s+known)\b/gi,
    ),
  },

  {
    id: "2C-24",
    standing: "mechanical",
    name: "Copulative avoidance",
    why: "AI dodges \"is\" and \"has\" with inflated linking verbs, because editors flag repetition. "
      + "The cure is worse than the disease — real writing uses \"is\" freely.",
    fix: "Replace with \"is\", \"has\", or a direct verb naming who did it.",
    detect: (body) => matches(
      body,
      /\b(?:serves as|stands as|marks a|represents a|boasts a|features a|offers a|plays a (?:key |crucial |vital )?role in|helps to|aims to|seeks to)\b/gi,
    ),
  },

  {
    id: "2C-25",
    standing: "mechanical",
    name: "Participle trap",
    why: "A vague \"-ing\" clause gives the reader the rhythm of insight without committing to a "
      + "claim. It sounds conclusive and says nothing.",
    fix: "Name the actual consequence, with a number if there is one.",
    detect: (body) => matches(
      body,
      /\b(?:highlighting (?:its|the) (?:importance|significance|need)|underscoring (?:its|the)|paving the way for|reflecting the broader|marking a new era|signal(?:l)?ing a shift)\b/gi,
    ),
  },

  {
    id: "2C-26",
    standing: "mechanical",
    name: "Puffery",
    why: "When every fact is pivotal and every change is major, none of it lands.",
    fix: "State what happened with a number or a detail. If you cannot, it was not pivotal.",
    detect: (body) => matches(
      body,
      /\b(?:a pivotal moment|a major shift|broader implications|a defining (?:era|moment)|a watershed moment|a turning point|a game[- ]changer)\b/gi,
    ),
  },

  {
    id: "2C-27",
    standing: "mechanical",
    name: "False range",
    why: "A real range narrows the claim. An AI range spans everything, which says nothing.",
    fix: "Name the specific cohort the claim actually applies to.",
    detect: (body) => matches(
      body,
      /\bfrom\s+(?:startups?|ancient|boardrooms?|coast|small(?:est)?|junior|interns?)\b[^.!?\n]{0,40}\bto\s+(?:enterprises?|modern|break rooms?|coast|large(?:st)?|senior|ceos?)\b/gi,
    ),
  },

  {
    id: "2C-14",
    standing: "mechanical",
    name: "Correlative crutch",
    why: "A two-part scaffold holding up a one-part idea.",
    fix: "Rewrite as a direct statement.",
    detect: (body) => matches(
      body,
      /\b(?:not only\b[^.!?\n]{0,60}\bbut also|on (?:the )?one hand\b[^.!?\n]{0,80}\bon the other|whether\b[^.!?\n]{0,40}\bor not)\b/gi,
    ),
  },

  {
    id: "2C-6",
    standing: "mechanical",
    name: "Semicolon as connector",
    why: "Almost nobody uses semicolons in a LinkedIn post. They read as edited prose, not speech.",
    fix: "Replace with a full stop and a new sentence.",
    detect: (body) => matches(body, /;/g),
  },

  {
    /*
     * "No hashtags" has been in the banned-phrases section since it was written, and until
     * 26 October nothing in this repository looked for a `#`. It was the most trivially mechanical
     * rule in the whole library and the one with no detector at all — which is the clearest single
     * example of a rule being filed, reported as done, and enforced by nobody.
     *
     * A hash only counts as a hashtag at the start of a word: "#1 priority", "issue #42" and a
     * channel name mid-sentence are not hashtags, and flagging them would be the kind of false
     * positive that gets a check switched off.
     */
    id: "2C-32",
    standing: "mechanical",
    name: "Hashtag",
    why: "His banned-phrases section says no hashtags. They mark a post as written for an "
      + "algorithm rather than for the person reading it.",
    fix: "Delete it. If the word matters, put it in a sentence.",
    detect: (body) => matches(body, /(?:^|\s)#[A-Za-z][\w-]{1,}/g),
  },

  {
    id: "2C-1",
    standing: "mechanical",
    name: "Em dash",
    why: "The single most recognisable AI punctuation tell. Josh's count across 11,022 words of "
      + "recorded speech is zero.",
    fix: "Replace with a full stop or a new line.",
    // PUNCTUATION_DASH, not a local class. This tested em and en only while two other places in
    // the repo treated four more characters as dashes — see the note on it in shape.ts.
    detect: (body) => matches(body, new RegExp(PUNCTUATION_DASH.source, "g")),
  },

  {
    id: "2C-29",
    standing: "judgement",
    name: "Title case header",
    why: "Title case is corporate-deck formatting. Sentence case reads human.",
    fix: "Lower-case everything after the first word.",
    detect: (body) => lines(body)
      .map((text, i) => ({ text: text.trim(), line: i + 1 }))
      .filter(({ text }) => {
        if (!text || /[.!?,:;]$/.test(text)) return false;
        const w = text.replace(/^[#*\s-]+/, "").split(/\s+/);
        if (w.length < 3 || w.length > 8) return false;
        const capped = w.filter((x) => /^[A-Z][a-z]/.test(x)).length;
        return capped >= 3 && capped / w.length > 0.7;
      })
      .map(({ text, line }) => ({ matched: text, line })),
  },

  {
    id: "2C-30",
    standing: "mechanical",
    name: "Knowledge-cutoff disclaimer",
    why: "A pure model artefact. No human writes this in a post.",
    fix: "Cut on sight.",
    detect: (body, { exempt } = {}) => anyOf(body, VOCAB.cutoff, exempt),
  },

  {
    id: "2C-18",
    standing: "mechanical",
    name: "Question as opening hook",
    why: "17% of AI posts open with a question, and the hook rules forbid it outright.",
    fix: "Open with a specific claim or a scene.",
    detect: (body) => {
      const first = lines(body).map((l) => l.trim()).find(Boolean) ?? "";
      return first.endsWith("?") ? [{ matched: first, line: 1 }] : [];
    },
  },

  {
    id: "2C-19",
    standing: "judgement",
    name: "Opens with \"I\"",
    why: "Signals self-focus before the reader has a reason to care.",
    fix: "Start with the scene, the other person, or the thing that happened.",
    detect: (body) => {
      const first = lines(body).map((l) => l.trim()).find(Boolean) ?? "";
      return /^I\b/.test(first) ? [{ matched: first.slice(0, 60), line: 1 }] : [];
    },
  },

  {
    id: "2C-5",
    standing: "judgement",
    name: "Uniform sentence length",
    why: "Uniform 15–25 word sentences is the strongest statistical signal of generated text.",
    fix: "Break one in half. Let another run long. The variance is the point.",
    detect: (body) => {
      const s = sentences(body);
      if (s.length < 3) return [];
      const len = s.map(wordCount);
      const out = [];

      /*
       * TWO CORRECTIONS, BOTH FOUND BY RUNNING THIS AGAINST THE REAL CORPUS.
       *
       * The rule names its target precisely: "uniform 15-25 word sentences is AI's #1 statistical
       * detection signal". Two sloppy readings of it produced false positives on good writing.
       *
       * Comparing CONSECUTIVE PAIRS rather than the whole window: 8, 12, 8 passes a pairwise test
       * (each step is 4) while being obvious variance. That is draft 53 — the hand-checked good
       * post — and it was the scanner's only complaint about it.
       *
       * Applying it at EVERY LENGTH: "Teams struggle. Tools are fine. People are not." is three
       * short sentences in a row, and it is the source document's own example of a GOOD rewrite.
       * Staccato is a device. The tell is a flat block of mid-length sentences, so the floor is
       * set below the named band rather than at zero.
       */
      const FLOOR = 12;   // below the 15-25 band, so the rule is not narrower than it claims
      const SPREAD = 5;   // "within 5 words of each other", read across the window

      for (let i = 0; i + 2 < len.length; i++) {
        const win = len.slice(i, i + 3);
        if (win.some((n) => n < FLOOR)) continue;
        if (Math.max(...win) - Math.min(...win) > SPREAD) continue;
        out.push({
          matched: `3 consecutive sentences of ${win.join(", ")} words`,
          line: lineAt(body, body.indexOf(s[i])),
        });
        i += 2; // report a flat block once, not once per sliding position
      }
      return out;
    },
  },

  {
    id: "2C-16",
    standing: "judgement",
    name: "Uniform paragraph length",
    why: "Every paragraph the same size is a layout, not a piece of writing.",
    fix: "Vary them. A one-line paragraph next to a six-line one is what real writing looks like.",
    detect: (body) => {
      const paras = paragraphs(body);

      /*
       * A WALL OF TEXT WAS STRUCTURALLY EXEMPT FROM THE ONE RULE ABOUT PARAGRAPHS.
       *
       * `if (paras.length < 3) return []` meant a post written as a single block could not trip
       * this, ever. The rule was built to catch three or more paragraphs cut to the same size — a
       * layout rather than writing — and the worse case sailed under it: a post that was never
       * broken at all is not uniform, it is unbroken.
       *
       * Josh described exactly that on 14 October and the system had nothing to say about it.
       * Caught here now, before the gate run, and the ninth check judges it afterwards.
       *
       * 60 words, because two or three sentences as one block is a deliberate short post and this
       * rule has no business having an opinion about it.
       */
      if (paras.length === 1 && wordCount(body) >= 60) {
        return [{
          matched: `one paragraph, ${wordCount(body)} words, nothing broken out`,
          line: 1,
        }];
      }

      if (paras.length < 3) return [];
      const len = paras.map(wordCount);
      const avg = len.reduce((a, b) => a + b, 0) / len.length;
      const spread = Math.max(...len) - Math.min(...len);
      return spread <= Math.max(4, avg * 0.25)
        ? [{ matched: `${paras.length} paragraphs, all ${Math.min(...len)}–${Math.max(...len)} words`, line: 1 }]
        : [];
    },
  },

  {
    id: "2C-3",
    standing: "judgement",
    name: "Rule of three",
    why: "AI defaults to triplets. \"Simple, practical, and powerful\" is a rhythm, not three ideas.",
    fix: "Pick one. Two if both earn it.",
    /*
     * THE CAPTURE WIDENED, THE FILTER DROPPED — 28 October.
     *
     * It matched one bare word per item and then threw away anything longer than four tokens, so
     * "counties, cities and public hospitals" was reported as "cities and public" — a truncated
     * fragment that is not the triplet, and which teaches a drafter to reorder the list until the
     * regex loses it. That is a false fix: the construction is unchanged.
     *
     * So each item may now run to two words, with the cap in the pattern rather than in a filter
     * on the matched text. A leading conjunction is excluded, because "Frustrated, and hangry, and
     * wanting to fight about it" (draft 53, the hand-checked good one) is a list of two joined by
     * repetition rather than a triplet, and the old filter happened to miss it for the wrong
     * reason.
     *
     * No attempt is made to tell a triplet from an enumeration. That needs to know what the words
     * are, and this file's header is right that a regex guessing at it produces confident
     * nonsense. Hence standing: judgement — three real things in a row is a real sentence.
     *
     * WHAT THE SPAN IS AND IS NOT. Where the item boundaries are genuinely ambiguous mid-sentence
     * the two-word window can take a word either side — "It covers counties, cities and public
     * hospitals in three states" reports as "covers counties, cities and public". All three heads
     * are in it, which is what a reader needs to find the line; the span is a locator, not a
     * quotation of the construction, and it is never short of an item the way the old filter was.
     */
    detect: (body) =>
      matches(
        body,
        // The final item takes a second word only where the clause ends after it, so
        // "counties, cities and public hospitals" is reported whole while
        // "Tools, process and people all broke at once" does not swallow the verb.
        /\b(?!and\b|or\b|but\b)[\w'’-]+(?:\s+(?!and\b|or\b)[\w'’-]+)?,\s+(?!and\b|or\b)[\w'’-]+(?:\s+(?!and\b|or\b)[\w'’-]+)?,?\s+and\s+(?!and\b|or\b)[\w'’-]+(?:\s+[\w'’-]+(?=\s*(?:[.,!?;:)\n]|$)))?\b/gi,
      ),
  },

  {
    id: "2A",
    standing: "judgement",
    name: "Filler word",
    why: "Delete it and the meaning is identical. That is the whole test.",
    fix: "Delete the word and read the sentence again. If it means the same thing, leave it deleted.",
    detect: (body, { exempt } = {}) => anyOf(body, VOCAB.filler, exempt),
  },

  {
    id: "2B",
    standing: "judgement",
    name: "Banned vocabulary",
    why: "The consultant register. These words are the ones a reader has seen in a thousand posts.",
    fix: "Say the plain thing instead.",
    detect: (body, { exempt } = {}) => anyOf(body, [
      ...VOCAB.verbs, ...VOCAB.adjectives, ...VOCAB.nouns, ...VOCAB.phrases, ...VOCAB.meta,
    ], exempt),
  },
];

/* ── Judgement, not detection ────────────────────────────────────────────────────────────────
 *
 * These are in the source document and are NOT implemented, on purpose. Returned as questions so
 * they are asked rather than quietly dropped — a rule that is neither enforced nor mentioned is a
 * rule that has been deleted without anyone deciding to delete it.
 */
export const JUDGEMENT = [
  {
    id: "2C-20",
    name: "False agency",
    ask: "Does any inanimate subject perform a human action — \"complaints become fixes\", \"the "
      + "data tells us\", \"the strategy evolved\"? Name the human who did it.",
  },
  {
    id: "2C-21",
    name: "Narrator distance",
    ask: "Does any sentence describe a group the writer is not in — \"teams across the industry "
      + "are realising\"? Replace it with what he personally watched happen.",
  },
  {
    id: "2C-23",
    name: "Passive voice with a known actor",
    ask: "Is anything written passively where the actor is known — \"revenue was increased\"? "
      + "Name who did it.",
  },
  {
    id: "2C-28",
    name: "Elegant variation",
    ask: "Is one company or person renamed across the post — \"the agency\", \"the team\", \"the "
      + "company\" for the same thing? Pick one name and repeat it.",
  },
  {
    id: "2C-12",
    name: "All-positive tone",
    ask: "Does the post admit a limit, a tradeoff, or a place he was wrong? Unbroken confidence "
      + "reads as generated. Note this is a READING, not a word search — draft 53 carries its edge "
      + "in \"I was angry\" and \"I have done nothing about it since\" and contains no \"but\" "
      + "anywhere, so the keyword proxy flagged the best post in the corpus.",
  },
  {
    id: "2C-31",
    name: "Padding hedges",
    ask: "Remove each hedge. If the meaning is identical, it was padding — cut it. If removing it "
      + "overstates the claim, it earned its place. His own hedges (potentially, might) are "
      + "signature terms, not filler.",
  },
];

/* ── The scan ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Run every rule. Returns findings in document order so a reader works top to bottom rather than
 * jumping around a post fixing rule 24 before rule 2.
 */
/*
 * TYPOGRAPHIC APOSTROPHES AND QUOTES, NORMALISED BEFORE ANY RULE RUNS.
 *
 * Measured 28 October 2026, and it is the worst thing found in a day of looking:
 *
 *     "It's not about the tools. It's about the people."   -> 2C-2 fires, and 2C-2 BLOCKS a draft
 *     "It’s not about the tools. It’s about the people."   -> ZERO FINDINGS
 *
 * Seven rules embed a straight `'` in their pattern and SIX of them had no curly alternative —
 * `2C-2`, `2C-17`, `2C-22`, `2C-8`, `2C-10`, `2C-1`, `2C-5`. Four of those are in
 * HIGH_CONFIDENCE, which means they can refuse a draft outright. So the single most recognisable
 * AI cadence on LinkedIn — the one the library gives its own heading — walked past the refusal
 * whenever the text carried a smart apostrophe.
 *
 * And a smart apostrophe is the DEFAULT. Word, Google Docs, macOS and LinkedIn's own composer all
 * produce U+2019. A draft pasted from any of them lost four blocking rules, silently, with nothing
 * in the payload hinting a rule had been skipped. It is the defect class in its purest form: a
 * check with nothing to check, reporting success.
 *
 * Normalising here rather than widening seven patterns, for two reasons. It fixes every rule at
 * once, including any rule written later by somebody who does not know about this. And the mapping
 * is strictly one character to one character, so EVERY OFFSET IS PRESERVED — line numbers and match
 * positions still point at the right place in the author's text.
 *
 * The one visible consequence: a `matched` string reports the straight form of what the author
 * typed curly. That is a cosmetic difference in a field used to locate the problem, and it is worth
 * it to stop a blocking rule going quiet.
 *
 * Quote marks are folded for the same reason — `quotedRanges` already pools both forms, and folding
 * keeps it that way if either side is ever rewritten.
 */
const TYPOGRAPHIC = /[‘’‛]/g;
const TYPOGRAPHIC_DOUBLE = /[“”‟]/g;

export function normaliseMarks(s) {
  return String(s ?? "").replace(TYPOGRAPHIC, "'").replace(TYPOGRAPHIC_DOUBLE, '"');
}

export function scan(body, { exempt = EXEMPT } = {}) {
  const text = normaliseMarks(body);
  const findings = [];

  // Both line bases, computed once. See the note on nonBlankIndexes: the raw number locates the
  // line and the non-blank number is the only one a share may be divided by.
  const { map: nonBlank, total: nonBlankTotal } = nonBlankIndexes(text);
  const quoted = quotedRanges(text);
  const inQuote = quotedLines(text, quoted.ranges);

  for (const rule of RULES) {
    // `exempt` is passed rather than read from module scope so a test can run the rules with the
    // voice exemptions removed and prove the mechanism does something. It was inert for weeks and
    // the test that guarded it could not have told.
    for (const hit of rule.detect(text, { exempt })) {
      const quotedHit = inQuote.has(hit.line);
      findings.push({
        rule: rule.id,
        name: rule.name,
        line: hit.line,
        line_of: "raw lines, blank lines included — the number an editor shows",
        // The line this finding counts against in scrub_draft's share. A whole-post finding
        // anchored on a blank line counts against the next real line rather than against nothing.
        non_blank_line: nonBlank.get(hit.line) ?? null,
        matched: hit.matched,
        why: rule.why,
        // `standing` is per RULE and may only be lowered by a finding, never raised. A mechanical
        // rule with one weak arm says so on the arm.
        standing: hit.standing === "judgement" ? "judgement" : rule.standing,
        fix: quotedHit
          ? "This sits inside quoted text. If the quote is verbatim, leave the words alone — the " +
            "choice is whether to carry the quote at all, not how to word it."
          : rule.fix,
        ...(quotedHit && { in_quote: true, rule_fix_if_not_quoted: rule.fix }),
        // Severity is per FINDING, not per rule, and only ever downwards. HIGH_CONFIDENCE decides
        // which rules may refuse a draft; a detector that knows one of its own arms is weaker than
        // the others says so here. Absent means "whatever the rule says", so every existing rule
        // behaves exactly as it did. A quoted hit is one of those cases: the construction is
        // really there, so it is reported, but it cannot refuse a draft over somebody's own words.
        ...((hit.blocking === false || quotedHit) && { blocking: false }),
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));

  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;

  const s = sentences(text);
  const lens = s.map(wordCount);
  const paras = paragraphs(text);

  return {
    findings,
    counts: {
      total: findings.length,
      by_rule: byRule,
      // Counted so a caller can report "4 findings, 1 of them mechanical" rather than deciding
      // for itself which of the two numbers to print. measure_draft's verdict said "1 thing" over
      // a body with four findings, because it counted only the ones it had promoted.
      mechanical: findings.filter((f) => f.standing === "mechanical").length,
      judgement_calls: findings.filter((f) => f.standing === "judgement").length,
      in_quoted_text: findings.filter((f) => f.in_quote).length,
    },
    measured: {
      sentences: s.length,
      shortest_sentence: lens.length ? Math.min(...lens) : 0,
      longest_sentence: lens.length ? Math.max(...lens) : 0,
      paragraphs: paras.length,
      lines_raw: lines(text).length,
      lines_non_blank: nonBlankTotal,
      counted_with: "words() from scripts/lib/prose.mjs — the same counter the stored sentinel " +
        "medians were produced with, so these are comparable with the corpus",
    },
    quoted_text: {
      share_of_body: quoted.share,
      lines: [...inQuote].sort((a, b) => a - b),
      ...(quoted.over_cap && {
        ignored: `Quotation marks cover ${Math.round(quoted.share * 100)}% of the body, over the ` +
          `${Math.round(QUOTED_SHARE_CAP * 100)}% cap, so nothing was treated as quoted. Past ` +
          "that point the quote is the post.",
      }),
      ...(quoted.unpaired && {
        ignored: `${quoted.unpaired} quotation marks is an odd number, so nothing was treated as ` +
          "quoted. One stray mark must not silence the rest of the post.",
      }),
      /*
       * This said "It is never suppressed: wrapping a paragraph in quotation marks is not a fix."
       * True of the findings list and false of what acts on it: a quoted finding carries
       * `blocking: false`, and `will_refuse` counts only what blocks. So quoting DID remove the
       * refusal, and the sentence announcing otherwise sat in the same payload. Corrected 28
       * October, when a run put four quote characters round one AI-voiced line and took a draft
       * from four refusals to none.
       */
      means: "A finding inside a quote keeps its rule and its line and carries in_quote, so it is " +
        "never hidden from this list. Whether it still REFUSES the draft is a different question: " +
        "quotation marks stop a rule blocking only around text that appears in the moment, and " +
        "create_draft is where that is checked. Quoting something he never said changes nothing.",
    },
    judgement: JUDGEMENT,
    exemptions: exemptionStanding(),
  };
}

/**
 * The subset worth interrupting a writer for.
 *
 * measure_draft already reports numbers a writer reads and moves on from. These are the ones where
 * the construction is simply wrong and the fix is mechanical, so they belong in its `flags` array
 * next to the em dash and the opening question. Everything else stays in scrub_draft, where a
 * writer has asked for the full pass.
 */
export const HIGH_CONFIDENCE = new Set(["2C-2", "2C-17", "2C-22", "2C-8", "2C-7", "2C-30", "2C-24"]);
