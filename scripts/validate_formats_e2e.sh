#!/usr/bin/env bash
# E2E validation of the multi-format import (DXF + SVG + DWG) on the local
# docker stack. Usage: bash scripts/validate_formats_e2e.sh [base_url]
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

SVG_FIXTURE="workers/fileprocessing/tests/fixtures/sample_shapes.svg"
DWG_FIXTURE="/tmp/fixture_dwg_test.dwg"

echo "== login =="
curl -s -c "$JAR" -X POST "$BASE/api/auth/local/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"guillaume@local.dev","password":"nestorcut-local-2026"}' > /dev/null

echo "== generate the DWG fixture inside the worker image (dwgwrite) =="
docker run --rm -v "C:\Users\Guillaume\ZCodeProject\Nest2D\workers\fileprocessing\tests\fixtures:/fx" \
  nest2d-file-processing-worker:dev sh -c \
  "dwgwrite -I DXF -o /tmp/fixture.dwg /fx/Piece_Trou.DXF 2>/dev/null && cp /tmp/fixture.dwg /fx/fixture_dwg_test.dwg" 2>/dev/null
DWG_FIXTURE="workers/fileprocessing/tests/fixtures/fixture_dwg_test.dwg"
if [ -f "$DWG_FIXTURE" ]; then
  check "dwg fixture written" "$(head -c 4 "$DWG_FIXTURE")" "AC10"
else
  echo "  SKIP dwg fixture (dwgwrite failed) — dwg upload tests will fail"
fi

echo "== upload SVG via POST /api/project (creates a project) =="
RESP=$(curl -s -b "$JAR" -X POST "$BASE/api/project" -F "dxf=@$SVG_FIXTURE;filename=sample_shapes.svg")
check "project created" "$RESP" '"slug"'
PSLUG=$(echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).slug))" 2>/dev/null)
echo "  project: $PSLUG"

echo "== upload DWG + rejected .txt on the same project =="
curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/addfiles" -F "dxf=@$DWG_FIXTURE;filename=piece_trou.dwg" > /dev/null
TMPDIR_E2E="$(mktemp -d)"
echo "hello" > "$TMPDIR_E2E/notacad.txt"
TXT=$(curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/addfiles" -F "dxf=@$(cygpath -w "$TMPDIR_E2E/notacad.txt");filename=notacad.txt")
check ".txt rejected with 400" "$TXT" 'DXF, SVG and DWG'

echo "== wait for processing (up to 120s) =="
DONE=0
for i in $(seq 1 24); do
  STATES=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    print(db.user_dxf_files.countDocuments({projectSlug:'$PSLUG', processingStatus:'completed'}))" 2>/dev/null)
  if [ "$STATES" = "2" ]; then DONE=1; break; fi
  sleep 5
done
check "2 files processed (svg + dwg)" "$DONE" "1"

echo "== mongo checks: formats converted to DXF mm, parts, colors =="
DOC=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const f = db.user_dxf_files.findOne({projectSlug:'$PSLUG', name:'sample_shapes.svg'});
  print(JSON.stringify({
    status: f.processingStatus,
    parts: (f.polygonParts||[]).length,
    holes: (f.polygonParts||[]).filter(p=>(p.holes||[]).length>0).length,
    colors: (f.polygonParts||[]).every(p=>/^#[0-9A-F]{6}$/.test(p.color||'')),
    slug: f.slug, svgPreview: f.isSvgFileExist
  }))" 2>/dev/null)
check "svg file completed" "$DOC" '"status":"completed"'
check "svg 4 parts" "$DOC" '"parts":4'
check "svg 1 holed part" "$DOC" '"holes":1'
check "svg colors assigned" "$DOC" '"colors":true'
check "svg keeps .svg slug" "$DOC" '.svg"'
check "svg preview generated" "$DOC" '"svgPreview":true'

VALID_DXF=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const f = db.user_dxf_files.findOne({projectSlug:'$PSLUG', name:'sample_shapes.svg'});
  const g = db.getSiblingDB('nest2d').validDxf.files.findOne({filename:f.slug});
  print(g ? g.filename : 'MISSING')" 2>/dev/null)
check "canonical DXF copy exists in validDxf" "$VALID_DXF" ".svg"

DWGDOC=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
  const f = db.user_dxf_files.findOne({projectSlug:'$PSLUG', name:'piece_trou.dwg'});
  print(JSON.stringify({
    status: f.processingStatus,
    parts: (f.polygonParts||[]).length,
    holes: (f.polygonParts||[]).reduce((n,p)=>n+(p.holes||[]).length,0),
    slug: f.slug
  }))" 2>/dev/null)
check "dwg file completed" "$DWGDOC" '"status":"completed"'
check "dwg 1 part with hole" "$DWGDOC" '"parts":1'
check "dwg hole detected" "$DWGDOC" '"holes":1'
check "dwg keeps .dwg slug" "$DWGDOC" '.dwg"'

echo "== corrupted DWG is rejected with an actionable error =="
printf 'AC1027FAKEDWGCONTENT' > "$TMPDIR_E2E/broken.dwg"
curl -s -b "$JAR" -X POST "$BASE/api/project/$PSLUG/addfiles" -F "dxf=@$(cygpath -w "$TMPDIR_E2E/broken.dwg");filename=broken.dwg" > /dev/null
for i in $(seq 1 6); do
  BROKEN=$(docker exec nest2d-mongo-1 mongosh nest2d --quiet --eval "
    const f = db.user_dxf_files.findOne({name:'broken.dwg'});
    print(JSON.stringify({status: f.processingStatus, info: f.processingError || ''}))" 2>/dev/null)
  echo "$BROKEN" | grep -q '"status":"error"' && break
  sleep 5
done
check "broken dwg in error state" "$BROKEN" '"status":"error"'
check "broken dwg actionable message" "$BROKEN" 'Could not read this DWG'

echo
echo "==================================="
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
