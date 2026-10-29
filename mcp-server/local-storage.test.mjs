/**
 * The local stack has to hold an image, or the visual skills do not work in a clone.
 *
 * WHY THIS FILE EXISTS
 *
 * The gateway served `/rest/v1` and `/functions/v1/cc-submit`, which is everything the drafting
 * path touches. So a clone looked complete — and was, for words. `storeVisual` uploads the SVG and
 * the rendered PNG to a bucket, which is `/storage/v1`, which nothing served. In a clone
 * `create_visual` reached cc-submit, rendered the image correctly, and then 404ed on the upload:
 * every visual skill failing at the last step, after the model had already done the work.
 *
 * The multipart handling is the part worth pinning. supabase-js posts an upload as
 * `multipart/form-data`, and it sends TWO parts — `cacheControl` first, the file second. The first
 * version of this wrote the whole request body to disk, which stored the boundary and the headers
 * along with the image: a PNG came back 258 bytes larger than it went in. The second version took
 * the first part, which stored the four bytes "3600" and called it a PNG.
 *
 * Both of those produce a file. Neither produces an error. An image that is almost right is worse
 * than one that is missing, because it opens.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { unwrap, storagePath } from "../local/storage.mjs";

/** A real body, in the shape undici actually sends it. */
function multipart(file, boundary = "----formdata-undici-097527052658") {
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="cacheControl"\r\n\r\n` +
    `3600\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name=""; filename="blob"\r\n` +
    `Content-Type: image/png\r\n\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

test("an uploaded file round-trips byte for byte", () => {
  // Bytes that look like a PNG header, including a CRLF, which is what makes naive trimming wrong.
  const file = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 0x0d, 0x0a, 9]);
  const { body, contentType } = multipart(file);

  const out = unwrap(body, contentType);
  assert.deepEqual(
    [...out],
    [...file],
    "the stored bytes must be the file and nothing else — not the boundary, not the part headers, " +
      "and not a trailing CRLF that belongs to the boundary",
  );
});

test("the file part is taken, not the first part", () => {
  const file = Buffer.from("PNGDATA-0123456789");
  const { body, contentType } = multipart(file);

  const out = unwrap(body, contentType).toString();
  assert.notEqual(out, "3600", 'this is supabase-js\'s cacheControl part, not the image');
  assert.equal(out, "PNGDATA-0123456789");
});

test("a body that is not multipart is stored as it arrived", () => {
  const raw = Buffer.from("<svg viewBox=\"0 0 1 1\"/>");
  assert.equal(unwrap(raw, "image/svg+xml").toString(), raw.toString());
  assert.equal(unwrap(raw, undefined).toString(), raw.toString());
});

test("a quoted boundary is handled, because the header may carry one", () => {
  const file = Buffer.from("abc");
  const b = "sep=with;semicolon";
  const head =
    `--${b}\r\nContent-Disposition: form-data; name=""; filename="blob"\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${b}--\r\n`)]);
  assert.equal(unwrap(body, `multipart/form-data; boundary="${b}"`).toString(), "abc");
});

test("a key is resolved under its bucket", () => {
  const loc = storagePath("/storage/v1/object/renders/114/v1.png", "/root");
  assert.equal(loc.bucket, "renders");
  assert.equal(loc.key, "114/v1.png");
});

test("a key cannot climb out of the bucket", () => {
  for (const p of [
    "/storage/v1/object/renders/../../../etc/passwd",
    "/storage/v1/object/renders/%2e%2e/%2e%2e/secrets",
  ]) {
    assert.equal(
      storagePath(p, "/root"),
      null,
      `${p} must be refused: the storage root is inside the repo, and the key comes off the wire`,
    );
  }
});

test("a path with no key is refused rather than writing the bucket itself", () => {
  assert.equal(storagePath("/storage/v1/object/renders", "/root"), null);
});
