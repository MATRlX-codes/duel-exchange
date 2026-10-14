/**
 * Generates the forked client's data file, client/gen/dx-data.js (committed), from OUR data only:
 *   BattlePokedex, BattleMovedex, BattleAbilities, BattleItems, BattleTypeChart  (engine/data, keyed by our ids)
 *   BattleTeambuilderTable (tiers, items, learnsets), BattleSearchIndex(+Offset)  (teambuilder search)
 *   BattleText.en  battle text templates. Each of our moves/abilities/items gets the templates of the mechanic it runs
 *                  on, with the upstream name swapped for ours; the default templates go through src/player-text.ts.
 *   DXMoveAnims    our move id -> the mechanic id whose animation it plays (read by client/app/src/dx.ts)
 * Needs .upstream/ (tools/fetch-upstream.sh) for the text templates. Fails if any upstream name survives.
 *
 *   npx tsx tools/gen-client-data.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { transformSync } from "esbuild";
import { Aliases } from "../engine/data/aliases";
import { Abilities } from "../engine/data/abilities";
import { FormatsData } from "../engine/data/formats-data";
import { Items } from "../engine/data/items";
import { Learnsets } from "../engine/data/learnsets";
import { Moves } from "../engine/data/moves";
import { Pokedex } from "../engine/data/pokedex";
import { TypeChart } from "../engine/data/typechart";
import { ABILITIES, ITEMS, MOVES } from "../roster/library";
import { playerText } from "../src/player-text";
import { findLeaks, isUpstreamName } from "./leak-scan";

const ROOT = path.resolve(__dirname, "..");
const UP = path.join(ROOT, ".upstream/pokemon-showdown/data/text");
const toId = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const INTERNAL_TO_OURS: Record<string, string> = {};
for (const [ours, internal] of Object.entries(Aliases)) INTERNAL_TO_OURS[internal] = ours;
const pub = (id: string) => INTERNAL_TO_OURS[id] ?? id;

/** Plain data only (no engine callbacks), deep. */
function plain(v: any): any {
	if (typeof v === "function") return undefined;
	if (Array.isArray(v)) return v.map(plain);
	if (v && typeof v === "object") {
		const o: any = {};
		for (const [k, x] of Object.entries(v)) {
			if (k === "condition" || k.startsWith("on") && typeof x === "function") continue;
			const p = plain(x);
			if (p !== undefined) o[k] = p;
		}
		return o;
	}
	return v;
}

const text = (list: { name: string; text: string }[]) => new Map(list.map(s => [toId(s.name), s.text]));
const MOVE_TEXT = text(MOVES), ABILITY_TEXT = text(ABILITIES), ITEM_TEXT = text(ITEMS);

// ---------------------------------------------------------------- dex tables
const pokedex: Record<string, any> = {};
for (const [key, d] of Object.entries(Pokedex) as [string, any][]) {
	const id = toId(d.name);
	pokedex[id] = { ...plain(d), tier: (FormatsData as any)[key]?.tier ?? "OU" };
}
const movedex: Record<string, any> = {};
for (const d of Object.values(Moves) as any[]) {
	const id = toId(d.name);
	const t = MOVE_TEXT.get(id) || "";
	movedex[id] = { ...plain(d), id, desc: t, shortDesc: t };
}
const abilities: Record<string, any> = {};
for (const d of Object.values(Abilities) as any[]) {
	const id = toId(d.name);
	const t = ABILITY_TEXT.get(id) || "";
	abilities[id] = { num: d.num, name: d.name, rating: d.rating ?? 3, desc: t, shortDesc: t, flags: plain(d.flags) || {} };
}
const items: Record<string, any> = {};
for (const d of Object.values(Items) as any[]) {
	const id = toId(d.name);
	const t = ITEM_TEXT.get(id) || "";
	items[id] = { ...plain(d), desc: t, shortDesc: t, spritenum: 0 };
}

// ---------------------------------------------------------------- teambuilder
const TIER_ORDER = ["Uber", "OU", "NFE", "LC"];
const tiers: any[] = [];
const formatSlices: Record<string, number> = {};
for (const tier of TIER_ORDER) {
	const ids = Object.keys(pokedex).filter(id => pokedex[id].tier === tier).sort((a, b) => pokedex[a].num - pokedex[b].num);
	if (!ids.length) continue;
	formatSlices[tier] = tiers.length;
	tiers.push(["header", tier], ...ids);
}
formatSlices.Regular = 0;
const learnsets: Record<string, Record<string, string>> = {};
for (const [key, d] of Object.entries(Learnsets) as [string, any][]) {
	const species = (Pokedex as any)[key];
	if (!species || !d.learnset) continue;
	const out: Record<string, string> = {};
	for (const m of Object.keys(d.learnset)) out[pub(m)] = "9a";
	learnsets[toId(species.name)] = out;
}
const itemList = ["header", "Items"] as any[];
const teambuilder = {
	tiers, formatSlices, overrideTier: {}, items: [itemList, ...Object.keys(items).sort()], learnsets,
};

// search index: [id, type] sorted by id, with display offsets so matches highlight on the name
const index: [string, string][] = [];
const offsets: string[] = [];
const names: Record<string, string> = {};
const add = (name: string, type: string) => { const id = toId(name); names[`${type}:${id}`] = name; index.push([id, type]); };
for (const d of Object.values(pokedex)) add(d.name, "pokemon");
for (const d of Object.values(movedex)) add(d.name, "move");
for (const d of Object.values(abilities)) add(d.name, "ability");
for (const d of Object.values(items)) add(d.name, "item");
for (const t of Object.keys(TypeChart)) add(t[0].toUpperCase() + t.slice(1), "type");
for (const c of ["Physical", "Special", "Status"]) add(c, "category");
index.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1);
for (const [id, type] of index) {
	const name = names[`${type}:${id}`];
	let off = "", j = 0;
	for (let i = 0; i < id.length; i++) {
		while (j < name.length && toId(name[j]) !== id[i]) j++;
		off += String.fromCharCode(48 + (j - i));
		j++;
	}
	offsets.push(off);
}

// ---------------------------------------------------------------- battle text
const tsCache = new Map<string, any>();
function loadTs(file: string, exportName: string): any {
	// The upstream text files are plain object literals with type annotations: strip the types and evaluate.
	if (!tsCache.has(file)) {
		const js = transformSync(fs.readFileSync(path.join(UP, file), "utf8"), { loader: "ts", format: "cjs" }).code;
		const m: any = { exports: {} };
		new Function("module", "exports", "require", js)(m, m.exports, () => ({}));
		tsCache.set(file, m.exports);
	}
	return tsCache.get(file)[exportName];
}
const upMoves = loadTs("moves.ts", "MovesText");
const upAbilities = loadTs("abilities.ts", "AbilitiesText");
const upItems = loadTs("items.ts", "ItemsText");
const upDefault = loadTs("default.ts", "DefaultText");

const SKIP = new Set(["name", "desc", "shortDesc"]);
/** Collects the template strings of one upstream entry, resolving "#other" references inline. */
function templates(table: any, id: string, depth = 0): Record<string, string> {
	const e = table[id];
	if (!e || depth > 3) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(e)) {
		if (SKIP.has(k) || /^gen\d/.test(k) || typeof v !== "string") continue;
		if (v.startsWith("#")) {
			const ref = v.slice(1);
			const t = templates(upMoves, ref, depth + 1)[k] ?? templates(upAbilities, ref, depth + 1)[k] ?? templates(upItems, ref, depth + 1)[k] ?? upDefault.default[k];
			if (t) out[k] = t;
		} else out[k] = v;
	}
	return out;
}
const leftovers: string[] = [];
function clean(s: string, upName: string, ours: string, where: string) {
	if (upName) s = s.split(upName).join(ours);
	s = playerText(s);
	const leaks = findLeaks(s, "text").filter(x => !/^(Sandstorm|Hail|Snow|Rain|Struggle|Recharge|Confusion|Psychic|Bite|Powder)$/i.test(x));
	if (leaks.length) { leftovers.push(`${where}: ${leaks.join(", ")} in "${s}"`); return null; }
	return s;
}
function textTable(specs: { name: string; base: string }[], up: any, kind: string) {
	const out: Record<string, any> = {};
	for (const spec of specs) {
		const id = toId(spec.name);
		const entry: Record<string, string> = { name: spec.name };
		for (const [k, v] of Object.entries(templates(up, spec.base))) {
			const c = clean(v, up[spec.base]?.name || "", spec.name, `${kind} ${spec.name}.${k}`);
			if (c !== null) entry[k] = c;
		}
		out[id] = entry;
	}
	return out;
}
const Default: Record<string, any> = {};
for (const [key, entry] of Object.entries(upDefault) as [string, any][]) {
	const e: Record<string, string> = {};
	for (const [k, v] of Object.entries(entry)) {
		if (typeof v !== "string") continue;
		const c = clean(v, "", "", `default ${key}.${k}`);
		if (c !== null) e[k] = c;
	}
	Default[key] = e;
}
// Our engine names weather/statuses by display name; the parser looks text up by id.
for (const [ours, up] of [["rain", "raindance"], ["harshsun", "sunnyday"], ["snow", "snowscape"], ["snowcall", "snowscape"]]) if (Default[up]) Default[ours] = Default[up];

const typeNames = loadTs("names.ts", "TypeNames");
const textEn = {
	Default,
	Moves: textTable(MOVES, upMoves, "move"),
	Abilities: textTable(ABILITIES, upAbilities, "ability"),
	Items: textTable(ITEMS, upItems, "item"),
	Pokedex: Object.fromEntries(Object.values(pokedex).map(d => [toId(d.name), { name: d.name, baseSpecies: d.name }])),
	TypeNames: typeNames,
	StatNames: loadTs("names.ts", "StatNames"),
	StatMediumNames: loadTs("names.ts", "StatMediumNames"),
	StatShortNames: loadTs("names.ts", "StatShortNames"),
	NatureNames: loadTs("names.ts", "NatureNames"),
	GenderNames: loadTs("names.ts", "GenderNames"),
	StatusNames: loadTs("names.ts", "StatusNames"),
	TargetNames: playerTextDeep(loadTs("names.ts", "TargetNames")),
	EggGroupNames: {},
	ColorNames: loadTs("names.ts", "ColorNames"),
	Tags: Object.fromEntries(Object.entries(playerTextDeep(loadTs("tags.ts", "TagsText"))).filter(([, t]) => !findLeaks(JSON.stringify(t), "code").length)),
};
function playerTextDeep(v: any): any {
	if (typeof v === "string") return playerText(v);
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, playerTextDeep(x)]));
	return v;
}

// animations: our move -> its mechanic (lowercase internal ids; players never see them)
const anims: Record<string, string> = {};
for (const m of MOVES) if (toId(m.name) !== m.base) anims[toId(m.name)] = m.base;

// ---------------------------------------------------------------- write + check
const J = (v: any) => JSON.stringify(v);
const out =
	"/* Duel Exchange client data. GENERATED by game/tools/gen-client-data.ts from our roster and engine data. Do not edit. */\n" +
	`var BattlePokedex = ${J(pokedex)};\n` +
	`var BattleMovedex = ${J(movedex)};\n` +
	`var BattleAbilities = ${J(abilities)};\n` +
	`var BattleItems = ${J(items)};\n` +
	`var BattleTypeChart = ${J(plain(TypeChart))};\n` +
	`var BattleAliases = {};\n` +
	`var BattleTeambuilderTable = ${J(teambuilder)};\n` +
	`var BattleSearchIndex = ${J(index)};\n` +
	`var BattleSearchIndexOffset = ${J(offsets)};\n` +
	`var BattleText = { en: ${J(textEn)} };\n`;
const animsOut = `/* GENERATED by game/tools/gen-client-data.ts: our move id -> mechanic animation. */\nexport const DXMoveAnims: { [ours: string]: string } = ${J(anims)};\n`;

// Same rule as the engine's leak test: every string with a capital letter (names, text, templates) must be clean;
// lowercase internal ids and flags (players never see them) are allowed. Our own ids must not be upstream names.
const strayIds = Object.keys(pokedex).concat(Object.keys(movedex), Object.keys(abilities), Object.keys(items)).filter(id => isUpstreamName(id));
const dataLeaks = findLeaks(out, "code").filter(x => !/^(Sandstorm|Hail|Snow|Rain|Struggle|Recharge|Confusion|Psychic|Bite|Powder)$/.test(x));
fs.mkdirSync(path.join(ROOT, "client/gen"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "client/gen/dx-data.js"), out);
fs.writeFileSync(path.join(ROOT, "client/gen/anims.ts"), animsOut);
console.log(`client data: ${Object.keys(pokedex).length} creatures, ${Object.keys(movedex).length} moves, ${Object.keys(abilities).length} abilities, ${Object.keys(items).length} items, ${index.length} search rows, ${(out.length / 1024).toFixed(0)} KB`);
if (leftovers.length) console.log(`dropped ${leftovers.length} template(s) that still named upstream things:\n  ` + leftovers.slice(0, 40).join("\n  "));
if (strayIds.length || dataLeaks.length) {
	console.error("LEAK in client data:", strayIds.join(", "), dataLeaks.join(", "));
	process.exit(1);
}
