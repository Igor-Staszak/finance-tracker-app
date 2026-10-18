import { useCallback, useEffect, useState } from 'react';
import { locale } from './i18n';
import type { Tracker } from './api';

let baseCurrency = 'PLN';
export const setBaseCurrency = (c: string) => { baseCurrency = c; };

export function money(n: number | null | undefined, currency = baseCurrency, opts: { sign?: boolean; compact?: boolean } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  // compact: no decimals; very large amounts as "1,2 mln zł" so they fit small spaces
  const big = opts.compact && Math.abs(n) >= 100_000;
  return new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency,
    notation: big ? 'compact' : 'standard',
    maximumFractionDigits: big ? 1 : opts.compact ? 0 : 2,
    minimumFractionDigits: big || opts.compact ? 0 : 2,
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
  }).format(n);
}

/** Plain number in the user's language: 1234.5 -> "1 234,5" (pl). */
export const num = (n: number, maxDecimals = 2) => n.toLocaleString(locale(), { maximumFractionDigits: maxDecimals });

/** Share of a total as a percentage; tiny non-zero shares show as "<1%" instead of a misleading "0%". */
export function sharePct(part: number, total: number, decimals = 0) {
  if (!total) return `${num(0)}%`;
  const p = (part / total) * 100;
  if (p > 0 && p < 0.5 * 10 ** -decimals) return `<${num(10 ** -decimals, decimals)}%`;
  return `${p.toLocaleString(locale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

/**
 * Parse an amount typed by the user: "12,5", "1 000,50", "1.234,56", "1,234.56", "1000".
 * The last "," or "." is the decimal separator when followed by 1–2 digits; others are thousands separators.
 */
export function parseAmount(input: string): number {
  const s = input.replace(/[\s\u00a0\u202f'_]/g, '');
  if (!s) return NaN;
  const m = s.match(/^([-+]?)([\d.,]*?)(?:[.,](\d{1,2}))?$/);
  if (!m) return NaN;
  const [, sign, intPart, dec] = m;
  if (!/^\d{0,3}([.,]?\d{3})*$|^\d+$/.test(intPart)) return NaN; // grouping must be in threes
  const n = Number(`${sign}${intPart.replace(/[.,]/g, '') || '0'}.${dec ?? '0'}`);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse a quantity / unit price where more than 2 decimals are normal ("0,125", "1 234,5678").
 * A single kind of separator used once is the decimal point; with both, the last one is.
 */
export function parseDecimal(input: string): number {
  let s = input.replace(/[\s\u00a0\u202f'_]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if ((s.match(/,/g) || []).length > 1 || (s.match(/\./g) || []).length > 1) {
    s = s.replace(/[.,]/g, ''); // repeated separator = thousands
  } else {
    s = s.replace(',', '.');
  }
  return /^[-+]?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

/** Placeholder for amount inputs in the user's format ("0,00" / "0.00"). */
export const amountPlaceholder = () => (0).toLocaleString(locale(), { minimumFractionDigits: 2 });

export const pct = (n: number | null | undefined, sign = true) =>
  n == null ? '—' : `${sign && n > 0 ? '+' : ''}${n.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** Date "YYYY-MM-DD" in the user's language, e.g. "18 Oct 2026" / "18 paź 2026". */
export const dateLabel = (date: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(date + 'T00:00').toLocaleDateString(locale(), opts);

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string, short = false) {
  const [y, m] = month.split('-').map(Number);
  // Polish needs the nominative month name ("październik 2026", not "października")
  return new Date(y, m - 1, 1).toLocaleDateString(locale(), short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

/** Fetch helper: returns data, error, loading and a reload function. */
export function useData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Compact axis label: 6000 -> "6k", 1250000 -> "1.3M". */
export const short = (n: number) =>
  new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Notify all pages that spending data changed. */
export const emitTxChanged = () => window.dispatchEvent(new Event('tx-changed'));
export function useTxChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener('tx-changed', cb);
    return () => window.removeEventListener('tx-changed', cb);
  }, [cb]);
}

export const trackerIcon = (t: Tracker) => (t.members.length > 1 ? '👥' : '👤');
