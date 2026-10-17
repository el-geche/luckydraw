import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [balanceCents, setBalance] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setBalance(null); setReady(true); return; }
    try {
      const me = await api('/auth/me');
      setUser(me.user); setBalance(me.balanceCents);
    } catch {
      setToken(null); setUser(null); setBalance(null);
    } finally { setReady(true); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token); await refresh();
    return r.user;
  }, [refresh]);
  const register = useCallback(async (body) => {
    const r = await api('/auth/register', { method: 'POST', body });
    setToken(r.token); await refresh();
    return r.user;
  }, [refresh]);
  const logout = useCallback(() => { setToken(null); setUser(null); setBalance(null); }, []);

  const value = useMemo(() => ({ user, balanceCents, ready, login, register, logout, refresh }), [user, balanceCents, ready, login, register, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
