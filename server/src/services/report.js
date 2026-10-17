/**
 * One-page "Fairness Report" PDF (A4) for a draw. The server seed is included ONLY once the
 * draw is sealed and run; before that the report says it is withheld.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { drawAnchors } from './anchors.js';
import { maskName } from '../util.js';

export async function buildReportData(q, draw) {
  const revealed = (draw.status === 'drawn' || draw.status === 'void') && Boolean(draw.sealed_at);
  const anchors = await drawAnchors(q, draw.id);
  const sealAnchor = anchors.find((a) => a.kind === 'seal' && a.provider === 'opentimestamps') ?? anchors.find((a) => a.kind === 'seal');
  const { rows: [{ n }] } = await q.query('SELECT COUNT(*)::int AS n FROM entries WHERE draw_id = $1', [draw.id]);
  const r = revealed ? draw.result : null;
  return {
    drawId: draw.id, title: draw.title, mode: draw.mode, status: draw.status,
    opensAt: draw.opens_at && new Date(draw.opens_at).toISOString(), closesAt: new Date(draw.closes_at).toISOString(),
    sealedAt: draw.sealed_at ? new Date(draw.sealed_at).toISOString() : null, entryCount: n,
    sealHash: draw.seal_hash ?? null, sealCount: draw.seal_count ?? null, commitment: draw.seed_commitment,
    serverSeed: revealed ? draw.seed : null,
    seedNote: revealed ? null : draw.sealed_at ? 'Withheld until the draw is run (sealed; awaiting public beacon)' : 'Withheld until seal',
    crowdEntropy: r?.crowdEntropy ?? null, finalSeed: r?.finalSeed ?? null, publicRandom: r?.publicRandom ?? null,
    beacon: draw.entropy_source ? { source: draw.entropy_source, round: draw.entropy_round == null ? null : Number(draw.entropy_round), value: revealed ? draw.entropy_value : null } : null,
    anchor: sealAnchor ? { provider: sealAnchor.provider, status: sealAnchor.status, bitcoinBlock: sealAnchor.bitcoinBlock, submittedAt: sealAnchor.submittedAt } : null,
    winner: r?.winnerEntryId ? { ticket: r.ticket, totalWeight: r.totalWeight, entryId: r.winnerEntryId, display: r.winnerName ? maskName(r.winnerName.replace(/\./g, '')) : null } : null,
    verifyUrl: `${config.appUrl}/verify/${draw.id}`,
    generatedAt: new Date().toISOString(),
  };
}

const NAVY = '#0b1324'; const SURFACE = '#131f38'; const GOLD = '#c9a24a'; const TEXT = '#1b2436'; const MUTED = '#5f6b80';

export async function renderReportPdf(d) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `LuckyDraw Fairness Report — Draw #${d.drawId}`, Author: 'LuckyDraw (demo)', Subject: 'Fairness report' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = 595.28; const M = 36;

  // Header band
  doc.rect(0, 0, W, 96).fill(NAVY);
  doc.circle(M + 11, 40, 10).lineWidth(2).stroke(GOLD); doc.circle(M + 11, 40, 3).fill(GOLD);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('LuckyDraw', M + 30, 30);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('FAIRNESS REPORT', M + 30, 52, { characterSpacing: 1.6 });
  doc.fillColor('#e6c77f').fontSize(7.5).font('Helvetica-Bold').text('DEMO · SIMULATED · NO REAL MONEY', W - M - 190, 34, { width: 190, align: 'right', characterSpacing: 0.8 });
  doc.fillColor('#c2cbdb').font('Helvetica').fontSize(8).text(`Generated ${d.generatedAt.replace('T', ' ').slice(0, 19)} UTC`, W - M - 190, 50, { width: 190, align: 'right' });
  doc.rect(0, 96, W, 2).fill(GOLD);

  // Title
  let y = 114;
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(16).text(d.title, M, y, { width: W - 2 * M - 110 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Draw #${d.drawId} · ${d.mode === 'equal' ? 'Equal entry' : 'Weighted'} · status: ${d.status}`, M, y + 22);

  // QR
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 220, color: { dark: '#0b1324', light: '#ffffff' } });
  doc.image(qr, W - M - 92, 106, { width: 92 });
  doc.fillColor(MUTED).fontSize(6.5).text('Scan to verify', W - M - 92, 200, { width: 92, align: 'center' });

  // Facts grid
  y = 160;
  const rows = [
    ['Opened (UTC)', d.opensAt?.replace('T', ' ').slice(0, 19) ?? '—'],
    ['Closed (UTC)', d.closesAt.replace('T', ' ').slice(0, 19)],
    ['Sealed (UTC)', d.sealedAt ? d.sealedAt.replace('T', ' ').slice(0, 19) : 'Not yet sealed'],
    ['Entries / chain records', `${d.entryCount} entries · ${d.sealCount ?? '—'} confirmation records`],
    ['Sealed final hash', d.sealHash ?? 'Not yet sealed'],
    ['Seed commitment', d.commitment],
    ['Server seed', d.serverSeed ?? d.seedNote],
    ['Crowd entropy', d.crowdEntropy ?? 'Computed at the draw from all receipt codes'],
    ['Beacon', d.beacon ? (d.beacon.source === 'drand' ? `drand round ${d.beacon.round}${d.beacon.value ? ` · ${d.beacon.value}` : ' (value fetched at the draw)'}` : d.beacon.source) : 'Committed at seal'],
    ['Final seed', d.finalSeed ?? 'Derived at the draw'],
    ['Anchor', d.anchor ? `${d.anchor.provider} · ${d.anchor.status === 'confirmed' ? `confirmed${d.anchor.bitcoinBlock ? ` in Bitcoin block ${d.anchor.bitcoinBlock}` : ''}` : d.anchor.status === 'submitted' ? 'submitted — pending Bitcoin confirmation' : d.anchor.status}${d.anchor.submittedAt ? ` · ${d.anchor.submittedAt.slice(0, 19).replace('T', ' ')} UTC` : ''}` : 'Not yet anchored'],
    ['Winning number', d.winner ? `Ticket ${d.winner.ticket} of ${d.winner.totalWeight} · entry #${d.winner.entryId}${d.winner.display ? ` · ${d.winner.display}` : ''}` : 'Not yet drawn'],
  ];
  doc.roundedRect(M, y - 8, W - 2 * M - 104, rows.length * 22 + 10, 6).lineWidth(0.6).stroke('#d5dbe6');
  for (const [k, v] of rows) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(k, M + 10, y, { width: 110 });
    const mono = /hash|seed|commitment|entropy|Beacon/i.test(k);
    doc.fillColor(TEXT).font(mono ? 'Courier' : 'Helvetica').fontSize(mono ? 7 : 8).text(v, M + 122, y, { width: W - 2 * M - 104 - 132, lineBreak: true, height: 20, ellipsis: true });
    y += 22;
  }

  // Mechanisms
  y += 16;
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8).text('HOW THIS DRAW IS PROTECTED', M, y, { characterSpacing: 1.2 });
  y += 16;
  const mech = [
    ['Chained audit trail', 'Every entry confirmation is appended to a per-draw hash chain: each record stores the hash of the previous one, so any edit, deletion or reordering changes every later hash.'],
    ['Sealed draw hash', 'When entries close, the final chain hash and record count are sealed. No record can be added afterwards, and anyone can recompute the chain from the public file and compare.'],
    ['OpenTimestamps Bitcoin anchor', 'The seal digest is submitted to public OpenTimestamps calendars, which commit it into the Bitcoin blockchain. The .ots proof shows the seal existed no later than that block.'],
    ['Delayed seed reveal', 'A secret server seed is generated at opening and only its SHA-256 commitment is published. The seed is revealed after the seal, proving it was fixed before any entry.'],
    ['Crowd randomness + external beacon', 'The final seed is HMAC-SHA256(serverSeed, SHA-256(crowd entropy || drand beacon) || seal hash). Crowd entropy comes from all receipt codes; the beacon round is fixed at seal and did not yet exist, so neither the operator nor the last entrant can grind the result.'],
  ];
  const colW = (W - 2 * M - 14) / 2;
  mech.forEach(([h, t], i) => {
    const x = M + (i % 2) * (colW + 14);
    const yy = y + Math.floor(i / 2) * 74;
    doc.rect(x, yy, 2, 58).fill(GOLD);
    doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(h, x + 10, yy, { width: colW - 10 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(t, x + 10, yy + 13, { width: colW - 10, height: 52, ellipsis: true, lineGap: 1 });
  });
  y += 3 * 74 + 6;

  // Verify box
  doc.roundedRect(M, y, W - 2 * M, 50, 6).fill('#f4f1e8');
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9).text('Verify independently', M + 12, y + 9);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('Open the verify page to recompute the chain, seal, anchor, seed derivation and winner in your browser. Proof files: .ots (verify with `ots verify` or opentimestamps.org).', M + 12, y + 22, { width: W - 2 * M - 24 });
  doc.fillColor('#8a6a22').font('Courier').fontSize(8).text(d.verifyUrl, M + 12, y + 37, { link: d.verifyUrl });

  // Footer
  doc.rect(0, 842 - 46, W, 46).fill(NAVY);
  doc.fillColor('#c2cbdb').font('Helvetica').fontSize(6.8).text('LuckyDraw is a demonstration platform. All balances, deposits, entry fees and prizes are simulated — no real money is accepted or paid. This report describes the technical fairness mechanisms of this draw; it is not legal advice, a certification, or a gambling licence.', M, 842 - 36, { width: W - 2 * M, align: 'center', lineGap: 1 });
  doc.end();
  return done;
}
