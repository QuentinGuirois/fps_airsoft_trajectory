import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const base = process.env.FAT_BROWSER_BASE || 'http://127.0.0.1:8080';
const output = join(root, 'output');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

function watch(page, label) {
  const errors = [];
  const external = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label} page: ${error.message}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== base
      && !url.href.startsWith('data:')
      && !url.href.startsWith('blob:')
      && url.hostname !== 'challenges.cloudflare.com'
    ) external.push(url.href);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
  return { errors, external };
}

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const desktop = await desktopContext.newPage();
  const desktopWatch = watch(desktop, 'desktop');
  await desktop.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  await desktop.locator('[data-radar-count]').filter({ hasText: '4 PARTIES' }).waitFor();
  assert.equal(await desktop.locator('h1').textContent(), 'Parties d’airsoft en France : trouvez votre prochaine partie');
  assert.equal(await desktop.locator('.radar-event-card').count(), 4);
  assert.equal(await desktop.locator('.radar-marker-shell').count(), 3, 'La fiche approximative ne doit pas recevoir de faux point.');
  const publicPayload = await desktop.evaluate(async () => (await fetch('/api/v1/radar/events')).json());
  assert.equal(JSON.stringify(publicPayload).includes('Adresse privée'), false);
  const approximate = publicPayload.events.find((event) => event.locationVisibility === 'approximate');
  assert.equal(approximate.latitude, null);
  assert.equal(approximate.longitude, null);
  assert.match(publicPayload.events[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(publicPayload.events.every((event) => typeof event.toiletsAvailable === 'boolean'), true);
  assert.equal(JSON.stringify(publicPayload).includes('availabilityStatus'), false);
  assert.equal(JSON.stringify(publicPayload).includes('availablePlaces'), false);
  await desktop.screenshot({ path: join(output, 'radar-desktop.png'), fullPage: false });

  const marker = desktop.locator('.leaflet-marker-icon.radar-marker-shell').first();
  await marker.focus();
  await desktop.keyboard.press('Enter');
  await desktop.locator('[data-radar-briefing]:visible').waitFor();
  await desktop.keyboard.press('Escape');
  await desktop.locator('[data-radar-briefing]').waitFor({ state: 'hidden' });

  const firstCard = desktop.locator('.radar-event-open').first();
  await firstCard.click();
  await desktop.locator('[data-radar-briefing]:visible').waitFor();
  assert.match(desktop.url(), /\/parties-airsoft\/recette-radar-/);
  assert.equal(await desktop.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
  assert.equal(await desktop.locator('.radar-rules .radar-rule-row').count(), 7);
  assert.match(await desktop.locator('.radar-briefing-facts').textContent(), /CAPACITÉ.*TOILETTES/s);
  await desktop.getByRole('button', { name: 'COPIER LE LIEN' }).waitFor();
  await desktop.keyboard.press('Escape');
  await desktop.locator('[data-radar-briefing]').waitFor({ state: 'hidden' });
  assert.equal(new URL(desktop.url()).pathname, '/parties-airsoft/');

  await desktop.getByRole('button', { name: 'CE WEEK-END' }).click();
  await desktop.locator('[data-radar-count]').filter({ hasText: '0 PARTIE' }).waitFor();
  await desktop.locator('[data-radar-empty]:visible').waitFor();
  await desktop.getByRole('button', { name: 'TOUTE LA FRANCE' }).click();
  await desktop.locator('[data-radar-count]').filter({ hasText: '4 PARTIES' }).waitFor();
  await desktop.locator('label', { hasText: 'CO₂' }).click();
  await desktop.locator('[data-radar-count]').filter({ hasText: '4 PARTIES' }).waitFor();
  await desktop.locator('[data-radar-filters]').evaluate((form) => form.reset());
  await desktop.locator('[name="location"]').fill('Bordeaux');
  await desktop.locator('[data-radar-count]').filter({ hasText: '1 PARTIE' }).waitFor();
  assert.equal(await desktop.locator('.radar-event-card').count(), 1);
  await desktop.locator('[data-radar-filters]').evaluate((form) => form.reset());
  await desktop.locator('[data-radar-count]').filter({ hasText: '4 PARTIES' }).waitFor();
  await desktop.setViewportSize({ width: 1280, height: 900 });
  await desktop.locator('#radar-map').waitFor();
  const resizedMap = await desktop.locator('#radar-map').boundingBox();
  assert.ok(resizedMap.width > 700 && resizedMap.height > 600, JSON.stringify(resizedMap));

  const deep = await desktopContext.newPage();
  const deepWatch = watch(deep, 'deep');
  await deep.goto(`${base}${publicPayload.events[0].publicUrl}`, { waitUntil: 'networkidle' });
  await deep.locator('[data-radar-briefing]:visible').waitFor();
  assert.equal(await deep.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
  assert.match(await deep.locator('.radar-briefing-facts').textContent(), /SECTEUR.*MISE À JOUR/s);
  assert.deepEqual(deepWatch.external, []);
  assert.deepEqual(deepWatch.errors, []);
  await deep.close();
  assert.deepEqual(desktopWatch.external, []);
  assert.deepEqual(desktopWatch.errors, []);

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const mobile = await mobileContext.newPage();
  const mobileWatch = watch(mobile, 'mobile');
  await mobile.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  await mobile.locator('[data-radar-count]').filter({ hasText: '4 PARTIES' }).waitFor();
  assert.equal(await mobile.locator('.radar-event-card').count(), 4);
  const mobileGeolocation = await mobile.locator('.radar-mobile-geolocate').boundingBox();
  assert.ok(mobileGeolocation?.height >= 44, JSON.stringify(mobileGeolocation));
  await mobile.screenshot({ path: join(output, 'radar-mobile.png'), fullPage: false });
  await mobile.locator('.radar-event-open').first().click();
  const mobileBriefing = mobile.locator('[data-radar-briefing]:visible');
  await mobileBriefing.waitFor();
  const box = await mobileBriefing.boundingBox();
  assert.ok(box.width >= 389 && box.height >= 843, JSON.stringify(box));
  await mobile.screenshot({ path: join(output, 'radar-mobile-briefing.png'), fullPage: false });
  assert.deepEqual(mobileWatch.external, []);
  assert.deepEqual(mobileWatch.errors, []);
  await mobileContext.close();

  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  });
  await ownerContext.addInitScript(() => localStorage.setItem('fat-theme', 'light'));
  const owner = await ownerContext.newPage();
  const ownerWatch = watch(owner, 'owner');
  await owner.goto(`${base}/compte/?return=%2Fcompte%2Fmes-parties.html`, { waitUntil: 'domcontentloaded' });
  await owner.locator('#account-identity').fill('admin');
  await owner.locator('#account-password').fill('admin');
  await owner.locator('[data-turnstile-message="login"]').filter({ hasText: 'Vérification terminée.' }).waitFor({ timeout: 20_000 });
  await owner.getByRole('button', { name: 'ENTRER SUR LE TERRAIN' }).click();
  await owner.waitForURL('**/compte/mes-parties.html');
  await owner.locator('.radar-owner-card').first().waitFor();
  assert.equal(await owner.locator('.radar-owner-card').count(), 4);
  assert.equal((await owner.locator('[data-account-pseudo]').textContent()).trim().toLowerCase(), 'admin');
  assert.equal(await owner.locator('[data-theme-control]').count(), 0);
  assert.equal(await owner.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await owner.evaluate(() => localStorage.getItem('fat-theme')), null);
  assert.equal(await owner.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(12, 16, 8)');
  await owner.screenshot({ path: join(output, 'radar-owner-list.png'), fullPage: false });
  await owner.locator('[data-owner-create]').click();
  await owner.locator('[data-owner-editor]:visible').waitFor();
  assert.equal(await owner.locator('[name="title"]').inputValue(), 'Brouillon sans titre');
  assert.equal(await owner.locator('[name="toiletsAvailable"]').inputValue(), '');
  assert.equal(await owner.locator('[name="availablePlaces"]').count(), 0);
  assert.equal(await owner.locator('[name="availabilityStatus"]').count(), 0);
  await owner.locator('[data-editor-close]').click();
  await owner.locator('.radar-owner-card').filter({ hasText: 'Brouillon sans titre' }).waitFor();
  assert.equal(await owner.locator('.radar-owner-card').count(), 5);
  const editable = owner.locator('.radar-owner-card').filter({ has: owner.locator('button', { hasText: 'MODIFIER' }) }).first();
  await editable.getByRole('button', { name: 'MODIFIER' }).click();
  await owner.locator('[data-owner-editor]:visible').waitFor();
  assert.equal(await owner.locator('[data-step-indicator]').count(), 5);
  assert.equal(await owner.locator('[data-editor-step="0"]:visible').count(), 1);
  await owner.locator('#radar-owner-map').waitFor();
  const ownerMap = await owner.locator('#radar-owner-map').boundingBox();
  assert.ok(ownerMap.width > 500 && ownerMap.height > 400, JSON.stringify(ownerMap));
  assert.match(await owner.locator('[data-location-reading]').textContent(), /WGS84/);
  await owner.screenshot({ path: join(output, 'radar-owner-editor.png'), fullPage: false });
  await owner.locator('[data-step-indicator="1"] button').click();
  await owner.locator('[name="toiletsAvailable"]:visible').waitFor();
  assert.match(await owner.locator('[name="toiletsAvailable"]').inputValue(), /^(yes|no)$/);
  assert.deepEqual(ownerWatch.external, []);
  assert.deepEqual(ownerWatch.errors, []);
  await ownerContext.close();
  await desktopContext.close();

  console.log('Radar navigateur: desktop, mobile, briefing, filtres, redimensionnement, confidentialité et espace organisateur validés.');
  console.log(`Captures: ${join(output, 'radar-desktop.png')}, ${join(output, 'radar-mobile.png')}, ${join(output, 'radar-mobile-briefing.png')}, ${join(output, 'radar-owner-list.png')}, ${join(output, 'radar-owner-editor.png')}`);
} finally {
  await browser.close();
}
