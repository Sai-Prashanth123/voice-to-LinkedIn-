/**
 * Everything about how Josh sounds, in one answer.
 *
 * WHY THIS IS NOT JUST get_library
 *
 * "How does he write?" currently needs three sources and, worse, knowledge of which parts of each
 * one transfer:
 *
 *   the library's voice_guide   — how he builds a thought. Transfers.
 *   voiceprint.json             — measured, but from SPEECH. The lexicon transfers; the rhythm
 *                                 explicitly does not, and the file says so.
 *   the sentinel measurements   — the measured corpus, which is where a rhythm target comes
 *                                 from, and which are STRUCTURE ONLY (8.3).
 *
 * A writer who fetches all three and does not know that split will use his spoken sentence length
 * as a target for his written one. That is a confident, precise, completely wrong instruction, and
 * it is the easiest mistake available here.
 *
 * So this assembles them and states the split as part of the answer.
 *
 * WHAT IT IS NOT
 *
 * Not a drafting brief. It carries no moment and no material, and nothing here may become a claim —
 * 9.4 has no exception for the voice guide, and the claim ledger only accepts spans from the idea
 * bank entry. This says how to sound. get_drafting_brief says what may be said.
 */

import { z } from "zod";

import { renderLibrary } from "../../supabase/functions/_shared/views.ts";
import voiceprint from "../../data/josh/law/voiceprint.json" with { type: "json" };
import sentinels from "../../data/josh/sentinels/latest.json" with { type: "json" };
import law from "../../data/josh/law/law.json" with { type: "json" };

/** The four whose structure matches what his own rules describe. See resources.mjs for why. */

/**
 * The spread of habitual post length across the writers, as a phrase.
 *
 * It was written out as "53 to 408 words" in three tool descriptions. The 5 October refresh moved the
 * top of that range to 422 and all three went quietly stale, which is the failure the measurements
 * exist to prevent. Derived here, once.
 */
export function medianWordRange(rows) {
  const xs = (rows ?? []).map((r) => r.median_words).filter((n) => typeof n === "number");
  if (xs.length === 0) return null;
  return { low: Math.min(...xs), high: Math.max(...xs) };
}

const SCENE = new Set(["demandjen1", "juliacarter98", "outboundphd", "mattjbarker1"]);

/** Read once at load, from the measurements themselves, so no description can go stale on its own. */
const RANGE = medianWordRange(sentinels.report) ?? { low: 0, high: 0 };

/**
 * How many posts the measurements rest on, read from the measurements.
 *
 * "59 measured posts" was written out in four descriptions here and five more across measure.mjs and
 * resources.mjs. It was true on 8 September. The 5 October refresh made it 112 and every one of those
 * strings kept saying 59 — the same drift `RANGE` exists to prevent, in the field next to it.
 */
const MEASURED = sentinels.posts ?? (sentinels.report ?? []).reduce((n, r) => n + (r.posts_measured ?? 0), 0);
const WRITERS = (sentinels.report ?? []).length;

const wordsOf = (list) => (list ?? []).map((e) => String(e?.word ?? e));

export const voiceTools = [
  {
    name: "get_voice_brief",
    config: {
      title: "How Josh sounds, from every source at once",
      description:
        "The voice guide, the measured voiceprint and the reference-writer structure, assembled " +
        "with the one thing that is easy to get wrong made explicit: which measurements transfer " +
        "from speech to writing and which do not. Read this before writing or rewriting anything " +
        "in his voice. It carries no material and nothing in it may become a claim in a post.",
      inputSchema: {
        include_law: z.boolean().optional()
          .describe("Include the full voice.md law file as prose. Default false."),
      },
    },

    async handler(args, { db }) {
      const rows = await db.select("library_sections", {
        select: "key,title,body,sort_order",
        order: "sort_order.asc",
      });

      // The drafting view, because that is the one the writer is judged against — and it is the
      // view that contains voice_guide, banned_phrases and reference_posts together.
      //
      // The VIEW NAME, not VIEWS.drafting. renderLibrary does `new Set(VIEWS[view])` itself, so
      // passing the array gave it an undefined lookup, an empty wanted-set, and every section
      // silently blank — no error, just three empty strings where the voice guide should be.
      const { sections } = renderLibrary(rows, "drafting");

      const sceneRows = (sentinels.report ?? []).filter((r) => SCENE.has(r.handle));
      const sds = sceneRows.map((r) => r.sd_median).sort((a, b) => a - b);

      return {
        transfers_from_speech: {
          what: "The lexicon and the surface habits.",
          signature_terms: wordsOf(voiceprint.contrast?.signature_terms).slice(0, 25),
          peer_words_he_avoids: wordsOf(voiceprint.contrast?.peer_words_he_avoids).slice(0, 25),
          em_dashes: voiceprint.surface?.em_dashes,
          i_vs_we: voiceprint.register?.i_vs_we,
          note: "He speaks as himself, not for a company. Em dashes are zero across 11,022 words " +
            "and the banned-phrases section calls them an AI tell.",
        },

        does_not_transfer: {
          what: "The rhythm figures. All of them.",
          spoken_sentence_sd: voiceprint.rhythm?.sentence_words_sd,
          why: "Spoken sentences run shorter and hedge more than written ones for everybody. The " +
            "voiceprint says outright that its rhythm is a baseline for his thinking, not a " +
            "target for his posts. Using his spoken sd as a target is the easiest mistake here.",
          use_instead: {
            source: "${MEASURED} measured posts by the ${WRITERS} writers he chose",
            scene_writers_sd: Object.fromEntries(sceneRows.map((r) => [r.handle, r.sd_median])),
            range: sds.length ? `${sds[0]}–${sds[sds.length - 1]}` : null,
          },
        },

        // Spoken filler is listed BECAUSE a writer who has read the transcripts will be tempted to
        // reproduce it as authenticity. It scores highest of everything on the raw contrast and
        // belongs in none of it.
        never_reproduce: {
          spoken_filler: wordsOf(voiceprint.contrast?.spoken_filler).slice(0, 15),
          why: "These score highest of all on the contrast against the reference writers, and not " +
            "one of them belongs in a post. Written filler does not read as authentic; it reads " +
            "as padding, and imitating his disfluencies fails the master test by sounding like a " +
            "transcript rather than like him.",
        },

        structure: {
          he_writes_in: "the scene — a longer opening that gives real information before the " +
            "reader has to commit",
          not: "the cut — a very short opener with the substance below the fold and heavy lists",
          closest_match: "outboundphd (Eric Nowoslawski): long, prose rather than bullets, opens " +
            "on a specific number, closes soft. That is his formatting section already being " +
            "executed by somebody.",
          caution: "Matt Barker is not a peer reference. He is where these rules came from, so " +
            "his cadence is the most likely to leak — be suspicious of a draft that starts " +
            "sounding like him.",
          length: `Their medians run ${RANGE.low} to ${RANGE.high} words and all of it works. No ` +
            "target length goes near a draft.",
        },

        // The live sections, so an edit Josh makes reaches this the same way it reaches the drafter.
        from_the_library: {
          voice_guide: sections.voice_guide || "(not filled in)",
          banned_phrases: sections.banned_phrases || "(not filled in)",
          formatting: sections.formatting || "(not filled in)",
        },

        ...(args.include_law ? { law_voice_md: (law.files ?? {})["voice.md"] ?? null } : {}),

        two_sources_that_may_disagree:
          "The law set (law:// resources) is for a person thinking about how he writes. The " +
          "library is what the gate enforces. Where they contradict each other on something that " +
          "matters, say so rather than picking one — that divergence is the most interesting " +
          "thing you could report.",

        next: "This says how to sound. It says nothing about what may be said: every factual " +
          "claim still traces to the idea bank entry, with no exception for anything here.",
      };
    },
  },

  {
    name: "compare_to_references",
    config: {
      title: "Which reference writer's shape this draft resembles",
      description:
        `Places a draft against the ${MEASURED} measured posts on the dimensions that separate the two ` +
        "structural modes: opening length, how much sits above the fold, paragraph count, list " +
        "use and sentence variation. Answers 'am I writing in the shape Josh's own rules point " +
        "at, or the one that would fight them?'. Structure only — no words are compared, because " +
        "none are held (8.3).",
      inputSchema: {
        body: z.string().min(1).describe("The draft to place"),
      },
    },

    async handler(args) {
      const { measurePost } = await import("../../scripts/lib/prose.mjs");
      const m = measurePost(args.body);

      // Distance on the four dimensions that actually separate the cut from the scene. Scaled by
      // each dimension's own spread so paragraph count does not drown out list rate.
      const dims = [
        ["opening_words_median", m.opening_words],
        ["above_fold_words_median", m.above_fold_words],
        ["paragraphs_median", m.paragraphs],
        ["sd_median", m.sentence_words_sd],
      ];

      const spread = {};
      for (const [key] of dims) {
        const values = (sentinels.report ?? []).map((r) => r[key]).filter((n) => typeof n === "number");
        spread[key] = Math.max(1, Math.max(...values) - Math.min(...values));
      }

      const scored = (sentinels.report ?? []).map((r) => {
        let distance = 0;
        for (const [key, mine] of dims) {
          if (typeof r[key] !== "number") continue;
          distance += Math.abs(r[key] - mine) / spread[key];
        }
        return {
          handle: r.handle,
          name: r.name,
          mode: SCENE.has(r.handle) ? "scene" : "cut",
          distance: +distance.toFixed(2),
        };
      }).sort((a, b) => a.distance - b.distance);

      const nearest = scored[0];

      return {
        yours: {
          words: m.words,
          opening_words: m.opening_words,
          above_fold_words: m.above_fold_words,
          paragraphs: m.paragraphs,
          uses_list: m.uses_list,
          sentence_words_sd: m.sentence_words_sd,
        },

        nearest,
        ranked: scored,

        reading: nearest.mode === "scene"
          ? `Closest to ${nearest.name}, who writes in the scene mode Josh's own rules point at. ` +
            `That is the right neighbourhood.`
          : `Closest to ${nearest.name}, who writes in the CUT mode — a very short opener with ` +
            `the substance below the fold. Josh's rules point at the scene: a five-element hook ` +
            `with stakes, a time and a person. This shape would fight them.`,

        caution: nearest.handle === "mattjbarker1"
          ? "And Matt Barker is where Josh's rules came from rather than a peer, so resembling " +
            "him is not evidence of Josh's voice. Be suspicious."
          : undefined,

        note: "Structure only. No words were compared with theirs, because none are held — the " +
          "derivation refuses to emit anything containing a run of their text (8.3).",
      };
    },
  },
];

/**
 * The reference measurements, as a TOOL rather than only a resource.
 *
 * sentinels://latest has existed since the resources were added, and a model cannot reach it. A
 * resource is something a PERSON browses and attaches; a tool is something a model decides to call.
 * So the measured shape of the writers Josh chose was visible to him and invisible to anything
 * doing the writing — which is the half that needed it.
 *
 * get_voice_brief and compare_to_references already expose fragments: four sd values, a ranked
 * distance. Neither returns the opening shapes, the close shapes, the above-fold lengths or the list
 * rates, which are the measurements that answer "how do these posts actually get in".
 */
/**
 * The posts themselves — what Josh asked for and could not get.
 *
 * He wrote: "I tried testing with Matt Barker and it returned nothing, and I can't get to the posts
 * through Claude Code." He was right to expect them. He chose these eight writers, he wants to study
 * how they build a post, and `get_sentinels` answered with medians.
 *
 * So this reads `reference_posts` (migration 0044) and hands back the text. What does NOT change is
 * the drafting path: `loadLibrary(db, "drafting")` and `"gate"` still receive measurements only, so a
 * draft is never written against another writer's sentences and the gate never judges against their
 * voice. That split is the whole protection now, and reference-split.test.ts holds it.
 */
export const referencePostTools = [
  {
    name: "get_reference_posts",
    config: {
      title: "Read the reference writers' actual posts",
      description:
        "The real posts by the eight writers Josh chose for their storytelling structure — Matt " +
        "Barker, Jen Allen-Knuth, Eric Nowoslawski, Julia Carter, Ryan Carlin, Curtis Howland, " +
        "Aman Ghataura, Adam Treboutat. Use it whenever he wants to SEE how one of them writes: " +
        "\"show me Matt Barker's recent posts\", \"how does he open\", \"what did he post about " +
        "distillation\". Read them to him, quote them to him, discuss them. " +
        "What must never happen is their words reaching a draft of his: borrow the shape, never the " +
        "sentence. A post of Josh's that could have been Matt's fails the only test that matters.",
      inputSchema: {
        handle: z.string().optional().describe(
          "One of: mattjbarker1, demandjen1, outboundphd, juliacarter98, ryanscarlin, " +
            "curtishowland, amangrowth, adam-treboutat. Omit for the newest across all of them.",
        ),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
        since: z.string().optional().describe("ISO date, e.g. 2026-09-01"),
        search: z.string().optional().describe("Only posts containing this text"),
      },
    },

    async handler(args, { db }) {
      const query = {
        select: "activity_id,handle,author_name,url,posted_at,text,words,paragraphs," +
          "above_fold_words,opening_shape,close_shape,uses_list,has_line_breaks," +
          "reaction_count,comment_count",
        order: "posted_at.desc",
        limit: String(args.limit ?? 10),
      };
      if (args.handle) query.handle = `eq.${args.handle}`;
      if (args.since) query.posted_at = `gte.${args.since}`;
      if (args.search) query.text = `ilike.*${args.search}*`;

      const posts = await db.select("reference_writer_posts", query);

      if (posts.length === 0) {
        const known = await db.select("reference_writer_posts", { select: "handle", limit: "500" });
        const have = [...new Set(known.map((k) => k.handle))].sort();
        return {
          posts: [],
          note: args.handle && !have.includes(args.handle)
            ? `Nothing stored for "${args.handle}". Stored: ${have.join(", ") || "none yet"}.`
            : "Nothing matched. Refresh with scripts/load-reference-posts.mjs after a scrape.",
        };
      }

      return {
        posts,
        how_to_use_these: {
          take: "The shape. How the first line earns the second, where the turn lands, what is held " +
            "back, how the close works. Say which post you are taking it from.",
          never: "Their words, their cadence, their phrasing — not quoted, not near-quoted, not " +
            "paraphrased into a draft. If a run of words from one of these could be recognised in " +
            "something of Josh's, it has been used wrongly.",
          matt_barker: "He is not a peer reference — he is where Josh's own rules came from. A draft " +
            "agreeing with him is not evidence of Josh's voice, and his cadence is the one most " +
            "likely to leak.",
          shape_caveat: "has_line_breaks false means the scrape returned the post as one line, so its " +
            "paragraph and above-fold figures are null rather than wrong. The words are intact.",
        },
      };
    },
  },

  {
    name: "analyse_reference_writer",
    config: {
      title: "How one reference writer builds a post",
      description:
        "A structural read of one writer from their stored posts: how long they run, how they open, " +
        "how they close, how often they use a list, how much sits above the fold, and how much they " +
        "vary sentence length. Use it when Josh asks what he should take from someone — especially " +
        "Matt Barker, whose frameworks he asked to lean most into. It also says what would break " +
        "Josh's own rules if copied, which is the part that matters.",
      inputSchema: { handle: z.string().describe("e.g. mattjbarker1") },
    },

    async handler(args, { db }) {
      const posts = await db.select("reference_writer_posts", {
        select: "posted_at,words,paragraphs,above_fold_words,opening_words,opening_shape," +
          "close_shape,uses_list,sentence_words_sd,has_line_breaks,reaction_count",
        handle: `eq.${args.handle}`,
        order: "posted_at.desc",
        limit: "200",
      });

      if (posts.length === 0) {
        return { handle: args.handle, note: `Nothing stored for "${args.handle}".` };
      }

      // Shape figures come only from posts that kept their line breaks. Averaging in a post that
      // arrived as one line would report the scraper as a habit of the writer.
      const shaped = posts.filter((p) => p.has_line_breaks);
      const med = (xs) => {
        const s = xs.filter((n) => typeof n === "number").sort((a, b) => a - b);
        if (s.length === 0) return null;
        const m = Math.floor(s.length / 2);
        return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(1);
      };
      const tally = (xs) =>
        Object.entries(xs.filter(Boolean).reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {}))
          .sort((a, b) => b[1] - a[1]);

      const dates = posts.map((p) => p.posted_at).filter(Boolean).sort();

      return {
        handle: args.handle,
        posts_read: posts.length,
        shape_basis: shaped.length,
        window: dates.length ? { from: dates[0].slice(0, 10), to: dates.at(-1).slice(0, 10) } : null,
        length: { median_words: med(posts.map((p) => p.words)) },
        rhythm: { median_sentence_sd: med(posts.map((p) => Number(p.sentence_words_sd))) },
        getting_in: {
          median_opening_words: med(shaped.map((p) => p.opening_words)),
          median_words_above_fold: med(shaped.map((p) => p.above_fold_words)),
          opening_shapes: tally(shaped.map((p) => p.opening_shape)),
        },
        getting_out: { close_shapes: tally(shaped.map((p) => p.close_shape)) },
        body: {
          median_paragraphs: med(shaped.map((p) => p.paragraphs)),
          list_rate: shaped.length
            ? +(shaped.filter((p) => p.uses_list).length / shaped.length).toFixed(2)
            : null,
        },
        next: "get_reference_posts with this handle to read them. Take the shape and name which post " +
          "it came from; never the words.",
        if_this_is_matt_barker: args.handle === "mattjbarker1"
          ? {
            transfers: [
              "Open on someone else's situation with their number in it — it anonymises, which " +
                "suits material Josh cannot name.",
              "Anchor the point to something mundane and specific: a weekday, an errand.",
              "One mechanism per post. List it only when the point IS a process.",
              "Name the audience once, in the middle, where a reader who stayed is deciding.",
            ],
            does_not_transfer: [
              "His turn renames the reader's problem — state it, deny it, substitute another. That " +
                "is the exact construction Josh's banned-phrases section forbids, and the most " +
                "recognisable AI cadence on LinkedIn.",
              "He closes on an ask in nearly every post. Josh's rule rations a direct ask to one in " +
                "five, and his buyer lurks.",
            ],
            why_careful: "He is where Josh's rules came from, not a peer. His cadence is the most " +
              "likely to leak, and a draft that agrees with him proves nothing about Josh's voice.",
          }
          : undefined,
      };
    },
  },
];

export const sentinelTools = [
  {
    name: "get_sentinels",
    config: {
      title: "The reference writers, measured",
      description:
        `Structural measurements of ${MEASURED} posts by the ${WRITERS} accounts Josh chose: median length, ` +
        "how much sits above the fold, opening and closing shapes, paragraph counts, list rate and " +
        "sentence-length variation. Use it to answer how a post should be SHAPED — where the turn " +
        "lands, how long the opening runs, whether a list belongs. " +
        "This tool returns MEASUREMENTS ONLY — no sentences. Use get_reference_posts when Josh " +
        "wants to read what they actually wrote. The split is deliberate: a drafting or gate brief " +
        "never contains another writer's words, because a gate that has read their posts starts " +
        "judging against their voice (8.3).",
      inputSchema: {
        group: z.enum(["scene", "cut", "all"]).optional().describe(
          "scene = the four whose structure matches Josh's own rules (prose, a scene before the " +
            "fold). cut = the three that do the opposite: very short openers, heavy lists, " +
            "everything below the fold. Default all.",
        ),
      },
    },

    async handler(args) {
      const group = args.group ?? "all";
      const rows = (sentinels.report ?? []).filter((r) =>
        group === "all" ? true : group === "scene" ? SCENE.has(r.handle) : !SCENE.has(r.handle)
      );

      return {
        measured_at: sentinels.measured_at ?? null,
        accounts: rows.length,
        posts: rows.reduce((n, r) => n + (r.posts_measured ?? 0), 0),
        writers: rows.map((r) => ({ ...r, group: SCENE.has(r.handle) ? "scene" : "cut" })),

        how_to_read_this: {
          structure_only:
            "8.3 — shapes, not sentences, in THIS tool. Nothing here may be quoted, near-quoted or " +
            "paraphrased into a draft: Josh's voice comes from the voice guide and nowhere else, " +
            "whatever he has read in the meantime. get_reference_posts returns the posts themselves " +
            "for him to study.",
          the_split:
            "The scene/cut split is a judgement recorded in the reference_posts library section, " +
            "not something the numbers decided. measure_draft compares rhythm against the scene " +
            "four only, because the other three are a different kind of post.",
          not_a_target:
            `A range is what ${sentinels.report.length} people who all work happen to do. Their ` +
            `medians run from ${RANGE.low} to ${RANGE.high} words and every one of them works, so ` +
            "there is no correct length to hit.",
          shape_basis:
            "Where a writer's row carries shape_basis, the opening, close, paragraph, above-fold " +
            "and list figures rest on that many of their posts rather than all of them: a scrape " +
            "that loses the line breaks cannot be read for shape, and those posts are left out " +
            "instead of being counted as one long paragraph.",
        },
      };
    },
  },
];
