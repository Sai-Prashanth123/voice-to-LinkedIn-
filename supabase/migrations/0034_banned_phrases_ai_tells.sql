-- The banned-phrases section, rewritten against a real detection library.
--
-- WHY
--
-- Version 4 was a starter list of about a dozen tells, written from memory. Gate check 8 judges
-- every draft against this section, and the drafting view hands it to the writer before a word is
-- written, so its thinness was the ceiling on both.
--
-- ai-trait-scrubber.md is the source: ~60 banned words and 31 banned structures, each with a reason
-- rather than a preference. This replaces the section with the reconciled version of it.
--
-- WHAT "RECONCILED" MEANS, AND WHY IT MATTERS MORE THAN THE ADDITIONS
--
-- The scrubber strips padding hedges. Two of Josh's measured signature terms ARE hedges:
-- `potentially` and `might`, computed from 11,022 words of his recorded speech. Applied literally,
-- the first thing this list would do is delete the words that most reliably identify him — the
-- exact failure the source document warns about in its own anti-patterns ("over-sanitizing into
-- bland, flat prose").
--
-- So the section carries a NOT BANNED block naming each relaxed rule and the evidence for it. A
-- rule relaxed without a stated reason is a rule somebody will quietly re-tighten.
--
-- REVERSIBILITY (12.11)
--
-- The library_section_snapshot trigger stores every version's body, so version 4 remains readable
-- in library_section_versions and reverting is one update. The reason is set explicitly below
-- because the trigger does not populate it.

update public.library_sections
set body = $section$# Banned phrases and AI tells

STARTER — written by Thought Pilot, then rebuilt against a detection library. Josh: cut anything you
disagree with, add anything that makes you wince. This is the list the gate checks every draft
against, and the list the writer is handed before drafting.

Three things check it: `measure_draft` flags the loudest ones for free before anything is spent,
`scrub_draft` runs every rule line by line, and gate check 8 judges the finished post against this
text. They read this section, so a change here changes all three.

## The one that matters most

**Never reject a frame in order to assert another one.**

  "It's not X, it's Y." / "This isn't X. This is Y." / "Not because X, but because Y."
  "Most teams do X. The best do Y." / "Forget X. Start Y." / "Less X, more Y."
  "Is it X? No. It's Y." / "Most people think X..." / "At first glance X..." / "Sure, X. But Y."

This is the single most recognisable AI cadence on LinkedIn, and it survives being disguised — the
softened forms above do the same work three sentences later and are the ones that get through.

It is rhetorically empty. It announces a reframe instead of making a point. Real writers state Y.

**The fix is not to reword it. Delete the rejected half entirely and state Y once, with a detail
attached.** "It's not about the tools, it's about the people" becomes "She wanted to know who owned
the number after we left."

## Constructions that give it away

- Throat-clearing: "Here's the thing:" / "Here's what I learned:" / "The truth is," / "Let me be
  clear:" / "It turns out" / "Can we talk about"
- Formulaic reveal: "Let me explain." / "Here's why." / "Here's what happened." Just say it.
- Unearned profundity: "Something shifted." / "Everything changed." / "That was the moment." /
  "Let that sink in." / "Read that again." Delete, unless the line before it earned the weight with
  a specific fact.
- Vague attribution: "Experts argue" / "Studies show" / "Industry reports suggest" / "The data
  tells us". Name the source or cut the claim.
- Copulative avoidance: "serves as", "stands as", "marks a", "represents a", "boasts a",
  "features a", "offers a", "plays a role in", "helps to", "aims to", "seeks to". Use "is" and
  "has". Real writing uses "is" freely; dodging it is a tell.
- Participle traps: "highlighting its importance", "underscoring significance", "paving the way
  for", "reflecting the broader trend", "marking a new era", "signalling a shift". These give the
  rhythm of insight with no claim inside. Name the actual consequence instead.
- Puffery: "a pivotal moment", "a major shift", "broader implications", "a watershed moment", "a
  turning point". When every fact is pivotal, none of it lands.
- False ranges: "from startups to enterprises", "from boardrooms to break rooms". A real range
  narrows a claim; these span everything and say nothing.
- Correlative crutches: "not only... but also", "on one hand... on the other".
- Meta-commentary: "Hint:", "Plot twist:", "Spoiler:", "But that's another post", "In this post".
- Knowledge-cutoff disclaimers: "as of my last update", "based on available information". No human
  writes these.
- Elegant variation: renaming the same company across four sentences — "Acme" then "the agency"
  then "the team" then "the business". Pick one name and repeat it. Pronouns are fine.
- False agency: "complaints become fixes", "the decision emerged", "the strategy evolved". An
  abstract noun performing a human action is how the person gets removed from the sentence. Name
  who did it.
- Narrator distance: "Teams across the industry are realising..." He is not standing above the
  industry watching it. "I watched three teams do the same thing this month" is the same claim from
  inside the room.

## Vocabulary

Verbs: leverage, utilise, delve, harness, navigate, embrace, elevate, unlock, cultivate, foster,
streamline, underscore, embark, empower, facilitate, revolutionise, reimagine, supercharge.

Adjectives: groundbreaking, revolutionary, transformative, cutting-edge, robust, scalable, pivotal,
seamless, comprehensive, innovative, meticulous, profound, dynamic, holistic, disruptive,
unprecedented.

Nouns as metaphor: landscape, realm, tapestry, synergy, testament, paradigm, ecosystem, catalyst,
cornerstone, deep dive, key takeaways, actionable insights, best practices.

Phrases: in today's landscape, in a world where, at the end of the day, at its core, when it comes
to, the reality is, make no mistake, full stop, in conclusion, circle back, move the needle, think
outside the box, let's dive in, let's unpack, game-changer, double down.

Filler: actually, basically, essentially, literally, simply, really, truly, honestly, obviously,
clearly, certainly, definitely, ultimately, fundamentally, absolutely, indeed, furthermore,
moreover, additionally, consequently. Test: delete the word. If the meaning is identical, leave it
deleted.

## Shape and rhythm

- No em dashes. His count across 11,022 words of recorded speech is zero.
- No semicolons. They read as edited prose rather than speech.
- No rule of three. "Simple, practical and powerful" is a rhythm, not three ideas. Pick one.
- No paired adjectives. Pick the stronger one.
- Vary sentence length. A block of 15-25 word sentences with no variance is the strongest
  statistical signal of generated text. Short next to long is the fix.
- Vary paragraph length. Every paragraph the same size is a layout, not writing.
- No repeated bullet shapes. Three bullets opening on the same word, running to the same length, or
  landing on the same grammatical beat read as generated. Real lists are uneven.
- Title case headers are deck formatting. Sentence case.
- No more than one bolded phrase per section.
- Never open with a question. Never open with "I".
- Never end by asking for engagement ("Agree?", "Thoughts?", "What would you add?").
- Never end by restating the post. The last line pushes forward.
- No hashtags.
- Every post needs an edge — a limit, a tradeoff, a place he was wrong. All-positive reads as
  generated even when every rule above passes.
- Use contractions. Too-clean grammar is its own tell.

## NOT banned — and why

These look like violations of the rules above and are not. Each is measured in his own speech, so
removing it would remove him from the post. Do not "fix" these.

- **potentially**, **might** — signature terms in the voiceprint, measured across 11,022 words.
  The hedge rule does not apply to them. Test a hedge properly: remove it, and if the claim now
  overstates the case, the hedge was doing work. Only cut hedges that soften tone without narrowing
  a claim.
- **guys** — how he addresses a room. Not filler.
- **appreciate** — his word, not corporate warmth.
- Deliberate short sentences stacked for rhythm. Three short sentences in a row is a device. The
  uniform-length rule targets a block of mid-length sentences with no variance, which is a
  different thing.
- Sentence fragments, where they carry the beat.

## The test underneath all of it

If a sentence could survive unchanged in someone else's post, cut it or make it specific. Every rule
above is a way of failing that test mechanically, which is the only reason they are written down.
$section$
where key = 'banned_phrases';

-- The trigger snapshots the body but leaves the reason null, so it is recorded here. 12.11 asks for
-- the date and the reason, and the date comes from created_at.
update public.library_section_versions
set reason = 'Rebuilt against ai-trait-scrubber.md: negative parallelism, false agency, narrator '
  || 'distance, copulative avoidance, participle traps, puffery, false ranges and repeated bullet '
  || 'shapes added. Reconciled against the voiceprint so his signature hedges (potentially, might) '
  || 'are explicitly NOT banned.'
where key = 'banned_phrases'
  and version = (select version from public.library_sections where key = 'banned_phrases');
