import { analyzeTrajectory, holdoverTable, simulateTrajectory } from './physics-core.js?v=20260718-28';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'simulate') return;
  try {
    const simulation = simulateTrajectory(event.data.shot);
    self.postMessage({
      ok: true,
      requestId: event.data.requestId,
      simulation,
      metrics: analyzeTrajectory(simulation),
      holdover: holdoverTable(simulation),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
