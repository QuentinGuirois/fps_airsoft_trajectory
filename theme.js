export const THEME_STORAGE_KEY = 'fat-theme';
export const THEME_MODES = Object.freeze(['system', 'dark', 'light']);
export const THEME_COLORS = Object.freeze({ dark: '#10140c', light: '#eef0e2' });

export function normalizeThemeMode(value) {
  return THEME_MODES.includes(value) ? value : 'system';
}

export function resolveTheme(mode, prefersDark = true) {
  const normalized = normalizeThemeMode(mode);
  return normalized === 'system' ? (prefersDark ? 'dark' : 'light') : normalized;
}

export function applyTheme(mode, { document: doc, prefersDark = true } = {}) {
  if (!doc?.documentElement) return resolveTheme(mode, prefersDark);
  const normalized = normalizeThemeMode(mode);
  const resolved = resolveTheme(normalized, prefersDark);
  doc.documentElement.dataset.themeMode = normalized;
  doc.documentElement.dataset.theme = resolved;
  doc.documentElement.style.colorScheme = resolved;
  const themeMeta = doc.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', THEME_COLORS[resolved]);
  return resolved;
}

function readStoredMode(storage, fallback = 'system') {
  try { return normalizeThemeMode(storage?.getItem(THEME_STORAGE_KEY) || fallback); } catch { return fallback; }
}

function storeMode(storage, mode) {
  try { storage?.setItem(THEME_STORAGE_KEY, mode); } catch { /* Le thème reste fonctionnel sans stockage. */ }
}

function createThemeControl(doc, currentMode) {
  const navRow = doc.querySelector('.site-header .nav-row');
  const target = doc.querySelector('[data-theme-slot]') || navRow;
  if (!target) return null;
  const existing = doc.querySelector('[data-theme-control]');
  if (existing) return existing;

  const fieldset = doc.createElement('fieldset');
  fieldset.className = 'theme-switcher';
  fieldset.dataset.themeControl = '';
  fieldset.setAttribute('aria-label', 'Thème de l’interface');
  fieldset.innerHTML = `
    <legend class="visually-hidden">Thème</legend>
    <label class="theme-option"><input type="radio" name="fat-theme" value="system"><span>Système</span></label>
    <label class="theme-option"><input type="radio" name="fat-theme" value="dark"><span>Nuit</span></label>
    <label class="theme-option"><input type="radio" name="fat-theme" value="light"><span>Jour</span></label>
  `;
  const selected = fieldset.querySelector(`input[value="${normalizeThemeMode(currentMode)}"]`);
  if (selected) selected.checked = true;
  target.append(fieldset);
  return fieldset;
}

export function initTheme({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  storage = globalThis.localStorage,
} = {}) {
  if (!doc?.documentElement || !win) return null;
  const media = typeof win.matchMedia === 'function'
    ? win.matchMedia('(prefers-color-scheme: dark)')
    : { matches: true };
  let mode = readStoredMode(storage, doc.documentElement.dataset.themeMode || 'system');
  const control = createThemeControl(doc, mode);

  const commit = (nextMode, { persist = true, announce = true } = {}) => {
    mode = normalizeThemeMode(nextMode);
    if (persist) storeMode(storage, mode);
    const theme = applyTheme(mode, { document: doc, prefersDark: media.matches });
    control?.querySelectorAll('input').forEach((input) => { input.checked = input.value === mode; });
    if (announce && typeof win.CustomEvent === 'function') {
      win.dispatchEvent(new win.CustomEvent('fat:themechange', { detail: { mode, theme } }));
    }
    return theme;
  };

  control?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="fat-theme"]');
    if (input) commit(input.value);
  });

  const handleSystemChange = () => {
    if (mode === 'system') commit('system', { persist: false });
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', handleSystemChange);
  else if (typeof media.addListener === 'function') media.addListener(handleSystemChange);

  win.addEventListener?.('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) commit(event.newValue, { persist: false });
  });

  commit(mode, { persist: false, announce: false });
  return { get mode() { return mode; }, commit, control };
}
