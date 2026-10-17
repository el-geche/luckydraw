const norm = (p) => { const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return `${p.startsWith('/') ? '/' : ''}${out.join('/')}`; };
export const join = (...a) => norm(a.filter(Boolean).join('/'));
export const resolve = (...a) => { let p = ''; for (const s of a) p = s.startsWith('/') ? s : `${p}/${s}`; return norm(p.startsWith('/') ? p : `/${p}`); };
export const dirname = (p) => { const i = p.replace(/\/$/, '').lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
export const basename = (p, ext) => { const b = p.replace(/\/$/, '').split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
export const sep = '/';
export default { join, resolve, dirname, basename, extname, sep };
