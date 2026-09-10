/**
 * The AI-trait detection library, as code rather than as a paragraph of advice.
 *
 * WHY THIS EXISTS
 *
 * ai-trait-scrubber.md states the problem better than a comment can: loading rules as context is
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
 * A finding cites 2C-2, and 2C-2 is a real heading in ai-trait-scrubber.md. Anyone can go and read
 * why. Paraphrasing the rule into a new numbering would make the document and the code two
 * standards, and then the question "which one is right" has no answer.
 */

import { sentences, tokens } from "../scripts/lib/prose.mjs";

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

const EXEMPT = new Set(EXEMPTIONS.map((e) => e.term));

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

/** Any of a list of literal phrases, whole-word where the phrase is a single word. */
function anyOf(body, list) {
  const out = [];
  for (const phrase of list) {
    if (EXEMPT.has(phrase)) continue;
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = /\s/.test(phrase) ? new RegExp(esc, "gi") : new RegExp(`\\b${esc}\\b`, "gi");
    out.push(...matches(body, re));
  }
  return out;
}

const paragraphs = (body) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const lines = (body) => body.split(/\n/);
const wordCount = (s) => tokens(s).length;

/* ── The rules ───────────────────────────────────────────────────────────────────────────────
 *
 * Each is { id, name, why, fix, detect }. `detect` returns [{ matched, line }] and nothing else —
 * no severity, no score. Whether three em dashes matter more than one rule-of-three is a judgement,
 * and this file does not make judgements.
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
    name: "Negative parallelism (Not X but Y)",
    why: "AI's most recognisable structural tell. It announces a reframe instead of stating the "
      + "point. Real writers state Y; AI stages the reveal.",
    fix: "Delete the rejected frame entirely. State Y as a direct observation with a specific detail.",
    detect: (body) => NEGATIVE_PARALLELISM.flatMap((re) => matches(body, re)),
  },

  {
    id: "2C-17",
    name: "Repeated bullet sentences",
    why: "Three bullets that open with the same word, run to the same length, or land on the same "
      + "grammatical shape read as generated. Real lists are uneven because real items are.",
    fix: "Break the pattern. Vary the opening, the length, or cut the weakest bullet entirely.",
    detect: (body) => {
      const bullets = lines(body)
        .map((text, i) => ({ text: text.trim(), line: i + 1 }))
        .filter((l) => /^(?:[-*•‣]|\d+[.)])\s+/.test(l.text))
        .map((l) => ({ ...l, content: l.text.replace(/^(?:[-*•‣]|\d+[.)])\s+/, "") }));

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
      for (const [first, group] of byFirst) {
        if (group.length >= 3) {
          out.push({
            matched: `${group.length} bullets all open with "${first}"`,
            line: group[0].line,
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
    name: "Semicolon as connector",
    why: "Almost nobody uses semicolons in a LinkedIn post. They read as edited prose, not speech.",
    fix: "Replace with a full stop and a new sentence.",
    detect: (body) => matches(body, /;/g),
  },

  {
    id: "2C-1",
    name: "Em dash",
    why: "The single most recognisable AI punctuation tell. Josh's count across 11,022 words of "
      + "recorded speech is zero.",
    fix: "Replace with a full stop or a new line.",
    detect: (body) => matches(body, /[—–]/g),
  },

  {
    id: "2C-29",
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
    name: "Knowledge-cutoff disclaimer",
    why: "A pure model artefact. No human writes this in a post.",
    fix: "Cut on sight.",
    detect: (body) => anyOf(body, VOCAB.cutoff),
  },

  {
    id: "2C-18",
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
    name: "Uniform paragraph length",
    why: "Every paragraph the same size is a layout, not a piece of writing.",
    fix: "Vary them. A one-line paragraph next to a six-line one is what real writing looks like.",
    detect: (body) => {
      const paras = paragraphs(body);
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
    name: "Rule of three",
    why: "AI defaults to triplets. \"Simple, practical, and powerful\" is a rhythm, not three ideas.",
    fix: "Pick one. Two if both earn it.",
    detect: (body) => matches(body, /\b(\w+),\s+(\w+),?\s+and\s+(\w+)\b/gi)
      .filter((f) => f.matched.split(/[\s,]+/).length === 4),
  },

  {
    id: "2A",
    name: "Filler word",
    why: "Delete it and the meaning is identical. That is the whole test.",
    fix: "Delete the word and read the sentence again. If it means the same thing, leave it deleted.",
    detect: (body) => anyOf(body, VOCAB.filler),
  },

  {
    id: "2B",
    name: "Banned vocabulary",
    why: "The consultant register. These words are the ones a reader has seen in a thousand posts.",
    fix: "Say the plain thing instead.",
    detect: (body) => anyOf(body, [
      ...VOCAB.verbs, ...VOCAB.adjectives, ...VOCAB.nouns, ...VOCAB.phrases, ...VOCAB.meta,
    ]),
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
export function scan(body) {
  const text = String(body ?? "");
  const findings = [];

  for (const rule of RULES) {
    for (const hit of rule.detect(text)) {
      findings.push({
        rule: rule.id,
        name: rule.name,
        line: hit.line,
        matched: hit.matched,
        why: rule.why,
        fix: rule.fix,
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
    counts: { total: findings.length, by_rule: byRule },
    measured: {
      sentences: s.length,
      shortest_sentence: lens.length ? Math.min(...lens) : 0,
      longest_sentence: lens.length ? Math.max(...lens) : 0,
      paragraphs: paras.length,
    },
    judgement: JUDGEMENT,
    exemptions: EXEMPTIONS,
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
