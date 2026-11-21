#!/usr/bin/env bash
# The nightly on GitHub Actions (free for a public repo; replaces the Oracle box and deploy/nightly.sh):
#   1. today's battle with the model generals (skipped if no model key is set)
#   2. the War Council: queued entries from the Cloudflare API, fought on the local model (llama-server on LOCAL_LLM_URL)
#   3. everything pushed to battle/<id> for review (merge to publish), then the played entries are marked on the API
# Env: GROQ_API_KEY / NVIDIA_API_KEY / OPENROUTER_API_KEY (any), LADDER_API + LADDER_TOKEN, LADDER_BATTLES (2), PUSH (1)
# A step that fails doesn't stop the others; the script exits 1 at the end so the run shows red and GitHub emails you.
set -uo pipefail
cd "$(dirname "$0")/.."
ID=${ID:-daily-$(TZ=Asia/Kolkata date +%F)}
status=0
# exit 2 = a model provider went down mid-battle; the answers so far are saved, so a rerun resumes
retry() { local c; for t in 1 2 3; do "$@"; c=$?; [ $c -ne 2 ] && return $c; echo "::warning::provider down, retrying in 10 min ($t/3)"; sleep 600; done; return 2; }

if [ -f "client/public/replay/$ID/end.json" ]; then echo "$ID already fought"
elif [ -n "${GROQ_API_KEY:-}${NVIDIA_API_KEY:-}${OPENROUTER_API_KEY:-}" ]; then
  retry node engine/run.ts --models --rotate "$(( $(date -u +%s) / 86400 ))" --id "$ID" --seed "$(printf %s "$ID" | cksum | cut -d' ' -f1)" || { echo "::error::daily battle failed"; status=1; }
else echo "::notice::no model keys set (GROQ_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY): skipping the daily battle"; fi

if [ -n "${LADDER_API:-}" ] && [ -n "${LADDER_TOKEN:-}" ]; then
  mkdir -p data/ladder
  if curl -fsS --retry 3 --retry-all-errors -H "authorization: Bearer $LADDER_TOKEN" "$LADDER_API/api/queue" -o data/ladder/queue.json; then
    node -e 'const fs=require("fs");const q=JSON.parse(fs.readFileSync("data/ladder/queue.json","utf8"));fs.writeFileSync("data/ladder/queue.jsonl",q.map(e=>JSON.stringify(e)).join("\n")+(q.length?"\n":""));console.log(`war council: ${q.length} queued`)'
    retry node engine/ladder.ts || { echo "::error::war council battles failed"; status=1; }
  else echo "::error::couldn't read the War Council queue from $LADDER_API"; status=1; fi
else echo "::notice::LADDER_API / LADDER_TOKEN not set: skipping the War Council"; fi

# publish for review: only finished battles
git config user.name "harkara-nightly"; git config user.email "harkara-nightly@users.noreply.github.com"
git checkout -q -B "battle/$ID"
for d in client/public/replay/*/; do [ -f "$d/end.json" ] && git add "$d"; done
git add client/public/replay/index.json client/public/replay/ladder.json 2>/dev/null
if git diff --cached --quiet; then echo "nothing new to publish"
elif git commit -qm "battle $ID" && { [ "${PUSH:-1}" = 0 ] || git push -q -f origin "battle/$ID"; }; then
  echo "::notice::pushed battle/$ID: merge it to publish"
  # only now mark the entries as played, so a failed push leaves them queued for tomorrow
  if [ -s data/ladder/used.json ] && [ -n "${LADDER_API:-}" ]; then
    curl -fsS --retry 3 --retry-all-errors -X POST -H "authorization: Bearer $LADDER_TOKEN" -H 'content-type: application/json' \
      --data "{\"ids\":$(cat data/ladder/used.json)}" "$LADDER_API/api/consume" >/dev/null || { echo "::error::couldn't mark played entries"; status=1; }
  fi
else echo "::error::couldn't push battle/$ID"; status=1; fi
exit $status
