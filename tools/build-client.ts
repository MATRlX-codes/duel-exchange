/**
 * Builds the battle client (the AGPL fork in client/app, our glue in client/app/src/dx.ts) into dist/client/, which
 * the battle server serves at "/". Everything it loads comes from our own server.
 *
 *   dist/client/index.html          our page (config inline)
 *   dist/client/js/dx-client.js     one esbuild bundle of client/app/src
 *   dist/client/js/lib/*            preact, jQuery, the sanitizer, the polyfill (upstream libs, MIT/Apache)
 *   dist/client/data/dx-data.js     our dex, text and teambuilder data (client/gen, from tools/gen-client-data.ts)
 *   dist/client/style/*             the client's CSS with every upstream image URL removed, plus style/dx.css
 *   dist/client/{fx,img,sprites}    our art (client/public, from tools/draw-client-art.py)
 *
 * After building, the franchise-name leak scan runs over everything it wrote and fails the build on a hit.
 *   npx tsx tools/build-client.ts
 */
import { build, type BuildOptions } from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { findLeaks } from "./leak-scan";
import { FORBIDDEN } from "../src/player-text";

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "client/app");
const OUT = path.join(ROOT, "dist/client");

// Upstream load order (the panels register themselves when their module runs).
const MODULES = [
	"client-main", "battle-dex", "battle-dex-data", "battle-text-parser", "battle-log", "battle-teams", "client-core",
	"client-connection", "panels", "panel-mainmenu", "panel-rooms", "panel-topbar", "panel-chat", "panel-battle",
	"battle", "battle-animations", "battle-tooltips", "battle-choices", "battle-sound",
	"battle-dex-search", "battle-searchresults", "battle-team-editor", "panel-teambuilder", "panel-teambuilder-team",
	"panel-teamdropdown", "panel-ladder", "panel-popups", "panel-page", "panel-resources", "panel-chat-tournament",
	"battle-animations-moves", "client-endload",
];

function copyDir(from: string, to: string, filter = (_f: string) => true) {
	fs.mkdirSync(to, { recursive: true });
	for (const e of fs.readdirSync(from, { withFileTypes: true })) {
		const a = path.join(from, e.name), b = path.join(to, e.name);
		if (e.isDirectory()) copyDir(a, b, filter);
		else if (filter(a)) fs.copyFileSync(a, b);
	}
}

const ALLOWED = /^(Sandstorm|Hail|Snow|Rain|Struggle|Recharge|Confusion|Psychic|Bite|Powder|Stall|Refresh|Return|Plus|Minus|PLUS|MINUS|Filter|Swift|Charge|Magnet)$/;

const CSS_URL_FIXES: [RegExp, string][] = [
	// upstream-hosted images (trainers sheet, mascot sprites, type icons): not ours, removed
	[/url\(https?:\/\/play\.pokemonshowdown\.com\/[^)]*\)/g, "none"],
	// client backgrounds: ours
	[/url\(\.\.\/fx\/client-bg-[^)]*\)/g, "url(../fx/bg-field.png)"],
	[/url\(\.\.\/fx\/client-(topbar-bg|bgsheet)\.png\)/g, "none"],
];

const DX_CSS = `/* Duel Exchange skin over the forked client (Battle Tab palette). */
:root { --dx-field: #2f6fd0; --dx-ink: #1f2d44; --dx-page: #eef3f9; --dx-line: #b7c4d6; }
body, .ps-room, .ps-room-light { background: var(--dx-page); color: var(--dx-ink); }
body { font-family: "Rubik", ui-sans-serif, system-ui, sans-serif; }
#header, .tabbar { background: #ffffff; border-bottom: 1px solid var(--dx-line); }
/* Top bar. client.css (the old client's sheet, also loaded) floats the tab lists and reserves 144px for
   upstream's wide logo; that pushed our mark off to the side and dropped the room tabs out of sight. */
.header .tabbar.maintabbar { margin-left: 0; margin-right: 240px; height: auto; padding: 0; }
.header .overflow { right: 240px; }
.header .tabbar ul { float: none; display: block; }
.header .tabbar .maintabbar-left, .header .tabbar .maintabbar-right { float: none; display: table-cell; vertical-align: bottom; }
.header .tabbar li { float: none; display: inline-block; vertical-align: bottom; }
.header .tabbar .maintabbar-left > li:first-child { vertical-align: top; }
.header .logo { float: none; display: block; width: auto; height: 26px; margin: 12px 18px 0 16px; }
.header-vertical .logo { float: none; display: block; width: auto; max-width: calc(100% - 32px); height: 30px; margin: 16px 16px 12px; }
@media (max-width: 600px) {
  .header .logo { height: 20px; margin: 15px 10px 0 10px; }
  .header .tabbar.maintabbar { margin-right: 150px; }
  .header .overflow { right: 150px; }
}
.button { border-radius: 6px; }
.button.mainmenu1, .button.big { background: var(--dx-field); color: #fff; border-color: #2357ad; text-shadow: none; }
.button.mainmenu1:hover, .button.big:hover { background: #2357ad; }
/* Main menu in the Battle Tab palette: white panels with a 1px line, quiet secondary buttons (no upstream rainbow). */
.menugroup { background: #fff; border: 1px solid var(--dx-line); border-radius: 8px; color: var(--dx-ink); text-shadow: none; backdrop-filter: none; box-shadow: 0 1px 2px rgba(31,45,68,.06); }
.menugroup .label { color: #6a7a92; font-weight: 600; font-size: 12px; text-shadow: none; }
.button.mainmenu2, .button.mainmenu3, .button.mainmenu4, .button.mainmenu5, .button.mainmenu6 { background: #fff; color: var(--dx-ink); border: 1px solid var(--dx-line); text-shadow: none; box-shadow: none; font-weight: 500; }
.button.mainmenu2:hover, .button.mainmenu3:hover, .button.mainmenu4:hover, .button.mainmenu5:hover, .button.mainmenu6:hover { background: #e8eff7; border-color: var(--dx-field); color: var(--dx-field); }
.button.mainmenu2:active, .button.mainmenu3:active, .button.mainmenu4:active, .button.mainmenu5:active, .button.mainmenu6:active { background: #dbe6f3; }
.button.mainmenu1, .button.big { box-shadow: 0 1px 0 #2357ad; }
.dx-board .button { display: inline-block; min-width: 120px; margin: 2px 3px; padding: 6px 12px; background: #fff; color: var(--dx-field); border: 1px solid var(--dx-field); text-shadow: none; box-shadow: none; font-weight: 600; font-size: 14px; }
.dx-board .button:hover { background: var(--dx-field); color: #fff; }
.menugroup .button.small { background: #e8eff7; color: var(--dx-ink); border: 1px solid var(--dx-line); text-shadow: none; box-shadow: none; }
.menugroup .button.small:hover { background: #dbe6f3; border-color: var(--dx-field); }
.snowcallweather { background-image: url(../fx/weather-hail.png); }
.dx-type, .dx-cat { display: inline-block; font: 700 9px/14px ui-sans-serif, system-ui; padding: 0 4px; border-radius: 3px; color: #fff; }
.dx-note { font-size: 12px; color: #5f6f87; }
.dx-board { background: #fff; border: 1px solid var(--dx-line); border-radius: 8px; padding: 12px 14px; }
.dx-board h3 { margin: 0 0 6px; font-size: 16px; color: var(--dx-field); }
.dx-board p, .dx-board .dx-note { margin: 6px 0; font-size: 13px; line-height: 1.45; color: var(--dx-ink); text-shadow: none; }
`;

function indexHtml() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Duel Exchange: battle</title>
<meta name="description" content="Duel Exchange battle client. Free to play, skill-based. Independent, not affiliated.">
<link rel="icon" href="/img/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style/font-awesome.css">
<link rel="stylesheet" href="/style/client.css">
<link rel="stylesheet" href="/style/client2.css">
<link rel="stylesheet" href="/style/battle.css">
<link rel="stylesheet" href="/style/battle-log.css">
<link rel="stylesheet" href="/style/sim-types.css">
<link rel="stylesheet" href="/style/teambuilder.css">
<link rel="stylesheet" href="/style/battle-search.css">
<link rel="stylesheet" href="/style/utilichart.css">
<link rel="stylesheet" href="/style/dx.css">
<script>
var Config = {
  testclient: false,
  routes: { root: location.host, client: location.host, dex: location.host, replays: location.host, users: location.host, teams: location.host },
  customcolors: {},
  whitelist: [],
  defaultserver: (function () {
    var https = location.protocol === 'https:';
    var port = Number(location.port) || (https ? 443 : 80);
    return { id: 'duelexchange', protocol: https ? 'https' : 'http', host: location.hostname, port: port, httpport: port, altport: port, prefix: '/showdown', registered: false };
  })(),
};
Config.server = Config.defaultserver;
</script>
</head>
<body>
<div id="ps-frame"></div>
<noscript>The battle client needs JavaScript.</noscript>
<script src="/js/lib/ps-polyfill.js"></script>
<script src="/js/lib/preact.min.js"></script>
<script src="/js/lib/jquery-2.2.4.min.js"></script>
<script src="/js/lib/html-css-sanitizer-minified.js"></script>
<script src="/js/lib/d3.v3.min.js"></script>
<script src="/js/battle-log-misc.js"></script>
<script src="/data/dx-data.js"></script>
<script src="/js/dx-client.js"></script>
</body>
</html>
`;
}

export async function buildClient() {
	fs.rmSync(OUT, { recursive: true, force: true });
	fs.mkdirSync(path.join(OUT, "js/lib"), { recursive: true });

	const entry = path.join(ROOT, "client/gen/entry.ts");
	fs.writeFileSync(entry,
		"// GENERATED by tools/build-client.ts\n" +
		`import "../app/src/dx";\n` + MODULES.map(m => `import "../app/src/${m}";`).join("\n") + "\n" +
		`import { BattleMoveAnims } from "../app/src/battle-animations-moves";\nimport { aliasMoveAnims } from "../app/src/dx";\nimport { DXMoveAnims } from "./anims";\n` +
		`(window as any).DXMoveAnims = DXMoveAnims;\naliasMoveAnims(BattleMoveAnims);\n(window as any).BattleMoveAnims = BattleMoveAnims;\n` +
		`import { PSConnection } from "../app/src/client-connection";\nPSConnection.connect();\nimport "../app/src/client-endload";\n` +
		`import { PSView } from "../app/src/panels";\nimport { PS } from "../app/src/client-main";\nimport { Dex } from "../app/src/battle-dex";\nimport { BattleLog } from "../app/src/battle-log";\nimport { BattleSound } from "../app/src/battle-sound";\nimport { BattleTooltips } from "../app/src/battle-tooltips";\n` +
		`// upstream code checks these as page globals (window.PS, window.Dex, ...)\nObject.assign(window as any, { PS, Dex, BattleLog, BattleSound, BattleTooltips });\n(window as any).DXPrefixEffects();\n` +
		`const P = (window as any).preact;\nP.render(P.h(PSView, null), document.body, document.getElementById("ps-frame"));\n`);
	const opts: BuildOptions = {
		entryPoints: [entry], bundle: true, format: "iife", target: "es2019", minify: !process.env.DX_DEBUG, sourcemap: false,
		outfile: path.join(OUT, "js/dx-client.js"), logLevel: "error",
		jsxFactory: "preact.h", jsxFragment: "preact.Fragment", loader: { ".tsx": "tsx", ".ts": "ts" },
		legalComments: "none", define: { global: "window" },
		banner: { js: "/* Duel Exchange battle client: a fork of an open-source sim client, AGPLv3 (source: game/client in the Duel Exchange repo). */" },
		plugins: [{
			name: "globals",
			setup(b) {
				b.onResolve({ filter: /\/js\/lib\/preact$/ }, () => ({ path: "preact", namespace: "global" }));
				b.onResolve({ filter: /^d3$/ }, () => ({ path: "d3", namespace: "global" }));
				b.onLoad({ filter: /.*/, namespace: "global" }, a => ({ contents: `module.exports = window[${JSON.stringify(a.path)}];`, loader: "js" }));
			},
		}],
	};
	await build(opts);
	// A readable copy for the leak scan (one literal per line, nothing merged by the minifier); not shipped.
	const plainBuild = await build({ ...opts, minify: false, write: false, outfile: path.join(OUT, "scan.js") });
	const scanSource = plainBuild.outputFiles[0].text;

	for (const f of ["ps-polyfill.js", "preact.min.js", "jquery-2.2.4.min.js", "html-css-sanitizer-minified.js", "d3.v3.min.js"]) {
		fs.copyFileSync(path.join(APP, "lib", f), path.join(OUT, "js/lib", f));
	}
	// formatText() and MD5(): an upstream plain script the log code calls as globals
	fs.copyFileSync(path.join(APP, "src/battle-log-misc.js"), path.join(OUT, "js/battle-log-misc.js"));
	fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
	fs.copyFileSync(path.join(ROOT, "client/gen/dx-data.js"), path.join(OUT, "data/dx-data.js"));
	copyDir(path.join(APP, "style"), path.join(OUT, "style"), f => !f.endsWith("oldclient.css") && !f.endsWith("replay.css"));
	for (const f of fs.readdirSync(path.join(OUT, "style")).filter(f => f.endsWith(".css"))) {
		let css = fs.readFileSync(path.join(OUT, "style", f), "utf8");
		css = css.replace(/\/\*[\s\S]*?\*\//g, "");
		for (const [re, to] of CSS_URL_FIXES) css = css.replace(re, to);
		fs.writeFileSync(path.join(OUT, "style", f), css);
	}
	fs.writeFileSync(path.join(OUT, "style/dx.css"), DX_CSS);
	copyDir(path.join(ROOT, "client/public"), OUT);
	fs.writeFileSync(path.join(OUT, "index.html"), indexHtml());
	return [...scanClient(), ...scanCode(scanSource).map(x => `js/dx-client.js: ${x}`)];
}

/** Leak scan over the built client: code files by the engine's rule, CSS/HTML for franchise words and hosts. */
export function scanClient(dir = OUT): string[] {
	const hits: string[] = [];
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			const rel = path.relative(dir, p);
			if (e.isDirectory()) { if (!/^(js\/lib|style\/fonts?)$/.test(rel)) walk(p); continue; }
			if (!/\.(js|css|html|svg)$/.test(e.name) || e.name === "dx-client.js") continue;
			const s = fs.readFileSync(p, "utf8");
			if (e.name.endsWith(".js")) hits.push(...scanCode(s).map(x => `${rel}: ${x}`));
			else hits.push(...findLeaks(s, "text").map(x => `${rel}: ${x}`));
			if (/\.(html|svg)$/.test(e.name) && WORDS_RE.test(s)) hits.push(`${rel}: franchise word`);
			const m = s.match(/pokemonshowdown\.com|smogon\.com/gi);
			if (m) hits.push(`${rel}: upstream host x${m.length}`);
		}
	};
	walk(dir);
	return hits;
}

/** Franchise words as players would read them (case-sensitive words, not identifiers like addPokemonSprite). */
const WORDS_RE = /\bPok[eé]mon\b(?![.(\w])|\bPok[eé]dex\b|\bPok[eé] ?Ball\b|\bTerastal|\bTera\b/;

/** Code: comments removed; every string literal with a capital letter checked for names and franchise words. */
function scanCode(src: string): string[] {
	src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	const hits = findLeaks(src, "code").filter(x => !ALLOWED.test(x.replace(/[^A-Za-z]/g, "")));
	for (const m of src.matchAll(/(['"`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)) if (/[A-Z]/.test(m[2]) && m[2] !== "Pokedex" && WORDS_RE.test(m[2].replace(/\$\{[^}]*\}/g, ""))) hits.push(`franchise word in "${m[2].slice(0, 80)}"`);
	const host = src.match(/pokemonshowdown\.com|smogon\.com/gi);
	if (host) hits.push(`upstream host x${host.length}`);
	return hits;
}

if (require.main === module) {
	buildClient().then(hits => {
		const size = (f: string) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + " KB";
		console.log(`client built: js/dx-client.js ${size("js/dx-client.js")}, data ${size("data/dx-data.js")}`);
		if (hits.length) {
			console.error(`LEAK SCAN: ${hits.length} hit(s)\n  ` + hits.slice(0, 60).join("\n  "));
			process.exit(1);
		}
		console.log("leak scan: clean");
	}).catch(e => { console.error(e); process.exit(1); });
}
