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
const browserFixture = JSON.stringify(COMMUNITY_FIXTURE).replaceAll('<', '\\u003c');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (() => {
    const fixture = ${browserFixture};
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const callsKey = '__fatCommunityApiCalls';
    globalThis.fetch = async (input, init = {}) => {
      const requestUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (!requestUrl.pathname.startsWith('/api/v1/') || sessionStorage.getItem('__fatDisableCommunityApi') === '1') {
        return nativeFetch(input, init);
      }
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const headers = Object.fromEntries(new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).entries());
      const calls = JSON.parse(sessionStorage.getItem(callsKey) || '[]');
      calls.push({ path: requestUrl.pathname + requestUrl.search, method, headers });
      sessionStorage.setItem(callsKey, JSON.stringify(calls));
      let status = 200;
      let payload = { ok: true };
      if (requestUrl.pathname.endsWith('/session') && method === 'GET') {
        payload = location.pathname.endsWith('/armurerie.html')
          ? fixture.session
          : { authenticated: false, csrfToken: 'browser-csrf' };
      } else if (requestUrl.pathname.endsWith('/session') && method === 'POST') {
        payload = fixture.session;
      } else if (requestUrl.pathname.endsWith('/accounts') && method === 'POST') {
        payload = { created: true, csrfToken: 'browser-csrf' };
      } else if (/\\/replicas\\?/.test(requestUrl.pathname + requestUrl.search)) {
        payload = { replicas: sessionStorage.getItem('__fatCommunityReplicaMode') === 'empty' ? [] : fixture.replicas };
      } else if (/\\/replicas\\/[^/]+\\/archive$/.test(requestUrl.pathname)) {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-2));
        payload = { replica: { ...fixture.replicas.find((replica) => replica.id === id), state: 'archived' } };
      } else if (/\\/replicas\\/[^/]+\\/background-removal$/.test(requestUrl.pathname)) {
        const id = decodeURIComponent(requestUrl.pathname.split('/').at(-2));
        payload = { replica: { ...fixture.replicas.find((replica) => replica.id === id), imageStatus: 'queued' } };
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
await evaluate(`document.querySelector('[data-account-tab="login"]').click()`);

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
const csrfLogin = apiCalls.find((call) => call.path.endsWith('/session') && call.method === 'POST');
if (!csrfLogin || csrfLogin.headers['x-csrf-token'] !== 'browser-csrf') throw new Error(`Login CSRF missing ${JSON.stringify(csrfLogin)}`);

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
const cache = await evaluate(`Promise.all([caches.open('fat-v3-2026-07-18-25').then(cache=>cache.match('/assets/js/replica-card.js')).then(Boolean),caches.match('/api/v1/session').then(Boolean)]).then(([component,api])=>({component,api}))`, true);
if (!cache.component || cache.api) throw new Error(`Private cache mismatch ${JSON.stringify(cache)}`);

await evaluate(`sessionStorage.setItem('__fatDisableCommunityApi','1')`);
const offlineErrorStart = consoleErrors.length;
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await navigate(`${base}compte/armurerie.html?recipe=offline`);
await waitFor(`document.querySelector('[data-armory-state]')?.dataset.tone === 'error'`);
const offline = await evaluate(`({title:document.title,cards:document.querySelectorAll('replica-card').length,message:document.querySelector('[data-armory-state]').textContent})`);
if (offline.cards || !offline.message.includes('Impossible')) throw new Error(`Offline private state mismatch ${JSON.stringify(offline)}`);
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
  cache,
  offline,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('lot56-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
