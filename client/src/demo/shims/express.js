/**
 * Minimal Express-compatible router used by the in-browser demo backend.
 * Runs the real server route modules (server/src/app.js + routes/extra.js) unchanged:
 * app.get/post/put/patch/delete/use, Routers mounted on a prefix, :params (incl. "proof.:fmt"),
 * async error propagation and 4-arity error handlers. Requests come from fetch-like calls, not sockets.
 */
const esc = (s) => s.replace(/[.+*?^${}()|[\]\\/]/g, (m) => `\\${m}`);
function compile(path, end = true) {
  if (path instanceof RegExp) return { re: path, keys: [] };
  const keys = [];
  let src = '';
  const re = /:(\w+)/g;
  let last = 0; let m;
  while ((m = re.exec(path))) { src += esc(path.slice(last, m.index)) + '([^/]+?)'; keys.push(m[1]); last = m.index + m[0].length; }
  src += esc(path.slice(last));
  return { re: new RegExp(`^${src}${end ? '\\/?$' : '(?=\\/|$)'}`, 'i'), keys };
}

function createRouter() {
  const stack = [];
  const router = (req, res, next) => router.handle(req, res, next);
  router.isRouter = true;
  const add = (method) => (path, ...handlers) => { stack.push({ method, ...compile(path, true), handlers: handlers.flat() }); return router; };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) router[m] = add(m.toUpperCase());
  router.all = add(null);
  router.use = (...args) => {
    let prefix = '/';
    if (typeof args[0] === 'string' || args[0] instanceof RegExp) prefix = args.shift();
    for (const h of args.flat()) stack.push({ use: true, prefix, ...compile(prefix === '/' ? '' : prefix, false), handlers: [h] });
    return router;
  };
  router.set = () => router; router.disable = () => router; router.enable = () => router;
  router.handle = (req, res, done) => {
    let i = 0;
    const basePath = req.path;
    const next = (err) => {
      if (res.ended) return;
      req.path = basePath;
      const layer = stack[i++];
      if (!layer) return done(err);
      if (layer.use) {
        const m = layer.re.exec(req.path);
        if (!m) return next(err);
        const h = layer.handlers[0];
        const stripped = layer.prefix === '/' ? req.path : (req.path.slice(m[0].length) || '/');
        if (h.isRouter) { req.path = stripped; return h.handle(req, res, (e) => { req.path = basePath; next(e); }); }
        return call(h, err, next);
      }
      if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) return next(err);
      const m = layer.re.exec(req.path);
      if (!m) return next(err);
      req.params = Object.fromEntries(layer.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
      let j = 0;
      const step = (e) => {
        if (e && e !== 'route') return next(e);
        if (e === 'route') return next();
        const h = layer.handlers[j++];
        if (!h) return next();
        call(h, err, step);
      };
      step(err);
    };
    const call = (h, err, cb) => {
      try {
        if (err) { if (h.length === 4) h(err, req, res, cb); else cb(err); }
        else if (h.length === 4) cb();
        else { const r = h(req, res, cb); if (r && typeof r.catch === 'function') r.catch(cb); }
      } catch (e) { cb(e); }
    };
    next();
  };
  return router;
}

const MIME = { json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', text: 'text/plain; charset=utf-8', png: 'image/png', pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', gif: 'image/gif' };

function parseQuery(search) {
  const q = {};
  for (const [k, v] of new URLSearchParams(search)) q[k] = k in q ? [].concat(q[k], v) : v;
  return q;
}

/** Dispatch one request through an app. Resolves to { status, headers, body } (body: string | Uint8Array | null). */
export function dispatch(app, { method = 'GET', url, headers = {}, body }) {
  const u = new URL(url, 'http://demo.local');
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(), url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname,
      query: parseQuery(u.search), params: {}, headers: lower, body: body ?? {},
      ip: 'browser-demo', socket: { remoteAddress: 'browser-demo' }, protocol: (globalThis.location?.protocol || 'https:').replace(':', ''),
      get: (n) => (n.toLowerCase() === 'host' ? (globalThis.location?.host || 'demo.local') : lower[n.toLowerCase()]),
    };
    const res = {
      statusCode: 200, headers: {}, ended: false,
      status(c) { this.statusCode = c; return this; },
      set(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) this.headers[a.toLowerCase()] = String(b); else this.headers[k.toLowerCase()] = String(v); return this; },
      setHeader(k, v) { return this.set(k, v); }, header(k, v) { return this.set(k, v); },
      get(k) { return this.headers[k.toLowerCase()]; }, getHeader(k) { return this.get(k); },
      type(t) { return this.set('content-type', MIME[t] || t); },
      json(o) { if (!this.headers['content-type']) this.type('json'); return this.end(JSON.stringify(o)); },
      send(b) {
        if (b == null) return this.end(null);
        if (typeof b === 'string') { if (!this.headers['content-type']) this.type('html'); return this.end(b); }
        if (b instanceof Uint8Array || b instanceof ArrayBuffer) { if (!this.headers['content-type']) this.set('content-type', 'application/octet-stream'); return this.end(new Uint8Array(b)); }
        return this.json(b);
      },
      sendStatus(c) { return this.status(c).end(String(c)); },
      redirect(a, b) { const [code, loc] = b === undefined ? [302, a] : [a, b]; this.status(code).set('location', loc); return this.end(null); },
      end(b = null) { if (this.ended) return this; this.ended = true; resolve({ status: this.statusCode, headers: this.headers, body: b }); return this; },
    };
    app.handle(req, res, (err) => {
      if (res.ended) return;
      if (err) { console.error('[demo-backend]', err); res.status(500).json({ error: 'Internal error in browser demo backend', code: 'INTERNAL' }); }
      else res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    });
  });
}

const passthrough = () => (_req, _res, next) => next();
function express() { return createRouter(); }
express.Router = createRouter;
express.json = passthrough;
express.urlencoded = passthrough;
express.static = passthrough;
export default express;
export { createRouter as Router };
