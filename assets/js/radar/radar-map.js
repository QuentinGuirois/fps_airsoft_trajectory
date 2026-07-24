const PARIS_DATE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris',
});
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
});
const PRICE = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const RULE_LABELS = Object.freeze({
  assault: 'Assaut',
  dmr: 'DMR',
  sniper: 'Sniper',
  cqb: 'CQB',
  detonating_grenades: 'Grenades détonantes',
  co2_grenades: 'Grenades CO₂',
  smoke_grenades: 'Fumigènes',
});

const RULE_STATES = Object.freeze({
  allowed: ['AUTORISÉ', '✓'],
  specific: ['SPÉCIFIQUE — VOIR DÉTAIL', '◆'],
  forbidden: ['INTERDIT', '×'],
  not_communicated: ['NC', '?'],
});

const LINK_LABELS = Object.freeze({
  organizer: 'SITE ORGANISATEUR',
  registration: 'INSCRIPTION',
  website: 'SITE WEB',
  facebook: 'FACEBOOK',
  helloasso: 'HELLOASSO',
  discord: 'DISCORD',
  instagram: 'INSTAGRAM',
});

export const RADAR_CITIES = Object.freeze([
  ['LILLE', 50.6292, 3.0573],
  ['PARIS', 48.8566, 2.3522],
  ['RENNES', 48.1173, -1.6778],
  ['NANTES', 47.2184, -1.5536],
  ['STRASBOURG', 48.5734, 7.7521],
  ['LYON', 45.7640, 4.8357],
  ['BORDEAUX', 44.8378, -0.5792],
  ['TOULOUSE', 43.6047, 1.4442],
  ['MONTPELLIER', 43.6119, 3.8772],
  ['MARSEILLE', 43.2965, 5.3698],
  ['NICE', 43.7102, 7.2620],
]);

export const RADAR_BASEMAP_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM_0_19&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
export const RADAR_LAUNCH_NOTICE_KEY = 'fat.radar.launch-notice.v1';

export function radarInteractionMode({ coarsePointer, compactViewport, fullscreen }) {
  if (fullscreen) return 'fullscreen';
  if (!coarsePointer) return 'mouse';
  return compactViewport ? 'preview' : 'cooperative';
}

export function isWgs84(latitude, longitude) {
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90
    && Number(latitude) <= 90
    && Number(longitude) >= -180
    && Number(longitude) <= 180;
}

export function toLeafletLatLng(event) {
  if (!isWgs84(event?.latitude, event?.longitude)) return null;
  return [Number(event.latitude), Number(event.longitude)];
}

export function haversineKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every((value) => Number.isFinite(Number(value)))) return Infinity;
  const toRadians = (value) => Number(value) * Math.PI / 180;
  const deltaLatitude = toRadians(Number(latB) - Number(latA));
  const deltaLongitude = toRadians(Number(lonB) - Number(lonA));
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

export function eventMatchesFilters(event, filters = {}) {
  const search = normalized(filters.location);
  if (search) {
    const haystack = normalized([
      event.title, event.venueName, event.locationLabel, event.city,
      event.postalCode, event.departmentCode, event.department, event.region,
    ].filter(Boolean).join(' '));
    if (!haystack.includes(search)) return false;
  }
  const start = new Date(event.startsAt).getTime();
  if (!Number.isFinite(start)) return false;
  if (filters.from && start < new Date(`${filters.from}T00:00:00`).getTime()) return false;
  if (filters.to && start > new Date(`${filters.to}T23:59:59`).getTime()) return false;
  if (filters.beginner && !event.beginnersWelcome) return false;
  if (filters.rental && !String(event.rentalDetails || '').trim()) return false;
  const requestedRules = filters.rules instanceof Set ? filters.rules : new Set(filters.rules || []);
  for (const type of requestedRules) {
    const rule = event.rules?.find((candidate) => candidate.type === type);
    if (!rule || !['allowed', 'specific'].includes(rule.state)) return false;
  }
  if (filters.position && Number(filters.radiusKm) > 0) {
    if (!isWgs84(event.latitude, event.longitude)) return false;
    if (haversineKm(
      filters.position.latitude,
      filters.position.longitude,
      event.latitude,
      event.longitude,
    ) > Number(filters.radiusKm)) return false;
  }
  return true;
}

export function deepSlugFromPath(pathname) {
  const match = String(pathname || '').match(/^\/parties-airsoft\/([a-z0-9-]+)\/?$/);
  return match?.[1] || '';
}

function element(documentRef, tag, className = '', text = '') {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function link(documentRef, href, text, className = '') {
  const node = element(documentRef, 'a', className, text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer ugc nofollow';
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date non communiquée' : PARIS_DATE.format(date);
}

function formatShortDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'DATE —' : SHORT_DATE.format(date).toUpperCase();
}

function formatUpdatedAt(value) {
  if (!value) return 'Non communiquée';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Non communiquée' : SHORT_DATE.format(date);
}

function localDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextWeekday(from, weekday) {
  const result = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  result.setDate(result.getDate() + ((weekday - result.getDay() + 7) % 7));
  return result;
}

function locationText(event) {
  if (event.positionApproximate || event.locationVisibility === 'approximate') {
    return `${event.locationLabel || event.city || 'Commune non précisée'} · position approximative`;
  }
  return event.locationLabel || [event.city, event.departmentCode].filter(Boolean).join(' · ') || 'Lieu communiqué';
}

function plural(count) {
  return `${count} PARTIE${count > 1 ? 'S' : ''}`;
}

function markerIcon(L, event) {
  return L.divIcon({
    className: `radar-marker-shell${event.positionApproximate ? ' is-approximate' : ''}`,
    html: '<span class="radar-pin" aria-hidden="true"><i></i></span>',
    iconSize: [44, 50],
    iconAnchor: [22, 48],
    tooltipAnchor: [0, -34],
  });
}

function priceText(event, empty = 'Non communiqué') {
  const minimum = event.priceMinCents ?? event.priceCents;
  const maximum = event.priceMaxCents ?? event.priceCents;
  if (minimum == null && maximum == null) return empty;
  if (minimum === maximum) return Number(minimum) === 0 ? 'Gratuit' : PRICE.format(Number(minimum) / 100);
  if (minimum == null) return `Jusqu’à ${PRICE.format(Number(maximum) / 100)}`;
  if (maximum == null) return `À partir de ${PRICE.format(Number(minimum) / 100)}`;
  return `${PRICE.format(Number(minimum) / 100)} – ${PRICE.format(Number(maximum) / 100)}`;
}

function hoverCard(documentRef, event) {
  const card = element(documentRef, 'div', 'radar-hover-card');
  card.append(
    element(documentRef, 'strong', '', event.title),
    element(documentRef, 'span', '', formatShortDate(event.startsAt)),
    element(documentRef, 'span', '', locationText(event)),
  );
  return card;
}

function ruleRow(documentRef, rule) {
  const row = element(documentRef, 'li', 'radar-rule-row');
  row.dataset.state = rule.state;
  const state = RULE_STATES[rule.state] || RULE_STATES.not_communicated;
  const icon = element(documentRef, 'i', '', state[1]);
  icon.setAttribute('aria-hidden', 'true');
  const main = element(documentRef, 'span');
  main.append(
    element(documentRef, 'strong', '', RULE_LABELS[rule.type] || rule.type),
    element(documentRef, 'small', '', [
      state[0],
      rule.joules == null ? '' : `${Number(rule.joules).toLocaleString('fr-FR')} J`,
      rule.details || '',
    ].filter(Boolean).join(' · ')),
  );
  if (rule.evidence?.url) {
    const proof = link(documentRef, rule.evidence.url, 'PREUVE OFFICIELLE ↗', 'radar-rule-evidence');
    proof.title = [rule.evidence.locator, rule.evidence.excerpt].filter(Boolean).join(' — ');
    main.append(proof);
  }
  row.append(icon, main);
  return row;
}

function briefingContent(documentRef, event, handlers) {
  const fragment = documentRef.createDocumentFragment();
  const eyebrow = element(documentRef, 'p', 'eyebrow', event.state === 'cancelled' ? 'PARTIE ANNULÉE' : 'BRIEFING ORGANISATEUR');
  const title = element(documentRef, 'h2', '', event.title);
  title.id = 'radar-briefing-title';
  const pills = element(documentRef, 'div', 'radar-briefing-pills');
  if (event.beginnersWelcome) pills.append(element(documentRef, 'span', '', 'DÉBUTANTS BIENVENUS'));
  if (event.positionApproximate || event.locationVisibility === 'approximate') pills.append(element(documentRef, 'span', '', 'POSITION APPROXIMATIVE'));

  const facts = element(documentRef, 'dl', 'radar-briefing-facts');
  const factsData = [
    ['DATE', `${formatDate(event.startsAt)} → ${formatDate(event.endsAt)}`],
    ['TERRAIN', event.venueName || 'Non communiqué'],
    ['LIEU', locationText(event)],
    ['SECTEUR', [event.department, event.region].filter(Boolean).join(' · ') || 'Non communiqué'],
    ['CAPACITÉ', event.maxCapacity == null ? 'Non communiquée' : `${event.maxCapacity} joueurs maximum`],
    ['TARIF', priceText(event)],
    ['NIVEAU', event.level || 'Non communiqué'],
    ['ÂGE', event.minimumAge == null ? 'Non communiqué' : `${event.minimumAge} ans minimum`],
    ['LOCATION', event.rentalDetails || 'Non communiquée'],
    ['RESTAURATION', event.cateringDetails || 'Non communiquée'],
    ['TOILETTES', event.toiletsAvailable == null ? 'Non communiqué' : (event.toiletsAvailable ? 'Oui' : 'Non')],
    ['MISE À JOUR', formatUpdatedAt(event.updatedAt)],
  ];
  for (const [label, value] of factsData) {
    facts.append(element(documentRef, 'dt', '', label), element(documentRef, 'dd', '', value));
  }

  const description = element(documentRef, 'p', 'radar-briefing-description', event.description || 'Aucune description supplémentaire.');
  const scenario = element(documentRef, 'p', 'radar-scenario');
  scenario.append(element(documentRef, 'strong', '', 'SCÉNARIO // '), documentRef.createTextNode(event.scenario || 'Non communiqué'));
  const ruleTitle = element(documentRef, 'h3', '', 'Règles annoncées');
  const rules = element(documentRef, 'ul', 'radar-rules');
  for (const rule of event.rules || []) rules.append(ruleRow(documentRef, rule));

  const actions = element(documentRef, 'div', 'radar-briefing-actions');
  if (event.state !== 'cancelled' && event.registrationUrl) {
    actions.append(link(documentRef, event.registrationUrl, 'S’INSCRIRE ↗', 'button button-primary'));
  }
  if (isWgs84(event.latitude, event.longitude) && !event.positionApproximate) {
    const destination = `${event.latitude},${event.longitude}`;
    actions.append(link(
      documentRef,
      `https://www.openstreetmap.org/directions?from=&to=${encodeURIComponent(destination)}`,
      'ITINÉRAIRE ↗',
      'button',
    ));
  }
  const share = element(documentRef, 'button', 'button', handlers.shareLabel);
  share.type = 'button';
  share.addEventListener('click', () => handlers.share(event));
  actions.append(share);

  const community = element(documentRef, 'div', 'radar-community-links');
  for (const item of event.links || []) {
    if (item.type === 'registration' && item.url === event.registrationUrl) continue;
    community.append(link(documentRef, item.url, LINK_LABELS[item.type] || item.type.toUpperCase()));
  }
  const organizer = element(documentRef, 'p', 'radar-organizer', `ORGANISATEUR // ${event.organizerName || event.organizer?.pseudo || 'Compte F.A.T.'}`);
  const privacy = element(documentRef, 'p', 'radar-privacy-note', 'Aucune adresse email de l’organisateur n’est affichée. Vérifiez les informations sur les liens officiels.');
  const report = element(documentRef, 'button', 'radar-report-button', 'SIGNALER UNE INFORMATION INCORRECTE');
  report.type = 'button';
  report.addEventListener('click', () => handlers.report(event));

  fragment.append(eyebrow, title, pills, facts, description, scenario, ruleTitle, rules, actions, community, organizer, privacy, report);
  return fragment;
}

function listCard(documentRef, event, onSelect) {
  const article = element(documentRef, 'article', 'radar-event-card');
  const button = element(documentRef, 'button', 'radar-event-open');
  button.type = 'button';
  const heading = element(documentRef, 'span', 'radar-event-heading');
  heading.append(
    element(documentRef, 'small', '', formatShortDate(event.startsAt)),
    element(documentRef, 'strong', '', event.title),
  );
  const place = element(documentRef, 'span', 'radar-event-location', locationText(event));
  const meta = element(documentRef, 'span', 'radar-event-meta', [
    event.maxCapacity == null ? '' : `${event.maxCapacity} joueurs max.`,
    priceText(event, ''),
    event.beginnersWelcome ? 'Débutants' : '',
  ].filter(Boolean).join(' · '));
  button.append(heading, place, meta);
  button.addEventListener('click', () => onSelect(event, button));
  article.append(button);
  return article;
}

function focusable(container) {
  return [...container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    .filter((node) => !node.hidden && node.getClientRects().length);
}

export function initRadarLaunchNotice({
  dialog,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (!dialog || windowRef.location.pathname !== '/parties-airsoft/') return null;
  try {
    if (windowRef.localStorage.getItem(RADAR_LAUNCH_NOTICE_KEY) === 'seen') return null;
  } catch {}

  const previousFocus = documentRef.activeElement;
  const close = () => {
    if (dialog.open) dialog.close();
    if (previousFocus && previousFocus !== documentRef.body && previousFocus.isConnected) {
      previousFocus.focus();
      return;
    }
    documentRef.body.setAttribute('tabindex', '-1');
    documentRef.body.focus({ preventScroll: true });
    documentRef.body.removeAttribute('tabindex');
  };
  dialog.querySelector('[data-radar-launch-close]')?.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const nodes = focusable(dialog);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes.at(-1);
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  try {
    windowRef.localStorage.setItem(RADAR_LAUNCH_NOTICE_KEY, 'seen');
  } catch {}
  windowRef.requestAnimationFrame(() => {
    dialog.showModal();
    dialog.querySelector('[data-radar-launch-primary]')?.focus();
  });
  return { close };
}

export function initRadarMap({
  root,
  publicRepository,
  accountRepository,
  turnstileController,
  leaflet = globalThis.L,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!root || !publicRepository || !leaflet) return null;
  const mapElement = root.querySelector('#radar-map');
  const mapStage = root.querySelector('.radar-map-stage');
  const filterForm = root.querySelector('[data-radar-filters]');
  const filterOpenButton = root.querySelector('[data-radar-filter-open]');
  const filterCloseButton = root.querySelector('[data-radar-filter-close]');
  const filterBackdrop = root.querySelector('[data-radar-filter-backdrop]');
  const fullscreenOpenButton = root.querySelector('[data-radar-fullscreen-open]');
  const fullscreenCloseButton = root.querySelector('[data-radar-fullscreen-close]');
  const fullscreenHandle = root.querySelector('[data-radar-fullscreen-handle]');
  const gestureHint = root.querySelector('[data-radar-gesture-hint]');
  const status = root.querySelector('[data-radar-status]');
  const count = root.querySelector('[data-radar-count]');
  const list = root.querySelector('[data-radar-list]');
  const empty = root.querySelector('[data-radar-empty]');
  const briefing = root.querySelector('[data-radar-briefing]');
  const briefingTarget = root.querySelector('[data-radar-briefing-content]');
  const reportDialog = documentRef.querySelector('[data-radar-report]');
  const reportForm = reportDialog?.querySelector('[data-radar-report-form]');
  const reportStatus = reportDialog?.querySelector('[data-radar-report-status]');
  const coarsePointer = windowRef.matchMedia('(pointer: coarse)');
  const compactViewport = windowRef.matchMedia('(max-width: 820px)');
  const filterSheetViewport = windowRef.matchMedia('(max-width: 820px)');
  const state = {
    events: [],
    filtered: [],
    position: null,
    active: null,
    lastFocus: null,
    markers: new Map(),
    reportEvent: null,
    fullscreen: false,
    filterSheetOpen: false,
  };

  const map = leaflet.map(mapElement, {
    center: [46.6, 2.4],
    zoom: 6,
    minZoom: 5,
    maxZoom: 17,
    zoomControl: true,
    attributionControl: true,
    maxBounds: [[40.5, -7], [52.5, 11]],
    preferCanvas: true,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Limites © IGN ADMIN EXPRESS COG CARTO PE 2026');
  map.createPane('radarFallback');
  const fallbackPane = map.getPane('radarFallback');
  fallbackPane.classList.add('radar-fallback-pane');
  fallbackPane.setAttribute('aria-hidden', 'true');
  fallbackPane.style.zIndex = '250';

  let basemapReady = false;
  let basemapBatchHasTile = false;
  const basemap = leaflet.tileLayer(RADAR_BASEMAP_URL, {
    minZoom: 5,
    maxZoom: 17,
    maxNativeZoom: 19,
    tileSize: 256,
    updateWhenIdle: true,
    keepBuffer: 2,
    crossOrigin: true,
    referrerPolicy: 'no-referrer',
    attribution: '<a href="https://www.ign.fr/" rel="external noopener">© IGN</a> · Plan IGN',
  });
  basemap.on('loading', () => {
    basemapBatchHasTile = false;
  });
  basemap.on('tileload', () => {
    basemapBatchHasTile = true;
  });
  basemap.on('tileerror', () => {
    if (!basemapReady) root.classList.remove('has-live-basemap');
  });
  basemap.on('load', () => {
    if (basemapBatchHasTile) {
      basemapReady = true;
      root.classList.add('has-live-basemap');
    } else if (!basemapReady) {
      root.classList.remove('has-live-basemap');
    }
  });
  basemap.addTo(map);

  let interactionMode = '';
  let gestureHintTimer = 0;
  let lockedScrollY = 0;
  let fullscreenFocus = null;
  let filterFocus = null;
  let cooperativeGesture = null;

  function toggleMapHandler(handler, enabled) {
    if (!handler) return;
    const action = enabled ? 'enable' : 'disable';
    handler[action]?.();
  }

  function hideGestureHint() {
    windowRef.clearTimeout(gestureHintTimer);
    if (gestureHint) gestureHint.hidden = true;
  }

  function showGestureHint(message) {
    if (!gestureHint) return;
    gestureHint.textContent = message;
    gestureHint.hidden = false;
    windowRef.clearTimeout(gestureHintTimer);
    gestureHintTimer = windowRef.setTimeout(() => {
      gestureHint.hidden = true;
    }, 1_200);
  }

  function syncMapInteractions() {
    interactionMode = radarInteractionMode({
      coarsePointer: coarsePointer.matches,
      compactViewport: compactViewport.matches,
      fullscreen: state.fullscreen,
    });
    mapElement.dataset.radarInteraction = interactionMode;
    root.dataset.radarInteraction = interactionMode;
    const directInteraction = interactionMode === 'mouse' || interactionMode === 'fullscreen';
    toggleMapHandler(map.dragging, directInteraction);
    toggleMapHandler(map.touchZoom, interactionMode === 'fullscreen');
    toggleMapHandler(map.doubleClickZoom, directInteraction);
    toggleMapHandler(map.scrollWheelZoom, interactionMode === 'mouse');
    toggleMapHandler(map.boxZoom, interactionMode === 'mouse');
    toggleMapHandler(map.keyboard, true);
    mapElement.setAttribute('role', interactionMode === 'preview' ? 'region' : 'application');
    mapElement.setAttribute(
      'aria-label',
      interactionMode === 'preview'
        ? 'Aperçu de la carte des parties. Faites défiler la page ou ouvrez la carte en plein écran.'
        : 'Carte interactive des parties d’airsoft publiées',
    );
    if (!['cooperative', 'preview'].includes(interactionMode)) hideGestureHint();
  }

  function syncFilterSheet() {
    if (!filterSheetViewport.matches) state.filterSheetOpen = false;
    const opened = filterSheetViewport.matches && state.filterSheetOpen;
    root.classList.toggle('is-filter-sheet-open', opened);
    documentRef.body.classList.toggle('has-radar-filters', opened);
    filterOpenButton?.setAttribute('aria-expanded', String(opened));
    filterForm.inert = filterSheetViewport.matches && !opened;
    if (filterSheetViewport.matches) {
      filterForm.setAttribute('role', 'dialog');
      filterForm.setAttribute('aria-modal', 'true');
      filterForm.setAttribute('aria-hidden', String(!opened));
    } else {
      filterForm.removeAttribute('role');
      filterForm.removeAttribute('aria-modal');
      filterForm.removeAttribute('aria-hidden');
    }
  }

  function openFilterSheet() {
    if (!filterSheetViewport.matches || state.filterSheetOpen) return;
    filterFocus = documentRef.activeElement;
    state.filterSheetOpen = true;
    syncFilterSheet();
    windowRef.setTimeout(() => filterCloseButton?.focus({ preventScroll: true }), 250);
  }

  function closeFilterSheet({ restoreFocus = true } = {}) {
    if (!state.filterSheetOpen) {
      syncFilterSheet();
      return;
    }
    state.filterSheetOpen = false;
    syncFilterSheet();
    if (restoreFocus && filterFocus?.isConnected) filterFocus.focus();
  }

  function openFullscreenMap() {
    if (state.fullscreen) return;
    closeFilterSheet({ restoreFocus: false });
    fullscreenFocus = documentRef.activeElement;
    lockedScrollY = windowRef.scrollY;
    state.fullscreen = true;
    mapStage.classList.add('is-fullscreen');
    documentRef.body.classList.add('has-radar-fullscreen');
    documentRef.body.style.top = `-${lockedScrollY}px`;
    fullscreenOpenButton?.setAttribute('aria-expanded', 'true');
    syncMapInteractions();
    windowRef.requestAnimationFrame(() => {
      map.invalidateSize({ pan: true, animate: false });
      fullscreenCloseButton?.focus();
    });
  }

  function closeFullscreenMap({ restoreFocus = true } = {}) {
    if (!state.fullscreen) return;
    state.fullscreen = false;
    mapStage.classList.remove('is-fullscreen');
    documentRef.body.classList.remove('has-radar-fullscreen');
    documentRef.body.style.removeProperty('top');
    windowRef.scrollTo(0, lockedScrollY);
    fullscreenOpenButton?.setAttribute('aria-expanded', 'false');
    syncMapInteractions();
    windowRef.requestAnimationFrame(() => map.invalidateSize({ pan: true, animate: false }));
    if (restoreFocus && fullscreenFocus?.isConnected) fullscreenFocus.focus();
  }

  function touchMidpoint(touches) {
    const first = touches[0];
    const second = touches[1];
    return {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
    };
  }

  mapElement.addEventListener('touchstart', (event) => {
    if (interactionMode === 'preview' && event.touches.length === 1) {
      hideGestureHint();
      return;
    }
    if (interactionMode !== 'cooperative') return;
    if (event.touches.length < 2) {
      cooperativeGesture = null;
      showGestureHint('Utilisez deux doigts pour déplacer la carte');
      return;
    }
    event.preventDefault();
    cooperativeGesture = touchMidpoint(event.touches);
  }, { passive: false });

  mapElement.addEventListener('touchmove', (event) => {
    if (interactionMode !== 'cooperative' || event.touches.length < 2 || !cooperativeGesture) return;
    event.preventDefault();
    const next = touchMidpoint(event.touches);
    map.panBy([
      cooperativeGesture.x - next.x,
      cooperativeGesture.y - next.y,
    ], { animate: false });
    const scale = next.distance / cooperativeGesture.distance;
    if (scale > 1.18 || scale < .84) {
      const rect = mapElement.getBoundingClientRect();
      const delta = scale > 1 ? 1 : -1;
      map.setZoomAround(
        [next.x - rect.left, next.y - rect.top],
        Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta)),
      );
      next.distance = touchMidpoint(event.touches).distance;
    }
    cooperativeGesture = next;
  }, { passive: false });

  mapElement.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) cooperativeGesture = null;
  }, { passive: true });

  mapElement.addEventListener('wheel', (event) => {
    if (interactionMode !== 'cooperative') return;
    if (!event.ctrlKey) {
      showGestureHint('Maintenez Ctrl et utilisez la molette pour zoomer');
      return;
    }
    event.preventDefault();
    const rect = mapElement.getBoundingClientRect();
    const delta = event.deltaY < 0 ? 1 : -1;
    map.setZoomAround(
      [event.clientX - rect.left, event.clientY - rect.top],
      Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta)),
    );
  }, { passive: false });

  filterOpenButton?.addEventListener('click', openFilterSheet);
  filterCloseButton?.addEventListener('click', () => closeFilterSheet());
  filterBackdrop?.addEventListener('click', () => closeFilterSheet());
  fullscreenOpenButton?.addEventListener('click', openFullscreenMap);
  fullscreenCloseButton?.addEventListener('click', () => closeFullscreenMap());
  root.querySelector('[data-radar-zoom-in]')?.addEventListener('click', () => map.zoomIn());
  root.querySelector('[data-radar-zoom-out]')?.addEventListener('click', () => map.zoomOut());
  root.querySelector('[data-radar-recenter]')?.addEventListener('click', () => {
    map.setView([46.6, 2.4], 6, {
      animate: !windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  });

  let swipeStart = null;
  fullscreenHandle?.addEventListener('pointerdown', (event) => {
    if (!state.fullscreen || event.pointerType !== 'touch') return;
    swipeStart = { x: event.clientX, y: event.clientY };
  });
  fullscreenHandle?.addEventListener('pointerup', (event) => {
    if (!swipeStart || event.pointerType !== 'touch') return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    swipeStart = null;
    if (deltaY > 80 && Math.abs(deltaY) > Math.abs(deltaX)) closeFullscreenMap();
  });
  fullscreenHandle?.addEventListener('pointercancel', () => {
    swipeStart = null;
  });

  filterForm.addEventListener('keydown', (event) => {
    if (!state.filterSheetOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFilterSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable(filterForm);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes.at(-1);
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  documentRef.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.filterSheetOpen) {
      event.preventDefault();
      closeFilterSheet();
      return;
    }
    if (!state.fullscreen || !briefing.hidden) return;
    event.preventDefault();
    closeFullscreenMap();
  });

  const syncResponsiveMode = () => {
    if (!filterSheetViewport.matches) closeFilterSheet({ restoreFocus: false });
    if (state.fullscreen && !filterSheetViewport.matches) {
      closeFullscreenMap({ restoreFocus: false });
    }
    syncFilterSheet();
    syncMapInteractions();
    windowRef.requestAnimationFrame(() => map.invalidateSize({ pan: state.fullscreen, animate: false }));
  };
  coarsePointer.addEventListener?.('change', syncResponsiveMode);
  compactViewport.addEventListener?.('change', syncResponsiveMode);
  filterSheetViewport.addEventListener?.('change', syncResponsiveMode);
  syncFilterSheet();
  syncMapInteractions();

  map.createPane('radarCities');
  const cityPane = map.getPane('radarCities');
  cityPane.classList.add('radar-cities-pane');
  cityPane.setAttribute('aria-hidden', 'true');
  const cities = leaflet.layerGroup().addTo(map);
  for (const [name, latitude, longitude] of RADAR_CITIES) {
    const marker = leaflet.marker([latitude, longitude], {
      pane: 'radarCities',
      interactive: false,
      keyboard: false,
      icon: leaflet.divIcon({
        className: 'radar-city-marker',
        html: `<span aria-hidden="true"><i></i>${name}</span>`,
        iconSize: [104, 18],
        iconAnchor: [7, 9],
      }),
    });
    marker.on('add', () => {
      const cityElement = marker.getElement();
      cityElement?.setAttribute('aria-hidden', 'true');
      cityElement?.setAttribute('tabindex', '-1');
    });
    cities.addLayer(marker);
  }
  const syncCityVisibility = () => {
    const visible = map.getZoom() <= 7;
    cityPane.classList.toggle('is-hidden', !visible);
    root.dataset.citiesVisible = String(visible);
  };
  syncCityVisibility();

  const departments = leaflet.geoJSON(null, {
    pane: 'radarFallback',
    interactive: false,
    style: {
      color: '#4a5537',
      weight: 1,
      opacity: 0.82,
      fillColor: '#141a0f',
      fillOpacity: 0.96,
    },
  }).addTo(map);
  fetchImpl('/data/radar-france-departments.geojson', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error('geometry');
      return response.json();
    })
    .then((geojson) => departments.addData(geojson))
    .catch(() => { status.textContent = 'Fond administratif indisponible · les parties restent consultables en liste.'; });

  const clusters = leaflet.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 48,
    iconCreateFunction(cluster) {
      return leaflet.divIcon({
        className: 'radar-cluster-shell',
        html: `<span class="radar-cluster">${cluster.getChildCount()}</span>`,
        iconSize: [44, 44],
      });
    },
  }).addTo(map);

  function currentFilters() {
    const data = new FormData(filterForm);
    return {
      location: data.get('location') || '',
      from: data.get('from') || '',
      to: data.get('to') || '',
      beginner: data.get('beginner') === 'on',
      rental: data.get('rental') === 'on',
      rules: new Set(data.getAll('rule')),
      position: state.position,
      radiusKm: Number(data.get('radiusKm') || 50),
    };
  }

  function announce(message) {
    status.textContent = message;
  }

  function closeBriefing({ history = true } = {}) {
    if (briefing.hidden) return;
    briefing.hidden = true;
    briefingTarget.replaceChildren();
    documentRef.body.classList.remove('has-radar-briefing');
    state.active = null;
    if (history && deepSlugFromPath(windowRef.location.pathname)) {
      windowRef.history.pushState({}, '', '/parties-airsoft/');
      documentRef.title = 'Parties d’airsoft en France : carte et inscriptions | F.A.T.';
      documentRef.querySelector('meta[name="robots"]')?.setAttribute('content', 'index,follow,max-image-preview:large');
    }
    state.lastFocus?.focus?.();
  }

  async function share(event) {
    const url = new URL(event.publicUrl, windowRef.location.origin).href;
    try {
      if (typeof windowRef.navigator.share === 'function' && windowRef.matchMedia('(max-width: 760px)').matches) {
        await windowRef.navigator.share({ title: event.title, text: locationText(event), url });
        return;
      }
      await windowRef.navigator.clipboard.writeText(url);
      announce('Lien de la partie copié.');
    } catch {
      announce(`Lien à copier : ${url}`);
    }
  }

  function openReport(event) {
    state.reportEvent = event;
    reportStatus.textContent = '';
    reportForm?.reset();
    reportDialog?.showModal();
    turnstileController?.activate('radar_report').catch((error) => {
      reportStatus.textContent = error.message;
    });
  }

  function openBriefing(event, trigger = null, { history = true } = {}) {
    state.lastFocus = trigger || documentRef.activeElement;
    state.active = event;
    briefingTarget.replaceChildren(briefingContent(documentRef, event, {
      share,
      report: openReport,
      shareLabel: windowRef.matchMedia('(max-width: 760px)').matches ? 'PARTAGER' : 'COPIER LE LIEN',
    }));
    briefing.hidden = false;
    documentRef.body.classList.add('has-radar-briefing');
    briefing.querySelector('[data-radar-close]')?.focus();
    if (history && windowRef.location.pathname !== event.publicUrl) {
      windowRef.history.pushState({ radarSlug: event.slug }, '', event.publicUrl);
    }
    documentRef.title = `${event.title} — partie d’airsoft | F.A.T.`;
    documentRef.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex,follow');
    const marker = state.markers.get(event.slug);
    if (marker) {
      map.panTo(marker.getLatLng(), { animate: !windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
  }

  function render() {
    const filters = currentFilters();
    state.filtered = state.events.filter((event) => eventMatchesFilters(event, filters));
    list.replaceChildren();
    clusters.clearLayers();
    state.markers.clear();
    for (const event of state.filtered) {
      list.append(listCard(documentRef, event, openBriefing));
      const latLng = toLeafletLatLng(event);
      if (!latLng) continue;
      const marker = leaflet.marker(latLng, {
        icon: markerIcon(leaflet, event),
        title: `${event.title} — ${locationText(event)}`,
        alt: event.title,
        keyboard: true,
        riseOnHover: true,
      });
      marker.bindTooltip(hoverCard(documentRef, event), {
        direction: 'top',
        className: 'radar-leaflet-tooltip',
        opacity: 1,
      });
      marker.on('click', (leafletEvent) => openBriefing(event, leafletEvent.originalEvent?.target));
      marker.on('add', () => {
        const markerElement = marker.getElement();
        if (!markerElement || markerElement.dataset.radarKeyboard === 'true') return;
        markerElement.dataset.radarKeyboard = 'true';
        markerElement.setAttribute('role', 'button');
        markerElement.setAttribute('aria-label', `Ouvrir le briefing : ${event.title}`);
        markerElement.addEventListener('keydown', (keyboardEvent) => {
          if (!['Enter', ' '].includes(keyboardEvent.key)) return;
          keyboardEvent.preventDefault();
          openBriefing(event, markerElement);
        });
      });
      clusters.addLayer(marker);
      state.markers.set(event.slug, marker);
    }
    count.textContent = plural(state.filtered.length);
    root.dataset.radarFilteredCount = String(state.filtered.length);
    root.dataset.radarMarkerCount = String(state.markers.size);
    empty.hidden = state.filtered.length !== 0;
    announce(state.filtered.length
      ? `${plural(state.filtered.length)} détectée${state.filtered.length > 1 ? 's' : ''}.`
      : 'Aucune partie ne correspond aux filtres.');
    map.invalidateSize({ pan: false });
  }

  let filterTimer = 0;
  const mobileRadius = root.querySelector('[data-radar-mobile-radius]');
  filterForm.addEventListener('input', () => {
    windowRef.clearTimeout(filterTimer);
    filterTimer = windowRef.setTimeout(render, 120);
  });
  filterForm.addEventListener('change', (event) => {
    if (event.target === filterForm.elements.radiusKm && mobileRadius) {
      mobileRadius.value = filterForm.elements.radiusKm.value;
    }
    render();
  });
  mobileRadius?.addEventListener('change', () => {
    filterForm.elements.radiusKm.value = mobileRadius.value;
    render();
  });
  filterForm.addEventListener('reset', () => {
    state.position = null;
    root.querySelector('[data-radar-geolocation]').textContent = 'Position non utilisée. Elle n’est jamais enregistrée.';
    root.querySelectorAll('[data-radar-date]').forEach((button) => button.removeAttribute('aria-pressed'));
    windowRef.setTimeout(() => {
      if (mobileRadius) mobileRadius.value = filterForm.elements.radiusKm.value;
      render();
    }, 0);
  });
  root.querySelectorAll('[data-radar-date]').forEach((button) => {
    button.addEventListener('click', () => {
      const now = new Date();
      let from = now;
      let to = now;
      if (button.dataset.radarDate === 'saturday' || button.dataset.radarDate === 'weekend') {
        from = nextWeekday(now, 6);
        to = button.dataset.radarDate === 'weekend'
          ? new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
          : from;
      } else if (button.dataset.radarDate === 'sunday') {
        from = nextWeekday(now, 0);
        to = from;
      }
      filterForm.elements.from.value = localDateValue(from);
      filterForm.elements.to.value = localDateValue(to);
      root.querySelectorAll('[data-radar-date]').forEach((candidate) => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      render();
    });
  });
  root.querySelectorAll('[data-radar-geolocate]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state.position) {
        map.setView([state.position.latitude, state.position.longitude], 8, {
          animate: !windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        return;
      }
      if (!windowRef.navigator.geolocation) {
        state.position = null;
        root.querySelector('[data-radar-geolocation]').textContent = 'Position non utilisée. Elle n’est jamais enregistrée.';
        render();
        announce('La géolocalisation n’est pas disponible dans ce navigateur. Aucun filtre n’est appliqué.');
        return;
      }
      announce('Recherche ponctuelle de votre position…');
      windowRef.navigator.geolocation.getCurrentPosition((position) => {
        state.position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        root.querySelector('[data-radar-geolocation]').textContent = `Rayon appliqué · précision ± ${Math.round(position.coords.accuracy)} m.`;
        render();
        map.setView([state.position.latitude, state.position.longitude], 8, {
          animate: !windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
      }, (error) => {
        state.position = null;
        root.querySelector('[data-radar-geolocation]').textContent = 'Position non utilisée. Elle n’est jamais enregistrée.';
        const reason = error?.code === 1
          ? 'Autorisation de position refusée.'
          : (error?.code === 3 ? 'La recherche de position a expiré.' : 'Position indisponible.');
        render();
        announce(`${reason} Aucun emplacement n’a été conservé et aucun filtre n’est appliqué.`);
      }, {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 0,
      });
    });
  });
  root.querySelector('[data-radar-widen]')?.addEventListener('click', () => {
    const select = filterForm.elements.radiusKm;
    const options = [...select.options];
    const index = options.findIndex((option) => option.value === select.value);
    select.value = options[Math.min(index + 1, options.length - 1)].value;
    if (!state.position) {
      filterForm.elements.location.value = '';
    }
    render();
  });
  root.querySelector('[data-radar-date-focus]')?.addEventListener('click', () => {
    filterForm.elements.from.focus();
    filterForm.elements.from.scrollIntoView({
      block: 'center',
      behavior: windowRef.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  });
  root.querySelector('[data-radar-show-all]')?.addEventListener('click', () => {
    filterForm.reset();
  });
  root.querySelector('[data-radar-close]')?.addEventListener('click', () => closeBriefing());

  briefing.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBriefing();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable(briefing);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes.at(-1);
    if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  let resizeFrame = 0;
  const invalidateMapSize = () => {
    windowRef.cancelAnimationFrame(resizeFrame);
    resizeFrame = windowRef.requestAnimationFrame(() => {
      map.invalidateSize({ pan: state.fullscreen, animate: false });
    });
  };
  const mapResizeObserver = typeof windowRef.ResizeObserver === 'function'
    ? new windowRef.ResizeObserver(invalidateMapSize)
    : null;
  mapResizeObserver?.observe(mapStage);
  windowRef.addEventListener('resize', invalidateMapSize);
  windowRef.addEventListener('orientationchange', invalidateMapSize);
  map.on('zoomend', () => {
    syncCityVisibility();
    map.invalidateSize({ pan: false });
  });
  map.on('moveend', () => map.invalidateSize({ pan: false }));
  windowRef.addEventListener('popstate', async () => {
    const slug = deepSlugFromPath(windowRef.location.pathname);
    if (!slug) {
      closeBriefing({ history: false });
      return;
    }
    const event = state.events.find((item) => item.slug === slug);
    if (event) openBriefing(event, null, { history: false });
    else await openDeep(slug);
  });

  reportDialog?.querySelector('[data-radar-report-close]')?.addEventListener('click', () => reportDialog.close());
  reportDialog?.addEventListener('cancel', () => {
    turnstileController?.reset('radar_report');
  });
  reportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.reportEvent) return;
    reportStatus.textContent = 'Envoi du signalement…';
    const submit = reportForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const data = new FormData(reportForm);
      const turnstileToken = await turnstileController.token('radar_report');
      await publicRepository.report(state.reportEvent.slug, {
        reason: data.get('reason'),
        message: data.get('message'),
        website: data.get('website'),
        turnstileToken,
      });
      reportStatus.textContent = 'Signalement reçu. Merci.';
      windowRef.setTimeout(() => reportDialog.close(), 900);
    } catch (error) {
      reportStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
      turnstileController?.reset('radar_report');
    }
  });

  async function openDeep(slug) {
    try {
      const payload = await publicRepository.get(slug);
      openBriefing(payload.event, null, { history: false });
    } catch {
      announce('Cette partie n’est plus disponible.');
      if (deepSlugFromPath(windowRef.location.pathname)) {
        windowRef.history.replaceState({}, '', '/parties-airsoft/');
      }
    }
  }

  async function load() {
    announce('Balayage des parties publiées…');
    try {
      const payload = await publicRepository.list();
      state.events = Array.isArray(payload?.events) ? payload.events : [];
      render();
      const slug = deepSlugFromPath(windowRef.location.pathname);
      if (slug) {
        const event = state.events.find((item) => item.slug === slug);
        if (event) openBriefing(event, null, { history: false });
        else await openDeep(slug);
      }
    } catch (error) {
      state.events = [];
      render();
      announce(error.message || 'Le radar est temporairement indisponible.');
      root.dataset.radarError = '';
    }
  }
  load();
  initRadarLaunchNotice({
    dialog: documentRef.querySelector('[data-radar-launch-notice]'),
    windowRef,
    documentRef,
  });

  return {
    map,
    basemap,
    state,
    cities,
    render,
    openBriefing,
    closeBriefing,
    openFullscreenMap,
    closeFullscreenMap,
    openFilterSheet,
    closeFilterSheet,
    load,
  };
}
