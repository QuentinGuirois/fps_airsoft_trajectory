import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('le compte admin faible est strictement réservé à une base locale de recette', async () => {
  const command = await read('bin/create-local-test-admin.php');
  assert.match(command, /isProduction\(\)/);
  assert.match(command, /host=\(\?:127\\\.0\\\.0\\\.1\|localhost\)/);
  assert.match(command, /_test\|_local/);
  assert.match(command, /password_hash\('admin'/);
  assert.match(command, /role='admin'/);
  assert.match(command, /email_verified_at=UTC_TIMESTAMP\(\)/);
  assert.match(command, /DELETE FROM sessions WHERE user_id=\?/);
  assert.match(command, /beginTransaction\(\)/);
  assert.match(command, /rollBack\(\)/);
});
