import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\\/]$/, '');
const PHP = process.env.FAT_TEST_PHP || (process.platform === 'win32' ? 'C:\\tools\\php\\php.exe' : 'php');
const ORIGIN = 'http://127.0.0.1:8082';
const env = {
  ...process.env,
  APP_ENV: 'local', APP_ORIGIN: ORIGIN,
  APP_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  DB_DSN: process.env.FAT_TEST_DB_DSN || 'mysql:host=127.0.0.1;port=3308;dbname=fat_test;charset=utf8mb4',
  DB_USER: process.env.FAT_TEST_DB_USER || 'fat_test',
  DB_PASSWORD: process.env.FAT_TEST_DB_PASSWORD || 'fat_local_test_only', STORAGE_ROOT: 'storage',
  TRUSTED_HOST: '127.0.0.1:8082', MAIL_MODE: 'log', FEATURE_COMMUNITY: 'false',
  TURNSTILE_ENABLED: 'true',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_EXPECTED_HOSTNAME: '127.0.0.1',
  TURNSTILE_TIMEOUT_SECONDS: '4',
  TURNSTILE_SITEVERIFY_URL: 'http://127.0.0.1:8083/siteverify',
};

let turnstileSequence = 0;
const turnstileToken = (action) => `test-${action}-${++turnstileSequence}`;
const usedTurnstileTokens = new Set();
const turnstileServer = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const parameters = new URLSearchParams(raw);
    const token = parameters.get('response') || '';
    const action = ['register', 'login', 'forgot_password'].find((candidate) => token.startsWith(`test-${candidate}-`)) || '';
    const duplicate = usedTurnstileTokens.has(token);
    usedTurnstileTokens.add(token);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(duplicate || !action
      ? { success: false, 'error-codes': [duplicate ? 'timeout-or-duplicate' : 'invalid-input-response'] }
      : { success: true, hostname: '127.0.0.1', action, challenge_ts: new Date().toISOString() }));
  });
});

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: ROOT, env, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${executable} a échoué: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function resetDatabase() {
  if (process.env.FAT_TEST_SKIP_DB_RESET !== 'true') {
    command('docker', ['exec', 'fat-mariadb-test', 'mariadb', '-uroot', '-pfat_local_root_only', '-e',
      'DROP DATABASE IF EXISTS fat_test; CREATE DATABASE fat_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON fat_test.* TO fat_test@\'%\';']);
  }
  command(PHP, ['bin/migrate.php']);
  const repeated = command(PHP, ['bin/migrate.php']);
  assert.match(repeated, /déjà appliquée 001_auth\.sql/);
}

let cookie = '';
let csrf = '';
let lastSetCookie = '';
async function api(path, { method = 'GET', body, form, auth = false, expected = 200, origin = ORIGIN } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) headers.Origin = origin;
  if (auth && cookie) headers.Cookie = cookie;
  if (auth && csrf && !['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(`${ORIGIN}/api/v1${path}`, {
    method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  lastSetCookie = setCookie || '';
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  const payload = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  if (payload?.csrfToken) csrf = payload.csrfToken;
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  return payload;
}

async function concurrentPatch(path, body) {
  const request = () => fetch(`${ORIGIN}/api/v1${path}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json', Origin: ORIGIN,
      Cookie: cookie, 'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
  });
  const responses = await Promise.all([request(), request()]);
  const results = await Promise.all(responses.map(async (response) => ({ status: response.status, payload: await response.json() })));
  assert.deepEqual(results.map(({ status }) => status).sort((left, right) => left - right), [200, 409]);
  return results.find(({ status }) => status === 200).payload.replica;
}

async function waitForServer() {
  let lastResponse = '';
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/v1/health`);
      if (response.ok) return;
      lastResponse = await response.text();
    } catch {}
    await delay(100);
  }
  throw new Error(`Serveur PHP local indisponible (exit=${server.exitCode}, response=${lastResponse}): ${stderr}`);
}

async function latestMailToken(kind) {
  const log = join(ROOT, 'storage', 'logs', 'mail-test.jsonl');
  for (let index = 0; index < 20; index += 1) {
    try {
      const lines = (await readFile(log, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
      const records = lines.map((line) => JSON.parse(line));
      const record = [...records].reverse().find((item) => item.body.includes(`?${kind}=`));
      const match = record?.body.match(new RegExp(`\\?${kind}=([a-f0-9]{64})`));
      if (match) return match[1];
    } catch {}
    await delay(50);
  }
  throw new Error(`Token ${kind} absent du mailer local.`);
}

resetDatabase();
await rm(join(ROOT, 'storage', 'logs', 'mail-test.jsonl'), { force: true });
await new Promise((resolveListen, reject) => {
  turnstileServer.once('error', reject);
  turnstileServer.listen(8083, '127.0.0.1', resolveListen);
});
const server = spawn(PHP, ['-S', '127.0.0.1:8082', 'tests/api-router.php'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
server.stderr.on('data', (chunk) => { stderr += chunk; });

try {
  await waitForServer();
  const health = await api('/health');
  assert.deepEqual(health, { status: 'ok' });
  await api('/auth/reset-password', { method: 'POST', expected: 403, origin: 'https://evil.example', body: { token: 'a'.repeat(64), password: 'MotDePasseRefuse123' } });
  await api('/auth/register', { method: 'POST', expected: 422, body: { pseudo: 'Refus', email: 'refus@example.test', password: 'MotDePasseRefuse123', legalAccepted: false, turnstileToken: turnstileToken('register') } });

  const registrationAlpha = await api('/auth/register', { method: 'POST', expected: 202, body: { pseudo: 'Alpha', email: 'alpha@example.test', password: 'MotDePasseAlpha123', legalAccepted: true, turnstileToken: turnstileToken('register') } });
  const duplicateRegistration = await api('/auth/register', { method: 'POST', expected: 202, body: { pseudo: 'AlphaBis', email: 'alpha@example.test', password: 'MotDePasseAlpha123', legalAccepted: true, turnstileToken: turnstileToken('register') } });
  assert.deepEqual(duplicateRegistration, registrationAlpha);
  const verifyAlpha = await latestMailToken('verify');
  await api('/auth/verify-email', { method: 'POST', body: { token: verifyAlpha } });
  await api('/auth/verify-email', { method: 'POST', expected: 422, body: { token: verifyAlpha } });
  const fixedCookie = `fat_session=${'a'.repeat(64)}`;
  cookie = fixedCookie;
  const login = await api('/auth/login', { method: 'POST', body: { identity: 'alpha@example.test', password: 'MotDePasseAlpha123', turnstileToken: turnstileToken('login') } });
  assert.equal(login.user.role, 'user');
  assert.notEqual(cookie, fixedCookie);
  assert.match(lastSetCookie, /HttpOnly/i);
  assert.match(lastSetCookie, /SameSite=Lax/i);
  const alphaCookie = cookie;
  const alphaCsrf = csrf;

  const deniedCsrf = csrf;
  csrf = '';
  await api('/me', { method: 'PATCH', auth: true, expected: 403, body: { pseudo: 'Alpha2', version: 2 } });
  csrf = deniedCsrf;
  const me = await api('/me', { auth: true });
  assert.equal(me.authenticated, true);
  await api('/me', { method: 'PATCH', auth: true, expected: 422, body: { pseudo: 'Root', role: 'admin', version: me.user.version } });

  const card = await api('/replicas', { method: 'POST', auth: true, expected: 201, body: {
    modelName: 'Réplique Alpha', type: 'AEG', simulationUrl: `${ORIGIN}/?m=0.28&j=1.30`,
    massG: 0.28, energyJ: 1.3, usefulRangeM: 52.5, maximumRangeM: 68.2,
    curveThumbnailSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30" role="img" aria-label="Courbe"><path d="M0 20L100 10"/></svg>', rightsConfirmed: true,
  } });
  assert.equal(card.replica.usefulRangeM, 52.5);
  const cardId = card.replica.id;
  await api('/replicas', { method: 'POST', auth: true, expected: 422, body: {
    modelName: 'Divergence', type: 'AEG', simulationUrl: `${ORIGIN}/?m=0.28&j=1.30`, massG: 0.30, energyJ: 1.3, rightsConfirmed: true,
  } });

  const hostile = new FormData();
  hostile.set('photo', new Blob(['<svg><script>alert(1)</script></svg>'], { type: 'image/png' }), 'photo.png');
  await api(`/replicas/${cardId}/photo`, { method: 'POST', auth: true, form: hostile, expected: 422 });

  cookie = ''; csrf = '';
  await api('/auth/register', { method: 'POST', expected: 202, body: { pseudo: 'Bravo', email: 'bravo@example.test', password: 'MotDePasseBravo123', legalAccepted: true, turnstileToken: turnstileToken('register') } });
  const verifyBravo = await latestMailToken('verify');
  await api('/auth/verify-email', { method: 'POST', body: { token: verifyBravo } });
  await api('/auth/login', { method: 'POST', body: { identity: 'bravo@example.test', password: 'MotDePasseBravo123', turnstileToken: turnstileToken('login') } });
  await api(`/replicas/${cardId}`, { auth: true, expected: 404 });
  await api(`/replicas/${cardId}`, { method: 'PATCH', auth: true, expected: 404, body: { modelName: 'Vol', version: 1 } });
  await api(`/replicas/${cardId}`, { method: 'DELETE', auth: true, expected: 404, body: { version: 1 } });
  await api(`/replicas/${cardId}/processing-status`, { auth: true, expected: 404 });
  await api(`/replicas/${cardId}/submit`, { method: 'POST', auth: true, expected: 409, body: { version: 1 } });
  await api('/admin/replicas', { auth: true, expected: 403 });

  command('docker', ['exec', 'fat-mariadb-test', 'mariadb', '-uroot', '-pfat_local_root_only', 'fat_test', '-e', "UPDATE users SET role='admin' WHERE email='bravo@example.test'"]);
  await api('/auth/logout', { method: 'POST', auth: true, expected: 204 });
  cookie = ''; csrf = '';
  const adminLogin = await api('/auth/login', { method: 'POST', body: { identity: 'bravo@example.test', password: 'MotDePasseBravo123', turnstileToken: turnstileToken('login') } });
  assert.equal(adminLogin.user.role, 'admin');
  await api('/admin/replicas', { auth: true });

  cookie = alphaCookie; csrf = alphaCsrf;
  const updated = await concurrentPatch(`/replicas/${cardId}`, { modelName: 'Réplique Alpha II', version: card.replica.version });
  await api(`/replicas/${cardId}`, { method: 'PATCH', auth: true, expected: 409, body: { modelName: 'Conflit', version: card.replica.version } });
  const archived = await api(`/replicas/${cardId}`, { method: 'DELETE', auth: true, body: { version: updated.version } });
  assert.equal(archived.replica.state, 'archived');

  const forgotKnown = await api('/auth/forgot-password', { method: 'POST', expected: 202, body: { email: 'alpha@example.test', turnstileToken: turnstileToken('forgot_password') } });
  const forgotUnknown = await api('/auth/forgot-password', { method: 'POST', expected: 202, body: { email: 'absent@example.test', turnstileToken: turnstileToken('forgot_password') } });
  assert.deepEqual(forgotUnknown, forgotKnown);
  const reset = await latestMailToken('reset');
  await api('/auth/reset-password', { method: 'POST', body: { token: reset, password: 'NouveauMotDePasse123' } });
  cookie = ''; csrf = '';
  const replay = turnstileToken('login');
  await api('/auth/login', { method: 'POST', expected: 401, body: { identity: 'alpha@example.test', password: 'MotDePasseAlpha123', turnstileToken: replay } });
  await api('/auth/login', { method: 'POST', expected: 422, body: { identity: 'alpha@example.test', password: 'NouveauMotDePasse123', turnstileToken: replay } });
  await api('/auth/login', { method: 'POST', body: { identity: 'alpha@example.test', password: 'NouveauMotDePasse123', turnstileToken: turnstileToken('login') } });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await api('/auth/login', { method: 'POST', expected: 401, body: { identity: 'limit@example.test', password: 'MotDePasseInvalide123', turnstileToken: turnstileToken('login') } });
  }
  await api('/auth/login', { method: 'POST', expected: 429, body: { identity: 'limit@example.test', password: 'MotDePasseInvalide123', turnstileToken: turnstileToken('login') } });

  console.log('API intégration: migrations, auth, Origin/CSRF, fixation, énumération, quotas, concurrence, rôles, IDOR, cards et upload hostile validés.');
} finally {
  server.kill('SIGTERM');
  turnstileServer.close();
  await delay(100);
  if (server.exitCode && server.exitCode !== 0) console.error(stderr);
}
