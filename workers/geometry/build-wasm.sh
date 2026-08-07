#!/usr/bin/env bash
# Rebuilds the browser WASM geometry bundle (import+preprocess+export+report)
# and installs it under public/geometry/ (servi par l'app à /geometry/*,
# flag-gaté PR4). Même toolchain que le moteur : wasm-bindgen-cli épinglé à
# la version du crate wasm-bindgen dans Cargo.lock (J-063), wasm-opt binaryen.
#
#   bash workers/geometry/build-wasm.sh
set -euo pipefail
cd "$(dirname "$0")"

WB_VERSION=$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/"/, "", $3); print $3; exit}' Cargo.lock)
echo "wasm-bindgen crate = $WB_VERSION"

cargo build --release --target wasm32-unknown-unknown -p nest-geometry-wasm

OUT=../../public/geometry
mkdir -p "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --out-name nest_geometry \
    target/wasm32-unknown-unknown/release/nest_geometry_wasm.wasm
if command -v wasm-opt >/dev/null 2>&1; then
    wasm-opt -O3 --strip-debug --strip-dwarf --strip-producers \
        -o "$OUT/nest_geometry_bg.wasm" "$OUT/nest_geometry_bg.wasm"
else
    echo "wasm-opt absent (binaire non optimisé — ok pour le diff, pas pour la prod)"
fi

RAW=$(stat -c %s "$OUT/nest_geometry_bg.wasm" 2>/dev/null || stat -f %z "$OUT/nest_geometry_bg.wasm")
GZ=$(gzip -9 -c "$OUT/nest_geometry_bg.wasm" | wc -c)
echo "installed: $OUT/nest_geometry_bg.wasm raw=$RAW gzip=$GZ"
