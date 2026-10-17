import { STATIC_PREVIEW, markBackendUnavailable } from './staticMode.js';

const TOKEN_KEY = 'luckydraw.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** fetch() for /api paths: the real server, or the in-browser demo backend in static-preview builds. */
export async function apiFetch(path, init = {}) {
  if (STATIC_PREVIEW) {
    const { demoFetch } = await import('../demo/backend.js');
    return demoFetch(`/api${path}`, init);
  }
  return fetch(`/api${path}`, init);
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await apiFetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (STATIC_PREVIEW) throw new ApiError(0, { error: `The in-browser demo backend failed to start: ${e?.message || e}`, code: 'DEMO_BACKEND' });
    if (typeof navigator === 'undefined' || navigator.onLine !== false) markBackendUnavailable();
    throw new ApiError(0, { error: 'The LuckyDraw server could not be reached. Check that it is running (npm run dev) and try again.', code: 'UNREACHABLE' });
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (!STATIC_PREVIEW && !isJson && (res.status === 404 || res.status === 405 || res.status >= 500)) {
    // A static host answered instead of the API (HTML 404 page etc.).
    markBackendUnavailable();
    throw new ApiError(503, { error: 'The LuckyDraw backend is not available on this host (see the README to run it).', code: 'UNREACHABLE' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
