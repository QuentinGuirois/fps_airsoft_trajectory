import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('les mentions identifient un éditeur personne physique et 3GK Software', async () => {
  const legal = await read('mentions-legales/index.html');
  assert.match(legal, /<h1>Mentions légales<\/h1>/);
  assert.match(legal, /édité à titre personnel par <strong>Quentin Guirois<\/strong>, personne physique/);
  assert.match(legal, /également directeur de publication/);
  assert.match(legal, /<strong>3GK Software<\/strong>, 6 allée Jean Gabin, 37100 Tours, France/);
  assert.match(legal, /\+33 \(0\)6 34 45 84 06/);
  assert.match(legal, /contact@fps-airsoft-trajectory\.com/g);
  assert.match(legal, /Adresse postale de l’éditeur : <strong>à compléter avant ouverture des comptes<\/strong>/);
});

test('la politique décrit les traitements, durées, droits et blocages avant ouverture', async () => {
  const privacy = await read('politique-confidentialite/index.html');
  for (const expected of [
    'Calculateur sans compte', 'Données du compte facultatif', 'Cloudflare Turnstile',
    'session : jusqu’à 14 jours', 'ancienne image remplacée', 'délai de restauration de 14 jours',
    'journaux d’audit et journaux techniques', 'CNIL', 'contact@fps-airsoft-trajectory.com',
  ]) assert.ok(privacy.includes(expected), expected);
  assert.match(privacy, /boîte[\s\S]*adresse postale[\s\S]*journaux techniques et d’audit[\s\S]*avant de rendre l’inscription visible/);
  assert.match(privacy, /<strong>3GK Software<\/strong>, 6 allée Jean Gabin, 37100 Tours, France/);
});

test('l’inscription exige et versionne une acceptation juridique côté serveur', async () => {
  const [html, client, controller, migration] = await Promise.all([
    read('compte/index.html'),
    read('assets/js/account-login.js'),
    read('api/src/Controllers/AuthController.php'),
    read('database/migrations/003_legal_acceptance.sql'),
  ]);
  assert.match(html, /name="legalAccepted" type="checkbox" required/);
  assert.match(html, /version du 18 juillet 2026/);
  assert.match(client, /legalAccepted: form\.elements\.legalAccepted\?\.checked === true/);
  assert.match(controller, /Validator::boolTrue\(\$body\['legalAccepted'\]/);
  assert.match(controller, /private const TERMS_VERSION = '2026-07-18'/);
  assert.match(controller, /terms_version,terms_accepted_at/);
  assert.match(migration, /ADD COLUMN terms_version/);
  assert.match(migration, /ADD COLUMN terms_accepted_at/);
  assert.match(migration, /chk_users_terms_acceptance/);
});

test('les pages légales sont publiques, liées et le compte reste absent de la navigation', async () => {
  const [site, sitemap, worker] = await Promise.all([
    read('site.js'), read('sitemap.xml'), read('service-worker.js'),
  ]);
  for (const path of ['/mentions-legales/', '/politique-confidentialite/']) {
    assert.ok(site.includes(`href="${path}"`), path);
    assert.ok(sitemap.includes(`https://fps-airsoft-trajectory.com${path}`), path);
    assert.ok(worker.includes(`'${path}'`), path);
  }
  assert.doesNotMatch(sitemap, /\/compte\//);
  const navigationSource = site.slice(0, site.indexOf('const number ='));
  assert.doesNotMatch(navigationSource, /\/compte\//);
});
