import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark' | 'amoled';
export type Theme = 'light' | 'dark' | 'amoled';

const KEY = 'theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const META_COLOR: Record<Theme, string> = { light: '#f9f9f7', dark: '#0d0d0d', amoled: '#000000' };

export const getChoice = (): ThemeChoice => (localStorage.getItem(KEY) as ThemeChoice) || 'dark'; // dark by default

export function resolve(choice: ThemeChoice): Theme {
  if (choice === 'system') return mq.matches ? 'dark' : 'light';
  return choice;
}

function apply() {
  const theme = resolve(getChoice());
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
  window.dispatchEvent(new Event('themechange'));
}

export function setChoice(choice: ThemeChoice) {
  localStorage.setItem(KEY, choice);
  apply();
}

mq.addEventListener('change', () => { if (getChoice() === 'system') apply(); });
apply();

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(resolve(getChoice()));
  useEffect(() => {
    const on = () => setTheme(resolve(getChoice()));
    window.addEventListener('themechange', on);
    return () => window.removeEventListener('themechange', on);
  }, []);
  return theme;
}

// Categorical palette: light step -> dark step (same hue, validated on #1a1a19 and #000)
const DARK_STEP: Record<string, string> = {
  '#2a78d6': '#3987e5',
  '#eb6834': '#d95926',
  '#1baf7a': '#199e70',
  '#eda100': '#c98500',
  '#e87ba4': '#d55181',
  '#008300': '#008300',
  '#6250d6': '#9085e9',
  '#e34948': '#e66767',
};

/** Category colors are stored as light steps; swap to the dark step on dark surfaces. */
export function seriesColor(hex: string, theme: Theme) {
  if (theme === 'light') return hex;
  return DARK_STEP[hex.toLowerCase()] ?? hex;
}
