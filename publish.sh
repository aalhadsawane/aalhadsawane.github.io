#!/usr/bin/env bash
# Rebuild the blog from the vault and push it live.
#   ./publish.sh            build + commit + push
#   ./publish.sh --dry-run  build only (open docs/index.html to preview)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci --silent
node build.mjs
[ "${1:-}" = "--dry-run" ] && exit 0
git add -A docs
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git commit -q -m "Publish $(date '+%Y-%m-%d %H:%M')"
git push -q
echo "Pushed. Live in ~1 min at https://aalhadsawane.github.io/"
