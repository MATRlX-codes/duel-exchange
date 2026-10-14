# Duel Exchange battle client

The browser battle client that runs Duel Exchange battles. It is a modified fork of
[pokemon-showdown-client](https://github.com/smogon/pokemon-showdown-client) at commit `cc6f5c24adaaf0a5eb89effbb580516bbf3e7286`, licensed
**AGPLv3** (see `LICENSE`). This repository is the corresponding source for the client served by the Duel Exchange
game server.

Published at https://github.com/MATRlX-codes/duel-exchange (re-exported with `tools/export-client-source.sh` on every client release).

Duel Exchange is independent and not affiliated with Smogon, Pokémon Showdown, Nintendo, Game Freak or The Pokémon
Company. All creatures, names and art in this client are Duel Exchange's own.

## What changed from upstream
See `client/FORK.md`. In short: every franchise name and image is replaced with our own roster, text and art;
the client talks only to our server (plain WebSocket, our own accounts); joke modes, music and the upstream login
server are removed; it is bundled with esbuild and every build runs a name-leak scan.

## Build
```
npm install
npm run build        # writes dist/client (index.html, js/, style/, data/, sprites/, fx/, img/)
```
`tools/client-strip.ts`, `tools/gen-client-data.ts` and `tools/draw-client-art.py` are the tools that produced
`client/app`, `client/gen` and `client/public` from a pristine upstream copy; they also need our engine and roster
(separate MIT code, not in this repository), so the generated outputs are committed here.
