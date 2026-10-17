/** Platform-level one-page Compliance Summary (PDF + HTML preview). */
import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const PLATFORM_VERSION = require('../../package.json').version;

export const SECTIONS = [
  ['Chained audit trail', 'Every entry confirmation is written to an append-only, per-draw hash chain. Each record stores the hash of the previous one; database triggers reject updates and deletions, so any alteration is detectable.'],
  ['Sealed draw hashes', 'At close the final chain hash and record count are sealed. Appends to a sealed chain are rejected; anyone can recompute the chain from the public, privacy-masked chain file.'],
  ['OpenTimestamps Bitcoin anchoring', 'Seed commitments and seals are submitted (as SHA-256 digests only) to public OpenTimestamps calendars and later upgraded to Bitcoin attestations. Optional RFC 3161 TSA tokens are supported.'],
  ['Delayed seed reveal (commit–reveal)', 'A 256-bit server seed is generated at opening; only SHA-256(seed) is published. No page, API, log, email or export reveals the seed before the draw is sealed and run.'],
  ['Crowd randomness + external beacon', 'Final seed = HMAC-SHA256(serverSeed, SHA-256(crowd entropy || drand beacon) || seal hash). Crowd entropy comes from all receipt codes; the beacon round is fixed at seal, so neither operator nor entrants can grind outcomes.'],
  ['Entry confirmations & receipts', 'Each entry produces a non-guessable receipt code (80 random bits) and an emailed proof of entry; a public, rate-limited page verifies a receipt and its place in the sealed chain.'],
  ['Reminder logging', 'Every reminder decision (sent or skipped: at cap, closed, opted out, unsubscribed, failed) is logged once per member, draw and type, and exportable.'],
  ['Winner notification', 'Winners receive a notification with the one-page Fairness Report PDF attached. Delivery, demo opens, resends, visibility changes and report downloads are logged.'],
  ['Public one-click verification', 'The verify page re-runs, in the visitor’s browser, the chain, seal, anchor, commitment, seed derivation and winner selection using the same open-source engine as the server.'],
];
export const PRIVACY = 'Public pages show masked names only (e.g. “A*** M.”); emails are never published. Identities in the public chain are salted SHA-256 commitments. Raw IP addresses are not stored; where needed (report downloads, rate limiting) only a keyed hash is kept or the value is held in memory. Open tracking is off by default and only possible with SMTP when explicitly enabled.';
export const OPTOUT = 'Every reminder carries a one-click unsubscribe link (no login, RFC 8058 List-Unsubscribe headers) honoured immediately. Members can opt out of all or only short-notice reminders in their dashboard. All changes are logged with time and method.';
export const FOOTER = 'LuckyDraw is a demonstration platform: all money, deposits, entry fees and prizes are simulated. This summary describes technical mechanisms; it is not legal advice or a certification. Organizers remain responsible for complying with local lottery, raffle and sweepstakes law and licensing.';

export async function complianceStats(db) {
  const one = async (sql) => (await db.query(sql)).rows[0].n;
  return {
    drawsSealed: await one('SELECT COUNT(*)::int AS n FROM draws WHERE sealed_at IS NOT NULL'),
    drawsCompleted: await one(`SELECT COUNT(*)::int AS n FROM draws WHERE status IN ('drawn','void')`),
    chainRecords: await one('SELECT COUNT(*)::int AS n FROM confirmation_ledger'),
    anchorsSubmitted: await one(`SELECT COUNT(*)::int AS n FROM draw_anchors WHERE status IN ('submitted','confirmed')`),
    anchorsConfirmed: await one(`SELECT COUNT(*)::int AS n FROM draw_anchors WHERE status = 'confirmed'`),
    remindersLogged: await one('SELECT COUNT(*)::int AS n FROM reminder_log'),
  };
}

export function complianceHtml({ stats, generatedAt }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>LuckyDraw Compliance Summary</title><style>
body{margin:0;background:#e9ecf2;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1b2436}.page{width:794px;min-height:1123px;margin:24px auto;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.15);display:flex;flex-direction:column}
header{background:#0b1324;color:#fff;padding:22px 36px;border-bottom:3px solid #c9a24a;display:flex;justify-content:space-between;align-items:center}h1{margin:0;font-size:22px}.eb{color:#c9a24a;font-size:11px;letter-spacing:.16em;font-weight:700}
main{padding:22px 36px;flex:1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 22px}.s{border-left:3px solid #c9a24a;padding-left:10px}.s h3{margin:0 0 3px;font-size:12.5px}.s p{margin:0;font-size:11px;color:#4b566a;line-height:1.45}
.stats{display:flex;gap:10px;margin:0 0 16px}.st{flex:1;background:#f4f1e8;border-radius:6px;padding:8px 10px}.st b{display:block;font-size:16px}.st span{font-size:10px;color:#5f6b80}.box{background:#f4f6fa;border-radius:6px;padding:10px 12px;margin-top:14px;font-size:11px;color:#4b566a}.box b{color:#1b2436}
footer{background:#0b1324;color:#c2cbdb;font-size:10px;text-align:center;padding:12px 36px}</style></head><body><div class="page">
<header><div><div class="eb">COMPLIANCE SUMMARY</div><h1>LuckyDraw — fairness &amp; integrity controls</h1></div><div style="text-align:right;font-size:11px;color:#c2cbdb">Platform v${PLATFORM_VERSION}<br>Generated ${esc(generatedAt.slice(0, 19).replace('T', ' '))} UTC<br><span style="color:#e6c77f;font-weight:700">DEMO · SIMULATED</span></div></header>
<main><div class="stats">${[['Draws sealed', stats.drawsSealed], ['Draws completed', stats.drawsCompleted], ['Chain records', stats.chainRecords], ['Anchors submitted', stats.anchorsSubmitted], ['Anchors on Bitcoin', stats.anchorsConfirmed]].map(([k, v]) => `<div class="st"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
<div class="eb" style="margin-bottom:10px">FROM ENTRY TO WINNER</div><div class="grid">${SECTIONS.map(([h, t]) => `<div class="s"><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div>
<div class="box"><b>Privacy.</b> ${esc(PRIVACY)}</div><div class="box"><b>Unsubscribe &amp; opt-out.</b> ${esc(OPTOUT)}</div></main>
<footer>${esc(FOOTER)}</footer></div></body></html>`;
}

export async function compliancePdf({ stats, generatedAt }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'LuckyDraw Compliance Summary', Author: 'LuckyDraw (demo)' } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  const W = 595.28; const M = 36; const NAVY = '#0b1324'; const GOLD = '#c9a24a'; const TEXT = '#1b2436'; const MUTED = '#4b566a';
  doc.rect(0, 0, W, 78).fill(NAVY); doc.rect(0, 78, W, 2).fill(GOLD);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('COMPLIANCE SUMMARY', M, 22, { characterSpacing: 1.6 });
  doc.fillColor('#fff').fontSize(16).text('LuckyDraw — fairness & integrity controls', M, 36);
  doc.fillColor('#c2cbdb').font('Helvetica').fontSize(7.5).text(`Platform v${PLATFORM_VERSION}\nGenerated ${generatedAt.slice(0, 19).replace('T', ' ')} UTC`, W - M - 160, 24, { width: 160, align: 'right' });
  doc.fillColor('#e6c77f').font('Helvetica-Bold').fontSize(7.5).text('DEMO · SIMULATED', W - M - 160, 50, { width: 160, align: 'right' });
  let y = 94;
  const st = [['Draws sealed', stats.drawsSealed], ['Completed', stats.drawsCompleted], ['Chain records', stats.chainRecords], ['Anchors submitted', stats.anchorsSubmitted], ['On Bitcoin', stats.anchorsConfirmed]];
  const sw = (W - 2 * M - 4 * 8) / 5;
  st.forEach(([k, v], i) => { const x = M + i * (sw + 8); doc.roundedRect(x, y, sw, 34, 4).fill('#f4f1e8'); doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(12).text(String(v), x + 8, y + 5); doc.fillColor('#5f6b80').font('Helvetica').fontSize(6.8).text(k, x + 8, y + 21); });
  y += 48;
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(7.5).text('FROM ENTRY TO WINNER', M, y, { characterSpacing: 1.3 }); y += 14;
  const cw = (W - 2 * M - 16) / 2;
  SECTIONS.forEach(([h, t], i) => {
    const x = M + (i % 2) * (cw + 16); const yy = y + Math.floor(i / 2) * 76;
    doc.rect(x, yy, 2, 62).fill(GOLD);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(h, x + 9, yy, { width: cw - 9 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text(t, x + 9, yy + 12, { width: cw - 9, height: 56, ellipsis: true, lineGap: 0.8 });
  });
  y += 5 * 76 + 2;
  for (const [h, t] of [['Privacy', PRIVACY], ['Unsubscribe & opt-out', OPTOUT]]) {
    doc.roundedRect(M, y, W - 2 * M, 50, 5).fill('#f4f6fa');
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(h, M + 10, y + 7);
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.2).text(t, M + 10, y + 19, { width: W - 2 * M - 20, lineGap: 0.8 });
    y += 58;
  }
  doc.rect(0, 842 - 46, W, 46).fill(NAVY);
  doc.fillColor('#c2cbdb').font('Helvetica').fontSize(6.8).text(FOOTER, M, 842 - 36, { width: W - 2 * M, align: 'center', lineGap: 1 });
  doc.end();
  return done;
}
