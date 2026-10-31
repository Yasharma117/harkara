#!/usr/bin/env bash
# Tonight's battle with model generals → pushed to branch battle/<id> for review. Merge to main to publish.
# Exit 2 means a provider went down mid-battle and the answers so far are saved; systemd reruns this and it resumes.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main && git checkout -q main && git merge -q --ff-only origin/main
# resume an unfinished battle first, else start today's (IST date)
ID=""
for d in client/public/replay/daily-*/; do [ -f "$d/answers.json" ] && [ ! -f "$d/end.json" ] && ID=$(basename "$d") && break; done 2>/dev/null || true
ID=${ID:-daily-$(TZ=Asia/Kolkata date +%F)}
node --env-file=.env engine/run.ts --models --id "$ID" --seed "$(printf %s "$ID" | cksum | cut -d' ' -f1)"
git checkout -q -B "battle/$ID"
git add "client/public/replay/$ID" client/public/replay/index.json
git commit -qm "battle $ID"
git push -q -f origin "battle/$ID"
git checkout -q main
echo "pushed battle/$ID"
