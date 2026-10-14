# The client fork (M3 part 2, decision D7)

Upstream: github.com/smogon/pokemon-showdown-client, commit in `UPSTREAM_COMMIT` (cc6f5c2, Oct 6 2026, "Preact
minor updates batch 51"). Licence: **AGPLv3**, kept in `client/LICENSE`. Everything under `client/` is AGPL (the
engine and server stay MIT). Our modified client is published under AGPL at
https://github.com/MATRlX-codes/duel-exchange (exported with `tools/export-client-source.sh`; the client footer and the site footer link to it).
Every client release that changes `client/` or the client tools needs a re-export + push to that repo.

## Step 1 (this commit): the allow-list copy, unchanged
`tools/fetch-client.sh` copies only:
- `app/src/`: the new Preact client (`play.pokemonshowdown.com/src/*.ts|tsx|js`), without the legacy
  `oldclient/` (Backbone) and without any PHP.
- `app/style/`: the client's CSS and the Font Awesome icon font (SIL OFL / MIT).
- `app/lib/`: preact (+ types), the HTML/CSS sanitizer, jQuery 2.2.4, d3 v3 and the polyfill: the libraries
  the new client loads. Not SockJS (our server speaks plain WebSocket at `/showdown/websocket`), not the sound
  library, not Backbone, lodash or color-thief.
- `LICENSE`.

Never taken: `sprites/`, `fx/` (effect images, backgrounds), `graphics-src/`, audio, the PSD, the main site,
replay and teams subsites, `build-tools/` (we build with our own esbuild setup), translations.

The copied code is unmodified so the next steps show as clean diffs against upstream.

## Step 2: strip, wire, build (all reproducible)
Run `npm run gen:client` (strip + data + art) and `npm run build:client`. From a fresh `client/app` copy:
- `tools/client-strip.ts` rewrites every string literal, template piece and JSX text in `app/src`: an upstream
  species/move/ability/item name becomes ours where one of our moves/abilities/items runs on that mechanic, else the
  inert `(none)`; lowercase mechanic ids map to our ids (the server only sends our names) except in the move-animation
  table; franchise words (Pokémon, Pokédex, Poké Ball, Tera...) become ours; links to the upstream sites point at
  duel-exchange.vercel.app. It also applies the hand edits (April Fools' joke mode and battle music removed, a few
  sentences) and the WIRING list: our server only (same-origin WebSocket, no worker, no login server), accounts via
  `POST /api/account` + `/trn` with the token kept on the device (`src/dx.ts`), the request's `creatures` list, our
  sprites/icons/field/avatar, our main menu (board panel, footer), our weather ids, no sounds, and the load-order fixes
  the bundler needs (import cycles that upstream's one-script-per-file build never hit). `--check` must report 0.
- `tools/gen-client-data.ts` writes `gen/dx-data.js` (our dex, battle text from each mechanic's templates with our
  names, teambuilder tables, search index) and `gen/anims.ts`. Needs `.upstream/` for the text templates.
- `tools/draw-client-art.py` draws `public/` (our 58 effect sprites, weather/field, badges, decoy, avatar, capsules,
  150 animated creature GIFs from `site/public/sprites`). No upstream image is used.
- `tools/build-client.ts` bundles with esbuild into `dist/client` and runs the leak scan over everything it wrote
  (names in code literals and data, franchise words, upstream hosts). The build fails on a hit. `tests/client.test.ts`
  checks the strip is complete, the scan is clean and the server serves it.
The battle server serves `dist/client` at `/` (built in the Dockerfile).

## Updating to a newer upstream
Put the new commit in `client/UPSTREAM_COMMIT`, run `tools/fetch-client.sh client/app-new`, diff against
`client/app`, and re-apply our changes.
