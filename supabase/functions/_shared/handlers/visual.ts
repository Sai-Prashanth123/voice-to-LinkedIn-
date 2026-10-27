/**
 * Job: `visual` — rebuild a diagram Josh sent, in his visual brand (clause 10).
 *
 * Generated as SVG rather than with an image model, deliberately:
 *   - text comes out exact, which diffusion models cannot reliably do
 *   - brand colours and type are exact rather than approximated
 *   - it is deterministic and re-editable, so 10.6 ("another version without starting again") is cheap
 *   - it is structurally incapable of resembling the source image, which is what 10.4 requires
 *
 * 10.7: not every post gets an image. Nothing here runs unless Josh sends one.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2";
import { callStructured, canSeeImages, MODELS, provider } from "../llm.ts";
import { getMaterial, logEvent, sourceEntry } from "../db.ts";
import { loadLibrary } from "../library.ts";
import { PROMPT_VERSION, VISUAL_SYSTEM } from "../prompts.ts";
import { VisualSchema } from "../schemas.ts";
import { notice } from "../notices.ts";
import type { Job } from "../types.ts";

let wasmReady: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(
    fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm"),
  );
  return wasmReady;
}

/*
 * FONTS, AND WHY A DIAGRAM WITHOUT THEM IS WORSE THAN NO DIAGRAM.
 *
 * resvg draws text by looking up a font. There are no system fonts in the edge runtime, so with
 * none supplied it renders every shape correctly and silently drops EVERY WORD — and returns a
 * valid PNG, so `rendered_path` is set and the tool reports success.
 *
 * Measured on 27 October: visual 7 on moment 111 came back `rendered: true`, 5,156 bytes, 1200x600,
 * and contained two coloured bars, a rule, and not one of its four labels. Nothing in the system
 * could have told anybody — `create_visual` said it worked, no event was logged, and there is no
 * way to look at a stored visual. The first reader would have been whoever saw it on LinkedIn.
 *
 * That is the defect class this repo is named for: a step that reports success and has no second
 * half. So two changes here. The font is loaded, and a render that could not load a font for an
 * image WITH TEXT IN IT is a failure rather than a wordless success.
 */
const FONT_URLS = [
  "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
  "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf",
];
const FONT_FAMILY = "DejaVu Sans";

let fontsReady: Promise<Uint8Array[]> | null = null;
function ensureFonts(): Promise<Uint8Array[]> {
  fontsReady ??= Promise.all(FONT_URLS.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font ${url} returned ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  })).catch((err) => {
    // Do not cache the failure: a cold start during a CDN blip would otherwise poison this
    // instance for its whole life, and every visual it rendered after that would lose its words.
    fontsReady = null;
    throw err;
  });
  return fontsReady;
}

/** Whether the image has anything to say. Only then is a missing font fatal. */
export function hasText(svg: string): boolean {
  return /<text[\s>]|<tspan[\s>]/i.test(svg);
}

export async function handleVisual(db: SupabaseClient, job: Job): Promise<void> {
  const momentId = Number(job.payload.moment_id);
  const sourcePath = String(job.payload.source_path);
  const taking = String(job.payload.taking ?? "idea") as "idea" | "structure" | "look";
  const postDoing = String(job.payload.post_doing ?? "");
  const feedback = String(job.payload.feedback ?? "");

  // 10.6 — "Josh must be able to ask for another version without starting again." So a rerun keeps
  // the reference and the intent, and is shown the previous attempt so it does not repeat it.
  const { data: last } = await db
    .from("visuals")
    .select("svg_body")
    .eq("moment_id", momentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = feedback ? last?.svg_body ?? null : null;

  const material = await getMaterial(db, momentId);
  const entry = sourceEntry(material);
  const library = await loadLibrary(db, "visual");

  // The rebuild NEEDS to see the image, and the OpenAI-compatible path cannot carry one — image
  // blocks are dropped in `toOpenAIMessages`. Left alone, the model is asked to rebuild a diagram it
  // was never shown, produces something that fails schema validation, and the job burns five retries
  // arriving at a conclusion that was knowable before the first one.
  //
  // Told plainly instead. The image is already stored, so nothing is lost: 10.6 lets him ask for
  // another version at any point, and this one runs the moment a vision-capable provider is set.
  if (!canSeeImages()) {
    await logEvent(db, "visual_unsupported_provider", "warn", {
      moment_id: momentId,
      provider: provider(),
      note: "image input is not carried on the OpenAI-compatible path; rebuild deferred",
    });
    // Recorded, not merely announced.
    //
    // The message below promises the rebuild will happen "as soon as that is switched over", and
    // for a while nothing kept that promise: the job was marked done and no state remembered the
    // image. `worker-select` sweeps this the moment a capable provider is configured.
    await db.from("moments").update({
      visual_pending: {
        source_path: sourcePath,
        taking,
        post_doing: postDoing,
        deferred_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }).eq("id", momentId);

    await notice(
      db,
      "visual_deferred",
      "I have kept your image, but I cannot rebuild it on the model provider currently configured " +
        "— it cannot see pictures. It is on the list, and I will rebuild it and tell you the moment " +
        "that changes. Nothing is lost.",
    );
    return;
  }

  const { data: file } = await db.storage.from("images").download(sourcePath);
  if (!file) throw new Error(`reference image ${sourcePath} not readable`);
  const b64 = base64(new Uint8Array(await file.arrayBuffer()));

  const result = await callStructured(VisualSchema, {
    model: MODELS.OPUS,
    system: VISUAL_SYSTEM(library.prompt),
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: file.type || "image/png", data: b64 },
        },
        {
          type: "text",
          text: `Josh is taking the ${taking.toUpperCase()} from this image.\n\n` +
            `What the post is doing: ${postDoing || "not stated"}\n\n` +
            `The moment it accompanies:\n${
              Object.entries(entry).map(([k, v]) => `${k}: ${v}`).join("\n") || "(none recorded)"
            }\n\n` +
            (previous
              ? `He has already seen a version and asked for another. Here is what he said: ` +
                `"${feedback}". Do something genuinely different — a different arrangement, not the ` +
                `same layout recoloured.\n\nYour previous SVG, for reference on what NOT to repeat:\n` +
                `${previous.slice(0, 4000)}\n\n`
              : "") +
            `Rebuild it in his brand. Take the idea, not the execution — the result must not be ` +
            `recognisable as the original.`,
        },
        // deno-lint-ignore no-explicit-any
      ] as any,
    }],
    effort: "high",
    maxTokens: 16000,
    purpose: "visual",
    momentId,
    promptVersion: PROMPT_VERSION,
  }, { db });

  const stored = await storeVisual(db, {
    momentId,
    svg: result.svg,
    sourcePath,
    taking,
    postDoing,
  });
  const version = stored.version;
  const png = stored.png;
  /* storeVisual is below — extracted so the MCP path reaches the SAME rasteriser. */

  // Done, so it is no longer waiting on anything. Left set, the sweep in `worker-select` would
  // rebuild this same image every four hours forever.
  await db.from("moments").update({ visual_pending: null }).eq("id", momentId);

  const caption = `${result.notes}\n\nSay "another" if you want a different take on it.`;
  /*
   * THE IMAGE IS STORED, NOT SENT.
   *
   * `sendPhoto` put the rebuilt picture in his chat, which is the one thing a notice cannot carry.
   * What matters for clause 11.3 is that `rendered_path` is written and the calendar entry points at
   * it — that happens above, and `worker-publish` reads it when the post goes out. So this says it
   * exists and where, and the session can open the file.
   */
  await notice(
    db,
    png ? "visual_ready" : "visual_not_rasterised",
    png
      ? `${caption}\n\nStored with the post. It goes out attached to it.`
      : `Rebuilt the image but could not rasterise it, so the post would publish without it. ${result.notes}`,
    { severity: png ? "info" : "warn", momentId, actedOn: ["list_calendar"] },
  );

  /*
   * 10.6 — another take, without demanding he ask for one.
   *
   * This armed a chat state so that his next message could be read as "do another". In a session
   * there is nothing to arm: he says "try again, take the look rather than the structure" and the
   * visual brief is fetched again. The state was the awkward half of a conversation the surface now
   * has for free.
   */
}

/**
 * Store an SVG, rasterise it, and attach it to the waiting post. ONE rasteriser, two callers.
 *
 * WHY THIS WAS EXTRACTED, 26 October
 *
 * There were two ways a visual could be created and only one of them produced something publishable.
 * `handleVisual` above generates an SVG from a source image and runs this whole sequence.
 * `create_visual` in the MCP server took an SVG the calling model had already written and inserted
 * the row directly — with no `rendered_path`, and without touching `posts.visual_id`.
 *
 * `worker-publish` attaches an image only when `rendered_path` is set. So every visual made the
 * second way could never reach a post, however good it was. Josh, 26 October: "Every visual so far
 * has been built outside the system." That is the reason why — the in-system path produced rows
 * nothing could publish.
 *
 * It could not be fixed on the MCP side either: `content_mcp` has insert-only rights on `visuals`
 * (migration 0031), so it cannot set `rendered_path` after the fact. Rasterising has to happen
 * server-side, which is what "write through cc-submit" means in CLAUDE.md.
 *
 * A failed raster keeps the SVG and says so. A lost generation is not recoverable; a missing PNG is.
 */
export async function storeVisual(
  db: SupabaseClient,
  opts: {
    momentId: number;
    svg: string;
    sourcePath: string;
    taking: string;
    postDoing?: string | null;
  },
): Promise<{
  visualId: number | null;
  version: number;
  renderedPath: string | null;
  png: Uint8Array<ArrayBuffer> | null;
  attachedToPost: number | null;
  renderError: string | null;
}> {
  const { momentId, svg, sourcePath, taking, postDoing } = opts;
  const version = await nextVersion(db, momentId);

  const svgPath = `${momentId}/v${version}.svg`;
  await db.storage.from("renders").upload(svgPath, new Blob([svg], { type: "image/svg+xml" }), {
    upsert: true,
  });

  let renderedPath: string | null = null;
  let png: Uint8Array<ArrayBuffer> | null = null;
  let renderError: string | null = null;
  try {
    await ensureWasm();

    /*
     * A missing font is fatal for an image with words in it, and harmless for one without. Judged
     * rather than assumed, because refusing a purely geometric diagram over a CDN blip would be
     * the opposite mistake. See the note on ensureFonts.
     */
    let fontBuffers: Uint8Array[] = [];
    try {
      fontBuffers = await ensureFonts();
    } catch (fontErr) {
      if (hasText(svg)) {
        throw new Error(
          `the fonts could not be loaded (${fontErr}), and this image has text in it. Rendering ` +
            `it now would produce the shapes with every word missing, and report success. Kept ` +
            `the SVG; no PNG was stored.`,
        );
      }
    }

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: { fontBuffers, defaultFontFamily: FONT_FAMILY, loadSystemFonts: false },
    });
    // Copied into a fresh Uint8Array: resvg returns one backed by ArrayBufferLike, which neither
    // Blob nor a fetch body will accept.
    const rendered = new Uint8Array(resvg.render().asPng());
    png = rendered;
    renderedPath = `${momentId}/v${version}.png`;
    await db.storage.from("renders").upload(
      renderedPath,
      new Blob([rendered], { type: "image/png" }),
      { upsert: true },
    );
  } catch (err) {
    // Keep the SVG. A failed raster is recoverable; a lost generation is not.
    renderError = String(err);
    await logEvent(db, "visual_render_failed", "warn", { moment_id: momentId, error: renderError });
  }

  await db.from("visuals").insert({
    moment_id: momentId,
    version,
    source_path: sourcePath,
    taking,
    post_doing: postDoing || null,
    svg_body: svg,
    rendered_path: renderedPath,
  });

  const { data: visual } = await db
    .from("visuals")
    .select("id")
    .eq("moment_id", momentId)
    .eq("version", version)
    .single();

  // 10.5 — attach to the calendar entry alongside the post, where one exists.
  const { data: post } = await db
    .from("posts")
    .select("id")
    .eq("moment_id", momentId)
    .in("status", ["draft", "ready"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  let attachedToPost: number | null = null;
  if (post && visual) {
    await db.from("posts").update({ visual_id: visual.id }).eq("id", post.id);
    attachedToPost = post.id;
  }

  return {
    visualId: visual?.id ?? null,
    version,
    renderedPath,
    png,
    attachedToPost,
    renderError,
  };
}

async function nextVersion(db: SupabaseClient, momentId: number): Promise<number> {
  const { data } = await db
    .from("visuals")
    .select("version")
    .eq("moment_id", momentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version ?? 0) + 1;
}

function base64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
