#!/usr/bin/env bash
# X3 (vérif tour 4) : un banc rapporté n'a de valeur que si les images
# Docker exécutent HEAD. Obligatoire avant tout banc cité dans un
# rapport — le rapport en cite la sortie.
#
#   bash workers/nesting/bench/assert_images_head.sh
#
set -euo pipefail
cd "$(dirname "$0")/../../.."

fail=0
check_file() {  # <chemin dans le conteneur> <chemin hôte> <conteneur>
    local cpath=$1 hpath=$2 c=$3
    local in_container on_host
    in_container=$(MSYS_NO_PATHCONV=1 docker exec "$c" md5sum "$cpath" 2>/dev/null | awk '{print $1}')
    on_host=$(md5sum "$hpath" 2>/dev/null | awk '{print $1}')
    [ -n "$in_container" ] || in_container=MISSING
    [ -n "$on_host" ] || on_host=MISSING
    if [ "$in_container" != "$on_host" ]; then
        echo "STALE: $cpath dans $c ($in_container) != HEAD ($on_host)" >&2
        fail=1
    fi
}

for c in $(docker ps --format '{{.Names}}' | grep -E -- 'nestorcut-nesting-worker-'); do
    check_file /app/core/residual.py    workers/nesting/core/residual.py    "$c"
    check_file /app/core/main.py        workers/nesting/core/main.py        "$c"
    check_file /app/core/metrics.py     workers/nesting/core/metrics.py     "$c"
    check_file /app/core/holefill.py    workers/nesting/core/holefill.py    "$c"
done

for c in $(docker ps --format '{{.Names}}' | grep -E -- '-app-'); do
    # bundle wasm moteur + géométrie : le hôte fait foi
    in_container=$(MSYS_NO_PATHCONV=1 docker exec "$c" md5sum /src/.output/public/engine/nest_wasm_bg.wasm 2>/dev/null | cut -d' ' -f1 || echo MISSING)
    on_host=$(md5sum public/engine/nest_wasm_bg.wasm 2>/dev/null | cut -d' ' -f1)
    if [ "$in_container" != "$on_host" ]; then
        echo "STALE: wasm moteur dans $c" >&2
        fail=1
    fi
    in_container=$(MSYS_NO_PATHCONV=1 docker exec "$c" md5sum /src/.output/public/geometry/nest_geometry_bg.wasm 2>/dev/null | cut -d' ' -f1 || echo MISSING)
    on_host=$(md5sum public/geometry/nest_geometry_bg.wasm 2>/dev/null | cut -d' ' -f1)
    if [ "$in_container" != "$on_host" ]; then
        echo "STALE: wasm géométrie dans $c" >&2
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo "ASSERT IMAGES=HEAD: ÉCHEC — reconstruire (docker compose build nesting-worker app && up -d) avant tout banc." >&2
    exit 1
fi
echo "ASSERT IMAGES=HEAD: OK ($(date -u +%FT%TZ))"
