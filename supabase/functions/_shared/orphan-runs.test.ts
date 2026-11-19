/**
 * The scan for a worker run that started and never finished.
 *
 * The fixture is the real one: `creator_poll_started` at 07:00:07 on 19 November with no terminal
 * event after it, beside the 06:00 corpus run that died on its budget and the 06:29 retry that
 * reported properly. All three were in `system_events` when this was written.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { fakeDb } from "./fake-db.ts";
import {
  GRACE_MS,
  NOT_A_WORKER_RUN,
  reportVanishedRuns,
  RUN_FAMILIES,
  VANISHED_KIND,
} from "./orphan-runs.ts";

const NOW = Date.parse("2026-11-19T08:00:00.000Z");
const at = (iso: string) => iso;

interface Ev {
  id?: number;
  kind: string;
  severity?: string;
  created_at?: string;
  detail?: Record<string, unknown>;
}

/** `fakeDb` returns `any` on purpose; this is where the shape is reasserted for reading. */
// deno-lint-ignore no-explicit-any
const events = (db: any): Ev[] => (db.tables.system_events ?? []) as Ev[];

/** The three runs of 19 November, as they actually landed. */
function theRealMorning() {
  return [
    { id: 7582, kind: "corpus_started", severity: "info", created_at: at("2026-11-19T06:00:08.569Z") },
    { id: 7583, kind: "corpus_failed", severity: "error", created_at: at("2026-11-19T06:01:58.720Z") },
    { id: 7587, kind: "corpus_started", severity: "info", created_at: at("2026-11-19T06:29:46.611Z") },
    { id: 7588, kind: "corpus_failed", severity: "error", created_at: at("2026-11-19T06:29:59.542Z") },
    {
      id: 7589,
      kind: "creator_poll_started",
      severity: "info",
      created_at: at("2026-11-19T07:00:07.097Z"),
    },
  ];
}

test("the 07:00 poll that reported nothing is reported", async () => {
  const db = fakeDb({ system_events: theRealMorning() });

  const filed = await reportVanishedRuns(db, NOW);

  assert.equal(filed, 1, "exactly the creator poll vanished; both corpus runs reported");

  const vanished = events(db).filter((r) => r.kind === VANISHED_KIND);
  assert.equal(vanished.length, 1);
  assert.equal(vanished[0].severity, "error", "it must be an error, or worker-ops will not carry it");
  assert.equal(vanished[0].detail?.started_kind, "creator_poll_started");
  assert.equal(vanished[0].detail?.started_event_id, 7589);
});

test("a run that failed properly is NOT reported as vanished", async () => {
  /*
   * The distinction the whole module turns on. `corpus_failed` is bad news that arrived; this scan
   * is only for news that never arrived. Reporting both would double-count every failure and teach
   * him to ignore the channel.
   */
  const db = fakeDb({ system_events: theRealMorning() });
  await reportVanishedRuns(db, NOW);

  const vanished = events(db).filter((r) => r.kind === VANISHED_KIND);
  assert.ok(
    vanished.every((v) => v.detail?.started_kind !== "corpus_started"),
    "a corpus run with corpus_failed beside it reached its end",
  );
});

test("a later run's finish does not close an earlier run's silence", async () => {
  /*
   * Two starts, one terminal, and it belongs to the second. Without the next-start boundary the
   * first would be silently absolved — which is the same shape as the check with nothing to check.
   */
  const db = fakeDb({
    system_events: [
      { id: 1, kind: "corpus_started", severity: "info", created_at: at("2026-11-19T06:00:00.000Z") },
      { id: 2, kind: "corpus_started", severity: "info", created_at: at("2026-11-19T06:30:00.000Z") },
      { id: 3, kind: "corpus_refreshed", severity: "info", created_at: at("2026-11-19T06:31:00.000Z") },
    ],
  });

  const filed = await reportVanishedRuns(db, NOW);
  assert.equal(filed, 1);
  assert.equal(
    events(db).find((r) => r.kind === VANISHED_KIND)?.detail?.started_event_id,
    1,
  );
});

test("any terminal of the family closes a start, including the warn-level one", async () => {
  const db = fakeDb({
    system_events: [
      {
        id: 1,
        kind: "creator_poll_started",
        severity: "info",
        created_at: at("2026-11-18T15:35:08.058Z"),
      },
      {
        id: 2,
        kind: "creator_poll_backend_failed",
        severity: "warn",
        created_at: at("2026-11-18T15:35:19.717Z"),
      },
    ],
  });

  assert.equal(await reportVanishedRuns(db, NOW), 0);
});

test("a run still inside its grace period is left alone", async () => {
  /*
   * A run in flight has not vanished, it is running. Flagging one would make every scheduled run
   * that overlaps the ops worker a false alarm.
   */
  const db = fakeDb({
    system_events: [
      {
        id: 1,
        kind: "creator_poll_started",
        severity: "info",
        created_at: new Date(NOW - GRACE_MS + 60_000).toISOString(),
      },
    ],
  });

  assert.equal(await reportVanishedRuns(db, NOW), 0);
});

test("the same disappearance is reported once, not once per ops run", async () => {
  const db = fakeDb({ system_events: theRealMorning() });

  assert.equal(await reportVanishedRuns(db, NOW), 1);
  assert.equal(await reportVanishedRuns(db, NOW), 0, "the second scan must add nothing");
  assert.equal(await reportVanishedRuns(db, NOW), 0);

  assert.equal(events(db).filter((r) => r.kind === VANISHED_KIND).length, 1);
});

test("a failed read says so instead of reporting all clear", async () => {
  /*
   * The fault this repository keeps finding: an absence that gets read as good news. A scan that
   * could not look must not answer "nothing vanished".
   */
  const db = fakeDb();
  db.from = () => ({
    select: () => ({
      in: () => ({
        gte: () => ({
          lte: () => ({
            order: () => Promise.resolve({ data: null, error: { message: "upstream exploded" } }),
          }),
        }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      (db.tables.system_events ??= []).push(row);
      return Promise.resolve({ data: [row], error: null });
    },
  });

  assert.equal(await reportVanishedRuns(db, NOW), 0);

  const said = events(db).find((r) => r.kind === "vanished_run_scan_unavailable");
  assert.ok(said, "the scan must report that it could not run");
  assert.match(String(said?.detail?.means), /UNKNOWN/);
});

test("every *_started kind a function files is classified", () => {
  /*
   * The guard that would otherwise only know the kinds that existed when it was written. A new
   * worker filing a new start event gets a row in RUN_FAMILIES, or an explicit line in
   * NOT_A_WORKER_RUN saying why it has no end — and this fails until one of the two happens.
   */
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        const src = Deno.readTextFileSync(path);
        for (const m of src.matchAll(/"([a-z][a-z_]*_started)"/g)) found.add(m[1]);
      }
    }
  };
  // A file: URL percent-encodes the space in "Voice to content" and keeps a leading slash before
  // the drive letter. Both have to come off or readDirSync looks for a path that does not exist.
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname)
    .replace(/^\/([A-Za-z]:)/, "$1");
  walk(root);

  assert.ok(found.size > 0, "the walk found no start events at all, so it is testing nothing");

  for (const kind of found) {
    assert.ok(
      kind in RUN_FAMILIES || kind in NOT_A_WORKER_RUN,
      `"${kind}" is filed by a function and is in neither RUN_FAMILIES nor NOT_A_WORKER_RUN`,
    );
  }
});

test("every family names at least one terminal, and none is shared between families", () => {
  const seen = new Map<string, string>();
  for (const [start, terminals] of Object.entries(RUN_FAMILIES)) {
    assert.ok(terminals.length > 0, `${start} has no terminal event, so it can never be closed`);
    for (const t of terminals) {
      assert.ok(
        !seen.has(t),
        `"${t}" closes both ${seen.get(t)} and ${start}; one run would absolve the other`,
      );
      seen.set(t, start);
    }
  }
});
