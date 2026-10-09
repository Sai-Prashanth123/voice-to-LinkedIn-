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

  const version = await nextVersion(db, momentId);
  const svgPath = `${momentId}/v${version}.svg`;
  await db.storage.from("renders").upload(svgPath, new Blob([result.svg], { type: "image/svg+xml" }), {
    upsert: true,
  });

  let renderedPath: string | null = null;
  let png: Uint8Array<ArrayBuffer> | null = null;
  try {
    await ensureWasm();
    const resvg = new Resvg(result.svg, { fitTo: { mode: "width", value: 1200 } });
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
    await logEvent(db, "visual_render_failed", "warn", { moment_id: momentId, error: String(err) });
  }

  await db.from("visuals").insert({
    moment_id: momentId,
    version,
    source_path: sourcePath,
    taking,
    post_doing: postDoing || null,
    svg_body: result.svg,
    rendered_path: renderedPath,
  });

  // 10.5 — attach to the calendar entry alongside the post, where one exists.
  const { data: post } = await db
    .from("posts")
    .select("id")
    .eq("moment_id", momentId)
    .in("status", ["draft", "ready"])
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (post) {
    const { data: visual } = await db
      .from("visuals")
      .select("id")
      .eq("moment_id", momentId)
      .eq("version", version)
      .single();
    if (visual) await db.from("posts").update({ visual_id: visual.id }).eq("id", post.id);
  }

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
