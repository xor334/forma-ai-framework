#!/usr/bin/env bash
set -euo pipefail
# Run on a disposable build runner with read access to this repository.
ref=${1:?Specify a Git revision}
tag=${2:?Specify a local image name and tag}
sha=$(git rev-parse --verify --end-of-options "$ref^{commit}")
git archive --format=tar "$sha" | docker build --label "org.opencontainers.image.revision=$sha" --build-arg "FORMA_BUILD_COMMIT=$sha" -t "$tag" -f infra/Dockerfile -
docker image inspect --format '{{.Id}}' "$tag"
