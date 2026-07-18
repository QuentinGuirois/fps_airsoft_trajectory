import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9338);
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

async function capture(name) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(captureDir, name), Buffer.from(screenshot.data, 'base64'));
}

async function setViewport(width, height = width <= 390 ? 844 : 900) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width <= 768 });
}

async function setTheme(theme) {
  await evaluate(`localStorage.setItem('fat-theme','${theme}')`);
}

async function checkLayout(width, theme) {
  await setViewport(width);
  await setTheme(theme);
  await navigate(`${base}?lot2=${width}-${theme}`);
  await waitFor(`document.querySelectorAll('input[name="fat-theme"]').length === 3`);
  await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
  const state = await evaluate(`(()=>{const targets=[...document.querySelectorAll('.brand,.menu-button,.theme-option span,.preset-row button,.field input,.field select,.spin-stepper button,.control-actions .button,.mobile-cta')].filter(e=>e.offsetParent&&getComputedStyle(e).visibility!=='hidden');const small=targets.filter(e=>e.getBoundingClientRect().height<43.5).slice(0,8).map(e=>({tag:e.tagName,id:e.id,cls:e.className,h:e.getBoundingClientRect().height}));return{width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,controls:document.querySelectorAll('input[name="fat-theme"]').length,small}})()`);
  if (state.scroll > state.width) throw new Error(`Overflow ${width}/${theme}: ${JSON.stringify(state)}`);
  if (state.theme !== theme || state.controls !== 3) throw new Error(`Theme ${width}/${theme}: ${JSON.stringify(state)}`);
  if (width <= 390 && state.small.length) throw new Error(`Hit target ${width}/${theme}: ${JSON.stringify(state.small)}`);
  await capture(`lot2-home-${width}-${theme}.png`);
  return state;
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Accessibility.enable');
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });

const layouts = [];
await navigate(base);
for (const width of [360, 390, 768, 1024, 1440]) {
  for (const theme of ['dark', 'light']) layouts.push(await checkLayout(width, theme));
}

await setViewport(1440);
for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/?t=12&brand=Nimrod%20Tactical&gas=nimrod-green-145`);
  await waitFor(`!document.querySelector('#gas-result').hidden`);
  const gasState = await evaluate(`({temperature:document.querySelector('#gas-temperature').value,brand:document.querySelector('#gas-brand').value,gas:document.querySelector('#gas-product').value,path:document.querySelector('#gas-chart-primary').getAttribute('d'),scroll:document.documentElement.scrollWidth,width:innerWidth})`);
  if (gasState.temperature !== '12' || gasState.brand !== 'Nimrod Tactical' || gasState.gas !== 'nimrod-green-145' || !gasState.path || gasState.scroll > gasState.width) throw new Error(`Gas state: ${JSON.stringify(gasState)}`);
  await evaluate(`(()=>{const s=document.querySelector('#gas-compare');const option=[...s.options].find(o=>o.value&&o.value!=='nimrod-green-145');s.value=option.value;s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  if (!await evaluate(`!document.querySelector('#gas-chart-comparison').hidden`)) throw new Error('Gas comparison curve missing');
  await capture(`lot2-gas-1440-${theme}.png`);

  await navigate(`${base}guides/portee-airsoft/`);
  await waitFor(`Boolean(document.querySelector('.guide-rail-cta'))`);
  if (await evaluate(`document.documentElement.scrollWidth>innerWidth`)) throw new Error(`Guide overflow ${theme}`);
  await capture(`lot2-guide-1440-${theme}.png`);

  await navigate(`${base}a-propos/`);
  await waitFor(`Boolean(document.querySelector('.about-portrait img'))`);
  const portraitBox = await evaluate(`(()=>{const box=document.querySelector('.about-portrait').getBoundingClientRect();const image=document.querySelector('.about-portrait img').getBoundingClientRect();return{boxWidth:box.width,boxHeight:box.height,imageWidth:image.width,imageHeight:image.height}})()`);
  if (Math.abs(portraitBox.boxWidth - portraitBox.boxHeight) > 1 || Math.abs(portraitBox.imageWidth - portraitBox.imageHeight) > 1) throw new Error(`About portrait is not square: ${JSON.stringify(portraitBox)}`);
  await evaluate(`document.querySelector('.about-profile').scrollIntoView({block:'start'})`);
  await wait(60);
  await capture(`lot2-about-1440-${theme}.png`);
}

const briefingStates = [];
for (const { width, height, theme, setup } of [
  { width: 1440, height: 900, theme: 'dark', setup: 'empty' },
  { width: 1440, height: 900, theme: 'light', setup: 'present' },
  { width: 390, height: 844, theme: 'dark', setup: 'present' },
  { width: 390, height: 844, theme: 'light', setup: 'empty' },
]) {
  await setViewport(width, height);
  await setTheme(theme);
  await navigate(`${base}convertisseur-joules-fps/?briefing=${width}-${theme}`);
  if (setup === 'present') {
    await evaluate(`(()=>{localStorage.setItem('fat-shot-v3',JSON.stringify({energyJ:1.5,massG:.28}));localStorage.setItem('fat-last-summary-v3',JSON.stringify({energyJ:1.5,massG:.28,usefulRangeM:52,calculatedAt:'2026-07-18T12:00:00.000Z'}))})()`);
  } else {
    await evaluate(`(()=>{localStorage.removeItem('fat-shot-v3');localStorage.removeItem('fat-last-summary-v3')})()`);
  }
  await navigate(`${base}convertisseur-joules-fps/?briefing=${width}-${theme}-${setup}`);
  await waitFor(`Boolean(document.querySelector('[data-briefing-menu]'))`);
  await evaluate(`document.querySelector('[data-menu-button]').click()`);
  await waitFor(`!document.querySelector('[data-briefing-menu]').hidden`);
  await wait(900);
  const menuState = await evaluate(`(()=>{const overlay=document.querySelector('[data-briefing-menu]');const links=[...overlay.querySelectorAll('.briefing-link')];const targets=[...overlay.querySelectorAll('.briefing-link,.briefing-secondary a,.briefing-secondary button:not([hidden]),.last-setup-card .button')].filter(node=>node.getClientRects().length);return{expanded:document.querySelector('[data-menu-button]').getAttribute('aria-expanded'),role:overlay.getAttribute('role'),modal:overlay.getAttribute('aria-modal'),locked:document.body.classList.contains('has-briefing-menu'),focused:overlay.contains(document.activeElement),links:links.length,small:targets.filter(node=>node.getBoundingClientRect().height<47.5).map(node=>({text:node.textContent.trim(),height:node.getBoundingClientRect().height})),scroll:overlay.scrollWidth,width:overlay.clientWidth,setup:overlay.querySelector('[data-last-setup-card]').textContent.replace(/\\s+/g,' ').trim(),status:overlay.querySelector('[data-pwa-status]').textContent.trim()}})()`);
  if (menuState.expanded !== 'true' || menuState.role !== 'dialog' || menuState.modal !== 'true' || !menuState.locked || !menuState.focused || menuState.links !== 6 || menuState.small.length || menuState.scroll > menuState.width) throw new Error(`Briefing state ${width}/${theme}: ${JSON.stringify(menuState)}`);
  if (setup === 'present' && (!menuState.setup.includes('1,5') || !menuState.setup.includes('0,28') || !menuState.setup.includes('52 m') || !menuState.setup.includes('Calculé'))) throw new Error(`Briefing setup missing: ${JSON.stringify(menuState)}`);
  if (setup === 'empty' && (!menuState.setup.includes('AUCUN SETUP ENREGISTRÉ') || !menuState.setup.includes('n’invente aucune portée'))) throw new Error(`Briefing empty state: ${JSON.stringify(menuState)}`);
  if (!['SERVICE WORKER EN INITIALISATION', 'HORS CONNEXION PRÊT', 'MODE HORS CONNEXION ACTIF'].includes(menuState.status)) throw new Error(`Briefing PWA status: ${JSON.stringify(menuState)}`);
  const trapped = await evaluate(`(()=>{const overlay=document.querySelector('[data-briefing-menu]');const focusable=[...overlay.querySelectorAll('a[href],button:not([disabled]):not([hidden]),input:not([disabled])')].filter(node=>!node.hidden&&node.getClientRects().length);const first=focusable[0];const last=focusable.at(-1);first.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));const wrappedBackward=document.activeElement===last;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));return{wrappedBackward,wrappedForward:document.activeElement===first}})()`);
  if (!trapped.wrappedBackward || !trapped.wrappedForward) throw new Error(`Briefing focus trap ${width}/${theme}: ${JSON.stringify(trapped)}`);
  await capture(`lot4-briefing-${width}-${theme}-${setup}.png`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`document.querySelector('[data-briefing-menu]').hidden`);
  const closed = await evaluate(`({expanded:document.querySelector('[data-menu-button]').getAttribute('aria-expanded'),locked:document.body.classList.contains('has-briefing-menu'),focused:document.activeElement===document.querySelector('[data-menu-button]')})`);
  if (closed.expanded !== 'false' || closed.locked || !closed.focused) throw new Error(`Briefing close ${width}/${theme}: ${JSON.stringify(closed)}`);
  briefingStates.push({ width, theme, setup, menuState, closed });
}

await setViewport(1024, 900);
await setTheme('dark');
await navigate(`${base}convertisseur-joules-fps/?visual-fixes`);
await waitFor(`Boolean(document.querySelector('[data-converter-trust]'))`);
const converterVisual = await evaluate(`(()=>{const converter=document.querySelector('[data-converter]');const trust=document.querySelector('[data-converter-trust]');const cta=document.querySelector('.guide-rail-cta .button-primary');return{trustAfterGrid:converter.nextElementSibling===trust,firstChild:converter.firstElementChild.className,ctaColor:getComputedStyle(cta).color,ctaBackground:getComputedStyle(cta).backgroundColor}})()`);
if (!converterVisual.trustAfterGrid || !converterVisual.firstChild.includes('field') || converterVisual.ctaColor === converterVisual.ctaBackground) throw new Error(`Converter fixes: ${JSON.stringify(converterVisual)}`);

await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/?t=20&brand=ASG%20Ultrair&gas=asg-ultrair-green-135-silicone`);
await waitFor(`!document.querySelector('#gas-result').hidden`);
const publishedBadge = await evaluate(`(()=>{const badge=document.querySelector('#gas-result-kind-pill');const style=getComputedStyle(badge);return{text:badge.textContent,color:style.color,background:style.backgroundColor}})()`);
if (!publishedBadge.text.includes('publiée') || publishedBadge.color === publishedBadge.background) throw new Error(`Published badge: ${JSON.stringify(publishedBadge)}`);

await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/`);
await waitFor(`document.documentElement.dataset.gasPressureReady === 'true'`);
await evaluate(`(()=>{const temperature=document.querySelector('#gas-temperature');temperature.value='7';temperature.dispatchEvent(new Event('input',{bubbles:true}));const brand=document.querySelector('#gas-brand');brand.value=[...brand.options].find(option=>option.value!=='ASG Ultrair').value;brand.dispatchEvent(new Event('change',{bubbles:true}));const product=document.querySelector('#gas-product');product.value=product.options[product.options.length-1].value;product.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const gasStored = await evaluate(`JSON.parse(localStorage.getItem('fat-green-gas-selection-v1'))`);
await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/`);
await waitFor(`document.documentElement.dataset.gasPressureReady === 'true'`);
const gasRestored = await evaluate(`({t:document.querySelector('#gas-temperature').value,brand:document.querySelector('#gas-brand').value,gas:document.querySelector('#gas-product').value,url:location.search})`);
if (gasRestored.t !== String(gasStored.t) || gasRestored.brand !== gasStored.brand || gasRestored.gas !== gasStored.gas || !gasRestored.url.includes('gas=')) throw new Error(`Gas storage: ${JSON.stringify({ gasStored, gasRestored })}`);

await navigate(`${base}outils/choisir-gaz-airsoft-pression-temperature/?t=12&brand=Nimrod%20Tactical&gas=nimrod-green-145`);
await waitFor(`document.documentElement.dataset.gasPressureReady === 'true'`);
await evaluate(`(()=>{window.__gasShare=null;window.__gasLink='';Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__gasShare=data}});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__gasLink=value}}});document.querySelector('#gas-share').click()})()`);
await waitFor(`window.__gasLink !== ''`);
const gasNativeShare = await evaluate(`({native:window.__gasShare,label:document.querySelector('#gas-share').textContent,url:window.__gasLink,field:document.querySelector('#gas-share-url').value})`);
if (gasNativeShare.native !== null || gasNativeShare.label !== 'Copier le lien' || !gasNativeShare.url.includes('gas=nimrod-green-145') || gasNativeShare.field !== gasNativeShare.url) throw new Error(`Gas desktop share: ${JSON.stringify(gasNativeShare)}`);
await evaluate(`(()=>{window.__gasCopy='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__gasCopy=value}}});document.querySelector('#gas-copy').click()})()`);
await waitFor(`window.__gasCopy !== ''`);
const gasClipboard = await evaluate(`({copied:window.__gasCopy.includes('Nimrod Tactical'),feedback:document.querySelector('#gas-share-feedback').textContent})`);
if (!gasClipboard.copied || !gasClipboard.feedback.includes('copi')) throw new Error(`Gas clipboard: ${JSON.stringify(gasClipboard)}`);

await setViewport(720, 900);
await navigate(`${base}?lot2=zoom-200`);
await waitFor(`Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
await wait(80);
const zoom200 = await evaluate(`({scale:visualViewport?.scale||1,width:innerWidth,scroll:document.documentElement.scrollWidth,main:Boolean(document.querySelector('#contenu')),focusable:document.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])').length})`);
if (zoom200.scale < 1.9 || zoom200.scroll > zoom200.width || !zoom200.main || zoom200.focusable < 20) throw new Error(`Zoom 200%: ${JSON.stringify(zoom200)}`);
await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

await setViewport(390, 844);
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await evaluate(`localStorage.setItem('fat-theme','system')`);
await navigate(`${base}?lot2=system-theme`);
await waitFor(`document.documentElement.dataset.theme === 'dark'`);
await evaluate(`(()=>{window.__systemPosts=0;const original=Worker.prototype.postMessage;Worker.prototype.postMessage=function(...args){window.__systemPosts++;return original.apply(this,args)}})()`);
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'light' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });
await waitFor(`document.documentElement.dataset.theme === 'light'`);
const systemTheme = await evaluate(`({mode:document.documentElement.dataset.themeMode,theme:document.documentElement.dataset.theme,stored:localStorage.getItem('fat-theme'),posts:window.__systemPosts,checked:document.querySelector('input[name="fat-theme"][value="system"]').checked})`);
if (systemTheme.mode !== 'system' || systemTheme.theme !== 'light' || systemTheme.stored !== 'system' || systemTheme.posts !== 0 || !systemTheme.checked) throw new Error(`System theme: ${JSON.stringify(systemTheme)}`);

await setViewport(390, 844);
await setTheme('dark');
await navigate(`${base}?lot2=keyboard`);
await waitFor(`document.querySelectorAll('input[name="fat-theme"]').length===3`);
await evaluate(`document.querySelector('[data-menu-button]').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
if (!await evaluate(`document.querySelector('[data-menu-button]').getAttribute('aria-expanded')==='true'`)) throw new Error('Keyboard menu did not open');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
if (!await evaluate(`document.querySelector('[data-menu-button]').getAttribute('aria-expanded')==='false'`)) throw new Error('Escape did not close menu');
const accessibilityTree = await send('Accessibility.getFullAXTree');
const interactiveRoles = new Set(['button', 'link', 'radio', 'textbox', 'combobox', 'slider', 'spinbutton']);
const namelessControls = accessibilityTree.nodes
  .filter((node) => !node.ignored && interactiveRoles.has(node.role?.value) && !String(node.name?.value || '').trim())
  .map((node) => node.role.value);
const accessibility = await evaluate(`(()=>{const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);const duplicates=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];const unlabeled=[...document.querySelectorAll('input:not([type="hidden"]),select,canvas')].filter(node=>node.offsetParent!==null&&!node.labels?.length&&!node.getAttribute('aria-label')&&!node.getAttribute('aria-labelledby')).map(node=>node.id||node.tagName);return{duplicates,unlabeled,liveRegions:document.querySelectorAll('[aria-live]').length,canvasLabel:document.querySelector('#trajectory-chart').getAttribute('aria-label')}})()`);
if (namelessControls.length || accessibility.duplicates.length || accessibility.unlabeled.length || !accessibility.canvasLabel || accessibility.liveRegions < 2) throw new Error(`Accessibility: ${JSON.stringify({ namelessControls, accessibility })}`);

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
await navigate(`${base}?lot2=reduced`);
const reduced = await evaluate(`({scroll:getComputedStyle(document.documentElement).scrollBehavior,loader:getComputedStyle(document.querySelector('.calculation-loader-ball')).animationName})`);
if (reduced.loader !== 'none') throw new Error(`Reduced motion: ${JSON.stringify(reduced)}`);

const result = {
  layouts,
  keyboard: true,
  accessibility: { ...accessibility, namelessControls },
  gasPersistence: { stored: gasStored, restored: gasRestored },
  gasSharing: { native: gasNativeShare, clipboard: gasClipboard },
  briefingStates,
  visualFixes: { converterVisual, publishedBadge },
  zoom200,
  systemTheme,
  reduced,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('lot2-') || file.startsWith('lot4-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
