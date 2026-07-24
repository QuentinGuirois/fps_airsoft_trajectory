import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const base = process.env.FAT_BROWSER_BASE || 'http://127.0.0.1:8080';
const output = join(root, 'output');
const php = process.env.FAT_TEST_PHP || 'php';
const expectedEventCount = Number(process.env.FAT_BROWSER_EXPECTED_COUNT || 32);
const expectedPrimaryCount = Number(process.env.FAT_BROWSER_EXPECTED_PRIMARY_COUNT || expectedEventCount);
assert.ok(Number.isInteger(expectedEventCount) && expectedEventCount > 0);
assert.ok(Number.isInteger(expectedPrimaryCount) && expectedPrimaryCount > 0);
const expectedEventLabel = `${expectedEventCount} PARTIES`;
const expectedPrimaryLabel = `${expectedPrimaryCount} FICHES`;
const testEnvironment = {
  ...process.env,
  FAT_CONFIG_FILE: process.env.FAT_TEST_CONFIG_FILE || join(root, 'config', '.env.local'),
  FAT_RADAR_SEED_OWNER_EMAIL: 'admin@local.test',
};
function prepare(args) {
  const result = spawnSync(php, args, { cwd: root, env: testEnvironment, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
if (process.env.FAT_BROWSER_SKIP_DB_PREP !== '1') {
  prepare(['bin/reset-local-database.php', '--yes']);
  prepare(['bin/create-local-test-admin.php']);
  prepare([
    'bin/import-radar-events.php',
    'docs/fat-radar/fat-radar-events-enriched-2026-07-24.json',
    '--owner-email-env=FAT_RADAR_SEED_OWNER_EMAIL',
    '--preview=admin',
    '--geocode',
    '--qa-report=docs/fat-radar/fat-radar-geocoding-qa-2026-07-24.json',
  ]);
  prepare([
    'bin/publish-radar-import-local.php',
    'docs/fat-radar/fat-radar-events-enriched-2026-07-24.json',
    '--source-report=docs/fat-radar/fat-radar-events-enriched-2026-07-24.report.json',
    '--geocode-report=docs/fat-radar/fat-radar-geocoding-qa-2026-07-24.json',
    '--report=docs/fat-radar/fat-radar-local-publication-qa-2026-07-24.json',
  ]);
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

function watch(page, label) {
  const errors = [];
  const external = [];
  const basemap = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label} page: ${error.message}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'data.geopf.fr') {
      basemap.push(url.href);
      return;
    }
    if (
      url.origin !== base
      && !url.href.startsWith('data:')
      && !url.href.startsWith('blob:')
      && url.hostname !== 'challenges.cloudflare.com'
    ) external.push(url.href);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.hostname !== 'data.geopf.fr') {
      errors.push(`${label} HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return { errors, external, basemap };
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
  await desktop.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  const launch = desktop.locator('[data-radar-launch-notice]:visible');
  await launch.waitFor();
  assert.equal(await launch.getAttribute('role'), 'dialog');
  assert.equal(await launch.getAttribute('aria-modal'), 'true');
  assert.equal(await desktop.evaluate(() => localStorage.getItem('fat.radar.launch-notice.v1')), 'seen');
  assert.equal(await launch.locator('[data-radar-launch-primary]').evaluate((node) => node === document.activeElement), true);
  await desktop.screenshot({ path: join(output, 'radar-launch-desktop.png'), fullPage: false });
  await desktop.keyboard.press('Shift+Tab');
  assert.equal(await launch.locator('[data-radar-launch-close]').evaluate((node) => node === document.activeElement), true);
  await desktop.keyboard.press('Tab');
  assert.equal(await launch.locator('[data-radar-launch-primary]').evaluate((node) => node === document.activeElement), true);
  await desktop.keyboard.press('Escape');
  await launch.waitFor({ state: 'hidden' });
  const repeatNotice = await desktopContext.newPage();
  await repeatNotice.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  assert.equal(await repeatNotice.locator('[data-radar-launch-notice]:visible').count(), 0);
  await repeatNotice.close();
  assert.equal(await desktop.locator('h1').textContent(), 'Parties d’airsoft en France : trouvez votre prochaine partie');
  assert.equal(await desktop.locator('.radar-event-card').count(), expectedEventCount);
  assert.ok(await desktop.locator('.radar-marker-shell, .marker-cluster').count() > 0);
  assert.equal(await desktop.locator('.radar-city-marker').count(), 11);
  await desktop.locator('[data-radar-app].has-live-basemap').waitFor();
  assert.ok(desktopWatch.basemap.length > 0);
  await desktop.evaluate(() => {
    const app = document.querySelector('[data-radar-app]');
    window.__radarBasemapVisibility = [];
    new MutationObserver(() => {
      window.__radarBasemapVisibility.push(app.classList.contains('has-live-basemap'));
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
  });
  assert.match(
    await desktop.locator('.radar-map .leaflet-tile-pane').evaluate((node) => getComputedStyle(node).filter),
    /invert\(0\.82\).*hue-rotate\(180deg\).*brightness\(0\.95\)/,
  );
  assert.equal(await desktop.locator('.radar-city-marker:visible').count(), 0);
  assert.equal(await desktop.locator('.radar-city-marker[aria-hidden="true"]').count(), 11);
  assert.equal(await desktop.locator('.radar-city-marker[tabindex="-1"]').count(), 11);
  await desktop.locator('.leaflet-control-zoom-in').evaluate((node) => node.click());
  await desktop.waitForTimeout(400);
  await desktop.locator('.leaflet-control-zoom-in').evaluate((node) => node.click());
  await desktop.locator('[data-radar-app][data-cities-visible="false"]').waitFor();
  assert.equal(await desktop.locator('.radar-city-marker:visible').count(), 0);
  await desktop.locator('.leaflet-control-zoom-out').evaluate((node) => node.click());
  await desktop.locator('[data-radar-app][data-cities-visible="true"]').waitFor();
  assert.equal(await desktop.locator('.radar-city-marker:visible').count(), 0);
  assert.equal(
    await desktop.evaluate(() => window.__radarBasemapVisibility.includes(false)),
    false,
  );
  const publicPayload = await desktop.evaluate(async () => (await fetch('/api/v1/radar/events')).json());
  assert.equal(JSON.stringify(publicPayload).includes('Adresse privée'), false);
  const approximate = publicPayload.events.find((event) => event.locationVisibility === 'approximate');
  assert.equal(approximate.positionApproximate, true);
  assert.equal(typeof approximate.latitude, 'number');
  assert.equal(typeof approximate.longitude, 'number');
  assert.ok(await desktop.locator('.radar-marker-shell.is-approximate').count() > 0);
  assert.match(publicPayload.events[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(publicPayload.events.every(
    (event) => event.toiletsAvailable === null || typeof event.toiletsAvailable === 'boolean',
  ), true);
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
  assert.match(desktop.url(), /\/parties-airsoft\/[a-z0-9-]+\//);
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
  await desktop.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  await desktop.locator('label', { hasText: 'CO₂' }).click();
  await desktop.locator('[data-radar-count]').filter({ hasText: '0 PARTIE' }).waitFor();
  await desktop.locator('[data-radar-filters]').evaluate((form) => form.reset());
  await desktop.locator('[name="location"]').fill('Ouézy');
  await desktop.locator('[data-radar-count]').filter({ hasText: /^1 PARTIE$/ }).waitFor();
  assert.equal(await desktop.locator('.radar-event-card').count(), 1);
  await desktop.locator('[data-radar-filters]').evaluate((form) => form.reset());
  await desktop.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  await desktop.setViewportSize({ width: 1280, height: 900 });
  await desktop.locator('#radar-map').waitFor();
  const resizedMap = await desktop.locator('#radar-map').boundingBox();
  assert.ok(resizedMap.width > 700 && resizedMap.height > 600, JSON.stringify(resizedMap));

  const deepContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const deep = await deepContext.newPage();
  const deepWatch = watch(deep, 'deep');
  await deep.goto(`${base}${publicPayload.events[0].publicUrl}`, { waitUntil: 'networkidle' });
  await deep.locator('[data-radar-briefing]:visible').waitFor();
  assert.equal(await deep.locator('[data-radar-launch-notice]:visible').count(), 0);
  assert.equal(await deep.evaluate(() => localStorage.getItem('fat.radar.launch-notice.v1')), null);
  assert.equal(await deep.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow');
  assert.match(await deep.locator('.radar-briefing-facts').textContent(), /SECTEUR.*MISE À JOUR/s);
  assert.deepEqual(deepWatch.external, []);
  assert.deepEqual(deepWatch.errors, []);
  await deepContext.close();
  assert.deepEqual(desktopWatch.external, []);
  assert.deepEqual(desktopWatch.errors, []);

  const rad = (value) => value * Math.PI / 180;
  const distance = (from, to) => {
    const deltaLat = rad(to.latitude - from.latitude);
    const deltaLon = rad(to.longitude - from.longitude);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const locatedEvents = publicPayload.events.filter(
    (event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude),
  );
  const geoAnchor = locatedEvents.find((candidate) => {
    const at10 = locatedEvents.filter((event) => distance(candidate, event) <= 10).length;
    const at100 = locatedEvents.filter((event) => distance(candidate, event) <= 100).length;
    return at100 > at10;
  }) || locatedEvents[0];
  const expectedAt = (radiusKm) => locatedEvents.filter((event) => distance(geoAnchor, event) <= radiusKm).length;
  const geoContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    permissions: ['geolocation'],
    geolocation: { latitude: geoAnchor.latitude, longitude: geoAnchor.longitude, accuracy: 12 },
  });
  await geoContext.addInitScript(() => {
    localStorage.setItem('fat.radar.launch-notice.v1', 'seen');
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    window.__radarGeoCalls = 0;
    navigator.geolocation.getCurrentPosition = (...args) => {
      window.__radarGeoCalls += 1;
      return original(...args);
    };
  });
  const geoPage = await geoContext.newPage();
  const geoWatch = watch(geoPage, 'geolocation');
  await geoPage.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  await geoPage.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  await geoPage.locator('.radar-filter-console details > summary').click();
  await geoPage.locator('[name="radiusKm"]').selectOption('10');
  await geoPage.locator('[data-radar-geolocate]:visible').click();
  await geoPage.locator(`[data-radar-app][data-radar-filtered-count="${expectedAt(10)}"]`).waitFor();
  assert.equal(await geoPage.locator('.radar-event-card').count(), expectedAt(10));
  assert.equal(Number(await geoPage.locator('[data-radar-app]').getAttribute('data-radar-marker-count')), expectedAt(10));
  await geoPage.locator('[name="radiusKm"]').selectOption('100');
  await geoPage.locator(`[data-radar-app][data-radar-filtered-count="${expectedAt(100)}"]`).waitFor();
  assert.equal(await geoPage.locator('.radar-event-card').count(), expectedAt(100));
  assert.equal(Number(await geoPage.locator('[data-radar-app]').getAttribute('data-radar-marker-count')), expectedAt(100));
  assert.ok(expectedAt(100) > expectedAt(10), `${expectedAt(10)} → ${expectedAt(100)}`);
  await geoPage.locator('[data-radar-geolocate]:visible').click();
  assert.equal(await geoPage.evaluate(() => window.__radarGeoCalls), 1);
  await geoPage.getByRole('button', { name: 'RÉINITIALISER' }).click();
  await geoPage.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  assert.match(await geoPage.locator('[data-radar-geolocation]').textContent(), /jamais enregistrée/);
  assert.deepEqual(geoWatch.external, []);
  assert.deepEqual(geoWatch.errors, []);
  await geoContext.close();

  const deniedContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await deniedContext.addInitScript(() => {
    localStorage.setItem('fat.radar.launch-notice.v1', 'seen');
    navigator.geolocation.getCurrentPosition = (_success, failure) => {
      queueMicrotask(() => failure({ code: 1, message: 'Permission denied by Playwright' }));
    };
  });
  const denied = await deniedContext.newPage();
  const deniedWatch = watch(denied, 'geolocation-denied');
  await denied.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  await denied.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  await denied.locator('.radar-filter-console details > summary').click();
  await denied.locator('[data-radar-geolocate]:visible').click();
  await denied.locator('[data-radar-status]').filter({ hasText: /refusée/ }).waitFor();
  assert.equal(await denied.locator('.radar-event-card').count(), expectedEventCount);
  assert.match(await denied.locator('[data-radar-geolocation]').textContent(), /jamais enregistrée/);
  assert.deepEqual(deniedWatch.external, []);
  assert.deepEqual(deniedWatch.errors, []);
  await deniedContext.close();

  const offlineContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  await offlineContext.addInitScript(() => localStorage.setItem('fat.radar.launch-notice.v1', 'seen'));
  const offline = await offlineContext.newPage();
  await offline.goto(`${base}/parties-airsoft/`, { waitUntil: 'networkidle' });
  await offline.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) location.reload();
  });
  await offline.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await offline.waitForFunction(async () => {
    const cache = await caches.open('fat-v3-2026-07-24-55');
    return Boolean(
      await cache.match('/parties-airsoft/')
      && await cache.match('/assets/radar.css?v=20260724-54')
      && await cache.match('/assets/js/radar/radar-map.js?v=20260724-54'),
    );
  });
  await offlineContext.setOffline(true);
  await offline.goto(`${base}/parties-airsoft/`, { waitUntil: 'domcontentloaded' });
  await offline.locator('h1').filter({ hasText: 'Parties d’airsoft en France' }).waitFor();
  assert.equal(await offline.evaluate(() => navigator.serviceWorker.controller !== null), true);
  const hasCachedBasemap = await offline.locator('[data-radar-app].has-live-basemap').count();
  if (hasCachedBasemap) {
    assert.ok(await offline.locator('.radar-map .leaflet-tile-loaded').count() > 0);
  } else {
    await offline.locator('.radar-city-marker').first().waitFor();
    assert.equal(await offline.locator('.radar-city-marker:visible').count(), 11);
  }
  assert.equal(await offline.locator('.radar-city-marker').count(), 11);
  await offlineContext.setOffline(false);
  await offlineContext.close();

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
  await mobile.locator('[data-radar-count]').filter({ hasText: expectedEventLabel }).waitFor();
  const mobileLaunch = mobile.locator('[data-radar-launch-notice]:visible');
  await mobileLaunch.waitFor();
  const launchMetrics = await mobileLaunch.evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    viewport: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    primaryHeight: node.querySelector('[data-radar-launch-primary]').getBoundingClientRect().height,
  }));
  assert.ok(launchMetrics.width <= launchMetrics.viewport, JSON.stringify(launchMetrics));
  assert.ok(launchMetrics.pageWidth <= launchMetrics.viewport, JSON.stringify(launchMetrics));
  assert.ok(launchMetrics.primaryHeight >= 44, JSON.stringify(launchMetrics));
  await mobile.screenshot({ path: join(output, 'radar-launch-mobile-390.png'), fullPage: false });
  await mobileLaunch.locator('[data-radar-launch-close]').click();
  await mobileLaunch.waitFor({ state: 'hidden' });
  assert.equal(await mobile.locator('.radar-event-card').count(), expectedEventCount);
  const previewMetrics = await mobile.locator('.radar-map-stage').evaluate((stage) => {
    const map = stage.querySelector('#radar-map');
    const list = document.querySelector('.radar-list-panel');
    return {
      mode: map.dataset.radarInteraction,
      touchAction: getComputedStyle(map).touchAction,
      height: stage.getBoundingClientRect().height,
      viewportHeight: innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      listOverflow: getComputedStyle(list).overflowY,
    };
  });
  assert.equal(previewMetrics.mode, 'preview');
  assert.equal(previewMetrics.touchAction, 'pan-y');
  assert.ok(previewMetrics.height >= 240 && previewMetrics.height <= previewMetrics.viewportHeight * .46 + 1, JSON.stringify(previewMetrics));
  assert.ok(previewMetrics.pageWidth <= 390, JSON.stringify(previewMetrics));
  assert.equal(previewMetrics.listOverflow, 'visible');
  const mobileGeolocation = await mobile.locator('.radar-mobile-geolocate:visible').boundingBox();
  assert.ok(mobileGeolocation?.height >= 44, JSON.stringify(mobileGeolocation));
  await mobile.getByRole('button', { name: 'FILTRES' }).click();
  await mobile.locator('[data-radar-app].is-filter-sheet-open').waitFor();
  assert.equal(await mobile.locator('[data-radar-filters]').getAttribute('role'), 'dialog');
  assert.equal(await mobile.locator('[data-radar-filters]').getAttribute('aria-hidden'), 'false');
  const mobileRadius = await mobile.locator('[data-radar-mobile-radius]:visible').boundingBox();
  assert.ok(mobileRadius?.height >= 44, JSON.stringify(mobileRadius));
  await mobile.screenshot({ path: join(output, 'radar-mobile-filters.png'), fullPage: false });
  await mobile.keyboard.press('Escape');
  await mobile.locator('[data-radar-app]:not(.is-filter-sheet-open)').waitFor();
  assert.equal(await mobile.getByRole('button', { name: 'FILTRES' }).getAttribute('aria-expanded'), 'false');
  await mobile.screenshot({ path: join(output, 'radar-mobile.png'), fullPage: false });
  await mobile.locator('[data-radar-fullscreen-open]').click();
  const fullscreenMap = mobile.locator('.radar-map-stage.is-fullscreen');
  await fullscreenMap.waitFor();
  const fullscreenMetrics = await fullscreenMap.evaluate((stage) => {
    const box = stage.getBoundingClientRect();
    const map = stage.querySelector('#radar-map');
    const close = stage.querySelector('[data-radar-fullscreen-close]').getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      mode: map.dataset.radarInteraction,
      touchAction: getComputedStyle(map).touchAction,
      bodyLocked: document.body.classList.contains('has-radar-fullscreen'),
      closeHeight: close.height,
    };
  });
  assert.deepEqual(fullscreenMetrics, {
    width: 390,
    height: 844,
    mode: 'fullscreen',
    touchAction: 'none',
    bodyLocked: true,
    closeHeight: 44,
  });
  await mobile.screenshot({ path: join(output, 'radar-mobile-fullscreen.png'), fullPage: false });
  await mobile.locator('[data-radar-fullscreen-close]').click();
  await fullscreenMap.waitFor({ state: 'hidden' });
  assert.equal(await mobile.evaluate(() => document.body.classList.contains('has-radar-fullscreen')), false);
  await mobile.locator('.radar-event-open').first().click();
  const mobileBriefing = mobile.locator('[data-radar-briefing]:visible');
  await mobileBriefing.waitFor();
  const box = await mobileBriefing.boundingBox();
  assert.ok(box.width >= 389 && box.height >= 843, JSON.stringify(box));
  await mobile.screenshot({ path: join(output, 'radar-mobile-briefing.png'), fullPage: false });
  await mobile.keyboard.press('Escape');
  await mobile.setViewportSize({ width: 430, height: 932 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: join(output, 'radar-mobile-430.png'), fullPage: false });
  for (const [width, height] of [[320, 568], [360, 640], [375, 667]]) {
    await mobile.setViewportSize({ width, height });
    await mobile.evaluate(() => window.scrollTo(0, 0));
    await mobile.waitForTimeout(250);
    const tiny = await mobile.locator('[data-radar-app]').evaluate((app) => {
      const stage = app.querySelector('.radar-map-stage').getBoundingClientRect();
      const hero = document.querySelector('.radar-hero').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        pageWidth: document.documentElement.scrollWidth,
        headerHeight: header.height,
        heroHeight: hero.height,
        mapTop: stage.top,
        mapHeight: stage.height,
      };
    });
    assert.deepEqual(tiny.viewport, [width, height]);
    assert.ok(tiny.pageWidth <= width, JSON.stringify(tiny));
    assert.ok(tiny.headerHeight <= 60, JSON.stringify(tiny));
    assert.ok(tiny.heroHeight <= height * .5, JSON.stringify(tiny));
    assert.ok(tiny.mapTop < height - 64, JSON.stringify(tiny));
    assert.ok(tiny.mapHeight >= 216 && tiny.mapHeight <= height * .46 + 1, JSON.stringify(tiny));
    await mobile.screenshot({ path: join(output, `radar-mobile-${width}x${height}.png`), fullPage: false });
  }
  await mobile.setViewportSize({ width: 320, height: 568 });
  await mobile.locator('[data-radar-filter-open]').click();
  const tinySheet = await mobile.locator('[data-radar-filters]').evaluate((sheet) => ({
    height: sheet.getBoundingClientRect().height,
    closeHeight: sheet.querySelector('[data-radar-filter-close]').getBoundingClientRect().height,
  }));
  assert.ok(tinySheet.height <= 568 && tinySheet.closeHeight >= 44, JSON.stringify(tinySheet));
  await mobile.locator('[data-radar-filter-close]').click();
  await mobile.locator('[data-radar-fullscreen-open]').click();
  const tinyFullscreen = await mobile.locator('.radar-map-stage.is-fullscreen').evaluate((stage) => ({
    width: stage.getBoundingClientRect().width,
    height: stage.getBoundingClientRect().height,
    footer: getComputedStyle(stage.querySelector('.radar-fullscreen-footer')).display,
    closeHeight: stage.querySelector('[data-radar-fullscreen-close]').getBoundingClientRect().height,
  }));
  assert.deepEqual(tinyFullscreen, {
    width: 320,
    height: 568,
    footer: 'none',
    closeHeight: 44,
  });
  await mobile.screenshot({ path: join(output, 'radar-mobile-fullscreen-320x568.png'), fullPage: false });
  await mobile.locator('[data-radar-fullscreen-close]').click();
  await mobile.locator('.radar-event-open').first().click();
  const tinyBriefing = await mobile.locator('[data-radar-briefing]:visible').boundingBox();
  assert.ok(tinyBriefing.width >= 319 && tinyBriefing.height >= 567, JSON.stringify(tinyBriefing));
  await mobile.screenshot({ path: join(output, 'radar-mobile-briefing-320x568.png'), fullPage: false });
  await mobile.keyboard.press('Escape');
  assert.ok(mobileWatch.basemap.length > 0);
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
  assert.equal(await owner.locator('.radar-owner-card').count(), expectedEventCount);
  assert.equal(await owner.locator('.radar-owner-card-source').count(), expectedEventCount);
  await owner.locator('[data-admin-workbench]:visible').waitFor();
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
  assert.equal(await owner.locator('.radar-owner-card').count(), expectedEventCount + 1);
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
  await owner.locator('[name="toiletsAvailable"]').selectOption('no');
  assert.equal(await owner.locator('[name="toiletsAvailable"]').inputValue(), 'no');
  await owner.locator('[data-editor-close]').click();
  const adminFilters = owner.locator('[data-admin-filters]');
  await adminFilters.locator('[name="sourceTier"]').selectOption('primary');
  await adminFilters.locator('[name="verification"]').selectOption('verified');
  await adminFilters.getByRole('button', { name: 'FILTRER' }).click();
  await owner.locator('[data-admin-count]').filter({ hasText: expectedPrimaryLabel }).waitFor();
  assert.equal(await owner.locator('.radar-admin-card').count(), expectedPrimaryCount);
  assert.equal(await owner.locator('[data-admin-edit]').count(), expectedPrimaryCount);
  assert.equal(await owner.locator('[data-admin-delete]').count(), expectedPrimaryCount);
  const moderatedTitle = await owner.locator('.radar-admin-card h3').first().textContent();
  await owner.locator('[data-admin-edit]').first().click();
  await owner.locator('[data-owner-editor]:visible').waitFor();
  assert.equal(
    (await owner.locator('[data-editor-title]').textContent()).trim(),
    `MODÉRATION · ${moderatedTitle.trim()}`,
  );
  await owner.locator('[data-editor-close]').click();
  await owner.locator('[data-admin-count]').filter({ hasText: expectedPrimaryLabel }).waitFor();
  await adminFilters.locator('[name="sourceTier"]').selectOption('');
  await adminFilters.locator('[name="verification"]').selectOption('');
  await adminFilters.locator('[name="fixtures"]').selectOption('only');
  await adminFilters.getByRole('button', { name: 'FILTRER' }).click();
  await owner.locator('[data-admin-count]').filter({ hasText: /^0 FICHE/ }).waitFor();
  assert.equal(await owner.locator('.radar-admin-card').count(), 0);
  assert.deepEqual(ownerWatch.external, []);
  assert.deepEqual(ownerWatch.errors, []);
  await ownerContext.close();
  await desktopContext.close();

  console.log(`Radar navigateur: villes zoom 6/7/8, popup, rayon ${expectedAt(10)} → ${expectedAt(100)}, refus de position, desktop, aperçu tactile, filtres, plein écran, briefing, confidentialité et espace organisateur validés.`);
  console.log(`Captures: ${join(output, 'radar-launch-desktop.png')}, ${join(output, 'radar-desktop.png')}, ${join(output, 'radar-launch-mobile-390.png')}, ${join(output, 'radar-mobile.png')}, ${join(output, 'radar-mobile-filters.png')}, ${join(output, 'radar-mobile-fullscreen.png')}, ${join(output, 'radar-mobile-430.png')}, ${join(output, 'radar-mobile-briefing.png')}, ${join(output, 'radar-owner-list.png')}, ${join(output, 'radar-owner-editor.png')}`);
} finally {
  await browser.close();
}
