// Translations. English text in the code is the lookup key: t('Spent') -> "Wydano" in Polish.
// Missing translations fall back to English. To add a language: add it to LANGS and a dictionary below.
import { useSyncExternalStore } from 'react';
import pl, { serverPatterns as plServer } from './locales/pl';

export type Lang = 'en' | 'pl';

export const LANGS: { code: Lang; label: string; flag: string; locale: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧', locale: 'en-GB' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱', locale: 'pl-PL' },
];

/** Plural forms keyed by Intl.PluralRules categories ("one", "few", "many", "other"). */
export type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dict = Record<string, string | Plural>;

// short labels whose key differs from the English text
const en: Dict = { 'Salary (menu)': 'Salary' };
const DICTS: Record<Lang, Dict> = { en, pl };
const KEY = 'lang';

function detect(): Lang {
  const saved = localStorage.getItem(KEY) as Lang | null;
  if (saved && saved in DICTS) return saved;
  return navigator.language?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

let lang: Lang = detect();
document.documentElement.lang = lang;
const listeners = new Set<() => void>();

export const getLang = () => lang;
export const locale = () => LANGS.find((l) => l.code === lang)!.locale;

export function setLang(next: Lang) {
  lang = next;
  localStorage.setItem(KEY, next);
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function useLang() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => lang);
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

/** Translate a sentence; `{name}` placeholders are filled from vars. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const hit = DICTS[lang][text];
  return fill(typeof hit === 'string' ? hit : text, vars);
}

/**
 * Translate with a count: tn('{n} expense', '{n} expenses', 3).
 * The dictionary entry is keyed by the plural English text and lists the language's plural forms.
 */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  const all = { n, ...vars };
  const hit = DICTS[lang][other];
  if (hit && typeof hit === 'object') {
    const form = new Intl.PluralRules(locale()).select(n);
    return fill(hit[form] ?? hit.other ?? hit.many ?? other, all);
  }
  return fill(n === 1 ? one : other, all);
}

const SERVER_PATTERNS: Record<Lang, [RegExp, string][]> = { en: [], pl: plServer };

/** Translate an error message sent by the server (exact sentence, or a pattern with a captured name). */
export function tServer(msg: string): string {
  if (DICTS[lang][msg]) return t(msg);
  for (const [re, out] of SERVER_PATTERNS[lang]) {
    const m = msg.match(re);
    if (m) return out.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
  }
  return msg;
}
