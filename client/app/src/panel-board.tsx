/**
 * Duel Exchange: the weekly board inside the game (M4 part 2). Ours, not upstream.
 * "Your week" (games per format against the 10-game line, qualifying formats, wallet, account age, eligible or why
 * not) on top, then this week's combined board, both from our server (GET /api/me/week, GET /api/board).
 */

import { PS, PSRoom } from "./client-main";
import { PSPanelWrapper, PSRoomPanel } from "./panels";
import { DX } from "./dx";

const FORMATS: { key: string, name: string }[] = [
	{ key: 'randbats', name: 'Random Battle' }, { key: 'ou', name: 'OU' }, { key: 'allcreatures', name: 'All Creatures' }, { key: 'monotype', name: 'Monotype' },
];
const SHORT: { [k: string]: string } = { randbats: 'RB', ou: 'OU', allcreatures: 'AC', monotype: 'Mono' };
const REASON: { [k: string]: string } = {
	'no wallet': 'Link a Solana wallet to be paid (Options, the gear).',
	'account under 7 days': 'Accounts can be paid from 7 days old.',
	'under review': 'A check on this account is open. It is cleared or decided before the week is paid.',
};

interface BoardRow { rank: number; player: string; score: number; formats: { [k: string]: number }; games: number; gxe: number | null; eligible: boolean; reason: string | null }
interface BoardData { week: string; closesAt: string; updatedAt: string | null; players: number; rules: { gamesToQualify: number, formatsToAppear: number }; rows: BoardRow[] }
interface WeekData {
	week: string; closesAt: string; player: string; games: { [k: string]: number }; qualified: string[];
	rank: number | null; score: number | null; wallet: string | null; accountAgeDays: number; eligible: boolean; reason: string | null;
	rules: { gamesToQualify: number, formatsToAppear: number, accountDays: number };
}

export class BoardRoom extends PSRoom {
	override readonly classType: string = 'dxboard';
	board?: BoardData;
	week?: WeekData;
	error?: string;
	loading = false;
	async load() {
		this.loading = true;
		this.update(null);
		const a = DX.account();
		const [b, w] = await Promise.all([DX.api('/api/board'), a ? DX.api('/api/me/week', undefined, a.token) : Promise.resolve(null)]);
		this.loading = false;
		if (b?.error) this.error = b.error; else { this.board = b; this.error = undefined; }
		this.week = w && !w.error ? w : undefined;
		this.update(null);
	}
}

function closesIn(iso: string) {
	const ms = Date.parse(iso) - Date.now();
	if (!(ms > 0)) return 'closing now';
	const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
	return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

class BoardPanel extends PSRoomPanel<BoardRoom> {
	static readonly id = 'dxboard';
	static readonly routes = ['board'];
	static readonly Model = BoardRoom;
	static readonly icon = <i class="fa fa-trophy" aria-hidden></i>;
	static readonly title = 'Weekly board';
	timer?: any;

	override componentDidMount() {
		void this.props.room.load();
		this.timer = setInterval(() => void this.props.room.load(), 60_000);
	}
	override componentWillUnmount() {
		clearInterval(this.timer);
		super.componentWillUnmount();
	}

	renderWeek() {
		const w = this.props.room.week;
		if (!DX.account()) {
			return <div class="dx-board dx-week">
				<h3>Your week</h3>
				<p>Pick a player name and play rated games to get on the board. Rated games count; games against the house bot don't.</p>
			</div>;
		}
		if (!w) return null;
		const need = w.rules.gamesToQualify;
		const status = w.rank ?
			(w.eligible ? <p class="dx-ok"><strong>#{w.rank}</strong> on the board ({w.score?.toFixed(1)}). You can be paid this week.</p> :
				<p class="dx-warn"><strong>#{w.rank}</strong> on the board ({w.score?.toFixed(1)}), but not payable yet. {REASON[w.reason || ''] || ''}</p>) :
			<p>Not on the board yet: play {need} rated games in {w.rules.formatsToAppear} formats ({w.qualified.length} of {w.rules.formatsToAppear} so far).</p>;
		return <div class="dx-board dx-week">
			<h3>Your week</h3>
			<div class="dx-week-grid">
				{FORMATS.map(f => {
					const g = w.games[f.key] || 0;
					const done = g >= need;
					return <div class={`dx-week-fmt${done ? ' done' : ''}`}>
						<span class="dx-week-name">{f.name}</span>
						<span class="dx-week-bar"><span style={{ width: `${Math.min(100, (g / need) * 100)}%` }}></span></span>
						<span class="dx-week-n">{Math.min(g, 99)}/{need}{done ? ' ✓' : ''}</span>
					</div>;
				})}
			</div>
			{status}
			<p class="dx-note">
				Wallet: {w.wallet ? DX.shortWallet(w.wallet) : 'not linked (Options, the gear)'} · Account: {w.accountAgeDays} day{w.accountAgeDays === 1 ? '' : 's'} old{w.accountAgeDays < w.rules.accountDays ? ` (payable from ${w.rules.accountDays})` : ''} · Week closes in {closesIn(w.closesAt)}
			</p>
		</div>;
	}

	renderBoard() {
		const room = this.props.room;
		const b = room.board;
		if (room.error) return <p class="dx-warn">{room.error}</p>;
		if (!b) return <p><i class="fa fa-refresh fa-spin" aria-hidden></i> <em>Loading…</em></p>;
		const me = DX.account()?.name;
		return <div class="dx-board">
			<h3>Combined board <small class="dx-note">week of {b.week} (UTC) · {b.players} player{b.players === 1 ? '' : 's'} rated · closes in {closesIn(b.closesAt)}</small></h3>
			{b.rows.length === 0 ? <p>Nobody has qualified yet this week. A player appears after {b.rules.gamesToQualify} rated games in each of {b.rules.formatsToAppear} formats.</p> :
				<div class="dx-table-wrap"><table class="dx-table">
					<thead><tr><th>#</th><th class="l">Player</th><th>Score</th>{FORMATS.map(f => <th title={f.name}>{SHORT[f.key]}</th>)}<th>Games</th><th>GXE</th></tr></thead>
					<tbody>
						{b.rows.map(r => <tr class={r.player === me ? 'me' : ''}>
							<td>{r.rank}</td>
							<td class="l">{r.player}{!r.eligible && <span class="dx-tag" title={REASON[r.reason || ''] || 'Not payable this week'}>{r.reason === 'under review' ? 'under review' : 'not payable'}</span>}</td>
							<td><strong>{r.score.toFixed(1)}</strong></td>
							{FORMATS.map(f => <td class="dim">{r.formats[f.key] != null ? Math.round(r.formats[f.key]) : '–'}</td>)}
							<td>{r.games}</td>
							<td>{r.gxe != null ? r.gxe.toFixed(1) : '–'}</td>
						</tr>)}
					</tbody>
				</table></div>}
			<p class="dx-note">Score: your percentile in each format where you played {b.rules.gamesToQualify}+ rated games (by ladder rating), averaged. Ties go to GXE, then wins. The top 5 payable players share the week's pool; prizes start after the coin launches. {b.updatedAt ? `Updated ${b.updatedAt.slice(11, 16)} UTC.` : ''}</p>
			<p><a class="button" href="https://duel-exchange.vercel.app/board" target="_blank" rel="noopener">Board and prize pool on the site</a> {}
				<button class="button" onClick={() => void room.load()} disabled={room.loading}>Refresh</button></p>
		</div>;
	}

	override render() {
		return <PSPanelWrapper room={this.props.room}>
			<div class="pad dx-boardpanel">
				{this.renderWeek()}
				{this.renderBoard()}
			</div>
		</PSPanelWrapper>;
	}
}

PS.addRoomType(BoardPanel);
