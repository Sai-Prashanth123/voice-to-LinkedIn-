# The local-first stack

Running this system on Josh's machine with no Supabase project.

```
cd local && npm install

# Download PostgREST (once). Official Windows build, v16.5:
#   https://github.com/PostgREST/postgrest/releases  ->  bin/postgrest.exe

node stack.mjs     # Postgres + PostgREST + a Supabase-shaped gateway on :54321
node probe.mjs     # throwaway cluster, asserts the schema and the guarantees
```

`stack.mjs` writes `.env.local` with a `SUPABASE_URL` and a `CONTENT_MCP_KEY`. Point the MCP
server at those two values and **nothing else changes** — that is the test it was built to pass.

## Proven so far

**The schema and the guarantees** (`probe.mjs`): 54 of 54 migrations on real Postgres, all five
roles, all four of the clause-11.2 CHECK constraints, zero destructive grants, and DELETE **refused
by execution** for `content_mcp`, `service_role`, `authenticated` and `anon`.

**The client needs no changes** (`stack.mjs`): `mcp-server/db.mjs`, untouched, against the local
stack —

```
ping:   {"reachable":true,"granted":true}
select: library_sections, with order/limit/select projection   -> rows
rpc:    joshs_notes with named args                            -> ok
insert into moments:  REFUSED — Not permitted: permission denied for table moments
```

That last line is the one that mattered. The role boundary is enforced by the real PostgREST doing
the real `set role`, not by anything reimplemented — so every `revoke` and every policy in
`supabase/migrations/` means locally exactly what it means on Supabase.

## A correction, and the most important thing found here

The first version of the probe reported *"DELETE refused for every role"* and that was true — but
**partly for the wrong reason, and the wrong reason looked identical to the right one.**

`supabase/tests/shim.sql` creates `anon`, `authenticated` and `service_role` and grants them to
`authenticator`. It grants them **no table privileges at all**. On a real Supabase project the
platform grants those roles the public schema *before any migration runs*, and this repo's
migrations are written against that: `0006_security.sql:61` REVOKES delete from them, which only
means something if they had it.

So locally the revokes were no-ops, the roles ended up with nothing, and every DELETE was refused
because nothing had ever been granted. The guarantee appeared to hold while not being tested at
all.

Nothing noticed, because the e2e harness connects as the superuser and only ever asserts the
refusal. The first thing to actually exercise it was `cc-submit`, which could not insert a moment
as `service_role` — a failure that only shows up once something tries to do real work.

`schema.mjs` now applies Supabase's baseline grants before the migrations, so the refusal
afterwards is a real test. **"Refused because the revoke worked" and "refused because the grant
never happened" are different facts, and only one of them is the guarantee.**

Worth carrying back to `eval/`: the same gap is in the e2e harness, so its grant assertions are
weaker than they read.

## Stopping it

`stack.mjs` stops everything on SIGINT, and **Ctrl-C in its own terminal is the only thing that
delivers that.** Kill the node process any other way on Windows and the handler never runs:
Postgres is orphaned, holding its port and data directory, and becomes un-killable even by
`taskkill /F /T` once anything starts removing that directory underneath it. A reboot is then the
only remedy.

```
node stop.mjs              # asks the postmaster to stop, which works where force does not
node stop.mjs pgdata2      # or a named cluster
```

Everything is overridable, so a wedged cluster never blocks you:

```
LOCAL_PG_DATA=pgdata2 LOCAL_PG_PORT=54339 LOCAL_PGRST_PORT=54340 \
LOCAL_GATEWAY_PORT=54341 LOCAL_CC_PORT=54342 node stack.mjs
```

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
