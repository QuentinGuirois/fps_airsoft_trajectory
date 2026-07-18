import { initTheme } from './theme.js';
import { markAdvancedTransition } from './advanced-transition.js';

const gasToolPath = '/outils/choisir-gaz-airsoft-pression-temperature/';
const navigationItems = [
  { href: '/#calculateur', label: 'Calculateur', matches: (path) => path === '/' },
  { href: '/simulateur-3d-airsoft/', label: 'Simulateur 3D' },
  { href: '/convertisseur-joules-fps/', label: 'Joules ↔ FPS' },
  { href: gasToolPath, label: 'Gaz / température' },
  { href: '/guides/choisir-poids-bille-airsoft/', label: 'Guides', matches: (path) => path.startsWith('/guides/') || path === '/simulateur-trajectoire-airsoft/' },
  { href: '/modele-physique-atp/', label: 'Le modèle ATP' },
  { href: '/a-propos/', label: 'Keep' },
];

function brandMarkup() {
  return `<a class="brand" href="/" aria-label="F.A.T., accueil">
    <svg class="brand-mark" viewBox="0 0 120 76" aria-hidden="true" focusable="false"><path class="brand-curve" d="M6 62C30 30 62 22 78 26C96 31 106 44 112 62"/><circle class="brand-ball" cx="78" cy="26" r="13"/><path class="brand-spin" d="M60 30A20 20 0 0 1 71 15"/><line class="brand-ground" x1="2" y1="68" x2="118" y2="68"/></svg>
    <span><strong>F.A.T<span class="brand-dot">.</span></strong><small>FPS Airsoft Trajectory</small></span>
  </a>`;
}

function ensureSiteHeader() {
  let header = document.querySelector('.site-header');
  if (!header) {
    header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = '<div class="shell nav-row"></div>';
    document.querySelector('main')?.before(header);
  }
  const navRow = header.querySelector('.nav-row');
  if (!navRow) return null;
  navRow.innerHTML = `${brandMarkup()}
    <button class="button button-small menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="site-menu">Menu</button>
    <nav class="menu" id="site-menu" data-menu aria-label="Navigation principale"></nav>
    <button class="button button-primary button-small nav-install" type="button" data-install-app hidden>Installer l’app</button>`;
  const menu = navRow.querySelector('[data-menu]');
  for (const item of navigationItems) {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.label;
    const matches = item.matches ? item.matches(location.pathname) : location.pathname === item.href;
    if (matches) link.setAttribute('aria-current', 'page');
    menu.append(link);
  }
  return header;
}

function normalizeFooter() {
  let footer = document.querySelector('.site-footer');
  if (!footer) {
    footer = document.createElement('footer');
    footer.className = 'site-footer';
    document.body.append(footer);
  }
  footer.dataset.siteShell = 'footer';
  footer.innerHTML = `<div class="camo-strip" aria-hidden="true"></div><div class="shell">
    <div class="footer-grid">
      <div>${brandMarkup()}<p>La physique airsoft rendue lisible, du chrony à la trajectoire.</p></div>
      <div><h2>Outils</h2><ul><li><a href="/#calculateur">Simulateur de trajectoire</a></li><li><a href="/simulateur-3d-airsoft/">Simulateur 3D avancé</a></li><li><a href="/convertisseur-joules-fps/">Convertisseur Joules/FPS</a></li><li><a href="${gasToolPath}">Gaz / température</a></li></ul></div>
      <div><h2>Guides</h2><ul><li><a href="/guides/choisir-poids-bille-airsoft/">Poids de bille</a></li><li><a href="/guides/regler-hop-up-airsoft/">Réglage hop-up</a></li><li><a href="/guides/portee-airsoft/">Portée airsoft</a></li><li><a href="/guides/joule-creep-airsoft/">Joule Creep</a></li></ul></div>
      <div><h2>Projet</h2><ul><li><a href="/modele-physique-atp/">Modèle ATP & Mackila</a></li><li><a href="/a-propos/">À propos de Keep</a></li><li><a href="/faq-airsoft-balistique/">FAQ</a></li></ul></div>
    </div>
    <div class="footer-bottom"><span>© 2026 Quentin Guirois — F.A.T.</span><span>Mesure au chrony &gt; portée racontée.</span></div>
  </div>`;
}

function enhanceGuideRails() {
  document.querySelectorAll('.content-grid > .toc').forEach((toc) => {
    if (toc.querySelector('.guide-rail-cta')) return;
    toc.classList.add('guide-rail');
    const cta = document.createElement('div');
    cta.className = 'guide-rail-cta';
    cta.innerHTML = '<span class="stencil-patch">Passe au banc</span><p>Teste ces principes avec les paramètres de ton propre setup.</p><a class="button button-primary button-small" href="/#calculateur">Ouvrir le simulateur</a>';
    const reminder = document.createElement('p');
    reminder.className = 'guide-rail-reminder';
    reminder.textContent = 'THÉORIQUE ≠ MESURÉ ≠ RÈGLE D’ORGANISATEUR';
    toc.append(cta, reminder);
  });
}

ensureSiteHeader();
normalizeFooter();
enhanceGuideRails();
initTheme();

document.querySelectorAll('[data-advanced-entry]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.origin !== location.origin || link.pathname !== '/simulateur-3d-airsoft/') return;
    markAdvancedTransition();
  });
});

const menuButton = document.querySelector('[data-menu-button]');
const menu = document.querySelector('[data-menu]');

if (menuButton && menu) {
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menu.toggleAttribute('data-open', !open);
  });
  menu.addEventListener('click', (event) => {
    if (!event.target.closest('a')) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menu.removeAttribute('data-open');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    menuButton.setAttribute('aria-expanded', 'false');
    menu.removeAttribute('data-open');
    menuButton.focus();
  });
}

let installPrompt = null;
const installButtons = [...document.querySelectorAll('[data-install-app]')];

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButtons.forEach((button) => { button.hidden = false; });
});

installButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    if (!installPrompt) {
      document.querySelector('[data-install-help]')?.removeAttribute('hidden');
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButtons.forEach((item) => { item.hidden = true; });
  });
});

document.querySelectorAll('[data-converter]').forEach((converter) => {
  if (!converter.querySelector('[data-converter-trust]')) {
    const trust = document.createElement('span');
    trust.className = 'trust-tag';
    trust.dataset.trust = 'calculated';
    trust.dataset.converterTrust = '';
    trust.textContent = 'Calculé · formule E = ½mv²';
    converter.prepend(trust);
  }
  const mass = converter.querySelector('[data-convert-mass]');
  const energy = converter.querySelector('[data-convert-energy]');
  const fps = converter.querySelector('[data-convert-fps]');
  const mps = converter.querySelector('[data-convert-mps]');
  let source = 'energy';

  const updateFromEnergy = () => {
    const massKg = Math.max(Number(mass.value), 0.01) / 1000;
    const velocity = Math.sqrt(2 * Math.max(Number(energy.value), 0) / massKg);
    fps.value = Math.round(velocity / 0.3048);
    mps.value = velocity.toFixed(1);
  };
  const updateFromFps = () => {
    const massKg = Math.max(Number(mass.value), 0.01) / 1000;
    const velocity = Math.max(Number(fps.value), 0) * 0.3048;
    energy.value = (0.5 * massKg * velocity ** 2).toFixed(2);
    mps.value = velocity.toFixed(1);
  };

  energy.addEventListener('input', () => { source = 'energy'; updateFromEnergy(); });
  fps.addEventListener('input', () => { source = 'fps'; updateFromFps(); });
  mass.addEventListener('input', () => { if (source === 'energy') updateFromEnergy(); else updateFromFps(); });
  updateFromEnergy();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const registerServiceWorker = () => navigator.serviceWorker.register('/service-worker.js').catch(() => null);
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}
