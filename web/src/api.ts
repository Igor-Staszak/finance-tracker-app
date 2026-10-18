import { OfflineError, cacheGet, cachePut, changePending, enqueue, markReachable, supersede, type OutboxEntry } from './offline';
import { t, tServer } from './i18n';

export type Kind = 'expense' | 'income';

export interface User {
  id: number;
  username: string;
  name: string;
  base_currency: string;
}

export interface Member {
  id: number;
  username: string;
  name: string;
  role: 'owner' | 'member';
}

export interface Tracker {
  id: number;
  name: string;
  currency: string;
  owner_id: number;
  role: 'owner' | 'member';
  members: Member[];
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
  monthly_limit: number | null;
  archived: number;
}

export interface Transaction {
  id: number;
  date: string;
  amount: number;
  kind: Kind;
  category_id: number | null;
  note: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  created_by?: number | null;
  created_by_name?: string | null;
  pending?: boolean; // made offline, not synced yet
}

export interface MonthStats {
  month: string;
  budget: number | null;
  spent: number;
  income: number;
  remaining: number | null;
  usedPct: number | null;
  daysInMonth: number;
  daysElapsed: number;
  daysLeft: number;
  avgPerDay: number;
  projected: number | null;
  safeDaily: number | null;
  prevSpent: number;
  prevSpentToDate: number;
  vsPrevPct: number | null;
  txCount: number;
  biggest: Transaction[];
  byCategory: { id: number | null; name: string; icon: string; color: string; monthly_limit: number | null; total: number; count: number }[];
  daily: { day: number; spent: number; cumulative: number | null; pace: number | null }[];
  byMember: { id: number | null; name: string; total: number; count: number }[];
  dailyByCategory: { day: number; category_id: number | null; total: number }[];
  prevByCategory: { id: number | null; name: string; icon: string; color: string; total: number }[];
  trend: { month: string; spent: number; income: number; budget: number | null }[];
}

export interface Holding {
  id: number;
  symbol: string;
  ticker: string;
  name: string;
  quantity: number;
  avg_price: number;
  currency: string;
  price: number | null;
  stale: boolean;
  fetched_at: number | null;
  value: number | null;
  cost: number;
  pl: number | null;
  plPct: number | null;
  valueBase: number | null;
  costBase: number | null;
  plBase: number | null;
  dayChangeBase: number | null;
  dayChangePct: number | null;
}

export interface Portfolio {
  base: string;
  holdings: Holding[];
  totals: { value: number; cost: number; pl: number; plPct: number | null; dayChange: number };
  errors: string[];
  history: { date: string; value: number; cost: number }[];
}

export type PiggyType = 'cash' | 'bank' | 'savings' | 'deposit' | 'other';

export interface PiggyAccount {
  id: number;
  name: string;
  type: PiggyType;
  currency: string;
  balance: number;
  balanceBase: number | null;
  fx?: number | null;
  updated_at: string;
  pending?: boolean;
}

export interface Piggy {
  base: string;
  accounts: PiggyAccount[];
  byType: { type: PiggyType; total: number }[];
  total: number;
  history: { date: string; total: number }[];
}

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export class UnauthorizedError extends Error {}

/**
 * Options for changes that may be made offline: the change is queued and sent later with "Sync now".
 * Without `offline`, a change made without a connection fails with a clear message.
 */
export interface MutateOpts {
  offline?: { label: string; before?: OutboxEntry['before'] };
}

const NO_CACHE = new Set(['/me', '/captcha']);

async function request<T>(method: string, url: string, body?: unknown, opts: MutateOpts = {}): Promise<T> {
  // a transaction created offline (negative id) only exists in the outbox: change it there
  const temp = url.match(/^\/trackers\/\d+\/transactions\/(-\d+)$/);
  if (temp && method !== 'GET') return changePending(Number(temp[1]), method, body as Record<string, unknown>) as T;

  const offline = (): T => {
    markReachable(false);
    if (method === 'GET') {
      const saved = NO_CACHE.has(url) ? undefined : cacheGet<T>(url);
      if (saved !== undefined) return saved;
      throw new OfflineError(t("You're offline and this page hasn't been opened before on this device."));
    }
    if (opts.offline) return enqueue(method as 'POST' | 'PUT' | 'DELETE', url, body as Record<string, unknown>, opts.offline) as T;
    throw new OfflineError(t("You're offline. This needs an internet connection."));
  };

  if (!navigator.onLine) return offline();
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return offline(); // no network, DNS failure, timeout
  }
  // proxy / gateway errors mean the server is unreachable, not that the request was wrong
  if (res.status >= 502 || (res.status === 500 && !res.headers.get('content-type')?.includes('json'))) return offline();
  markReachable(true);

  if (res.status === 401 && url !== '/login' && url !== '/me') {
    window.dispatchEvent(new Event('unauthorized'));
    throw new UnauthorizedError(t('Not logged in'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? tServer(data.error) : t('Request failed ({status})', { status: res.status }));
  if (method === 'GET' && !NO_CACHE.has(url)) cachePut(url, data);
  else if (method === 'PUT' || method === 'DELETE') supersede(url);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown, opts?: MutateOpts) => request<T>('POST', url, body, opts),
  put: <T>(url: string, body: unknown, opts?: MutateOpts) => request<T>('PUT', url, body, opts),
  del: <T>(url: string, opts?: MutateOpts) => request<T>('DELETE', url, undefined, opts),
};
