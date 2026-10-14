/**
 * Duel Exchange glue for the forked client (ours, not upstream): accounts, our sprites and badges, the request shape
 * our server sends, and move animations for our moves. Everything here talks only to our own server.
 */

const KEY = 'dx_account';

/** The page's config (set inline in index.html). This module has no imports, so it runs first. */
export const DXConfig: any = (window as any).Config;

export interface DXAccount { name: string; token: string }

export const DX = {
	account(): DXAccount | null {
		try {
			const v = JSON.parse(localStorage.getItem(KEY) || 'null');
			return v?.name && v?.token ? v : null;
		} catch {
			return null;
		}
	},
	saveAccount(a: DXAccount) {
		try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {}
	},
	forgetAccount() {
		try { localStorage.removeItem(KEY); } catch {}
	},
	/** The /trn line for a saved account (our token in place of a login server's assertion). */
	trn(a: DXAccount) {
		return `/trn ${a.name},0,${a.token}`;
	},
	/** Makes an account on our server (POST /api/account). The token is shown once and kept on this device. */
	async createAccount(name: string): Promise<{ account?: DXAccount, error?: string }> {
		try {
			const res = await fetch('/api/account', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data.token) return { error: data.error || `Couldn't make the account (${res.status}).` };
			const account = { name: data.name as string, token: data.token as string };
			DX.saveAccount(account);
			return { account };
		} catch {
			return { error: "Couldn't reach the server. Try again." };
		}
	},

	/** Our server sends the request's creature list as "creatures"; the client reads "pokemon". */
	adaptRequest(request: any) {
		if (request?.side && request.side.creatures && !request.side.pokemon) {
			request.side.pokemon = request.side.creatures;
			delete request.side.creatures;
		}
		return request;
	},

	/** Our engine names weather by its display name (Rain, Harsh Sun, Snow); the client keys weather by these ids. */
	weatherId(id: string): any {
		const map: { [k: string]: string } = { rain: 'raindance', harshsun: 'sunnyday', snow: 'snowcall', heavyrain: 'primordialsea', extremelyharshsunlight: 'desolateland' };
		return map[id] || id;
	},

	spriteId(species: string) {
		return String(species || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
	},
	/** Animated battle sprite (96x96 GIF made from our sprite strips). */
	spriteUrl(species: string, back: boolean, shiny: boolean) {
		return `/sprites/${DX.spriteId(species)}/${back ? 'back' : 'front'}${shiny ? '-shiny' : ''}.gif`;
	},
	iconUrl(species: string) {
		return `/sprites/${DX.spriteId(species)}/icon.png`;
	},
	typeBadge(type: string | null) {
		const t = String(type || '???').replace(/[^A-Za-z?]/g, '');
		return `<span class="dx-type dx-type-${t.toLowerCase().replace(/\?/g, 'x')}">${t}</span>`;
	},
	categoryBadge(category: string | null) {
		const c = String(category || '').replace(/[^A-Za-z]/g, '');
		return `<span class="dx-cat dx-cat-${c.toLowerCase()}">${c === 'Physical' ? 'PHYS' : c === 'Special' ? 'SPEC' : c === 'Status' ? 'STAT' : c}</span>`;
	},
};

/** our move id -> the animation of the mechanic it runs on (generated from roster/library.ts by the build). */
declare const DXMoveAnims: { [ours: string]: string } | undefined;
export function aliasMoveAnims(anims: { [id: string]: any }) {
	const map = typeof DXMoveAnims !== 'undefined' ? DXMoveAnims : {};
	for (const ours in map) if (!anims[ours] && anims[map[ours]]) anims[ours] = anims[map[ours]];
}

/**
 * Chat/log text formatting (the log code calls a global formatText; upstream ships it outside the files we took).
 * Ours: HTML-escaped text with **bold**, __italic__, ~~strike~~ and ``code``. No links, no HTML.
 */
function formatText(input: string, _isTrusted?: boolean): string {
	let s = String(input).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	s = s.replace(/``(.+?)``/g, '<code>$1</code>');
	s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
	s = s.replace(/__(.+?)__/g, '<i>$1</i>');
	s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
	return s;
}
(window as any).formatText = formatText;
