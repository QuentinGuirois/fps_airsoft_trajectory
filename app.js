import {
  ATP,
  DEFAULT_SHOT,
  analyzeTrajectory,
  findFlatSpin,
  fpsToMps,
  holdoverTable,
  mpsToFps,
  normalizeShot,
  simulateTrajectory,
} from './physics-core.js?v=20260723-47';
import { fitChartDomain, prepareChartSeries } from './chart-data.js?v=20260723-47';
import { createCalculationLoader } from './calculation-loader.js?v=20260723-47';
import { detectWebGL, mobile3DDisabled } from './render-capabilities.js?v=20260723-47';
import { serializeCurveThumbnail } from './assets/js/curve-thumbnail.js?v=20260723-47';
import { createProductionRepositories, RepositoryError } from './assets/js/community-repositories.js?v=20260723-47';

const root = document.querySelector('[data-trajectory-app]');

if (root) {
  const fields = Object.fromEntries(
    [...root.querySelectorAll('[data-shot-field]')].map((element) => [element.dataset.shotField, element]),
  );
  const canvas = root.querySelector('#trajectory-chart');
  const chartCaption = root.querySelector('#chart-caption');
  const resultStatus = root.querySelector('#result-status');
  const compareButton = root.querySelector('#compare-shot');
  const resetButton = root.querySelector('#reset-shot');
  const shareButton = root.querySelector('#share-shot');
  const shareFeedback = root.querySelector('#share-feedback');
  const { accountRepository, trajectoryRepository } = createProductionRepositories();
  const rpmOutput = root.querySelector('#rpm-output');
  const spinSetting = root.querySelector('#spin-setting');
  const spinAdjustment = root.querySelector('#spin-adjustment');
  const spinAutoButton = root.querySelector('#spin-auto');
  const comparisonList = root.querySelector('#comparison-list');
  const chartReferenceLegend = root.querySelector('#chart-reference-legend');
  const verticalScaleChip = root.querySelector('#vertical-scale-chip');
  const profile2dView = root.querySelector('[data-profile-2d]');
  const droneView = root.querySelector('[data-drone-view]');
  const droneHost = root.querySelector('[data-drone-host]');
  const droneStatus = root.querySelector('[data-drone-status]');
  const view2dButton = root.querySelector('[data-view-mode="2d"]');
  const view3dButton = root.querySelector('[data-view-mode="3d"]');
  const droneCameraButtons = [...root.querySelectorAll('[data-drone-camera]')];
  const tableBody = root.querySelector('#holdover-body');
  const metricElements = Object.fromEntries(
    [...root.querySelectorAll('[data-metric]')].map((element) => [element.dataset.metric, element]),
  );
  const mobileMetricElements = Object.fromEntries(
    [...root.querySelectorAll('[data-mobile-metric]')].map((element) => [element.dataset.mobileMetric, element]),
  );
  const calculationLoader = createCalculationLoader({
    element: document.querySelector('[data-calculation-loader]'),
    busyTarget: root,
  });

  const state = {
    worker: null,
    requestId: 0,
    latestResult: null,
    comparisons: [],
    chartMode: 'trajectory',
    energyWasLastEdited: true,
    resizeFrame: null,
    flatSpinRpm: null,
    flatSpinRangeM: null,
    spinOffsetRpm: 0,
    droneApi: null,
    droneModulePromise: null,
    droneActive: false,
    droneFullscreenEntered: false,
  };
  const SPIN_STEP_RPM = 250;

  const format = (value, digits = 1) => Number.isFinite(value)
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
    : '—';

  function droneThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    const color = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
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

  function setViewButtons(mode) {
    view2dButton?.setAttribute('aria-pressed', String(mode === '2d'));
    view3dButton?.setAttribute('aria-pressed', String(mode === '3d'));
  }

  function setDroneCamera(name) {
    state.droneApi?.setCamera(name);
    droneCameraButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.droneCamera === name)));
    if (droneStatus) droneStatus.textContent = `Caméra ${name === 'shooter' ? 'tireur' : name}.`;
  }

  async function closeDrone({ exitFullscreen = true, restoreFocus = false } = {}) {
    if (!state.droneActive && !state.droneApi) return;
    state.droneActive = false;
    state.droneApi?.destroy();
    state.droneApi = null;
    droneView?.removeAttribute('data-loading');
    if (droneView) droneView.hidden = true;
    if (profile2dView) profile2dView.hidden = false;
    root.classList.remove('is-drone-active');
    document.body.classList.remove('has-drone-overlay');
    setViewButtons('2d');
    try { await screen.orientation?.unlock?.(); } catch { /* API optionnelle */ }
    if (exitFullscreen && document.fullscreenElement === droneView) {
      try { await document.exitFullscreen(); } catch { /* sortie navigateur best effort */ }
    }
    state.droneFullscreenEntered = false;
    drawChart();
    if (restoreFocus) view3dButton?.focus();
  }

  async function openDrone() {
    if (state.droneActive || !state.latestResult || view3dButton?.hidden) return;
    state.droneActive = true;
    setViewButtons('3d');
    if (profile2dView) profile2dView.hidden = true;
    if (droneView) {
      droneView.hidden = false;
      droneView.dataset.loading = 'true';
    }
    root.classList.add('is-drone-active');
    document.body.classList.add('has-drone-overlay');
    verticalScaleChip.hidden = true;
    if (droneStatus) droneStatus.textContent = 'Chargement de la vue drone 3D.';

    const mobile = matchMedia('(max-width: 620px)').matches;
    if (mobile && droneView?.requestFullscreen) {
      try {
        await droneView.requestFullscreen();
        state.droneFullscreenEntered = document.fullscreenElement === droneView;
        if (state.droneFullscreenEntered) {
          try { await screen.orientation?.lock?.('landscape'); } catch { /* refus autorisé */ }
        }
      } catch { /* le mode portrait fixe reste utilisable */ }
    }

    try {
      state.droneModulePromise ||= import('./drone-3d.js?v=20260723-47');
      const { createDroneView } = await state.droneModulePromise;
      if (!state.droneActive) return;
      state.droneApi = createDroneView({
        host: droneHost,
        result: state.latestResult,
        comparisons: state.comparisons,
        colors: droneThemeColors(),
        profileVerticalExaggeration: Number(verticalScaleChip.textContent.split('×')[1]?.replace(',', '.')) || 1,
      });
      navigator.serviceWorker?.ready
        ?.then((registration) => registration.active?.postMessage({ type: 'CACHE_3D' }))
        .catch(() => null);
      droneView?.removeAttribute('data-loading');
      setDroneCamera('drone');
      if (droneStatus) droneStatus.textContent = 'Vue drone 3D chargée.';
    } catch {
      state.droneModulePromise = null;
      if (view3dButton) view3dButton.hidden = true;
      root.dataset.webgl = 'import-error';
      if (droneStatus) droneStatus.textContent = 'Vue 3D indisponible. La vue 2D reste active.';
      await closeDrone({ restoreFocus: false });
    }
  }

  function setField(name, value, digits = null) {
    if (!fields[name]) return;
    fields[name].value = digits == null ? value : Number(value).toFixed(digits);
  }

  function applyDefaults() {
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem('fat-shot-v3') || '{}'); } catch { return {}; }
    })();
    const query = new URLSearchParams(location.search);
    const aliases = {
      massG: 'm', energyJ: 'j', initialRpm: 'rpm', zeroDistanceM: 'z',
      windSpeedKmh: 'w', windAngleDeg: 'wd', temperatureC: 't',
      pressureHpa: 'p', angleDeg: 'a', cantDeg: 'c',
      shootingHeightM: 'sh', scopeHeightM: 'oh', latitudeDeg: 'lat', diameterMm: 'd',
    };
    const values = { ...DEFAULT_SHOT, ...saved };
    if (saved.initialRpm == null && saved.hopPercent != null) {
      values.initialRpm = normalizeShot({ ...values, initialRpm: undefined }).initialRpm;
    }
    for (const [name, alias] of Object.entries(aliases)) {
      if (query.has(alias)) values[name] = Number(query.get(alias));
    }
    if (!query.has('rpm') && query.has('h')) {
      values.initialRpm = normalizeShot({
        ...values,
        initialRpm: undefined,
        hopPercent: Number(query.get('h')),
      }).initialRpm;
    }
    for (const [name, element] of Object.entries(fields)) {
      if (values[name] != null) element.value = values[name];
    }
    syncVelocityFromEnergy();
    return {
      preserveCurrentSpin: query.has('rpm') || query.has('h'),
      savedSpinOffsetRpm: Number(saved._spinOffsetRpm) || 0,
    };
  }

  function syncVelocityFromEnergy() {
    const massKg = Math.max(Number(fields.massG?.value) || DEFAULT_SHOT.massG, 0.01) / 1000;
    const energy = Math.max(Number(fields.energyJ?.value) || 0, 0);
    const mps = Math.sqrt(2 * energy / massKg);
    setField('velocityFps', mpsToFps(mps), 0);
    setField('velocityMps', mps, 1);
  }

  function syncEnergyFromVelocity() {
    const massKg = Math.max(Number(fields.massG?.value) || DEFAULT_SHOT.massG, 0.01) / 1000;
    const fps = Math.max(Number(fields.velocityFps?.value) || 0, 0);
    const mps = fpsToMps(fps);
    setField('velocityMps', mps, 1);
    setField('energyJ', 0.5 * massKg * mps ** 2, 2);
  }

  function readShot() {
    const input = {};
    for (const [name, element] of Object.entries(fields)) {
      if (name === 'velocityFps' || name === 'velocityMps') continue;
      input[name] = Number(element.value);
    }
    return normalizeShot(input);
  }

  function persistShot(shot) {
    const allowed = [
      'massG', 'energyJ', 'initialRpm', 'zeroDistanceM', 'windSpeedKmh',
      'windAngleDeg', 'temperatureC', 'pressureHpa', 'angleDeg', 'cantDeg',
      'shootingHeightM', 'scopeHeightM', 'latitudeDeg', 'diameterMm',
    ];
    const stored = Object.fromEntries(allowed.map((key) => [key, shot[key]]));
    stored._spinOffsetRpm = state.spinOffsetRpm;
    try { localStorage.setItem('fat-shot-v3', JSON.stringify(stored)); } catch { /* stockage facultatif */ }
  }

  function persistLastSummary(result) {
    const config = result?.simulation?.config;
    const usefulRangeM = Number(result?.metrics?.usefulRangeM);
    if (!config || !Number.isFinite(usefulRangeM)) return;
    const summary = {
      energyJ: config.energyJ,
      massG: config.massG,
      usefulRangeM,
      calculatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem('fat-last-summary-v3', JSON.stringify(summary));
      window.dispatchEvent(new CustomEvent('fat:lastsummarychange'));
    } catch { /* Stockage facultatif. */ }
  }

  function updateSpinReadout() {
    const shot = readShot();
    const offsetRpm = state.flatSpinRpm == null ? 0 : shot.initialRpm - state.flatSpinRpm;
    state.spinOffsetRpm = offsetRpm;
    if (spinSetting) spinSetting.textContent = 'HOP UP AUTO';
    if (spinAdjustment) {
      spinAdjustment.textContent = offsetRpm === 0
        ? 'tir tendu conseillé'
        : `correction ${offsetRpm > 0 ? '+' : '−'}${format(Math.abs(offsetRpm), 0)} tr/min`;
    }
    if (rpmOutput) {
      const spinRegime = shot.initialSpinRatio > 0
        && shot.initialSpinRatio < ATP.reverseMagnusLimit
        ? ' · Reverse Magnus au départ'
        : '';
      const flatRange = Number.isFinite(state.flatSpinRangeM)
        ? ` · tendu ≈ ${format(state.flatSpinRangeM, 0)} m`
        : '';
      rpmOutput.textContent = `${format(shot.initialRpm, 0)} tr/min · V/U ${format(shot.initialSpinRatio, 3)}${flatRange}${spinRegime}`;
    }
  }

  function recalculateFlatSpin({ preserveCurrent = false, offsetRpm = 0 } = {}) {
    const currentRpm = Number(fields.initialRpm?.value) || 0;
    const recommendation = findFlatSpin(readShot(), { incrementRpm: SPIN_STEP_RPM });
    state.flatSpinRpm = recommendation.initialRpm;
    state.flatSpinRangeM = recommendation.flatRangeM;
    const selectedRpm = preserveCurrent
      ? currentRpm
      : Math.max(0, recommendation.initialRpm + offsetRpm);
    setField('initialRpm', selectedRpm);
    state.spinOffsetRpm = selectedRpm - recommendation.initialRpm;
    updateSpinReadout();
  }

  function scheduleFlatSpin() {
    clearTimeout(scheduleFlatSpin.timer);
    clearTimeout(scheduleSimulation.timer);
    resultStatus.textContent = 'Recherche du hop-up tendu…';
    root.classList.add('is-calculating');
    scheduleFlatSpin.timer = setTimeout(() => {
      recalculateFlatSpin();
      scheduleSimulation();
    }, 160);
  }

  function scheduleSimulation() {
    clearTimeout(scheduleSimulation.timer);
    scheduleSimulation.timer = setTimeout(runSimulation, 120);
    updateSpinReadout();
  }

  async function runLocalSimulation(requestId, shot) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const simulation = simulateTrajectory(shot);
      receiveResult({
        ok: true,
        requestId,
        simulation,
        metrics: analyzeTrajectory(simulation),
        holdover: holdoverTable(simulation),
      });
    } catch (error) {
      receiveResult({ ok: false, requestId, error: error?.message || 'Erreur de calcul' });
    }
  }

  async function runSimulation() {
    const shot = readShot();
    persistShot(shot);
    const requestId = ++state.requestId;
    resultStatus.textContent = 'Calcul ATP en cours…';
    root.classList.add('is-calculating');
    calculationLoader?.start(requestId, { initial: state.latestResult == null });

    if (state.worker) {
      state.worker.postMessage({ type: 'simulate', requestId, shot });
      return;
    }

    await runLocalSimulation(requestId, shot);
  }

  function receiveResult(message) {
    if (message.requestId !== state.requestId) return;
    root.classList.remove('is-calculating');
    if (!message.ok) {
      calculationLoader?.fail(message.requestId, 'Calcul interrompu.');
      resultStatus.textContent = `Calcul interrompu : ${message.error}`;
      return;
    }
    calculationLoader?.complete(message.requestId);
    state.latestResult = message;
    try {
      sessionStorage.setItem('fat.pending-replica.v1', JSON.stringify({
        simulationUrl: buildShareUrl(message.simulation.config),
        curveThumbnailSvg: serializeCurveThumbnail(message),
        usefulRangeM: message.metrics?.usefulRangeM ?? null,
        maximumRangeM: message.metrics?.maximumRangeM ?? null,
        massG: message.simulation?.config?.massG ?? null,
        energyJ: message.simulation?.config?.energyJ ?? null,
        generatedAt: Date.now(),
      }));
    } catch { /* L’enregistrement de card reste une amélioration facultative. */ }
    persistLastSummary(message);
    root.dataset.lastRequestId = String(message.requestId);
    root.dataset.lastPointCount = String(message.simulation.points.length);
    renderResults();
  }

  function valueAt(metrics, key, suffix, digits = 1) {
    const value = metrics[key];
    return Number.isFinite(value) ? `${format(value, digits)}${suffix}` : 'Hors portée';
  }

  function renderResults() {
    const { metrics, simulation, holdover } = state.latestResult;
    const { config } = simulation;
    if (view3dButton && root.dataset.webgl === 'available') view3dButton.disabled = false;
    metricElements.muzzleEnergy.textContent = valueAt({ value: config.energyJ }, 'value', ' J', 2);
    metricElements.usefulRange.textContent = valueAt(metrics, 'usefulRangeM', ' m', 0);
    metricElements.maximumRange.textContent = valueAt(metrics, 'maximumRangeM', ' m', 0);
    metricElements.time50.textContent = valueAt(metrics, 'time50S', ' s', 2);
    metricElements.energy50.textContent = valueAt(metrics, 'energy50J', ' J', 2);
    metricElements.drift50.textContent = valueAt(
      { drift: metrics.drift50M == null ? null : metrics.drift50M * 100 },
      'drift', ' cm', 1,
    );
    metricElements.rpm.textContent = `${format(config.initialRpm, 0)} tr/min`;
    metricElements.cannonAngle.textContent = `${format(config.angleDeg, 2)}°`;
    for (const [name, element] of Object.entries(mobileMetricElements)) {
      element.textContent = metricElements[name]?.textContent || '—';
    }
    const zeroStatus = metrics.sight.zeroResolved
      ? `zéro optique ${format(config.zeroDistanceM, 0)} m`
      : `zéro optique ${format(config.zeroDistanceM, 0)} m hors portée`;
    resultStatus.textContent = `Modèle ATP · ${zeroStatus} · ${format(simulation.atmosphere.densityKgM3, 3)} kg/m³ · pas ${format(config.dt * 1000, 1)} ms`;

    tableBody.innerHTML = holdover.map((row) => `
      <tr>
        <th scope="row">${format(row.distanceM, 0)} m</th>
        <td class="${row.deviationCm >= 0 ? 'positive' : 'negative'}">${row.deviationCm >= 0 ? '+' : ''}${format(row.deviationCm, 1)} cm</td>
        <td>${format(row.correctionMrad, 1)} mrad</td>
        <td>${format(row.energyJ, 2)} J</td>
        <td>${format(row.timeS, 2)} s</td>
        <td>${row.driftCm >= 0 ? '+' : ''}${format(row.driftCm, 1)} cm</td>
      </tr>
    `).join('');
    if (state.droneApi) state.droneApi.updateResult(state.latestResult, state.comparisons);
    if (!state.droneActive) drawChart();
  }

  function drawChart() {
    if (!canvas || !state.latestResult) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(300, rect.width);
    const height = Math.max(104, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.documentElement);
    const cssColor = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    const colors = [
      cssColor('--chart-active', '#a8ff3f'),
      cssColor('--curve-2', '#5fd4a8'),
      cssColor('--curve-3', '#d4b95f'),
      cssColor('--curve-4', '#e07856'),
    ];
    const gridColor = cssColor('--chart-grid', '#1d2415');
    const labelColor = cssColor('--chart-label', '#8b9378');
    const sightColor = cssColor('--chart-sight', '#6b7a4f');
    const groundColor = cssColor('--chart-ground', '#3a4529');
    const envelopeColor = cssColor('--chart-envelope', 'rgb(168 255 63 / 8%)');
    const markerUsefulColor = cssColor('--chart-marker-useful', '#a8ff3f');
    const markerApexColor = cssColor('--chart-marker-apex', '#b5b09a');
    const markerImpactColor = cssColor('--chart-marker-impact', '#e07856');

    const currentConfig = state.latestResult.simulation.config;
    const prepared = prepareChartSeries(
      {
        ...state.latestResult,
        label: `${format(currentConfig.massG, 2)} g · ${format(currentConfig.energyJ, 2)} J`,
      },
      state.comparisons.map((item) => ({ ...item.result, label: item.label })),
      state.chartMode,
    );
    const series = prepared.series.map((item) => ({ ...item, color: colors[item.colorIndex] }));
    const current = series[0];
    const all = series.flatMap((item) => item.values);
    const maxX = Math.max(10, ...all.map((point) => point.x));

    const compact = width < 520;
    const margin = compact
      ? { top: 18, right: 10, bottom: 30, left: 38 }
      : { top: 26, right: 18, bottom: 40, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const { minY, maxY, verticalExaggeration } = fitChartDomain({
      series,
      trajectory: prepared.trajectory,
      maxX,
      plotWidth,
      plotHeight,
    });
    const mapX = (value) => margin.left + value / maxX * plotWidth;
    const mapY = (value) => margin.top + (maxY - value) / (maxY - minY) * plotHeight;

    if (verticalScaleChip) {
      verticalScaleChip.hidden = state.chartMode !== 'trajectory';
      if (verticalExaggeration != null) {
        const factor = Math.abs(verticalExaggeration - 10) < 0.05
          ? '10'
          : format(verticalExaggeration, 1);
        verticalScaleChip.textContent = `HAUTEUR ×${factor}`;
      }
    }

    context.font = `500 ${compact ? 9 : 11}px "IBM Plex Mono", ui-monospace, monospace`;
    context.lineWidth = 1;
    context.strokeStyle = gridColor;
    context.fillStyle = labelColor;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    const gridSteps = compact ? 4 : 5;
    for (let step = 0; step <= gridSteps; step += 1) {
      const value = minY + (maxY - minY) * step / gridSteps;
      const y = mapY(value);
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
      context.fillText(format(value, Math.abs(maxY - minY) > 100 ? 0 : 1), margin.left - 5, y);
    }
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (let step = 0; step <= gridSteps; step += 1) {
      const value = maxX * step / gridSteps;
      const x = mapX(value);
      context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, height - margin.bottom); context.stroke();
      context.fillText(`${format(value, 0)} m`, x, height - margin.bottom + 7);
    }

    context.save();
    context.beginPath();
    context.rect(margin.left, margin.top, plotWidth, plotHeight);
    context.clip();

    if (prepared.trajectory) {
      const { guides } = prepared.trajectory;
      context.beginPath();
      guides.upper.forEach((point, index) => {
        if (index === 0) context.moveTo(mapX(point.x), mapY(point.y));
        else context.lineTo(mapX(point.x), mapY(point.y));
      });
      [...guides.lower].reverse().forEach((point) => context.lineTo(mapX(point.x), mapY(point.y)));
      context.closePath();
      context.fillStyle = envelopeColor;
      context.fill();

      context.strokeStyle = sightColor;
      context.lineWidth = 1.5;
      context.setLineDash([6, 6]);
      context.beginPath();
      guides.sightline.forEach((point, index) => {
        if (index === 0) context.moveTo(mapX(point.x), mapY(point.y));
        else context.lineTo(mapX(point.x), mapY(point.y));
      });
      context.stroke();
      context.setLineDash([]);

      if (minY <= 0 && maxY >= 0) {
        context.strokeStyle = groundColor;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(margin.left, mapY(0));
        context.lineTo(width - margin.right, mapY(0));
        context.stroke();
      }
    }
    if (current.showZeroLine && minY <= 0 && maxY >= 0) {
      context.strokeStyle = sightColor;
      context.setLineDash([5, 5]);
      context.beginPath(); context.moveTo(margin.left, mapY(0)); context.lineTo(width - margin.right, mapY(0)); context.stroke();
      context.setLineDash([]);
    }

    series.forEach((item, seriesIndex) => {
      context.beginPath();
      item.values.forEach((point, index) => {
        const x = mapX(point.x);
        const y = mapY(point.y);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.strokeStyle = item.color;
      context.lineWidth = seriesIndex === 0 ? 3.5 : 2;
      context.setLineDash(seriesIndex === 0 ? [] : [10, 5]);
      context.stroke();
      context.setLineDash([]);
    });

    if (prepared.trajectory) {
      const drawMarker = (marker, color, direction = 1, labelOffsetY = -5) => {
        if (!marker || marker.x < 0 || marker.x > maxX || marker.y < minY || marker.y > maxY) return;
        const x = mapX(marker.x);
        const y = mapY(marker.y);
        context.fillStyle = color;
        context.beginPath();
        context.arc(x, y, compact ? 3 : 4, 0, Math.PI * 2);
        context.fill();
        context.font = `600 ${compact ? 8 : 10}px "IBM Plex Mono", ui-monospace, monospace`;
        context.textAlign = direction < 0 ? 'right' : 'left';
        context.textBaseline = labelOffsetY > 0 ? 'top' : 'bottom';
        context.fillText(marker.label.toUpperCase(), x + direction * 6, y + labelOffsetY);
      };
      drawMarker(prepared.trajectory.markers.useful, markerUsefulColor, -1, 6);
      drawMarker(prepared.trajectory.markers.apex, markerApexColor, 1);
      drawMarker(prepared.trajectory.markers.impact, markerImpactColor, -1);
    }
    context.restore();

    chartCaption.textContent = `${current.axisLabel} (${current.unit}) selon la distance.${current.referenceLabel ? ` ${current.referenceLabel}` : ''}`;
    canvas.setAttribute('aria-label', chartCaption.textContent);
    renderComparisonList(series);
    renderReferenceLegend(Boolean(prepared.trajectory));
  }

  function renderComparisonList(series) {
    comparisonList.innerHTML = series.map((item, index) => `
      <li>
        <span class="legend-swatch" style="--legend:${item.color}"></span>
        <span>${item.label}</span>
        ${index === 0 ? '<small>Actuel</small>' : `<button type="button" data-remove-comparison="${index - 1}" aria-label="Retirer ${item.label}">×</button>`}
      </li>
    `).join('');
  }

  function renderReferenceLegend(showTrajectoryGuides) {
    if (!chartReferenceLegend) return;
    chartReferenceLegend.innerHTML = showTrajectoryGuides ? `
      <li><span class="reference-swatch reference-envelope"></span>Marge buste 60 cm · ±60 cm</li>
      <li><span class="reference-swatch reference-sight"></span>Ligne de visée</li>
      <li><span class="reference-swatch reference-ground"></span>Sol</li>
      <li><span class="reference-swatch reference-markers"></span>Utile · apex · impact</li>
    ` : '';
  }

  function addComparison() {
    if (!state.latestResult) return;
    const { config } = state.latestResult.simulation;
    if (state.comparisons.length >= 3) state.comparisons.shift();
    state.comparisons.push({
      label: `${format(config.massG, 2)} g · ${format(config.energyJ, 2)} J · ${format(config.initialRpm, 0)} tr/min`,
      result: structuredClone(state.latestResult),
    });
    state.droneApi?.updateResult(state.latestResult, state.comparisons);
    drawChart();
  }

  function buildShareUrl(shot = readShot()) {
    const query = new URLSearchParams({
      m: shot.massG, j: shot.energyJ.toFixed(2), rpm: shot.initialRpm,
      z: shot.zeroDistanceM, w: shot.windSpeedKmh, wd: shot.windAngleDeg,
      t: shot.temperatureC, p: shot.pressureHpa, a: shot.angleDeg, c: shot.cantDeg,
      sh: shot.shootingHeightM, oh: shot.scopeHeightM,
      lat: shot.latitudeDeg, d: shot.diameterMm,
    });
    return `${location.origin}${location.pathname}?${query}#calculateur`;
  }

  async function saveShot() {
    if (!state.latestResult || shareButton.disabled) return;
    const { config } = state.latestResult.simulation;
    const url = buildShareUrl(config);
    history.replaceState(history.state, '', url);
    shareButton.disabled = true;
    if (shareFeedback) shareFeedback.textContent = 'Enregistrement dans ton espace privé…';
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
      if (shareFeedback) shareFeedback.textContent = 'Courbe enregistrée. Tu peux la retrouver dans Mes courbes et l’associer à une card.';
      shareButton.textContent = 'ENREGISTRÉE ✓';
      window.setTimeout(() => { shareButton.textContent = 'ENREGISTRER'; }, 2200);
    } catch (error) {
      if (error instanceof RepositoryError && error.status === 401) {
        const returnPath = `${location.pathname}${location.search}#calculateur`;
        location.href = `/compte/?return=${encodeURIComponent(returnPath)}`;
        return;
      }
      if (shareFeedback) shareFeedback.textContent = error?.message || 'La courbe n’a pas pu être enregistrée.';
    } finally {
      shareButton.disabled = false;
    }
  }

  const flatSpinInputs = new Set([
    'massG', 'energyJ', 'velocityFps', 'temperatureC', 'pressureHpa', 'diameterMm',
  ]);

  for (const [name, element] of Object.entries(fields)) {
    element.addEventListener('input', () => {
      if (name === 'energyJ') {
        state.energyWasLastEdited = true;
        syncVelocityFromEnergy();
      } else if (name === 'velocityFps') {
        state.energyWasLastEdited = false;
        syncEnergyFromVelocity();
      } else if (name === 'massG') {
        if (state.energyWasLastEdited) syncVelocityFromEnergy(); else syncEnergyFromVelocity();
      }
      if (flatSpinInputs.has(name)) scheduleFlatSpin();
      else scheduleSimulation();
    });
  }

  root.querySelectorAll('[data-shot-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = JSON.parse(button.dataset.shotPreset);
      for (const [name, value] of Object.entries(preset)) setField(name, value);
      state.energyWasLastEdited = true;
      syncVelocityFromEnergy();
      if (Object.hasOwn(preset, 'initialRpm')) {
        recalculateFlatSpin({ preserveCurrent: true });
        scheduleSimulation();
      } else {
        scheduleFlatSpin();
      }
    });
  });

  root.querySelectorAll('[data-spin-delta]').forEach((button) => {
    button.addEventListener('click', () => {
      const deltaRpm = Number(button.dataset.spinDelta) || 0;
      const currentRpm = Number(fields.initialRpm?.value) || state.flatSpinRpm || 0;
      setField('initialRpm', Math.max(0, currentRpm + deltaRpm));
      updateSpinReadout();
      scheduleSimulation();
    });
  });

  spinAutoButton?.addEventListener('click', () => {
    if (state.flatSpinRpm == null) recalculateFlatSpin();
    else setField('initialRpm', state.flatSpinRpm);
    state.spinOffsetRpm = 0;
    updateSpinReadout();
    scheduleSimulation();
  });

  const chartTabs = [...root.querySelectorAll('[data-chart-mode]')];
  const selectChartTab = (button) => {
    if (!button) return;
    state.chartMode = button.dataset.chartMode;
    chartTabs.forEach((item) => {
      const selected = item === button;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    drawChart();
  };
  chartTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectChartTab(button));
    button.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? chartTabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + chartTabs.length) % chartTabs.length;
      chartTabs[nextIndex].focus();
      selectChartTab(chartTabs[nextIndex]);
    });
  });

  const mobile3dDisabled = mobile3DDisabled();
  const webglAvailable = !mobile3dDisabled && detectWebGL();
  root.dataset.webgl = mobile3dDisabled ? 'mobile-disabled' : webglAvailable ? 'available' : 'unavailable';
  if (view3dButton) view3dButton.hidden = !webglAvailable;
  view3dButton?.addEventListener('click', openDrone);
  view2dButton?.addEventListener('click', () => closeDrone({ restoreFocus: false }));
  droneCameraButtons.forEach((button) => {
    button.addEventListener('click', () => setDroneCamera(button.dataset.droneCamera));
  });
  root.querySelector('[data-drone-replay]')?.addEventListener('click', () => {
    state.droneApi?.replay();
    if (droneStatus) droneStatus.textContent = 'Lecture de la trajectoire relancée.';
  });
  root.querySelector('[data-drone-frame]')?.addEventListener('click', () => {
    const selected = droneCameraButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
    setDroneCamera(selected?.dataset.droneCamera || 'drone');
  });
  root.querySelector('[data-drone-exit]')?.addEventListener('click', () => closeDrone({ restoreFocus: true }));
  droneHost?.addEventListener('fat:droneerror', async () => {
    if (view3dButton) view3dButton.hidden = true;
    root.dataset.webgl = 'context-lost';
    if (droneStatus) droneStatus.textContent = 'Contexte 3D interrompu. La vue 2D reste active.';
    await closeDrone({ restoreFocus: false });
  });
  document.addEventListener('fullscreenchange', () => {
    if (state.droneFullscreenEntered && document.fullscreenElement !== droneView) {
      closeDrone({ exitFullscreen: false, restoreFocus: true });
    }
  });

  root.addEventListener('focusin', (event) => {
    if (event.target.closest('.control-panel input, .control-panel select, .control-panel button, .control-panel summary')) {
      root.classList.add('is-editing-field');
    }
  });
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!document.activeElement?.closest?.('.control-panel')) root.classList.remove('is-editing-field');
    }, 0);
  });

  comparisonList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-comparison]');
    if (!button) return;
    state.comparisons.splice(Number(button.dataset.removeComparison), 1);
    state.droneApi?.updateResult(state.latestResult, state.comparisons);
    drawChart();
  });

  compareButton.addEventListener('click', addComparison);
  shareButton.addEventListener('click', saveShot);
  resetButton.addEventListener('click', () => {
    localStorage.removeItem('fat-shot-v3');
    localStorage.removeItem('fat-last-summary-v3');
    for (const [name, element] of Object.entries(fields)) {
      if (DEFAULT_SHOT[name] != null) element.value = DEFAULT_SHOT[name];
    }
    state.comparisons = [];
    state.droneApi?.updateResult(state.latestResult, state.comparisons);
    state.energyWasLastEdited = true;
    syncVelocityFromEnergy();
    recalculateFlatSpin();
    scheduleSimulation();
  });

  window.addEventListener('resize', () => {
    cancelAnimationFrame(state.resizeFrame);
    state.resizeFrame = requestAnimationFrame(drawChart);
  });
  window.addEventListener('pagehide', () => {
    state.droneApi?.destroy();
    state.droneApi = null;
  });

  try {
    state.worker = new Worker('./trajectory.worker.js?v=20260723-47', { type: 'module' });
    state.worker.addEventListener('message', (event) => receiveResult(event.data));
    state.worker.addEventListener('error', (event) => {
      event.currentTarget?.terminate?.();
      state.worker = null;
      resultStatus.textContent = 'Worker indisponible · repli local en cours…';
      runLocalSimulation(state.requestId, readShot());
    });
  } catch {
    state.worker = null;
  }

  const defaults = applyDefaults();
  recalculateFlatSpin({
    preserveCurrent: defaults.preserveCurrentSpin,
    offsetRpm: defaults.preserveCurrentSpin ? 0 : defaults.savedSpinOffsetRpm,
  });
  runSimulation();
}
