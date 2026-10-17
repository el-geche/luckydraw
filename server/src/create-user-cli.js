/**
 * Create or update a real (non-demo) LuckyDraw account.
 *
 *   npm run create-user -- --email you@example.com --role admin --name "Organizer" --password-env MY_PASSWORD_VAR
 *
 * Inputs (flags or env): --email / CREATE_USER_EMAIL, --role / CREATE_USER_ROLE (member|admin),
 * --name / CREATE_USER_NAME, password from the env var named by --password-env (or CREATE_USER_PASSWORD),
 * otherwise prompted for without echo. The password is never printed or logged.
 *
 * Works against DATABASE_URL (hosted Postgres) or the local PGlite database. If the local dev server is
 * running (PGlite is single-process), the account is created through the server's admin API instead;
 * set ADMIN_EMAIL / ADMIN_PASSWORD_ENV to authenticate (defaults to the seeded demo admin).
 * Accounts created here are kept when demo data is reseeded.
 */
import readline from 'node:readline';
import { config } from './config.js';
import { createDb, migrate } from './db/index.js';
import { upsertUser } from './services/users.js';
import { DEMO_ACCOUNTS } from './demoAccounts.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); acc.push([k, v ?? (all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true')]); }
  return acc;
}, []));
const env = (k) => process.env[k];
const fail = (m) => { console.error(`create-user: ${m}`); process.exit(1); };

function promptHidden(question) {
  if (!process.stdin.isTTY) fail('no password given (use --password-env VAR or CREATE_USER_PASSWORD) and stdin is not a terminal');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (v) => { rl.close(); process.stdout.write('\n'); resolve(v); });
  });
}
async function promptText(question) {
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (v) => { rl.close(); resolve(v.trim()); }));
}

const email = args.email || env('CREATE_USER_EMAIL') || (await promptText('Email: '));
const role = args.role || env('CREATE_USER_ROLE') || 'member';
const name = args.name || env('CREATE_USER_NAME') || '';
let password = args['password-env'] ? env(args['password-env']) : env('CREATE_USER_PASSWORD');
if (args['password-env'] && !password) fail(`environment variable ${args['password-env']} is empty or not set`);
if (!password) password = await promptHidden('Password (hidden): ');
if (!email) fail('--email is required');

const base = `http://localhost:${config.port}`;
async function serverRunning() {
  try { return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

let result;
if (!config.databaseUrl && (await serverRunning())) {
  const admEmail = env('ADMIN_EMAIL') || DEMO_ACCOUNTS.find((a) => a.role === 'admin').email;
  const admPassword = env('ADMIN_PASSWORD_ENV') ? env(env('ADMIN_PASSWORD_ENV')) : DEMO_ACCOUNTS.find((a) => a.email === admEmail)?.password;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admEmail, password: admPassword }) });
  if (!login.ok) fail(`could not sign in to the running server as ${admEmail} (${login.status})`);
  const { token } = await login.json();
  const r = await fetch(`${base}/api/admin/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email, role, name, password }) });
  const j = await r.json();
  if (!r.ok) fail(j.error || `server returned ${r.status}`);
  result = { ...j, via: `running server at ${base}` };
} else {
  const db = await createDb();
  await migrate(db);
  try { result = { ...(await upsertUser(db, { email, role, name, password })), via: db.describe }; } catch (e) { fail(e.message); } finally { await db.close(); }
}
console.log(`${result.created ? 'Created' : 'Updated'} ${result.role} account #${result.id} ${result.email} ("${result.name}") via ${result.via}. Password stored as a bcrypt hash; kept on reseed.`);
