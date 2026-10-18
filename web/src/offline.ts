// Offline support: last-known copies of GET responses, and an outbox of changes made
// without a connection. Nothing is sent until the user presses "Sync now".
import { useSyncExternalStore } from 'react';
import { t, tServer } from './i18n';

export interface OutboxEntry {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;               // API path without the /api prefix
  body?: Record<string, unknown>;
  label: string;             // human description, shown in the sync bar / errors
  tempId?: number;           // negative id of a transaction created offline
  before?: { amount: number; date: string; kind: string }; // transaction state before an edit/delete
  createdAt: number;
}

export class OfflineError extends Error {}

let uid = 0;
let reachable = true;   // last request to the server got through
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((l) => l()); };

export function setOfflineUser(id: number) {
  uid = id; // called before any component reads the store, so no notify needed
}

window.addEventListener('online', () => { reachable = true; notify(); });
window.addEventListener('offline', notify);

export function markReachable(ok: boolean) {
  if (ok !== reachable) { reachable = ok; notify(); }
}
export const isOnline = () => navigator.onLine && reachable;

// ---------- saved copies of GET responses ----------
const cacheKey = (url: string) => `cache:${uid}:${url}`;

export function cacheGet<T>(url: string): T | undefined {
  const raw = localStorage.getItem(cacheKey(url));
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export function cachePut(url: string, data: unknown) {
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify(data));
  } catch {
    // storage full: drop all saved copies (the outbox is kept) and try once more
    clearCache();
    try { localStorage.setItem(cacheKey(url), JSON.stringify(data)); } catch { /* give up */ }
  }
}

export function clearCache() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('cache:')) localStorage.removeItem(k);
}

// ---------- outbox ----------
const outboxKey = () => `outbox:${uid}`;
export const readOutbox = (): OutboxEntry[] => JSON.parse(localStorage.getItem(outboxKey()) || '[]');
function writeOutbox(list: OutboxEntry[]) {
  localStorage.setItem(outboxKey(), JSON.stringify(list));
  notify();
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Queue a change. Returns what the UI should treat as the server's answer. */
export function enqueue(method: OutboxEntry['method'], url: string, body: Record<string, unknown> | undefined,
  meta: { label: string; before?: OutboxEntry['before'] }): Record<string, unknown> {
  let list = readOutbox();
  const entry: OutboxEntry = { id: newId(), method, url, body, label: meta.label, before: meta.before, createdAt: Date.now() };

  if (method === 'POST' && /\/transactions$/.test(url)) {
    entry.tempId = -Date.now();
    entry.body = { ...body, client_id: entry.id };
  } else {
    // a newer change to the same thing replaces the queued one (keep the oldest "before")
    const prev = list.find((e) => e.url === url && e.method !== 'POST');
    if (prev?.before) entry.before = prev.before;
    list = list.filter((e) => !(e.url === url && e.method !== 'POST'));
  }
  writeOutbox([...list, entry]);
  return { ...entry.body, id: entry.tempId, pending: true };
}

/** Edit or delete a transaction that only exists in the outbox (negative id). */
export function changePending(tempId: number, method: string, body?: Record<string, unknown>) {
  const list = readOutbox();
  const i = list.findIndex((e) => e.tempId === tempId);
  if (i < 0) throw new Error(t('This change was already synced. Reload and try again.'));
  if (method === 'DELETE') {
    list.splice(i, 1);
    writeOutbox(list);
    return { ok: true };
  }
  list[i] = { ...list[i], body: { ...body, client_id: list[i].id } };
  writeOutbox(list);
  return { ...list[i].body, id: tempId, pending: true };
}

/** A change sent directly while online supersedes anything queued for the same URL. */
export function supersede(url: string) {
  const list = readOutbox();
  const next = list.filter((e) => !(e.url === url && e.method !== 'POST'));
  if (next.length !== list.length) writeOutbox(next);
}

export function discard(id: string) {
  writeOutbox(readOutbox().filter((e) => e.id !== id));
}

// ---------- sync ----------
export interface SyncResult { sent: number; failed: { label: string; error: string }[]; stoppedOffline: boolean; needLogin: boolean }
let syncing = false;

export async function syncNow(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: [], stoppedOffline: false, needLogin: false };
  if (syncing) return result;
  syncing = true;
  notify();
  try {
    for (const entry of readOutbox()) {
      let res: Response;
      try {
        res = await fetch(`${import.meta.env.BASE_URL}api${entry.url}`, {
          method: entry.method,
          headers: entry.body ? { 'Content-Type': 'application/json' } : undefined,
          body: entry.body ? JSON.stringify(entry.body) : undefined,
          credentials: 'same-origin',
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        markReachable(false);
        result.stoppedOffline = true;
        break;
      }
      if (res.status >= 502) { markReachable(false); result.stoppedOffline = true; break; }
      markReachable(true);
      if (res.status === 401) { result.needLogin = true; break; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const error = res.status === 404
          ? t('it no longer exists on the server (probably deleted on another device or by someone you share with)')
          : res.status === 403 ? t('you no longer have permission (were you removed from the tracker?)')
          : data.error ? tServer(data.error) : `HTTP ${res.status}`;
        result.failed.push({ label: entry.label, error });
      } else {
        result.sent++;
      }
      // done with this entry either way: a rejected change would be rejected again
      writeOutbox(readOutbox().filter((e) => e.id !== entry.id));
    }
  } finally {
    syncing = false;
    notify();
  }
  if (result.sent || result.failed.length) window.dispatchEvent(new Event('synced'));
  return result;
}

// ---------- React ----------
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useOffline() {
  useSyncExternalStore(subscribe, () => version);
  return { online: isOnline(), outbox: readOutbox(), syncing };
}

/** Change in spent amount for one tracker + month from queued (unsynced) changes. */
export function pendingSpendDelta(trackerPath: string, month: string) {
  let delta = 0;
  let count = 0;
  const counts = (x?: { amount: number; date: string; kind: string }) => !!x && x.kind === 'expense' && x.date.startsWith(month);
  for (const e of readOutbox()) {
    if (!e.url.startsWith(`${trackerPath}/transactions`)) continue;
    const after = e.method === 'DELETE' ? undefined : (e.body as { amount: number; date: string; kind: string } | undefined);
    const before = e.method === 'POST' ? undefined : e.before;
    const d = (counts(after) ? Number(after!.amount) : 0) - (counts(before) ? before!.amount : 0);
    if (d !== 0 || counts(after) || counts(before)) count++;
    delta += d;
  }
  return { delta: Math.round(delta * 100) / 100, count };
}
