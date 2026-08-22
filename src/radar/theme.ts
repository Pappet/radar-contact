/** Radar colour palettes (SPEC §9). */

export interface Palette {
  bg: string;
  map: string;
  text: string;
  accent: string;
  alarm: string;
}

export type ThemeName = 'classic' | 'modern';

export const THEMES: Record<ThemeName, Palette> = {
  classic: { bg: '#04140a', map: '#0f5132', text: '#4ade80', accent: '#fbbf24', alarm: '#ef4444' },
  modern: { bg: '#0b1220', map: '#1e293b', text: '#cbd5e1', accent: '#38bdf8', alarm: '#f87171' },
};

export const THEME_NAMES: ThemeName[] = ['classic', 'modern'];
