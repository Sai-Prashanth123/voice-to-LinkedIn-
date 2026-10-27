# The local-first stack

Stage 1 of running this system on Josh's machine with no Supabase project. This directory holds
only the probe so far — the thing that answers *"can a plain Postgres hold this schema, and do the
guarantees survive?"* — not the stack itself.

```
cd local && npm install
node probe.mjs
```

It boots real Postgres, applies every migration, and asserts the guarantees. Nothing persists:
`persistent: false`, and `pgdata/` is thrown away.

## What it proves today

```
migrations: 54 of 54 applied
roles present: anon, authenticated, authenticator, content_mcp, service_role
posts CHECK constraints: posts_published_requires_josh, posts_ready_precedes_publish,
                         posts_ready_requires_josh, posts_scheduled_requires_josh
destructive grants to app roles: 0
  delete as content_mcp    REFUSED  permission denied for table moments
  delete as service_role   REFUSED  permission denied for table moments
  delete as authenticated  REFUSED  permission denied for table moments
  delete as anon           REFUSED  permission denied for table moments
```

The last four lines are the point. *"Nothing in the idea bank is ever deleted"* is twenty `revoke
delete` statements written against the four Supabase role names, and a local build that connects as
the table owner has DELETE inherently and loses all of it with **no error message**. So the probe
does not read the grant catalogue and call it proven — it tries the delete and requires a refusal.

The four CHECK constraints are the other half: *"nothing publishes without Josh"* (clause 11.2)
lives in the schema, not in code, and ports unchanged.

## Three things found while getting here, all of which shape the rest

**1. The cluster must be initialised as UTF8.** On Windows `initdb` takes the system locale —
WIN1252 — and every migration whose comment banner contains a box-drawing character (`─`, U+2500)
fails with *"has no equivalent in encoding WIN1252"*. That kills `0028`, so `content_mcp` is never
created, so nine later migrations fail too: 24 failures from one locale default. Hence
`initdbFlags: ["--encoding=UTF8", "--locale=C"]`, and it is not optional.

**2. The extension transforms must work on statements, not lines.** `eval/e2e/pglite.mjs` strips
the pgvector and `hnsw` statements before applying each migration, and a first attempt here did it
line by line. `create index ... using hnsw (...)` spans two lines, so the filter removed the second
and left the first dangling — migration 0005 failed and cascaded into 24 more. Everything now runs
to the semicolon.

Worth carrying back: `pglite.mjs:65` shells out to the `sed` binary for this, which only resolves
on Windows because Git ships one. The transforms here are plain JavaScript and need nothing.

**3. There is no pgvector, and only a beta is published.** `embedded-postgres` is at
`18.4.0-beta.17` — the only version — and ships stock Postgres with no pgvector. So the vector
columns fall back to the same substitute `eval/` uses: a domain over `float8[]`, with **no index
and no dimension enforcement** (`supabase/tests/pgvector-substitute.sql:20-23`).

That is a real cost, not a detail. `moment_embeddings` and `published_archive` carry
`vector(1024)` and `vector(1536)`, and the dedup and selection paths query them. Without an index
those queries go linear; without dimension enforcement a 4-element array is accepted into a
1024-dimension column. `@boomship/postgres-vector-embedded` bundles pgvector and pg_trgm and is the
obvious candidate, but it is version 0.3.1 from a small publisher, which is a supply-chain decision
for a client handover rather than a technical one.

**Shipping a beta Postgres and a third-party pgvector build to a client is the open question in
this plan**, and it should be answered before Stage 3 rather than discovered at Stage 5.

## What this does NOT prove

The schema is the easy half. Still untouched, and in rough order of difficulty:

- **PostgREST.** `mcp-server/db.mjs` speaks raw PostgREST over HTTP — filter grammar, `Prefer`
  headers, `payload->>key` parameter names, the `{message, details, hint, code}` error envelope, and
  the `42501` distinction. The plan runs the real binary rather than reimplementing any of it.
- **`cc-submit`.** 32 routes, and every write in the system goes through it.
- **The workers**, which are driven by `pg_cron` + `pg_net` — neither of which exists here.
- **Storage.** Three buckets; only `renders` has a live writer and reader.
- **Secrets**, which are in Vault today and have no local equivalent.

The full plan, including what is deliberately being given up, is in the plan file for this work.
