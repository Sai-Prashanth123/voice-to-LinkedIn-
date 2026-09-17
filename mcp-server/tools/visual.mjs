/**
 * Visual tools — clause 10, done in Claude Code rather than by a cloud model.
 *
 * WHY THESE EXIST
 *
 * A rebuilt diagram is an SVG. Producing one is a task Claude Code does directly and well, and
 * `handlers/visual.ts` currently spends a cloud model on it — a model that, on the free tier this
 * project runs, is the cheapest one Google sells. Component test 10 wants five rebuilds and the
 * system has managed one.
 *
 * `get_visual_brief` hands over the same instructions the edge function uses, assembled from
 * VISUAL_SYSTEM and the live library. `create_visual` stores the result.
 *
 * THE VIEW IS NARROWER THAN THE DRAFTER'S, AND THAT IS DELIBERATE
 *
 * The visual view is core_rules, visual_brand and audience — three sections. It does NOT include
 * gate_rules, which is where Josh's "never name a client" rule lives, and `handlers/visual.ts`
 * contains no name screening of its own. The eight gate checks read a draft's body; nothing reads
 * `svg_body`.
 *
 * So a rebuilt diagram carrying a client's name straight out of the source image would pass every
 * check in the system. That gap is currently covered by the naming rule being written into the
 * `visual_brand` section itself, which is the one section this view does see — and this tool
 * repeats it in its own output rather than trusting that the section still says it.
 *
 * WHAT IT CANNOT DO
 *
 * Attach the visual to a post. `posts.visual_id` lives on `posts`, which this role may read and not
 * write. A rebuild sits in the bank until Josh's calendar path picks it up, which is 11.3 and stays
 * his.
 */

import { z } from "zod";
import { renderLibrary } from "../../supabase/functions/_shared/views.ts";
import { VISUAL_SYSTEM } from "../../supabase/functions/_shared/prompts.ts";

export const visualTools = [
  {
    name: "get_visual_brief",
    config: {
      title: "Get the brief for rebuilding a diagram",
      description:
        "The instructions for rebuilding an image Josh has seen into his own visual brand, as an " +
        "SVG. This is the same brief the system's own visual worker is given. You are taking the " +
        "IDEA and rebuilding it — not reproducing the original, and not producing something close " +
        "enough to be recognised as theirs. When done, call create_visual.",
      inputSchema: {
        moment_id: z.number().int().describe("The moment the image belongs to, from list_moments"),
      },
    },
    async handler(args, { db }) {
      const id = args.moment_id;

      const [moment] = await db.select("moments", {
        select: "id,title,killed,status,notes,audience,pillar",
        id: `eq.${id}`,
        limit: 1,
      });
      if (!moment) throw new Error(`No moment with id ${id}.`);
      if (moment.killed) {
        throw new Error(`Moment ${id} has been killed. Josh has declined it; do not rebuild for it.`);
      }

      const sections = await db.select("library_sections", {
        select: "key,title,body,sort_order",
        order: "sort_order.asc",
      });
      const { sections: visible, prompt } = renderLibrary(sections, "visual");

      // The images Josh actually sent for this moment. Without one there is nothing to rebuild
      // FROM, and a "rebuild" with no source is an invention.
      const images = await db.select("raw_inputs", {
        select: "id,kind,image_path,text_body,created_at",
        moment_id: `eq.${id}`,
        kind: "eq.image",
        order: "created_at.desc",
      });

      const existing = await db.select("visuals", {
        select: "id,version,taking,post_doing,created_at",
        moment_id: `eq.${id}`,
        order: "version.desc",
      });

      return {
        moment: { id: moment.id, name: moment.title ?? null, notes: moment.notes, audience: moment.audience },
        system: VISUAL_SYSTEM(prompt),
        source_images: images,
        existing_versions: existing,
        next_version: (existing[0]?.version ?? 0) + 1,
        brand_supplied: Boolean(visible.visual_brand),
        // Repeated here rather than relied upon. The visual view cannot see gate_rules and no gate
        // check reads an SVG, so this sentence is the only thing standing between a source image's
        // labels and a published picture naming a client.
        naming_rule:
          "Nothing identifying may appear anywhere in the image: not in a label, an axis, a legend, " +
          "a caption, a logo, a watermark, a URL, a chart title or a table row. No company name, " +
          "product name or person's name that is not cleared for this specific post. No client " +
          "logo. No dashboard chrome that identifies the tool it came from. If the diagram cannot " +
          "make its point without something identifying, produce NO image — that is a correct " +
          "outcome, not a failure.",
        awaiting_josh: Object.entries(visible).filter(([, body]) => !body).map(([key]) => key),
      };
    },
  },

  {
    name: "create_visual",
    config: {
      title: "Store a rebuilt diagram",
      description:
        "Save an SVG rebuilt from an image Josh sent. Call get_visual_brief first — it carries the " +
        "brand, the source images and the naming rule. This stores the visual against the moment " +
        "only; it does not attach it to a post, schedule anything or publish. Another attempt is a " +
        "new version rather than an edit (10.6).",
      inputSchema: {
        moment_id: z.number().int().describe("The moment this rebuild belongs to"),
        svg: z.string().min(40).describe("The complete self-contained SVG"),
        taking: z.enum(["idea", "structure", "look"])
          .describe("10.2 — what was taken from the original"),
        post_doing: z.string().optional()
          .describe("What the post is doing, in a line, so a later reader knows what this served"),
        source_path: z.string().optional()
          .describe("The stored path of the image being rebuilt, from get_visual_brief"),
      },
    },
    async handler(args, { db }) {
      const id = args.moment_id;

      const [moment] = await db.select("moments", { select: "id,killed", id: `eq.${id}`, limit: 1 });
      if (!moment) throw new Error(`No moment with id ${id}.`);
      if (moment.killed) throw new Error(`Moment ${id} has been killed; do not store a rebuild for it.`);

      const svg = args.svg.trim();

      // Checked here rather than left to the model's good intentions. The prompt asks for a
      // self-contained SVG; these are the ways one stops being self-contained, and every one of
      // them turns into a broken or a tracking image the day it is posted.
      if (!/^<svg[\s>]/i.test(svg)) throw new Error("That is not an SVG — it must start with <svg.");
      if (!/viewBox\s*=/.test(svg)) {
        throw new Error("The SVG has no viewBox, so it will not scale in a LinkedIn feed.");
      }
      const external = [
        [/<image\b[^>]*href\s*=\s*["']https?:/i, "an external image"],
        [/<script\b/i, "a script"],
        [/@import\b/i, "an imported stylesheet"],
        [/<link\b/i, "a linked stylesheet"],
        [/url\(\s*["']?https?:/i, "an external url()"],
      ];
      for (const [re, what] of external) {
        if (re.test(svg)) throw new Error(`The SVG references ${what}. It must be self-contained.`);
      }

      // 10.6 — another attempt is a new row. `unique (moment_id, version)` enforces it, so the
      // version is computed rather than accepted from the caller.
      const prior = await db.select("visuals", {
        select: "version",
        moment_id: `eq.${id}`,
        order: "version.desc",
        limit: 1,
      });
      const version = (prior[0]?.version ?? 0) + 1;

      const [row] = await db.insert("visuals", {
        moment_id: id,
        version,
        source_path: args.source_path ?? "mcp:no-source-recorded",
        taking: args.taking,
        post_doing: args.post_doing ?? null,
        svg_body: svg,
      });

      return {
        visual_id: row.id,
        moment_id: id,
        version,
        bytes: svg.length,
        note:
          "Stored against the moment. It is not attached to any post and nothing is scheduled — " +
          "posts.visual_id is Josh's to set (11.3). If it needs another go, call this again and it " +
          "becomes version " + (version + 1) + " rather than replacing this one.",
      };
    },
  },
];
