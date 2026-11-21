#!/usr/bin/env bash
# The nightly on GitHub Actions (free on a public repo):
#   1. today's battle with the model generals (skipped if no model key is set)
#   2. the War Council: queued entries from the Cloudflare API, fought on the local model (llama-server on LOCAL_LLM_URL)
#   3. everything pushed to battle/<id> for review (merge to publish), then the played entries are marked on the API
# Env: GROQ_API_KEY / NVIDIA_API_KEY / OPENROUTER_API_KEY (any), LADDER_API + LADDER_TOKEN, LADDER_BATTLES (2), PUSH (1)
# A step that fails doesn't stop the others; the script exits 1 at the end so the run shows red and GitHub emails you.
set -uo pipefail
cd "$(dirname "$0")/.."
ID=${ID:-daily-$(TZ=Asia/Kolkata date +%F)}
git config user.name "harkara-nightly"; git config user.email "harkara-nightly@users.noreply.github.com"
# build on the newest battle branch that isn't merged yet, so tonight's branch carries every unpublished night:
# merging the latest one publishes them all, and branches never conflict over index.json / ladder.json
prev=$(git ls-remote --heads origin 'battle/*' 2>/dev/null | sed 's#.*refs/heads/##' | sort | tail -1)
if [ -n "$prev" ] && git fetch -q origin "$prev" && ! git merge-base --is-ancestor FETCH_HEAD HEAD; then
  git merge -q --no-edit FETCH_HEAD && echo "carrying unmerged $prev" || { git merge --abort; echo "::warning::couldn't carry $prev; tonight starts from main"; }
fi
status=0
# exit 2 = a model provider went down mid-battle; the answers so far are saved, so a rerun resumes
retry() { local c; for t in 1 2 3; do "$@"; c=$?; [ $c -ne 2 ] && return $c; echo "::warning::provider down, retrying in 10 min ($t/3)"; sleep 600; done; return 2; }

if [ -f "client/public/replay/$ID/end.json" ]; then echo "$ID already fought"
elif [ -n "${GROQ_API_KEY:-}${NVIDIA_API_KEY:-}${OPENROUTER_API_KEY:-}" ]; then
  retry node engine/run.ts --models --rotate "$(( $(date -u +%s) / 86400 ))" --id "$ID" --seed "$(printf %s "$ID" | cksum | cut -d' ' -f1)" || { echo "::error::daily battle failed"; status=1; }
else echo "::notice::no model keys set (GROQ_API_KEY, NVIDIA_API_KEY, OPENROUTER_API_KEY): skipping the daily battle"; fi

if [ -n "${TEST_QUEUE:-}" ] || { [ -n "${LADDER_API:-}" ] && [ -n "${LADDER_TOKEN:-}" ]; }; then
  mkdir -p data/ladder
  # TEST_QUEUE: a rehearsal reads entries from a file instead of the API (and nothing gets marked as played)
  if { [ -n "${TEST_QUEUE:-}" ] && cp "$TEST_QUEUE" data/ladder/queue.json; } || { [ -z "${TEST_QUEUE:-}" ] && curl -fsS --retry 3 --retry-all-errors -H "authorization: Bearer $LADDER_TOKEN" "$LADDER_API/api/queue" -o data/ladder/queue.json; }; then
    node -e 'const fs=require("fs");const q=JSON.parse(fs.readFileSync("data/ladder/queue.json","utf8"));fs.writeFileSync("data/ladder/queue.jsonl",q.map(e=>JSON.stringify(e)).join("\n")+(q.length?"\n":""));console.log(`war council: ${q.length} queued`)'
    retry node engine/ladder.ts || { echo "::error::war council battles failed"; status=1; }
  else echo "::error::couldn't read the War Council queue from $LADDER_API"; status=1; fi
else echo "::notice::LADDER_API / LADDER_TOKEN not set: skipping the War Council"; fi

# publish for review: only finished battles
git checkout -q -B "battle/$ID"
for d in client/public/replay/*/; do [ -f "$d/end.json" ] && git add "$d"; done
git add client/public/replay/index.json client/public/replay/ladder.json 2>/dev/null
published=0
if git diff --cached --quiet; then echo "nothing new to publish"; published=1
elif git commit -qm "battle $ID" && { [ "${PUSH:-1}" = 0 ] || git push -q -f origin "battle/$ID"; }; then
  published=1; [ "${PUSH:-1}" = 0 ] && echo "::notice::rehearsal: committed battle/$ID locally, not pushed" || echo "::notice::pushed battle/$ID: merge it to publish"
else echo "::error::couldn't push battle/$ID"; status=1; fi
# only now mark entries as played (fought) or retired (not drawn, or their battle failed), so a failed push leaves them queued
if [ "$published" = 1 ] && [ -n "${LADDER_API:-}" ] && [ -z "${TEST_QUEUE:-}" ]; then
  ids=$(node -e 'const fs=require("fs"),r=f=>{try{return JSON.parse(fs.readFileSync("data/ladder/"+f,"utf8"))}catch{return[]}};console.log(JSON.stringify([...new Set([...r("used.json"),...r("retire.json")])].slice(0,500)))')
  if [ "$ids" != "[]" ]; then
    curl -fsS --retry 3 --retry-all-errors -X POST -H "authorization: Bearer $LADDER_TOKEN" -H 'content-type: application/json' \
      --data "{\"ids\":$ids}" "$LADDER_API/api/consume" >/dev/null || { echo "::error::couldn't mark played entries"; status=1; }
  fi
fi
exit $status
