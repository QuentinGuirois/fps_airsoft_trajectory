export function advancedDeviceAdvice({
  width = globalThis.innerWidth || 0,
  height = globalThis.innerHeight || 0,
  coarsePointer = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
  hoverNone = globalThis.matchMedia?.('(hover: none)').matches ?? false,
} = {}) {
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const phoneLike = coarsePointer && hoverNone && shortestSide <= 620 && longestSide <= 1100;
  return {
    phoneLike,
    portrait: phoneLike && height > width,
    constrained: width < 360 || height < 480,
  };
}
