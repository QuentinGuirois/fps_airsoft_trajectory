export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_ACTIONS = Object.freeze(['login', 'register', 'forgot_password']);

export class TurnstileClientError extends Error {
  constructor(message, code = 'turnstile_client') {
    super(message);
    this.name = 'TurnstileClientError';
    this.code = code;
  }
}

export function loadTurnstileScript({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  timeoutMs = 10_000,
} = {}) {
  if (typeof windowRef?.turnstile?.render === 'function') return Promise.resolve(windowRef.turnstile);
  if (!documentRef?.head) return Promise.reject(new TurnstileClientError('Le contrôle anti-robot ne peut pas être chargé.', 'turnstile_document'));

  const existing = documentRef.querySelector?.('script[data-fat-turnstile]');
  if (existing?.__fatTurnstilePromise) return existing.__fatTurnstilePromise;
  const script = existing || documentRef.createElement('script');
  script.setAttribute('src', TURNSTILE_SCRIPT_URL);
  script.setAttribute('async', '');
  script.setAttribute('defer', '');
  script.setAttribute('data-cfasync', 'false');
  script.setAttribute('data-fat-turnstile', '');

  const promise = new Promise((resolve, reject) => {
    const timer = windowRef.setTimeout(() => reject(new TurnstileClientError('Le contrôle anti-robot met trop de temps à répondre.', 'turnstile_timeout')), timeoutMs);
    const cleanup = () => windowRef.clearTimeout(timer);
    script.addEventListener('load', () => {
      cleanup();
      if (typeof windowRef.turnstile?.render === 'function') resolve(windowRef.turnstile);
      else reject(new TurnstileClientError('Le contrôle anti-robot est indisponible.', 'turnstile_api'));
    }, { once: true });
    script.addEventListener('error', () => {
      cleanup();
      script.remove();
      reject(new TurnstileClientError('Le contrôle anti-robot n’a pas pu être chargé.', 'turnstile_network'));
    }, { once: true });
  });
  script.__fatTurnstilePromise = promise;
  if (!existing) documentRef.head.append(script);
  return promise;
}

export function createTurnstileController({
  root,
  accountRepository,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  scriptLoader = loadTurnstileScript,
} = {}) {
  if (!root || !accountRepository) return null;
  const widgetIds = new Map();
  const tokens = new Map();
  let api = null;
  let configPromise = null;

  function messageElement(action) {
    return root.querySelector(`[data-turnstile-message="${action}"]`);
  }

  function announce(action, message, tone = '') {
    const element = messageElement(action);
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
  }

  function resetAfterCallback(action) {
    windowRef.setTimeout(() => reset(action), 0);
  }

  async function initialize() {
    configPromise ||= accountRepository.getTurnstileConfig()
      .then(async (payload) => {
        const config = payload?.turnstile;
        if (!config?.enabled || typeof config.siteKey !== 'string' || config.siteKey === '') {
          throw new TurnstileClientError('La vérification anti-robot est temporairement indisponible.', 'turnstile_disabled');
        }
        api = await scriptLoader({ windowRef, documentRef });
        root.dataset.turnstile = 'ready';
        return config;
      })
      .catch((error) => {
        root.dataset.turnstile = 'error';
        throw error instanceof TurnstileClientError
          ? error
          : new TurnstileClientError('La vérification anti-robot est temporairement indisponible.', 'turnstile_config');
      });
    return configPromise;
  }

  async function activate(action) {
    if (!TURNSTILE_ACTIONS.includes(action)) throw new TurnstileClientError('Action anti-robot inconnue.', 'turnstile_action');
    const container = root.querySelector(`[data-turnstile-action="${action}"]`);
    if (!container) throw new TurnstileClientError('Zone anti-robot absente.', 'turnstile_container');
    const config = await initialize();
    if (widgetIds.has(action)) return widgetIds.get(action);
    announce(action, 'Vérification anti-robot en cours…');
    const widgetId = api.render(container, {
      sitekey: config.siteKey,
      action,
      theme: documentRef.documentElement?.dataset?.theme === 'light' ? 'light' : 'dark',
      size: 'flexible',
      appearance: 'always',
      callback: (token) => {
        tokens.set(action, String(token));
        announce(action, 'Vérification terminée.', 'success');
      },
      'expired-callback': () => {
        tokens.delete(action);
        announce(action, 'La vérification a expiré. Recommence le contrôle.', 'error');
        resetAfterCallback(action);
      },
      'timeout-callback': () => {
        tokens.delete(action);
        announce(action, 'La vérification a expiré. Recommence le contrôle.', 'error');
        resetAfterCallback(action);
      },
      'error-callback': () => {
        tokens.delete(action);
        announce(action, 'Le contrôle anti-robot a échoué. Réessaie.', 'error');
        resetAfterCallback(action);
      },
    });
    widgetIds.set(action, widgetId);
    return widgetId;
  }

  async function token(action) {
    const widgetId = await activate(action);
    const value = tokens.get(action) || api.getResponse?.(widgetId) || '';
    if (!value) throw new TurnstileClientError('Termine la vérification anti-robot puis réessaie.', 'turnstile_required');
    return value;
  }

  function reset(action) {
    tokens.delete(action);
    const widgetId = widgetIds.get(action);
    if (widgetId !== undefined) api?.reset?.(widgetId);
  }

  function destroy() {
    for (const widgetId of widgetIds.values()) api?.remove?.(widgetId);
    widgetIds.clear();
    tokens.clear();
  }

  return { initialize, activate, token, reset, destroy };
}
