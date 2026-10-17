import { config } from './config.js';
import { createDb } from './db/index.js';
import { seedDatabase } from './seed.js';
import { DEMO_ACCOUNTS } from './demoAccounts.js';

if (!config.allowDemoReset) {
  console.error('seed: reset is disabled on this deployment (DATABASE_URL set or NODE_ENV=production). Set ALLOW_DEMO_RESET=true to reseed a disposable database.');
  process.exit(1);
}
const base = `http://localhost:${config.port}`;

async function serverRunning() {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// PGlite is single-process: if the dev server already holds the database, ask it to reseed.
if (!config.databaseUrl && (await serverRunning())) {
  console.log('Server is running — reseeding through the admin API (PGlite is single-process)…');
  const adm = DEMO_ACCOUNTS.find((a) => a.role === 'admin');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adm.email, password: adm.password }) }).then((r) => r.json());
  const res = await fetch(`${base}/api/admin/reset`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}` } });
  console.log(res.ok ? 'Demo data reset.' : `Reset failed: ${res.status} ${await res.text()}`);
  process.exit(res.ok ? 0 : 1);
}

const db = await createDb();
console.log(`Seeding ${db.describe} …`);
await seedDatabase(db, { log: console.log });
await db.close();
console.log('Done. Demo accounts: admin@luckydraw.demo / admin123, ava@luckydraw.demo / demo123 (all members use demo123).');
