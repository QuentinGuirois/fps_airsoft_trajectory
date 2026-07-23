import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9337);
const base = process.env.FAT_BASE_URL || 'http://127.0.0.1:8080/';

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

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
    else handler.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((argument) => argument.value || argument.description).join(' '));
  }
  const queue = listeners.get(message.method);
  if (queue?.length) queue.shift()(message.params);
});

function send(method, params = {}) {
  return new Promise((resolveCommand, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve: resolveCommand, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function once(method) {
  return new Promise((resolveEvent) => {
    const queue = listeners.get(method) || [];
    queue.push(resolveEvent);
    listeners.set(method, queue);
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
}

async function navigate(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
}

const wait = (duration) => new Promise((resolveWait) => setTimeout(resolveWait, duration));

async function waitFor(expression, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timeout: ${expression}`);
}

async function capture(name, clip = null) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const screenshot = await send('Page.captureScreenshot', params);
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function captureHeader(name) {
  const rect = await evaluate(`(()=>{const r=document.querySelector('.site-header').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  await capture(name, rect);
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
});
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });

await navigate(`${base}?visual-lot1=1`);
await evaluate('document.fonts.ready', true);
await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
const initial = await evaluate(`(()=>{const account=document.querySelector('.account-access');const rect=account.getBoundingClientRect();return{theme:document.documentElement.dataset.theme,mode:document.documentElement.dataset.themeMode||null,controls:document.querySelectorAll('input[name="fat-theme"]').length,themeColor:document.querySelector('meta[name="theme-color"]').content,account:{label:account.textContent.trim(),href:account.pathname,height:rect.height}}})()`);
if (initial.theme !== 'dark' || initial.mode !== null || initial.controls !== 0 || initial.themeColor !== '#10140c' || initial.account.label !== 'Mon compte' || initial.account.href !== '/compte/' || initial.account.height < 43.5) {
  throw new Error(`Initial theme mismatch ${JSON.stringify(initial)}`);
}
await captureHeader('lot1-header-night.png');

await evaluate(`import('/calculation-loader.js').then(m=>{window.__lot1Loader=m.createCalculationLoader({element:document.querySelector('[data-calculation-loader]'),busyTarget:document.querySelector('[data-trajectory-app]')});window.__lot1Loader.start(9001,{initial:true})})`, true);
await wait(360);
const loaderPending = await evaluate(`window.__lot1Loader.getState()`);
if (!loaderPending.visible || loaderPending.progress > 99) throw new Error(`Loader pending mismatch ${JSON.stringify(loaderPending)}`);
await capture('lot1-loader-night.png');
const completed = await evaluate(`(()=>{window.__lot1Loader.complete(9001);return window.__lot1Loader.getState().progress})()`);
if (completed !== 100) throw new Error('Loader did not reach 100 on response');
await wait(50);

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'light' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
await evaluate(`(()=>{window.__lot1Loader.destroy();return import('/calculation-loader.js').then(m=>{window.__lot1Loader=m.createCalculationLoader({element:document.querySelector('[data-calculation-loader]'),busyTarget:document.querySelector('[data-trajectory-app]')});window.__lot1Loader.start(9002,{initial:true})})})()`, true);
await wait(360);
const reducedBefore = await evaluate(`({phrase:document.querySelector('[data-loader-phrase]').textContent,ball:getComputedStyle(document.querySelector('.calculation-loader-ball')).animationName,curve:getComputedStyle(document.querySelector('.loader-curve-active')).animationName})`);
await wait(1600);
const reducedAfter = await evaluate(`document.querySelector('[data-loader-phrase]').textContent`);
if (reducedBefore.phrase !== reducedAfter || reducedBefore.ball !== 'none' || reducedBefore.curve !== 'none') {
  throw new Error(`Reduced motion mismatch ${JSON.stringify({ reducedBefore, reducedAfter })}`);
}
await evaluate(`window.__lot1Loader.complete(9002)`);
await wait(50);
await evaluate(`window.__lot1Loader.start(9003)`);
if (await evaluate(`document.querySelector('[data-calculation-loader]').dataset.mode`) !== 'compact') {
  throw new Error('Compact loader mode missing after first success');
}
await evaluate(`window.__lot1Loader.fail(9003,'Test terminé')`);

await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true,
});
await navigate(`${base}?visual-lot1=mobile`);
const mobile = await evaluate(`({innerWidth,scrollWidth:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,themeControls:document.querySelectorAll('input[name="fat-theme"]').length})`);
if (mobile.innerWidth !== 390 || mobile.scrollWidth > mobile.innerWidth || mobile.theme !== 'dark' || mobile.themeControls !== 0) throw new Error(`Mobile overflow ${JSON.stringify(mobile)}`);
const mobileAccount = await evaluate(`(()=>{const account=document.querySelector('.account-access');const rect=account.getBoundingClientRect();return{href:account.pathname,label:account.getAttribute('aria-label'),width:rect.width,height:rect.height,visible:Boolean(account.getClientRects().length)}})()`);
if (!mobileAccount.visible || mobileAccount.href !== '/compte/' || mobileAccount.label !== 'Mon compte' || mobileAccount.width < 43.5 || mobileAccount.height < 43.5) throw new Error(`Mobile account action missing ${JSON.stringify(mobileAccount)}`);
const mobileInstall = await evaluate(`(()=>{const button=document.querySelector('.nav-install');const style=getComputedStyle(button);const rect=button.getBoundingClientRect();return{hidden:button.hidden,display:style.display,height:rect.height,mode:button.dataset.installMode}})()`);
if (mobileInstall.hidden || mobileInstall.display === 'none' || mobileInstall.height < 43.5) throw new Error(`Mobile install action missing ${JSON.stringify(mobileInstall)}`);
if (mobileInstall.mode === 'instructions') {
  await evaluate(`document.querySelector('.nav-install').click()`);
  await wait(200);
  const installGuide = await evaluate(`(()=>{const guide=document.querySelector('[data-install-guide]');const mode=document.querySelector('.nav-install').dataset.installMode;return{nativePrompt:mode==='prompt',visible:Boolean(guide&&!guide.hidden),title:guide?.querySelector('#pwa-install-title')?.textContent||'',steps:guide?.querySelectorAll('[data-install-steps] li').length||0,focus:Boolean(document.activeElement?.matches('.pwa-install-panel [data-install-close]'))}})()`);
  if (!installGuide.nativePrompt && (!installGuide.visible || !installGuide.title.includes('Installer') || installGuide.steps !== 3 || !installGuide.focus)) throw new Error(`Install guide mismatch ${JSON.stringify(installGuide)}`);
  if (installGuide.visible) await evaluate(`document.querySelector('.pwa-install-panel [data-install-close]').click()`);
}

const resources = await evaluate(`Promise.all(['/assets/site.css','/theme.js','/calculation-loader.js','/assets/fonts/saira-latin-400-900.woff2','/assets/img/icon-maskable-512.png'].map(async u=>[u,(await fetch(u)).status]))`, true);
if (resources.some(([, status]) => status !== 200)) throw new Error(`HTTP resources ${JSON.stringify(resources)}`);
const manifest = await send('Page.getAppManifest');
if (manifest.errors?.length || !manifest.data || !manifest.url.endsWith('/manifest.webmanifest')) throw new Error(`PWA manifest: ${JSON.stringify(manifest)}`);

await evaluate(`navigator.serviceWorker.ready.then(()=>true)`, true);
await navigate(`${base}?visual-lot1=sw-control`);
await waitFor(`Boolean(navigator.serviceWorker.controller)`);
const cache = await evaluate(`caches.keys().then(keys=>({keys,controller:Boolean(navigator.serviceWorker.controller)}))`, true);
if (!cache.keys.includes('fat-v3-2026-07-23-47') || !cache.controller) throw new Error(`PWA cache mismatch ${JSON.stringify(cache)}`);
await navigate(`${base}simulateur-trajectoire-airsoft/`);
await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/`);
await waitFor(`document.documentElement.dataset.gasPressureReady === 'true'`);
await send('Network.emulateNetworkConditions', {
  offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
});
const offlinePages = [];
for (const path of ['?visual-lot1=offline', 'simulateur-trajectoire-airsoft/', 'outils/choisir-gaz-airsoft-pression-temperature/']) {
  await navigate(`${base}${path}`);
  offlinePages.push({ path, title: await evaluate('document.title') });
}
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
});
if (!offlinePages[0].title.includes('Calculateur Airsoft') || !offlinePages[1].title.includes('Simulateur') || !offlinePages[2].title.includes('gaz airsoft')) throw new Error(`Offline reload failed: ${JSON.stringify(offlinePages)}`);

const result = {
  initial,
  loaderPending,
  reducedMotion: reducedBefore,
  mobile,
  mobileAccount,
  resources,
  manifest: { url: manifest.url, errors: manifest.errors?.length || 0 },
  cache,
  offlinePages,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('lot1-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
