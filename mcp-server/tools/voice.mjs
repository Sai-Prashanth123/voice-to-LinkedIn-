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
 *   the sentinel measurements   — 59 real posts, which is where a rhythm target actually comes
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
const SCENE = new Set(["demandjen1", "juliacarter98", "outboundphd", "mattjbarker1"]);

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
            source: "59 measured posts by the seven writers he chose",
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
          length: "Their medians run 53 to 408 words and all of it works. No target length goes " +
            "near a draft.",
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
        "Places a draft against the 59 measured posts on the dimensions that separate the two " +
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
 * So the measured shape of the seven writers Josh chose was visible to him and invisible to anything
 * doing the writing — which is the half that needed it.
 *
 * get_voice_brief and compare_to_references already expose fragments: four sd values, a ranked
 * distance. Neither returns the opening shapes, the close shapes, the above-fold lengths or the list
 * rates, which are the measurements that answer "how do these posts actually get in".
 */
export const sentinelTools = [
  {
    name: "get_sentinels",
    config: {
      title: "The reference writers, measured",
      description:
        "Structural measurements of 59 posts by the seven accounts Josh chose: median length, " +
        "how much sits above the fold, opening and closing shapes, paragraph counts, list rate and " +
        "sentence-length variation. Use it to answer how a post should be SHAPED — where the turn " +
        "lands, how long the opening runs, whether a list belongs. " +
        "THEIR WORDS ARE NOT HERE and never will be (8.3): the derivation refuses to emit anything " +
        "containing a run of the source text, so a draft cannot quote what this system does not " +
        "hold. Structure only.",
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
            "8.3 — shapes, never sentences. Nothing here may be quoted, near-quoted or paraphrased " +
            "into a draft. Josh's voice comes from the voice guide and nowhere else.",
          the_split:
            "The scene/cut split is a judgement recorded in the reference_posts library section, " +
            "not something the numbers decided. measure_draft compares rhythm against the scene " +
            "four only, because the other three are a different kind of post.",
          not_a_target:
            "A range is what seven people who all work happen to do. Their medians run from 53 to " +
            "408 words and every one of them works, so there is no correct length to hit.",
        },
      };
    },
  },
];
