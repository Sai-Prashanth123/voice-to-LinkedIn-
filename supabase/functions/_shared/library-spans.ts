/**
 * The generated span of the `reference_posts` library section: one block, three writers of it.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING
 *
 * The same reason as `shape.ts` beside it, and the same two-copies problem one layer up. Until
 * 28 October the measurement block existed twice:
 *
 *   scripts/sentinel-refresh.mjs:234-275      denominator `m.posts`      = every stored post
 *   supabase/functions/cc-submit/maintenance.ts:233-290   `totals.of`    = posts that kept breaks
 *
 * The same sentence, in the same section, with a different number depending on which door ran. The
 * live row said "147 of 1899 posts do", which is how we know the script wrote it last; running the
 * `refresh_sentinels` tool next would have silently made the identical claim "147 of 1839" with
 * nothing recording that anything had changed. Neither file acknowledged the other existed. That is
 * the precedent `SHAPE_ROWS_SELECT` and `SHAPE_ROWS_PAGE` are already in this directory for.
 *
 * So: import-free, type-stripped by Node, imported by Deno. One block, three readers —
 * `load-josh-library.mjs` (the seed), `sentinel-refresh.mjs` (after a scrape) and
 * `maintenance.ts` (`refresh_sentinels`, from the stored corpus).
 *
 * THE DEFECT THIS CLOSES, WHICH IS NOT THE DUPLICATION
 *
 * `reference_posts` version 8 contradicted itself inside one row, and the mechanism was the marker
 * boundary rather than anybody's carelessness. The start marker sat BELOW the prose that described
 * the measurement, and both refreshers deliberately preserve everything above it as "something Josh
 * wrote" (`maintenance.ts`: "leaving every word of the section he has written himself untouched").
 * So the table was rewritten on 20 October and the sentences describing it could not be reached.
 * Version 8 shipped saying fifty-nine posts across seven accounts four lines above a table of
 * 1,899 across eight — with "the adam-treboutat account returned zero posts" standing over a row
 * of 250 of them, while `compare_to_references` ranked that handle as a live candidate against the
 * posts the prose denied existed.
 *
 * It was not a thing nobody had noticed. Josh's own approval note on version 8 names it: "the intro
 * still says Adam Treboutat returned no posts". It was a thing nobody could fix from inside the
 * span that gets rewritten.
 *
 * THE FIX IS A BOUNDARY, NOT A CORRECTION
 *
 * The marker moved UP, above the prose, and every sentence that states a count is composed here.
 * What stays outside is the section's argument — what it is for, what never to take — and it holds
 * no number a measurement could contradict. Prose and table cannot drift apart if only one of them
 * counts. `library-spans.test.ts` asserts that: no integer outside the markers, in the seed or in
 * anything this file emits.
 */

/* ── The eight ────────────────────────────────────────────────────────────── */

/**
 * The eight writers of clause 8.3, with the names the library prints.
 *
 * Deliberately a second copy of the roster in `mcp-server/writers.mjs`, not an import: that module
 * is on the MCP side, this one is read by a Deno edge function, and an import across that boundary
 * is the kind of thing a bundler resolves to nothing without saying so. `writers.mjs` is matched
 * against what Josh SAYS; this list decides what the library PRINTS, and the two are tested
 * against each other rather than merged.
 *
 * `name` rather than the scraped `author_name`: the corpus carries Eric Nowoslawski with a
 * decorative glyph in front of his name, and until today that glyph was in Josh's own library table.
 */
export const REFERENCE_WRITERS: { handle: string; name: string }[] = [
  { handle: "demandjen1", name: "Jen Allen-Knuth" },
  { handle: "ryanscarlin", name: "Ryan Carlin" },
  { handle: "outboundphd", name: "Eric Nowoslawski" },
  { handle: "curtishowland", name: "Curtis Howland" },
  { handle: "adam-treboutat", name: "Adam Treboutat" },
  { handle: "juliacarter98", name: "Julia Carter" },
  { handle: "amangrowth", name: "Aman Ghataura" },
  { handle: "mattjbarker1", name: "Matt Barker" },
];

/* ── The markers ──────────────────────────────────────────────────────────── */

/**
 * The span the refreshers rewrite whole.
 *
 * The marker TEXT is unchanged from 20 October on purpose. `sentinel-refresh.mjs` refuses rather
 * than guessing when it cannot find them, so renaming them would have turned a content fix into
 * "refusing to guess where to put this" on the first run against a section nobody had reseeded.
 * What changed is where the start marker sits in the body, not what it is called.
 */
export const START = "<!-- sentinel-measurements:start -->";
export const END = "<!-- sentinel-measurements:end -->";

/**
 * Where the deeper structural read of one writer lives, now that it is not in `reference_posts`.
 *
 * Deliberately in no entry of `VIEWS` in `views.ts`. `renderLibrary` filters by
 * `wanted.has(row.key)`, so a key in no view reaches no prompt: the exclusion is the DEFAULT rather
 * than a rule somebody has to maintain, which is the opposite of how `reference_posts` came to ship
 * one writer's shape on every drafting brief.
 */
export const WRITER_READS_KEY = "reference_writer_reads";

/* ── What a measurement looks like ────────────────────────────────────────── */

export interface WriterMeasurement {
  handle: string;
  name?: string | null;
  posts_measured: number;
  shape_basis?: number | null;
  window?: { from: string; to: string } | null;
  median_words?: number | null;
  sd_median?: number | null;
  above_fold_words_median?: number | null;
  opening_words_median?: number | null;
  paragraphs_median?: number | null;
  list_rate?: number | null;
}

export interface Measurement {
  measured_at: string;
  accounts: number;
  /** Every stored post. */
  posts: number;
  /** Of those, the ones that kept their line breaks. */
  shape_basis?: number | null;
  totals: {
    of: number;
    opens_with_question: number;
    engagement_asks: number;
    direct_asks: number;
  };
  report: WriterMeasurement[];
}

/* ── Splicing ─────────────────────────────────────────────────────────────── */

/**
 * Replace the marked span in `body` with `span`, or refuse.
 *
 * Refusing rather than appending is the 20 October behaviour and it is right: a block appended to a
 * section whose markers have gone is a second, contradictory set of numbers below the first — the
 * defect this file closes, arriving by another route.
 */
export function spliceSpan(body: string | null | undefined, span: string): string {
  const text = String(body ?? "");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) {
    throw new Error(
      "reference_posts has no measurement markers, so there is nowhere to put the numbers without " +
        "overwriting something Josh wrote. Run: node scripts/load-josh-library.mjs --apply",
    );
  }
  return text.slice(0, a) + span + text.slice(b + END.length);
}

/** The closing rule, which stays last in the section whatever is spliced above it. */
export const CLOSING_ANCHOR = "## What never to take";

/** The heading `matt-barker-structure.mjs` writes and replaces. */
export const WRITER_READ_HEADING = "## Matt Barker, read structurally";

/**
 * Cut a writer's structural read out of the section body.
 *
 * 8,287 of version 8's 10,924 characters were one writer's shape, spliced in below the measurement
 * span where no refresh could reach it. It shipped on EVERY drafting brief whichever handle was
 * passed — a control run with no handle at all read it as its shape target, which is Josh's recorded
 * complaint that "the default framework gets used anyway" arriving as the mechanism rather than as a
 * symptom.
 *
 * Nothing load-bearing is lost by cutting it. A named writer's measured shape reaches a drafter
 * through `writerShapeBlock` in `mcp-server/tools/voice.mjs`, which asks for the handle; and the one
 * exclusion that must never be dropped — Matt Barker's renamed-problem turn, the construction the
 * banned-phrases section forbids — is hardcoded beside that target in the same file, in the same
 * object, with a comment explaining why it may never become a separate optional field. Version 8
 * keeps the prose either way, and the read itself goes to `WRITER_READS_KEY`.
 */
export function removeWriterReads(body: string | null | undefined): string {
  let out = String(body ?? "");
  for (const heading of [WRITER_READ_HEADING]) {
    const from = out.indexOf(heading);
    if (from === -1) continue;
    const to = out.indexOf(CLOSING_ANCHOR, from);
    out = out.slice(0, from).replace(/\n*(?:---\n*)?$/, "\n\n") + (to === -1 ? "" : out.slice(to));
  }
  return out;
}

/* ── The denominator rule ─────────────────────────────────────────────────── */

/**
 * ONE RULE, STATED IN THE TEXT, BECAUSE THERE WERE FOUR QUANTITIES AND NO RULE.
 *
 * Every one of these is real and correctly computed. None of them said which question it answered:
 *
 *   posts            1899   every stored post
 *   totals.of        1839   the posts that kept their line breaks
 *   posts_measured    250   one writer's stored posts        (Carlin 150)
 *   shape_basis       241   one writer's measurable posts    (demandjen1 237, outboundphd 232)
 *
 * The live section read "**250 posts**, 2026-03-02 to 2026-10-19" four lines above "120 of his 241
 * posts open on a figure", and "180 of 250 posts reverse on a marked turn" beside "99 of 241 posts
 * end in eight words or fewer". Each is defensible alone; together a reader cannot tell whether a
 * changed denominator means a changed corpus or a changed claim.
 *
 * THE RULE: a count is always followed by what it is a count of. A claim about SHAPE is counted
 * over the posts that kept their line breaks; a claim about HOW MANY POSTS EXIST uses the stored
 * count; and whichever it is, the sentence says so.
 *
 * It is not arbitrary. Paragraphs, above-fold words, openings, closes and lists are all read from
 * line breaks, and a post that arrived as one unbroken line has none — so including it does not
 * make the denominator honest, it makes the numerator wrong. The 5 October scrape proved that: it
 * returned every post as a single line, and the measurement reported an eighty-five per cent drop
 * in paragraph counts across seven writers as a finding about their writing.
 *
 * THE ONE EXCEPTION, NAMED WHERE IT IS USED: a figure measured SENTENCE-WISE needs no line breaks,
 * so it is counted over every stored post. `scripts/measure-structure.mjs` is the only producer of
 * those, and the sentence quoting one says which it is.
 *
 * In the table the column headings carry the rule, because a heading is where a reader looks for
 * what a cell counts; in prose the sentence carries it.
 */
export const DENOMINATOR_NOTE =
  "Every column right of *kept line breaks* counts over that column, not over *stored posts*: a " +
  "post that arrived as one unbroken line has no paragraphs and no fold to measure. A " +
  "sentence-wise figure needs no line breaks and counts over every stored post; where one is " +
  "quoted, the sentence says so.";

/* ── The scene/cut split ──────────────────────────────────────────────────── */

export interface ModeSplit {
  threshold: number | null;
  gap: { under: number; over: number } | null;
  scene: WriterMeasurement[];
  cut: WriterMeasurement[];
}

/**
 * Which writers build a post as a scene and which as a cut — derived, at last.
 *
 * This was the only written justification anywhere for a split two pieces of live code depend on:
 * `SCENE_WRITERS` in `mcp-server/tools/measure.mjs` and `SCENE` in `mcp-server/tools/voice.mjs`,
 * both commenting that the split is "a judgement recorded in the reference_posts library section".
 * By 28 October it was false twice and then absent. It named Ryan Carlin at a six-word opener,
 * twenty-eight words above the fold and nineteen paragraphs, where he measures 8 / 23 / 21. It said
 * there were three cut writers when `adam-treboutat` had joined them and made four. And the
 * 20 October refresh overwrote the whole passage, so the document those two files cite no longer
 * contained the judgement at all.
 *
 * THE JUDGEMENT IS KEPT. WHAT IS DERIVED IS MEMBERSHIP.
 *
 * "Josh writes in the scene mode, so the scene writers are the structurally useful reference" is
 * his, from the rules he sent, and it is not this module's to revise. Which writers are in which
 * mode is a fact about the corpus, and the roster is now read off it.
 *
 * THE LINE IS THE CORPUS'S OWN MEDIAN, NOT A NUMBER ANYONE CHOSE.
 *
 * Above-fold words is the discriminator the original passage actually described — "roughly three
 * times as much is spent before the fold". Splitting at the median of that series reproduces the
 * recorded roster exactly and adds the writer who was missing from it.
 *
 * A median split of eight writers always yields four and four, which would hide a corpus that had
 * genuinely moved all one way. So `gap` is returned and the prose prints it: a reader can see
 * whether the boundary is a cliff or a coin toss, which is the honest form of a derived judgement.
 * On the 20 October corpus the line falls at thirty-one words with the nearest writer below at
 * twenty-three and the nearest above at thirty-nine, so it is a cliff.
 */
export function splitModes(report: WriterMeasurement[]): ModeSplit {
  const rows = (report ?? []).filter((r) => typeof r.above_fold_words_median === "number");
  if (rows.length === 0) return { threshold: null, gap: null, scene: [], cut: [] };

  const fold = (r: WriterMeasurement) => r.above_fold_words_median as number;
  const values = rows.map(fold).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const threshold = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

  const below = values.filter((v) => v < threshold);
  const above = values.filter((v) => v >= threshold);

  const by = (keep: (r: WriterMeasurement) => boolean) =>
    rows.filter(keep).sort((a, b) => fold(a) - fold(b));

  return {
    threshold,
    gap: below.length && above.length
      ? { under: below[below.length - 1], over: above[0] }
      : null,
    cut: by((r) => fold(r) < threshold),
    scene: by((r) => fold(r) >= threshold),
  };
}

/* ── The span ─────────────────────────────────────────────────────────────── */

/** The name the library prints for a handle, not the name the scrape returned. */
function nameFor(handle: string, fallback?: string | null): string {
  return REFERENCE_WRITERS.find((w) => w.handle === handle)?.name ?? fallback ?? handle;
}

/** A dash where the corpus could not answer. A number nobody can source is worse than a gap. */
const n = (v: number | null | undefined): string => (v == null ? "—" : String(v));

const group = (x: number) => x.toLocaleString("en-GB");

/**
 * THE TABLE HEADING, DEFINED ONCE.
 *
 * Exported so the test can assert there is exactly one definition of it in the repository. Two
 * copies of a heading is how two copies of the block went unnoticed for eight days: the rows under
 * them looked identical and the denominator behind one column was not.
 */
export const TABLE_HEADER =
  "| Account | Handle | Stored posts | Kept line breaks | Median words | Above fold | " +
  "Paragraphs | Lists | Variation | Mode |";

const TABLE_RULE = "|---|---|---|---|---|---|---|---|---|---|";

/**
 * Everything in the section that states a number, composed from one measurement object.
 *
 * `m` is the shape both producers already emit. Nothing outside it is read, so the file-fed script
 * and the corpus-fed edge function cannot produce different prose from the same corpus — which they
 * did until today. `library-spans.test.ts` feeds one measurement to both callers and asserts the
 * output is byte-identical.
 */
export function measurementSpan(m: Measurement): string {
  const report = (m.report ?? []).slice()
    .sort((a, b) => nameFor(a.handle, a.name).localeCompare(nameFor(b.handle, b.name)));
  const byHandle = new Map(report.map((r) => [r.handle, r]));
  const modes = splitModes(report);
  const cutHandles = new Set(modes.cut.map((r) => r.handle));

  /*
   * The denominator for the three fractions that corroborate Josh's own rules.
   *
   * They are counted over the posts that kept their line breaks — an opening shape read off a post
   * with no line breaks is the whole post classified as its own first line — so that is what they
   * are reported over. The live row said "147 of 1899" for a numerator counted out of 1,839.
   */
  const of = m.totals?.of ?? m.shape_basis ?? m.posts;
  const windows = report.map((r) => r.window).filter(Boolean) as { from: string; to: string }[];
  const from = windows.map((w) => w.from).sort()[0];
  const to = windows.map((w) => w.to).sort().pop();

  const L: string[] = [];
  L.push(START);
  L.push("");
  L.push("## The eight, and what was measured");
  L.push("");
  L.push(
    `**${group(m.posts)} stored posts across ${m.accounts} accounts, posted ${from} to ${to}, ` +
      `measured ${String(m.measured_at).slice(0, 10)}.** Their posts are held in ` +
      "`reference_writer_posts`; `get_reference_posts` is the only door that returns a word of " +
      "them. Below is what came out of measuring them, and not one of their sentences.",
  );
  L.push("");
  L.push(TABLE_HEADER);
  L.push(TABLE_RULE);
  for (const w of REFERENCE_WRITERS) {
    const r = byHandle.get(w.handle);
    if (!r) {
      /*
       * AN ABSENT ACCOUNT IS REPORTED BY ITS ABSENCE.
       *
       * "The adam-treboutat account returned zero posts... Josh: worth confirming the handle" was
       * typed on 7 September and survived that account returning 250 posts, because it lived above
       * the marker. Iterating the ROSTER rather than the report means a handle that returns nothing
       * says so here, and the row fills itself in the moment it returns anything.
       */
      L.push(`| ${w.name} | ${w.handle} | **none** | — | — | — | — | — | — | — |`);
      continue;
    }
    L.push(
      `| ${w.name} | ${w.handle} | ${r.posts_measured} | ${n(r.shape_basis)} | ` +
        `${n(r.median_words)} | ${n(r.above_fold_words_median)} | ${n(r.paragraphs_median)} | ` +
        `${r.list_rate == null ? "—" : Math.round(r.list_rate * 100) + "%"} | ${n(r.sd_median)} | ` +
        `${cutHandles.has(r.handle) ? "cut" : "scene"} |`,
    );
  }
  L.push("");
  L.push(DENOMINATOR_NOTE);

  const missing = REFERENCE_WRITERS.filter((w) => !byHandle.has(w.handle));
  if (missing.length) {
    L.push("");
    L.push(
      `**${missing.map((w) => w.handle).join(", ")} returned nothing.** The fetch succeeded and ` +
        "found nothing, which usually means the handle has changed or the account posts nothing " +
        "publicly. Worth confirming the handle before the next refresh.",
    );
  }

  if (modes.threshold != null) {
    L.push("");
    L.push("## Two structural modes, and they do not mix");
    L.push("");
    L.push(
      "**The cut** — very short opening, almost nothing above the fold, many short paragraphs, " +
        "heavy list use. **The scene** — a longer opening that gives real information before the " +
        "reader commits, and lists are rarer.",
    );
    L.push("");
    L.push(
      `The *Mode* column splits them at the corpus's own median above-fold figure, ` +
        `**${modes.threshold} words** — not a threshold anyone chose` +
        (modes.gap
          ? `. The nearest writer below sits at ${modes.gap.under} and the nearest above at ` +
            `${modes.gap.over}, so it is a gap in the data`
          : "") +
        ". Recomputed on every refresh.",
    );
    L.push("");
    L.push(
      "**Josh writes in the second mode**, so the scene writers are the structurally useful " +
        "reference and the cut writers a contrast: they demonstrate a technique that would fight " +
        "his own rules if borrowed.",
    );
  }

  L.push("");
  L.push("## Three of his own rules, corroborated");
  L.push("");
  L.push(
    `**Almost nobody opens with a question: ${m.totals.opens_with_question} of the ${group(of)} ` +
      `posts that kept their line breaks, so ` +
      `${Math.round((1 - m.totals.opens_with_question / of) * 100)}% do not.** His hook rule — a ` +
      "question may close a hook, never start one — is what these writers already do.",
  );
  L.push("");
  L.push(
    `**${m.totals.engagement_asks} of the same ${group(of)} ask for engagement, and ` +
      `${m.totals.direct_asks} carry a direct ask** — about one post in ` +
      `${Math.round(of / Math.max(m.totals.direct_asks, 1))}. His ration of roughly one in five ` +
      "is more permissive than what these writers do.",
  );
  L.push("");
  L.push(END);
  return L.join("\n");
}

/* ── The refusals ─────────────────────────────────────────────────────────── */

/**
 * WHY THESE ARE REFUSALS AND NOT REVIEW NOTES.
 *
 * Every one of them describes something that was live in version 8 and that a careful person had
 * already looked at. The stale count was named in Josh's own approval note as outstanding and
 * shipped anyway. A comment saying "keep the numbers inside the markers" holds until the first
 * person who has not read the comment, and this section is written by three scripts and by Josh.
 *
 * `sentinel-refresh.mjs` already refuses to store a block containing a forty-character run of a
 * writer's own text, and `matt-barker-structure.mjs` already refuses on his signature phrases.
 * These are the same device, aimed at the three failures this section actually had.
 *
 * Each refusal returns the offending line, because one that does not say where to look is one
 * somebody will switch off.
 */

/**
 * A count, stated where no refresh can reach it.
 *
 * A clause reference is exempt and is the only exemption. "clause 8.3" is a pointer into the build
 * specification, not a measurement: no refresh can contradict it, and stripping the citations would
 * cost the section the thing that makes its rules traceable. Everything else outside the markers is
 * spelled in words or it does not belong there.
 */
const CLAUSE = /\bclause\s+\d+(?:\.\d+)*[a-z]?\b/gi;

/**
 * A DATE OF SOMETHING HE WROTE. THE SECOND AND LAST EXEMPTION.
 *
 * This rule exists to stop an UNDERIVED COUNT drifting, not to strip provenance. "His 3 September
 * post states the lived-experience test" is a citation: it says where a claim about him came from,
 * and a refresh cannot contradict it because no measurement is about what he wrote on a Tuesday.
 * Deleting it to satisfy a digit rule cost the section the thing that made the claim checkable, and
 * a rule that destroys evidence to protect against staleness has the wrong target.
 *
 * NARROW ON PURPOSE, SO IT DOES NOT BECOME A HOLE.
 *
 * It matches only a day-and-month, with an optional year — the form a citation takes. It does not
 * match a bare number, a year on its own, or anything with a counted noun after it. The stale
 * sentence that caused all of this, "59 posts across 7 accounts were collected on 7 September
 * 2026", still refuses: only "7 September 2026" is exempt, and "59 posts across 7 accounts" is
 * what is left to be caught. A count has a noun; a date has a month.
 */
const DATE_CITATION =
  /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?\b/gi;

/**
 * NUMBERS THAT ARE HIS JUDGEMENT RATHER THAN THE CORPUS'S. THE THIRD AND LAST EXEMPTION.
 *
 * This is the distinction the whole file is about, arriving from the other direction.
 *
 * A measured figure belongs inside the markers because it moves: the corpus is re-measured and the
 * number changes, so the only safe place for it is the span a refresh rewrites. A preference of
 * HIS does the opposite — it is a statement about the voice he wants, it is not derived from
 * anything, and re-measuring the corpus must not touch it. Putting it inside the markers would
 * mean a refresh either deleted it or carried a hardcoded number through a span whose whole
 * guarantee is that everything in it is derived. Outside is where it belongs; it just has to be
 * allowed to be there.
 *
 * WHY AN ENUMERATED LIST AND NOT A PATTERN.
 *
 * "A number that is a judgement" is a category that would swallow everything, which is how an
 * exemption becomes a hole. So the exemption is exactly these literal strings, each carried with
 * what it is about and where it was recorded. Adding one is a deliberate edit to a reviewed file
 * next to its own provenance, and it cannot spread by accident.
 *
 * 9–12 IS HERE BECAUSE IT WAS VERY NEARLY LOST FOR GOOD.
 *
 * It is the target range for within-post sentence-length variation, and on 28 October it existed
 * nowhere else: the passage carrying it was inside the measurement markers when the 20 October
 * refresh rewrote that span, and a grep of the whole repository — library, scripts, comments,
 * `data/josh/` — found no second copy. The system had one record of what a drafter should aim at
 * and a mechanism built to replace numbers deleted it, eight days before three of six drafters
 * were handed the measured band with nothing about whether to hit it.
 */
export const HIS_RECORDED_PREFERENCES: { value: string; about: string; recorded: string }[] = [
  {
    value: "9–12",
    about:
      "the median within-post standard deviation of sentence length a draft of his should land " +
      "near. His voice guide's 'everything the same length is exhausting', as a range.",
    recorded:
      "reference_posts v5, 2026-09-08. Destroyed by the 20 October refresh and restored on " +
      "28 October; it was the only copy anywhere in the system.",
  },
];

const ANY_INTEGER = /\d/;

/**
 * Prose addressed to Josh personally — which is SECOND PERSON, not his name.
 *
 * "**Josh — this is a real fork.** ... If you want that construction available because it is how he
 * lands a post, say so and it comes out of the banned list" shipped to a DRAFTER on every brief,
 * alongside "**One specific caution, Josh.** Matt Barker is not a peer reference here — he is the
 * origin of your rules." Both hand a model a decision only Josh can make, and the first tells it a
 * ban is negotiable, which is the one thing a banned-phrases list cannot survive being told. They
 * belong on the decision screen, so they move to the proposal's `claim`.
 *
 * MATCHING ON THE NAME WAS WRONG, AND THE FIRST VERSION OF THIS DID.
 *
 * `/\*\*Josh\b/` refused "**Josh writes in the second mode.**" — which is the derived sentence
 * carrying the judgement that the whole scene/cut split exists to record. A section about Josh's
 * standard is going to say his name; that is not the defect. The defect is the vocative and the
 * second person: a drafter reading "your rules" cannot know whose, and a drafter invited to "say so"
 * has been handed a conversation it is not in.
 *
 * So: a vocative Josh, or any second-person pronoun anywhere in the section.
 */
const ADDRESSED_TO_JOSH = /\bJosh\s*[—:]|,\s*Josh\b|\byou\b|\byour\b|\byours\b/i;

/**
 * The section's account of its own past.
 *
 * Roughly 1.5 KB of version 8 was a changelog: "This section said he did, and that was wrong", "the
 * previous version of this read called his opening *a scene, not a cut*". A drafter does not need to
 * know what the standard used to say — it needs the standard. The record of what changed belongs in
 * `library_section_versions` and in the proposal's `evidence`, which is where Josh reads it.
 */
const CHANGELOG: RegExp[] = [
  /\bthe (?:previous|earlier|first) version\b/i,
  /\b(?:this section|it) (?:said|used to say|claimed)\b/i,
  /\bwas wrong\b/i,
  /\bsuperseded\b/i,
];

export interface Refusal {
  rule: string;
  line: string;
}

/**
 * Judge a proposed section body and say WHAT is wrong with it, not whether.
 *
 * An empty array means it may be stored.
 */
export function refusals(body: string | null | undefined): Refusal[] {
  const text = String(body ?? "");
  const out: Refusal[] = [];

  const a = text.indexOf(START);
  const b = text.indexOf(END);
  const outside = a === -1 || b === -1 ? text : text.slice(0, a) + "\n" + text.slice(b + END.length);

  for (const raw of outside.split("\n")) {
    let line = raw.replace(CLAUSE, "").replace(DATE_CITATION, "");
    // Exactly the enumerated strings, nothing pattern-matched. See HIS_RECORDED_PREFERENCES.
    for (const p of HIS_RECORDED_PREFERENCES) line = line.split(p.value).join("");
    if (ANY_INTEGER.test(line)) {
      out.push({
        rule: "a number outside the markers, where no refresh can reach it",
        line: raw.trim(),
      });
    }
  }

  for (const raw of text.split("\n")) {
    if (ADDRESSED_TO_JOSH.test(raw)) {
      out.push({ rule: "prose addressed to Josh, in a section a drafter reads", line: raw.trim() });
    }
    if (CHANGELOG.some((re) => re.test(raw))) {
      out.push({ rule: "the section's own changelog", line: raw.trim() });
    }
  }

  return out;
}

/** The refusals, as something to print above an exit code. */
export function describeRefusals(found: Refusal[]): string {
  return found
    .map((f) => `  REFUSING: ${f.rule}\n    ${f.line.slice(0, 120)}`)
    .join("\n");
}

/**
 * How large this section may be.
 *
 * Version 8 was 10,924 characters and 8,287 of them were one writer's shape, shipped on every
 * drafting brief whichever handle was passed. A budget is the only thing that stops that coming
 * back, because every individual addition to it was defensible when it was made.
 *
 * Three thousand is the section composed as it now is, plus room for Josh to add a rule of his own
 * without tripping a test. If a future addition needs more, the question to answer first is which
 * brief is carrying it and why.
 */
/*
 * WHY 5,800, HAVING BEEN 3,000, THEN 3,600, THEN 4,800.
 *
 * The number has moved three times and every move is recorded, because a budget is only worth
 * having if it is the measured composition rather than a figure that sounded tidy. Each move was
 * also the same decision made again: do not cut his reasoning to protect a constant, because that
 * is the trade that caused this defect.
 *
 * 3,000 was the target. The section did not fit it without cutting a measurement column, so it
 * became 3,600 — the section as composed.
 *
 * It became 4,800, and then 5,800, as FOUR passages of his own argument were restored on
 * 28 October. None had been removed by anyone: all four were inside the measurement markers when
 * the 20 October refresh rewrote that span, so a mechanism built to replace numbers replaced
 * reasoning. Two of them were load-bearing and silently gone — 'do not let a target length near
 * the drafter', and the 9–12 range for sentence variation, which a grep of the whole repository
 * showed existed in no other copy anywhere in the system.
 *
 * Composed as it now is, 5,601:
 *
 *   810    the per-writer table — eight rows of measurement, the densest thing in the section
 *   1,740  the derived prose that makes those numbers readable: what was collected, the denominator
 *          rule, and the scene/cut split measure.mjs and voice.mjs both cite as their source
 *   1,900  the four restored passages — argument, no corpus counts, numbers read off the table
 *   780    the rest of the invariant prose: what the section is for, and what may never be taken
 *   371    markers, headings and blank lines
 *
 * THE INVARIANT THE TEST GUARDS IS NO LONGER A FRACTION OF VERSION 8.
 *
 * It was 'under half of 10,924', which the fourth restoration came within sixty characters of
 * breaking — and a test that would have been tripped by restoring his reasoning is a test pointed
 * at the wrong thing. The invariant now is that this section may never grow to the size of what was
 * taken out of it: 8,287 characters of one writer's shape, on every drafting brief whichever writer
 * was named. That is the failure a budget exists to prevent, stated as the thing it is.
 *
 * Still a 49% cut from version 8. If a future addition needs more, the question to answer first is
 * which brief is carrying it and why.
 */
export const SECTION_BUDGET = 5800;

/** The writer read that was removed from this section, and the size it may never regrow to. */
export const REMOVED_WRITER_READ_CHARS = 8287;

/* ── The invariant prose ──────────────────────────────────────────────────── */

/**
 * Everything in `reference_posts` that is NOT a measurement.
 *
 * WHY THIS IS HERE AND NOT ONLY IN THE SEEDER.
 *
 * `scripts/load-josh-library.mjs` is the natural home for it and was where it lived. It cannot be
 * the only home, for a reason found while fixing this: that script seeds the library at v1.0, and
 * four of Josh's sections have moved past it — `audience` is at v7, `closes` v6, `gate_rules` v5,
 * `formatting` v4. Running it with `--apply` today would revert all four to the text he was first
 * sent. So the seeder is not a tool anyone can run to correct one section, and the refresher needs
 * the corrected prose from somewhere that is safe to import.
 *
 * Importing it FROM the seeder is not that somewhere either: that file calls `await main()` at the
 * top level, so importing it runs it. Hence here, where both read it and neither owns a copy.
 *
 * WHAT IS ALLOWED IN IT
 *
 * No quantity. `refusals()` enforces that, and the clause citation is the only exemption. This is
 * the section's argument — what it is for, and what may never be taken — and an argument that
 * cannot be contradicted by a measurement is an argument no refresh has to be able to reach.
 */
export function referencePostsBody(span: string): string {
  return `# Reference posts — structure only

Eight accounts, per clause 8.3. **Structural reference only. Never a source of voice, never copied,
never quoted.**

The span below is rewritten whole on every refresh. Nothing in it is written by hand and nothing
outside it states a quantity, so the prose and the table cannot drift apart.

${span}

## There is no house length

The habitual lengths in the table above spread eightfold between the shortest writer and the
longest, and every one of them works. The formatting section's "no word count — the moment decides
the length" is confirmed by the data. **Do not let a target length near the drafter.** The band is
what these writers happen to do; it is not a figure to hit, and the middle of it is not a target.

## Sentence-length variation, and the one target he has stated

His voice guide says everything the same length is exhausting, and that is the one preference here
that is measurable. The *Variation* column is the median within-post spread of sentence length, and
it separates these eight writers more sharply than anything else in the table.

**A draft of his should land nearer 9–12 than at the foot of that column.** That range is his
judgement about his own voice rather than a fact about the corpus: the measured figures move on
every refresh and the preference does not move with them. The writer at the bottom of the column is
not failing — his posts are uniformly short by design — but a drafter aiming at what Josh asked for
aims at the range, and the gate could check it if it ever needed to.

**The band in the table is not an instruction.** It is what these eight happen to do. The range
above is the instruction.

## The closest structural match, and the furthest

**Eric Nowoslawski's structure most resembles what Josh's own rules describe.** Long, prose rather
than bullets, opening on a specific number, closing soft — the formatting section's lean-fat-lean,
bullets only for a genuine list, already being executed by somebody.

**Curtis Howland is the furthest**, and the table shows why: he is the heaviest lister of the eight.
The formatting section says bullets are a crutch when they replace sentences. Take his subject
discipline if anything; do not take his shape.

## What never to take

Their words, their cadence, their phrasing. Not quoted, not near-quoted, not paraphrased. If a run
of words from one of these could be recognised in a draft, it has been used wrongly. Josh's voice
comes from the voice guide and nowhere else.

Matt Barker is not a peer reference: he is where these rules came from. His 3 September post states
the lived-experience test, "lessons not advice", and the frame-then-reveal structure in almost the
words Josh sent. That makes his cadence the likeliest of the eight to leak, and it means a draft
that agrees with him proves nothing about whether it sounds like Josh. Take his structure
knowingly; be suspicious of a draft that starts to sound like him.`;
}
