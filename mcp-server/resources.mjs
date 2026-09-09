/**
 * Three things a client can read without calling a tool.
 *
 * WHY RESOURCES AND NOT MORE TOOLS
 *
 * A tool is something a model decides to invoke. A resource is something a PERSON can browse,
 * attach and read — it appears in the client's own UI, before any reasoning happens. The library is
 * exactly that shape: fourteen sections Josh maintains, which somebody may simply want to look at.
 *
 * The voiceprint is here for a sharper reason. It lives in data/josh/law/voiceprint.json and until
 * now was readable only by the local josh-voice skill — so a client drafting through the connector
 * on claude.ai could not see the measured fingerprint of how he writes. That was the largest gap
 * between what the local surface knew and what the remote one did.
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isSupplied } from "../supabase/functions/_shared/views.ts";
import { sourceEntry } from "../supabase/functions/_shared/entry.ts";
import voiceprint from "../data/josh/law/voiceprint.json" with { type: "json" };
import sentinels from "../data/josh/sentinels/latest.json" with { type: "json" };
// The five markdown law files, bundled as JSON by build-law.mjs in the same run that writes them.
// Markdown has no import attribute, and only imported modules reach the Edge Function bundle.
import law from "../data/josh/law/law.json" with { type: "json" };

/** One line each, so a listing says what a file is for rather than only what it is called. */
const LAW_DESCRIPTIONS = {
  "identity.md": "Who he is, who he sells to, and what he will not claim",
  "voice.md": "How he builds a thought — from speech, never from the archive (8a)",
  "receipts.md": "His real numbers and scars, behind a do-not-say list of every client name",
  "content-plan.md": "The three structures, the backlog and the pillar rotation",
  "quality-bar.md": "The eight gate checks and the mechanical bans, as a writer would read them",
  "voiceprint.md": "The measured fingerprint, in prose. The numbers are in voiceprint://josh",
};

const json = (uri, value) => ({
  contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
});

const markdown = (uri, body) => ({
  contents: [{ uri, mimeType: "text/markdown", text: body }],
});

export function resourcesFor(context) {
  const { db } = context;

  return [
    {
      name: "library-section",
      // A template WITH a list callback, so all fourteen appear in resources/list rather than only
      // being readable by somebody who already knows the key.
      uri: new ResourceTemplate("library://{key}", {
        list: async () => {
          const rows = await db.select("library_sections", {
            select: "key,title,body,sort_order",
            order: "sort_order.asc",
          });
          return {
            resources: rows.map((r) => ({
              uri: `library://${r.key}`,
              name: r.title ?? r.key,
              // isSupplied, not body.length — seven sections contain prose addressed to Josh
              // explaining what he should put there, and a length test calls those filled in.
              description: isSupplied(r.body)
                ? `${r.title ?? r.key} — filled in`
                : `${r.title ?? r.key} — still a placeholder awaiting Josh`,
              mimeType: "text/markdown",
            })),
          };
        },
      }),
      config: {
        title: "A reference library section",
        description:
          "One of the fourteen sections that decide how a post is written. Editing one in the desk " +
          "reaches the very next draft with no deploy, so what is here is what the drafter is " +
          "using right now.",
        mimeType: "text/markdown",
      },
      async read(uri, variables) {
        const key = String(variables.key);
        const [row] = await db.select("library_sections", {
          select: "key,title,body",
          key: `eq.${key}`,
          limit: 1,
        });
        if (!row) throw new Error(`No library section "${key}".`);

        return markdown(
          uri.href,
          isSupplied(row.body)
            ? row.body
            : `# ${row.title ?? key}\n\nThis section is still a placeholder awaiting Josh. The ` +
              `drafter is told it is an explicit gap rather than being handed the placeholder ` +
              `text as though it were the standard.`,
        );
      },
    },

    {
      name: "moment",
      // list: undefined — the bank runs to dozens and listing it is list_moments' job, with its
      // filters and its search. The key must still be present; the SDK insists on it so that
      // listing is never forgotten by accident.
      uri: new ResourceTemplate("moment://{id}", { list: undefined }),
      config: {
        title: "One moment from the idea bank",
        description:
          "The captured moment, whatever the interview mined from it, and the names that have not " +
          "been cleared for use. This is everything a draft is allowed to claim from.",
        mimeType: "application/json",
      },
      async read(uri, variables) {
        const id = Number(variables.id);
        if (!Number.isInteger(id)) throw new Error(`"${variables.id}" is not a moment id.`);

        const [moment] = await db.select("moments", { select: "*", id: `eq.${id}`, limit: 1 });
        if (!moment) throw new Error(`No moment with id ${id}.`);

        const [material] = await db.select("material", {
          select: "*",
          moment_id: `eq.${id}`,
          limit: 1,
        });
        const names = await db.select("moment_names", {
          select: "name,kind,cleared",
          moment_id: `eq.${id}`,
        });

        const real = names.filter((n) => n.kind !== "not_a_name");

        return json(uri.href, {
          moment: {
            id: moment.id,
            ref: moment.ref,
            status: moment.status,
            source: moment.source,
            pillar: moment.pillar,
            audience: moment.audience,
            strength: moment.strength,
            killed: moment.killed,
            parked_reason: moment.parked_reason,
          },
          // sourceEntry, not the raw row: it is the exact set of fields a drafter may see (9.1),
          // and widening it here would widen it for everything downstream.
          material: sourceEntry(material),
          must_not_name: real.filter((n) => !n.cleared).map((n) => n.name),
          cleared_names: real.filter((n) => n.cleared).map((n) => n.name),
        });
      },
    },

    {
      name: "law",
      // Listed, because the whole point is that somebody can find these without being told they
      // exist. Six short files, 18 KB in total — cheap to offer and expensive to be missing.
      uri: new ResourceTemplate("law://{file}", {
        list: async () => ({
          resources: Object.keys(law.files ?? {}).map((name) => ({
            uri: `law://${name.replace(/\.md$/, "")}`,
            name,
            description: LAW_DESCRIPTIONS[name] ?? name,
            mimeType: "text/markdown",
          })),
        }),
      }),
      config: {
        title: "Josh's law set",
        description:
          "How he sounds and what he writes about, written for a person to read: identity, voice, " +
          "receipts, content plan, quality bar. These are the human half of the standard. The " +
          "library is the half the gate enforces, and the two are allowed to disagree — where " +
          "they do, say so rather than picking one.",
        mimeType: "text/markdown",
      },
      async read(uri, variables) {
        const asked = String(variables.file).replace(/\.md$/, "");
        const key = `${asked}.md`;
        const body = (law.files ?? {})[key];
        if (!body) {
          throw new Error(
            `No law file "${asked}". Available: ${
              Object.keys(law.files ?? {}).map((n) => n.replace(/\.md$/, "")).join(", ")
            }.`,
          );
        }
        return markdown(uri.href, body);
      },
    },

    {
      name: "sentinels",
      uri: "sentinels://latest",
      config: {
        title: "The reference writers, measured",
        description:
          "Structural measurements of 59 posts across seven accounts Josh chose: median length, " +
          "opening length, paragraphs, list rate, opening and closing shapes, sentence-length " +
          "variation. THEIR WORDS ARE NOT HERE and never will be (8.3) — the derivation refuses " +
          "to emit anything containing a run of the source text, so a draft cannot quote what " +
          "this system does not hold.",
        mimeType: "application/json",
      },
      async read(uri) {
        return json(uri.href, {
          ...sentinels,
          how_to_read_this: {
            structure_only: "Borrow how they get in, what they hold back, where the turn lands. " +
              "Never their words, cadence or phrasing.",
            two_modes: "The cut — very short opener, little above the fold, heavy lists. The " +
              "scene — a longer opening giving real information before the reader commits. " +
              "Josh writes in the second, so the scene writers are the useful reference and the " +
              "cut writers are a contrast that would fight his own rules if borrowed.",
            scene_writers: ["demandjen1", "juliacarter98", "outboundphd", "mattjbarker1"],
            one_caution: "Matt Barker is not a peer reference — he is where Josh's rules came " +
              "from. His cadence is the single most likely to leak, because the system is " +
              "already aligned to his thinking.",
          },
        });
      },
    },

    {
      name: "voiceprint",
      uri: "voiceprint://josh",
      config: {
        title: "How Josh writes, measured",
        description:
          "The computed fingerprint: rhythm, register, surface habits, the terms he uses far more " +
          "than the reference writers and the ones he avoids. Read the warning it carries — the " +
          "corpus is speech, and the rhythm figures do not transfer to writing.",
        mimeType: "application/json",
      },
      async read(uri) {
        return json(uri.href, {
          ...voiceprint,
          // Repeated at the top level because it is the single most misreadable thing in the file,
          // and a client that attaches this as context may never scroll to the header.
          how_to_read_this: {
            corpus: "Six recorded calls. This is how he TALKS.",
            transfers: "The lexicon — signature terms and the peer words he avoids — and the " +
              "surface habits, especially em dashes at zero across 11,022 words.",
            does_not_transfer: "The rhythm figures. Spoken sentences run shorter and hedge more " +
              "than written ones for everybody. For a target, compare against the sentinel " +
              "measurements instead, which are 59 real posts.",
            sentinel_sd_by_account: Object.fromEntries(
              (sentinels.report ?? []).map((r) => [r.handle, r.sd_median]),
            ),
          },
        });
      },
    },
  ];
}
