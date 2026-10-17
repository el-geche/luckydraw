export function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Download an admin-only file (Bearer token cannot ride on a plain <a href>). */
export async function downloadAuthed(path, filename) {
  const { getToken, apiFetch } = await import('./api.js');
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return res.headers.get('x-export-sha256');
}
export async function fetchAuthedText(path) {
  const { getToken, apiFetch } = await import('./api.js');
  const res = await apiFetch(path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.text();
}
