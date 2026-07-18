import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9341);
const base = process.env.FAT_BASE_URL || 'http://127.0.0.1:8080/';
const advancedUrl = new URL('/simulateur-3d-airsoft/', base).href;
const lazyPaths = [
  '/drone-3d.js',
  '/assets/vendor/three-r185/build/three.module.min.js',
  '/assets/vendor/three-r185/build/three.core.min.js',
  '/assets/vendor/three-r185/examples/jsm/controls/OrbitControls.js',
];

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
const requests = [];
const runtimeErrors = [];

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
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
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
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text || 'Evaluation failed'}: ${result.exceptionDetails.exception?.description || ''}`);
  return result.result.value;
}

async function navigate(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, new Promise((_, reject) => setTimeout(() => reject(new Error(`Navigation timeout: ${url}`)), 15000))]);
}

const wait = (duration) => new Promise((resolveWait) => setTimeout(resolveWait, duration));
async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timeout: ${expression}`);
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1,
    mobile: width <= 768,
  });
}

async function setMedia(theme = 'dark', motion = 'no-preference') {
  await send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: theme },
    { name: 'prefers-reduced-motion', value: motion },
  ] });
}

async function capture(name) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function waitForScene() {
  await waitFor(`Boolean(document.querySelector('[data-advanced-drone-host] canvas') && document.querySelector('[data-advanced-3d-app]')?.dataset.ready === 'true')`);
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `if(location.search.includes('no-webgl')){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).startsWith('webgl')?null:original.call(this,type,...args)}}`,
});

await setViewport(1440, 900);
await setMedia('dark');
console.log('[advanced] home sans actifs 3D');
requests.length = 0;
await navigate(base);
await waitFor(`Boolean(document.querySelector('[data-advanced-entry]'))`);
const homeLazy = requests.filter((url) => lazyPaths.some((path) => url.includes(path)));
if (homeLazy.length) throw new Error(`Actifs 3D chargés sur la home: ${JSON.stringify(homeLazy)}`);

console.log('[advanced] navigation directe sans transition produit');
requests.length = 0;
await navigate(`${advancedUrl}?m=0.36&j=1.90&rpm=100000&z=40&w=12&wd=90&t=10&p=1000&a=0&c=0`);
const direct = await evaluate(`({hidden:document.querySelector('[data-advanced-transition]').hidden,mass:document.querySelector('[data-advanced-field="massG"]').value,energy:document.querySelector('[data-advanced-field="energyJ"]').value,rpm:document.querySelector('[data-advanced-field="initialRpm"]').value})`);
if (!direct.hidden || direct.mass !== '0.36' || direct.energy !== '1.9' || direct.rpm !== '100000') throw new Error(`Navigation directe/URL: ${JSON.stringify(direct)}`);
await waitForScene();
const dedicatedRequests = [...new Set(requests.filter((url) => lazyPaths.some((path) => url.includes(path))).map((url) => new URL(url).pathname))];
for (const path of lazyPaths) if (!dedicatedRequests.includes(path)) throw new Error(`Actif 3D dédié absent: ${path}`);

console.log('[advanced] partage, stockage, reset et URL historique');
await evaluate(`(()=>{window.__advancedShare=null;window.__advancedCopied='';Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__advancedShare=payload}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__advancedCopied=value}}});document.querySelector('[data-advanced-share]').click()})()`);
await waitFor(`Boolean(window.__advancedCopied)`);
const shared = await evaluate(`({native:window.__advancedShare,label:document.querySelector('[data-advanced-share]').textContent,url:window.__advancedCopied,params:Object.fromEntries(new URL(window.__advancedCopied).searchParams),field:document.querySelector('[data-advanced-share-url]').value})`);
if (shared.native !== null || shared.label !== 'Copier le lien' || shared.params.m !== '0.36' || shared.params.rpm !== '100000' || shared.params.wd !== '90' || shared.field !== shared.url) throw new Error(`Partage avancé desktop: ${JSON.stringify(shared)}`);
const storedPrevious = await evaluate(`document.querySelector('[data-advanced-3d-app]').dataset.lastRequestId`);
await evaluate(`(()=>{const input=document.querySelector('[data-advanced-field="massG"]');input.value='0.43';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`document.querySelector('[data-advanced-3d-app]').dataset.lastRequestId !== '${storedPrevious}'`);
const storedMass = await evaluate(`JSON.parse(localStorage.getItem('fat-shot-v3')).massG`);
if (storedMass !== 0.43) throw new Error(`Stockage avancé: ${storedMass}`);
await evaluate(`document.querySelector('[data-advanced-reset]').click()`);
await waitFor(`document.querySelector('[data-advanced-field="massG"]').value === '0.28'`);
await navigate(`${advancedUrl}?m=0.25&j=1&h=55&z=30`);
await waitForScene();
const legacy = await evaluate(`({mass:document.querySelector('[data-advanced-field="massG"]').value,rpm:Number(document.querySelector('[data-advanced-field="initialRpm"]').value),zero:document.querySelector('[data-advanced-field="zeroDistanceM"]').value})`);
if (legacy.mass !== '0.25' || !(legacy.rpm > 0) || legacy.zero !== '30') throw new Error(`URL historique: ${JSON.stringify(legacy)}`);

console.log('[advanced] transition explicite de cinq secondes');
await navigate(base);
const loading = once('Page.loadEventFired');
await evaluate(`document.querySelector('[data-advanced-entry]').click()`);
await loading;
await waitFor(`document.querySelector('[data-advanced-transition]').hidden === false`);
await wait(4300);
const beforeFive = await evaluate(`({visible:!document.querySelector('[data-advanced-transition]').hidden,value:Number(document.querySelector('[data-advanced-loader-progress]').getAttribute('aria-valuenow'))})`);
if (!beforeFive.visible || beforeFive.value >= 100) throw new Error(`Transition écourtée: ${JSON.stringify(beforeFive)}`);
await capture('advanced-3d-loader-dark.png');
await waitFor(`document.querySelector('[data-advanced-transition]').hidden === true`, 3000);
await waitForScene();

console.log('[advanced] passage du loader');
await navigate(base);
const skipLoaded = once('Page.loadEventFired');
await evaluate(`document.querySelector('[data-advanced-entry]').click()`);
await skipLoaded;
await waitFor(`document.querySelector('[data-advanced-transition]').hidden === false`);
await evaluate(`document.querySelector('[data-advanced-loader-skip]').click()`);
await waitFor(`document.querySelector('[data-advanced-transition]').hidden === true`);
await waitForScene();

console.log('[advanced] caméras, zoom et pause');
for (const camera of ['drone', 'shooter', 'profile']) {
  await evaluate(`document.querySelector('[data-advanced-camera="${camera}"]').click()`);
  await wait(380);
  const state = await evaluate(`document.querySelector('[data-advanced-drone-host]').dataset.camera`);
  if (state !== camera) throw new Error(`Caméra inactive: ${camera}`);
  await capture(`advanced-3d-camera-${camera}-dark.png`);
}
const renderBeforeZoom = await evaluate(`Number(document.querySelector('[data-advanced-drone-host]').dataset.renderCount)`);
await evaluate(`document.querySelector('[data-advanced-zoom="0.8"]').click();document.querySelector('[data-advanced-pause]').click()`);
await waitFor(`document.querySelector('[data-advanced-drone-host]').dataset.rendering === 'paused'`);
await evaluate(`document.querySelector('[data-advanced-pause]').click()`);
await waitFor(`document.querySelector('[data-advanced-drone-host]').dataset.rendering === 'active'`);
const renderAfterZoom = await evaluate(`Number(document.querySelector('[data-advanced-drone-host]').dataset.renderCount)`);
if (renderAfterZoom <= renderBeforeZoom) throw new Error('Zoom sans redessin');

console.log('[advanced] une active et trois comparaisons sans calcul de navigation');
await evaluate(`(()=>{window.__advancedPosts=0;const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){window.__advancedPosts++;return original.apply(this,args)}})()`);
for (const mass of ['0.25', '0.30', '0.40']) {
  const previous = await evaluate(`document.querySelector('[data-advanced-3d-app]').dataset.lastRequestId`);
  await evaluate(`(()=>{const input=document.querySelector('[data-advanced-field="massG"]');input.value='${mass}';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor(`document.querySelector('[data-advanced-3d-app]').dataset.lastRequestId !== '${previous}'`);
  await evaluate(`document.querySelector('[data-advanced-compare]').click()`);
}
await waitFor(`document.querySelector('[data-advanced-drone-host]').dataset.seriesCount === '4'`);
const postsBeforeUi = await evaluate(`window.__advancedPosts`);
await evaluate(`(()=>{document.querySelector('[data-advanced-camera="drone"]').click();document.querySelector('input[name="fat-theme"][value="light"]').click();document.querySelector('[data-select-series="2"]').click();document.querySelector('[data-remove-series="1"]').click()})()`);
await waitFor(`document.querySelector('[data-advanced-drone-host]').dataset.seriesCount === '3'`);
const compareState = await evaluate(`({posts:window.__advancedPosts,count:document.querySelector('[data-advanced-3d-app]').dataset.seriesCount,hostCount:document.querySelector('[data-advanced-drone-host]').dataset.seriesCount,legend:document.querySelectorAll('[data-advanced-legend] li').length,selected:document.querySelector('[data-advanced-3d-app]').dataset.selectedSeriesRequestId,theme:document.documentElement.dataset.theme})`);
if (compareState.posts !== postsBeforeUi || compareState.count !== '3' || compareState.hostCount !== '3' || compareState.legend !== 3 || !compareState.selected || compareState.theme !== 'light') throw new Error(`Comparaisons: ${JSON.stringify(compareState)}`);
await capture('advanced-3d-comparisons-light.png');

console.log('[advanced] WebGL absent et import cassé');
requests.length = 0;
await navigate(`${advancedUrl}?no-webgl=1`);
await waitFor(`document.querySelector('[data-advanced-3d-app]').dataset.ready === 'error'`);
const noWebgl = await evaluate(`({webgl:document.querySelector('[data-advanced-3d-app]').dataset.webgl,fallback:!document.querySelector('[data-advanced-fallback]').hidden,canvas:Boolean(document.querySelector('[data-advanced-drone-host] canvas'))})`);
if (noWebgl.webgl !== 'unavailable' || !noWebgl.fallback || noWebgl.canvas) throw new Error(`Fallback WebGL: ${JSON.stringify(noWebgl)}`);
if (requests.some((url) => lazyPaths.some((path) => url.includes(path)))) throw new Error('Le module 3D a été demandé sans WebGL');
await send('Network.setBlockedURLs', { urls: ['*drone-3d.js*'] });
await navigate(`${advancedUrl}?module-fail=1`);
await waitFor(`document.querySelector('[data-advanced-3d-app]').dataset.ready === 'error'`);
const moduleFallback = await evaluate(`({fallback:!document.querySelector('[data-advanced-fallback]').hidden,message:document.querySelector('[data-advanced-fallback-message]').textContent,canvas:Boolean(document.querySelector('[data-advanced-drone-host] canvas'))})`);
if (!moduleFallback.fallback || moduleFallback.canvas || !moduleFallback.message.includes('module 3D')) throw new Error(`Fallback module: ${JSON.stringify(moduleFallback)}`);
await send('Network.setBlockedURLs', { urls: [] });

console.log('[advanced] responsive nuit/jour');
const formats = [
  [1440, 900, 'desktop'], [1024, 768, 'laptop'], [768, 1024, 'tablet-portrait'],
  [1024, 768, 'tablet-landscape'], [390, 844, 'phone-portrait'], [844, 390, 'phone-landscape'], [359, 640, 'narrow'],
];
for (const [width, height, label] of formats) {
  for (const theme of ['dark', 'light']) {
    const touch = label.includes('tablet') || label.includes('phone') || label === 'narrow';
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
    await setViewport(width, height);
    await setMedia(theme);
    await evaluate(`localStorage.setItem('fat-theme','${theme}');sessionStorage.removeItem('fat-advanced-mobile-dismissed')`);
    await navigate(`${advancedUrl}?responsive=${label}-${theme}`);
    await waitForScene();
    const layout = await evaluate(`(()=>{const root=document.querySelector('[data-advanced-3d-app]');const scene=document.querySelector('[data-advanced-drone-host]').getBoundingClientRect();const buttons=[...root.querySelectorAll('button')].filter(item=>item.offsetParent!==null);return{theme:document.documentElement.dataset.theme,viewport:[innerWidth,innerHeight],scene:[scene.width,scene.height],scroll:document.documentElement.scrollWidth,small:buttons.filter(item=>item.getBoundingClientRect().height<43.5).map(item=>item.textContent.trim()),notice:!document.querySelector('[data-advanced-mobile-notice]').hidden,portrait:matchMedia('(orientation: portrait)').matches,coarse:matchMedia('(pointer: coarse)').matches}})()`);
    if (layout.theme !== theme || layout.scroll > layout.viewport[0] + 1 || layout.scene[0] > layout.viewport[0] + 1 || layout.small.length) throw new Error(`Responsive ${label}: ${JSON.stringify(layout)}`);
    if (label === 'phone-portrait' && (!layout.coarse || !layout.notice)) throw new Error(`Conseil portrait absent: ${JSON.stringify(layout)}`);
    if (label.startsWith('tablet') && layout.notice) throw new Error(`Conseil tablette indu: ${JSON.stringify(layout)}`);
    if (theme === 'dark' || label === 'desktop') await capture(`advanced-3d-${label}-${theme}.png`);
  }
}
await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });

console.log('[advanced] reduced motion et clavier/zoom 200%');
await setViewport(390, 844);
await setMedia('dark', 'reduce');
await navigate(base);
const reducedLoaded = once('Page.loadEventFired');
await evaluate(`document.querySelector('[data-advanced-entry]').click()`);
await reducedLoaded;
await waitForScene();
const reduced = await evaluate(`({loader:document.querySelector('[data-advanced-transition]').hidden,motion:document.querySelector('[data-advanced-drone-host]').dataset.reducedMotion,playback:document.querySelector('[data-advanced-drone-host]').dataset.playback})`);
if (!reduced.loader || reduced.motion !== 'true' || reduced.playback !== 'idle') throw new Error(`Reduced motion: ${JSON.stringify(reduced)}`);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
await evaluate(`document.querySelector('[data-advanced-mobile-continue]')?.click();document.querySelector('[data-advanced-camera="drone"]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' });
const accessible = await evaluate(`({focus:document.activeElement?.tagName,scroll:document.documentElement.scrollWidth,width:innerWidth,name:document.querySelector('[data-advanced-drone-host] canvas').getAttribute('aria-label')})`);
if (!['BUTTON', 'A', 'SUMMARY'].includes(accessible.focus) || accessible.scroll > accessible.width + 1 || !accessible.name) throw new Error(`Clavier/zoom: ${JSON.stringify(accessible)}`);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

console.log('[advanced] PWA hors ligne après visite');
await setViewport(1024, 768);
await setMedia('dark');
await navigate(advancedUrl);
await waitForScene();
await evaluate(`navigator.serviceWorker.ready.then(()=>true)`, true);
await waitFor(`navigator.serviceWorker.controller !== null`);
await wait(800);
const cached = await evaluate(`Promise.all(${JSON.stringify(lazyPaths)}.map(async path=>Boolean(await (await caches.open('fat-v3-2026-07-18-31')).match(path.endsWith('three.core.min.js')?path:path+'?v=20260718-28'))))`, true);
if (cached.some((value) => !value)) throw new Error(`Cache 3D incomplet: ${JSON.stringify(cached)}`);
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
await navigate(`${advancedUrl}?offline=1`);
await waitForScene();
const offline = await evaluate(`({canvas:Boolean(document.querySelector('[data-advanced-drone-host] canvas')),controller:Boolean(navigator.serviceWorker.controller),points:document.querySelector('[data-advanced-drone-host]').dataset.pointCount})`);
if (!offline.canvas || !offline.controller || !offline.points) throw new Error(`Hors ligne: ${JSON.stringify(offline)}`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });

if (runtimeErrors.length) throw new Error(`Erreurs runtime: ${JSON.stringify(runtimeErrors)}`);

console.log(JSON.stringify({
  directNavigation: direct,
  shared,
  storedMass,
  legacy,
  dedicatedRequests,
  transitionBeforeFive: beforeFive,
  comparisons: compareState,
  noWebgl,
  moduleFallback,
  reduced,
  offline,
  captures: [
    'advanced-3d-loader-dark.png',
    'advanced-3d-camera-drone-dark.png',
    'advanced-3d-camera-shooter-dark.png',
    'advanced-3d-camera-profile-dark.png',
    'advanced-3d-comparisons-light.png',
    'advanced-3d-desktop-light.png',
    ...formats.map(([, , label]) => `advanced-3d-${label}-dark.png`),
  ],
}, null, 2));

socket.close();
