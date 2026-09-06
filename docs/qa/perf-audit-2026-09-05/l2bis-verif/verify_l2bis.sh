#!/usr/bin/env bash
# Vérification lot 2 : bancs serveur chronométrés (séquentiels), e2e navigateur 0,1 et 2, corpus.
set -u
export MSYS_NO_PATHCONV=1
cd "C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut"
T="C:/Users/guiguijke/.claude/jobs/b6cdf1c7/tmp"
NET=nestorcut_nest2d
IMG=nest2d-nesting-worker:dev
MONGO="docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval"

seed_and_wait () {  # <space>
  local sp=$1
  local slug
  slug=$(docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e BENCH_SPACE=$sp -e BENCH_BUDGET=120 $IMG python - < workers/nesting/bench/seed_bpp_2sheets.py 2>/dev/null | grep JOB | awk '{print $2}')
  echo "seeded $slug (space $sp)"
  for i in $(seq 1 60); do
    st=$($MONGO "const j=db.nesting_jobs.findOne({slug:'$slug'},{status:1});print(j&&j.status)")
    case "$st" in done|failed|error) break;; esac
    sleep 5
  done
  $MONGO "const j=db.nesting_jobs.findOne({slug:'$slug'});const a=(j.result&&j.result.alternatives)||j.alternatives||[];print(JSON.stringify({slug:j.slug,discarded:(j.discardedAlternatives||[]).length,status:j.status,secs:(j.finishedAt-j.createdAt)/1000,engineSec:j.report&&(j.report.elapsedSec||j.report.engineElapsedSec),alts:a.map(x=>({s:x.strategy,d:x.density,off:x.offcut&&x.offcut.width,counts:(x.report&&x.report.sheets||[]).map(s=>s.partCount),lastOff:(x.report&&x.report.sheets||[]).slice(-1).map(s=>s.offcut&&s.offcut.widthMm+'x'+s.offcut.heightMm)[0],pp:x.report&&x.report.postPass&&{moved:x.report.postPass.residualMoved,merged:x.report.postPass.mergedReceivers,rb:x.report.postPass.compactRollbackReason}}))}))"
}

echo "=== SERVER BENCHES ==="
seed_and_wait 0.1
seed_and_wait 0.1
seed_and_wait 0.1
seed_and_wait 0.1
seed_and_wait 0.1
seed_and_wait 0.1
seed_and_wait 2
seed_and_wait 2
seed_and_wait 2
seed_and_wait 2

echo "=== E2E 0.1 ==="
QA_OUT="$T/e2e-l2bis-s01" QA_SPACE=0.1 node "$T/qa-e2e-freeze.mjs" > "$T/e2e-l2bis-s01.log" 2>&1
grep -E "compute outcome|LONGTASKS|FATAL|pageerror" "$T/e2e-l2bis-s01.log" | cut -c1-300
echo "=== E2E 2 ==="
QA_OUT="$T/e2e-l2bis-s2" QA_SPACE=2 node "$T/qa-e2e-freeze.mjs" > "$T/e2e-l2bis-s2.log" 2>&1
grep -E "compute outcome|LONGTASKS|FATAL|pageerror" "$T/e2e-l2bis-s2.log" | cut -c1-300

echo "=== CORPUS ==="
SINCE=$(date +%s)
docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e CORPUS_CASES=A,B,C,D,E,F,G,H,I,J,K $IMG python - < workers/nesting/bench/seed_corpus.py 2>/dev/null | tail -3
for i in $(seq 1 90); do
  n=$($MONGO "print(db.nesting_jobs.countDocuments({slug:{\$regex:'^bench-corpus-'},createdAt:{\$gte:new Date($SINCE*1000)},status:{\$in:['pending','processing','awaiting_local']}}))")
  [ "$n" = "0" ] && break
  sleep 10
done
docker run --rm -i --network $NET -e MONGO_URI=mongodb://mongo:27017/nest2d -e CORPUS_SINCE=$SINCE $IMG python - < workers/nesting/bench/eval_corpus.py 2>/dev/null | tail -20
echo "=== DONE ==="
