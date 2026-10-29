/**
 * Storage for the local stack: the subset of Supabase Storage that this system actually calls.
 *
 * Split out of stack.mjs so it can be tested without booting Postgres. The multipart handling is
 * the part worth testing and the part that was wrong twice — see unwrap().
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * WHY THIS IS HERE AT ALL
 *
 * Added 29 October, when the visual skills went in. The gateway served `/rest/v1` and
 * `/functions/v1/cc-submit`, which is everything the drafting path touches — so the clone looked
 * complete and was, for words.
 *
 * Images are not words. `storeVisual` uploads the SVG and the rendered PNG to a bucket
 * (`db.storage.from("renders").upload(...)`), which is `/storage/v1`, which this gateway did not
 * serve. So in a clone `create_visual` reached cc-submit, rendered correctly, and then 404ed on the
 * upload — every visual skill failing at the last step, on the one surface where the failure is
 * hardest to read, because the model had already done the work.
 *
 * This is the subset supabase-js actually calls, and no more: upload, download, remove. Objects go
 * under local/storage/<bucket>/<path> so they survive a restart and can be opened with any image
 * viewer — which is more than the hosted project offers, where looking at a stored visual means
 * going and fetching it.
 */


export function storagePath(pathname, STORAGE) {
  // /storage/v1/object/[sign|public|]/<bucket>/<key...>
  const rest = pathname.slice("/storage/v1/object".length).replace(/^\/(public|sign)\//, "/");
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return null;
  // Keep the key's shape, and refuse anything that climbs out of the bucket.
  if (parts.some((p) => p === "..")) return null;
  return { bucket: parts[0], key: parts.slice(1).join("/"), file: join(STORAGE, ...parts) };
}

const CONTENT_TYPES = {
  png: "image/png",
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  json: "application/json",
};


/*
 * supabase-js posts an upload as multipart/form-data, so the request body is the file wrapped in a
 * boundary and a header block. Writing the body straight to disk stores the envelope with it: the
 * first test of this shim round-tripped a PNG 258 bytes larger than it went in, and an image that
 * is almost right is worse than one that is missing, because it opens.
 *
 * One part is all this ever carries, so this finds the blank line that ends the part's headers and
 * takes everything up to the closing boundary.
 */
export function unwrap(body, contentType) {
  const m = /^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  if (!m) return body;

  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);

  /*
   * There is more than one part. supabase-js sends `cacheControl` first and the file second, so
   * taking the first part stores the string "3600" under the key and calls it a PNG — which is
   * what the first version of this did, and the round-trip test is the only reason anyone knows.
   * The file is the part whose headers carry a filename.
   */
  for (let at = body.indexOf(boundary); at >= 0;) {
    const headerEnd = body.indexOf("\r\n\r\n", at);
    if (headerEnd < 0) break;

    const headers = body.subarray(at, headerEnd).toString("latin1");
    const from = headerEnd + 4;
    const next = body.indexOf(boundary, from);
    if (/filename=/i.test(headers)) {
      // Drop the CRLF that belongs to the boundary rather than to the file.
      return body.subarray(from, next < 0 ? body.length : Math.max(from, next - 2));
    }
    if (next < 0) break;
    at = next;
  }
  return body;
}

export async function serveStorage(req, res, url, STORAGE) {
  const loc = storagePath(url.pathname, STORAGE);
  if (!loc) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({
      statusCode: "400",
      error: "invalid_path",
      message: "storage path needs a bucket and a key, and may not climb out of the bucket",
    }));
    return;
  }

  const readBody = () =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });

  try {
    if (req.method === "POST" || req.method === "PUT") {
      mkdirSync(dirname(loc.file), { recursive: true });
      writeFileSync(loc.file, unwrap(await readBody(), req.headers["content-type"]));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Key: `${loc.bucket}/${loc.key}`, path: loc.key }));
      console.log(`storage    wrote ${loc.bucket}/${loc.key}`);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (!existsSync(loc.file)) {
        // The shape supabase-js expects, so `error` is set rather than `data` being empty.
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }));
        return;
      }
      const ext = loc.key.split(".").pop().toLowerCase();
      res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
      res.end(req.method === "HEAD" ? undefined : readFileSync(loc.file));
      return;
    }

    if (req.method === "DELETE") {
      if (existsSync(loc.file)) rmSync(loc.file);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ name: loc.key }]));
      return;
    }

    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `${req.method} is not served by the local storage shim` }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `local storage failed: ${err.message}` }));
  }
}
