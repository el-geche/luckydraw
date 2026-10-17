/**
 * 1200×630 social card PNG for a public winner announcement (satori → SVG → resvg PNG).
 * Only generated for PUBLIC announcements; cache is keyed by draw + visibility + consent.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { config } from '../config.js';
import { maskName } from '../util.js';

const require = createRequire(import.meta.url);
const font = (w) => fs.readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`));
let fonts;
const getFonts = () => (fonts ??= [400, 600, 700].map((w) => ({ name: 'Inter', data: font(w), weight: w, style: 'normal' })));

const cache = new Map();
export const invalidateCard = (drawId) => { for (const k of cache.keys()) if (k.startsWith(`${drawId}:`)) cache.delete(k); };
export const cardKey = (d) => `${d.id}:${d.announcement_visibility}:${d.winner_show_full_name}:${d.drawn_at ? new Date(d.drawn_at).getTime() : 0}`;

/** Display rules: name omitted unless the winner consented; then masked. */
export function cardWinnerName(draw, winnerName) {
  return draw.winner_show_full_name && winnerName ? maskName(winnerName) : null;
}
export const shortVerifyUrl = (id) => `${config.appUrl.replace(/^https?:\/\//, '')}/v/${id}`;

const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });

export async function renderCard(draw, { winnerName, anchorStatus }) {
  const key = cardKey(draw);
  if (cache.has(key)) return cache.get(key);
  const r = draw.result;
  const name = cardWinnerName(draw, winnerName);
  const status = anchorStatus === 'confirmed' ? 'Sealed & anchored · confirmed on Bitcoin' : anchorStatus === 'submitted' ? 'Sealed & anchored · Bitcoin confirmation pending' : 'Sealed · anchoring pending';
  let url = shortVerifyUrl(draw.id);
  if (url.length > 34) url = `${url.slice(0, 31)}…`;
  const tree = h('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0b1324 0%, #13203b 60%, #1a2a4a 100%)', color: '#e5eaf3', fontFamily: 'Inter', padding: '56px 64px', position: 'relative' }, [
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      h('div', { display: 'flex', alignItems: 'center', fontSize: 34, fontWeight: 700 }, [
        h('div', { width: 30, height: 30, borderRadius: 15, border: '4px solid #c9a24a', marginRight: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }, [h('div', { width: 10, height: 10, borderRadius: 5, background: '#c9a24a' }, [])]),
        'LuckyDraw',
      ]),
      h('div', { display: 'flex', fontSize: 20, fontWeight: 700, letterSpacing: 3, color: '#e6c77f', border: '2px solid rgba(201,162,74,.6)', borderRadius: 8, padding: '6px 14px' }, 'DEMO'),
    ]),
    h('div', { display: 'flex', fontSize: 22, letterSpacing: 4, color: '#c9a24a', fontWeight: 600, marginTop: 52 }, 'WINNER ANNOUNCED'),
    h('div', { display: 'flex', fontSize: 58, fontWeight: 700, marginTop: 10, lineHeight: 1.1, maxWidth: 1060 }, draw.title.length > 38 ? `${draw.title.slice(0, 37)}…` : draw.title),
    h('div', { display: 'flex', alignItems: 'flex-end', marginTop: 30 }, [
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { display: 'flex', fontSize: 22, color: '#8b98ae' }, 'Winning number'),
        h('div', { display: 'flex', fontSize: 84, fontWeight: 700, color: '#e6c77f', lineHeight: 1 }, `#${r.ticket}`),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', marginLeft: 56, paddingBottom: 8 }, [
        h('div', { display: 'flex', fontSize: 24, color: '#c2cbdb' }, `of ${r.totalWeight} · entry #${r.winnerEntryId}`),
        name ? h('div', { display: 'flex', fontSize: 30, fontWeight: 600, marginTop: 6 }, name) : h('div', { display: 'flex' }, []),
      ]),
    ]),
    h('div', { display: 'flex', alignItems: 'center', fontSize: 24, color: '#8fd6c0', marginTop: 26 }, [h('div', { width: 14, height: 14, borderRadius: 7, background: '#5cb89e', marginRight: 12 }, []), status]),
    h('div', { display: 'flex', position: 'absolute', left: 64, right: 64, bottom: 48, borderTop: '2px solid rgba(201,162,74,.45)', paddingTop: 20, fontSize: 30, fontWeight: 600, color: '#e6c77f' }, `Recompute this draw yourself: ${url}`),
  ]);
  const svg = await satori(tree, { width: 1200, height: 630, fonts: getFonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  cache.set(key, png);
  return png;
}
