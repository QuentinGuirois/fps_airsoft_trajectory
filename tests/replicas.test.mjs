import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  REPLICA_SUBMISSION_LIMITS,
  validatePhoto,
  validatePseudo,
  validateReplicaName,
  validateSimulationUrl,
  validateYoutubeUrl,
} from '../replica-utils.js';

const root = process.cwd();
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

test('un lien F.A.T. valide transporte un grammage et une énergie uniques', () => {
  const result = validateSimulationUrl(
    '/?m=0.28&j=1.50&rpm=88000&z=35',
    'https://fps-airsoft-trajectory.com',
  );
  assert.equal(result.ok, true);
  assert.equal(result.massG, 0.28);
  assert.equal(result.energyJ, 1.5);
  assert.match(result.url, /^https:\/\/fps-airsoft-trajectory\.com\//);
});

test('les liens externes, ambigus ou hors bornes sont refusés', () => {
  const origin = 'https://fps-airsoft-trajectory.com';
  assert.equal(validateSimulationUrl('https://example.com/?m=0.28&j=1.5', origin).ok, false);
  assert.equal(validateSimulationUrl('/?m=0.28&m=0.30&j=1.5', origin).ok, false);
  assert.equal(validateSimulationUrl('/?m=0.28&j=1e2', origin).ok, false);
  assert.equal(validateSimulationUrl('/guides/?m=0.28&j=1.5', origin).ok, false);
  assert.equal(validateSimulationUrl('/#calculateur', origin).ok, false);
});

test('les textes communautaires et le lien YouTube restent bornés', () => {
  assert.equal(validatePseudo(' Keep ').value, 'Keep');
  assert.equal(validatePseudo('<script>').ok, false);
  assert.equal(validateReplicaName('M4 HPA terrain').ok, true);
  assert.equal(validateReplicaName('https://example.com').ok, false);
  assert.equal(validateYoutubeUrl('https://youtube.com/@keep').ok, true);
  assert.equal(validateYoutubeUrl('https://youtu.be/abc').ok, true);
  assert.equal(validateYoutubeUrl('http://youtube.com/watch?v=abc').ok, false);
  assert.equal(validateYoutubeUrl('https://example.com/channel').ok, false);
});

test('le contrôle navigateur des photos est limité à JPEG, PNG et WebP sous 8 Mo', () => {
  assert.equal(validatePhoto({ type: 'image/jpeg', size: 1024 }).ok, true);
  assert.equal(validatePhoto({ type: 'image/svg+xml', size: 1024 }).ok, false);
  assert.equal(validatePhoto({ type: 'image/webp', size: 9 * 1024 * 1024 }).ok, false);
  assert.equal(REPLICA_SUBMISSION_LIMITS.maximumPhotoBytes, 8 * 1024 * 1024);
  assert.deepEqual(
    [...REPLICA_SUBMISSION_LIMITS.allowedPhotoTypes].sort(),
    ['image/jpeg', 'image/png', 'image/webp'],
  );
});

test('le contrat distingue une soumission pending d’un profil vérifié', async () => {
  const [submission, profile] = await Promise.all([
    read('data', 'replica-submission.schema.json'),
    read('data', 'operator-profile.schema.json'),
  ]);
  const pending = JSON.parse(submission);
  const verified = JSON.parse(profile);
  assert.equal(pending.properties.status.const, 'pending');
  assert.equal(pending.properties.rights.properties.confirmed.const, true);
  assert.equal(verified.properties.verification.properties.status.const, 'verified');
  assert.equal(verified.properties.authorization.properties.profile.const, true);
});

test('la base prépare une image WebP unique, modération, quotas et jobs sans BLOB', async () => {
  const sql = await read('database', 'replicas.sql');
  assert.match(sql, /DEFAULT 'pending'/);
  assert.match(sql, /status ENUM\('pending','published','rejected','deleted'\)/);
  assert.match(sql, /CREATE TABLE replica_rate_limits/);
  assert.match(sql, /CREATE TABLE replica_image_jobs/);
  assert.match(sql, /image_path VARCHAR\(512\)/);
  assert.match(sql, /image_mime = 'image\/webp'/);
  assert.match(sql, /image_bytes IS NULL OR image_bytes <= 102400/);
  assert.match(sql, /image_status ENUM\('queued','processing','ready','rejected'\)/);
  assert.match(sql, /UNIQUE KEY uq_replica_image_path/);
  assert.match(sql, /CREATE TABLE replica_storage_quotas/);
  assert.match(sql, /CREATE TABLE replica_image_retention/);
  assert.match(sql, /retained_image_bytes/);
  assert.match(sql, /delete_after DATETIME NOT NULL/);
  assert.match(sql, /status <> 'published' OR image_status = 'ready'/);
  assert.match(sql, /image_status <> 'ready'[\s\S]+image_path IS NULL/);
  assert.doesNotMatch(sql, /image_original_path|image_public_path|BLOB|base64/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO/i);
});

test('le worker impose double masque, consensus, WebP 100 Ko et destruction des uploads', async () => {
  const worker = await read('server', 'background-removal', 'worker.py');
  assert.match(worker, /return working, original_suffix/);
  assert.match(worker, /DEFAULT_FAST_MODEL = "u2netp"/);
  assert.match(worker, /DEFAULT_QUALITY_MODEL = "isnet-general-use"/);
  assert.match(worker, /post_process_mask=True/);
  assert.match(worker, /compare_masks\(fast_mask, quality_mask\)/);
  assert.match(worker, /WEBP_QUALITIES = \(82, 76, 70, 64, 58, 52\)/);
  assert.match(worker, /MAX_FINAL_BYTES = 102_400/);
  assert.match(worker, /MAX_FRAME = \(1200, 700\)/);
  assert.match(worker, /MAX_PIXELS = 36_000_000/);
  assert.match(worker, /opened\.width \* opened\.height > MAX_PIXELS/);
  assert.match(worker, /"JPEG", "MPO", "PNG", "WEBP"/);
  assert.match(worker, /only_mask=True/);
  assert.doesNotMatch(worker, /session\.remove\(/);
  assert.match(worker, /not path\.is_symlink\(\)/);
  assert.match(worker, /working\.unlink\(missing_ok=True\)/);
  assert.match(worker, /source\.unlink\(missing_ok=True\)/);
  assert.doesNotMatch(worker, /rename\(failed\)|failed_directory\.mkdir/);
  assert.match(worker, /args\.once or args\.drain/);
  assert.match(worker, /single_worker_lock/);
});

test('la galerie publique est publiée sans embarquer de données brouillon', async () => {
  const [sitemap, html, controller] = await Promise.all([
    read('sitemap.xml'),
    read('tu-joues-avec-quoi', 'index.html'),
    read('api', 'src', 'Controllers', 'PublicReplicaController.php'),
  ]);
  assert.match(sitemap, /tu-joues-avec-quoi/);
  assert.match(html, /data-community-gallery/);
  assert.doesNotMatch(html, /fixture|blob:|data:image/i);
  assert.match(controller, /r\.state='published'/);
  assert.match(controller, /r\.image_status='ready'/);
  await assert.rejects(stat(join(root, 'replicas-data.js')));
  assert.match(await read('docs', 'repliques-production.md'), /uniquement les cards/);
});

test('le flux de production exclut localStorage et exige une modération serveur', async () => {
  const [utils, docs] = await Promise.all([
    read('replica-utils.js'),
    read('docs', 'repliques-production.md'),
  ]);
  assert.doesNotMatch(utils, /localStorage/);
  assert.match(docs, /PDO/);
  assert.match(docs, /CSRF/);
  assert.match(docs, /hors de `httpdocs`/);
  assert.match(docs, /image_status = 'queued'/);
  assert.match(docs, /sortie `ready`/);
  assert.match(docs, /102 400 octets/);
  assert.match(docs, /ni meilleur effort, ni/);
});

test('la card publique place le pseudo en premier et affiche la chaine YouTube', async () => {
  const component = await read('assets', 'js', 'replica-card.js');
  assert.match(component, /header\.append\(element\(doc, 'span', 'replica-pseudo', data\.user\.pseudo\), avatar\)/);
  assert.match(component, /CHA\\u00ceNE YOUTUBE/);
  assert.match(component, /if \(data\.user\.youtubeUrl\)/);
});
