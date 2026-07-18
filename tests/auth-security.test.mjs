import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('les mots de passe utilisent Argon2id avec PASSWORD_DEFAULT en repli et rehash', async () => {
  const auth = await read('api/src/Controllers/AuthController.php');
  assert.match(auth, /PASSWORD_ARGON2ID/);
  assert.match(auth, /PASSWORD_DEFAULT/);
  assert.doesNotMatch(auth, /PASSWORD_BCRYPT/);
  assert.match(auth, /password_needs_rehash/);
  assert.match(auth, /password_hash/);
  assert.match(auth, /password_verify/);
});

test('les sessions restent aléatoires, hachées et protégées par cookie et CSRF', async () => {
  const [sessions, support] = await Promise.all([
    read('api/src/Services/SessionService.php'),
    read('api/src/Support.php'),
  ]);
  assert.match(support, /random_bytes\(32\)/);
  assert.match(sessions, /Support::tokenHash\(\$token\)/);
  assert.match(sessions, /'secure' => \$this->config->isProduction\(\)/);
  assert.match(sessions, /'httponly' => true/);
  assert.match(sessions, /'samesite' => 'Lax'/);
  assert.match(sessions, /hash_equals\(\(string\) \$session\['csrf_token'\], \$token\)/);
});

test('Origin strict et CSRF protègent toutes les mutations authentifiées', async () => {
  const [security, auth, user, replicas, admin] = await Promise.all([
    read('api/src/Middleware/Security.php'),
    read('api/src/Controllers/AuthController.php'),
    read('api/src/Controllers/UserController.php'),
    read('api/src/Controllers/ReplicaController.php'),
    read('api/src/Controllers/AdminController.php'),
  ]);
  assert.match(security, /hash_equals\(\$origin, \$requestOrigin\)/);
  assert.match(auth, /function logout[\s\S]*requireCsrf/);
  for (const method of ['update', 'export', 'requestDeletion']) {
    assert.match(user, new RegExp(`function ${method}[\\s\\S]*?requireCsrf`));
  }
  for (const method of ['create', 'update', 'archive', 'uploadPhoto', 'submit']) {
    assert.match(replicas, new RegExp(`function ${method}[\\s\\S]*?requireCsrf`));
  }
  assert.match(admin, /function moderate[\s\S]*requireCsrf/);
});

test('inscription et récupération ne divulguent pas l’existence d’un compte', async () => {
  const auth = await read('api/src/Controllers/AuthController.php');
  const genericRegister = 'Si la demande est valide, un email de vérification a été envoyé.';
  assert.equal(auth.split(genericRegister).length - 1, 2);
  assert.doesNotMatch(auth, /account_exists|déjà utilisé/);
  assert.match(auth, /Si ce compte existe, un email a été envoyé/);
  assert.match(auth, /token_hash/);
  assert.match(auth, /consumed_at IS NULL/);
  assert.match(auth, /expires_at>UTC_TIMESTAMP\(\)/);
});

test('l’inscription reste ouverte par défaut mais dispose d’un coupe-circuit serveur avant toute mutation', async () => {
  const [auth, example, login, entry] = await Promise.all([
    read('api/src/Controllers/AuthController.php'),
    read('config/.env.example'),
    read('assets/js/account-login.js'),
    read('assets/js/account-login-entry.js'),
  ]);
  const guard = auth.indexOf("ACCOUNT_REGISTRATION_ENABLED', true");
  assert.ok(guard > 0 && guard < auth.indexOf('$request->json()'));
  assert.match(auth, /registration_closed/);
  assert.match(example, /^ACCOUNT_REGISTRATION_ENABLED=true$/m);
  assert.match(login, /registrationEnabled = true/);
  assert.match(entry, /registrationEnabled !== false/);
});

test('les jetons transmis par email utilisent un fragment et le client nettoie l’historique', async () => {
  const [auth, login] = await Promise.all([
    read('api/src/Controllers/AuthController.php'),
    read('assets/js/account-login.js'),
  ]);
  assert.match(auth, /\/compte\/#verify=/);
  assert.match(auth, /\/compte\/#reset=/);
  assert.doesNotMatch(auth, /\/compte\/\?(?:verify|reset)=/);
  assert.match(login, /historyRef\?\.replaceState/);
});

test('la connexion combine des quotas séparés par IP et identité normalisée', async () => {
  const auth = await read('api/src/Controllers/AuthController.php');
  assert.match(auth, /hit\('login_ip', \$request->ip\(\), 40, 900\)/);
  assert.match(auth, /hit\('login_identity', \$identity, 8, 900\)/);
});

test('quotas et journaux utilisent des empreintes sans secret ni IP brute', async () => {
  const [limits, audit, application] = await Promise.all([
    read('api/src/Services/RateLimiter.php'),
    read('api/src/Services/AuditLogger.php'),
    read('api/src/Application.php'),
  ]);
  assert.match(limits, /hash_hmac\('sha256'/);
  assert.doesNotMatch(limits, /INSERT INTO rate_limits[^\n]*identifier/);
  assert.doesNotMatch(audit, /password|cookie|token|REMOTE_ADDR/i);
  assert.match(application, /isProduction\(\) \? 'Une erreur interne est survenue\.'/);
  assert.doesNotMatch(application, /getTrace|stack/i);
});

test('ownership objet par objet et rôle admin restent imposés par SQL et session serveur', async () => {
  const [replicas, uploads, admin, user] = await Promise.all([
    read('api/src/Controllers/ReplicaController.php'),
    read('api/src/Services/UploadService.php'),
    read('api/src/Controllers/AdminController.php'),
    read('api/src/Controllers/UserController.php'),
  ]);
  assert.match(replicas, /WHERE id=\? AND user_id=\? LIMIT 1/);
  assert.match(replicas, /WHERE id=\? AND user_id=\? AND version=\?/);
  assert.match(uploads, /WHERE id=\? AND user_id=\? FOR UPDATE/);
  assert.match(admin, /require\(\$request, 'admin'\)/);
  assert.doesNotMatch(user, /\['role'\].*=|SET role|role=\?/);
});

test('API, images privées et shells de compte ne sont jamais mis en cache', async () => {
  const [response, worker, accountRules] = await Promise.all([
    read('api/src/Response.php'),
    read('service-worker.js'),
    read('compte/.htaccess'),
  ]);
  assert.match(response, /no-store, private/);
  assert.match(response, /private, no-store/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)[\s\S]*fetch\(event\.request\)/);
  assert.match(accountRules, /no-store, private/);
  assert.match(accountRules, /noindex, nofollow/);
});
