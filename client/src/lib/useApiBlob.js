import { useEffect, useState } from 'react';
import { STATIC_PREVIEW } from './staticMode.js';

/** Image/file URL for an /api path: the URL itself normally, an object URL from the demo backend in static preview. */
export function useApiBlobUrl(url) {
  const [src, setSrc] = useState(STATIC_PREVIEW ? null : url);
  useEffect(() => {
    if (!STATIC_PREVIEW || !url) { setSrc(url); return undefined; }
    let alive = true; let obj;
    import('../demo/backend.js').then(({ demoFetch }) => demoFetch(url)).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (alive && b) { obj = URL.createObjectURL(b); setSrc(obj); }
    }).catch(() => {});
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [url]);
  return src;
}
