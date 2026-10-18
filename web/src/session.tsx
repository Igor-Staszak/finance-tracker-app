import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type Tracker, type User } from './api';
import { Ctx } from './session-context';
import { setBaseCurrency } from './util';

const KEY = 'activeTracker';

export function SessionProvider({ user: initialUser, children }: { user: User; children: ReactNode }) {
  const [user, setUser] = useState(initialUser);
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  const [activeId, setActiveId] = useState<number>(Number(localStorage.getItem(KEY)) || 0);

  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const list = await api.get<Tracker[]>('/trackers');
      setTrackers(list);
      // keep every tracker's categories on the device so the add form works offline
      for (const t of list) api.get(`/trackers/${t.id}/categories`).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // state is only set after the request finishes (network sync, not a cascading render)
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);

  const setActive = useCallback((id: number) => {
    localStorage.setItem(KEY, String(id));
    setActiveId(id);
  }, []);

  if (error && !trackers) return <div className="login"><div className="card error">{error}</div></div>;
  if (!trackers || trackers.length === 0) return null;
  // fall back to the first tracker if the stored one is gone (left / deleted / other user)
  const active = trackers.find((t) => t.id === activeId) ?? trackers[0];
  // spending amounts default to the active tracker's currency
  setBaseCurrency(active.currency);

  return (
    <Ctx.Provider value={{ user, trackers, active, tp: `/trackers/${active.id}`, setActive, refresh, setUser }}>
      {children}
    </Ctx.Provider>
  );
}
