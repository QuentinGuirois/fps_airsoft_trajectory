export const ADVANCED_TRANSITION_KEY = 'fat-advanced-3d-transition';
export const ADVANCED_TRANSITION_MS = 5000;
export const ADVANCED_TRANSITION_MAX_AGE_MS = 30000;

export const ADVANCED_TRANSITION_PHRASES = Object.freeze([
  'Réveil du Web Worker…',
  'Calibrage de l’effet Magnus…',
  'Négociation avec la traînée aérodynamique…',
  'Intégration RK4 en cours, pas de panique…',
  'Le vent refuse de coopérer, on insiste…',
  'Comptage des billes perdues dans l’herbe…',
  'Vérification : ton canon est très joli. +0 m.',
]);

export function markAdvancedTransition(storage = globalThis.sessionStorage, now = Date.now()) {
  try { storage?.setItem(ADVANCED_TRANSITION_KEY, String(now)); } catch { /* Navigation directe disponible. */ }
}

export function consumeAdvancedTransition(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const timestamp = Number(storage?.getItem(ADVANCED_TRANSITION_KEY));
    storage?.removeItem(ADVANCED_TRANSITION_KEY);
    return Number.isFinite(timestamp) && timestamp > 0 && now - timestamp <= ADVANCED_TRANSITION_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export function createAdvancedTransition({
  element,
  busyTarget,
  focusTarget,
  explicit = false,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  durationMs = ADVANCED_TRANSITION_MS,
  now = () => performance.now(),
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
} = {}) {
  const phrase = element?.querySelector('[data-advanced-loader-phrase]');
  const percent = element?.querySelector('[data-advanced-loader-percent]');
  const bar = element?.querySelector('[data-advanced-loader-bar]');
  const progress = element?.querySelector('[data-advanced-loader-progress]');
  const skip = element?.querySelector('[data-advanced-loader-skip]');
  let frame = null;
  let resolveGate = null;
  let gateResolved = false;
  let startedAt = 0;

  const update = (value, message) => {
    const rounded = Math.max(0, Math.min(100, Math.round(value)));
    if (bar) bar.style.width = `${rounded}%`;
    if (percent) percent.textContent = `${rounded} %`;
    progress?.setAttribute('aria-valuenow', String(rounded));
    if (phrase && message) phrase.textContent = message;
  };

  const resolve = (reason) => {
    if (gateResolved) return;
    gateResolved = true;
    cancelFrame(frame);
    frame = null;
    update(100, reason === 'skip' ? 'Chargement passé. Préparation de la scène…' : 'Transition terminée. Préparation de la scène…');
    resolveGate?.(reason);
  };

  const start = () => new Promise((resolvePromise) => {
    resolveGate = resolvePromise;
    if (!explicit || reducedMotion || !element) {
      element?.setAttribute('hidden', '');
      resolve(reducedMotion ? 'reduced' : 'direct');
      return;
    }
    busyTarget?.setAttribute('aria-busy', 'true');
    element.hidden = false;
    element.dataset.state = 'transition';
    startedAt = now();
    update(0, ADVANCED_TRANSITION_PHRASES[0]);
    requestFrame(() => skip?.focus());
    const tick = () => {
      const elapsed = Math.max(0, now() - startedAt);
      const ratio = Math.min(1, elapsed / durationMs);
      const phraseIndex = Math.min(ADVANCED_TRANSITION_PHRASES.length - 1, Math.floor(ratio * ADVANCED_TRANSITION_PHRASES.length));
      update(ratio >= 1 ? 100 : Math.min(99, ratio * 100), ADVANCED_TRANSITION_PHRASES[phraseIndex]);
      if (ratio >= 1) resolve('elapsed');
      else frame = requestFrame(tick);
    };
    frame = requestFrame(tick);
  });

  const finish = () => {
    cancelFrame(frame);
    frame = null;
    if (element) {
      element.hidden = true;
      element.dataset.state = 'ready';
    }
    busyTarget?.setAttribute('aria-busy', 'false');
    focusTarget?.focus?.({ preventScroll: true });
  };

  const fail = (message = 'La vue 3D est indisponible.') => {
    if (!gateResolved) resolve('error');
    if (phrase) phrase.textContent = message;
    finish();
  };

  const onSkip = () => resolve('skip');
  skip?.addEventListener('click', onSkip);

  return {
    explicit,
    reducedMotion,
    start,
    finish,
    fail,
    destroy() {
      cancelFrame(frame);
      skip?.removeEventListener('click', onSkip);
      busyTarget?.setAttribute('aria-busy', 'false');
    },
  };
}
