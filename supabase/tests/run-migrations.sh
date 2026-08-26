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

CONTAINER=v2c-pg
IMAGE=pgvector/pgvector:pg17
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "==> recreating $CONTAINER"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw -p 55432:5432 "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done

psql_run() { docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

echo "==> shim"
psql_run < "$ROOT/supabase/tests/shim.sql"

echo "==> migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  # pg_cron and pg_net are Supabase-provided; the shim supplies their surface instead.
  sed -e '/create extension if not exists pg_cron/d' \
      -e '/create extension if not exists pg_net/d' "$f" | psql_run >/dev/null
  echo "    ok  $name"
done

if [ -f "$ROOT/supabase/tests/assertions.sql" ]; then
  echo "==> assertions"
  psql_run -f - < "$ROOT/supabase/tests/assertions.sql"
fi

echo "==> PASS"
