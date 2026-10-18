import { createContext, useContext } from 'react';
import type { Tracker, User } from './api';

interface Session {
  user: User;
  trackers: Tracker[];
  active: Tracker;
  /** API prefix for the active tracker, e.g. "/trackers/3" */
  tp: string;
  setActive: (id: number) => void;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
}

export const Ctx = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
