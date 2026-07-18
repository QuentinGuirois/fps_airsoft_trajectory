import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9340);
const base = process.env.FAT_BASE_URL || 'http://127.0.0.1:8080/';
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  return result.result.value;
}

async function navigate(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([
    loaded,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Navigation timeout: ${url}`)), 15000)),
  ]);
}

const wait = (duration) => new Promise((resolveWait) => setTimeout(resolveWait, duration));
async function waitFor(expression, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timeout: ${expression}`);
}

async function setViewport(width, height = 900) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width <= 768 });
}

async function capture(name) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function waitForResult() {
  await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
}

async function scrollToScene() {
  await evaluate(`(()=>{document.documentElement.style.scrollBehavior='auto';const scene=document.querySelector('.cockpit-scene');window.scrollTo(0,scene.getBoundingClientRect().top+scrollY-76)})()`);
  await wait(80);
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `if(location.search.includes('no-webgl')){const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).startsWith('webgl')?null:original.call(this,type,...args)}}`,
});

await setViewport(1440, 900);
console.log('[drone] chargement initial');
await navigate(base);
await waitForResult();
await evaluate(`navigator.serviceWorker.ready.then(()=>true)`, true);
await wait(500);
const preActivation = requests.filter((url) => lazyPaths.some((path) => url.includes(path)));
if (preActivation.length) throw new Error(`3D chargée avant activation: ${JSON.stringify(preActivation)}`);
const initial = await evaluate(`({webgl:document.querySelector('[data-trajectory-app]').dataset.webgl,toggleHidden:document.querySelector('[data-view-mode="3d"]').hidden,profile:!document.querySelector('[data-profile-2d]').hidden})`);
if (initial.webgl !== 'available' || initial.toggleHidden || !initial.profile) throw new Error(`WebGL initial: ${JSON.stringify(initial)}`);

await send('Network.setBlockedURLs', { urls: ['*drone-3d.js*'] });
console.log('[drone] fallback import');
await navigate(`${base}?three-import-fail=1`);
await waitForResult();
await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
await waitFor(`document.querySelector('[data-trajectory-app]').dataset.webgl === 'import-error'`);
const importFallback = await evaluate(`({toggleHidden:document.querySelector('[data-view-mode="3d"]').hidden,profile:!document.querySelector('[data-profile-2d]').hidden,drone:document.querySelector('[data-drone-view]').hidden})`);
if (!importFallback.toggleHidden || !importFallback.profile || !importFallback.drone) throw new Error(`Import fallback: ${JSON.stringify(importFallback)}`);
await send('Network.setBlockedURLs', { urls: [] });
await send('Network.setCacheDisabled', { cacheDisabled: true });

requests.length = 0;
console.log('[drone] activation WebGL');
await navigate(`${base}?three-success=1&w=12&wd=90`);
await waitForResult();
await scrollToScene();
const beforeClick = requests.filter((url) => lazyPaths.some((path) => url.includes(path)));
if (beforeClick.length) throw new Error(`Lazy requests before click: ${JSON.stringify(beforeClick)}`);
await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
await waitFor(`Boolean(document.querySelector('[data-drone-host] canvas'))`);
await wait(500);
const loadedRequests = [...new Set(requests.filter((url) => lazyPaths.some((path) => url.includes(path))).map((url) => new URL(url).pathname))];
for (const path of lazyPaths) if (!loadedRequests.includes(path)) throw new Error(`Module 3D absent du réseau: ${path} / ${JSON.stringify(loadedRequests)}`);

const sharedState = await evaluate(`(()=>{const root=document.querySelector('[data-trajectory-app]');const host=document.querySelector('[data-drone-host]');return{request2d:root.dataset.lastRequestId,request3d:host.dataset.sourceRequestId,points2d:root.dataset.lastPointCount,points3d:host.dataset.pointCount,signatureLength:host.dataset.pointSignature.length}})()`);
if (sharedState.request2d !== sharedState.request3d || sharedState.points2d !== sharedState.points3d || !(sharedState.signatureLength > 100)) throw new Error(`État Worker non partagé: ${JSON.stringify(sharedState)}`);
await evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`);
await waitFor(`document.querySelector('[data-drone-host]').dataset.rendering === 'paused'`);
await scrollToScene();
await waitFor(`document.querySelector('[data-drone-host]').dataset.rendering === 'active'`);
const visibilityLifecycle = true;

const cameraCaptures = [];
console.log('[drone] caméras');
for (const camera of ['drone', 'shooter', 'profile']) {
  await evaluate(`document.querySelector('[data-drone-camera="${camera}"]').click()`);
  await wait(420);
  if (await evaluate(`document.querySelector('[data-drone-host]').dataset.camera !== '${camera}'`)) throw new Error(`Caméra ${camera} inactive`);
  const name = `drone-3d-camera-${camera}.png`;
  await capture(name);
  cameraCaptures.push(name);
}

await evaluate(`(()=>{window.__threePosts=0;const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){window.__threePosts++;return original.apply(this,args)};window.__threeBefore=document.querySelector('[data-drone-host]').dataset.themeSignature;window.__threeRenderCount=Number(document.querySelector('[data-drone-host]').dataset.renderCount);document.querySelector('input[name="fat-theme"][value="light"]').click()})()`);
await wait(180);
const themeState = await evaluate(`({posts:window.__threePosts,theme:document.documentElement.dataset.theme,changed:window.__threeBefore!==document.querySelector('[data-drone-host]').dataset.themeSignature,redrawn:Number(document.querySelector('[data-drone-host]').dataset.renderCount)>window.__threeRenderCount})`);
if (themeState.posts !== 0 || themeState.theme !== 'light' || !themeState.changed || !themeState.redrawn) throw new Error(`Thème 3D: ${JSON.stringify(themeState)}`);

await evaluate(`document.querySelector('[data-drone-replay]').click()`);
await wait(80);
const replayStart = await evaluate(`document.querySelector('[data-drone-host]').dataset.playback`);
if (replayStart !== 'playing') throw new Error(`Replay non lancé: ${replayStart}`);

await waitFor(`navigator.serviceWorker.controller !== null`);
await wait(500);
const cached = await evaluate(`Promise.all(${JSON.stringify(lazyPaths)}.map(async path=>Boolean(await (await caches.open('fat-v3-2026-07-18-35')).match(path.endsWith('three.core.min.js')?path:path+'?v=20260718-28'))))`, true);
if (cached.some((value) => !value)) throw new Error(`Cache 3D incomplet: ${JSON.stringify(cached)}`);

await evaluate(`document.querySelector('[data-view-mode="2d"]').click()`);
await waitFor(`document.querySelector('[data-drone-view]').hidden`);
const destroyed = await evaluate(`({canvas:Boolean(document.querySelector('[data-drone-host] canvas')),signature:document.querySelector('[data-drone-host]').hasAttribute('data-point-signature'),profile:!document.querySelector('[data-profile-2d]').hidden})`);
if (destroyed.canvas || destroyed.signature || !destroyed.profile) throw new Error(`Destruction 3D: ${JSON.stringify(destroyed)}`);

await send('Network.setCacheDisabled', { cacheDisabled: false });
console.log('[drone] hors ligne');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
await navigate(`${base}?three-offline=1`);
await waitForResult();
await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
await waitFor(`Boolean(document.querySelector('[data-drone-host] canvas'))`);
const offline3d = await evaluate(`({canvas:Boolean(document.querySelector('[data-drone-host] canvas')),points:document.querySelector('[data-drone-host]').dataset.pointCount,controller:Boolean(navigator.serviceWorker.controller)})`);
if (!offline3d.canvas || !offline3d.points || !offline3d.controller) throw new Error(`3D hors ligne: ${JSON.stringify(offline3d)}`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });

await navigate(`${base}?no-webgl=1`);
console.log('[drone] sans WebGL');
await waitForResult();
const noWebgl = await evaluate(`({webgl:document.querySelector('[data-trajectory-app]').dataset.webgl,toggleHidden:document.querySelector('[data-view-mode="3d"]').hidden,profile:!document.querySelector('[data-profile-2d]').hidden,useful:document.querySelector('[data-metric="usefulRange"]').textContent})`);
if (noWebgl.webgl !== 'unavailable' || !noWebgl.toggleHidden || !noWebgl.profile || noWebgl.useful === '—') throw new Error(`Fallback sans WebGL: ${JSON.stringify(noWebgl)}`);

const responsive3d = [];
console.log('[drone] formats de recette');
for (const width of [360, 390, 768, 1024, 1440]) {
  for (const theme of ['dark', 'light']) {
    await setViewport(width, width <= 390 ? 844 : 900);
    await evaluate(`localStorage.setItem('fat-theme','${theme}')`);
    await navigate(`${base}?three-responsive=${width}-${theme}`);
    await waitForResult();
    await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
    await waitFor(`Boolean(document.querySelector('[data-drone-host] canvas'))`);
    const layout = await evaluate(`(()=>{const view=document.querySelector('[data-drone-view]');const rect=view.getBoundingClientRect();const buttons=[...view.querySelectorAll('button')].filter(button=>button.offsetParent!==null);return{width:${width},theme:document.documentElement.dataset.theme,rect:[rect.width,rect.height],viewport:[innerWidth,innerHeight],scroll:document.documentElement.scrollWidth,fullscreen:document.fullscreenElement===view,small:buttons.filter(button=>button.getBoundingClientRect().height<43.5).map(button=>button.textContent.trim())}})()`);
    if (layout.theme !== theme || layout.scroll > layout.viewport[0] || layout.small.length || layout.rect[0] > layout.viewport[0] + 1) throw new Error(`Responsive 3D: ${JSON.stringify(layout)}`);
    if (width <= 390 && (!layout.fullscreen || layout.rect[1] < layout.viewport[1] - 1)) throw new Error(`Fullscreen 3D ${width}: ${JSON.stringify(layout)}`);
    responsive3d.push(layout);
    await evaluate(width <= 390
      ? `document.querySelector('[data-drone-exit]').click()`
      : `document.querySelector('[data-view-mode="2d"]').click()`);
    await waitFor(`document.querySelector('[data-drone-view]').hidden`);
  }
}

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
await navigate(`${base}?three-reduced=1`);
console.log('[drone] reduced motion');
await waitForResult();
await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
await waitFor(`Boolean(document.querySelector('[data-drone-host] canvas'))`);
const reduced = await evaluate(`({reduced:document.querySelector('[data-drone-host]').dataset.reducedMotion,playback:document.querySelector('[data-drone-host]').dataset.playback})`);
if (reduced.reduced !== 'true' || reduced.playback !== 'idle') throw new Error(`Reduced motion initial: ${JSON.stringify(reduced)}`);
await evaluate(`document.querySelector('[data-drone-camera="profile"]').click();document.querySelector('[data-drone-replay]').click()`);
const reducedInteraction = await evaluate(`({transition:document.querySelector('[data-drone-host]').dataset.cameraTransition,playback:document.querySelector('[data-drone-host]').dataset.playback})`);
if (reducedInteraction.transition !== 'instant' || reducedInteraction.playback !== 'instant') throw new Error(`Reduced motion interaction: ${JSON.stringify(reducedInteraction)}`);

await setViewport(390, 844);
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await navigate(`${base}?three-mobile=1`);
console.log('[drone] mobile');
await waitForResult();
await evaluate(`document.querySelector('[data-view-mode="3d"]').click()`);
await waitFor(`Boolean(document.querySelector('[data-drone-host] canvas'))`);
const mobile = await evaluate(`(()=>{const view=document.querySelector('[data-drone-view]');const exit=document.querySelector('[data-drone-exit]');return{width:view.getBoundingClientRect().width,height:view.getBoundingClientRect().height,viewport:[innerWidth,innerHeight],exitHeight:exit.getBoundingClientRect().height,exitVisible:exit.offsetParent!==null,fullscreen:document.fullscreenElement===view}})()`);
if (mobile.width < 389 || mobile.height < 800 || mobile.exitHeight < 43.5 || !mobile.exitVisible) throw new Error(`Mobile 3D: ${JSON.stringify(mobile)}`);
await capture('drone-3d-mobile-390.png');
await evaluate(`document.querySelector('[data-drone-exit]').click()`);
await waitFor(`document.querySelector('[data-drone-view]').hidden`);

const result = {
  initial,
  preActivationRequests: preActivation,
  importFallback,
  loadedRequests,
  sharedState,
  visibilityLifecycle,
  themeWithoutPhysics: themeState,
  replayStart,
  cached,
  destroyed,
  offline3d,
  noWebgl,
  responsive3d,
  reduced,
  reducedInteraction,
  mobile,
  runtimeErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('drone-3d-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`);
socket.close();
