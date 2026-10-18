import { useTheme, type Theme } from './theme';

// Theme-aware chart colors (validated reference palette)
const LIGHT = {
  surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781',
  grid: '#e1e0d9', axis: '#c3c2b7',
  s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a',
  good: '#0ca30c', critical: '#d03b3b', warning: '#fab219',
};
const DARK = {
  surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781',
  grid: '#2c2c2a', axis: '#383835',
  s1: '#3987e5', s2: '#d95926', s3: '#199e70',
  good: '#0ca30c', critical: '#d03b3b', warning: '#fab219',
};
// AMOLED: same dark series steps (validated on #000), true-black surface
const AMOLED = { ...DARK, surface: '#000000', grid: '#1f1f1e', axis: '#2c2c2a' };
export type Palette = typeof LIGHT & { theme: Theme };

export function usePalette(): Palette {
  const theme = useTheme();
  const base = theme === 'light' ? LIGHT : theme === 'dark' ? DARK : AMOLED;
  return { ...base, theme };
}

export const axisProps = (p: Palette) => ({
  stroke: p.axis,
  tick: { fill: p.muted, fontSize: 12 },
  tickLine: false,
});
