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
  specific: ['RÈGLE SPÉCIFIQUE', '◆'],
  forbidden: ['INTERDIT', '×'],
  not_communicated: ['NON COMMUNIQUÉ', '?'],
});

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
  if (event.locationVisibility === 'approximate') {
    return `${event.locationLabel || event.city || 'Commune non précisée'} · position approximative`;
  }
  return event.locationLabel || [event.city, event.departmentCode].filter(Boolean).join(' · ') || 'Lieu communiqué';
}

function plural(count) {
  return `${count} PARTIE${count > 1 ? 'S' : ''}`;
}

function markerIcon(L) {
  return L.divIcon({
    className: 'radar-marker-shell',
    html: '<span class="radar-pin" aria-hidden="true"><i></i></span>',
    iconSize: [44, 50],
    iconAnchor: [22, 48],
    tooltipAnchor: [0, -34],
  });
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
  if (event.locationVisibility === 'approximate') pills.append(element(documentRef, 'span', '', 'POSITION APPROXIMATIVE'));

  const facts = element(documentRef, 'dl', 'radar-briefing-facts');
  const factsData = [
    ['DATE', `${formatDate(event.startsAt)} → ${formatDate(event.endsAt)}`],
    ['TERRAIN', event.venueName || 'Non communiqué'],
    ['LIEU', locationText(event)],
    ['SECTEUR', [event.department, event.region].filter(Boolean).join(' · ') || 'Non communiqué'],
    ['CAPACITÉ', event.maxCapacity == null ? 'Non communiquée' : `${event.maxCapacity} joueurs maximum`],
    ['TARIF', event.priceCents == null ? 'Non communiqué' : PRICE.format(event.priceCents / 100)],
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
  if (isWgs84(event.latitude, event.longitude)) {
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
    community.append(link(documentRef, item.url, item.type.toUpperCase()));
  }
  const organizer = element(documentRef, 'p', 'radar-organizer', `ORGANISATEUR // ${event.organizer?.pseudo || 'Compte F.A.T.'}`);
  const privacy = element(documentRef, 'p', 'radar-privacy-note', 'Aucune adresse email de l’organisateur n’est affichée. Vérifiez les informations sur le lien d’inscription.');
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
    event.priceCents == null ? '' : PRICE.format(event.priceCents / 100),
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
  const filterForm = root.querySelector('[data-radar-filters]');
  const status = root.querySelector('[data-radar-status]');
  const count = root.querySelector('[data-radar-count]');
  const list = root.querySelector('[data-radar-list]');
  const empty = root.querySelector('[data-radar-empty]');
  const briefing = root.querySelector('[data-radar-briefing]');
  const briefingTarget = root.querySelector('[data-radar-briefing-content]');
  const reportDialog = documentRef.querySelector('[data-radar-report]');
  const reportForm = reportDialog?.querySelector('[data-radar-report-form]');
  const reportStatus = reportDialog?.querySelector('[data-radar-report-status]');
  const state = {
    events: [],
    filtered: [],
    position: null,
    active: null,
    lastFocus: null,
    markers: new Map(),
    reportEvent: null,
  };

  const map = leaflet.map(mapElement, {
    center: [46.6, 2.4],
    zoom: 6,
    minZoom: 5,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: true,
    maxBounds: [[40.5, -7], [52.5, 11]],
    preferCanvas: true,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Limites © IGN ADMIN EXPRESS COG CARTO PE 2026');

  const departments = leaflet.geoJSON(null, {
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
      if (!latLng || event.locationVisibility !== 'exact') continue;
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
    empty.hidden = state.filtered.length !== 0;
    announce(state.filtered.length
      ? `${plural(state.filtered.length)} détectée${state.filtered.length > 1 ? 's' : ''}.`
      : 'Aucune partie ne correspond aux filtres.');
    map.invalidateSize({ pan: false });
  }

  let filterTimer = 0;
  filterForm.addEventListener('input', () => {
    windowRef.clearTimeout(filterTimer);
    filterTimer = windowRef.setTimeout(render, 120);
  });
  filterForm.addEventListener('change', render);
  filterForm.addEventListener('reset', () => {
    state.position = null;
    root.querySelector('[data-radar-geolocation]').textContent = 'Position non utilisée.';
    root.querySelectorAll('[data-radar-date]').forEach((button) => button.removeAttribute('aria-pressed'));
    windowRef.setTimeout(render, 0);
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
      if (!windowRef.navigator.geolocation) {
        announce('La géolocalisation n’est pas disponible dans ce navigateur.');
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
        map.setView([state.position.latitude, state.position.longitude], 8);
      }, () => announce('Position refusée ou indisponible. Aucun emplacement n’a été conservé.'), {
        enableHighAccuracy: false,
        timeout: 8_000,
        maximumAge: 300_000,
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
  windowRef.addEventListener('resize', () => map.invalidateSize({ pan: false }));
  map.on('zoomend moveend', () => map.invalidateSize({ pan: false }));
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

  return { map, state, render, openBriefing, closeBriefing, load };
}
