/**
 * Words the upstream engine prints that players must never see. Applied to generated data at build time
 * (tools/gen-dex.ts) and to engine messages at our boundaries (the teambuilder/calc API now, the battle server in M3).
 * tests/leaks.test.ts checks that none of FORBIDDEN reaches a battle log, the generated data or validator output.
 */
export const FORBIDDEN = /Pok[eé]mon|Terastal|\bTera\b|Pok[eé]dex|Pok[eé] ?Ball/i;

const SENTENCES: [RegExp, string][] = [
	[/Terastal Clause: You cannot Terastallize/g, "Type Change Clause: The type change is off"],
	[/Tera Type Preview: Tera Types are shown at Team Preview/g, "Type Preview: change types are shown at Team Preview"],
	[/Same Type Clause: Pok[eé]mon in a team must share a type/g, "Same Type Clause: Creatures in a team must share a type"],
	[/Species Clause: Limit one of each Pok[eé]mon/g, "Species Clause: Limit one of each creature"],
	[/Terastal Clause/g, "Type Change Clause"],
	[/Terastallized|Terastallised/g, "type-changed"],
	[/Terastallize|Terastallise/g, "change type"],
	[/Tera Types?/g, "change type"],
	[/(\d+) Pok[eé]mon/g, "$1 creatures"],
	[/(opponent's|your|their|all|other|more) Pok[eé]mon/g, "$1 creatures"],
	[/Pok[eé]mon/g, "creature"],
	[/pok[eé]mon/g, "creature"],
];

export function playerText(s: string): string {
	for (const [re, to] of SENTENCES) s = s.replace(re, to);
	return s;
}
