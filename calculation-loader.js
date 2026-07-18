export const LOADER_DELAY_MS = 300;
export const LOADER_MAX_PENDING = 99;
export const LOADER_PHRASES = Object.freeze([
  'Réveil du Web Worker…',
  'Calibrage de l’effet Magnus…',
  'Négociation avec la traînée aérodynamique…',
  'Intégration RK4 en cours, pas de panique…',
  'Spin decay : ça tourne moins, c’est normal.',
]);

export function pendingLoaderProgress(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const progress = 4 + Math.floor(95 * (1 - Math.exp(-elapsed / 2600)));
  return Math.min(LOADER_MAX_PENDING, progress);
}

export function createCalculationLoader({
  element,
  busyTarget,
  delayMs = LOADER_DELAY_MS,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeater = setInterval,
  clearRepeater = clearInterval,
  requestFrame = requestAnimationFrame,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} = {}) {
  if (!element) return null;
  const phrase = element.querySelector('[data-loader-phrase]');
  const percent = element.querySelector('[data-loader-percent]');
  const bar = element.querySelector('[data-loader-bar]');
  const progressTrack = element.querySelector('[data-loader-progress]');
  let activeRequestId = null;
  let startedAt = 0;
  let showTimer = null;
  let progressTimer = null;
  let hasCompleted = false;
  let visible = false;
  let progress = 0;

  const update = (value, text = null) => {
    progress = Math.max(0, Math.min(100, Math.round(value)));
    if (bar) bar.style.width = `${progress}%`;
    progressTrack?.setAttribute('aria-valuenow', String(progress));
    if (percent) percent.textContent = `${progress} %`;
    if (phrase && text) phrase.textContent = text;
  };

  const clearTimers = () => {
    if (showTimer != null) clearTimer(showTimer);
    if (progressTimer != null) clearRepeater(progressTimer);
    showTimer = null;
    progressTimer = null;
  };

  const hide = () => {
    element.hidden = true;
    visible = false;
    element.dataset.state = 'idle';
  };

  const show = () => {
    if (activeRequestId == null) return;
    visible = true;
    element.hidden = false;
    element.dataset.state = 'pending';
    const tick = () => {
      const elapsed = now() - startedAt;
      const nextPhrase = reducedMotion
        ? LOADER_PHRASES[0]
        : LOADER_PHRASES[Math.floor(elapsed / 1500) % LOADER_PHRASES.length];
      update(pendingLoaderProgress(elapsed), nextPhrase);
    };
    tick();
    progressTimer = setRepeater(tick, 200);
  };

  const releaseBusyState = () => {
    busyTarget?.setAttribute('aria-busy', 'false');
  };

  const start = (requestId, { initial = !hasCompleted } = {}) => {
    clearTimers();
    activeRequestId = requestId;
    startedAt = now();
    visible = false;
    element.hidden = true;
    element.dataset.mode = initial ? 'fullscreen' : 'compact';
    element.dataset.state = 'pending';
    busyTarget?.setAttribute('aria-busy', 'true');
    update(4, LOADER_PHRASES[0]);
    showTimer = setTimer(show, delayMs);
  };

  const complete = (requestId) => {
    if (requestId !== activeRequestId) return false;
    clearTimers();
    activeRequestId = null;
    hasCompleted = true;
    releaseBusyState();
    element.dataset.state = 'success';
    update(100, 'Trajectoire calculée.');
    if (visible) requestFrame(hide); else hide();
    return true;
  };

  const fail = (requestId, message = 'Calcul interrompu.') => {
    if (requestId !== activeRequestId) return false;
    clearTimers();
    activeRequestId = null;
    releaseBusyState();
    element.dataset.state = 'error';
    if (phrase) phrase.textContent = message;
    if (visible) requestFrame(hide); else hide();
    return true;
  };

  const destroy = () => {
    clearTimers();
    activeRequestId = null;
    releaseBusyState();
    hide();
  };

  return {
    start,
    complete,
    fail,
    destroy,
    getState: () => ({ activeRequestId, progress, visible, hasCompleted }),
  };
}
