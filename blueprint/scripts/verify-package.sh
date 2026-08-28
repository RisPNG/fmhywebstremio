#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ -d "$ROOT/webstreamrmbg-blueprint" ]; then
  echo "error: stale nested webstreamrmbg-blueprint tree found" >&2
  exit 1
fi

echo "package structure checks passed"
