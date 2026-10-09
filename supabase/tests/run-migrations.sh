#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres and fails loudly on the first error.
#
#   ./supabase/tests/run-migrations.sh
#
# Uses pgvector/pgvector:pg17 plus supabase/tests/shim.sql, which stands in for the Supabase-managed
# objects (auth, storage, vault, pg_net, pg_cron). Verifies the schema applies cleanly from scratch;
# assertions about behaviour live in assertions.sql.

set -euo pipefail
export MSYS_NO_PATHCONV=1

# Overridable so eval/e2e can stand up its own database from this same recipe rather than keeping
# a second copy of it. A second copy would drift from this one, and the drift would be in the
# migration order or the readiness check — the two things here that were hard to get right.
CONTAINER="${CONTAINER:-v2c-pg}"
PGPORT_HOST="${PGPORT_HOST:-55432}"
IMAGE=pgvector/pgvector:pg17
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> recreating $CONTAINER"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw -p "$PGPORT_HOST":5432 "$IMAGE" >/dev/null

# pg_isready answers "ready" while the server is still coming up, so the shim could land on a
# database that then refused it: "FATAL: the database system is starting up". Seen for real. The
# only honest readiness check is a query that succeeds.
ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "!! $CONTAINER never accepted a connection" >&2
  exit 1
fi

psql_run() { docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

echo "==> shim"
psql_run < "$ROOT/supabase/tests/shim.sql"

echo "==> migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  # pg_cron and pg_net are Supabase-provided; the shim supplies their surface instead. The patterns
  # live in managed-extensions.sed because the CI workflow needs the same ones, and when they were
  # inline here CI diverged and failed on every push for three days.
  sed -f "$ROOT/supabase/tests/managed-extensions.sed" "$f" | psql_run >/dev/null
  echo "    ok  $name"
done

if [ -f "$ROOT/supabase/tests/assertions.sql" ]; then
  echo "==> assertions"
  psql_run -f - < "$ROOT/supabase/tests/assertions.sql"
fi

echo "==> PASS"
