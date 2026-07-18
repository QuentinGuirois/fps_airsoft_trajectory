import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9339);
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
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
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

async function setViewport(width, height = width <= 390 ? 844 : 900) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width <= 768 });
}

async function capture(name) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function openCockpit({ width, theme, query = '' }) {
  await setViewport(width);
  await evaluate(`localStorage.setItem('fat-theme','${theme}');localStorage.removeItem('fat-shot-v3')`);
  await navigate(`${base}${query}`);
  await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
  await evaluate(`(()=>{document.documentElement.style.scrollBehavior='auto';const scene=document.querySelector('.cockpit-scene');window.scrollTo(0,scene.getBoundingClientRect().top+scrollY-76)})()`);
  await wait(60);
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `if (location.search.includes('no-worker')) Object.defineProperty(window,'Worker',{configurable:true,value:class{constructor(){throw new Error('Worker disabled by browser test')}}});`,
});
await navigate(base);

const captures = [];
const layouts = [];
for (const width of [1440, 1024, 768, 390, 360]) {
  for (const theme of ['dark', 'light']) {
    await openCockpit({ width, theme, query: `?cockpit=${width}-${theme}` });
    const state = await evaluate(`(()=>{const v=document.querySelector('.chart-viewport').getBoundingClientRect();const c=document.querySelector('#trajectory-chart');return{theme:document.documentElement.dataset.theme,ratio:v.width/v.height,scroll:document.documentElement.scrollWidth,width:innerWidth,scale:document.querySelector('#vertical-scale-chip').textContent,canvas:[c.width,c.height],metrics:[...document.querySelectorAll('[data-mobile-metric]')].map(e=>e.textContent)}})()`);
    const expected = width <= 620 ? 3 : 4.5;
    if (Math.abs(state.ratio - expected) > 0.08 || state.scroll > state.width || !state.scale.startsWith('HAUTEUR ×')) throw new Error(`Layout ${width}/${theme}: ${JSON.stringify(state)}`);
    if (width === 390 && state.metrics.some((value) => value === '—')) throw new Error(`Mobile metrics: ${JSON.stringify(state.metrics)}`);
    const name = `cockpit-2d-${width}-${theme}.png`;
    await capture(name);
    captures.push(name);
    layouts.push({ width, theme, ratio: state.ratio, scale: state.scale, canvas: state.canvas });
  }
}

await openCockpit({ width: 1440, theme: 'dark', query: '?m=0.36&j=1.90&rpm=110000&z=42&w=8&wd=90&t=12&p=1000&a=0&c=0' });
const currentUrl = await evaluate(`({m:document.querySelector('#mass').value,j:document.querySelector('#energy').value,rpm:document.querySelector('#rpm').value,z:document.querySelector('#zero').value,w:document.querySelector('#wind').value,wd:document.querySelector('#wind-angle').value,t:document.querySelector('#temperature').value,p:document.querySelector('#pressure').value,a:document.querySelector('#angle').value,c:document.querySelector('#cant').value})`);
if (JSON.stringify(currentUrl) !== JSON.stringify({ m: '0.36', j: '1.9', rpm: '110000', z: '42', w: '8', wd: '90', t: '12', p: '1000', a: '0', c: '0' })) throw new Error(`Current URL: ${JSON.stringify(currentUrl)}`);

await openCockpit({ width: 1440, theme: 'dark', query: '?m=0.25&j=1&h=55&z=30' });
const oldUrl = await evaluate(`({m:document.querySelector('#mass').value,j:document.querySelector('#energy').value,rpm:Number(document.querySelector('#rpm').value),z:document.querySelector('#zero').value})`);
if (oldUrl.m !== '0.25' || oldUrl.j !== '1' || !(oldUrl.rpm > 0) || oldUrl.z !== '30') throw new Error(`Legacy URL: ${JSON.stringify(oldUrl)}`);

await evaluate(`(()=>{const input=document.querySelector('#mass');input.value='0.43';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`!document.querySelector('[data-trajectory-app]').classList.contains('is-calculating')`);
const storedShot = await evaluate(`JSON.parse(localStorage.getItem('fat-shot-v3'))`);
if (storedShot.massG !== 0.43) throw new Error(`Shot storage: ${JSON.stringify(storedShot)}`);
await navigate(base);
await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
if (await evaluate(`document.querySelector('#mass').value !== '0.43'`)) throw new Error('Stored shot was not restored');

await evaluate(`(()=>{window.__sharedShot=null;Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedShot=data}});document.querySelector('#share-shot').click()})()`);
await waitFor(`window.__sharedShot !== null`);
const nativeShare = await evaluate(`({title:window.__sharedShot.title,params:Object.fromEntries(new URL(window.__sharedShot.url).searchParams)})`);
if (nativeShare.title !== 'Mon setup F.A.T.' || nativeShare.params.m !== '0.43' || !nativeShare.params.rpm || !nativeShare.params.wd) throw new Error(`Native share: ${JSON.stringify(nativeShare)}`);

await evaluate(`(()=>{window.__copiedShot='';Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedShot=value}}});document.querySelector('#share-shot').click()})()`);
await waitFor(`window.__copiedShot !== ''`);
const clipboardShare = await evaluate(`({url:window.__copiedShot,feedback:document.querySelector('#share-feedback').textContent})`);
if (!clipboardShare.url.includes('m=0.43') || !clipboardShare.feedback.includes('Lien copi')) throw new Error(`Clipboard share: ${JSON.stringify(clipboardShare)}`);

await evaluate(`window.__resetStart=Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId);document.querySelector('#compare-shot').click();document.querySelector('#reset-shot').click()`);
await wait(800);
const resetShot = await evaluate(`(()=>{const stored=JSON.parse(localStorage.getItem('fat-shot-v3')||'null');return{mass:document.querySelector('#mass').value,energy:document.querySelector('#energy').value,zero:document.querySelector('#zero').value,comparisons:document.querySelectorAll('[data-remove-comparison]').length,storedMass:stored?.massG??null,start:window.__resetStart,current:Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId),calculating:document.querySelector('[data-trajectory-app]').classList.contains('is-calculating')}})()`);
if (resetShot.mass !== '0.28' || resetShot.energy !== '1.5' || resetShot.zero !== '35' || resetShot.comparisons !== 0 || resetShot.storedMass !== 0.28 || resetShot.current <= resetShot.start || resetShot.calculating) throw new Error(`Reset shot: ${JSON.stringify(resetShot)}`);

await evaluate(`(()=>{window.__originalWorkerPost=Worker.prototype.postMessage;window.__delayedPosts=0;Worker.prototype.postMessage=function(message){if(message?.type==='simulate'){window.__delayedPosts++;const delay=window.__delayedPosts===1?500:0;setTimeout(()=>window.__originalWorkerPost.call(this,message),delay);return}return window.__originalWorkerPost.call(this,message)};window.__concurrentStart=Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId);const input=document.querySelector('#zero');input.value='40';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`window.__delayedPosts === 1`);
await evaluate(`(()=>{const input=document.querySelector('#zero');input.value='42';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`window.__delayedPosts === 2 && Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId) === window.__concurrentStart + 2`);
const concurrentBefore = await evaluate(`({id:document.querySelector('[data-trajectory-app]').dataset.lastRequestId,metrics:[...document.querySelectorAll('[data-metric]')].map(node=>node.textContent),zero:JSON.parse(localStorage.getItem('fat-shot-v3')).zeroDistanceM})`);
await wait(600);
const concurrentAfter = await evaluate(`({id:document.querySelector('[data-trajectory-app]').dataset.lastRequestId,metrics:[...document.querySelectorAll('[data-metric]')].map(node=>node.textContent),zero:JSON.parse(localStorage.getItem('fat-shot-v3')).zeroDistanceM})`);
if (JSON.stringify(concurrentBefore) !== JSON.stringify(concurrentAfter) || concurrentAfter.zero !== 42) throw new Error(`Concurrent stale result: ${JSON.stringify({ concurrentBefore, concurrentAfter })}`);
await evaluate(`Worker.prototype.postMessage=window.__originalWorkerPost`);

await evaluate(`(()=>{window.__errorStart=Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId);window.__originalWorkerPost=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message){if(message?.type==='simulate'){setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:{ok:false,requestId:message.requestId,error:'Erreur de recette'}})),0);return}return window.__originalWorkerPost.call(this,message)};const input=document.querySelector('#zero');input.value='43';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`document.querySelector('#result-status').textContent.includes('Erreur de recette')`);
const errorState = await evaluate(`({busy:document.querySelector('[data-trajectory-app]').getAttribute('aria-busy'),calculating:document.querySelector('[data-trajectory-app]').classList.contains('is-calculating'),loaderHidden:document.querySelector('[data-calculation-loader]').hidden,status:document.querySelector('#result-status').textContent})`);
if (errorState.busy !== 'false' || errorState.calculating || !errorState.loaderHidden) throw new Error(`Calculation error state: ${JSON.stringify(errorState)}`);
await evaluate(`Worker.prototype.postMessage=window.__originalWorkerPost;(()=>{const input=document.querySelector('#zero');input.value='44';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId) > window.__errorStart && document.querySelector('#result-status').textContent.includes('kg/m') && !document.querySelector('[data-trajectory-app]').classList.contains('is-calculating')`);

await evaluate(`(()=>{window.__fatPostCount=0;const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){window.__fatPostCount++;return original.apply(this,args)};window.__fatMetrics=[...document.querySelectorAll('[data-metric]')].map(e=>e.textContent);window.__fatCanvas=document.querySelector('#trajectory-chart').toDataURL();document.querySelector('input[name="fat-theme"][value="light"]').click()})()`);
await wait(150);
const themed = await evaluate(`({posts:window.__fatPostCount,metrics:[...document.querySelectorAll('[data-metric]')].map(e=>e.textContent),before:window.__fatMetrics,redrawn:window.__fatCanvas!==document.querySelector('#trajectory-chart').toDataURL(),theme:document.documentElement.dataset.theme})`);
if (themed.posts !== 0 || JSON.stringify(themed.metrics) !== JSON.stringify(themed.before) || !themed.redrawn || themed.theme !== 'light') throw new Error(`Theme redraw: ${JSON.stringify(themed)}`);

await evaluate(`document.querySelector('[data-chart-mode="trajectory"]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
const keyboardTab = await evaluate(`({mode:document.activeElement.dataset.chartMode,selected:document.activeElement.getAttribute('aria-selected'),refs:document.querySelector('#chart-reference-legend').children.length,scaleHidden:document.querySelector('#vertical-scale-chip').hidden})`);
if (keyboardTab.mode !== 'sight' || keyboardTab.selected !== 'true' || keyboardTab.refs !== 0 || !keyboardTab.scaleHidden) throw new Error(`Keyboard tab: ${JSON.stringify(keyboardTab)}`);

await evaluate(`document.querySelector('[data-chart-mode="trajectory"]').click()`);
for (const mass of ['0.20', '0.28', '0.36']) {
  await evaluate(`(()=>{const input=document.querySelector('#mass');input.value='${mass}';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await waitFor(`!document.querySelector('[data-trajectory-app]').classList.contains('is-calculating')`);
  await evaluate(`document.querySelector('#compare-shot').click()`);
}
const comparisons = await evaluate(`({items:document.querySelectorAll('#comparison-list li').length,remove:document.querySelectorAll('[data-remove-comparison]').length})`);
if (comparisons.items !== 4 || comparisons.remove !== 3) throw new Error(`Comparisons: ${JSON.stringify(comparisons)}`);

await evaluate(`(()=>{const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message){setTimeout(()=>original.call(this,message),380)};const input=document.querySelector('#zero');input.value='41';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await wait(220);
if (!await evaluate(`document.querySelector('[data-calculation-loader]').hidden`)) throw new Error('Loader flashed before 300 ms');
await wait(240);
const slowLoader = await evaluate(`({hidden:document.querySelector('[data-calculation-loader]').hidden,mode:document.querySelector('[data-calculation-loader]').dataset.mode})`);
if (slowLoader.hidden || slowLoader.mode !== 'compact') throw new Error(`Slow compact loader: ${JSON.stringify(slowLoader)}`);
await waitFor(`document.querySelector('[data-calculation-loader]').hidden`, 3000);

await setViewport(1024, 760);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
await wait(150);
const resized = await evaluate(`({scroll:document.documentElement.scrollWidth,width:innerWidth,canvas:document.querySelector('#trajectory-chart').width,rect:document.querySelector('#trajectory-chart').getBoundingClientRect().width})`);
if (resized.scroll > resized.width || resized.canvas < resized.rect) throw new Error(`Resize/zoom: ${JSON.stringify(resized)}`);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

await openCockpit({ width: 390, theme: 'dark', query: '?no-worker=1&m=0.28&j=1.5&rpm=90000' });
const fallback = await evaluate(`({useful:document.querySelector('[data-metric="usefulRange"]').textContent,status:document.querySelector('#result-status').textContent,loader:document.querySelector('[data-calculation-loader]').hidden})`);
if (fallback.useful === '—' || !fallback.loader) throw new Error(`No Worker fallback: ${JSON.stringify(fallback)}`);

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
await navigate(`${base}?cockpit=reduced`);
await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
const reduced = await evaluate(`({ball:getComputedStyle(document.querySelector('.calculation-loader-ball')).animationName,curve:getComputedStyle(document.querySelector('.loader-curve-active')).animationName,scroll:getComputedStyle(document.documentElement).scrollBehavior})`);
if (reduced.ball !== 'none' || reduced.curve !== 'none') throw new Error(`Reduced motion: ${JSON.stringify(reduced)}`);

const result = {
  layouts,
  urls: { current: currentUrl, legacy: oldUrl },
  persistence: { storedMass: storedShot.massG, reset: resetShot },
  sharing: { native: nativeShare, clipboard: clipboardShare.feedback },
  concurrency: concurrentAfter,
  calculationError: errorState,
  themeRedrawWithoutPhysics: themed.posts === 0,
  keyboardTab,
  comparisons,
  slowLoader,
  resized,
  fallback,
  reduced,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('cockpit-2d-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
