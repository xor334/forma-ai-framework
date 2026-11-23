#!/usr/bin/env bash
set -euo pipefail
backup=${1:?Specify the backup directory}
(cd "$backup" && sha256sum -c SHA256SUMS)
compose=(docker compose --env-file .env -f infra/compose.yaml)
# Bootstrap a fresh installation and its service roles. Restore into a separate empty database.
"${compose[@]}" up -d db objects
ready=false
for attempt in {1..60}; do
  if "${compose[@]}" exec -T db pg_isready -q -U postgres -d forma; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
table_count=$("${compose[@]}" exec -T db psql -U postgres -d forma -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")
if [[ "$table_count" != 0 ]]; then echo "Restore requires an empty target database" >&2; exit 2; fi
"${compose[@]}" run --rm -T provision
"${compose[@]}" exec -T db createdb -U postgres forma_restored
"${compose[@]}" exec -T db pg_restore -U postgres -d forma_restored --exit-on-error --single-transaction < "$backup/database.dump"
"${compose[@]}" run --rm -T --no-deps provision node --import tsx scripts/archive-media.ts import < "$backup/media.ndjson"
# Swap names in a transaction, keeping the fresh bootstrap database available.
"${compose[@]}" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "BEGIN; ALTER DATABASE forma RENAME TO forma_bootstrap; ALTER DATABASE forma_restored RENAME TO forma; COMMIT;"
echo 'Restore completed. Start the services and verify the last release and lead.'
