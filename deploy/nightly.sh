#!/usr/bin/env bash
# Tonight's battle with model generals, then the Doctrine Ladder, → pushed to branch battle/<id> for review. Merge to main to publish.
# Exit 2 means a provider went down mid-battle and the answers so far are saved; systemd reruns this and it resumes.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main && git checkout -q main && git merge -q --ff-only origin/main
# resume an unfinished battle first, else start today's (IST date)
ID=""
for d in client/public/replay/daily-*/; do [ -f "$d/answers.json" ] && [ ! -f "$d/end.json" ] && ID=$(basename "$d") && break; done 2>/dev/null || true
ID=${ID:-daily-$(TZ=Asia/Kolkata date +%F)}
node --env-file=.env engine/run.ts --models --rotate "$(( $(date -u +%s) / 86400 ))" --id "$ID" --seed "$(printf %s "$ID" | cksum | cut -d' ' -f1)"
# then tonight's Doctrine Ladder on the local model (exit 2 = model server down; entries stay queued for the next run)
node --env-file=.env engine/ladder.ts || [ $? -eq 2 ]
# voice every finished battle that has no audio yet (Kokoro-82M on the CPU; a voice failure never blocks the battle)
npm ci --no-audit --no-fund --silent || true
for d in client/public/replay/daily-* client/public/replay/ladder-*; do
  [ -f "$d/end.json" ] && [ ! -f "$d/audio.json" ] && { node tools/voice.ts "$(basename "$d")" || echo "voice failed for $d"; }
done
git checkout -q -B "battle/$ID"
git add "client/public/replay/$ID" client/public/replay/index.json
git add client/public/replay/ladder-* client/public/replay/ladder.json 2>/dev/null || true
git commit -qm "battle $ID"
git push -q -f origin "battle/$ID"
git checkout -q main
echo "pushed battle/$ID"
