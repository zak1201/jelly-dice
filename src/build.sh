#!/bin/zsh
# Rebuild the single-file page from src/v4-parts (project-relative). Usage: zsh src/build.sh [output.html]
set -e
HERE=${0:A:h}; PARTS="$HERE/v4-parts"; OUT=${1:-"$HERE/../index.html"}
TMP=$(mktemp -d)
cat "$PARTS"/02-core.js "$PARTS"/02b-objects.js "$PARTS"/03-physics.js "$PARTS"/04-sound.js "$PARTS"/05-shaders.js "$PARTS"/06-renderer.js "$PARTS"/07-app.js > "$TMP/all.mjs"
/opt/homebrew/opt/node@24/bin/node --check "$TMP/all.mjs"
cat "$PARTS"/01-head.html "$TMP/all.mjs" "$PARTS"/08-tail.html > "$OUT"
rm -rf "$TMP"
echo "built $OUT ($(wc -l < "$OUT") lines)"
