/**
 * Franchise-name leak scanner.
 *
 * `npm run gen:names` (needs .upstream/) hashes every upstream species, move, ability and item name into
 * tests/fixtures/upstream-names.json. Only SHA-256 hashes are stored, so the repo never contains the names.
 * findLeaks() then hashes every 1-3 word phrase of a text and reports the ones that match.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURE = path.join(__dirname, "../tests/fixtures/upstream-names.json");

/**
 * Plain English words (and the Psychic type) that happen to also be upstream move/ability/item names. The engine
 * prints some of them as ordinary words (weather, statuses, move flags); none of them is the name of one of ours.
 */
export const GENERIC_WORDS = ["Sandstorm", "Hail", "Snow", "Rain", "Struggle", "Recharge", "Confusion", "Psychic", "Bite", "Powder"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hash = (s: string) => createHash("sha256").update("dx:" + norm(s)).digest("hex").slice(0, 24);

export function buildFixture(upstreamDir: string) {
	const names = (file: string) => [...fs.readFileSync(path.join(upstreamDir, file), "utf8").matchAll(/^\t\tname: "([^"]+)"/gm)].map(m => m[1]);
	const generic = new Set(GENERIC_WORDS.map(norm));
	const species = names("data/pokedex.ts").filter(n => norm(n).length >= 4);
	const things = [...names("data/moves.ts"), ...names("data/abilities.ts"), ...names("data/items.ts")].filter(n => !generic.has(norm(n)) && norm(n).length >= 4);
	const data = { note: "SHA-256 (prefix 'dx:', 24 hex) of upstream species/move/ability/item names. Names are not stored.", species: [...new Set(species.map(hash))].sort(), things: [...new Set(things.map(hash))].sort() };
	fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
	fs.writeFileSync(FIXTURE, JSON.stringify(data) + "\n");
	return data;
}

let sets: { species: Set<string>; things: Set<string> } | null = null;
function load() {
	if (!sets) {
		const d = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
		sets = { species: new Set(d.species), things: new Set(d.things) };
	}
	return sets;
}

/** True if the whole name (any case/punctuation) is an upstream species, move, ability or item name. */
export function isUpstreamName(name: string): boolean {
	const { species, things } = load();
	const h = hash(name);
	return species.has(h) || things.has(h);
}

/**
 * Finds upstream names in text players can see.
 * - Species names: any 1-3 word phrase (they are distinctive words).
 * - Move/ability/item names: a whole unit only, i.e. a whole protocol field, a whole string literal, or the text after
 *   "move: ", "ability: ", "item: " or "[from] ". Single English words inside our own longer names ("Swarm" in
 *   "Swarm Hum") are fine; using an upstream name as a name is not.
 * mode "code": only string literals with a capital letter count (lowercase literals are internal mechanic ids,
 * which players never see); "this.debug(...)" strings are skipped (debug lines are never sent to players).
 */
export function findLeaks(text: string, mode: "text" | "code" = "text"): string[] {
	const { species, things } = load();
	let units: string[];
	if (mode === "code") {
		text = text.replace(/this\.debug\((?:[^()]|\([^()]*\))*\)/g, "");
		units = [...text.matchAll(/(['"`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)].map(m => m[2]).filter(s => /[A-Z]/.test(s));
	} else {
		units = text.split(/[|\n"]/);
	}
	const hits = new Set<string>();
	for (const u of units) {
		const parts = [u, ...[...u.matchAll(/(?:move|ability|item): ([^,|'"`\]]+)|\[from\] ([^,|'"`\]]+)/g)].map(m => m[1] || m[2])];
		for (const p of parts) if (things.has(hash(p.trim()))) hits.add(p.trim());
		const words = u.split(/[^A-Za-z0-9]+/).filter(Boolean);
		for (let i = 0; i < words.length; i++) {
			for (let n = 1; n <= 3 && i + n <= words.length; n++) {
				const phrase = words.slice(i, i + n).join(" ");
				if (species.has(hash(phrase))) hits.add(phrase);
			}
		}
	}
	return [...hits].sort();
}

if (require.main === module) {
	if (process.argv[2] === "--build") {
		const up = process.env.UPSTREAM_DIR || path.join(__dirname, "../.upstream/pokemon-showdown");
		const d = buildFixture(up);
		console.log(`hashed ${d.species.length} species and ${d.things.length} other names`);
	} else {
		for (const f of process.argv.slice(2)) {
			const leaks = findLeaks(fs.readFileSync(f, "utf8"), f.endsWith(".ts") ? "code" : "text");
			console.log(f, leaks.length ? leaks.join(", ") : "clean");
		}
	}
}
