import { validateSimulationUrl } from '../../replica-utils.js?v=20260718-28';
import { serializeCurveThumbnail } from './curve-thumbnail.js?v=20260718-28';

const QUERY_ALIASES = Object.freeze({
  massG: 'm',
  energyJ: 'j',
  initialRpm: 'rpm',
  zeroDistanceM: 'z',
  windSpeedKmh: 'w',
  windAngleDeg: 'wd',
  temperatureC: 't',
  pressureHpa: 'p',
  angleDeg: 'a',
  cantDeg: 'c',
  shootingHeightM: 'sh',
  scopeHeightM: 'oh',
  latitudeDeg: 'lat',
  diameterMm: 'd',
});

export class SimulationLinkError extends Error {
  constructor(message, code = 'simulation_link') {
    super(message);
    this.name = 'SimulationLinkError';
    this.code = code;
  }
}

export function simulationShotFromUrl(value, origin = globalThis.location?.origin || 'https://fps-airsoft-trajectory.com') {
  const validation = validateSimulationUrl(String(value || ''), origin);
  if (!validation.ok) throw new SimulationLinkError(validation.message, 'simulation_url');
  const url = new URL(validation.url);
  const shot = {};
  for (const [name, alias] of Object.entries(QUERY_ALIASES)) {
    const values = url.searchParams.getAll(alias);
    if (!values.length) continue;
    if (values.length !== 1 || values[0].trim() === '' || !Number.isFinite(Number(values[0]))) {
      throw new SimulationLinkError(`Le paramètre « ${alias} » du lien est invalide.`, 'simulation_parameter');
    }
    shot[name] = Number(values[0]);
  }
  if (!url.searchParams.has('rpm') && url.searchParams.has('h')) {
    const legacyHop = Number(url.searchParams.get('h'));
    if (!Number.isFinite(legacyHop)) throw new SimulationLinkError('Le réglage hop-up du lien est invalide.', 'simulation_parameter');
    shot.hopPercent = legacyHop;
  }
  url.hash = '';
  return { url: url.href, shot };
}

export function simulationUrlsMatch(first, second, origin = globalThis.location?.origin || 'https://fps-airsoft-trajectory.com') {
  try {
    const normalize = (value) => {
      const url = new URL(value, origin);
      url.hash = '';
      url.searchParams.sort();
      return url.href;
    };
    return normalize(first) === normalize(second);
  } catch {
    return false;
  }
}

export async function createSimulationSnapshot(value, {
  origin = globalThis.location?.origin || 'https://fps-airsoft-trajectory.com',
  workerFactory = () => new Worker('/trajectory.worker.js?v=20260718-28', { type: 'module' }),
  signal,
  timeoutMs = 15_000,
} = {}) {
  const parsed = simulationShotFromUrl(value, origin);
  if (signal?.aborted) throw new DOMException('Opération annulée.', 'AbortError');
  const worker = workerFactory();
  const requestId = 1;
  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      const finish = (callback, payload) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        callback(payload);
      };
      const onAbort = () => finish(reject, new DOMException('Opération annulée.', 'AbortError'));
      worker.addEventListener('message', (event) => {
        if (event.data?.requestId !== requestId) return;
        if (!event.data.ok) {
          finish(reject, new SimulationLinkError(event.data.error || 'Le calcul ATP lié à cette URL a échoué.', 'simulation_failed'));
          return;
        }
        finish(resolve, event.data);
      }, { once: true });
      worker.addEventListener('error', () => finish(reject, new SimulationLinkError('Le moteur ATP est indisponible.', 'worker_error')), { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => finish(reject, new SimulationLinkError('Le calcul ATP prend trop de temps. Réessaie.', 'worker_timeout')), timeoutMs);
      worker.postMessage({ type: 'simulate', requestId, shot: parsed.shot });
    });
    const curveThumbnailSvg = serializeCurveThumbnail(result);
    if (!curveThumbnailSvg) throw new SimulationLinkError('La trajectoire du lien ne permet pas de créer la miniature.', 'curve_thumbnail');
    return {
      simulationUrl: parsed.url,
      curveThumbnailSvg,
      usefulRangeM: result.metrics?.usefulRangeM ?? null,
      maximumRangeM: result.metrics?.maximumRangeM ?? null,
      massG: result.simulation?.config?.massG ?? null,
      energyJ: result.simulation?.config?.energyJ ?? null,
      generatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
    worker.terminate();
  }
}
