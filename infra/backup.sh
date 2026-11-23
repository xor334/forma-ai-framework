#!/usr/bin/env bash
set -euo pipefail
umask 077
# Run on the VPS from its project checkout. The destination can be an off-host mount.
dest=${1:?Specify a new backup directory}
mkdir "${dest}"
compose=(docker compose --env-file .env -f infra/compose.yaml)
"${compose[@]}" exec -T db pg_dump -U postgres -d forma -Fc > "$dest/database.dump"
# Media keys are immutable. Copy after the DB snapshot to include every referenced key.
"${compose[@]}" run --rm -T --no-deps provision node --import tsx scripts/archive-media.ts export > "$dest/media.ndjson"
git bundle create "$dest/source.bundle" --all
(cd "$dest" && sha256sum database.dump media.ndjson source.bundle > SHA256SUMS)
