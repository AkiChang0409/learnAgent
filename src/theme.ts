import type { ThemeId } from './types';

export const DEFAULT_THEME: ThemeId = 'paper';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Representative swatches for the settings picker: [背景, 表面, 交易/交互色, 高光/强调] */
  swatches: [string, string, string, string];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'paper',
    name: '墨迹纸感',
    tagline: '冷调纸白 + 墨黑正文，衬线标题，一抹荧光笔高光',
    swatches: ['#f5f6f8', '#ffffff', '#232a3d', '#f2c14e']
  },
  {
    id: 'dark',
    name: '深色专注',
    tagline: '深炭蓝夜读底 + 暖纸白文字，冰蓝强调，长时间沉浸',
    swatches: ['#16181d', '#1e2229', '#5eb3c7', '#e6b450']
  },
  {
    id: 'minimal',
    name: '静雅实用',
    tagline: '冷灰克制 + 靛蓝功能色，无衬线走全程，安静高效',
    swatches: ['#f5f6f8', '#ffffff', '#4f46e5', '#4f46e5']
  }
];

const THEME_IDS = new Set<ThemeId>(THEMES.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value as ThemeId);
}

export function resolveTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

const STORAGE_KEY = 'learnagent-theme';

/** Apply a theme to <html> and mirror it to localStorage so the next launch avoids a flash. */
export function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable; the attribute is what matters this session */
  }
}
