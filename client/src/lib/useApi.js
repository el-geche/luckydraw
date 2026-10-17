import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Fetch helper with optional polling. */
export function useApi(path, { poll = 0, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    let t;
    if (poll) t = setInterval(load, poll);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, poll]);
  return { data, error, loading, reload: load, setData };
}
