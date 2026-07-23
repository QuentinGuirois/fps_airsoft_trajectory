import { ATP, sightModel } from './physics-core.js?v=20260723-47';

export const ATP_TOLERANCE_M = ATP.usefulEnvelopeM;
export const TARGET_VERTICAL_EXAGGERATION = 10;

const MODES = Object.freeze({
  trajectory: Object.freeze({
    unit: 'm',
    axisLabel: 'Hauteur au-dessus du sol',
    referenceLabel: 'Marge utile : une hauteur de buste de 60 cm (±60 cm autour de la visée), ligne de visée pointillée et sol.',
    floorAtZero: true,
    showZeroLine: false,
    value: (point) => point.y,
  }),
  sight: Object.freeze({
    unit: 'cm',
    axisLabel: 'Écart à la visée',
    referenceLabel: 'La ligne pointillée représente la visée ; une valeur négative est sous la visée.',
    floorAtZero: false,
    showZeroLine: true,
    value: (point, context) => (point.y - context.sight.yAt(point.x)) * 100,
  }),
  energy: Object.freeze({
    unit: 'J',
    axisLabel: 'Énergie résiduelle',
    referenceLabel: '',
    floorAtZero: true,
    showZeroLine: false,
    value: (point) => point.energyJ,
  }),
  drift: Object.freeze({
    unit: 'cm',
    axisLabel: 'Dérive latérale',
    referenceLabel: 'La ligne pointillée représente une dérive nulle.',
    floorAtZero: false,
    showZeroLine: true,
    value: (point) => point.z * 100,
  }),
  spin: Object.freeze({
    unit: 'tr/min',
    axisLabel: 'Rotation',
    referenceLabel: '',
    floorAtZero: true,
    showZeroLine: false,
    value: (point) => point.rpm,
  }),
});

export function chartMode(mode) {
  return MODES[mode] || MODES.trajectory;
}

export function buildChartValues(simulation, mode = 'trajectory') {
  const selected = chartMode(mode);
  const context = mode === 'sight' ? { sight: sightModel(simulation) } : {};
  return {
    ...selected,
    values: simulation.points.map((point) => ({
      x: point.x,
      y: selected.value(point, context),
    })),
  };
}

function pointAtX(points, distanceM) {
  if (!Number.isFinite(distanceM) || !points.length) return null;
  if (distanceM <= points[0].x) return { ...points[0], x: distanceM };
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (after.x < distanceM) continue;
    const span = after.x - before.x;
    const ratio = span > 0 ? (distanceM - before.x) / span : 0;
    return {
      x: distanceM,
      y: before.y + (after.y - before.y) * ratio,
    };
  }
  return null;
}

export function buildTrajectoryGuides(simulation) {
  const sight = sightModel(simulation);
  const sightline = simulation.points.map((point) => ({ x: point.x, y: sight.yAt(point.x) }));
  return {
    sightline,
    upper: sightline.map((point) => ({ x: point.x, y: point.y + ATP_TOLERANCE_M })),
    lower: sightline.map((point) => ({ x: point.x, y: point.y - ATP_TOLERANCE_M })),
  };
}

export function buildTrajectoryMarkers(simulation, metrics = {}) {
  const points = simulation.points;
  if (!points.length) return {};
  const apex = points.reduce((highest, point) => point.y > highest.y ? point : highest, points[0]);
  const impact = points.at(-1);
  const useful = pointAtX(points, metrics.usefulRangeM);
  return {
    apex: { x: apex.x, y: apex.y, label: 'Apex' },
    impact: { x: impact.x, y: impact.y, label: 'Impact' },
    ...(useful ? { useful: { ...useful, label: 'Portée utile' } } : {}),
  };
}

export function prepareChartSeries(current, comparisons = [], mode = 'trajectory') {
  const entries = [current, ...comparisons].filter((entry) => entry?.simulation);
  const series = entries.map((entry, index) => ({
    ...buildChartValues(entry.simulation, mode),
    label: entry.label || `Tir ${index + 1}`,
    role: index === 0 ? 'active' : 'comparison',
    colorIndex: index,
    lineWidth: index === 0 ? 3.5 : 2,
    lineDash: index === 0 ? [] : [10, 5],
  }));
  const trajectory = mode === 'trajectory' && current?.simulation
    ? {
        guides: buildTrajectoryGuides(current.simulation),
        markers: buildTrajectoryMarkers(current.simulation, current.metrics),
      }
    : null;
  return { mode, series, trajectory };
}

export function chartYDomain(series, extraValues = []) {
  const values = [
    ...series.flatMap((item) => item.values),
    ...extraValues,
  ]
    .map((point) => typeof point === 'number' ? point : point.y)
    .filter(Number.isFinite);
  const floorAtZero = series[0]?.floorAtZero ?? false;

  if (!values.length) return { minY: 0, maxY: 1 };

  if (floorAtZero) {
    const rawMax = Math.max(0, ...values);
    const maxY = rawMax > 0 ? rawMax * 1.08 : 1;
    return { minY: 0, maxY };
  }

  let minY = Math.min(0, ...values);
  let maxY = Math.max(0, ...values);
  if (Math.abs(maxY - minY) < 0.01) {
    minY -= 1;
    maxY += 1;
  }
  const padding = (maxY - minY) * 0.1;
  return { minY: minY - padding, maxY: maxY + padding };
}

export function fitChartDomain({
  series,
  trajectory = null,
  maxX,
  plotWidth,
  plotHeight,
  targetExaggeration = TARGET_VERTICAL_EXAGGERATION,
}) {
  const guideValues = trajectory
    ? [...trajectory.guides.upper, ...trajectory.guides.lower]
    : [];
  let { minY, maxY } = chartYDomain(series, guideValues);
  if (!trajectory || !(plotWidth > 0) || !(plotHeight > 0) || !(maxX > 0)) {
    return { minY, maxY, verticalExaggeration: null };
  }

  const horizontalPixelsPerMetre = plotWidth / maxX;
  const visibleSpan = Math.max(maxY - minY, Number.EPSILON);
  let verticalExaggeration = (plotHeight / visibleSpan) / horizontalPixelsPerMetre;
  if (verticalExaggeration > targetExaggeration) {
    const requiredSpan = plotHeight / (horizontalPixelsPerMetre * targetExaggeration);
    maxY = minY + requiredSpan;
    verticalExaggeration = targetExaggeration;
  }
  return { minY, maxY, verticalExaggeration };
}
