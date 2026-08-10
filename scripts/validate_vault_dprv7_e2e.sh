#!/usr/bin/env bash
# E2E validation of D-PRV-7 (vault hardening) on the local docker stack:
#   RAM-only session + per-job ECDH DEK delivery + master-key wrap removal.
# Locks THREAT-MODEL §4.5: enable → vault nest → readable result, then
# mid-queue session loss → job fails vault_locked and is refunded.
# Usage: bash scripts/validate_vault_dprv7_e2e.sh [base_url]
set -u
BASE="${1:-http://localhost:7100}"
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

EMAIL="qa-vault@local.dev"
PASSWORD="qa-vault-2026"
FIXTURE="workers/fileprocessing/tests/fixtures/Piece_Trou.DXF"

echo "== register (idempotent) + login =="
curl -s -X POST "$BASE/api/auth/local/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"QA Vault\"}" > /dev/null
# A fresh local account may be unverified — the vault guard rejects that.
# Grant the standard tier too: Free computes IN THE BROWSER (awaiting_local),
# this QA needs the server-side worker path (ECDH delivery, encrypted results).
docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  db.users.updateOne({id:'local:$EMAIL'},{\$set:{emailVerified:true, grantedUntil:new Date(Date.now()+30*86400000)}})" > /dev/null 2>&1
LOGIN=$(curl -s -c "$JAR" -X POST "$BASE/api/auth/local/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "login ok" "$LOGIN" '"ok":true'

echo "== vault state (destroy leftovers from a previous run, if any) =="
STATUS=$(curl -s -b "$JAR" "$BASE/api/security/vault/status")
if echo "$STATUS" | grep -q '"enabled":true'; then
  echo "  vault already enabled — destroying for a clean run"
  # Unlock is impossible without the old key: full destroy wipes the vault.
  curl -s -b "$JAR" -X POST "$BASE/api/security/vault/destroy" \
    -H 'Content-Type: application/json' -d '{"confirm":"DESTROY"}' > /dev/null
fi

echo "== enable vault (DEK generated client-side, sent once over TLS) =="
DEK_B64=$(openssl rand -base64 32)
EN=$(curl -s -b "$JAR" -X POST "$BASE/api/security/vault/enable" \
  -H 'Content-Type: application/json' -d "{\"key\":\"$DEK_B64\"}")
check "enable ok" "$EN" '"ok":true'
STATUS=$(curl -s -b "$JAR" "$BASE/api/security/vault/status")
check "status enabled+unlocked" "$STATUS" '"enabled":true'
check "status not locked" "$STATUS" '"locked":false'
check "session expiresAt present" "$STATUS" '"expiresAt":"'

echo "== upload a DXF (encrypted on the fly) =="
RESP=$(curl -s -b "$JAR" -X POST "$BASE/api/project" -F "dxf=@$FIXTURE")
check "project created" "$RESP" '"slug"'
PSLUG=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).slug))" 2>/dev/null)
echo "  project: $PSLUG"

echo "== wait for file processing (up to 120s) =="
DONE=0
for i in $(seq 1 24); do
  C=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    print(db.user_dxf_files.countDocuments({projectSlug:'$PSLUG', processingStatus:'completed'}))" 2>/dev/null)
  if [ "$C" = "1" ]; then DONE=1; break; fi
  sleep 5
done
check "file processed" "$DONE" "1"

echo "== mongo: geometry at rest is encrypted, workerKeyPub wiped =="
FDOC=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const f = db.user_dxf_files.findOne({projectSlug:'$PSLUG'});
  const g = db.getSiblingDB('nest2d').validDxf.files.findOne({filename:f.slug});
  print(JSON.stringify({
    encParts: Boolean(f.encPolygonParts && f.encPolygonParts.data),
    plainParts: (f.polygonParts||[]).length,
    blobEnc: Boolean(g && g.metadata && g.metadata.enc),
    workerKeyPub: f.workerKeyPub === undefined ? 'absent' : 'PRESENT'
  }))" 2>/dev/null)
check "polygonParts encrypted (encPolygonParts)" "$FDOC" '"encParts":true'
check "no plaintext polygonParts" "$FDOC" '"plainParts":0'
check "validDxf blob flagged enc" "$FDOC" '"blobEnc":true'
check "workerKeyPub wiped after job" "$FDOC" '"workerKeyPub":"absent"'
FSLUG=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  print(db.user_dxf_files.findOne({projectSlug:'$PSLUG'}).slug)" 2>/dev/null)

echo "== nest #1 (session active) =="
NEST=$(curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/nest" \
  -H 'Content-Type: application/json' -d "{\"files\":[{\"slug\":\"$FSLUG\",\"count\":2}],\"params\":{\"sheets\":[{\"width\":1000,\"height\":2000,\"count\":1}],\"space\":2,\"directions\":[\"left\"]}}")
check "job slug returned" "$NEST" '"slug":"nested-'
JOB1=$(echo "$NEST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).slug))" 2>/dev/null)
echo "  job: $JOB1"

echo "== wait for nest #1 (up to 180s) =="
ST=""
for i in $(seq 1 36); do
  ST=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    print(db.nesting_jobs.findOne({slug:'$JOB1'}).status)" 2>/dev/null)
  if [ "$ST" = "done" ] || [ "$ST" = "error" ]; then break; fi
  sleep 5
done
check "nest #1 done" "$ST" "done"

echo "== result readable through the API (decrypted) + encrypted at rest =="
RDOC=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const j = db.nesting_jobs.findOne({slug:'$JOB1'});
  const svg = j.svg_files[0];
  const g = db.getSiblingDB('nest2d').nestSvg.files.findOne({filename:svg});
  const dxfName = (j.dxf_files||[])[0] || '';
  const gd = dxfName ? db.getSiblingDB('nest2d').nestDxf.files.findOne({filename:dxfName}) : null;
  print(JSON.stringify({
    svg: svg, dxf: dxfName,
    svgEnc: Boolean(g && g.metadata && g.metadata.enc),
    dxfEnc: Boolean(gd && gd.metadata && gd.metadata.enc),
    workerKeyPub: j.workerKeyPub === undefined ? 'absent' : 'PRESENT'
  }))" 2>/dev/null)
check "result svg flagged enc at rest" "$RDOC" '"svgEnc":true'
check "result dxf flagged enc at rest" "$RDOC" '"dxfEnc":true'
check "workerKeyPub wiped after nest" "$RDOC" '"workerKeyPub":"absent"'
SVG_NAME=$(echo "$RDOC" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).svg))" 2>/dev/null)
SVG=$(curl -s -b "$JAR" "$BASE/api/files/result/svg/$SVG_NAME" | head -c 200)
check "svg result decrypts through API" "$SVG" "<svg"
DXF_NAME=$(echo "$RDOC" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).dxf))" 2>/dev/null)
if [ -n "$DXF_NAME" ]; then
  DXF=$(curl -s -b "$JAR" "$BASE/api/files/result/dxf/$DXF_NAME" | head -c 40)
  check "dxf result decrypts through API" "$DXF" "SECTION"
fi

echo "== mid-queue session loss: nest #2 pending, app restart, worker claims =="
docker compose stop nesting-worker > /dev/null 2>&1
USED_BEFORE=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  print(db.users.findOne({id:'local:$EMAIL'}).freeNestingUsed || 0)" 2>/dev/null)
NEST2=$(curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/nest" \
  -H 'Content-Type: application/json' -d "{\"files\":[{\"slug\":\"$FSLUG\",\"count\":2}],\"params\":{\"sheets\":[{\"width\":1000,\"height\":2000,\"count\":1}],\"space\":2,\"directions\":[\"left\"]}}")
JOB2=$(echo "$NEST2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).slug))" 2>/dev/null)
check "nest #2 enqueued" "$NEST2" '"slug":"nested-'
echo "  job: $JOB2 (pending) — restarting the app to wipe the RAM session"
docker compose restart app > /dev/null 2>&1
# Wait for the app to answer again.
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null)
  [ "$CODE" = "200" ] && break
  sleep 2
done
sleep 3
docker compose start nesting-worker > /dev/null 2>&1
ST2=""
for i in $(seq 1 24); do
  ST2=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    const j = db.nesting_jobs.findOne({slug:'$JOB2'});
    print(j.status + '|' + (j.error || ''))" 2>/dev/null)
  echo "$ST2" | grep -q '^error' && break
  echo "$ST2" | grep -q '^done' && break
  sleep 5
done
check "nest #2 failed (not done)" "$ST2" '^error'
check "nest #2 error mentions the vault" "$ST2" 'ault is locked'
USED_AFTER=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  print(db.users.findOne({id:'local:$EMAIL'}).freeNestingUsed || 0)" 2>/dev/null)
check "nest #2 refunded (quota restored)" "$USED_AFTER" "$USED_BEFORE"
WPUB=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const j = db.nesting_jobs.findOne({slug:'$JOB2'});
  print(j.workerKeyPub === undefined ? 'absent' : 'PRESENT')" 2>/dev/null)
check "workerKeyPub wiped after the failed job" "$WPUB" "absent"

echo "== locked gate: nest while the session is gone =="
NEST403=$(curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/nest" \
  -H 'Content-Type: application/json' -d "{\"files\":[{\"slug\":\"$FSLUG\",\"count\":1}],\"params\":{\"sheets\":[{\"width\":1000,\"height\":2000,\"count\":1}],\"space\":2,\"directions\":[\"left\"]}}")
check "nest rejected vault_locked" "$NEST403" 'vault_locked'

echo "== re-unlock with the saved key (post-deploy UX) =="
UN=$(curl -s -b "$JAR" -X POST "$BASE/api/security/vault/unlock" \
  -H 'Content-Type: application/json' -d "{\"key\":\"$DEK_B64\"}")
check "unlock ok" "$UN" '"ok":true'
STATUS=$(curl -s -b "$JAR" "$BASE/api/security/vault/status")
check "status unlocked again" "$STATUS" '"locked":false'
SVG2=$(curl -s -b "$JAR" "$BASE/api/files/result/svg/$SVG_NAME" | head -c 200)
check "old result readable again after re-unlock" "$SVG2" "<svg"

echo
echo "==================================="
echo "PASS: $PASS  FAIL: $FAIL"
rm -f "$JAR"
[ "$FAIL" -eq 0 ]
