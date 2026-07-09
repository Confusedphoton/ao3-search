import type { ThemePreference } from '@/src/config/settings';

/** Apply light / dark / system theme to the document root. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}
