/**
 * Browser replacement for server/src/services/card.js: the same 1200×630 public announcement card,
 * drawn with Canvas instead of satori/resvg (which are Node-native). Same display rules.
 */
import { Buffer } from './buffer-patch.js';
import { config } from '../../../../server/src/config.js';
import { maskName } from '../../../../server/src/util.js';

const cache = new Map();
export const invalidateCard = (drawId) => { for (const k of cache.keys()) if (k.startsWith(`${drawId}:`)) cache.delete(k); };
export const cardKey = (d) => `${d.id}:${d.announcement_visibility}:${d.winner_show_full_name}:${d.drawn_at ? new Date(d.drawn_at).getTime() : 0}`;
export function cardWinnerName(draw, winnerName) { return draw.winner_show_full_name && winnerName ? maskName(winnerName) : null; }
export const shortVerifyUrl = (id) => `${config.appUrl.replace(/^https?:\/\//, '')}/v/${id}`;

export async function renderCard(draw, { winnerName, anchorStatus }) {
  const key = cardKey(draw);
  if (cache.has(key)) return cache.get(key);
  const r = draw.result;
  const name = cardWinnerName(draw, winnerName);
  const status = anchorStatus === 'confirmed' ? 'Sealed & anchored · confirmed on Bitcoin' : anchorStatus === 'submitted' ? 'Sealed & anchored · Bitcoin confirmation pending' : 'Sealed · browser demo (no external anchor)';
  let url = shortVerifyUrl(draw.id); if (url.length > 40) url = `${url.slice(0, 39)}…`;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1200, 630) : Object.assign(document.createElement('canvas'), { width: 1200, height: 630 });
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1200, 630); grad.addColorStop(0, '#0b1324'); grad.addColorStop(0.6, '#13203b'); grad.addColorStop(1, '#1a2a4a');
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 630);
  const F = (w, s) => `${w} ${s}px "Inter Variable", Inter, system-ui, sans-serif`;
  g.strokeStyle = '#c9a24a'; g.lineWidth = 4; g.beginPath(); g.arc(79, 87, 13, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#c9a24a'; g.beginPath(); g.arc(79, 87, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e5eaf3'; g.font = F(700, 34); g.textBaseline = 'middle'; g.fillText('LuckyDraw', 108, 88);
  g.strokeStyle = 'rgba(201,162,74,.6)'; g.lineWidth = 2; g.strokeRect(1040, 68, 96, 40); g.fillStyle = '#e6c77f'; g.font = F(700, 20); g.fillText('DEMO', 1058, 89);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#c9a24a'; g.font = F(600, 22); g.fillText('WINNER ANNOUNCED', 64, 196);
  g.fillStyle = '#e5eaf3'; g.font = F(700, 58); g.fillText(draw.title.length > 34 ? `${draw.title.slice(0, 33)}…` : draw.title, 64, 268);
  g.fillStyle = '#8b98ae'; g.font = F(400, 22); g.fillText('Winning number', 64, 330);
  g.fillStyle = '#e6c77f'; g.font = F(700, 84); g.fillText(`#${r.ticket}`, 64, 410);
  const w = g.measureText(`#${r.ticket}`).width;
  g.fillStyle = '#c2cbdb'; g.font = F(400, 24); g.fillText(`of ${r.totalWeight} · entry #${r.winnerEntryId}`, 64 + w + 48, 366);
  if (name) { g.fillStyle = '#e5eaf3'; g.font = F(600, 30); g.fillText(name, 64 + w + 48, 404); }
  g.fillStyle = '#5cb89e'; g.beginPath(); g.arc(71, 455, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8fd6c0'; g.font = F(400, 24); g.fillText(status, 90, 464);
  g.fillStyle = 'rgba(201,162,74,.45)'; g.fillRect(64, 540, 1072, 2);
  g.fillStyle = '#e6c77f'; g.font = F(600, 30); g.fillText(`Recompute this draw yourself: ${url}`, 64, 588);
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise((res) => c.toBlob(res, 'image/png'));
  const png = Buffer.from(await blob.arrayBuffer());
  cache.set(key, png);
  return png;
}
