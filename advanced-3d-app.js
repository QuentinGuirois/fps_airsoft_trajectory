import { DEFAULT_SHOT, normalizeShot } from './physics-core.js?v=20260723-47';
import { detectWebGL, mobile3DDisabled } from './render-capabilities.js?v=20260723-47';
import { advancedDeviceAdvice } from './advanced-device.js?v=20260723-47';
import { consumeAdvancedTransition, createAdvancedTransition } from './advanced-transition.js?v=20260723-47';
import { serializeCurveThumbnail } from './assets/js/curve-thumbnail.js?v=20260723-47';
import { createProductionRepositories, RepositoryError } from './assets/js/community-repositories.js?v=20260723-47';

const root = document.querySelector('[data-advanced-3d-app]');

if (root) {
  const STORAGE_KEY = 'fat-shot-v3';
  const SUMMARY_STORAGE_KEY = 'fat-last-summary-v3';
  const aliases = Object.freeze({
    massG: 'm', energyJ: 'j', initialRpm: 'rpm', zeroDistanceM: 'z',
    windSpeedKmh: 'w', windAngleDeg: 'wd', temperatureC: 't',
    pressureHpa: 'p', angleDeg: 'a', cantDeg: 'c',
    shootingHeightM: 'sh', scopeHeightM: 'oh', latitudeDeg: 'lat', diameterMm: 'd',
  });
  const fields = Object.fromEntries(
    [...root.querySelectorAll('[data-advanced-field]')].map((element) => [element.dataset.advancedField, element]),
  );
  const host = root.querySelector('[data-advanced-drone-host]');
  const stage = root.closest('[data-advanced-stage]');
  const fallback = root.querySelector('[data-advanced-fallback]');
  const status = root.querySelector('[data-advanced-status]');
  const legend = root.querySelector('[data-advanced-legend]');
  const metricContext = root.querySelector('[data-advanced-metric-context]');
  const feedback = root.querySelector('[data-advanced-feedback]');
  const saveButton = root.querySelector('[data-advanced-save]');
  const { accountRepository, trajectoryRepository } = createProductionRepositories();
  const cameraButtons = [...root.querySelectorAll('[data-advanced-camera]')];
  const pauseButton = root.querySelector('[data-advanced-pause]');
  const mobileNotice = root.querySelector('[data-advanced-mobile-notice]');
  const transitionElement = document.querySelector('[data-advanced-transition]');
  const drawerDetails = root.querySelector('.advanced-control-drawer details');
  const focusTarget = root.querySelector('[data-advanced-camera="drone"]');
  const metricElements = Object.fromEntries(
    [...root.querySelectorAll('[data-advanced-metric]')].map((element) => [element.dataset.advancedMetric, element]),
  );
  const state = {
    worker: null,
    requestId: 0,
    latestResult: null,
    comparisons: [],
    selectedSeries: 0,
    droneApi: null,
    droneModulePromise: null,
    simulationTimer: null,
    manuallyPaused: false,
    mobileNoticeDismissed: false,
  };
  const explicitTransition = consumeAdvancedTransition();
  const transition = createAdvancedTransition({
    element: transitionElement,
    busyTarget: root,
    focusTarget,
    explicit: explicitTransition,
  });
  const transitionGate = transition.start();

  const format = (value, digits = 1) => Number.isFinite(value)
    ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : '—';

  function droneThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    const color = (name, fallbackColor) => styles.getPropertyValue(name).trim() || fallbackColor;
    return {
      background: color('--scene-background', '#0c1008'),
      ground: color('--scene-ground', '#171c11'),
      grid: color('--scene-grid', '#3a4529'),
      active: color('--chart-active', '#a8ff3f'),
      curve2: color('--curve-2', '#5fd4a8'),
      curve3: color('--curve-3', '#d4b95f'),
      curve4: color('--curve-4', '#e07856'),
      projection: color('--scene-projection', '#5fd4a8'),
      fireline: color('--scene-fireline', '#6b7a4f'),
      ball: color('--scene-ball', '#e9ecdd'),
      impact: color('--chart-marker-impact', '#e07856'),
      groundOpacity: 0.38,
    };
  }

  function readStoredShot() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  }

  function setFieldValue(name, value) {
    if (!fields[name]) return;
    const numeric = Number(value);
    fields[name].value = Number.isFinite(numeric) ? String(Number(numeric.toFixed(4))) : value;
  }

  function applyDefaults() {
    const saved = readStoredShot();
    const query = new URLSearchParams(location.search);
    const values = { ...DEFAULT_SHOT, ...saved };
    if (saved.initialRpm == null && saved.hopPercent != null) {
      values.initialRpm = normalizeShot({ ...values, initialRpm: undefined }).initialRpm;
    }
    for (const [name, alias] of Object.entries(aliases)) {
      if (query.has(alias)) values[name] = Number(query.get(alias));
    }
    if (!query.has('rpm') && query.has('h')) {
      values.initialRpm = normalizeShot({ ...values, initialRpm: undefined, hopPercent: Number(query.get('h')) }).initialRpm;
    }
    for (const [name, element] of Object.entries(fields)) {
      if (values[name] != null) setFieldValue(name, values[name]);
    }
  }

  function readShot() {
    const values = {};
    for (const [name, element] of Object.entries(fields)) values[name] = Number(element.value);
    return normalizeShot(values);
  }

  function persistShot(shot) {
    const allowed = [
      'massG', 'energyJ', 'initialRpm', 'zeroDistanceM', 'windSpeedKmh', 'windAngleDeg',
      'temperatureC', 'pressureHpa', 'angleDeg', 'cantDeg', 'shootingHeightM', 'scopeHeightM',
      'latitudeDeg', 'diameterMm',
    ];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(allowed.map((key) => [key, shot[key]])))); } catch { /* Stockage facultatif. */ }
  }

  function persistLastSummary(result) {
    const config = result?.simulation?.config;
    const usefulRangeM = Number(result?.metrics?.usefulRangeM);
    if (!config || !Number.isFinite(usefulRangeM)) return;
    try {
      localStorage.setItem(SUMMARY_STORAGE_KEY, JSON.stringify({
        energyJ: config.energyJ,
        massG: config.massG,
        usefulRangeM,
        calculatedAt: new Date().toISOString(),
      }));
      window.dispatchEvent(new CustomEvent('fat:lastsummarychange'));
    } catch { /* Stockage facultatif. */ }
  }

  function simulationUrl(shot = readShot()) {
    const query = new URLSearchParams({
      m: shot.massG, j: shot.energyJ.toFixed(2), rpm: shot.initialRpm,
      z: shot.zeroDistanceM, w: shot.windSpeedKmh, wd: shot.windAngleDeg,
      t: shot.temperatureC, p: shot.pressureHpa, a: shot.angleDeg, c: shot.cantDeg,
      sh: shot.shootingHeightM, oh: shot.scopeHeightM,
      lat: shot.latitudeDeg, d: shot.diameterMm,
    });
    return `${location.origin}/?${query}#calculateur`;
  }

  function resultSeries() {
    if (!state.latestResult) return [];
    const config = state.latestResult.simulation.config;
    return [
      {
        label: `Tir actif · ${format(config.massG, 2)} g · ${format(config.energyJ, 2)} J · ${format(config.initialRpm, 0)} tr/min`,
        result: state.latestResult,
        active: true,
      },
      ...state.comparisons.map((comparison) => ({ ...comparison, active: false })),
    ];
  }

  function renderMetrics() {
    const series = resultSeries();
    if (!series.length) return;
    state.selectedSeries = Math.min(state.selectedSeries, series.length - 1);
    const selected = series[state.selectedSeries];
    const { metrics, simulation } = selected.result;
    metricContext.textContent = `${selected.active ? 'Tir actif' : `Comparaison ${state.selectedSeries}`} · ${selected.label.replace(/^Tir actif · /, '')}`;
    metricElements.useful.textContent = `${format(metrics.usefulRangeM, 0)} m`;
    metricElements.impact.textContent = `${format(metrics.maximumRangeM, 0)} m`;
    metricElements.time.textContent = metrics.time50S == null ? 'Hors portée' : `${format(metrics.time50S, 2)} s`;
    metricElements.energy.textContent = metrics.energy50J == null ? 'Hors portée' : `${format(metrics.energy50J, 2)} J`;
    metricElements.drift.textContent = metrics.drift50M == null ? 'Hors portée' : `${format(metrics.drift50M * 100, 1)} cm`;
    root.dataset.selectedSeriesRequestId = String(selected.result.requestId);
    root.dataset.selectedSeriesPointCount = String(simulation.points.length);
  }

  function renderLegend() {
    const series = resultSeries();
    legend.replaceChildren();
    series.forEach((item, index) => {
      const row = document.createElement('li');
      row.className = 'advanced-legend-item';
      row.style.setProperty('--series-color', index === 0 ? 'var(--chart-active)' : `var(--curve-${index + 1})`);
      if (index === state.selectedSeries) row.dataset.selected = 'true';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'advanced-legend-select';
      select.dataset.selectSeries = String(index);
      select.setAttribute('aria-pressed', String(index === state.selectedSeries));
      select.innerHTML = `<span class="advanced-series-swatch" aria-hidden="true"></span><span>${item.label}</span>`;
      row.append(select);
      if (index > 0) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'advanced-legend-remove';
        remove.dataset.removeSeries = String(index - 1);
        remove.setAttribute('aria-label', `Retirer la comparaison ${index}`);
        remove.textContent = 'Retirer';
        row.append(remove);
      }
      legend.append(row);
    });
    renderMetrics();
    root.dataset.seriesCount = String(series.length);
  }

  function updateDrone() {
    state.droneApi?.updateResult(state.latestResult, state.comparisons);
  }

  async function prepareDrone() {
    if (state.droneApi || !state.latestResult) return;
    try {
      state.droneModulePromise ||= import('./drone-3d.js?v=20260723-47');
      const { createDroneView } = await state.droneModulePromise;
      state.droneApi = createDroneView({
        host,
        result: state.latestResult,
        comparisons: state.comparisons,
        colors: droneThemeColors(),
      });
      navigator.serviceWorker?.ready
        ?.then((registration) => registration.active?.postMessage({ type: 'CACHE_3D' }))
        .catch(() => null);
      await transitionGate;
      stage.removeAttribute('data-loading');
      root.dataset.ready = 'true';
      status.textContent = 'Vue 3D prête. Résultat calculé par le Worker ATP.';
      transition.finish();
    } catch (error) {
      showFallback('Le module 3D n’a pas pu être chargé. Le simulateur compact reste disponible.');
      transition.fail(error instanceof Error ? error.message : 'Erreur de chargement 3D.');
    }
  }

  function showFallback(message) {
    fallback.hidden = false;
    fallback.querySelector('[data-advanced-fallback-message]').textContent = message;
    stage.dataset.error = 'true';
    root.dataset.ready = 'error';
    status.textContent = message;
  }

  function receiveResult(message) {
    if (message.requestId !== state.requestId) return;
    root.setAttribute('aria-busy', 'false');
    if (!message.ok) {
      showFallback(`Calcul interrompu : ${message.error}`);
      return;
    }
    state.latestResult = message;
    persistLastSummary(message);
    root.dataset.lastRequestId = String(message.requestId);
    root.dataset.lastPointCount = String(message.simulation.points.length);
    status.textContent = 'Trajectoire reçue. Préparation de la scène 3D…';
    renderLegend();
    if (state.droneApi) {
      updateDrone();
      status.textContent = 'Vue 3D prête. Résultat calculé par le Worker ATP.';
    } else prepareDrone();
  }

  function runSimulation() {
    if (!state.worker) return;
    const shot = readShot();
    persistShot(shot);
    const requestId = ++state.requestId;
    root.setAttribute('aria-busy', 'true');
    status.textContent = 'Calcul ATP en cours…';
    state.worker.postMessage({ type: 'simulate', requestId, shot });
  }

  function scheduleSimulation() {
    clearTimeout(state.simulationTimer);
    state.simulationTimer = setTimeout(runSimulation, 140);
  }

  function addComparison() {
    if (!state.latestResult) return;
    if (state.comparisons.length >= 3) state.comparisons.shift();
    const { config } = state.latestResult.simulation;
    state.comparisons.push({
      label: `${format(config.massG, 2)} g · ${format(config.energyJ, 2)} J · ${format(config.initialRpm, 0)} tr/min · calculé ATP`,
      result: structuredClone(state.latestResult),
    });
    state.selectedSeries = state.comparisons.length;
    renderLegend();
    updateDrone();
  }

  async function saveShot() {
    if (!state.latestResult || saveButton.disabled) return;
    const { config } = state.latestResult.simulation;
    const url = simulationUrl(config);
    saveButton.disabled = true;
    feedback.textContent = 'Enregistrement dans ton espace privé…';
    try {
      const session = await accountRepository.getSession();
      if (!session?.authenticated) throw new RepositoryError('Connexion requise.', { status: 401 });
      const formatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      await trajectoryRepository.create({
        name: `${format(config.massG, 2)} g · ${format(config.energyJ, 2)} J · ${formatter.format(new Date())}`,
        simulationUrl: url,
        massG: config.massG,
        energyJ: config.energyJ,
        usefulRangeM: state.latestResult.metrics?.usefulRangeM ?? null,
        maximumRangeM: state.latestResult.metrics?.maximumRangeM ?? null,
        curveThumbnailSvg: serializeCurveThumbnail(state.latestResult),
      });
      feedback.textContent = 'Courbe enregistrée. Tu peux la retrouver dans Mes courbes et l’associer à une card.';
      saveButton.textContent = 'ENREGISTRÉE ✓';
      window.setTimeout(() => { saveButton.textContent = 'ENREGISTRER'; }, 2200);
    } catch (error) {
      if (error instanceof RepositoryError && error.status === 401) {
        const returnPath = `${location.pathname}${location.search}`;
        location.href = `/compte/?return=${encodeURIComponent(returnPath)}`;
        return;
      }
      feedback.textContent = error?.message || 'La courbe n’a pas pu être enregistrée.';
    } finally {
      saveButton.disabled = false;
    }
  }

  function setCamera(name) {
    state.droneApi?.setCamera(name);
    cameraButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.advancedCamera === name)));
  }

  function updateMobileNotice() {
    if (state.mobileNoticeDismissed || sessionStorage.getItem('fat-advanced-mobile-dismissed') === 'true') {
      mobileNotice.hidden = true;
      return;
    }
    const advice = advancedDeviceAdvice();
    mobileNotice.querySelector('[data-mobile-portrait-copy]').hidden = !advice.portrait;
    mobileNotice.querySelector('[data-mobile-comfort-copy]').hidden = !advice.constrained;
    mobileNotice.hidden = !advice.portrait && !advice.constrained;
    root.dataset.deviceAdvice = advice.constrained ? 'constrained' : advice.portrait ? 'portrait' : 'none';
  }

  async function enterFullscreenLandscape() {
    try {
      if (document.fullscreenElement !== stage) await stage.requestFullscreen?.();
      if (document.fullscreenElement === stage) {
        try { await screen.orientation?.lock?.('landscape'); } catch { /* Refus navigateur accepté. */ }
      }
    } catch { /* La scène reste utilisable sans plein écran. */ }
  }

  for (const element of Object.values(fields)) element.addEventListener('input', scheduleSimulation);
  root.querySelectorAll('[data-advanced-spin]').forEach((button) => {
    button.addEventListener('click', () => {
      fields.initialRpm.value = String(Math.max(0, Number(fields.initialRpm.value) + Number(button.dataset.advancedSpin)));
      scheduleSimulation();
    });
  });
  root.querySelectorAll('[data-advanced-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = JSON.parse(button.dataset.advancedPreset);
      for (const [name, value] of Object.entries(preset)) setFieldValue(name, value);
      scheduleSimulation();
    });
  });
  cameraButtons.forEach((button) => button.addEventListener('click', () => setCamera(button.dataset.advancedCamera)));
  root.querySelector('[data-advanced-replay]').addEventListener('click', () => state.droneApi?.replay());
  root.querySelector('[data-advanced-frame]').addEventListener('click', () => setCamera(cameraButtons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.advancedCamera || 'drone'));
  root.querySelectorAll('[data-advanced-zoom]').forEach((button) => {
    button.addEventListener('click', () => state.droneApi?.zoom(Number(button.dataset.advancedZoom)));
  });
  root.querySelector('[data-advanced-compare]').addEventListener('click', addComparison);
  saveButton.addEventListener('click', saveShot);
  root.querySelector('[data-advanced-reset]').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SUMMARY_STORAGE_KEY);
    state.comparisons = [];
    state.selectedSeries = 0;
    for (const name of Object.keys(fields)) if (DEFAULT_SHOT[name] != null) setFieldValue(name, DEFAULT_SHOT[name]);
    runSimulation();
  });
  pauseButton.addEventListener('click', () => {
    state.manuallyPaused = !state.manuallyPaused;
    if (state.manuallyPaused) state.droneApi?.pause(); else state.droneApi?.resume();
    pauseButton.setAttribute('aria-pressed', String(state.manuallyPaused));
    pauseButton.textContent = state.manuallyPaused ? 'REPRENDRE' : 'PAUSE';
  });
  legend.addEventListener('click', (event) => {
    const select = event.target.closest('[data-select-series]');
    if (select) {
      state.selectedSeries = Number(select.dataset.selectSeries);
      renderLegend();
      return;
    }
    const remove = event.target.closest('[data-remove-series]');
    if (!remove) return;
    const index = Number(remove.dataset.removeSeries);
    state.comparisons.splice(index, 1);
    state.selectedSeries = Math.min(state.selectedSeries, state.comparisons.length);
    renderLegend();
    updateDrone();
  });
  root.querySelector('[data-advanced-mobile-continue]').addEventListener('click', () => {
    state.mobileNoticeDismissed = true;
    sessionStorage.setItem('fat-advanced-mobile-dismissed', 'true');
    mobileNotice.hidden = true;
    focusTarget?.focus();
  });
  root.querySelector('[data-advanced-mobile-fullscreen]').addEventListener('click', enterFullscreenLandscape);
  root.querySelector('[data-advanced-exit-fullscreen]').addEventListener('click', async () => {
    try { await screen.orientation?.unlock?.(); } catch { /* API optionnelle. */ }
    if (document.fullscreenElement) await document.exitFullscreen?.();
  });
  window.addEventListener('resize', updateMobileNotice);
  document.addEventListener('fullscreenchange', () => root.toggleAttribute('data-fullscreen', document.fullscreenElement === stage));
  window.addEventListener('pagehide', () => {
    clearTimeout(state.simulationTimer);
    state.worker?.terminate();
    state.droneApi?.destroy();
    transition.destroy();
  }, { once: true });
  host.addEventListener('fat:droneerror', () => {
    state.droneApi?.destroy();
    state.droneApi = null;
    showFallback('Le contexte WebGL a été interrompu. Reviens au simulateur compact pour poursuivre.');
  });

  applyDefaults();
  if (drawerDetails && matchMedia('(max-width: 900px)').matches) drawerDetails.open = false;
  updateMobileNotice();
  const mobile3dBlocked = mobile3DDisabled();
  root.dataset.webgl = mobile3dBlocked ? 'mobile-disabled' : detectWebGL() ? 'available' : 'unavailable';
  if (mobile3dBlocked) {
    mobileNotice.hidden = true;
    showFallback('La vue 3D est désactivée sur mobile. Le simulateur 2D reste entièrement disponible.');
    transition.fail('3D désactivée sur mobile.');
  } else if (root.dataset.webgl === 'unavailable') {
    showFallback('WebGL n’est pas disponible sur ce navigateur. Le simulateur compact reste accessible.');
    transition.fail('WebGL indisponible.');
  } else if (!('Worker' in window)) {
    showFallback('Le Web Worker ATP n’est pas disponible. Aucun moteur de remplacement n’est chargé.');
    transition.fail('Web Worker indisponible.');
  } else {
    state.worker = new Worker('/trajectory.worker.js?v=20260723-47', { type: 'module' });
    state.worker.addEventListener('message', (event) => receiveResult(event.data));
    state.worker.addEventListener('error', () => {
      state.worker?.terminate();
      state.worker = null;
      showFallback('Le Web Worker ATP a rencontré une erreur. Le simulateur compact reste accessible.');
      transition.fail('Erreur du Web Worker ATP.');
    });
    runSimulation();
  }
}
