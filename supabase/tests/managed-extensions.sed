# Extensions Supabase provides and a plain Postgres does not.
#
# Applied to every migration before it reaches a throwaway database. The shim supplies the SURFACE
# of both — the cron.job table, cron.schedule(), net.http_post() — so everything downstream of them
# applies and can be asserted against. Only the `create extension` call itself has to go, because
# the binary is not in the pgvector image and `if not exists` does not help: the extension is absent,
# so Postgres tries to create it and fails on migration 0001, four tables into a 45-file schema.
#
# ONE COPY, DELIBERATELY. This file exists because there were two.
#
# run-migrations.sh carried these two patterns inline and the CI workflow did not, so the same
# migrations passed locally and failed on every push from 6 October onward. The script's own comment
# predicted it, about a different second copy: "A second copy would drift from this one, and the
# drift would be in the migration order or the readiness check." It was neither. It was this.
#
# Anything added here must be something Supabase manages AND the shim stands in for. An extension
# deleted from a migration but left here would silently stop being checked.

/create extension if not exists pg_cron/d
/create extension if not exists pg_net/d
