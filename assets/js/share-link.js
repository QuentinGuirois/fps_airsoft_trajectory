function writeFeedback(element, message) {
  if (element) element.textContent = message;
}

function revealLink({ output, input, url, select = false }) {
  if (input) input.value = url;
  if (output) output.hidden = false;
  if (!select || !input) return;
  input.focus?.();
  input.select?.();
}

export function isCoarseTouchDevice({
  navigatorRef = globalThis.navigator,
  matchMediaRef = globalThis.matchMedia?.bind(globalThis),
} = {}) {
  if (Number(navigatorRef?.maxTouchPoints || 0) < 1 || typeof matchMediaRef !== 'function') return false;
  try {
    return Boolean(matchMediaRef('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

export function configureShareButton(button, options = {}) {
  if (!button) return;
  const {
    desktopLabel = 'Copier le lien',
    mobileLabel = 'Partager',
    ...environment
  } = options;
  button.textContent = isCoarseTouchDevice(environment) ? mobileLabel : desktopLabel;
}

async function copyLink(url, { navigatorRef, documentRef, input }) {
  try {
    if (typeof navigatorRef?.clipboard?.writeText === 'function') {
      await navigatorRef.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Le champ accessible reste le repli lorsque Clipboard est refusé.
  }

  revealLink({ input, url, select: true });
  try {
    return Boolean(documentRef?.execCommand?.('copy'));
  } catch {
    return false;
  }
}

export async function shareLink({
  url,
  title = '',
  text = '',
  output = null,
  input = null,
  feedback = null,
  allowNative = true,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  matchMediaRef = globalThis.matchMedia?.bind(globalThis),
  messages = {},
} = {}) {
  if (typeof url !== 'string' || url.length === 0) throw new TypeError('Une URL de partage est requise.');

  const labels = {
    copied: 'Lien copié.',
    manual: 'Copie automatique indisponible : sélectionne le lien puis utilise Ctrl+C.',
    shared: 'Lien partagé.',
    cancelled: 'Partage annulé. Le lien reste disponible ci-dessous.',
    ...messages,
  };
  revealLink({ output, input, url });

  const shareData = { title, text, url };
  const canUseNativeShare = allowNative
    && isCoarseTouchDevice({ navigatorRef, matchMediaRef })
    && typeof navigatorRef?.share === 'function'
    && (typeof navigatorRef.canShare !== 'function' || navigatorRef.canShare(shareData));

  if (canUseNativeShare) {
    try {
      await navigatorRef.share(shareData);
      writeFeedback(feedback, labels.shared);
      return { method: 'native', url };
    } catch (error) {
      if (error?.name === 'AbortError') {
        writeFeedback(feedback, labels.cancelled);
        return { method: 'cancelled', url };
      }
      // Un échec du partage natif retombe sur la copie du même lien.
    }
  }

  const copied = await copyLink(url, { navigatorRef, documentRef, input });
  if (!copied) revealLink({ output, input, url, select: true });
  writeFeedback(feedback, copied ? labels.copied : labels.manual);
  return { method: copied ? 'clipboard' : 'manual', url };
}
