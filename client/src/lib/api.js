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

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (STATIC_PREVIEW) {
    throw new ApiError(503, { error: 'Static preview: this needs the LuckyDraw backend (see the README to run it).', staticPreview: true });
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) markBackendUnavailable();
    throw new ApiError(0, { error: 'The LuckyDraw server could not be reached.' });
  }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (!isJson && (res.status === 404 || res.status === 405 || res.status >= 500)) {
    // A static host answered instead of the API (HTML 404 page etc.).
    markBackendUnavailable();
    throw new ApiError(503, { error: 'The LuckyDraw backend is not available on this host (see the README to run it).', staticPreview: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
