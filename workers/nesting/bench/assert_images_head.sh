#!/usr/bin/env bash
# X3 puis Y1 (vérif tour 5) : un banc rapporté n'a de valeur que si les
# images Docker exécutent HEAD — pas le répertoire de travail. Compare
# chaque fichier au CONTENU GIT DE HEAD (git show HEAD:<f>), signale tout
# fichier suivi modifié, et vérifie le bundle JS + la fraîcheur du binaire
# moteur par rapport au dernier commit engine/.
#
#   bash workers/nesting/bench/assert_images_head.sh
#
set -euo pipefail
cd "$(dirname "$0")/../../.."

fail=0

# Y1 : tout fichier suivi modifié invalide la mesure (le conteneur peut
# être fidèle au répertoire de travail tout en différant de HEAD).
if ! git diff --quiet HEAD -- 2>/dev/null; then
    echo "STALE: répertoire de travail diffère de HEAD :" >&2
    git status --short | grep -v '^??' | head -10 >&2 || true
    fail=1
fi

hash_in() {  # <conteneur> <chemin conteneur>
    MSYS_NO_PATHCONV=1 docker exec "$1" md5sum "$2" 2>/dev/null | awk '{print $1}'
}

for c in $(docker ps --format '{{.Names}}' | grep -E -- 'nestorcut-nesting-worker-'); do
    for f in core/residual.py core/main.py core/metrics.py core/holefill.py; do
        in_c=$(hash_in "$c" "/app/$f")
        at_head=$(git show "HEAD:workers/nesting/$f" 2>/dev/null | md5sum | awk '{print $1}')
        if [ -z "$in_c" ] || [ "$in_c" != "$at_head" ]; then
            echo "STALE: $f dans $c != HEAD git" >&2
            fail=1
        fi
    done
    # Y1 : binaire moteur — AVERTISSEMENT de fraîcheur (le mtime Docker
    # conserve celui de la couche cargo cachée : un commit POSTÉRIEUR à
    # un build identique au contenu déclenche un faux positif — le
    # contrôle dur du moteur est le hash du bundle wasm, commité).
    bin_ts=$(MSYS_NO_PATHCONV=1 docker exec "$c" stat -c %Y /usr/local/bin/nest-engine 2>/dev/null || echo 0)
    engine_last_commit=$(git log -1 --format=%ct -- workers/nesting/engine/ 2>/dev/null || echo 9999999999)
    if [ "$bin_ts" -lt "$engine_last_commit" ]; then
        echo "NOTE: binaire moteur de $c antérieur au dernier commit engine/ ($(date -u -d @$engine_last_commit +%FT%TZ 2>/dev/null || echo '?')) — vérifier le hash wasm (contrôle dur ci-dessous) et reconstruire en cas de doute." >&2
    fi
done

for c in $(docker ps --format '{{.Names}}' | grep -E -- '-app-'); do
    for pair in "engine/nest_wasm_bg.wasm" "geometry/nest_geometry_bg.wasm"; do
        in_c=$(hash_in "$c" "/src/.output/public/$pair")
        at_head=$(git show "HEAD:public/$pair" 2>/dev/null | md5sum | awk '{print $1}')
        if [ -z "$in_c" ] || [ "$in_c" != "$at_head" ]; then
            echo "STALE: $pair dans $c != HEAD git" >&2
            fail=1
        fi
    done
    # Y1 : bundle JS principal — hash du fichier .js généré (entrée : contenu)
    in_c=$(hash_in "$c" "/src/.output/public/engine/nest_wasm.js")
    at_head=$(git show "HEAD:public/engine/nest_wasm.js" 2>/dev/null | md5sum | awk '{print $1}')
    if [ -z "$in_c" ] || [ "$in_c" != "$at_head" ]; then
        echo "STALE: nest_wasm.js dans $c != HEAD git" >&2
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo "ASSERT IMAGES=HEAD: ÉCHEC — committer/reconstruire avant tout banc." >&2
    exit 1
fi
echo "ASSERT IMAGES=HEAD: OK ($(date -u +%FT%TZ))"
