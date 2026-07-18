const SVG_WIDTH = 360;
const SVG_HEIGHT = 150;
const PADDING = Object.freeze({ left: 8, right: 18, top: 14, bottom: 18 });

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fixed = (value) => Number(value.toFixed(2));

function samplePoints(points, maximum = 120) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

/**
 * Sérialise une miniature depuis le résultat ATP déjà renvoyé par le Worker.
 * Cette fonction n’importe et ne relance jamais le moteur physique.
 */
export function serializeCurveThumbnail(result) {
  const points = result?.simulation?.points?.filter((point) => (
    Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
  )) || [];
  if (points.length < 2) return '';
  const metrics = result.metrics || {};
  const maxX = Math.max(1, finite(metrics.maximumRangeM, points.at(-1).x));
  const maxY = Math.max(0.2, ...points.map((point) => finite(point.y)));
  const innerWidth = SVG_WIDTH - PADDING.left - PADDING.right;
  const innerHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;
  const mapX = (x) => PADDING.left + finite(x) / maxX * innerWidth;
  const mapY = (y) => PADDING.top + (1 - Math.max(0, finite(y)) / maxY) * innerHeight;
  const path = samplePoints(points).map((point, index) => (
    `${index ? 'L' : 'M'}${fixed(mapX(point.x))} ${fixed(mapY(point.y))}`
  )).join(' ');
  const usefulX = mapX(Math.min(maxX, Math.max(0, finite(metrics.usefulRangeM))));
  const usefulPoint = points.reduce((nearest, point) => (
    Math.abs(point.x - finite(metrics.usefulRangeM)) < Math.abs(nearest.x - finite(metrics.usefulRangeM)) ? point : nearest
  ), points[0]);
  const usefulY = mapY(usefulPoint.y);
  const impactX = mapX(points.at(-1).x);
  const impactY = mapY(points.at(-1).y);
  const sightY = mapY(finite(metrics?.sight?.originY, points[0].y));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-label="Miniature de la trajectoire enregistrée"><rect class="curve-thumb-envelope" x="${PADDING.left}" y="${fixed(sightY - 10)}" width="${fixed(innerWidth)}" height="20"/><line class="curve-thumb-sight" x1="${PADDING.left}" y1="${fixed(sightY)}" x2="${SVG_WIDTH - PADDING.right}" y2="${fixed(sightY)}"/><line class="curve-thumb-ground" x1="${PADDING.left}" y1="${SVG_HEIGHT - PADDING.bottom}" x2="${SVG_WIDTH - PADDING.right}" y2="${SVG_HEIGHT - PADDING.bottom}"/><path class="curve-thumb-path" d="${path}"/><circle class="curve-thumb-useful" cx="${fixed(usefulX)}" cy="${fixed(usefulY)}" r="4"/><circle class="curve-thumb-impact" cx="${fixed(impactX)}" cy="${fixed(impactY)}" r="4"/><text class="curve-thumb-useful-label" x="${fixed(Math.max(8, usefulX - 18))}" y="${fixed(Math.max(12, usefulY - 9))}">${Math.round(finite(metrics.usefulRangeM))} m</text><text class="curve-thumb-impact-label" x="${fixed(Math.max(8, impactX - 32))}" y="${fixed(Math.max(12, impactY - 9))}">${Math.round(maxX)} m</text></svg>`;
}
