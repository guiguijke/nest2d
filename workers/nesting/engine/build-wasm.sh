#!/usr/bin/env bash
# Rebuilds the browser WASM artifact of the nesting engine and installs it
# under public/engine/ (served by the app at /engine/*, flag-gated Phase 2).
#
# Prereqs: rustup target wasm32-unknown-unknown, wasm-bindgen-cli (version
# matching the wasm-bindgen crate in Cargo.lock), binaryen's wasm-opt.
#
#   bash workers/nesting/engine/build-wasm.sh
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release --target wasm32-unknown-unknown -p nest-wasm

OUT=../../../public/engine
mkdir -p "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --out-name nest_wasm \
    target/wasm32-unknown-unknown/release/nest_wasm.wasm
wasm-opt -O3 --strip-debug --strip-dwarf --strip-producers \
    -o "$OUT/nest_wasm_bg.wasm" "$OUT/nest_wasm_bg.wasm"

RAW=$(stat -c %s "$OUT/nest_wasm_bg.wasm" 2>/dev/null || stat -f %z "$OUT/nest_wasm_bg.wasm")
GZ=$(gzip -9 -c "$OUT/nest_wasm_bg.wasm" | wc -c)
echo "installed: $OUT/nest_wasm_bg.wasm raw=$RAW gzip=$GZ"
