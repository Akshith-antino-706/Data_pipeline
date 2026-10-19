#!/usr/bin/env bash
# Builds a scratch copy of the frontend so `next dev` for the e2e run writes its own .next
# there and never touches frontend/.next (the developer's running dev server uses it).
# Then starts next dev on port 5199 from the copy.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${E2E_APP_DIR:-/private/tmp/claude-502/-Users-avinashkumar-Desktop-Data-pipeline/a32d8e86-9eda-4538-b9c4-9abd6257bbab/scratchpad/e2e-app}"

mkdir -p "$DEST"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude test-results --exclude playwright-report \
  --exclude e2e --exclude tests --exclude tsconfig.tsbuildinfo \
  "$SRC/" "$DEST/"
ln -sfn "$SRC/node_modules" "$DEST/node_modules"

cd "$DEST"
exec "$SRC/node_modules/.bin/next" dev -p 5199
