/**
 * Strip pass over the forked client (client/app/src). Idempotent: run it again after re-copying upstream.
 *
 *   npx tsx tools/client-strip.ts          rewrite the files, print a summary
 *   npx tsx tools/client-strip.ts --check  exit 1 if anything is left to rewrite (used by tests)
 *
 * Every string literal, template piece and JSX text is checked:
 * - The whole literal is an upstream species/move/ability/item name (any case): if one of our moves, abilities or items
 *   runs on that mechanic, it becomes ours (our display name, or our id for a lowercase id), because the battle server
 *   only ever sends our names. Otherwise a capitalised name becomes the inert "(none)"; lowercase internal ids stay
 *   (players never see them, the same rule the engine's leak test uses).
 * - Franchise words (Pokémon, Pokédex, Poké Ball, Tera...) in player-visible text become ours (src/player-text.ts).
 * - Anything else that still contains an upstream species name is reported (and fails --check).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { ABILITIES, ITEMS, MOVES } from "../roster/library";
import { findLeaks, isUpstreamName } from "./leak-scan";

const SRC = path.resolve(__dirname, "../client/app/src");
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const INERT = "(none)";
/** UI words (buttons, role labels, stat signs) that are also upstream names: ordinary English, kept. */
export const KEEP = new Set(["Stall", "Refresh", "Return", "Plus", "Minus", "Filter", "Swift", "Charge", "Magnet", "PLUS", "MINUS"]);

/** upstream mechanic id -> our display name (first one wins: our "main" user of that mechanic). */
export const BASE_TO_OURS = new Map<string, string>();
for (const spec of [...MOVES, ...ABILITIES, ...ITEMS]) if (!BASE_TO_OURS.has(spec.base)) BASE_TO_OURS.set(spec.base, spec.name);

const WORDS: [RegExp, string][] = [
	[/\bPok(?:[eé]|&eacute;)mon Showdown\b/g, "Duel Exchange"],
	[/\bPok(?:[eé]|&eacute;) ?Balls?\b/g, "capsule"],
	[/\bPok(?:[eé]|&eacute;)dex\b/g, "Dex"],
	[/\b(\d+) Pok(?:[eé]|&eacute;)mon\b/g, "$1 creatures"],
	[/\bPok(?:[eé]|&eacute;)mon\b/g, "Creature"],
	[/\bpok(?:[eé]|&eacute;)mon\b(?=[ ,.!?)'])/g, "creature"],
	[/\bTerastalli[sz]ed\b/g, "Type-changed"],
	[/\bTerastalli[sz]e\b/g, "Change type"],
	[/\bTerastal\b/g, "Type change"],
	[/\bTera Types?\b/g, "Change type"],
	[/\bTera\b(?![_A-Za-z])/g, "Change"],
];

/**
 * Hand edits, applied before the literal pass (exact text, must match once). Kept here so the whole strip can be
 * re-run on a fresh upstream copy.
 */
const HAND: [file: string, from: string | RegExp, to: string][] = [
	["battle-tooltips.ts", "(More than 4 moves is usually a sign of Illusion Zoroark/Zorua.)", "(More than 4 moves usually means a disguise ability is in play.)"],
	["panel-battle.tsx", "Meloetta is PS's mascot! The Pirouette forme is Fighting-type, and represents our battles.", "Battles in progress"],
	["panel-rooms.tsx", "Meloetta is PS's mascot! The Pirouette forme is Fighting-type, and represents our battles.", "Battles in progress"],
	["panel-rooms.tsx", "Meloetta is PS's mascot! The Aria forme is about using its voice, and represents our chatrooms.", "Players online"],
	["battle-teams.ts", "line.startsWith('Hidden Power [')", "line.startsWith('(none) [')"],
	["battle-tooltips.ts", "auraBoosted + ' + Aura Break'", "auraBoosted + ' (weakened)'"],
	["battle-animations.ts", "=== 'Xerneas-*'", "=== '(none)-*'"],
	["battle-animations.ts", "Dex.getPokemonIcon('zoroark')", "Dex.getPokemonIcon('pokeball-none')"],
	["battle-animations-moves.ts", "url: `https://${Config.routes.client}/sprites/gen5/tatsugiri${['-droopy', '-stretchy', ''][Math.floor(Math.random() * 3)]}.png`,", "url: '/fx/wisp.png',"],
	// Credits for upstream effect art we don't ship (ours is drawn by tools/draw-client-art.py).
	["battle-animations.ts", /(url: '[a-z0-9-]+\.png',) \/\/[^\n]*/g, "$1"],
];

/**
 * Wiring: point the client at our own server and art. Each entry is [file, exact upstream text, our text].
 */
const WIRING: [file: string, from: string, to: string][] = [
	// imports of our glue (src/dx.ts)
	["battle-dex.ts", 'import { BattleLog } from "./battle-log";\n', 'import { BattleLog } from "./battle-log";\nimport { DX } from "./dx";\n'],
	["client-main.ts", "import { Teams } from './battle-teams';\n", "import { Teams } from './battle-teams';\nimport { DX } from './dx';\n"],
	["panel-mainmenu.tsx", 'import { BattleLog } from "./battle-log"; // optional\n', 'import { BattleLog } from "./battle-log"; // optional\nimport { DX } from "./dx";\n'],
	["panel-battle.tsx", 'import preact from "../js/lib/preact";\n', 'import preact from "../js/lib/preact";\nimport { DX } from "./dx";\n'],
	// the bundler needs a real export (upstream relies on a page global): the page sets window.Config
	["client-main.ts", "export declare const Config: PSConfig;", "export { DXConfig as Config } from './dx'; // runs before every other module"],
	// break the import cycle (the move table reads BattleOtherAnims when it loads): read it from the page at run time
	["battle-animations.ts", "import { BattleMoveAnims } from './battle-animations-moves';\n", "// Duel Exchange: the move table loads after this module (see client/gen/entry.ts) and is read from the page.\nconst BattleMoveAnims: AnimTable = new Proxy({}, { get: (_t, k) => (window as any).BattleMoveAnims?.[k] }) as any;\n"],
	["client-connection.ts", "\nPSConnection.connect();\n", "\n// Duel Exchange: PSConnection.connect() runs from client/gen/entry.ts once every module has loaded.\n"],
	// client-main used panel-chat at load time through this import, which ran every panel before PS existed
	["client-main.ts", "import { ChatRoom } from './panel-chat';\n", "import type { ChatRoom as ChatRoomT } from './panel-chat';\n// Duel Exchange: read at run time (panel-chat loads after this module; see client/gen/entry.ts).\ntype ChatRoom = ChatRoomT;\nconst ChatRoom: typeof ChatRoomT = new Proxy({} as any, {\n\tget: (_t, k) => (window as any).DXChatRoom[k],\n\tset: (_t, k, v) => { (window as any).DXChatRoom[k] = v; return true; },\n});\n"],
	["panel-chat.tsx", "\nPS.addRoomType(ChatPanel);", "\n(window as any).DXChatRoom = ChatRoom;\nPS.addRoomType(ChatPanel);"],
	["client-core.ts", "const bgs = ['horizon', 'ocean', 'shaymin', 'charizards'];", "const bgs = ['field']; // Duel Exchange: our page background"],
	["client-connection.ts", "} else if (`${location.protocol}//${location.hostname}` === PSStorage.origin) {", "} else if (location.origin === PSStorage.origin) {"],
	["client-main.ts", "protocol: 'http' | 'https' = Config.defaultserver.httpport ? 'https' : 'http';", "protocol: 'http' | 'https' = Config.defaultserver.protocol === 'http' ? 'http' : 'https';"],
	["panel-topbar.tsx", "preact.render(<PSView />, document.body, document.getElementById('ps-frame')!);", "// Duel Exchange: <PSView /> is rendered from client/gen/entry.ts once panels.tsx has loaded (import cycle)."],
	// our main menu: battle, teambuilder, ladder, watch; the board panel; our footer
	["panel-mainmenu.tsx", "\t\t\t\t\t<div class=\"menugroup\">\n\t\t\t\t\t\t<p><a class=\"mainmenu2 mainmenu button\" href=\"teambuilder\">{TL`[Teambuilder]`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu3 mainmenu\" + onlineButton} href=\"ladder\">{TL`Ladder`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu4 mainmenu\" + onlineButton} href=\"view-tournaments-all\">{TL`Tournaments`}</a></p>\n\t\t\t\t\t</div>\n\n\t\t\t\t\t<div class=\"menugroup\">\n\t\t\t\t\t\t<p><a class={\"mainmenu4 mainmenu\" + onlineButton} href=\"battles\">{TL`Watch a battle`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu5 mainmenu\" + onlineButton} href=\"users\">{TL`Find a user`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu6 mainmenu\" + onlineButton} href=\"view-friends-all\">{TL`Friends`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu7 mainmenu\" + onlineButton} href=\"resources\">{TL`Info & Resources`}</a></p>\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t<div class=\"mainmenu-right\" style={{ display: PS.leftPanelWidth ? 'none' : 'block' }}>\n\t\t\t\t\t<div class=\"menugroup\">\n\t\t\t\t\t\t<p><a class={\"mainmenu1 mainmenu\" + onlineButton} href=\"rooms\">{TL`Chat rooms`}</a></p>\n\t\t\t\t\t\t{PS.server.id !== 'showdown' && (\n\t\t\t\t\t\t\t<p><a class={\"mainmenu2 mainmenu\" + onlineButton} href=\"lobby\">{TL`Lobby chat`}</a></p>\n\t\t\t\t\t\t)}\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t<div class=\"mainmenu-footer\">\n\t\t\t\t\t<div class=\"bgcredit\">{this.renderBackgroundCredit()}</div>\n\t\t\t\t\t<small>\n\t\t\t\t\t\t<a href={`//${Config.routes.dex}/`} target=\"_blank\">{TL`Pok\u00e9dex`}</a> | {}\n\t\t\t\t\t\t<a href={`//${Config.routes.replays}/`} target=\"_blank\">{TL`Replays`}</a> | {}\n\t\t\t\t\t\t<a href=\"//smogon.com/forums/\" target=\"_blank\">{TL`Forum`}</a> | {}\n\t\t\t\t\t\t<a href={`//${Config.routes.root}/rules`} target=\"_blank\">{TL`Rules`}</a> | {}\n\t\t\t\t\t\t<a href={`//${Config.routes.root}/credits`} target=\"_blank\">{TL`Credits`}</a> | {}\n\t\t\t\t\t\t<a href={`//${Config.routes.root}/privacy`} target=\"_blank\">{TL`Privacy`}</a>\n\t\t\t\t\t</small>\n\t\t\t\t\t<CCPAIntercept />\n\t\t\t\t</div>", "\t\t\t\t\t<div class=\"menugroup\">\n\t\t\t\t\t\t<p><a class=\"mainmenu2 mainmenu button\" href=\"teambuilder\">{TL`[Teambuilder]`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu3 mainmenu\" + onlineButton} href=\"ladder\">{TL`Ladder`}</a></p>\n\t\t\t\t\t\t<p><a class={\"mainmenu4 mainmenu\" + onlineButton} href=\"battles\">{TL`Watch a battle`}</a></p>\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t<div class=\"mainmenu-right\" style={{ display: PS.leftPanelWidth ? 'none' : 'block' }}>\n\t\t\t\t\t<div class=\"menugroup dx-board\">\n\t\t\t\t\t\t<h3>Duel Exchange</h3>\n\t\t\t\t\t\t<p>Free to play, skill-based. Pick a format and press Battle. Nobody around? The house bot takes the game after 20 seconds (house games are never rated).</p>\n\t\t\t\t\t\t<p>Rated games count for the ladder. The weekly board and payouts live on the site.</p>\n\t\t\t\t\t\t<p><a class=\"button\" href=\"https://duel-exchange.vercel.app/board\" target=\"_blank\" rel=\"noopener\">Weekly board</a> {}\n\t\t\t\t\t\t\t<a class=\"button\" href=\"https://duel-exchange.vercel.app/rules\" target=\"_blank\" rel=\"noopener\">Rules</a></p>\n\t\t\t\t\t\t<p class=\"dx-note\">Your name and login are kept on this device only.</p>\n\t\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t<div class=\"mainmenu-footer\">\n\t\t\t\t\t<small>\n\t\t\t\t\t\t<a href=\"https://duel-exchange.vercel.app\" target=\"_blank\" rel=\"noopener\">duel-exchange.vercel.app</a> | {}\n\t\t\t\t\t\tIndependent, not affiliated. Not financial advice. | {}\n\t\t\t\t\t\tBattle client: a fork of an open-source sim client, <a href=\"https://github.com/MATRlX-codes/duel-exchange\" target=\"_blank\" rel=\"noopener\">source (AGPLv3)</a>\n\t\t\t\t\t</small>\n\t\t\t\t</div>"],
	["panel-mainmenu.tsx", "this.format = `gen${Dex.gen}randombattle`;", "this.format = 'dxrandombattle'; // Duel Exchange: our default format"],
	["client-main.ts", "\t\tthis.addRoom({\n\t\t\tid: 'rooms' as RoomID,\n\t\t\ttitle: \"Rooms\",\n\t\t\tautofocus: false,\n\t\t});\n\t\tthis.rightPanel = this.rooms['rooms']!;", "\t\t// Duel Exchange: no chat-rooms list on the right (our server has no chat rooms)."],
	["client-main.ts", "\t\tif (!this.connection) {\n\t\t\tPS.alert(TL`You are not connected and cannot send ${msg}.`);", "\t\tif (!this.connection) {\n\t\t\tif (msg.startsWith('/cmd ')) return; // Duel Exchange: background queries before the socket opens\n\t\t\tif (msg.startsWith('/join ')) { ((window as any).DXPendingJoins ||= []).push(`${roomid || ''}|${msg}`); return; } // Duel Exchange: a room opened from the URL (e.g. a replay link) joins once the socket is up\n\t\t\tPS.alert(TL`You are not connected and cannot send ${msg}.`);"],
	["battle-animations.ts", "\t\t\tif (!this.bgm) this.rollBgm();\n\t\t\tthis.bgm!.resume();", "\t\t\tif (!this.bgm) this.rollBgm();\n\t\t\tthis.bgm?.resume(); // Duel Exchange: no music, so no bgm"],
	["battle-animations.ts", "(() => {\n\tif (!window.Dex || !Dex.resourcePrefix) return;\n\tfor (const id in BattleEffects) {", "// Duel Exchange: run from client/gen/entry.ts once Dex has loaded (import cycle).\n(window as any).DXPrefixEffects = () => (() => {\n\tif (!Dex?.resourcePrefix) return;\n\tfor (const id in BattleEffects) {"],
	["battle-sound.ts", "\t\tif (!window.HTMLAudioElement) return;\n\t\tif (this.soundCache[url]) return this.soundCache[url];", "\t\tif (url) return undefined; // Duel Exchange: no sound files (the upstream ones aren't ours)\n\t\tif (this.soundCache[url]) return this.soundCache[url];"],
	["panels.tsx", "const newTitle = roomid === '' ? 'Showdown!' : `${room.getTitle()} - Showdown!`;", "const newTitle = roomid === '' ? 'Duel Exchange: battle' : `${room.getTitle()} - Duel Exchange`;"],
	// every resource from our own server
	["battle-dex.ts", "return `${prefix}//${window.Config ? Config.routes.client : 'play.pokemonshowdown.com'}/`;", "return prefix ? '/' : '/';"],
	["battle-dex.ts", "return `${protocol}//${window.Config ? Config.routes.client : 'play.pokemonshowdown.com'}/fx/`;", "return protocol ? '/fx/' : '/fx/';"],
	["battle-dex.ts", "resolveAvatar(avatar: string): string {\n", "resolveAvatar(avatar: string): string {\n\t\tif (avatar !== '#') return '/img/avatar.svg'; // Duel Exchange: one avatar of our own\n"],
	["battle-dex.ts", "\t\tconst species = Dex.species.get(pokemon);\n\t\t// Gmax sprites", "\t\tconst species = Dex.species.get(pokemon);\n\t\t// Duel Exchange: our animated sprites (tools/draw-client-art.py), served by the game server.\n\t\tif (species) {\n\t\t\treturn {\n\t\t\t\tgen: mechanicsGen, w: 96, h: 96, y: 0, url: DX.spriteUrl(species.name || String(pokemon), !isFront, !!options.shiny),\n\t\t\t\tpixelated: true, isFrontSprite: isFront, cryurl: '', shiny: options.shiny,\n\t\t\t};\n\t\t}\n\t\t// Gmax sprites"],
	["battle-dex.ts", "getPokemonIcon(pokemon: string | Pokemon | ServerPokemon | Dex.PokemonSet | null, facingLeft?: boolean) {\n", "getPokemonIcon(pokemon: string | Pokemon | ServerPokemon | Dex.PokemonSet | null, facingLeft?: boolean) {\n\t\tif (typeof pokemon === 'string' && pokemon.startsWith('pokeball')) {\n\t\t\treturn `background:transparent url(/img/capsule${pokemon.slice(8)}.png) no-repeat scroll 0px 0px`;\n\t\t}\n"],
	["battle-dex.ts", "return `background:transparent url(${Dex.resourcePrefix}sprites/pokemonicons-sheet.png?v22) no-repeat scroll -${left}px -${top}px${fainted}`;", "return !id ? 'background:transparent url(/img/capsule-none.png) no-repeat scroll 0px 0px' : (left + top) >= 0 ? `background:transparent url(${DX.iconUrl(id)}) no-repeat scroll 0px 0px${fainted}` : '';"],
	["battle-dex.ts", "return `background-image:url(${Dex.resourcePrefix}${data.spriteDir}${shiny}/${data.spriteid}.png);background-position:${data.x + xOffset}px ${data.y + yOffset}px;background-repeat:no-repeat;${resize}`;", "return `background-image:url(/sprites/${DX.spriteId(pokemon.species || pokemon)}/still.png);background-position:${xOffset}px ${yOffset}px;background-repeat:no-repeat;${shiny ? '' : resize ? '' : ''}`;"],
	["battle-dex.ts", "return `background:transparent url(${Dex.resourcePrefix}sprites/itemicons-sheet.png?v1) no-repeat scroll -${left}px -${top}px`;", "return (left + top) >= 0 ? `background:transparent url(/fx/item.png) no-repeat scroll 0px 0px;background-size:24px 24px` : '';"],
	["battle-animations.ts", "\t\tthis.backdropImage = bg;", "\t\tthis.backdropImage = bg = 'fx/bg-field.png'; // Duel Exchange: our field"],
	["battle.ts", "\t\tlet weather = toID(weatherName);\n", "\t\tlet weather = DX.weatherId(toID(weatherName));\n"],
	["battle.ts", "import { Teams } from './battle-teams';\n", "import { Teams } from './battle-teams';\nimport { DX } from './dx';\n"],
	// connection: plain WebSocket to our server, same origin; no login server
	["client-connection.ts", "static readonly origin = `https://${Config.routes.client}`;", "static readonly origin = `${location.protocol}//${Config.routes.client}`;"],
	["client-connection.ts", "\ttryConnectInWorker(): boolean {\n", "\ttryConnectInWorker(): boolean {\n\t\tif (this) return false; // Duel Exchange: direct WebSocket only\n"],
	["client-connection.ts", "\trawQuery(act: string, data: PostData): Promise<string | null> {\n", "\trawQuery(act: string, data: PostData): Promise<string | null> {\n\t\tif (act) return Promise.resolve(null); // Duel Exchange: no login server (accounts: POST /api/account, then /trn)\n"],
	// accounts: a saved account logs straight in; a new name makes an account on our server
	["client-main.ts", "\t\tPSLoginServer.rawQuery(\n\t\t\t'getassertion', { userid, challstr: this.challstr }\n\t\t).then(res => {\n\t\t\tthis.handleAssertion(name, res);\n\t\t\tthis.updateRegExp();\n\t\t});", "\t\t// Duel Exchange: accounts live on our server (POST /api/account); the token is kept on this device.\n\t\tconst go = (a: { name: string, token: string }) => {\n\t\t\tthis.loggingIn = null;\n\t\t\tPS.send(DX.trn(a));\n\t\t\tthis.update({ success: true });\n\t\t};\n\t\tconst saved = DX.account();\n\t\tif (saved && toID(saved.name) === userid) return go(saved);\n\t\tvoid DX.createAccount(name).then(r => {\n\t\t\tif (r.account) return go(r.account);\n\t\t\tthis.loggingIn = null;\n\t\t\tthis.updateLogin({ name, error: r.error });\n\t\t});"],
	["panel-mainmenu.tsx", "\t\t\tPSLoginServer.query(\n\t\t\t\t'upkeep', { challstr }\n\t\t\t).then(res => {", "\t\t\tconst saved = DX.account(); // Duel Exchange: log back in with this device's account\n\t\t\tif (saved) PS.send(DX.trn(saved));\n\t\t\telse PS.user.initializing = false;\n\t\t\tif (!saved) return true;\n\t\t\tvoid Promise.resolve(null as any).then(res => {"],
	// our server sends the request's creature list as "creatures"
	["panel-battle.tsx", "const request = args[0] === 'request' && args[1] ? JSON.parse(args[1]) : null;", "const request = args[0] === 'request' && args[1] ? DX.adaptRequest(JSON.parse(args[1])) : null;"],
	// pictures in panels
	["panel-mainmenu.tsx", "src={`//${Config.routes.client}/sprites/gen5/teddiursa.png`}", "src=\"/img/avatar.svg\""],
	["panel-popups.tsx", 'src="https://play.pokemonshowdown.com/sprites/gen5ani/pikachu.gif"', 'src="/sprites/kettling/front.gif"'],
	["panel-topbar.tsx", "src={`https://${Config.routes.client}/iconbeta.png`}", "src=\"/img/lockup.svg\""],
	["panel-topbar.tsx", "src={`https://${Config.routes.client}/iconbeta.png`}", "src=\"/img/lockup.svg\""],	// ladders and replays from our game server (M3)
	["panel-chat.tsx", "<CopyableURLBox url={`https://psim.us/r/${room.id.slice(7)}`} />", "<CopyableURLBox url={`${location.origin}/${room.id}`} />"],
	["client-connection.ts", "\t\tfor (const msg of queue) this.send(msg);\n\n\t\tPS.prefs.doAutojoin();", "\t\tfor (const msg of queue) this.send(msg);\n\t\tfor (const msg of (window as any).DXPendingJoins?.splice(0) || []) this.send(msg); // Duel Exchange: see PS.send\n\n\t\tPS.prefs.doAutojoin();"],
	["panel-ladder.tsx", "import { SanitizedHTML } from \"./panel-page\";\n", "import { SanitizedHTML } from \"./panel-page\";\nimport { DX } from \"./dx\";\n"],
	["panel-ladder.tsx", "\t\t\tNet(`//pokemonshowdown.com/ladder/${this.format}.json`)\n\t\t\t\t.get({\n\t\t\t\t\tquery: {\n\t\t\t\t\t\tprefix: toID(searchValue),\n\t\t\t\t\t},\n\t\t\t\t})\n\t\t\t\t.then(this.setLadderData)", "\t\t\t// Duel Exchange: our game server's ladder (GET /api/ladder/<format>), in the shape this panel reads.\n\t\t\tNet(`/api/ladder/${this.format}`)\n\t\t\t\t.get({\n\t\t\t\t\tquery: {\n\t\t\t\t\t\tprefix: toID(searchValue),\n\t\t\t\t\t\tlimit: 500,\n\t\t\t\t\t},\n\t\t\t\t})\n\t\t\t\t.then(raw => this.setLadderData(DX.ladderJSON(this.format!, raw)))"],
	["panel-ladder.tsx", "\t\t\t\t<p>\n\t\t\t\t\t<button class=\"button\" data-href=\"ladder\" data-target=\"replace\">\n\t\t\t\t\t\t<i class=\"fa fa-refresh\" aria-hidden></i> {TL`[Refresh]`}\n\t\t\t\t\t</button> <a class=\"button\" href=\"/view-seasonladder-gen9randombattle\">\n\t\t\t\t\t\t<i class=\"fa fa-trophy\" aria-hidden></i> {TL`[Seasonal rankings]`}\n\t\t\t\t\t</a>", "\t\t\t\t<p>\n\t\t\t\t\t<button class=\"button\" onClick={() => room.requestLadderData(room.searchValue)}>\n\t\t\t\t\t\t<i class=\"fa fa-refresh\" aria-hidden></i> {TL`[Refresh]`}\n\t\t\t\t\t</button> <a class=\"button dx-outline\" href=\"https://duel-exchange.vercel.app/board\" target=\"_blank\" rel=\"noopener\">\n\t\t\t\t\t\t<i class=\"fa fa-trophy\" aria-hidden></i> Weekly board\n\t\t\t\t\t</a>"],
	["panel-ladder.tsx", "\t\t\t\t{showCOIL && <th style={{ textAlign: 'center' }}>COIL</th>}", "\t\t\t\t{showCOIL && <th style={{ textAlign: 'center' }}>COIL</th>}\n\t\t\t\t<th style={{ textAlign: 'center' }}><abbr title=\"Wins - losses (ties)\">W-L</abbr></th>"],
	["panel-ladder.tsx", "\t\t\t\t{showCOIL && <td style={{ textAlign: 'center' }}>{row.coil?.toFixed(0)}</td>}", "\t\t\t\t{showCOIL && <td style={{ textAlign: 'center' }}>{row.coil?.toFixed(0)}</td>}\n\t\t\t\t<td style={{ textAlign: 'center' }} class=\"dx-wl\">{row.w}-{row.l}{row.t ? <small> ({row.t})</small> : null}</td>"],
	["panel-ladder.tsx", "{!room.ladderData.toplist.length && <tr><td colSpan={5}>\n\t\t\t\t<em>{TL`No one has played any ranked games yet.`}</em>\n\t\t\t</td></tr>}", "{!room.ladderData.toplist.length && <tr><td colSpan={6} class=\"dx-empty\">\n\t\t\t\t<strong>No rated games in this format yet.</strong><br />\n\t\t\t\tA game is rated when both players have a name. Games against the house bot never count.\n\t\t\t</td></tr>}"],
	["panel-ladder.tsx", "\t\t\t\t<p>\n\t\t\t\t\t<a class=\"button\" href={`//${Config.routes.users}/`} target=\"_blank\">\n\t\t\t\t\t\t{TL`[Look up a specific user's rating]`}\n\t\t\t\t\t</a>\n\t\t\t\t</p>\n\t\t\t\t<p>\n\t\t\t\t\t<button data-href=\"view-ladderhelp\" class=\"button\">\n\t\t\t\t\t\t<i class=\"fa fa-info-circle\" aria-hidden></i> {TL`[How the ladder works]`}\n\t\t\t\t\t</button>\n\t\t\t\t</p>", "\t\t\t\t<div class=\"dx-board dx-ladder-help\">\n\t\t\t\t\t<h3>How the ladder works</h3>\n\t\t\t\t\t<p>Each format has its own ladder. Everyone starts at 1000 Elo and every rated game moves it. A game is rated when both players have a name; games against the house bot never count.</p>\n\t\t\t\t\t<p>GXE is your estimated chance of beating a random player on that ladder. Glicko-1 shows rating &plusmn; deviation.</p>\n\t\t\t\t\t<p><a class=\"button\" href=\"https://duel-exchange.vercel.app/board\" target=\"_blank\" rel=\"noopener\">Weekly board</a> {}\n\t\t\t\t\t\t<a class=\"button\" href=\"https://duel-exchange.vercel.app/rules\" target=\"_blank\" rel=\"noopener\">Rules</a></p>\n\t\t\t\t</div>"],
	["panel-battle.tsx", "\t\tNet(`https://replay.pokemonshowdown.com/${replayid}.json`).get().catch(() => '').then(data => {\n\t\t\ttry {\n\t\t\t\tconst replay = JSON.parse(data);", "\t\t// Duel Exchange: saved replays come from our game server (GET /api/replay/<battle id>).\n\t\tNet(`/api/replay/battle-${replayid}`).get().catch(() => '').then(data => {\n\t\t\ttry {\n\t\t\t\tconst replay = DX.replay(JSON.parse(data));"],
	["panel-battle.tsx", "{TL`[Upload and share replay]`}", "{TL`[Save and share replay]`}"],
];

function applyWiring() {
	for (const [f, from, to] of WIRING) {
		const file = path.join(SRC, f);
		const s = fs.readFileSync(file, "utf8");
		if (s.includes(to)) continue; // already wired (re-runs must not stack the same edit)
		if (!s.includes(from)) {
			if (!s.includes(to)) console.log(`  WIRING not found in ${f}: ${from.slice(0, 70).replace(/\n/g, "\\n")}`);
			continue;
		}
		fs.writeFileSync(file, s.replace(from, to));
	}
	// Battle music: the upstream track list names franchise soundtracks. No music (setBgm does nothing).
	const file = path.join(SRC, "battle-animations.ts");
	let s = fs.readFileSync(file, "utf8");
	const key = "\tsetBgm(bgmNum: number) {";
	const start = s.indexOf(key);
	if (start >= 0 && !s.slice(start, start + 200).includes("No battle music")) {
		let k = start + key.length - 1, depth = 0;
		for (; k < s.length; k++) { if (s[k] === "{") depth++; else if (s[k] === "}" && --depth === 0) break; }
		s = s.slice(0, start) + key + "\n\t\t// Duel Exchange: No battle music (the upstream list is franchise soundtracks).\n\t\tthis.bgmNum = bgmNum;\n\t}" + s.slice(k + 1);
		fs.writeFileSync(file, s);
	}
}

function applyHand() {
	for (const [f, from, to] of HAND) {
		const file = path.join(SRC, f);
		const s = fs.readFileSync(file, "utf8");
		if (typeof from === "string" && !s.includes(from)) continue; // already applied
		fs.writeFileSync(file, s.replace(from, to));
	}
	// April Fools' joke mode: the method body names franchise creatures. Replace the whole method.
	const file = path.join(SRC, "battle-log.ts");
	let s = fs.readFileSync(file, "utf8");
	const key = "\taddAFDMessage(args: Args, kwArgs: KWArgs = {}) {";
	const start = s.indexOf(key);
	if (start >= 0 && !s.slice(start, start + 300).includes("No joke mode")) {
		let k = start + key.length - 1, depth = 0;
		for (; k < s.length; k++) { if (s[k] === "{") depth++; else if (s[k] === "}" && --depth === 0) break; }
		s = s.slice(0, start) + key + "\n\t\t// Duel Exchange: the upstream April Fools' jokes are removed (they name franchise creatures). No joke mode.\n\t\treturn false;\n\t}" + s.slice(k + 1);
		fs.writeFileSync(file, s);
	}
}

function rewriteText(text: string, inCode: boolean, remapIds = true): string {
	// "ability: X" / "move: X" / "item: X" effect strings: map the name part.
	text = text.replace(/\b(move|ability|item): ?([A-Z][^,|'"`\]]*[A-Za-z])/g, (m, kind, name) => {
		if (!isUpstreamName(name)) return m;
		return `${kind}: ${BASE_TO_OURS.get(toId(name)) ?? INERT}`;
	});
	const t = text.trim();
	// Only a literal that is just a name counts: protocol commands ("-block"), chat commands ("/refresh") and
	// bracketed UI labels are syntax. KEEP: plain English UI words that happen to be upstream names.
	const nameLike = /^[A-Za-z][A-Za-z0-9 '’.:-]*$/.test(t) && !KEEP.has(t);
	if (nameLike && t.length >= 4 && isUpstreamName(t)) {
		const ours = BASE_TO_OURS.get(toId(t));
		const lowerId = t === toId(t);
		if (ours && (remapIds || !lowerId)) return text.replace(t, lowerId ? toId(ours) : ours);
		if (!lowerId) return text.replace(t, INERT);
		return text;
	}
	// Links to the upstream sites point at ours instead.
	text = text.replace(/(?:https?:)?\/\/(?:[a-z0-9-]+\.)*(?:pokemonshowdown|smogon)\.com[^\s"'`<>)]*/g, "https://duel-exchange.vercel.app")
		.replace(/\b(?:[a-z0-9-]+\.)*(?:pokemonshowdown|smogon)\.com\b/g, "duel-exchange.vercel.app");
	// Player-visible words. Lowercase-only literals are ids/keys ("pokemon" search type, protocol words): leave them.
	if (/[A-Z ]/.test(text) || !inCode) for (const [re, to] of WORDS) text = text.replace(re, to);
	return text;
}

function quote(s: string, q: string) {
	return q + s.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), "\\" + q).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + q;
}

export function stripFile(file: string): { out: string; changes: number; leftovers: string[] } {
	const src = fs.readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const edits: { start: number; end: number; text: string }[] = [];
	const leftovers: string[] = [];
	// The move-animation table is keyed by mechanic ids; its lookups stay on those (ours are aliased at load, dx.ts).
	const remapIds = !file.endsWith("battle-animations-moves.ts");
	const visit = (n: ts.Node) => {
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
			// Skip module specifiers and property names used as keys in type positions.
			if (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || ts.isLiteralTypeNode(n.parent)) return;
			const raw = src.slice(n.getStart(sf), n.end);
			const q = raw[0];
			const value = n.text;
			const next = rewriteText(value, true, remapIds);
			if (next !== value) {
				if (q === "`") edits.push({ start: n.getStart(sf) + 1, end: n.end - 1, text: next.replace(/[`\\$]/g, c => "\\" + c) });
				else edits.push({ start: n.getStart(sf), end: n.end, text: quote(next, q === "'" ? "'" : '"') });
			}
			const left = findLeaks(next, "text").filter(x => /[A-Z]/.test(next) && !KEEP.has(x.replace(/[^A-Za-z ]/g, "").trim()));
			if (left.length) leftovers.push(`${path.basename(file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${left.join(", ")}`);
			return;
		}
		if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
			const start = ts.isJsxText(n) ? n.pos : n.getStart(sf);
			const raw = src.slice(start, n.end);
			let body = raw, pre = "", post = "";
			if (!ts.isJsxText(n)) {
				pre = raw.startsWith("`") || raw.startsWith("}") ? raw[0] : "";
				post = raw.endsWith("${") ? "${" : raw.endsWith("`") ? "`" : "";
				body = raw.slice(pre.length, raw.length - post.length);
			}
			const next = rewriteText(body, false);
			if (next !== body) edits.push({ start: start + pre.length, end: n.end - post.length, text: next });
			const left = findLeaks(next, "text").filter(x => /[A-Z]/.test(next) && !KEEP.has(x.replace(/[^A-Za-z ]/g, "").trim()));
			if (left.length) leftovers.push(`${path.basename(file)}:${sf.getLineAndCharacterOfPosition(start).line + 1} ${left.join(", ")}`);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	let out = src;
	for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	return { out, changes: edits.length, leftovers };
}

if (require.main === module) {
	const check = process.argv.includes("--check");
	if (!check) { applyHand(); applyWiring(); }
	let total = 0;
	const left: string[] = [];
	for (const f of fs.readdirSync(SRC).filter(f => /\.tsx?$/.test(f) && !f.endsWith(".d.ts")).sort()) {
		const file = path.join(SRC, f);
		const r = stripFile(file);
		total += r.changes;
		left.push(...r.leftovers);
		if (r.changes) {
			console.log(`${f}: ${r.changes} literal(s)`);
			if (!check) fs.writeFileSync(file, r.out);
		}
	}
	console.log(`${check ? "would rewrite" : "rewrote"} ${total} literal(s); ${left.length} left for hand edits`);
	for (const l of left) console.log("  LEFT " + l);
	if (check && (total || left.length)) process.exit(1);
}
