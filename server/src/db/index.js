/**
 * Tiny data layer. Two interchangeable back-ends, both real PostgreSQL:
 *   - DATABASE_URL set  -> node-postgres Pool (Postgres, Supabase, Neon, ...)
 *   - otherwise         -> PGlite: Postgres compiled to WASM, embedded in-process,
 *                          persisted to server/.data/pglite (zero install).
 * Both expose the same interface: { kind, query(sql, params), tx(fn), exec(sql), close() }.
 * Inside tx(fn), fn receives an executor { query } that must be used for every
 * statement in that transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export async function createDb({ databaseUrl = config.databaseUrl, dataDir = config.pgliteDir } = {}) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const ssl = config.pgSsl || /supabase\.co/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined;
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl, max: 10 });
    return {
      kind: 'postgres',
      describe: databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@'),
      query: (text, params) => pool.query(text, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const memory = dataDir === 'memory://' || !dataDir;
  if (!memory) fs.mkdirSync(dataDir, { recursive: true });
  const db = memory ? new PGlite() : new PGlite(dataDir);
  await db.waitReady;
  return {
    kind: 'pglite',
    describe: memory ? 'PGlite (in-memory)' : `PGlite (embedded Postgres) at ${dataDir}`,
    query: (text, params) => db.query(text, params),
    exec: (sql) => db.exec(sql),
    tx: (fn) => db.transaction((t) => fn({ query: (text, params) => t.query(text, params) })),
    close: () => db.close(),
  };
}

export async function migrate(db) {
  await db.exec(fs.readFileSync(schemaPath, 'utf8'));
}
