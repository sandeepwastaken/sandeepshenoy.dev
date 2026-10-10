#!/usr/bin/env bash
# Refresh attempts.json from the game's .apx, then commit + push.
# Usage: ./update.sh   (from anywhere; it resolves its own paths)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

echo "→ parsing .apx"
python3 "$HERE/parse_apx.py"

cd "$REPO_ROOT"

# Only touch the tidalwave data files — don't sweep up other WIP in the repo.
PATHS=(projects/tidalwave/attempts.json)
# Include the .apx copy only if it's already tracked (keeps commits lean if you
# later gitignore it).
if git ls-files --error-unmatch projects/tidalwave/86407629_attempts.apx >/dev/null 2>&1; then
  PATHS+=(projects/tidalwave/86407629_attempts.apx)
fi

if git diff --quiet -- "${PATHS[@]}" && git diff --cached --quiet -- "${PATHS[@]}"; then
  echo "→ no changes, nothing to push"
  exit 0
fi

# Pull stats for the commit message
read -r COUNT PB BEST_SERIAL < <(python3 -c "
import json
d = json.load(open('projects/tidalwave/attempts.json'))
atts = d['attempts']
best = max(atts, key=lambda a: a['endPercent'])
print(d['attemptCount'], round(best['endPercent'], 2), best['serial'])
")

MSG="tidalwave: ${COUNT} attempts, PB ${PB}% (#${BEST_SERIAL})"

git add -- "${PATHS[@]}"
git commit -m "$MSG"
git push

echo
echo "✓ pushed: $MSG"
