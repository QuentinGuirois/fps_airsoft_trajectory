import { initTheme } from './theme.js?v=20260723-47';
import { markAdvancedTransition } from './advanced-transition.js?v=20260723-47';

const SHOT_STORAGE_KEY = 'fat-shot-v3';
const SUMMARY_STORAGE_KEY = 'fat-last-summary-v3';
const gasToolPath = '/outils/choisir-gaz-airsoft-pression-temperature/';

const primaryNavigation = [
  { href: '/#calculateur', label: 'Calculateur', matches: (path) => path === '/' || path === '/simulateur-trajectoire-airsoft/' || path === '/simulateur-3d-airsoft/' },
  { href: '/outils/', label: 'Outils', matches: (path) => path.startsWith('/outils/') || path === '/convertisseur-joules-fps/' },
  { href: '/guides/', label: 'Guides', matches: (path) => path.startsWith('/guides/') },
];

const briefingNavigation = [
  { href: '/#calculateur', label: 'Calculateur', description: 'Trajectoire 2D/3D · le banc complet' },
  { href: '/parties-airsoft/', label: 'Radar des parties', description: 'Carte de France · parties réellement publiées' },
  { href: '/tu-joues-avec-quoi/', label: 'Tu joues avec quoi ?', description: 'Répliques et courbes publiées par les joueurs' },
  { href: '/convertisseur-joules-fps/', label: 'Joules ↔ FPS', description: 'Conversion rapide · tous grammages' },
  { href: gasToolPath, label: 'Gaz & température', description: 'Pression théorique normalisée' },
  { href: '/guides/', label: 'Guides', description: 'Grammage · hop-up · portée · Joule Creep' },
  { href: '/simulateur-3d-airsoft/', label: 'Vue drone 3D', description: 'Scène avancée · trajectoires comparées', advanced: true },
];

const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function brandMarkup() {
  return `<a class="brand" href="/">
    <svg class="brand-mark" viewBox="0 0 120 76" aria-hidden="true" focusable="false"><path class="brand-curve" d="M6 62C30 30 62 22 78 26C96 31 106 44 112 62"/><circle class="brand-ball" cx="78" cy="26" r="13"/><path class="brand-spin" d="M60 30A20 20 0 0 1 71 15"/><line class="brand-ground" x1="2" y1="68" x2="118" y2="68"/></svg>
    <span><strong>F.A.T<span class="brand-dot">.</span></strong><small>FPS Airsoft Trajectory</small></span>
  </a>`;
}

function burgerMarkup(label = 'MENU') {
  return `<span class="menu-toggle-label" data-menu-label>${label}</span><span class="menu-toggle-box" aria-hidden="true"><span></span><span></span><span></span></span>`;
}

function accountAccessMarkup() {
  return `<a class="account-access" href="/compte/" aria-label="Mon compte"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.5-4 2.7-6 6.5-6s6 2 6.5 6"/></svg><span>Mon compte</span></a>`;
}

function safeStoredObject(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function readLastSetup(storage = globalThis.localStorage) {
  const shot = safeStoredObject(storage, SHOT_STORAGE_KEY);
  const summary = safeStoredObject(storage, SUMMARY_STORAGE_KEY);
  const energyJ = Number(shot?.energyJ);
  const massG = Number(shot?.massG);
  const summaryMatches = Number.isFinite(energyJ)
    && Number.isFinite(massG)
    && Math.abs(Number(summary?.energyJ) - energyJ) < 0.001
    && Math.abs(Number(summary?.massG) - massG) < 0.001;
  return {
    hasShot: Number.isFinite(energyJ) && Number.isFinite(massG),
    energyJ,
    massG,
    usefulRangeM: summaryMatches && Number.isFinite(Number(summary?.usefulRangeM)) ? Number(summary.usefulRangeM) : null,
    calculatedAt: summaryMatches ? summary?.calculatedAt || null : null,
  };
}

function setupContextMarkup(setup, compact = false) {
  if (!setup.hasShot) return compact ? 'AUCUN SETUP' : '';
  const range = setup.usefulRangeM == null ? 'PORTÉE —' : `PORTÉE ${number.format(setup.usefulRangeM)} m`;
  return `${number.format(setup.energyJ)} J · ${number.format(setup.massG)} g · ${range}`;
}

function ensureSiteHeader() {
  let header = document.querySelector('.site-header');
  if (!header) {
    header = document.createElement('header');
    header.className = 'site-header';
    document.querySelector('main')?.before(header);
  }
  header.dataset.siteShell = 'header';
  const links = primaryNavigation.map((item) => {
    const current = item.matches(location.pathname) ? ' aria-current="page"' : '';
    return `<a href="${item.href}"${current}>${item.label}</a>`;
  }).join('');
  header.innerHTML = `<div class="shell nav-row">${brandMarkup()}
    <nav class="primary-nav" aria-label="Navigation principale">${links}</nav>
    <span class="mobile-setup-context" data-mobile-setup-context aria-live="polite"></span>
    ${accountAccessMarkup()}
    <button class="button button-primary button-small nav-install" type="button" data-install-app hidden>Installer l’app</button>
    <button class="menu-toggle menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="briefing-menu" aria-label="Ouvrir le menu">${burgerMarkup()}</button>
  </div>`;
  return header;
}

function briefingLinkMarkup(item, index) {
  const advanced = item.advanced ? ' data-advanced-entry' : '';
  return `<a class="briefing-link" href="${item.href}" style="--menu-index:${index}"${advanced}><span class="briefing-link-number">${String(index + 1).padStart(2, '0')}</span><span class="briefing-link-title">${item.label}</span><span class="briefing-link-description">${item.description}</span></a>`;
}

function ensureBriefingMenu() {
  document.querySelector('[data-briefing-menu]')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'briefing-menu';
  overlay.className = 'briefing-menu';
  overlay.dataset.briefingMenu = '';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'briefing-menu-title');
  overlay.innerHTML = `<div class="briefing-atmosphere" aria-hidden="true"><span class="briefing-grid"></span><span class="briefing-tracer briefing-tracer-one"></span><span class="briefing-tracer briefing-tracer-two"></span></div>
    <div class="briefing-header"><div class="shell briefing-header-row">${brandMarkup()}<button class="menu-toggle" type="button" data-menu-close aria-expanded="true" aria-controls="briefing-menu" aria-label="Fermer le menu">${burgerMarkup('FERMER')}</button></div></div>
    <div class="shell briefing-layout">
      <section class="briefing-main" aria-labelledby="briefing-menu-title"><p class="briefing-kicker" id="briefing-menu-title">// Navigation principale</p><nav class="briefing-links" aria-label="Toutes les rubriques">${briefingNavigation.map(briefingLinkMarkup).join('')}</nav></section>
      <aside class="briefing-sidebar">
        <section class="last-setup-card" data-last-setup-card aria-labelledby="last-setup-title"></section>
        <nav class="briefing-secondary" aria-label="Liens du projet"><a href="/compte/">Mon compte</a><a href="/modele-physique-atp/">Le modèle ATP</a><a href="/a-propos/">À propos / Keep</a><a href="/faq-airsoft-balistique/">FAQ</a><a href="/#tutoriel-calculateur" data-tutorial-launch>Relancer le tutoriel</a><button type="button" data-install-app hidden>Installer l’app ↓</button></nav>
        <p class="briefing-install-help" data-install-help hidden>L’installation dépend du navigateur. Utilise son menu « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>
        <div class="briefing-pwa-status"><span aria-hidden="true"></span><p data-pwa-status>SERVICE WORKER EN INITIALISATION</p></div>
      </aside>
    </div>
    <div class="briefing-camo" aria-hidden="true"></div>`;
  document.body.append(overlay);
  return overlay;
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
      <div><h2>Outils</h2><ul><li><a href="/outils/">Tous les outils</a></li><li><a href="/#calculateur">Simulateur de trajectoire</a></li><li><a href="/simulateur-3d-airsoft/" data-advanced-entry>Simulateur 3D avancé</a></li><li><a href="/convertisseur-joules-fps/">Convertisseur Joules/FPS</a></li><li><a href="${gasToolPath}">Gaz / température</a></li></ul></div>
      <div><h2>Guides</h2><ul><li><a href="/guides/">Tous les guides</a></li><li><a href="/guides/choisir-poids-bille-airsoft/">Poids de bille</a></li><li><a href="/guides/regler-hop-up-airsoft/">Réglage hop-up</a></li><li><a href="/guides/portee-airsoft/">Portée airsoft</a></li><li><a href="/guides/joule-creep-airsoft/">Joule Creep</a></li></ul></div>
      <div><h2>Projet</h2><ul><li><a href="/parties-airsoft/">Radar des parties</a></li><li><a href="/tu-joues-avec-quoi/">Tu joues avec quoi ?</a></li><li><a href="/modele-physique-atp/">Modèle ATP & Mackila</a></li><li><a href="/a-propos/">À propos de Keep</a></li><li><a href="/faq-airsoft-balistique/">FAQ</a></li><li><a href="/mentions-legales/">Mentions légales</a></li><li><a href="/politique-confidentialite/">Confidentialité</a></li></ul></div>
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

function renderLastSetup() {
  const setup = readLastSetup();
  const mobile = document.querySelector('[data-mobile-setup-context]');
  if (mobile) mobile.textContent = setupContextMarkup(setup, true);
  const card = document.querySelector('[data-last-setup-card]');
  if (!card) return;
  if (!setup.hasShot) {
    card.innerHTML = '<p class="last-setup-label" id="last-setup-title">Dernier setup</p><strong>AUCUN SETUP ENREGISTRÉ</strong><p>Le menu n’invente aucune portée sans calcul ATP.</p><a class="button button-primary button-small" href="/#calculateur">Lancer une première simulation</a>';
    return;
  }
  const range = setup.usefulRangeM == null ? '—' : `${number.format(setup.usefulRangeM)} m`;
  card.innerHTML = `<p class="last-setup-label" id="last-setup-title">Dernier setup</p><div class="last-setup-reading"><strong>${number.format(setup.energyJ)} <small>J</small></strong><p>${number.format(setup.massG)} g<br>PORTÉE UTILE <span>${range}</span></p></div><span class="trust-tag" data-trust="calculated">Calculé</span><a class="button button-primary button-small" href="/#calculateur">Reprendre →</a>`;
}

function updatePwaStatus() {
  const status = document.querySelector('[data-pwa-status]');
  if (!status) return;
  if (!('serviceWorker' in navigator)) status.textContent = 'HORS LIGNE NON DISPONIBLE DANS CE NAVIGATEUR';
  else if (navigator.serviceWorker.controller) status.textContent = navigator.onLine ? 'HORS CONNEXION PRÊT' : 'MODE HORS CONNEXION ACTIF';
  else status.textContent = 'SERVICE WORKER EN INITIALISATION';
}

const header = ensureSiteHeader();
const briefingMenu = ensureBriefingMenu();
normalizeFooter();
enhanceGuideRails();
renderLastSetup();
updatePwaStatus();
initTheme();

document.querySelectorAll('[data-advanced-entry]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.origin !== location.origin || link.pathname !== '/simulateur-3d-airsoft/') return;
    markAdvancedTransition();
  });
});

const menuButton = header?.querySelector('[data-menu-button]');
const menuClose = briefingMenu?.querySelector('[data-menu-close]');
let menuScrollY = 0;
let menuCloseTimer = 0;

function menuFocusable() {
  return [...briefingMenu.querySelectorAll('a[href], button:not([disabled]):not([hidden]), input:not([disabled])')]
    .filter((element) => !element.hidden && element.getClientRects().length);
}

function unlockPage() {
  document.body.classList.remove('has-briefing-menu');
  document.body.style.removeProperty('top');
  window.scrollTo(0, menuScrollY);
}

function closeBriefing({ restoreFocus = true, immediate = false } = {}) {
  if (briefingMenu.hidden) return;
  clearTimeout(menuCloseTimer);
  menuButton?.setAttribute('aria-expanded', 'false');
  menuClose?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', 'Ouvrir le menu');
  menuButton?.querySelector('[data-menu-label]')?.replaceChildren('MENU');
  briefingMenu.dataset.closing = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 760px)').matches;
  const finish = () => {
    briefingMenu.hidden = true;
    briefingMenu.removeAttribute('data-open');
    briefingMenu.removeAttribute('data-closing');
    unlockPage();
    if (restoreFocus) menuButton?.focus();
  };
  if (immediate || reduced || mobile) finish();
  else menuCloseTimer = window.setTimeout(finish, 180);
}

function openBriefing() {
  if (!briefingMenu.hidden) return;
  clearTimeout(menuCloseTimer);
  renderLastSetup();
  updatePwaStatus();
  menuScrollY = window.scrollY;
  document.body.style.top = `-${menuScrollY}px`;
  document.body.classList.add('has-briefing-menu');
  briefingMenu.hidden = false;
  briefingMenu.removeAttribute('data-closing');
  briefingMenu.dataset.open = '';
  menuButton?.setAttribute('aria-expanded', 'true');
  menuClose?.setAttribute('aria-expanded', 'true');
  menuButton?.setAttribute('aria-label', 'Fermer le menu');
  menuButton?.querySelector('[data-menu-label]')?.replaceChildren('FERMER');
  requestAnimationFrame(() => (briefingMenu.querySelector('.briefing-link') || menuClose)?.focus());
}

menuButton?.addEventListener('click', () => {
  if (menuButton.getAttribute('aria-expanded') === 'true') closeBriefing();
  else openBriefing();
});
menuClose?.addEventListener('click', () => closeBriefing());
briefingMenu?.addEventListener('click', (event) => {
  if (!event.target.closest('a[href]')) return;
  closeBriefing({ restoreFocus: false, immediate: true });
});
document.addEventListener('keydown', (event) => {
  if (briefingMenu?.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBriefing();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = menuFocusable();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
window.addEventListener('storage', (event) => {
  if ([SHOT_STORAGE_KEY, SUMMARY_STORAGE_KEY].includes(event.key)) renderLastSetup();
});
window.addEventListener('fat:lastsummarychange', renderLastSetup);
window.addEventListener('online', updatePwaStatus);
window.addEventListener('offline', updatePwaStatus);
navigator.serviceWorker?.addEventListener('controllerchange', updatePwaStatus);

let installPrompt = null;
const installButtons = [...document.querySelectorAll('[data-install-app]')];

function appIsInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function usesIosInstallFlow() {
  const agent = window.navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(agent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function ensureInstallGuide() {
  let guide = document.querySelector('[data-install-guide]');
  if (guide) return guide;
  guide = document.createElement('div');
  guide.className = 'pwa-install-guide';
  guide.dataset.installGuide = '';
  guide.hidden = true;
  guide.setAttribute('role', 'dialog');
  guide.setAttribute('aria-modal', 'true');
  guide.setAttribute('aria-labelledby', 'pwa-install-title');
  guide.innerHTML = `<div class="pwa-install-backdrop" data-install-close></div>
    <section class="pwa-install-panel">
      <span class="stencil-patch">APPLICATION F.A.T.</span>
      <h2 id="pwa-install-title">Installer sur ce mobile</h2>
      <p data-install-intro></p>
      <ol data-install-steps></ol>
      <p class="pwa-install-note">Une fois installée, F.A.T. s’ouvre comme une application et reste utilisable hors connexion après une première visite.</p>
      <button class="button button-primary" type="button" data-install-close>J’ai compris</button>
    </section>`;
  document.body.append(guide);
  return guide;
}

function closeInstallGuide(restoreFocus = true) {
  const guide = document.querySelector('[data-install-guide]');
  if (!guide || guide.hidden) return;
  guide.hidden = true;
  document.body.classList.remove('has-install-guide');
  if (restoreFocus) guide.installTrigger?.focus();
}

function openInstallGuide(trigger) {
  const guide = ensureInstallGuide();
  const ios = usesIosInstallFlow();
  guide.installTrigger = trigger;
  guide.querySelector('[data-install-intro]').textContent = ios
    ? 'Sur iPhone ou iPad, l’installation se fait depuis Safari.'
    : 'Ton navigateur ne propose pas l’installation automatique. Tu peux tout de même ajouter F.A.T. à ton écran d’accueil.';
  guide.querySelector('[data-install-steps]').innerHTML = ios
    ? '<li>Ouvre cette page dans <strong>Safari</strong>.</li><li>Touche le bouton <strong>Partager</strong>.</li><li>Choisis <strong>Sur l’écran d’accueil</strong>, puis <strong>Ajouter</strong>.</li>'
    : '<li>Ouvre le <strong>menu du navigateur</strong> (souvent ⋮).</li><li>Choisis <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>.</li><li>Confirme l’installation.</li>';
  guide.hidden = false;
  document.body.classList.add('has-install-guide');
  guide.querySelector('.pwa-install-panel [data-install-close]')?.focus();
}

function refreshInstallButtons() {
  const installed = appIsInstalled();
  installButtons.forEach((button) => {
    button.hidden = installed;
    button.dataset.installMode = installPrompt ? 'prompt' : 'instructions';
    if (installPrompt) button.removeAttribute('aria-haspopup');
    else button.setAttribute('aria-haspopup', 'dialog');
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  refreshInstallButtons();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  closeInstallGuide(false);
  refreshInstallButtons();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-install-close]')) closeInstallGuide();
});

document.addEventListener('keydown', (event) => {
  const guide = document.querySelector('[data-install-guide]');
  if (!guide || guide.hidden) return;
  if (event.key === 'Escape') {
    closeInstallGuide();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...guide.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((item) => !item.hidden && !item.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

installButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    if (!installPrompt) {
      openInstallGuide(button);
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    refreshInstallButtons();
  });
});

refreshInstallButtons();

document.querySelectorAll('[data-converter]').forEach((converter) => {
  if (!document.querySelector('[data-converter-trust]')) {
    const trust = document.createElement('span');
    trust.className = 'trust-tag converter-trust';
    trust.dataset.trust = 'calculated';
    trust.dataset.converterTrust = '';
    trust.textContent = 'Calculé · formule E = ½mv²';
    converter.insertAdjacentElement('afterend', trust);
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
  const registerServiceWorker = () => navigator.serviceWorker.register('/service-worker.js?v=20260723-47').catch(() => null);
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}
