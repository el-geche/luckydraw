import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import './helpers.js';
import { createDb } from '../src/db/index.js';
import { seedDatabase } from '../src/seed.js';
import { upsertUser } from '../src/services/users.js';

test('create-user: bcrypt-hashed real account survives reseed; validation', async () => {
  const db = await createDb({ databaseUrl: '', dataDir: 'memory://' });
  await seedDatabase(db);
  const u = await upsertUser(db, { email: 'Owner@Example.test', role: 'admin', name: 'Organizer', password: 'pw-1234' });
  assert.equal(u.created, true); assert.equal(u.email, 'owner@example.test');
  const again = await upsertUser(db, { email: 'owner@example.test', role: 'admin', name: 'Organizer', password: 'pw-5678' });
  assert.equal(again.created, false);
  await seedDatabase(db);
  const { rows: [row] } = await db.query("SELECT * FROM users WHERE email = 'owner@example.test'");
  assert.ok(row, 'kept after reseed');
  assert.equal(row.role, 'admin');
  assert.ok(row.password_hash.startsWith('$2'), 'bcrypt hash');
  assert.ok(await bcrypt.compare('pw-5678', row.password_hash));
  await assert.rejects(upsertUser(db, { email: 'x@example.test', password: '123' }), /at least 6/);
  await assert.rejects(upsertUser(db, { email: 'nope', password: '123456' }), /valid email/);
  await assert.rejects(upsertUser(db, { email: 'y@example.test', role: 'root', password: '123456' }), /Role/);
  await db.close();
});
