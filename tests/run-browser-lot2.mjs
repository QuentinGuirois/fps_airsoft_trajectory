import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = process.env.FAT_CDP_PORT || '9338';
const profile = await mkdtemp(join(tmpdir(), 'fat-lot2-chrome-'));
const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { ready = true; break; }
    } catch { /* Chrome démarre. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Chrome DevTools indisponible');
  process.env.FAT_CDP_PORT = port;
  await import('./browser-lot2.mjs');
} finally {
  browser.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(profile, { recursive: true, force: true });
}
