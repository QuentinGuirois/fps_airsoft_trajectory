import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('le routeur expose le contrat API v1 complet sans endpoint historique', async () => {
  const [app, repositories] = await Promise.all([read('api/src/Application.php'), read('assets/js/community-repositories.js')]);
  for (const route of ['/health','/auth/turnstile-config','/auth/register','/auth/verify-email','/auth/login','/auth/logout','/auth/forgot-password','/auth/reset-password','/me','/replicas','/admin/replicas','/admin/replicas/published']) {
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
  const sql = `${await read('database/migrations/000_schema.sql')}\n${await read('database/migrations/001_auth.sql')}\n${await read('database/migrations/002_replicas.sql')}\n${await read('database/migrations/003_legal_acceptance.sql')}`;
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
  assert.match(rootRules, /script-src 'self' 'unsafe-inline' https:\/\/challenges\.cloudflare\.com/);
  assert.match(rootRules, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(rootRules, /challenges\.cloudflare\.com\/\*|unsafe-eval/);
  assert.match(rootRules, /SetEnvIf Request_URI "\^\/compte/);
  assert.match(rootRules, /Header merge Cache-Control "public, no-transform" env=!fat_private_shell/);
  assert.match(sourceRules, /Require all denied/);
  assert.match(accountRules, /no-store, private/);
  assert.match(accountRules, /noindex, nofollow/);
  assert.match(accountRules, /ExpiresActive Off/);
  assert.match(accountRules, /unset Expires/);
});

test('Turnstile est obligatoire côté PHP avec hostname, action, fraîcheur et configuration fail closed', async () => {
  const [auth, verifier, config, application] = await Promise.all([
    read('api/src/Controllers/AuthController.php'),
    read('api/src/Services/TurnstileVerifier.php'),
    read('api/src/Config.php'),
    read('api/src/Application.php'),
  ]);
  for (const action of ['register', 'login', 'forgot_password']) {
    assert.match(auth, new RegExp(`turnstile->verify\\(\\$body\\['turnstileToken'\\], '${action}'`));
  }
  assert.match(verifier, /SITEVERIFY_URL/);
  assert.match(verifier, /\$result\['success'\]/);
  assert.match(verifier, /\$result\['hostname'\]/);
  assert.match(verifier, /\$result\['action'\]/);
  assert.match(verifier, /\$result\['challenge_ts'\]/);
  assert.match(verifier, /turnstile_unavailable/);
  assert.match(config, /TURNSTILE_ENABLED/);
  assert.match(config, /TURNSTILE_EXPECTED_HOSTNAME/);
  assert.match(config, /clés de test Turnstile/);
  assert.match(application, /\/auth\/turnstile-config/);
});

test('Cloudflare ne transforme ni le thème avant paint ni les modules F.A.T.', async () => {
  const pages = [
    'index.html', 'offline.html', 'a-propos/index.html', 'compte/index.html', 'compte/armurerie.html',
    'convertisseur-joules-fps/index.html', 'faq-airsoft-balistique/index.html', 'guides/index.html',
    'guides/choisir-poids-bille-airsoft/index.html', 'guides/joule-creep-airsoft/index.html',
    'guides/portee-airsoft/index.html', 'guides/regler-hop-up-airsoft/index.html',
    'modele-physique-atp/index.html', 'outils/index.html',
    'outils/choisir-gaz-airsoft-pression-temperature/index.html',
    'mentions-legales/index.html', 'politique-confidentialite/index.html',
    'simulateur-3d-airsoft/index.html', 'simulateur-trajectoire-airsoft/index.html',
  ];
  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /<script data-cfasync="false">\(\(\)=>/, `${page}: thème protégé`);
    for (const tag of html.match(/<script[^>]+type="module"[^>]*>/g) || []) {
      assert.match(tag, /data-cfasync="false"/, `${page}: module protégé`);
    }
  }
});
