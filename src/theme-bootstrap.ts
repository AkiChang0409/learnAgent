import { applyTheme, resolveTheme } from './theme';

let storedTheme: string | null = null;
try {
  storedTheme = window.localStorage.getItem('learnagent-theme');
} catch {
  // The default theme remains available when storage is disabled.
}

applyTheme(resolveTheme(storedTheme));
