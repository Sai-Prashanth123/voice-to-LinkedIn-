/**
 * Adding to an idea that already exists — EXECUTED, not read.
 *
 * WHY THIS FILE EXISTS
 *
 * `resembles-wired.test.mjs` asserts that the new route is wired: that the tool is registered, that
 * `continue_instead` survives both reply branches, that `write_post` passes `redo` on. Those are
 * source assertions, and source assertions are how this repository has repeatedly shipped a value
 * nothing reads: the text said the right thing and the code did something else.
 *
 * So this runs the function. The client is a stub because what is being tested is WHICH writes
 * happen and which refusals come back — and because clause 6.3 means a row filed in Josh's bank by
 * a test could never be removed, so the real project is not an option and never will be.
 *
 * The precedent is `gate-ending.test.ts`, which drives `finishGate` the same way for the same
 * reason.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendMaterial } from "./handlers/material.ts";

type Row = Record<string, unknown>;

/**
 * Enough of a client for this path, and it RECORDS rather than applies.
 *
 * `from("moments").select(...).eq(...).maybeSingle()` answers with the moment under test;
 * `from("raw_inputs").insert(...)` and `from("system_events").insert(...)` are recorded; the
 * counting read answers with a number. Anything this path does that the stub does not model shows
 * up as an exception rather than as a pass, which is the point.
 */
function stub(
  moment: Row | null,
  opts: { readError?: string; insertError?: string; count?: number } = {},
) {
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; row: Row }[] = [];

  const db = {
    from(table: string) {
      return {
        select(_cols?: string, _o?: Row) {
          return {
            eq(_c: string, _v: unknown) {
              return {
                maybeSingle() {
                  if (opts.readError) {
                    return Promise.resolve({ data: null, error: { message: opts.readError } });
                  }
                  return Promise.resolve({ data: moment, error: null });
                },
                // The head/count read resolves directly, with no maybeSingle().
                then(
                  res: (v: { count: number | null; error: null }) => unknown,
                ) {
                  return Promise.resolve(res({ count: opts.count ?? 1, error: null }));
                },
              };
            },
          };
        },
        insert(row: Row) {
          inserts.push({ table, row });
          if (opts.insertError && table === "raw_inputs") {
            return Promise.resolve({ error: { message: opts.insertError } });
          }
          return Promise.resolve({ error: null });
        },
        update(row: Row) {
          updates.push({ table, row });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;

  return { db, inserts, updates };
}

const LIVE = { id: 158, ref: "M-000158", status: "drafted", killed: false, title: "TAM SAM SOM" };

test("his new words are added as material, and no idea is created", async () => {
  const { db, inserts } = stub(LIVE, { count: 3 });
  const out = await appendMaterial(db, 158, "Actually, make it about timing.");

  assert.equal(out.status, 200);
  assert.equal(out.body.appended, true);
  assert.equal(out.body.moment_id, 158);

  // THE WHOLE POINT: one row, in raw_inputs, on the idea that already existed.
  const material = inserts.filter((i) => i.table === "raw_inputs");
  assert.equal(material.length, 1, "his words were not stored");
  assert.equal(material[0].row.moment_id, 158, "they went onto the wrong idea");
  assert.equal(material[0].row.text_body, "Actually, make it about timing.");

  // And nothing was inserted into moments. A route that creates an idea while claiming to continue
  // one is the defect it exists to fix, reproduced.
  assert.equal(
    inserts.filter((i) => i.table === "moments").length,
    0,
    "appending created a moment — this is the exact defect this route removes",
  );
});

test("his words are stored untidied, including the whitespace he typed", async () => {
  // Every claim in the finished post is checked span by span against this text. Trimming the ends
  // is all that may happen to it; anything more becomes a fabrication two steps later.
  const { db, inserts } = stub(LIVE);
  await appendMaterial(db, 158, "  it's about  WHO is in pain   \n\n right now  ");
  assert.equal(
    inserts.find((i) => i.table === "raw_inputs")?.row.text_body,
    "it's about  WHO is in pain   \n\n right now",
  );
});

test("it says how much he has now said, not merely that it worked", async () => {
  // "it was added" and "this is the fourth thing he has said about this" are different facts.
  const { db } = stub(LIVE, { count: 4 });
  const out = await appendMaterial(db, 158, "and another thing");
  assert.equal(out.body.inputs_now, 4);
});

test("an already-written idea is told to re-extract, because that is what it needs", async () => {
  // submit_extraction refuses a written-up moment unless `redo: true` is passed, and the one-step
  // path never passed it. A reply that did not say so would leave the caller stuck at a 409.
  const { db } = stub({ ...LIVE, status: "drafted" });
  const out = await appendMaterial(db, 158, "scrap that");
  assert.match(String(out.body.next), /redo: true/);
  assert.match(String(out.body.next), /Do not call start_post/);
});

test("an idea still at captured is not told to redo, because it has nothing to redo", async () => {
  const { db } = stub({ ...LIVE, status: "captured" });
  const out = await appendMaterial(db, 158, "one more thing");
  assert.ok(!/redo/.test(String(out.body.next)), "a never-extracted idea was told to redo");
  assert.match(String(out.body.next), /eighteen fields/);
});

test("it is logged, or a session that did the right thing leaves no trace of it", async () => {
  const { db, inserts } = stub(LIVE, { count: 2 });
  await appendMaterial(db, 158, "more");
  const event = inserts.find((i) => i.table === "system_events");
  assert.ok(event, "appending was not logged");
  assert.equal(event.row.kind, "moment_material_appended");
  // The count travels with it, so the record is usable later without re-reading the table.
  assert.equal((event.row.detail as Row).inputs_now, 2);
});

test("a killed idea is refused, in reopen_idea's own words", async () => {
  const { db, inserts } = stub({ ...LIVE, killed: true });
  const out = await appendMaterial(db, 158, "more");
  assert.equal(out.status, 409);
  assert.match(String(out.body.error), /killed rather than parked/);
  assert.equal(inserts.filter((i) => i.table === "raw_inputs").length, 0, "it wrote anyway");
});

test("a published idea is refused — its material is the record of what went out", async () => {
  // worker-publish builds the retelling index from it. Rewriting it would change the basis of
  // something already public.
  const { db, inserts } = stub({ ...LIVE, status: "published" });
  const out = await appendMaterial(db, 158, "more");
  assert.equal(out.status, 409);
  assert.match(String(out.body.error), /already published/);
  assert.equal(inserts.filter((i) => i.table === "raw_inputs").length, 0, "it wrote anyway");
});

test("a parked idea is refused and told to reopen, rather than quietly revived", async () => {
  // Parking carries a reason somebody wrote. Appending must not take that decision back by
  // side effect — the same stance clause 12.10 takes about the library one level up.
  const { db, inserts } = stub({ ...LIVE, status: "parked", title: "SaaS bubble" });
  const out = await appendMaterial(db, 158, "more");
  assert.equal(out.status, 409);
  assert.match(String(out.body.error), /parked/);
  assert.match(String(out.body.error), /reopen_idea/);
  assert.match(String(out.body.next ?? ""), /reopen_idea/);
  // And it names the idea, because an id is not something he can recognise.
  assert.match(String(out.body.error), /SaaS bubble/);
  assert.equal(inserts.filter((i) => i.table === "raw_inputs").length, 0, "it wrote anyway");
});

test("an idea that does not exist is a 404, not a new idea", async () => {
  const { db, inserts } = stub(null);
  const out = await appendMaterial(db, 9999, "more");
  assert.equal(out.status, 404);
  assert.equal(inserts.length, 0);
});

test("empty text and a nonsense id are refused before anything is read", async () => {
  const { db, inserts } = stub(LIVE);
  assert.equal((await appendMaterial(db, 158, "   ")).status, 400);
  assert.equal((await appendMaterial(db, 0, "real words")).status, 400);
  assert.equal((await appendMaterial(db, -4, "real words")).status, 400);
  assert.equal((await appendMaterial(db, 1.5, "real words")).status, 400);
  assert.equal(inserts.length, 0, "a refused call still wrote something");
});

test("a failed read and a failed insert both say so instead of reporting success", async () => {
  // The defect this repository keeps finding, in its simplest form: an error path that returns a
  // shape indistinguishable from success.
  const read = stub(LIVE, { readError: "connection reset" });
  const readOut = await appendMaterial(read.db, 158, "more");
  assert.equal(readOut.status, 500);
  assert.ok(!readOut.body.ok, "a failed read reported ok");

  const write = stub(LIVE, { insertError: "permission denied for table raw_inputs" });
  const writeOut = await appendMaterial(write.db, 158, "more");
  assert.equal(writeOut.status, 500);
  assert.ok(!writeOut.body.ok, "a failed insert reported ok");
  assert.match(String(writeOut.body.error), /permission denied/);
  // And it must not have logged a success event for a write that did not land.
  assert.equal(
    write.inserts.filter((i) => i.table === "system_events").length,
    0,
    "a failed append was logged as an append",
  );
});
