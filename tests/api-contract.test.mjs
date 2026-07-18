import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('le routeur expose le contrat API v1 complet sans endpoint historique', async () => {
  const [app, repositories] = await Promise.all([read('api/src/Application.php'), read('assets/js/community-repositories.js')]);
  for (const route of ['/health','/auth/register','/auth/verify-email','/auth/login','/auth/logout','/auth/forgot-password','/auth/reset-password','/me','/replicas','/admin/replicas']) {
    assert.ok(app.includes(`'${route}`), route);
  }
  assert.doesNotMatch(repositories, /\/session|\/accounts|background-removal/);
  assert.match(repositories, /\/auth\/login/);
});

test('les mutations privées combinent cookie serveur, CSRF, Origin strict et no-store', async () => {
  const [sessions, security, response, client] = await Promise.all([
    read('api/src/Services/SessionService.php'), read('api/src/Middleware/Security.php'),
    read('api/src/Response.php'), read('assets/js/community-repositories.js'),
  ]);
  assert.match(sessions, /httponly.*true/s);
  assert.match(sessions, /samesite.*Lax/s);
  assert.match(sessions, /requireCsrf/);
  assert.match(security, /invalid_origin/);
  assert.match(response, /no-store, private/);
  assert.match(client, /credentials: 'same-origin'/);
});

test('les migrations sont additives, indexées, sans BLOB et bornent le WebP à 102400 octets', async () => {
  const sql = `${await read('database/migrations/000_schema.sql')}\n${await read('database/migrations/001_auth.sql')}\n${await read('database/migrations/002_replicas.sql')}`;
  assert.match(sql, /schema_migrations/);
  assert.match(sql, /ENGINE=InnoDB/g);
  assert.match(sql, /utf8mb4/g);
  assert.match(sql, /image_bytes BETWEEN 1 AND 102400/);
  assert.doesNotMatch(sql, /\b(?:TINY|MEDIUM|LONG)?BLOB\b/i);
  assert.match(sql, /FOREIGN KEY/g);
});

test('le pipeline photo conserve un seul WebP privé, réconcilie par événement et détruit les uploads', async () => {
  const [worker, drain, upload] = await Promise.all([
    read('server/background-removal/worker.py'), read('bin/worker-drain.php'), read('api/src/Services/UploadService.php'),
  ]);
  assert.match(worker, /write_event/);
  assert.match(worker, /working\.unlink\(missing_ok=True\)/);
  assert.match(worker, /source\.unlink\(missing_ok=True\)/);
  assert.match(worker, /MAX_FINAL_BYTES = 102_400/);
  assert.match(drain, /flock\(\$lock, LOCK_EX \| LOCK_NB\)/);
  assert.match(drain, /image\/webp/);
  assert.match(upload, /MAX_BYTES = 8_388_608/);
});

test('aucun secret réel ni compte mock ne peut être activé par la configuration versionnée', async () => {
  const [example, entry, ignore] = await Promise.all([read('config/.env.example'), read('assets/js/armory-entry.js'), read('.gitignore')]);
  assert.match(example, /replace-with-64-random-hex-characters/);
  assert.doesNotMatch(example, /password\s*=\s*[^r\n]/i);
  assert.doesNotMatch(entry, /Mock|fixture|localStorage/i);
  assert.match(ignore, /\.env\.\*/);
  assert.match(ignore, /storage\/\*/);
});

test('le service worker contourne toujours les API et ne publie aucune donnée authentifiée', async () => {
  const worker = await read('service-worker.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)[\s\S]*respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(worker, /api\/v1\/(?:me|replicas|admin)/);
});

test('Apache protège les sources PHP, les shells privés et le site sans CDN', async () => {
  const [rootRules, sourceRules, accountRules] = await Promise.all([
    read('.htaccess'), read('api/src/.htaccess'), read('compte/.htaccess'),
  ]);
  assert.match(rootRules, /Strict-Transport-Security/);
  assert.match(rootRules, /Content-Security-Policy/);
  assert.match(rootRules, /default-src 'self'/);
  assert.match(sourceRules, /Require all denied/);
  assert.match(accountRules, /no-store, private/);
  assert.match(accountRules, /noindex, nofollow/);
});
