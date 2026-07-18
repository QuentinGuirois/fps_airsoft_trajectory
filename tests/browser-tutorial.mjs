import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureDir = resolve(root, 'docs', 'visual-regression');
const port = Number(process.env.FAT_CDP_PORT || 9341);
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

async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile,
  });
}

async function setTheme(value) {
  await evaluate(`document.querySelector('input[name="fat-theme"][value="${value}"]').click()`);
  await wait(80);
}

async function nextStep(expected) {
  await evaluate(`document.querySelector('[data-tutorial-next]').click()`);
  await waitFor(`window.fatCalculatorTutorial.getState().index === ${expected}`);
  await wait(520);
}

await mkdir(captureDir, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await setViewport(1440, 900);
await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'no-preference' },
] });

await navigate(`${base}?tutorial-recipe=desktop`);
await evaluate(`localStorage.removeItem('fat-tutorial-v1');localStorage.setItem('fat-theme','dark')`);
await navigate(`${base}?tutorial-recipe=first-visit`);
await waitFor(`Boolean(window.fatCalculatorTutorial) && Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
await waitFor(`Boolean(document.querySelector('[data-tutorial-offer]'))`);
const firstVisit = await evaluate(`({offer:Boolean(document.querySelector('[data-tutorial-offer]')),stored:localStorage.getItem('fat-tutorial-v1')})`);
if (!firstVisit.offer || firstVisit.stored !== 'dismissed') throw new Error(`First visit mismatch ${JSON.stringify(firstVisit)}`);

const valuesBefore = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-shot-field]')].map(input=>[input.dataset.shotField,input.value]))`);
await evaluate(`document.querySelector('[data-tutorial-offer-start]').click()`);
await waitFor(`window.fatCalculatorTutorial.getState().active && window.fatCalculatorTutorial.getState().index === 0`);
await wait(520);
const initial = await evaluate(`(()=>{const dialog=document.querySelector('.tutorial-tip');const hole=document.querySelector('.tutorial-spotlight').getBoundingClientRect();const header=document.querySelector('.site-header').getBoundingClientRect();return{role:dialog.getAttribute('role'),modal:dialog.getAttribute('aria-modal'),dots:document.querySelectorAll('.tutorial-dots span').length,title:document.querySelector('[data-tutorial-title]').textContent,focused:document.activeElement===document.querySelector('[data-tutorial-next]'),safe:hole.top>=header.bottom-1}})()`);
if (initial.role !== 'dialog' || initial.modal !== 'true' || initial.dots !== 7 || !initial.focused || !initial.safe) throw new Error(`Initial tutorial mismatch ${JSON.stringify(initial)}`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
if (!await evaluate(`document.activeElement===document.querySelector('[data-tutorial-skip]')`)) throw new Error('Focus did not wrap to first tutorial control');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
if (!await evaluate(`document.activeElement===document.querySelector('[data-tutorial-next]')`)) throw new Error('Shift+Tab did not wrap to last tutorial control');
await capture('tutorial-desktop-night.png');
await setTheme('light');
await capture('tutorial-desktop-day.png');
await setTheme('dark');

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
await waitFor(`window.fatCalculatorTutorial.getState().index === 1`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
await waitFor(`window.fatCalculatorTutorial.getState().index === 0`);
const valuesAfterKeys = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-shot-field]')].map(input=>[input.dataset.shotField,input.value]))`);
if (JSON.stringify(valuesBefore) !== JSON.stringify(valuesAfterKeys)) throw new Error('Tutorial navigation changed calculator values');

const requestBefore = await evaluate(`Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId)`);
await evaluate(`(()=>{const input=document.querySelector('#energy');input.value='1.51';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`Number(document.querySelector('[data-trajectory-app]').dataset.lastRequestId) > ${requestBefore}`);
if (!await evaluate(`window.fatCalculatorTutorial.getState().active && window.fatCalculatorTutorial.getState().index === 0`)) throw new Error('Tutorial did not survive Worker recalculation');

await evaluate(`document.querySelector('[data-tuto="hopup"]').dataset.tuto='hopup-absent'`);
await nextStep(1);
await nextStep(3);
await evaluate(`document.querySelector('[data-tuto="hopup-absent"]').dataset.tuto='hopup'`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await waitFor(`!window.fatCalculatorTutorial.getState().active`);
const dismissed = await evaluate(`({stored:localStorage.getItem('fat-tutorial-v1'),restored:document.activeElement===document.querySelector('[data-tutorial-launch]')})`);
if (dismissed.stored !== 'dismissed' || !dismissed.restored) throw new Error(`Dismiss mismatch ${JSON.stringify(dismissed)}`);

await evaluate(`document.querySelector('[data-menu-button]').click()`);
await waitFor(`!document.querySelector('[data-briefing-menu]').hidden`);
await evaluate(`document.querySelector('.briefing-secondary [data-tutorial-launch]').click()`);
await waitFor(`window.fatCalculatorTutorial.getState().active && document.querySelector('[data-briefing-menu]').hidden`);
for (let expected = 1; expected < 7; expected += 1) await nextStep(expected);
await evaluate(`document.querySelector('[data-tutorial-next]').click()`);
await waitFor(`!window.fatCalculatorTutorial.getState().active`);
if (await evaluate(`localStorage.getItem('fat-tutorial-v1')`) !== 'completed') throw new Error('Completion status missing');

await send('Emulation.setEmulatedMedia', { features: [
  { name: 'prefers-color-scheme', value: 'dark' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
] });
await evaluate(`document.querySelector('[data-tutorial-launch]').click()`);
await waitFor(`window.fatCalculatorTutorial.getState().active`);
await wait(60);
const reduced = await evaluate(`({spot:getComputedStyle(document.querySelector('.tutorial-spotlight')).animationName,tip:getComputedStyle(document.querySelector('.tutorial-tip')).animationName,transition:getComputedStyle(document.querySelector('.tutorial-spotlight')).transitionDuration})`);
if (reduced.spot !== 'none' || reduced.tip !== 'none' || reduced.transition !== '0s') throw new Error(`Reduced motion mismatch ${JSON.stringify(reduced)}`);
await evaluate(`window.fatCalculatorTutorial.close('completed')`);

await setViewport(390, 844, true);
await navigate(`${base}?tutorial-recipe=mobile`);
await waitFor(`Boolean(window.fatCalculatorTutorial) && Boolean(document.querySelector('[data-trajectory-app]')?.dataset.lastRequestId)`);
await setTheme('dark');
await evaluate(`document.querySelector('[data-tutorial-launch]').click()`);
await waitFor(`window.fatCalculatorTutorial.getState().active`);
for (let expected = 1; expected <= 4; expected += 1) await nextStep(expected);
const mobile = await evaluate(`(()=>{const tip=document.querySelector('.tutorial-tip').getBoundingClientRect();const hole=document.querySelector('.tutorial-spotlight').getBoundingClientRect();const header=document.querySelector('.site-header').getBoundingClientRect();return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,tipLeft:tip.left,tipRight:tip.right,holeTop:hole.top,headerBottom:header.bottom,index:window.fatCalculatorTutorial.getState().index}})()`);
if (mobile.scrollWidth > mobile.width || mobile.tipLeft < 0 || mobile.tipRight > mobile.width || mobile.holeTop < mobile.headerBottom - 1 || mobile.index !== 4) throw new Error(`Mobile layout mismatch ${JSON.stringify(mobile)}`);
await capture('tutorial-mobile-night.png');
await setTheme('light');
await capture('tutorial-mobile-day.png');

await setViewport(360, 800, true);
await wait(100);
if (await evaluate(`document.documentElement.scrollWidth > innerWidth`)) throw new Error('Horizontal overflow at 360 px');

await evaluate(`navigator.serviceWorker.ready.then(()=>true)`, true);
await navigate(`${base}?tutorial-recipe=sw-control`);
await waitFor(`Boolean(navigator.serviceWorker.controller)`);
const cache = await evaluate(`caches.open('fat-v3-2026-07-18-26').then(cache=>cache.match('/calculator-tutorial.js')).then(Boolean)`, true);
if (!cache) throw new Error('Tutorial module missing from PWA cache');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await navigate(`${base}?tutorial-recipe=offline`);
await waitFor(`Boolean(window.fatCalculatorTutorial)`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

const result = {
  firstVisit,
  initial,
  focusTrap: true,
  valuesPreserved: JSON.stringify(valuesBefore) === JSON.stringify(valuesAfterKeys),
  workerRecalculation: true,
  missingTargetSkipped: true,
  dismissed,
  completed: true,
  reduced,
  mobile,
  cache,
  consoleErrors,
  screenshots: (await readdir(captureDir)).filter((file) => file.startsWith('tutorial-')).sort(),
};
console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
socket.close();
