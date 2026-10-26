#!/usr/bin/env bash
# Rebuild the blog from the vault and push it live.
#   ./publish.sh            build + commit + push
#   ./publish.sh --dry-run  build only (open docs/index.html to preview)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci --silent
# the RSS registry (feed-state.json) is only updated when really publishing, never on a dry run
if [ "${1:-}" = "--dry-run" ]; then node build.mjs; exit 0; fi
PERSIST_FEED=1 node build.mjs
git add -A   # docs plus any source changes (build.mjs, theme, profile.md)
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git commit -q -m "Publish $(date '+%Y-%m-%d %H:%M')"
git push -q
echo "Pushed. Live in ~1 min at https://aalhadsawane.github.io/"
