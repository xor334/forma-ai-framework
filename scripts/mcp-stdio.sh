#!/bin/sh
# Run a locally available MCP server with stdin/stdout attached to the caller.
set -eu
if [ "$#" -ne 1 ]; then
  echo 'Pass one local immutable Docker image ID (sha256:...).' >&2
  exit 2
fi
case "$1" in sha256:*) digest=${1#sha256:} ;; *) exit 2 ;; esac
case "$digest" in ''|*[!a-f0-9]*) exit 2 ;; esac
[ "${#digest}" = 64 ] || exit 2
exec docker run --rm -i --pull=never --network=none --read-only --cap-drop=ALL \
  --security-opt=no-new-privileges --user=65532:65532 --pids-limit=64 \
  --memory=128m --cpus=1 --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m "$1"
