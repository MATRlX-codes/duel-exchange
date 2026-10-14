/**
 * Duel Exchange glue for the forked client (ours, not upstream): accounts, our sprites and badges, the request shape
 * our server sends, and move animations for our moves. Everything here talks only to our own server.
 */

const KEY = 'dx_account';

/** The page's config (set inline in index.html). This module has no imports, so it runs first. */
export const DXConfig: any = (window as any).Config;

export interface DXAccount { name: string; token: string }
export interface DXWallet { id: string; name: string; provider: any; open: string; site: string }
export interface DXMe { name: string; createdAt: string; wallet: string | null; walletLinkedAt: string | null; walletChangeAfter: string | null }

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(b: Uint8Array) {
	let n = BigInt(0);
	for (const x of b) n = n * BigInt(256) + BigInt(x);
	let s = '';
	while (n > BigInt(0)) { s = B58[Number(n % BigInt(58))] + s; n = n / BigInt(58); }
	for (const x of b) { if (x !== 0) break; s = '1' + s; }
	return s;
}

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

	// ------------------------------------------------------------ wallets (M4)
	// The wallet signs a plain text message (no transaction, no SOL). Injected providers only: Phantom, Solflare and
	// Backpack all expose connect() + signMessage(bytes); in their in-app browsers on phones too.

	/** Wallets this browser has (detected), and every one we support (for install / open-in-app links). */
	wallets(): DXWallet[] {
		const w = window as any;
		const here = encodeURIComponent(location.href);
		const ref = encodeURIComponent(location.origin);
		const list: DXWallet[] = [
			{ id: 'phantom', name: 'Phantom', provider: w.phantom?.solana?.isPhantom ? w.phantom.solana : null, open: `https://phantom.app/ul/browse/${here}?ref=${ref}`, site: 'https://phantom.com/' },
			{ id: 'solflare', name: 'Solflare', provider: w.solflare?.isSolflare ? w.solflare : null, open: `https://solflare.com/ul/v1/browse/${here}?ref=${ref}`, site: 'https://solflare.com/' },
			{ id: 'backpack', name: 'Backpack', provider: w.backpack?.isBackpack ? w.backpack : (w.backpack?.signMessage ? w.backpack : null), open: '', site: 'https://backpack.app/' },
		];
		return list;
	},
	isPhone() {
		return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
	},
	/** Connects the wallet, asks our server for the message, has the wallet sign it. */
	async signChallenge(wallet: DXWallet, purpose: 'link' | 'signin', token?: string): Promise<{ nonce: string, signature: string, address: string } | { error: string }> {
		const p = wallet.provider;
		if (!p) return { error: `${wallet.name} isn't installed in this browser.` };
		let address = '';
		try {
			const r = await p.connect();
			address = String((r?.publicKey ?? p.publicKey)?.toString?.() || '');
		} catch {
			return { error: `${wallet.name} didn't connect. Try again and approve the connection.` };
		}
		if (!address) return { error: `${wallet.name} didn't share an address.` };
		let n: any;
		try {
			const res = await fetch('/api/wallet/nonce', {
				method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ address, purpose }),
			});
			n = await res.json().catch(() => ({}));
			if (!res.ok) return { error: n.error || `Couldn't start (${res.status}).` };
		} catch {
			return { error: "Couldn't reach the server. Try again." };
		}
		try {
			const out = await p.signMessage(new TextEncoder().encode(n.message), 'utf8');
			const bytes: Uint8Array = out instanceof Uint8Array ? out : out?.signature;
			if (!bytes || bytes.length !== 64) return { error: `${wallet.name} didn't return a signature.` };
			return { nonce: n.nonce, signature: base58(bytes), address };
		} catch {
			return { error: 'You cancelled the signature. Nothing was linked.' };
		}
	},
	async api(path: string, body?: any, token?: string): Promise<any> {
		try {
			const res = await fetch(path, {
				method: body === undefined ? 'GET' : 'POST',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: body === undefined ? undefined : JSON.stringify(body),
			});
			const data = await res.json().catch(() => ({}));
			return res.ok ? data : { error: data.error || `Something went wrong (${res.status}).` };
		} catch {
			return { error: "Couldn't reach the server. Try again." };
		}
	},
	/** The signed-in player's account (name, wallet, when the wallet can next change). */
	async me(): Promise<DXMe | { error: string }> {
		const a = DX.account();
		if (!a) return { error: 'Not signed in.' };
		return DX.api('/api/me', undefined, a.token);
	},
	async linkWallet(wallet: DXWallet): Promise<DXMe | { error: string }> {
		const a = DX.account();
		if (!a) return { error: 'Pick a player name first, then link your wallet.' };
		const s = await DX.signChallenge(wallet, 'link', a.token);
		if ('error' in s) return s;
		return DX.api('/api/wallet/link', { nonce: s.nonce, signature: s.signature }, a.token);
	},
	async unlinkWallet(): Promise<DXMe | { error: string }> {
		const a = DX.account();
		if (!a) return { error: 'Not signed in.' };
		return DX.api('/api/wallet/unlink', {}, a.token);
	},
	/** New phone or browser: sign with the linked wallet, get this device's own login for that player. */
	async signInWithWallet(wallet: DXWallet): Promise<{ account?: DXAccount, error?: string }> {
		const s = await DX.signChallenge(wallet, 'signin');
		if ('error' in s) return { error: s.error };
		const r = await DX.api('/api/wallet/signin', { nonce: s.nonce, signature: s.signature });
		if (r.error || !r.token) return { error: r.error || "Couldn't sign in." };
		const account = { name: r.name as string, token: r.token as string };
		DX.saveAccount(account);
		return { account };
	},
	shortWallet(w: string) {
		return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
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

	/** Our server's ladder (GET /api/ladder/<format>) in the shape the ladder panel reads (upstream's ladder JSON). */
	ladderJSON(format: string, raw: string): string {
		const data = JSON.parse(raw || '{}');
		if (!Array.isArray(data.rows)) throw new Error(data.error || "Couldn't load the ladder.");
		const id = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
		return JSON.stringify({
			formatid: format, format,
			toplist: data.rows.map((r: any) => ({
				userid: id(r.name), username: r.name, elo: r.elo, gxe: r.gxe, rpr: r.glicko, rprd: r.rd, r: r.glicko, rd: r.rd,
				w: r.w, l: r.l, t: r.t, sigma: 0, rptime: 0, rpsigma: 0, first_played: null, last_played: null,
			})),
		});
	},
	/** A saved replay from our server (GET /api/replay/<id>) in the shape the battle panel reads. */
	replay(data: any) {
		if (!data?.log) throw new Error('not found');
		const BattleLog = (window as any).BattleLog;
		return { players: [data.p1, data.p2], format: String(BattleLog?.formatName ? BattleLog.formatName(data.format) : data.format).replace(/^\[DX\] /, 'DX '), log: data.log };
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
