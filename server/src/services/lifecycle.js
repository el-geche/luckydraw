/** Post-draw hooks and the scheduler job, shared by admin routes, the scheduler and seeding. */
import { tick } from './draws.js';
import { notifyWinner } from './winner.js';
import { processReminders } from './reminders.js';
import { materializeSchedules } from './schedules.js';
import { processAnchors, upgradeAnchors } from './anchors.js';
import { config } from '../config.js';

export async function afterDraw(db, audit, { now } = {}) {
  if (!audit?.winnerEntryId) return null;
  try { return await notifyWinner(db, audit.drawId, { now }); } catch (e) { console.error('[winner] notification failed:', e.message); return null; }
}

let lastUpgrade = 0;
/** One scheduler pass. Every step is idempotent, so restarts / overlapping passes are safe. */
export async function schedulerPass(db, { now = new Date(), anchors = true } = {}) {
  await materializeSchedules(db, now);
  const done = await tick(db, now);
  for (const r of done ?? []) await afterDraw(db, r.audit);
  await processReminders(db, now);
  if (anchors && config.anchors.providers.length) {
    await processAnchors(db, now);
    if (Date.now() - lastUpgrade > config.anchors.upgradeMs) { lastUpgrade = Date.now(); await upgradeAnchors(db, { now }); }
  }
  return { drawn: (done ?? []).length };
}
