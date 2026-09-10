---
name: ai-trait-scrubber
description: Mandatory AI-decontamination pass for any LinkedIn draft. Runs between copy-developer and post-grader. Scans every line against a detection library (filler, banned vocabulary, AI structures, false agency, narrator distance), scores the draft on a 5-dimension voice rubric, and rewrites violations inline. Triggers include "scrub this draft", "run ai-trait-scrubber", "de-AI this post", or automatic handoff from copy-developer. Refuses to pass a draft that still contains violations.
---

# AI Trait Scrubber

AI-polished LinkedIn content gets ~5x less engagement than human-sounding content. The rules to prevent this are well-known — em dashes, banned vocabulary, rule of three, throat-clearing openers, false agency. The problem is not the rules. The problem is that copy-developer writes a draft while juggling voice, hook, structure, and CTA simultaneously, so AI traits leak through. A self-attested "Section 4 check passed" is not enforcement.

This skill is the enforcement layer. It runs as a mandatory pass after every draft, scans the text line by line against a detection library, scores the draft on a voice rubric, and rewrites violations before the draft is allowed to reach post-grader. A draft cannot be graded until it has passed this scan.

**Pre-flight:** Run preflight.md when client context is needed for voice overrides. Client: [name provided by user].
**Required:** Draft text. Voice Profile (if available — used to resolve overrides).

---

## Quality Gate

No draft provided → stop. Ask for the text.
Voice Profile unreadable for named client → proceed with universal rules only. Flag the voice-override column as "not checked."

---

## When This Skill Runs

**Primary path (automatic):** copy-developer hands the final draft here before post-grader. Post-grader refuses to score a draft without a scrubber pass certificate.

**Manual path:** User pastes any draft with "scrub this" / "de-AI this" / "run ai-trait-scrubber." Voice Profile loaded if client is named.

**Do not run on:** voice-profile documents, ICP documents, idea briefs, or internal research outputs. This skill is for LinkedIn copy only — other text types have legitimate uses for some flagged constructions.

---

## Inputs

1. **Draft text** — the full post copy from copy-developer or pasted by user.
2. **Voice Profile** (if client is named) — loaded for voice-specific overrides. Some clients may legitimately use constructions that the universal rules flag.
3. **Category** (optional, passed by copy-developer) — Teach / Lead / Prove / Connect / Respond. Connect posts have slightly relaxed rules around narrator distance because they are intentionally first-person reflective.

---

## Phase 1 — Load Voice Overrides

If client is named and Voice Profile is available, scan for explicit rules that override the universal rules below. Examples of legitimate overrides:

- Voice Profile allows one em dash per post for dramatic pause → relax rule 3C-1 to "max 1 em dash, flag if more"
- Voice Profile lists "actually" as an intentional tic → remove from filler list for this client only
- Voice Profile uses questions as hooks as a signature pattern → relax rule 3C-18 but flag the hook for review

If no Voice Profile available or no explicit override found, the universal rules apply as written.

**Output of Phase 1:**
```
VOICE OVERRIDES LOADED: [client name]
Active overrides: [list — or "none"]
```

---

## Phase 2 — Detection Scan

Scan the full draft against the rule library below. Report every violation with line reference and exact matched text. Do not rewrite yet — detect first, rewrite after.

### 2A. Filler — remove on sight

**Filler words (remove unless voice-overridden):**
actually, basically, essentially, literally, simply, just (when not meaning "only"), really, truly, honestly, in fact, of course, obviously, clearly, certainly, definitely, importantly, interestingly, ultimately, fundamentally, incredibly, absolutely, indeed, notably, furthermore, moreover, additionally, consequently, for context

**Filler sentences (remove on sight):**
- Transition sentences announcing what comes next ("Let me explain." / "Here's why this matters.")
- Setup sentences before a CTA that justify the offer
- Redundant sentences restating what the previous line already said
- Sentences describing the post's own structure ("In this post I'll cover...")

**Test:** Remove the word or sentence. If meaning is identical, it was filler.

### 2B. Banned vocabulary — remove every instance

**Verbs:** leverage (as a verb), utilize, delve, harness, navigate, embrace, elevate, unlock, cultivate, foster, streamline, underscore, embark, empower, elucidate, facilitate, revolutionize, reimagine

**Adjectives:** groundbreaking, revolutionary, transformative, cutting-edge, robust, scalable, pivotal, seamless, comprehensive, innovative, meticulous, profound, dynamic, holistic, game-changer, next-level, pioneering, disruptive, unprecedented

**Nouns:** landscape (as metaphor), realm, tapestry, synergy, testament, paradigm, ecosystem, journey (as metaphor), catalyst, cornerstone, deep dive, key takeaways, actionable insights, best practices

**Phrases:** in today's landscape, in today's fast-paced world, it's important to note, as we navigate, the reality is, here's the thing, let me be honest, make no mistake, let that sink in, read that again, full stop, that said, it's worth noting, in conclusion, I wanted to share, I'm excited to announce (unless genuinely excited), circle back, touch base, move the needle, think outside the box, the truth is, and honestly?, something shifted, everything changed, at its core, at the end of the day, when it comes to, in a world where, let's dive in, let's explore, let's unpack, moving forward, what makes this particularly interesting is, as of my last update, based on available information, I do not have real-time access

**Meta-commentary:** Hint:, Plot twist:, Spoiler:, You already know this but, But that's another post, The rest of this post explains, Let me walk you through

### 2C. Banned structures

**1. No em dashes.** Replace with period or new line. Em dashes are the #1 AI punctuation tell. Usage tripled on LinkedIn in one year.

**2. No negative parallelism.** AI's #1 structural tell: rejecting one frame to assert another. Catches every variant — direct, imperative, comparative, question, and "softened" forms. Why: this construction is rhetorically empty — it announces a reframe instead of just stating the point. Real writers state Y. AI stages the reveal.

Direct: "It's not X, it's Y." / "This isn't X. This is Y." / "Most [people] do X. The winners do Y." / "Nobody is X. Most people are Y."
Imperative: "Forget X. This is Y." / "Stop thinking X. Start thinking Y."
Comparative: "Less X, more Y." / "X is dead. Y is the future."
Question reframe: "Is this X? No. It's Y." / "X? No. Y."
Softened (sneakier — flag these too): "While X might seem..." → Y / "Sure, X works. But Y is..." / "At first glance, X..." → contradicting Y / "Most people think X..." → revealing Y

Rewrite: delete the rejected frame entirely and state Y as a direct observation with a specific detail.

**3. No rule of three.** AI defaults to triplets: "simple, practical, and powerful" / "tools, templates, and training." Pick one or two.

**4. No dual adjective pairs.** "Unique and intense" / "highly original and impressive." Pick the stronger one.

**5. Vary sentence length.** Uniform 15-25 word sentences is AI's #1 statistical detection signal. Mix short (5 words) with long (30+). Flag if 3+ consecutive sentences are within 5 words of each other in length.

**6. No semicolons as connectors.** Replace with a period and new sentence.

**7. No unearned profundity.** "Something shifted." / "Everything changed." / "That was the moment." Delete unless the previous line earns the weight with a specific detail.

**8. No formulaic reveal.** "Let me explain." / "Here's why." / "Here's what happened." Just say it.

**9. No humble brag confession.** "I [achievement]. But here's what nobody tells you..." State the insight directly.

**10. No vague attribution.** "Experts argue..." / "Studies show..." / "Industry reports suggest..." Name the source or cut the claim.

**11. Use contractions.** "do not" → "don't." "I am" → "I'm." Too-clean grammar signals AI.

**12. No all-positive tone.** Every post needs an edge, tradeoff, or limit. If there's no "but" or "except" anywhere, flag it.

**13. No excessive bold.** Bold only one thing per section. Flag if more than 2 bolded phrases per paragraph.

**14. No correlative crutches.** "not only...but also" / "whether...or" / "on one hand...on the other." Rewrite as direct statements.

**15. No conclusions that restate the post.** Last lines push forward (CTA, implication, next step). Flag any closing line that summarizes backward.

**16. No uniform paragraph length.** If every paragraph is roughly the same size, vary them. Real writing is uneven.

**17. No overly perfect parallel structure.** Three bullets that begin and end identically with the same rhythm → break the pattern.

**18. No questions as opening hooks.** 17% of AI posts open with a question. Open with a specific claim or scene.

**19. Never open with "I" as the first word.** "I" signals self-focus before the reader has any reason to care.

**20. No false agency.** Inanimate subjects with human verbs — "complaints become fixes," "the decision emerges," "the data tells us," "the strategy evolved." Name the human actor. Why: abstract nouns performing actions is AI's signature way of removing the person from the sentence.

**21. No narrator-from-a-distance voice.** Observing the scene from above instead of being in it. "Teams across the industry are realizing..." vs. "I watched three teams this month make the same mistake." Why: AI defaults to aerial narration because it doesn't have a body in the scene. Flag any sentence describing a group the author isn't physically part of.

**22. No throat-clearing openers.** "Here's the thing:" / "Here's what's interesting:" / "The truth is," / "Let me be clear:" / "I'll say it again:" / "Can we talk about..." / "It turns out..." — any "Here's what/this/that" construction. State the content directly.

**23. No passive voice when the actor exists.** "Revenue was increased" → "We increased revenue." Passive voice hides the actor and weakens the claim. Flag every passive sentence and suggest the active rewrite when the actor is identifiable.

**24. No copulative avoidance.** AI dodges "is" and "has" with inflated linking verbs. Replace with "is" / "has" / direct verb. Why: AI has been trained to vary "is" because human editors flag repetition — but the cure is worse than the disease. Real writing uses "is" freely.

Banned constructions: "serves as," "stands as," "marks a," "represents a," "boasts a," "features a," "offers a," "plays a role in," "helps to," "aims to," "seeks to."
Example: "The framework serves as a foundation for…" → "The framework is the foundation for…" or "We built the framework to…"

**25. No participle trap.** Vague "-ing" phrases that fake depth without naming a consequence. Why: these phrases let AI sound conclusive without committing to a specific claim — the reader gets the rhythm of insight without the substance.

Banned constructions: "highlighting its importance," "underscoring significance," "paving the way for," "reflecting the broader trend," "marking a new era," "signaling a shift."
Rewrite: name the actual consequence. "…highlighting the importance of speed" → "…which is why we cut response time to 4 minutes."

**26. No puffery / significance inflation.** Inflating ordinary facts with weight words. Why: when every fact is "pivotal" and every change is "major," none of it lands. Save the weight for moments that earn it.

Banned constructions: "a pivotal moment," "a major shift," "broader implications," "a defining era," "a watershed moment," "a turning point" (unless backed by a specific before/after).
Rewrite: state what actually happened with a number or detail. If you can't, the moment wasn't pivotal.

**27. No false ranges.** Impressive-sounding spans that mean nothing. Why: real ranges narrow the claim. AI ranges inflate it by spanning everything. If the range covers "all of it," it's saying nothing.

Banned constructions: "from ancient traditions to modern innovation," "from startups to enterprises," "from coast to coast," "from boardrooms to break rooms."
Rewrite: pick the specific cohort the claim actually applies to.

**28. No elegant variation.** Renaming the same entity across a post to avoid repetition — "ColdIQ" → "the agency" → "the team" → "the company" in four sentences. Why: AI was trained to avoid repetition, but in short LinkedIn copy this reads as evasive. Real writers repeat the proper noun.

Rewrite: pick one name and use it consistently. Pronouns are fine; rotating synonyms is not.

**29. No title case headers.** If the post uses headers or bold subheadings, write them in sentence case. Why: title case ("Key Considerations For Adoption") is corporate-deck formatting and signals AI templating. Sentence case ("Key considerations for adoption") reads human.

**30. No knowledge-cutoff disclaimers.** Cut on sight: "as of my last update," "based on available information," "I do not have real-time access," "to the best of my knowledge as of." Why: these are pure AI tells — no human writes them in a LinkedIn post.

**31. No padding hedges.** "I think," "probably," "maybe," "my read is," "it seems like" used as filler rather than genuine qualification. Why: an operator voice states what it knows. Hedges that don't narrow the claim — they just soften it — are AI throat-clearing.

Test: remove the hedge. If the meaning is identical and the claim still stands, it was padding. If removing it makes the claim overstated, the hedge was earning its place — keep it.
Allowed: hedges that genuinely narrow scope ("I think this works for early-stage but not enterprise"). Banned: hedges that just soften tone ("I think the answer is probably to focus on the customer").

### 2D. Hook-specific checks

If the draft is a LinkedIn post (default assumption), apply these to lines 1–2 only:

- Line 1 does not start with "I"
- Line 1 is not a question
- Line 1 is not a generic industry statement ("In today's...", "Every founder knows...")
- Line 2 adds information, not a reaction ("That's wild" / "Sounds great" / "Most would celebrate" = reaction line, flag it)

---

## Phase 3 — Voice Rubric Scoring (1–10 per dimension)

Five dimensions. Score each on first read. Threshold 35/50 to pass. Below 35 means the draft reads as AI even if individual rules passed.

**Dimension 1: Directness (1–10)**
Does the draft state its point without throat-clearing, hedging, or scaffolding? 10 = every sentence advances the argument. 1 = reader has to wade through 3+ setup sentences before the point lands.

**Dimension 2: Rhythm (1–10)**
Sentence length and paragraph size vary naturally. 10 = short and long sentences mix, paragraphs are uneven, the post reads aloud like someone actually talking. 1 = every sentence is 15–25 words, every paragraph is 3 lines, the pattern is mechanical.

**Dimension 3: Trust (1–10)**
Does the post feel like a specific human wrote it? 10 = specific detail, specific number, specific moment the reader can picture. 1 = generic claims ("most teams struggle with X") with no anchor.

**Dimension 4: Authenticity (1–10)**
Does the post acknowledge a limit, tradeoff, or imperfection? 10 = there's a "but" or "except" or self-correction somewhere. 1 = all-positive, all-confident, no edge.

**Dimension 5: Density (1–10)**
Every sentence carries weight. 10 = remove any sentence and the post is meaningfully worse. 1 = 40%+ of sentences are filler, restatement, or setup.

---

## Phase 4 — Rewrite

For every violation found in Phase 2, produce the rewritten line inline. Do not hand back a list of violations for the user to fix — the scrubber rewrites. The user's job is to approve, not to apply edits.

**Rewrite discipline:**

- **Preserve voice markers** from the voice profile. Do not flatten the client's signature phrasing, humor, or cadence in the pursuit of AI removal.
- **Preserve hook specificity.** A strong specific hook that happens to contain an em dash gets the em dash replaced, not the hook rewritten.
- **Preserve intentional sentence fragments** when they serve a rhythm purpose. Not every short fragment is "dramatic fragmentation."
- **When in doubt, ask.** If a flagged construction is a judgment call (e.g., "is this profundity earned?"), surface it as a question rather than force a rewrite.

**Anti-patterns to avoid in the rewrite:**
- Over-sanitizing into bland, flat prose
- Removing every specific detail in the pursuit of concision
- Breaking up a sentence that was deliberately long for rhythm
- Replacing a voice-specific word with a generic synonym

---

## Phase 5 — Output

Deliver in this exact format:

```
AI-TRAIT SCRUBBER REPORT
Client: [name or "none — universal rules only"]
Voice overrides: [list or "none"]

VIOLATIONS FOUND: [N]

Filler (2A):             [count — exact words flagged]
Banned vocabulary (2B):  [count — exact terms flagged]
Banned structures (2C):  [count — rule numbers flagged, e.g., "3C-1 (em dash), 3C-20 (false agency)"]
Hook checks (2D):        [count — which hook checks failed]

VOICE RUBRIC:
Directness:    [N]/10
Rhythm:        [N]/10
Trust:         [N]/10
Authenticity:  [N]/10
Density:       [N]/10
TOTAL:         [N]/50

VERDICT:
[PASS — 0 violations AND rubric ≥ 35/50 → scrubbed draft below is identical to input]
[REWRITTEN — violations found, rubric < 35, or both → scrubbed draft below is the fixed version]
[FLAGGED FOR REVIEW — judgment calls the scrubber did not force → listed below, user decides]
```

**Then the scrubbed draft in full:**

```
SCRUBBED DRAFT:
[full post, rewritten]
```

**Then the diff summary (what changed and why):**

```
CHANGES MADE:
- Line 1: "[before]" → "[after]" — [rule #]
- Line 4: "[before]" → "[after]" — [rule #]
- ...

FLAGGED FOR REVIEW (no change applied):
- Line 7: "[text]" — [reason: judgment call]
- ...
```

**Finally the pass certificate:**

```
SCRUBBER PASS: [YES / NO]
If NO: return to copy-developer with rewrite directive.
If YES: hand to post-grader.
```

---

## Before / After Examples

**Example 1 — throat-clearing + binary contrast + filler**

Before:
> "Here's the thing: most teams struggle with alignment. Not because the tools are bad. But because people are complex. Let that sink in."

After (rewrite):
> "Teams struggle with alignment. Tools are manageable. People aren't."

Changes: removed "Here's the thing" (rule 3C-22), removed "most" hedge (Phase 2A), removed "let that sink in" (rule 3C-7), removed "not because...but because" binary contrast (rule 3C-2).

**Example 2 — false agency + narrator distance**

Before:
> "The data tells us that B2B buyers have shifted their behavior. Teams across the industry are realizing that the old playbook no longer works."

After (rewrite):
> "Last quarter, 3 of my clients told me the same thing: the old playbook stopped working. Buyers aren't behaving how they used to."

Changes: "the data tells us" → named human observer (rule 3C-20), "teams across the industry are realizing" → specific client count (rule 3C-21).

**Example 3 — rule of three + dual adjectives + jargon**

Before:
> "In today's landscape, we need a robust, scalable, and comprehensive framework to navigate uncertainty and leverage our core capabilities."

After (rewrite):
> "You need one framework. Everything else is noise."

Changes: removed "in today's landscape" (Phase 2B phrases), removed rule-of-three adjective stack (rule 3C-3), removed "navigate" and "leverage" (Phase 2B verbs).

**Example 4 — em dash + unearned profundity**

Before:
> "We closed 12 deals last month — something shifted. Everything changed."

After (rewrite):
> "We closed 12 deals last month. The change: we stopped chasing inbound and started responding within 4 minutes."

Changes: em dash replaced (rule 3C-1), "something shifted / everything changed" forced to earn the weight with a specific detail (rule 3C-7).

---

## Voice Profile Override Logic

The scrubber is strict by default. Voice Profile can override specific rules per client. Format in voice-profile.md:

```
## AI Trait Scrubber Overrides

- rule-3C-1 (em dash): allow max 1 per post for rhythm emphasis
- rule-3C-18 (question hooks): allowed — signature pattern
- filler-word "actually": allowed — intentional tic
```

If voice-profile.md contains this section, apply the overrides in Phase 1. Otherwise apply all rules as written.

---

## Handoff to Post-Grader

On PASS: output the scrubbed draft + the pass certificate, then explicitly state:

> "Scrubber pass certificate: issued. Handing scrubbed draft to post-grader."

Post-grader is configured to refuse any draft without this certificate. If a draft arrives at post-grader without it, post-grader returns the draft here first.

---

## Verification

**Correctness:**
```
□ Every violation found in Phase 2 has either a rewrite in Phase 4 OR a "flagged for review" note? Yes → pass. No → fix missing items.
□ Voice overrides respected — no override rule was applied as a violation? Yes → pass. No → re-scan with override in mind.
□ Scrubbed draft is readable as natural writing, not sanitized into flatness? Yes → pass. No → back off aggressive rewrites.
```

**Completeness:**
```
□ All 5 rubric dimensions scored? Yes → pass. No → score missing.
□ Pass certificate issued with YES or NO? Yes → pass. No → add it.
□ Diff summary lists every change with rule number? Yes → pass. No → add.
```

**Context-fit:**
```
□ If client is named: Voice Profile was loaded and scanned for overrides? Yes → pass. No → load it.
□ If draft is a Connect post: narrator distance rule applied with relaxation for first-person reflection? Yes → pass. No → re-score.
□ If rewrite conflicts with a Voice Profile rule: override logged and Voice Profile rule wins? Yes → pass. No → fix conflict.
```

**Consequence:**
If this scrubbed draft goes to post-grader as-is: what is the single remaining AI tell most likely to be flagged?
→ Name it before handoff. If the answer is "the draft still has uniform sentence length" or "the hook is still a question" — the scrubber has not done its job. Re-scan.

---

## Why This Skill Exists

The rules in this skill were previously in linkedin-framework.md Section 4. They were loaded as context by copy-developer at session start. In practice, loading ≠ enforcement — the model would self-attest "Section 4 passed" without running each rule line by line, and AI traits kept leaking through to delivery.

This skill is the enforcement layer. It treats AI decontamination as a separate pipeline stage with its own detection, scoring, and rewrite logic. Copy-developer focuses on voice and structure. Post-grader focuses on hook, clarity, ICP, voice match, conversion. The scrubber is the gate between them.

Single source of truth: all AI decontamination rules live here. linkedin-framework.md Section 4 points to this skill. When a rule changes, it changes in this file.
