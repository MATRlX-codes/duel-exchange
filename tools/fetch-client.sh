#!/usr/bin/env bash
# Copies the upstream sim CLIENT (AGPLv3) at the pinned commit into client/, allow-list only.
# Taken: play.pokemonshowdown.com/src (minus the legacy oldclient/), style/*.css + the Font Awesome icon font,
# the libraries the new client loads, and LICENSE. Never taken: sprites/, fx/ (effect images, backgrounds),
# graphics-src/, audio, the sound library, the old Backbone client, PHP, the site/replay/teams subsites.
set -euo pipefail
cd "$(dirname "$0")/.."
COMMIT="$(cat client/UPSTREAM_COMMIT)"
DIR=.upstream/pokemon-showdown-client
if [ ! -d "$DIR/.git" ]; then
  mkdir -p .upstream && git init -q "$DIR"
  git -C "$DIR" remote add origin https://github.com/smogon/pokemon-showdown-client.git
fi
git -C "$DIR" fetch -q --depth 1 origin "$COMMIT"
git -C "$DIR" checkout -q "$COMMIT"
P="$DIR/play.pokemonshowdown.com"
OUT="${1:-client/app}"
rm -rf "$OUT" && mkdir -p "$OUT/src" "$OUT/style" "$OUT/lib"
find "$P/src" -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' \) -exec cp {} "$OUT/src/" \;
cp "$P"/style/*.css "$OUT/style/"
cp -r "$P/style/font" "$P/style/fonts" "$OUT/style/"
for f in preact.min.js preact.d.ts html-css-sanitizer-minified.js jquery-2.2.4.min.js d3.v3.min.js ps-polyfill.js; do cp "$P/js/lib/$f" "$OUT/lib/"; done
cp "$DIR/LICENSE" client/LICENSE
echo "client copied at $COMMIT into $OUT"
