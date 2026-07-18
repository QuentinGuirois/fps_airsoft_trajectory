export function detectWebGL({ documentRef = globalThis.document } = {}) {
  if (!documentRef?.createElement) return false;
  let canvas;
  let context;
  try {
    canvas = documentRef.createElement('canvas');
    context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return true;
  } catch {
    return false;
  } finally {
    canvas?.remove?.();
  }
}
