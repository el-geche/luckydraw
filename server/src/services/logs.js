export async function logEvent(q, { drawId = null, event, actor = 'system', details = {}, now = new Date() }) {
  await q.query('INSERT INTO draw_logs (draw_id, event, actor, details, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)', [drawId, event, actor, JSON.stringify(details), now]);
}
