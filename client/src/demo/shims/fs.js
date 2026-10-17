/** node:fs stand-in: the browser demo keeps everything in PGlite (IndexedDB); no files are written. */
import schemaSql from '../../../../server/src/db/schema.sql?raw';

export function readFileSync(p, enc) {
  if (String(p).endsWith('schema.sql')) return schemaSql;
  throw new Error(`File access is not available in the browser demo (${p})`);
}
export const existsSync = () => false;
export const mkdirSync = () => {};
export const writeFileSync = () => {};
export const readdirSync = () => [];
export const statSync = () => ({ isFile: () => false, isDirectory: () => false });
export default { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync };
