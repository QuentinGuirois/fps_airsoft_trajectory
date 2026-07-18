import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cdpPort = process.env.FAT_CDP_PORT || '9341';
let base = new URL(process.env.FAT_BASE_URL || 'http://127.0.0.1:8080/');
const profile = await mkdtemp(join(tmpdir(), 'fat-tutorial-chrome-'));
let server = null;

let currentServer = false;
try {
  const response = await fetch(base);
  currentServer = response.ok && (await response.text()).includes('/calculator-tutorial.js');
} catch { /* Aucun serveur compatible. */ }
if (!currentServer) {
  if (!process.env.FAT_BASE_URL) base = new URL('http://127.0.0.1:8091/');
  server = spawn('python', ['-m', 'http.server', base.port || '80'], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(base)).ok) break;
    } catch { /* Le serveur démarre. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) { ready = true; break; }
    } catch { /* Chrome démarre. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!ready) throw new Error('Chrome DevTools indisponible');
  process.env.FAT_CDP_PORT = cdpPort;
  process.env.FAT_BASE_URL = base.href;
  await import('./browser-tutorial.mjs');
} finally {
  browser.kill();
  server?.kill();
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  await rm(profile, { recursive: true, force: true });
}
