export const THEME_COLOR = '#10140c';

export function applyDarkTheme({ document: doc = globalThis.document } = {}) {
  if (!doc?.documentElement) return 'dark';
  doc.documentElement.dataset.theme = 'dark';
  delete doc.documentElement.dataset.themeMode;
  doc.documentElement.style.colorScheme = 'dark';
  const themeMeta = doc.querySelector('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', THEME_COLOR);
  return 'dark';
}

export function initTheme({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
} = {}) {
  try { storage?.removeItem('fat-theme'); } catch { /* Le stockage est optionnel. */ }
  const theme = applyDarkTheme({ document: doc });
  return { theme };
}
