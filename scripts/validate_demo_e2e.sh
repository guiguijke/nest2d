#!/usr/bin/env bash
# E2E validation of the demo project + free demo nestings (local docker stack).
# Usage: bash scripts/validate_demo_e2e.sh [base_url]
set -u
BASE="${1:-http://localhost:3000}"
JAR="$(mktemp)"
PASS=0
FAIL=0

check() { # check <label> <actual> <expected-substring>
  if echo "$2" | grep -q "$3"; then
    echo "  OK   $1"
    PASS=$((PASS+1))
  else
    echo "  FAIL $1 — expected '$3' in: $(echo "$2" | head -c 300)"
    FAIL=$((FAIL+1))
  fi
}

echo "== login =="
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/local/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"guillaume@local.dev","password":"nestorcut-local-2026"}')
echo "$LOGIN" | head -c 200; echo

echo "== /api/user exposes demoRemaining =="
USER_JSON=$(curl -s -b "$JAR" "$BASE/api/user")
check "demoRemaining present" "$USER_JSON" '"demoRemaining"'

echo "== /api/project/me pins the demo project first =="
PROJECTS=$(curl -s -b "$JAR" "$BASE/api/project/me")
check "demo slug listed" "$PROJECTS" '"slug":"demo"'
check "demo flagged" "$PROJECTS" '"isDemo":true'

echo "== /api/project/demo lists seeded files with colors + demoQuantity =="
DEMO=$(curl -s -b "$JAR" "$BASE/api/project/demo")
check "isDemo true" "$DEMO" '"isDemo":true'
check "24 files" "$(echo "$DEMO" | grep -o '"slug":"demo-marine-lpl-[0-9]*.dxf"' | wc -l)" "24"
check "colors present" "$DEMO" '"color":"#'
check "demoQuantity present" "$DEMO" '"demoQuantity"'

echo "== geometry route returns per-part colors (demo file, world-readable) =="
GEO=$(curl -s -b "$JAR" "$BASE/api/files/project/geometry/demo-marine-lpl-022.dxf")
check "color in geometry" "$GEO" '"color":"#'

echo "== POST demo nesting (client geometry, server-imposed compute) =="
FILES_JSON=$(echo "$DEMO" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  const files=j.files.map(f=>({slug:f.slug,count:f.demoQuantity}));
  console.log(JSON.stringify({files,params:{
    sheets:[{width:3000,height:1500,count:3}],
    space:2, fillHoles:true, rotationCount:4,
    // Attempted compute inflation — the server MUST ignore these:
    vcores:64, timeBudgetSec:99999, directions:['left','bottom','balanced']
  }}));
})")
NEST=$(curl -s -b "$JAR" -X POST "$BASE/api/project/demo/nest" \
  -H 'Content-Type: application/json' -d "$FILES_JSON")
check "job slug returned" "$NEST" '"slug":"nested-'
JOB_SLUG=$(echo "$NEST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).slug))")
echo "  job: $JOB_SLUG"

echo "== job doc in mongo: client geometry + imposed compute =="
DOC=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const j = db.nesting_jobs.findOne({slug:'$JOB_SLUG'});
  print(JSON.stringify({charge:j.charge, vcores:j.params.vcores, timeBudgetSec:j.params.timeBudgetSec,
    computeLevel:j.params.computeLevel, directions:j.params.directions, sheets:j.params.sheets, fillHoles:j.params.fillHoles,
    space:j.params.space}))" 2>/dev/null)
check "charge type demo" "$DOC" '"type":"demo"'
check "vcores imposed at 4 (client asked 64)" "$DOC" '"vcores":4'
check "budget imposed at 90 (client asked 99999)" "$DOC" '"timeBudgetSec":90'
check "computeLevel demo" "$DOC" '"computeLevel":"demo"'
check "3 directions" "$DOC" '"directions":\["left","bottom","balanced"\]'
check "client sheet 3000x1500 kept" "$DOC" '"width":3000'
check "client fillHoles kept" "$DOC" '"fillHoles":true'
check "client spacing kept" "$DOC" '"space":2'

echo "== user demoNestingUsed consumed =="
USED=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  print(db.users.findOne({id:'local:guillaume@local.dev'}).demoNestingUsed)" 2>/dev/null)
check "demoNestingUsed >= 1" "$USED" "[0-9]"

echo "== waiting for job completion (up to 240s) =="
STATUS=""
for i in $(seq 1 48); do
  STATUS=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    print(db.nesting_jobs.findOne({slug:'$JOB_SLUG'}).status)" 2>/dev/null)
  if [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ]; then break; fi
  sleep 5
done
check "job done" "$STATUS" "done"

echo "== final alternatives + colored SVGs =="
FINAL=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const j = db.nesting_jobs.findOne({slug:'$JOB_SLUG'});
  print(JSON.stringify({alts:(j.alternatives||[]).length, svgs:(j.alternatives||[]).map(a=>a.svg_files),
    holesFilled:(j.alternatives||[]).map(a=>a.report && a.report.holesFilled),
    share:(j.alternatives||[]).map(a=>a.usedSheetShare)}))" 2>/dev/null)
check "3 alternatives" "$FINAL" '"alts":3'
echo "  $FINAL" | head -c 400; echo

SVG_NAME=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  print(db.nesting_jobs.findOne({slug:'$JOB_SLUG'}).svg_files[0])" 2>/dev/null)
SVG=$(curl -s -b "$JAR" "$BASE/api/files/result/svg/$SVG_NAME")
check "SVG served" "$SVG" "<svg"
check "SVG colored (palette hex)" "$SVG" "#2563EB\|#DC2626\|#059669\|#D97706\|#7C3AED\|#DB2777\|#0D9488\|#EA580C\|#4F46E5\|#65A30D"
check "SVG evenodd fills" "$SVG" 'fill-rule="evenodd"'

echo "== demo quota exhaustion -> 402 demo_quota =="
docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  db.users.updateOne({id:'local:guillaume@local.dev'},{\$set:{demoNestingUsed:10}})" >/dev/null 2>&1
NEST402=$(curl -s -b "$JAR" -X POST "$BASE/api/project/demo/nest" \
  -H 'Content-Type: application/json' -d "$FILES_JSON")
check "402 with demo_quota reason" "$NEST402" '"reason": *"demo_quota"'
docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  db.users.updateOne({id:'local:guillaume@local.dev'},{\$set:{demoNestingUsed:1}})" >/dev/null 2>&1

echo "== refund path (demo charge) =="
docker exec nest2d-nesting-worker-1 python -c "
import os
os.environ.setdefault('MONGO_URI','mongodb://mongo:27017/nest2d')
from worker_common.mongo import db
from worker_common.refund import refund_charge
before = db.users.find_one({'id':'local:guillaume@local.dev'}).get('demoNestingUsed')
fake = {'_id': db.nesting_jobs.insert_one({'slug':'refund-test-demo','ownerId':'local:guillaume@local.dev','charge':{'type':'demo'},'status':'error'}).inserted_id,
        'ownerId':'local:guillaume@local.dev','charge':{'type':'demo'}}
refund_charge(db['nesting_jobs'], fake)
after = db.users.find_one({'id':'local:guillaume@local.dev'}).get('demoNestingUsed')
db.nesting_jobs.delete_one({'slug':'refund-test-demo'})
print(f'REFUND before={before} after={after}')
" 2>/dev/null | grep REFUND > /tmp/refund_out
check "refund decrements" "$(cat /tmp/refund_out)" "after=0"

echo
echo "==================================="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
