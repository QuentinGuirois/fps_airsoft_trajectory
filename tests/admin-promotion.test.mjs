import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('la promotion admin cible uniquement un compte existant, vérifié et actif', async () => {
  const command = await read('bin/promote-admin.php');
  assert.match(command, /--email/);
  assert.match(command, /Validator::email/);
  assert.match(command, /email_verified_at IS NOT NULL/);
  assert.match(command, /deletion_requested_at IS NULL/);
  assert.match(command, /role='user'/);
  assert.match(command, /count\(\$matches\) !== 1/);
  await assert.rejects(stat(new URL('../bin/create-admin.php', import.meta.url)));
});

test('la commande exige une confirmation interactive et une transaction verrouillée', async () => {
  const command = await read('bin/promote-admin.php');
  assert.match(command, /stream_isatty\(STDIN\)/);
  assert.match(command, /hash_equals\('PROMOUVOIR', \$confirmation\)/);
  assert.match(command, /beginTransaction\(\)/);
  assert.match(command, /FOR UPDATE/);
  assert.match(command, /rollBack\(\)/);
  assert.match(command, /commit\(\)/);
  assert.doesNotMatch(command, /INSERT INTO users|password_hash|PASSWORD_/);
});

test('la promotion révoque les sessions et écrit un audit expurgé', async () => {
  const command = await read('bin/promote-admin.php');
  assert.match(command, /UPDATE users SET role='admin',version=version\+1/);
  assert.match(command, /DELETE FROM sessions WHERE user_id=\?/);
  assert.match(command, /bin2hex\(random_bytes\(12\)\)/);
  assert.match(command, /'admin\.promoted'/);
  assert.match(command, /'sessionsRevoked' => true/);
  assert.doesNotMatch(command, /password|token|cookie|secret/i);
});
