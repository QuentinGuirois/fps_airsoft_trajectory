import * as THREE from './assets/vendor/three-r185/build/three.module.min.js?v=20260723-47';
import { OrbitControls } from './assets/vendor/three-r185/examples/jsm/controls/OrbitControls.js?v=20260723-47';

const PLAYBACK_MS = 2200;

export function scenePointSignature(points = []) {
  return points.map((point) => `${point.x}|${point.y}|${point.z}`).join(';');
}

export function sceneMarkers(points = []) {
  if (!points.length) return {};
  return {
    start: points[0],
    apex: points.reduce((highest, point) => point.y > highest.y ? point : highest, points[0]),
    impact: points.at(-1),
  };
}

export function sceneSeries(result, comparisons = []) {
  const source = [
    { id: 'active', label: 'Tir actif', result, colorRole: 'active', active: true },
    ...comparisons.slice(0, 3).map((comparison, index) => ({
      id: `comparison-${index + 1}`,
      label: comparison.label || `Comparaison ${index + 1}`,
      result: comparison.result,
      colorRole: `curve${index + 2}`,
      active: false,
    })),
  ];
  return source.filter((series) => series.result?.simulation?.points?.length);
}

function disposeTree(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
}

function asVector(point, ground = false) {
  return new THREE.Vector3(point.x, ground ? 0.012 : point.y, point.z);
}

export function createDroneView({
  host,
  result,
  comparisons = [],
  colors,
  profileVerticalExaggeration = 1,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
} = {}) {
  if (!host || !result?.simulation?.points?.length) throw new Error('Résultat ATP indisponible pour la vue 3D.');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'drone-canvas';
  renderer.domElement.setAttribute('aria-label', 'Vue 3D de la trajectoire, de la hauteur et de la dérive latérale');
  renderer.domElement.setAttribute('role', 'img');
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 2000);
  camera.up.set(0, 1, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.5;
  controls.maxDistance = 500;
  controls.addEventListener('change', render);

  const labelLayer = document.createElement('div');
  labelLayer.className = 'drone-label-layer';
  labelLayer.setAttribute('aria-hidden', 'true');
  host.append(labelLayer);

  const markerLabels = Object.fromEntries(['start', 'apex', 'impact'].map((name) => {
    const label = document.createElement('span');
    label.className = `drone-marker-label drone-marker-${name}`;
    labelLayer.append(label);
    return [name, label];
  }));

  let activeResult = result;
  let activePoints = result.simulation.points;
  let activeComparisons = comparisons.slice(0, 3);
  let markers = sceneMarkers(activePoints);
  let dataGroup = null;
  let ball = null;
  let currentCamera = 'drone';
  let destroyed = false;
  let visible = true;
  let manuallyPaused = false;
  let environmentPaused = false;
  let pausedAt = null;
  let playback = null;
  let playbackFrame = null;
  let cameraFrame = null;
  let cameraTween = null;
  let activeColors = { ...colors };
  profileVerticalExaggeration = Math.max(1, Number(profileVerticalExaggeration) || 1);
  host.dataset.reducedMotion = String(reducedMotion);
  host.dataset.playback = 'idle';
  host.dataset.rendering = 'active';

  function applyColor(material, value) {
    if (material?.color && value) material.color.set(value);
  }

  function setTheme(nextColors) {
    activeColors = { ...activeColors, ...nextColors };
    host.dataset.themeSignature = [activeColors.background, activeColors.ground, activeColors.grid, activeColors.active, activeColors.curve2, activeColors.curve3, activeColors.curve4, activeColors.projection, activeColors.impact].join('|');
    renderer.setClearColor(activeColors.background || '#10140c', 1);
    if (!dataGroup) return render();
    dataGroup.traverse((object) => {
      const role = object.userData?.colorRole;
      if (!role) return;
      applyColor(object.material, activeColors[role]);
      if (role === 'ground') object.material.opacity = activeColors.groundOpacity ?? 0.38;
    });
    render();
  }

  function markerText(name, point) {
    if (name === 'start') return `DÉPART · ${point.y.toFixed(2)} m`;
    if (name === 'apex') return `APEX · ${point.y.toFixed(2)} m · ${point.x.toFixed(0)} m`;
    return `IMPACT · ${point.x.toFixed(1)} m · dérive ${(point.z * 100).toFixed(0)} cm`;
  }

  function buildData(nextResult, nextComparisons = activeComparisons) {
    if (dataGroup) {
      scene.remove(dataGroup);
      disposeTree(dataGroup);
    }
    activeResult = nextResult;
    activePoints = nextResult.simulation.points;
    activeComparisons = nextComparisons.slice(0, 3);
    markers = sceneMarkers(activePoints);
    host.dataset.pointCount = String(activePoints.length);
    host.dataset.pointSignature = scenePointSignature(activePoints);
    host.dataset.sourceRequestId = String(nextResult.requestId ?? 'local');
    const series = sceneSeries(nextResult, activeComparisons);
    host.dataset.seriesCount = String(series.length);
    host.dataset.seriesSignatures = series.map((item) => scenePointSignature(item.result.simulation.points)).join('||');

    dataGroup = new THREE.Group();
    scene.add(dataGroup);
    const vectors = activePoints.map((point) => asVector(point));
    const range = Math.max(1, markers.impact.x - markers.start.x);
    const allPoints = series.flatMap((item) => item.result.simulation.points);
    const maximumRange = Math.max(range, ...allPoints.map((point) => point.x));
    const lateralExtent = Math.max(2, ...allPoints.map((point) => Math.abs(point.z))) * 2;
    const gridSize = Math.max(maximumRange * 1.18, lateralExtent * 2, 20);

    const groundMaterial = new THREE.MeshBasicMaterial({
      color: activeColors.ground || '#171c11',
      transparent: true,
      opacity: activeColors.groundOpacity ?? 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(gridSize, gridSize), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(maximumRange / 2, -0.025, 0);
    ground.userData.colorRole = 'ground';
    dataGroup.add(ground);

    const grid = new THREE.GridHelper(gridSize, Math.max(10, Math.round(gridSize / 5)), activeColors.grid, activeColors.grid);
    grid.position.set(maximumRange / 2, 0, 0);
    grid.material.transparent = true;
    grid.material.opacity = 0.58;
    grid.userData.colorRole = 'grid';
    dataGroup.add(grid);

    for (const item of series) {
      const points = item.result.simulation.points;
      const itemVectors = points.map((point) => asVector(point));
      const itemRange = Math.max(1, points.at(-1).x - points[0].x);
      const trajectoryCurve = new THREE.CatmullRomCurve3(itemVectors, false, 'centripetal');
      const radius = Math.max(item.active ? 0.025 : 0.015, itemRange / (item.active ? 1800 : 2800));
      const ribbon = new THREE.Mesh(
        new THREE.TubeGeometry(trajectoryCurve, Math.max(48, points.length - 1), radius, item.active ? 5 : 4, false),
        new THREE.MeshBasicMaterial({ color: activeColors[item.colorRole], transparent: !item.active, opacity: item.active ? 1 : .84 }),
      );
      ribbon.name = `trajectory-${item.id}`;
      ribbon.userData.colorRole = item.colorRole;
      ribbon.userData.seriesId = item.id;
      dataGroup.add(ribbon);

      const projectionRole = item.active ? 'projection' : item.colorRole;
      const groundProjection = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points.map((point) => asVector(point, true))),
        new THREE.LineDashedMaterial({
          color: activeColors[projectionRole],
          dashSize: Math.max(.25, itemRange / 120),
          gapSize: Math.max(.18, itemRange / 170),
          transparent: true,
          opacity: item.active ? .72 : .36,
        }),
      );
      groundProjection.name = `projection-${item.id}`;
      groundProjection.computeLineDistances();
      groundProjection.userData.colorRole = projectionRole;
      groundProjection.userData.seriesId = item.id;
      dataGroup.add(groundProjection);
    }

    const directionStart = vectors[0];
    const directionSample = vectors[Math.min(3, vectors.length - 1)];
    const direction = directionSample.clone().sub(directionStart);
    const factor = Math.abs(direction.x) > 1e-8 ? range / direction.x : 1;
    const fireEnd = directionStart.clone().add(direction.multiplyScalar(factor));
    const fireLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([directionStart, fireEnd]),
      new THREE.LineDashedMaterial({ color: activeColors.fireline, dashSize: .55, gapSize: .38, transparent: true, opacity: .75 }),
    );
    fireLine.computeLineDistances();
    fireLine.userData.colorRole = 'fireline';
    dataGroup.add(fireLine);

    ball = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(.07, range / 620), 16, 12),
      new THREE.MeshBasicMaterial({ color: activeColors.ball }),
    );
    ball.userData.colorRole = 'ball';
    dataGroup.add(ball);

    const markerRoles = { start: 'ball', apex: 'active', impact: 'impact' };
    for (const [name, point] of Object.entries(markers)) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(.055, range / 760), 12, 10),
        new THREE.MeshBasicMaterial({ color: activeColors[markerRoles[name]] }),
      );
      marker.position.copy(asVector(point));
      marker.userData.colorRole = markerRoles[name];
      dataGroup.add(marker);
      markerLabels[name].textContent = markerText(name, point);
      markerLabels[name].hidden = false;
    }
    ball.position.copy(asVector(reducedMotion ? markers.apex : markers.start));
    setCamera(currentCamera, { immediate: true });
    render();
    if (!reducedMotion) replay();
  }

  function cameraPreset(name) {
    const range = Math.max(1, markers.impact.x - markers.start.x);
    const maxY = Math.max(1, markers.apex.y);
    const center = new THREE.Vector3(markers.start.x + range * .5, maxY * .48, (markers.start.z + markers.impact.z) / 2);
    if (name === 'shooter') {
      return {
        position: new THREE.Vector3(
          markers.start.x - range * .08,
          markers.start.y + Math.max(.7, range * .02),
          markers.start.z + Math.max(.8, range * .04),
        ),
        target: asVector(activePoints[Math.min(activePoints.length - 1, Math.floor(activePoints.length * .35))]),
      };
    }
    if (name === 'profile') {
      const fovRadians = camera.fov * Math.PI / 180;
      const distance = Math.max(
        range / (2 * Math.tan(fovRadians / 2) * Math.max(camera.aspect, .4)),
        maxY * profileVerticalExaggeration / (2 * Math.tan(fovRadians / 2)),
      ) * 1.12;
      return { position: new THREE.Vector3(center.x, center.y, center.z + distance), target: center };
    }
    return {
      position: new THREE.Vector3(center.x - range * .12, Math.max(7, range * .28), center.z + Math.max(10, range * .48)),
      target: center,
    };
  }

  function setCamera(name = 'drone', { immediate = reducedMotion } = {}) {
    if (!['drone', 'shooter', 'profile'].includes(name)) name = 'drone';
    currentCamera = name;
    host.dataset.camera = name;
    host.dataset.cameraTransition = immediate ? 'instant' : 'animated';
    camera.updateProjectionMatrix();
    if (name === 'profile') camera.projectionMatrix.elements[5] *= profileVerticalExaggeration;
    host.dataset.profileVerticalExaggeration = name === 'profile' ? String(profileVerticalExaggeration) : '1';
    const preset = cameraPreset(name);
    cancelAnimationFrame(cameraFrame);
    cameraTween = null;
    if (immediate || !visible) {
      camera.position.copy(preset.position);
      controls.target.copy(preset.target);
      controls.update();
      render();
      return;
    }
    const fromPosition = camera.position.clone();
    const fromTarget = controls.target.clone();
    const startedAt = performance.now();
    const tick = (time) => {
      if (destroyed || !visible) return;
      const progress = Math.min(1, (time - startedAt) / 320);
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(fromPosition, preset.position, eased);
      controls.target.lerpVectors(fromTarget, preset.target, eased);
      controls.update();
      render();
      if (progress < 1) cameraFrame = requestAnimationFrame(tick);
      else cameraTween = null;
    };
    cameraTween = { startedAt };
    cameraFrame = requestAnimationFrame(tick);
  }

  function setBallAt(progress) {
    if (!ball || !activePoints.length) return;
    const scaled = Math.max(0, Math.min(1, progress)) * (activePoints.length - 1);
    const beforeIndex = Math.floor(scaled);
    const afterIndex = Math.min(activePoints.length - 1, beforeIndex + 1);
    const ratio = scaled - beforeIndex;
    ball.position.lerpVectors(asVector(activePoints[beforeIndex]), asVector(activePoints[afterIndex]), ratio);
  }

  function replay(restart = true) {
    cancelAnimationFrame(playbackFrame);
    if (reducedMotion) {
      setBallAt(1);
      host.dataset.playback = 'instant';
      render();
      return;
    }
    host.dataset.playback = 'playing';
    if (restart || !playback) playback = { startedAt: performance.now() };
    const tick = (time) => {
      if (destroyed || !visible || document.hidden) return;
      const progress = Math.min(1, (time - playback.startedAt) / PLAYBACK_MS);
      setBallAt(progress);
      render();
      if (progress < 1) playbackFrame = requestAnimationFrame(tick);
      else {
        playback = null;
        host.dataset.playback = 'idle';
      }
    };
    playbackFrame = requestAnimationFrame(tick);
  }

  function zoom(factor = 1) {
    if (destroyed) return;
    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = Math.max(controls.minDistance, offset.length());
    const targetDistance = THREE.MathUtils.clamp(currentDistance * factor, controls.minDistance, controls.maxDistance);
    if (currentDistance > 0) offset.multiplyScalar(targetDistance / currentDistance);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    render();
  }

  function updateLabels() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    for (const [name, point] of Object.entries(markers)) {
      const projected = asVector(point).project(camera);
      const visibleLabel = projected.z > -1 && projected.z < 1;
      markerLabels[name].hidden = !visibleLabel;
      if (!visibleLabel) continue;
      const anchorX = name === 'start' ? '0%' : name === 'impact' ? '-100%' : '-50%';
      markerLabels[name].style.transform = `translate(${anchorX}, -100%) translate(${(projected.x * .5 + .5) * width}px, ${(-projected.y * .5 + .5) * height}px)`;
    }
  }

  function render() {
    if (destroyed || !visible || !host.isConnected) return;
    renderer.render(scene, camera);
    host.dataset.renderCount = String((Number(host.dataset.renderCount) || 0) + 1);
    updateLabels();
  }

  function resize() {
    if (destroyed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    setCamera(currentCamera, { immediate: true });
  }

  function applyPauseState() {
    const shouldBeVisible = !manuallyPaused && !environmentPaused;
    if (visible === shouldBeVisible || destroyed) return;
    if (shouldBeVisible) {
      visible = true;
      host.dataset.rendering = 'active';
      if (playback && pausedAt) playback.startedAt += performance.now() - pausedAt;
      pausedAt = null;
      resize();
      if (playback) replay(false);
      else render();
      return;
    }
    visible = false;
    host.dataset.rendering = 'paused';
    pausedAt = performance.now();
    cancelAnimationFrame(playbackFrame);
    cancelAnimationFrame(cameraFrame);
  }

  function pause() {
    manuallyPaused = true;
    applyPauseState();
  }

  function resume() {
    manuallyPaused = false;
    applyPauseState();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    environmentPaused = !entry.isIntersecting || document.hidden;
    applyPauseState();
  }, { threshold: .01 });
  intersectionObserver.observe(host);
  const onVisibilityChange = () => {
    environmentPaused = document.hidden;
    applyPauseState();
  };
  const onDoubleClick = () => setCamera(currentCamera);
  const onContextLost = (event) => {
    event.preventDefault();
    host.dispatchEvent(new CustomEvent('fat:droneerror', { bubbles: true }));
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  renderer.domElement.addEventListener('dblclick', onDoubleClick);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(playbackFrame);
    cancelAnimationFrame(cameraFrame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    renderer.domElement.removeEventListener('dblclick', onDoubleClick);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    controls.removeEventListener('change', render);
    controls.dispose();
    if (dataGroup) disposeTree(dataGroup);
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement.remove();
    labelLayer.remove();
    host.removeAttribute('data-point-count');
    host.removeAttribute('data-point-signature');
    host.removeAttribute('data-source-request-id');
    host.removeAttribute('data-series-count');
    host.removeAttribute('data-series-signatures');
    host.removeAttribute('data-reduced-motion');
    host.removeAttribute('data-playback');
    host.removeAttribute('data-camera');
    host.removeAttribute('data-camera-transition');
    host.removeAttribute('data-profile-vertical-exaggeration');
    host.removeAttribute('data-theme-signature');
    host.removeAttribute('data-render-count');
    host.removeAttribute('data-rendering');
  }

  setTheme(activeColors);
  resize();
  buildData(result, comparisons);

  return {
    destroy,
    pause,
    replay,
    resize,
    resume,
    setCamera,
    setTheme,
    updateResult: buildData,
    zoom,
    getState: () => ({
      camera: currentCamera,
      pointCount: activePoints.length,
      pointSignature: scenePointSignature(activePoints),
      requestId: activeResult.requestId,
      seriesCount: sceneSeries(activeResult, activeComparisons).length,
      reducedMotion,
      visible,
    }),
  };
}
