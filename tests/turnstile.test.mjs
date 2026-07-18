import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TURNSTILE_ACTIONS,
  TURNSTILE_SCRIPT_URL,
  TurnstileClientError,
  createTurnstileController,
} from '../assets/js/turnstile-client.js';

const rootPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(rootPath, path), 'utf8');

function createFixture() {
  const containers = new Map(TURNSTILE_ACTIONS.map((action) => [action, { dataset: { action } }]));
  const messages = new Map(TURNSTILE_ACTIONS.map((action) => [action, { dataset: {}, textContent: '' }]));
  const root = {
    dataset: {},
    querySelector(selector) {
      const action = selector.match(/="([^"]+)"/)?.[1];
      return selector.startsWith('[data-turnstile-action') ? containers.get(action) : messages.get(action);
    },
  };
  const widgets = new Map();
  const resets = [];
  const removals = [];
  let nextId = 0;
  const api = {
    render(container, options) {
      const id = ++nextId;
      widgets.set(id, { container, options, response: '' });
      return id;
    },
    getResponse(id) { return widgets.get(id)?.response || ''; },
    reset(id) { resets.push(id); if (widgets.has(id)) widgets.get(id).response = ''; },
    remove(id) { removals.push(id); widgets.delete(id); },
  };
  const documentRef = { documentElement: { dataset: { theme: 'dark' } } };
  const windowRef = { setTimeout, clearTimeout };
  const accountRepository = { getTurnstileConfig: async () => ({ turnstile: { enabled: true, siteKey: 'test-site-key' } }) };
  const controller = createTurnstileController({
    root, accountRepository, windowRef, documentRef, scriptLoader: async () => api,
  });
  return { controller, root, messages, widgets, resets, removals };
}

test('le rendu explicite associe un widget et une action à chaque formulaire', async () => {
  const fixture = createFixture();
  const widgetId = await fixture.controller.activate('register');
  const widget = fixture.widgets.get(widgetId);
  assert.equal(widget.options.action, 'register');
  assert.equal(widget.options.sitekey, 'test-site-key');
  assert.equal(widget.options.theme, 'dark');
  widget.options.callback('token-register');
  assert.equal(await fixture.controller.token('register'), 'token-register');
  assert.equal(fixture.messages.get('register').dataset.tone, 'success');
});

test('le jeton manque en fail closed et chaque utilisation réinitialise le widget', async () => {
  const fixture = createFixture();
  const widgetId = await fixture.controller.activate('login');
  await assert.rejects(() => fixture.controller.token('login'), (error) => (
    error instanceof TurnstileClientError && error.code === 'turnstile_required'
  ));
  fixture.widgets.get(widgetId).options.callback('one-shot');
  assert.equal(await fixture.controller.token('login'), 'one-shot');
  fixture.controller.reset('login');
  assert.deepEqual(fixture.resets, [widgetId]);
  await assert.rejects(() => fixture.controller.token('login'), /Termine la vérification/);
});

test('expiration, timeout et erreur suppriment le jeton puis relancent le widget', async () => {
  for (const callbackName of ['expired-callback', 'timeout-callback', 'error-callback']) {
    const fixture = createFixture();
    const widgetId = await fixture.controller.activate('forgot_password');
    fixture.widgets.get(widgetId).options.callback('temporary');
    fixture.widgets.get(widgetId).options[callbackName]();
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    assert.deepEqual(fixture.resets, [widgetId], callbackName);
    await assert.rejects(() => fixture.controller.token('forgot_password'), TurnstileClientError);
  }
});

test('la destruction libère widgets et le script/config indisponible échoue fermé', async () => {
  const fixture = createFixture();
  const loginId = await fixture.controller.activate('login');
  const registerId = await fixture.controller.activate('register');
  fixture.controller.destroy();
  assert.deepEqual(fixture.removals.sort(), [loginId, registerId].sort());

  const root = { dataset: {}, querySelector: () => ({}) };
  const disabled = createTurnstileController({
    root,
    accountRepository: { getTurnstileConfig: async () => ({ turnstile: { enabled: false, siteKey: '' } }) },
    scriptLoader: async () => { throw new Error('must not load'); },
  });
  await assert.rejects(() => disabled.activate('login'), (error) => error.code === 'turnstile_disabled');
  assert.equal(root.dataset.turnstile, 'error');
});

test('le contrat serveur valide Turnstile sans élargir CSP ni cache PWA', async () => {
  const [auth, verifier, config, apache, worker, example, app] = await Promise.all([
    read('api/src/Controllers/AuthController.php'),
    read('api/src/Services/TurnstileVerifier.php'),
    read('api/src/Config.php'),
    read('.htaccess'),
    read('service-worker.js'),
    read('config/.env.example'),
    read('api/src/Application.php'),
  ]);
  assert.equal(TURNSTILE_SCRIPT_URL, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  for (const action of ['register', 'login', 'forgot_password']) assert.match(auth, new RegExp(`verify\\(\\$body\\['turnstileToken'\\], '${action}'`));
  assert.match(app, /GET', '\/auth\/turnstile-config'/);
  assert.match(verifier, /success/);
  assert.match(verifier, /hostname/);
  assert.match(verifier, /action/);
  assert.match(verifier, /challenge_ts/);
  assert.match(verifier, /timeout-or-duplicate|SITEVERIFY_URL|siteverify/i);
  assert.match(config, /TURNSTILE_ENABLED/);
  assert.match(config, /clés de test Turnstile/);
  assert.match(apache, /script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com/);
  assert.match(apache, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(apache, /challenges\.cloudflare\.com\/\*|unsafe-eval/);
  assert.ok(worker.includes("'/assets/js/turnstile-client.js?v=20260718-30'"));
  assert.ok(!worker.includes(TURNSTILE_SCRIPT_URL));
  for (const key of ['TURNSTILE_SITE_KEY=', 'TURNSTILE_SECRET_KEY=']) assert.ok(example.includes(key));
  assert.doesNotMatch(example, /TURNSTILE_(?:SITE_KEY|SECRET_KEY)=\S+/);
});

test('les cas serveur PHP couvrent succès, expiration, rejeu et indisponibilité', () => {
  const php = process.env.FAT_TEST_PHP || (process.platform === 'win32' ? 'C:\\tools\\php\\php.exe' : 'php');
  const result = spawnSync(php, ['tests/turnstile-unit.php'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Turnstile PHP:/);
});
