import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { COMMUNITY_FIXTURE } from './fixtures/community.fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9342);
const base = process.env.FAT_BASE_URL || 'http://127.0.0.1:8092/';

function requestJson(method, pathname) {
  return new Promise((resolveRequest, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: pathname }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolveRequest(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

const target = await requestJson('PUT', `/json/new?${encodeURIComponent('about:blank')}`);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveSocket, reject) => {
  socket.addEventListener('open', resolveSocket, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
const pending = new Map();
const listeners = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  return new Promise((resolveCommand, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve: resolveCommand, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    consoleErrors.push([message.params.entry.text, message.params.entry.url].filter(Boolean).join(' — '));
  }
  const queue = listeners.get(message.method);
  if (queue?.length) queue.shift()(message.params);
});

function once(method) {
  return new Promise((resolveEvent) => {
    const queue = listeners.get(method) || [];
    queue.push(resolveEvent);
    listeners.set(method, queue);
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
}

async function navigate(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
}

const wait = (duration) => new Promise((resolveWait) => setTimeout(resolveWait, duration));
async function waitFor(expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timeout: ${expression}`);
}

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile });
}

async function setTheme(value) {
  await evaluate(`document.querySelector('input[name="fat-theme"][value="${value}"]').click()`);
  await wait(80);
}

async function capture(name, clip) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const screenshot = await send('Page.captureScreenshot', params);
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
const browserFixtureData = structuredClone(COMMUNITY_FIXTURE);
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  for (const replica of browserFixtureData.replicas) {
    if (replica.photoUrl) replica.photoUrl = '/assets/img/quentin-guirois.webp';
  }
}
const browserFixture = JSON.stringify(browserFixtureData).replaceAll('<', '\\u003c');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (() => {
    const fixture = ${browserFixture};
    const savedTrajectories = fixture.replicas.slice(0, 2).map((replica, index) => ({
      id: '10000000-0000-4000-8000-00000000000' + (index + 1),
      name: 'Courbe enregistrée ' + (index + 1),
      simUrl: replica.simUrl,
      massG: replica.massG,
      energyJ: replica.energyJ,
      usefulRangeM: replica.usefulRangeM,
      maximumRangeM: replica.maximumRangeM,
      curveThumbSvg: replica.curveThumbSvg,
      createdAt: '2026-07-18 10:00:00',
    }));
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const callsKey = '__fatCommunityApiCalls';
    let widgetSequence = 0;
    const turnstileWidgets = new Map();
    globalThis.turnstile = {
      render(container, options) {
        const id = ++widgetSequence;
        const widget = { options, token: 'browser-' + options.action + '-' + id };
        turnstileWidgets.set(id, widget);
        queueMicrotask(() => options.callback(widget.token));
        return id;
      },
      getResponse(id) { return turnstileWidgets.get(id)?.token || ''; },
      reset(id) {
        const widget = turnstileWidgets.get(id);
        if (!widget) return;
        widget.token = 'browser-' + widget.options.action + '-' + id + '-' + Date.now();
        queueMicrotask(() => widget.options.callback(widget.token));
      },
      remove(id) { turnstileWidgets.delete(id); },
    };
    globalThis.fetch = async (input, init = {}) => {
      const requestUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (!requestUrl.pathname.startsWith('/api/v1/')) {
        return nativeFetch(input, init);
      }
      if (sessionStorage.getItem('__fatForceCommunityApiFailure') === '1') {
        throw new TypeError('Failed to fetch');
      }
      if (sessionStorage.getItem('__fatDisableCommunityApi') === '1') return nativeFetch(input, init);
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).entries());
      const requestBody = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      const calls = JSON.parse(sessionStorage.getItem(callsKey) || '[]');
      calls.push({ path: requestUrl.pathname + requestUrl.search, method, headers, turnstile: Boolean(requestBody?.turnstileToken) });
      sessionStorage.setItem(callsKey, JSON.stringify(calls));
      let status = 200;
      let payload = { ok: true };
      if (requestUrl.pathname.endsWith('/auth/turnstile-config') && method === 'GET') {
        payload = { turnstile: { enabled: true, siteKey: '1x00000000000000000000AA', registrationEnabled: true } };
      } else if (requestUrl.pathname.endsWith('/me') && method === 'GET') {
        const armorySession = sessionStorage.getItem('__fatCommunityAdmin') === '1'
          ? { ...fixture.session, user: { ...fixture.session.user, role: 'admin' } }
          : fixture.session;
        payload = location.pathname.endsWith('/armurerie.html')
          ? armorySession
          : { authenticated: false, csrfToken: 'browser-csrf' };
      } else if (requestUrl.pathname.endsWith('/auth/login') && method === 'POST') {
        if (!requestBody?.turnstileToken?.startsWith('browser-login-')) {
          status = 422;
          payload = { code: 'turnstile_invalid', message: 'Contrôle anti-robot invalide.' };
        } else payload = fixture.session;
      } else if (requestUrl.pathname.endsWith('/auth/register') && method === 'POST') {
        if (!requestBody?.turnstileToken?.startsWith('browser-register-')) {
          status = 422;
          payload = { code: 'turnstile_invalid', message: 'Contrôle anti-robot invalide.' };
        } else payload = { created: true, csrfToken: 'browser-csrf' };
      } else if (requestUrl.pathname.endsWith('/auth/verify-email') && method === 'POST') {
        payload = requestBody?.token === 'browser-verification-token'
          ? { verified: true }
          : { code: 'invalid_token', message: 'Lien invalide.' };
        if (!payload.verified) status = 422;
      } else if (requestUrl.pathname.endsWith('/admin/replicas/published') && method === 'GET') {
        payload = { replicas: fixture.replicas.filter((replica) => replica.state === 'published') };
      } else if (requestUrl.pathname.endsWith('/admin/replicas') && method === 'GET') {
        payload = { replicas: fixture.replicas.filter((replica) => replica.state === 'pending').map((replica) => ({ ...replica, imageStatus: 'ready', photoUrl: '/tests/fixtures/replica-side.fixture.webp' })) };
      } else if (/\\/admin\\/replicas\\/[^/]+\\/publish$/.test(requestUrl.pathname) && method === 'POST') {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-2));
        payload = { id, state: 'published' };
      } else if (/\\/admin\\/replicas\\/[^/]+\\/reject$/.test(requestUrl.pathname) && method === 'POST') {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-2));
        if (!requestBody?.note || requestBody.note.trim().length < 3) {
          status = 422;
          payload = { code: 'validation', message: 'Le motif de rejet est obligatoire.' };
        } else payload = { id, state: 'rejected' };
      } else if (/\\/admin\\/replicas\\/[^/]+$/.test(requestUrl.pathname) && method === 'PATCH') {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-1));
        payload = { replica: { ...fixture.replicas.find((replica) => replica.id === id), ...requestBody, state: 'pending', version: 2 } };
      } else if (/\\/admin\\/replicas\\/[^/]+$/.test(requestUrl.pathname) && method === 'DELETE') {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-1));
        payload = { replica: { ...fixture.replicas.find((replica) => replica.id === id), state: 'archived', version: 2 } };
      } else if (requestUrl.pathname.endsWith('/trajectories') && method === 'GET') {
        payload = { trajectories: sessionStorage.getItem('__fatCommunityTrajectoryMode') === 'empty' ? [] : savedTrajectories };
      } else if (requestUrl.pathname.endsWith('/trajectories') && method === 'POST') {
        payload = { trajectory: { id: '10000000-0000-4000-8000-000000000099', ...requestBody, simUrl: requestBody.simulationUrl } };
        status = 201;
      } else if (/\\/trajectories\\/[^/]+$/.test(requestUrl.pathname) && method === 'DELETE') {
        payload = null;
        status = 204;
      } else if (requestUrl.pathname.endsWith('/public/replicas') && method === 'GET') {
        payload = { replicas: fixture.replicas.filter((replica) => replica.state === 'published' && replica.imageStatus === 'ready') };
      } else if (/\\/replicas\\?/.test(requestUrl.pathname + requestUrl.search)) {
        payload = { replicas: sessionStorage.getItem('__fatCommunityReplicaMode') === 'empty' ? [] : fixture.replicas };
      } else if (/\\/replicas\\/[^/]+$/.test(requestUrl.pathname) && method === 'DELETE') {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-1));
        payload = { replica: { ...fixture.replicas.find((replica) => replica.id === id), state: 'archived' } };
      } else {
        status = 404;
        payload = { code: 'not_found', message: 'Fixture API absente.' };
      }
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    };
  })();
` });
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });

await setViewport(1440, 900);
await navigate(`${base}compte/`);
await waitFor(`document.querySelectorAll('[data-account-tab]').length === 2 && document.querySelectorAll('input[name="fat-theme"]').length === 3`);
await evaluate(`localStorage.setItem('fat-theme','dark')`);
await navigate(`${base}compte/?recipe=desktop`);
await waitFor(`document.documentElement.dataset.theme === 'dark'`);
const login = await evaluate(`({robots:document.querySelector('meta[name="robots"]').content,oauthHidden:document.querySelector('[data-oauth-unavailable]').hidden,accountKeys:Object.keys(localStorage).filter(key=>/account/i.test(key)),overflow:document.documentElement.scrollWidth>innerWidth})`);
if (!login.robots.includes('noindex') || !login.oauthHidden || login.accountKeys.length || login.overflow) throw new Error(`Login shell mismatch ${JSON.stringify(login)}`);
await capture('lot56-login-desktop-night.png');
await setTheme('light');
await capture('lot56-login-desktop-day.png');

await evaluate(`document.querySelector('[data-account-tab="login"]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await waitFor(`!document.querySelector('[data-account-form="register"]').hidden`);
await evaluate(`(()=>{const form=document.querySelector('[data-account-form="register"]');form.querySelector('[name="pseudo"]').value='NouvelleRecrue';form.querySelector('[name="email"]').value='recrue@example.test';form.querySelector('[name="password"]').value='MotDePasseRecrue123';form.querySelector('[name="legalAccepted"]').checked=true;form.requestSubmit()})()`);
await waitFor(`location.pathname === '/compte/verifier-email.html'`);
const emailConfirmation = await evaluate(`({robots:document.querySelector('meta[name="robots"]').content,title:document.querySelector('h1').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
if (!emailConfirmation.robots.includes('noindex') || !/Vérifie ton email/.test(emailConfirmation.title) || emailConfirmation.overflow) throw new Error(`Email confirmation mismatch ${JSON.stringify(emailConfirmation)}`);
await navigate(`${base}compte/#verify=browser-verification-token`);
await waitFor(`location.pathname === '/compte/compte-active.html'`);
const accountActive = await evaluate(`({robots:document.querySelector('meta[name="robots"]').content,title:document.querySelector('h1').textContent,login:document.querySelector('a[href="/compte/"]')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
if (!accountActive.robots.includes('noindex') || !/compte est activé/.test(accountActive.title) || !accountActive.login || accountActive.overflow) throw new Error(`Account activation mismatch ${JSON.stringify(accountActive)}`);
await navigate(`${base}compte/?recipe=desktop`);
await waitFor(`document.querySelectorAll('[data-account-tab]').length === 2`);

await setViewport(390, 844, true);
await setTheme('dark');
const loginMobile = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,targets:[...document.querySelectorAll('button,input:not(.theme-switcher input),a')].filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect().height)})`);
if (loginMobile.scrollWidth > loginMobile.width || loginMobile.targets.some((height) => height < 43.5)) throw new Error(`Login mobile mismatch ${JSON.stringify(loginMobile)}`);
await capture('lot56-login-mobile-night.png');
await setTheme('light');
await capture('lot56-login-mobile-day.png');

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'light' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
const loginReduced = await evaluate(`getComputedStyle(document.querySelector('.account-tracer')).display`);
if (loginReduced !== 'none') throw new Error(`Login reduced motion mismatch: ${loginReduced}`);
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });

await navigate(`${base}tu-joues-avec-quoi/`);
await waitFor(`document.querySelectorAll('replica-card').length === 1`);
await setViewport(1440, 900);
await setTheme('dark');
const publicGallery = await evaluate(`(()=>{const header=document.querySelector('.replica-card-header');const pseudo=header?.firstElementChild;const pseudoStyle=pseudo?getComputedStyle(pseudo):null;return {cards:document.querySelectorAll('replica-card').length,state:document.querySelector('.replica-card-shell')?.dataset.state,cta:document.querySelector('[data-add-replica-link]').getAttribute('href'),robots:document.querySelector('meta[name="robots"]').content,overflow:document.documentElement.scrollWidth>innerWidth,pseudo:pseudo?.textContent,pseudoWeight:pseudoStyle?.fontWeight,pseudoAccent:pseudoStyle?.borderLeftWidth,youtube:header?.querySelector('.replica-youtube')?.textContent,youtubeHref:header?.querySelector('.replica-youtube')?.href}})()`);
if (publicGallery.cards !== 1 || publicGallery.state !== 'published' || !publicGallery.cta.startsWith('/compte/?return=') || !publicGallery.robots.includes('index') || publicGallery.overflow || publicGallery.pseudo !== 'OPÉRATEUR FIXTURE' || Number(publicGallery.pseudoWeight) < 700 || publicGallery.pseudoAccent !== '3px' || publicGallery.youtube !== '▶ CHAÎNE YOUTUBE' || !publicGallery.youtubeHref.includes('youtube.com/@fixture')) throw new Error(`Public gallery mismatch ${JSON.stringify(publicGallery)}`);
await capture('community-gallery-desktop-night.png');
await setTheme('light');
await capture('community-gallery-desktop-day.png');
await setViewport(390, 844, true);
const publicGalleryMobile = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,cta:document.querySelector('[data-add-replica-link]').getBoundingClientRect().height})`);
if (publicGalleryMobile.scroll > publicGalleryMobile.width || publicGalleryMobile.cta < 43.5) throw new Error(`Public gallery mobile mismatch ${JSON.stringify(publicGalleryMobile)}`);
await capture('community-gallery-mobile-day.png');
await navigate(`${base}compte/?recipe=login-after-gallery`);
await waitFor(`document.querySelectorAll('[data-account-tab]').length === 2`);

await evaluate(`(()=>{const form=document.querySelector('[data-account-form="login"]');form.querySelector('[name="identity"]').value='fixture@example.test';form.querySelector('[name="password"]').value='mot-de-passe-fixture';form.requestSubmit()})()`);
try {
  await waitFor(`location.pathname === '/compte/armurerie.html'`);
} catch (error) {
  const loginFailure = await evaluate(`({path:location.pathname,status:document.querySelector('[data-account-status]')?.textContent,busy:document.querySelector('[data-account-root]')?.getAttribute('aria-busy')})`);
  const calls = await evaluate(`JSON.parse(sessionStorage.getItem('__fatCommunityApiCalls') || '[]')`);
  throw new Error(`${error.message}; login=${JSON.stringify(loginFailure)}; calls=${JSON.stringify(calls)}`);
}
await waitFor(`document.querySelectorAll('replica-card').length === ${COMMUNITY_FIXTURE.replicas.length}`);
const apiCalls = await evaluate(`JSON.parse(sessionStorage.getItem('__fatCommunityApiCalls') || '[]')`);
const csrfLogin = apiCalls.find((call) => call.path.endsWith('/auth/login') && call.method === 'POST');
if (!csrfLogin || csrfLogin.headers['x-csrf-token'] !== 'browser-csrf' || !csrfLogin.turnstile) throw new Error(`Login CSRF/Turnstile missing ${JSON.stringify(csrfLogin)}`);

await setViewport(1440, 1000);
await setTheme('dark');
await wait(120);
const armory = await evaluate(`({states:[...document.querySelectorAll('.replica-card-shell')].map(card=>card.dataset.state),imageStates:[...document.querySelectorAll('.replica-card-shell')].map(card=>card.dataset.imageStatus),summary:document.querySelector('[data-armory-summary]').textContent,overflow:document.documentElement.scrollWidth>innerWidth})`);
for (const state of ['draft','pending','published','rejected','archived']) if (!armory.states.includes(state)) throw new Error(`Missing state ${state}`);
for (const state of ['queued','processing','ready','rejected','failed']) if (!armory.imageStates.includes(state)) throw new Error(`Missing image state ${state}`);
if (armory.overflow) throw new Error(`Armory desktop overflow ${JSON.stringify(armory)}`);
await capture('lot56-armory-desktop-night.png');
await evaluate(`(()=>{const card=document.querySelector('replica-card');const data=card.data;card.removeAttribute('mode');card.data=data})()`);
await wait(80);
const publicCardRect = await evaluate(`(()=>{const r=document.querySelector('replica-card').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:Math.min(r.height,innerHeight-r.y)}})()`);
await capture('lot56-replica-card-night.png', publicCardRect);
await setTheme('light');
await capture('lot56-replica-card-day.png', publicCardRect);
await evaluate(`(()=>{const card=document.querySelector('replica-card');const data=card.data;card.setAttribute('mode','management');card.data=data})()`);
await evaluate(`document.querySelector('replica-card [data-card-slide="curve"]').click()`);
await wait(550);
if (!await evaluate(`document.querySelector('replica-card .replica-card-track').classList.contains('show-curve')`)) throw new Error('Curve slide did not open');
await capture('lot56-armory-desktop-day.png');

await evaluate(`document.querySelector('.armory-title-row [data-add-replica]').click()`);
await waitFor(`document.querySelector('[data-replica-dialog]').open && document.querySelectorAll('#replica-trajectory option').length === 3`);
const trajectoryLink = await evaluate(`document.querySelector('label[for="replica-trajectory"] a') && ({text:document.querySelector('label[for="replica-trajectory"] a').textContent,target:document.querySelector('label[for="replica-trajectory"] a').target,href:document.querySelector('label[for="replica-trajectory"] a').getAttribute('href'),options:document.querySelectorAll('#replica-trajectory option').length})`);
if (!trajectoryLink || trajectoryLink.target !== '_blank' || trajectoryLink.href !== '/#tutoriel-calculateur' || !trajectoryLink.text.includes('VOIR LE TUTORIEL')) throw new Error(`Trajectory tutorial link mismatch ${JSON.stringify(trajectoryLink)}`);
if (trajectoryLink.options !== 3) throw new Error(`Saved trajectory options mismatch ${JSON.stringify(trajectoryLink)}`);
await evaluate(`document.querySelector('[data-cancel-replica]').click()`);

await evaluate(`sessionStorage.setItem('__fatCommunityAdmin','1')`);
await navigate(`${base}compte/armurerie.html?recipe=admin`);
await waitFor(`!document.querySelector('[data-admin-armory]').hidden`);
await evaluate(`document.querySelector('[data-admin-armory]').click()`);
await waitFor(`document.querySelectorAll('replica-card').length === 1 && document.querySelector('.armory-title-row h1').textContent === 'Cards publiées'`);
const adminArmory = await evaluate(`({cards:document.querySelectorAll('replica-card').length,admin:document.querySelector('replica-card').hasAttribute('admin'),remove:document.querySelector('replica-card .replica-archive')?.textContent.trim(),edit:Boolean(document.querySelector('replica-card .replica-edit')),addHidden:document.querySelector('.armory-title-row [data-add-replica]').hidden})`);
if (adminArmory.cards !== 1 || !adminArmory.admin || adminArmory.remove !== 'RETIRER' || !adminArmory.edit || !adminArmory.addHidden) throw new Error(`Admin armory mismatch ${JSON.stringify(adminArmory)}`);
await evaluate(`document.querySelector('replica-card .replica-edit').click()`);
await waitFor(`document.querySelector('[data-replica-dialog]').open`);
if (!await evaluate(`document.querySelector('[data-replica-form] [name="photo"]').disabled`)) throw new Error('Admin photo field must stay disabled');
await evaluate(`document.querySelector('[data-cancel-replica]').click()`);
await evaluate(`document.querySelector('[data-admin-moderation]').click()`);
await waitFor(`document.querySelectorAll('replica-card').length === 1 && document.querySelector('replica-card').hasAttribute('moderation')`);
const moderationArmory = await evaluate(`({title:document.querySelector('.armory-title-row h1').textContent,publish:document.querySelector('replica-card .replica-publish')?.textContent.trim(),reject:document.querySelector('replica-card .replica-reject')?.textContent.trim(),curveTarget:document.querySelector('replica-card .replica-card-actions a')?.target})`);
if (moderationArmory.title !== 'Modération' || moderationArmory.publish !== 'PUBLIER' || moderationArmory.reject !== 'REJETER' || moderationArmory.curveTarget !== '_blank') throw new Error(`Moderation armory mismatch ${JSON.stringify(moderationArmory)}`);
await evaluate(`document.querySelector('replica-card .replica-publish').click()`);
await waitFor(`document.querySelectorAll('replica-card').length === 0 && document.querySelector('.armory-empty')`);
await evaluate(`document.querySelector('[data-admin-moderation]').click()`);
await waitFor(`document.querySelectorAll('replica-card').length === 1`);
await evaluate(`document.querySelector('replica-card .replica-reject').click()`);
await waitFor(`document.querySelector('[data-reject-dialog]').open && document.activeElement === document.querySelector('[data-reject-form] [name="note"]')`);
await evaluate(`(()=>{const form=document.querySelector('[data-reject-form]');form.note.value='Photo trop sombre et cadrage à reprendre.';form.requestSubmit()})()`);
await waitFor(`document.querySelectorAll('replica-card').length === 0 && !document.querySelector('[data-reject-dialog]').open`);
const moderationCalls = await evaluate(`JSON.parse(sessionStorage.getItem('__fatCommunityApiCalls') || '[]').filter(call=>/\\/admin\\/replicas\\/[^/]+\\/(publish|reject)$/.test(call.path))`);
if (moderationCalls.length !== 2 || moderationCalls.some((call) => call.headers['x-csrf-token'] !== 'fixture-csrf')) throw new Error(`Moderation CSRF mismatch ${JSON.stringify(moderationCalls)}`);
await evaluate(`sessionStorage.removeItem('__fatCommunityAdmin')`);
await navigate(`${base}compte/armurerie.html?recipe=personal-after-admin`);
await waitFor(`document.querySelectorAll('replica-card').length === ${COMMUNITY_FIXTURE.replicas.length}`);

await evaluate(`document.querySelector('replica-card [data-card-slide="replica"]').click()`);
await evaluate(`(()=>{const media=document.querySelector('replica-card .replica-card-media');media.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:320}));media.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:100}))})()`);
if (!await evaluate(`document.querySelector('replica-card .replica-card-track').classList.contains('show-curve')`)) throw new Error('Swipe did not open the curve');

await evaluate(`document.querySelector('replica-card .replica-archive').click()`);
await waitFor(`document.querySelector('[data-archive-dialog]').open`);
const dialogState = await evaluate(`({focus:document.activeElement===document.querySelector('[data-cancel-archive]'),copy:document.querySelector('[data-archive-dialog]').textContent.includes('restaurable')})`);
if (!dialogState.focus || !dialogState.copy) throw new Error(`Archive dialog mismatch ${JSON.stringify(dialogState)}`);
await evaluate(`document.querySelector('[data-confirm-archive]').click()`);
await waitFor(`document.querySelector('replica-card .replica-card-shell').dataset.state === 'archived'`);

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
const reduced = await evaluate(`({loginTracer:${JSON.stringify('none')},track:getComputedStyle(document.querySelector('.replica-card-track')).transitionDuration})`);
if (reduced.track !== '0s') throw new Error(`Reduced motion mismatch ${JSON.stringify(reduced)}`);

await setViewport(390, 844, true);
await setTheme('dark');
await wait(100);
const mobile = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,grid:getComputedStyle(document.querySelector('[data-armory-grid]')).gridTemplateColumns,small:[...document.querySelectorAll('button,a,summary')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<43.5).map(node=>node.textContent.trim())})`);
if (mobile.scrollWidth > mobile.width || mobile.small.length) throw new Error(`Armory mobile mismatch ${JSON.stringify(mobile)}`);
await capture('lot56-armory-mobile-night.png');
await setTheme('light');
await capture('lot56-armory-mobile-day.png');

await evaluate(`sessionStorage.setItem('__fatCommunityTrajectoryMode','empty')`);
await navigate(`${base}compte/armurerie.html?action=add`);
try {
  await waitFor(`Boolean(document.querySelector('[data-calculator-tutorial]:not([hidden])'))`);
} catch (error) {
  const redirectFailure = await evaluate(`({path:location.pathname,search:location.search,hash:location.hash,mode:sessionStorage.getItem('__fatCommunityTrajectoryMode'),status:document.querySelector('[data-armory-state]')?.textContent,trajectories:window.__unused})`);
  throw new Error(`${error.message}; redirect=${JSON.stringify(redirectFailure)}`);
}
const noTrajectoryRedirect = await evaluate(`({path:location.pathname,hash:location.hash,tutorial:Boolean(document.querySelector('[data-calculator-tutorial]:not([hidden])'))})`);
await evaluate(`sessionStorage.removeItem('__fatCommunityTrajectoryMode')`);

await evaluate(`sessionStorage.setItem('__fatCommunityReplicaMode','empty')`);
await navigate(`${base}compte/armurerie.html?recipe=empty`);
await waitFor(`Boolean(document.querySelector('.armory-empty'))`);
const emptyState = await evaluate(`({cards:document.querySelectorAll('replica-card').length,copy:document.querySelector('.armory-empty').textContent})`);
if (emptyState.cards || !emptyState.copy.includes('Râtelier vide')) throw new Error(`Armory empty mismatch ${JSON.stringify(emptyState)}`);

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await navigate(base);
await evaluate(`navigator.serviceWorker.ready.then(()=>true)`, true);
await navigate(`${base}compte/armurerie.html?recipe=sw`);
await waitFor(`Boolean(navigator.serviceWorker.controller)`);
const cache = await evaluate(`Promise.all([caches.open('fat-v3-2026-07-18-43').then(cache=>cache.match('/assets/js/replica-card.js?v=20260718-43')).then(Boolean),caches.match('/api/v1/me').then(Boolean)]).then(([component,api])=>({component,api}))`, true);
if (!cache.component || cache.api) throw new Error(`Private cache mismatch ${JSON.stringify(cache)}`);

await evaluate(`sessionStorage.setItem('__fatDisableCommunityApi','1')`);
await evaluate(`sessionStorage.setItem('__fatForceCommunityApiFailure','1')`);
const offlineErrorStart = consoleErrors.length;
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await navigate(`${base}compte/armurerie.html?recipe=offline`);
await waitFor(`document.querySelector('[data-armory-state]')?.dataset.tone === 'error'`);
const offline = await evaluate(`({title:document.title,cards:document.querySelectorAll('replica-card').length,message:document.querySelector('[data-armory-state]').textContent})`);
if (offline.cards || !offline.message.includes('Impossible')) throw new Error(`Offline private state mismatch ${JSON.stringify(offline)}`);
await navigate(`${base}tu-joues-avec-quoi/?recipe=offline`);
await waitFor(`document.querySelector('[data-community-status]')?.dataset.tone === 'error'`);
const offlinePublic = await evaluate(`({title:document.title,message:document.querySelector('[data-community-status]').textContent,shell:Boolean(document.querySelector('[data-community-gallery]'))})`);
if (!offlinePublic.shell || !offlinePublic.message.includes('Impossible')) throw new Error(`Offline public shell mismatch ${JSON.stringify(offlinePublic)}`);
consoleErrors.splice(offlineErrorStart);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

const result = {
  login,
  loginMobile: { width: loginMobile.width, scrollWidth: loginMobile.scrollWidth },
  armory,
  csrfLogin: true,
  slider: true,
  swipe: true,
  archive: dialogState,
  reduced,
  mobile,
  emptyState,
  adminArmory,
  moderationArmory,
  publicGallery,
  publicGalleryMobile,
  noTrajectoryRedirect,
  savedTrajectoryOptions: trajectoryLink.options,
  cache,
  offline,
  offlinePublic,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('lot56-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
