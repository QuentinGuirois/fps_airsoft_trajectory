const RULES = Object.freeze([
  ['assault', 'ASSAUT'],
  ['dmr', 'DMR'],
  ['sniper', 'SNIPER'],
  ['cqb', 'CQB'],
  ['detonating_grenades', 'GRENADES DÉTONANTES'],
  ['co2_grenades', 'GRENADES CO₂'],
  ['smoke_grenades', 'FUMIGÈNES'],
]);

const STATES = Object.freeze([
  ['allowed', 'Autorisé'],
  ['specific', 'Règle spécifique'],
  ['forbidden', 'Interdit'],
  ['not_communicated', 'Non communiqué'],
]);

const STATE_LABELS = Object.freeze({
  draft: 'BROUILLON',
  published: 'PUBLIÉE',
  cancelled: 'ANNULÉE',
  expired: 'EXPIRÉE',
});

function element(documentRef, tag, className = '', text = '') {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function optionalNumber(value, multiplier = 1) {
  if (String(value ?? '').trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * multiplier) : null;
}

function value(form, name) {
  return form.elements[name]?.value ?? '';
}

export function collectOwnerPayload(form, currentEvent, ruleEditor) {
  const rules = [...ruleEditor.querySelectorAll('[data-rule-type]')].map((row) => ({
    type: row.dataset.ruleType,
    state: row.querySelector('[data-rule-state]').value,
    joules: row.querySelector('[data-rule-joules]').value || null,
    details: row.querySelector('[data-rule-details]').value || null,
  }));
  const links = ['website', 'facebook', 'helloasso', 'discord', 'instagram']
    .map((type) => ({ type, url: value(form, `link_${type}`).trim() }))
    .filter(({ url }) => url);
  const toilets = value(form, 'toiletsAvailable');
  const payload = {
    version: currentEvent.version,
    title: value(form, 'title'),
    venueName: value(form, 'venueName') || null,
    description: value(form, 'description') || null,
    startLocal: value(form, 'startLocal') || null,
    endLocal: value(form, 'endLocal') || null,
    scenario: value(form, 'scenario') || null,
    level: value(form, 'level') || null,
    beginnersWelcome: Boolean(form.elements.beginnersWelcome.checked),
    maxCapacity: optionalNumber(value(form, 'maxCapacity')),
    priceCents: optionalNumber(value(form, 'priceEuros'), 100),
    minimumAge: optionalNumber(value(form, 'minimumAge')),
    rentalDetails: value(form, 'rentalDetails') || null,
    cateringDetails: value(form, 'cateringDetails') || null,
    toiletsAvailable: toilets === '' ? null : toilets === 'yes',
    latitude: currentEvent.latitude,
    longitude: currentEvent.longitude,
    locationMethod: currentEvent.latitude == null ? null : (currentEvent.locationMethod || 'manual'),
    locationConfirmed: Boolean(form.elements.locationConfirmed.checked),
    locationVisibility: value(form, 'locationVisibility'),
    exactAddress: value(form, 'exactAddress') || null,
    publicLocationLabel: value(form, 'publicLocationLabel') || null,
    city: value(form, 'city') || null,
    postalCode: value(form, 'postalCode') || null,
    departmentCode: value(form, 'departmentCode') || null,
    department: value(form, 'department') || null,
    region: value(form, 'region') || null,
    registrationUrl: value(form, 'registrationUrl') || null,
    rules,
    links,
  };
  const contactEmail = value(form, 'contactEmail').trim();
  if (contactEmail || !currentEvent.contactEmailConfigured) payload.contactEmail = contactEmail;
  return payload;
}

function initializeRuleEditor(ruleEditor, documentRef) {
  for (const [type] of RULES) {
    const row = ruleEditor.querySelector(`[data-rule-type="${type}"]`);
    const select = element(documentRef, 'select');
    select.dataset.ruleState = '';
    select.setAttribute('aria-label', `État ${type}`);
    for (const [state, label] of STATES) {
      const option = element(documentRef, 'option', '', label);
      option.value = state;
      select.append(option);
    }
    const joules = element(documentRef, 'input');
    joules.dataset.ruleJoules = '';
    joules.type = 'number';
    joules.min = '.01';
    joules.max = '10';
    joules.step = '.01';
    joules.placeholder = 'Joules';
    joules.setAttribute('aria-label', `Joules ${type}`);
    const details = element(documentRef, 'input');
    details.dataset.ruleDetails = '';
    details.maxLength = 240;
    details.placeholder = 'Détail facultatif';
    details.setAttribute('aria-label', `Détail ${type}`);
    row.append(select, joules, details);
  }
}

function fill(form, event, ruleEditor) {
  const values = {
    title: event.title,
    venueName: event.venueName,
    description: event.description,
    startLocal: event.startLocal,
    endLocal: event.endLocal,
    scenario: event.scenario,
    level: event.level,
    maxCapacity: event.maxCapacity,
    priceEuros: event.priceCents == null ? '' : event.priceCents / 100,
    minimumAge: event.minimumAge,
    rentalDetails: event.rentalDetails,
    cateringDetails: event.cateringDetails,
    toiletsAvailable: event.toiletsAvailable == null ? '' : (event.toiletsAvailable ? 'yes' : 'no'),
    exactAddress: event.exactAddress,
    publicLocationLabel: event.publicLocationLabel,
    city: event.city,
    postalCode: event.postalCode,
    departmentCode: event.departmentCode,
    department: event.department,
    region: event.region,
    locationVisibility: event.locationVisibility,
    registrationUrl: event.registrationUrl,
  };
  for (const [name, fieldValue] of Object.entries(values)) {
    if (form.elements[name]) form.elements[name].value = fieldValue ?? '';
  }
  form.elements.beginnersWelcome.checked = Boolean(event.beginnersWelcome);
  form.elements.locationConfirmed.checked = Boolean(event.locationConfirmed);
  form.elements.contactEmail.value = '';
  form.elements.contactEmail.placeholder = event.contactEmailConfigured
    ? 'Email déjà chiffré — saisir pour remplacer'
    : 'organisateur@exemple.fr';
  for (const type of ['website', 'facebook', 'helloasso', 'discord', 'instagram']) {
    form.elements[`link_${type}`].value = event.links?.find((link) => link.type === type)?.url || '';
  }
  for (const [type] of RULES) {
    const row = ruleEditor.querySelector(`[data-rule-type="${type}"]`);
    const rule = event.rules?.find((candidate) => candidate.type === type);
    row.querySelector('[data-rule-state]').value = rule?.state || 'not_communicated';
    row.querySelector('[data-rule-joules]').value = rule?.joules ?? '';
    row.querySelector('[data-rule-details]').value = rule?.details || '';
  }
}

function formatDate(value) {
  if (!value) return 'Non renseignée';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function ownerStateLabel(event) {
  return STATE_LABELS[event.state] || event.state.toUpperCase();
}

function ownerCard(documentRef, event, handlers) {
  const card = element(documentRef, 'article', 'radar-owner-card');
  card.dataset.state = event.state;
  const header = element(documentRef, 'header');
  const status = element(documentRef, 'span', 'radar-owner-state', ownerStateLabel(event));
  header.append(status, element(documentRef, 'small', '', `V${event.version}`));
  const title = element(documentRef, 'h2', '', event.title);
  const place = element(documentRef, 'p', 'radar-owner-card-place', event.publicLocationLabel || event.city || 'Position à renseigner');
  const dates = element(documentRef, 'p', 'radar-owner-card-date', `${formatDate(event.startLocal)} → ${formatDate(event.endLocal)}`);
  const progress = element(documentRef, 'p', 'radar-owner-card-progress', [
    event.locationConfirmed ? 'POINT CONFIRMÉ' : 'POINT À CONFIRMER',
    `${event.rules?.length || 0}/7 RÈGLES`,
    event.registrationUrl ? 'INSCRIPTION OK' : 'LIEN MANQUANT',
  ].join(' · '));
  const actions = element(documentRef, 'div', 'radar-owner-card-actions');
  const duplicate = element(documentRef, 'button', 'button', 'DUPLIQUER');
  duplicate.type = 'button';
  duplicate.addEventListener('click', () => handlers.duplicate(event));
  if (['draft', 'published'].includes(event.state)) {
    const edit = element(documentRef, 'button', 'button button-primary', event.state === 'draft' ? 'REPRENDRE' : 'MODIFIER');
    edit.type = 'button';
    edit.addEventListener('click', () => handlers.edit(event.id));
    actions.append(edit);
  }
  actions.append(duplicate);
  if (event.state === 'published') {
    const view = element(documentRef, 'a', 'button', 'VOIR');
    view.href = event.publicUrl;
    const cancel = element(documentRef, 'button', 'button', 'ANNULER');
    cancel.type = 'button';
    cancel.addEventListener('click', () => handlers.sensitive('cancel', event));
    actions.append(view, cancel);
  }
  if (event.state !== 'deleted') {
    const remove = element(documentRef, 'button', 'radar-owner-delete', 'SUPPRIMER');
    remove.type = 'button';
    remove.addEventListener('click', () => handlers.sensitive('delete', event));
    actions.append(remove);
  }
  card.append(header, title, place, dates, progress, actions);
  return card;
}

export function initMyRadarEvents({
  root,
  accountRepository,
  ownerRepository,
  turnstileController,
  leaflet = globalThis.L,
  fetchImpl = globalThis.fetch,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (!root || !accountRepository || !ownerRepository) return null;
  const listView = root.querySelector('[data-owner-list-view]');
  const editor = root.querySelector('[data-owner-editor]');
  const grid = root.querySelector('[data-owner-grid]');
  const status = root.querySelector('[data-owner-status]');
  const summary = root.querySelector('[data-owner-summary]');
  const count = root.querySelector('[data-owner-count]');
  const login = root.querySelector('[data-owner-login]');
  const form = root.querySelector('[data-owner-form]');
  const autosaveStatus = root.querySelector('[data-autosave-status]');
  const ruleEditor = root.querySelector('[data-rule-editor]');
  const preview = root.querySelector('[data-owner-preview]');
  const actionDialog = root.querySelector('[data-owner-action-dialog]');
  const actionStatus = actionDialog.querySelector('[data-action-status]');
  const state = {
    session: null,
    events: [],
    current: null,
    step: 0,
    map: null,
    marker: null,
    saveTimer: 0,
    savePromise: null,
    saveQueued: false,
    geocodeController: null,
    pendingAction: null,
  };
  initializeRuleEditor(ruleEditor, documentRef);

  function announce(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setStep(next) {
    state.step = Math.max(0, Math.min(4, next));
    root.querySelectorAll('[data-editor-step]').forEach((fieldset) => {
      fieldset.hidden = Number(fieldset.dataset.editorStep) !== state.step;
    });
    root.querySelectorAll('[data-step-indicator]').forEach((item) => {
      const index = Number(item.dataset.stepIndicator);
      item.dataset.state = index === state.step ? 'active' : (index < state.step ? 'done' : 'pending');
      item.querySelector('button').setAttribute('aria-current', index === state.step ? 'step' : 'false');
    });
    root.querySelector('[data-step-reading]').textContent = `ÉTAPE ${state.step + 1} / 5`;
    root.querySelector('[data-step-previous]').disabled = state.step === 0;
    root.querySelector('[data-step-next]').hidden = state.step === 4;
    if (state.step === 0) windowRef.setTimeout(() => state.map?.invalidateSize({ pan: false }), 20);
    if (state.step === 4) renderPreview();
  }

  function updateLocationReading() {
    const reading = root.querySelector('[data-location-reading]');
    if (state.current?.latitude == null || state.current?.longitude == null) {
      reading.textContent = 'Aucun point sélectionné.';
      return;
    }
    reading.textContent = `WGS84 ${Number(state.current.latitude).toFixed(7)}, ${Number(state.current.longitude).toFixed(7)} · ${form.elements.locationConfirmed.checked ? 'confirmé' : 'à confirmer'}.`;
  }

  function updateMarker({ center = false } = {}) {
    if (!state.map || state.current?.latitude == null || state.current?.longitude == null) {
      state.marker?.remove();
      state.marker = null;
      updateLocationReading();
      return;
    }
    const latLng = [Number(state.current.latitude), Number(state.current.longitude)];
    if (!state.marker) {
      state.marker = leaflet.marker(latLng, { draggable: true, title: 'Position confirmée de la partie' }).addTo(state.map);
      state.marker.on('dragend', () => {
        const next = state.marker.getLatLng();
        setPosition(next.lat, next.lng, 'manual');
      });
    } else {
      state.marker.setLatLng(latLng);
    }
    if (center) state.map.setView(latLng, 13);
    updateLocationReading();
  }

  function setPosition(latitude, longitude, method, suggestion = null) {
    state.current.latitude = Number(latitude);
    state.current.longitude = Number(longitude);
    state.current.locationMethod = method;
    state.current.locationConfirmed = false;
    form.elements.locationConfirmed.checked = false;
    if (suggestion) {
      form.elements.exactAddress.value = suggestion.label || '';
      form.elements.publicLocationLabel.value ||= suggestion.city || suggestion.label || '';
      for (const [field, key] of [
        ['city', 'city'], ['postalCode', 'postalCode'], ['departmentCode', 'departmentCode'],
        ['department', 'department'], ['region', 'region'],
      ]) form.elements[field].value = suggestion[key] || '';
    }
    updateMarker({ center: true });
    scheduleSave();
  }

  function initializeMap() {
    if (state.map || !leaflet) return;
    state.map = leaflet.map('radar-owner-map', {
      center: [46.6, 2.4],
      zoom: 6,
      minZoom: 5,
      maxZoom: 17,
      attributionControl: true,
    });
    state.map.attributionControl.setPrefix(false);
    state.map.attributionControl.addAttribution('Limites © IGN ADMIN EXPRESS COG CARTO PE 2026');
    const boundary = leaflet.geoJSON(null, {
      interactive: false,
      style: { color: '#4a5537', weight: 1, fillColor: '#141a0f', fillOpacity: .96 },
    }).addTo(state.map);
    fetchImpl('/data/radar-france-departments.geojson', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((geojson) => boundary.addData(geojson))
      .catch(() => {});
    state.map.on('click', ({ latlng }) => setPosition(latlng.lat, latlng.lng, 'manual'));
  }

  function renderPreview() {
    preview.replaceChildren();
    if (!state.current) return;
    const payload = collectOwnerPayload(form, state.current, ruleEditor);
    const title = element(documentRef, 'h2', '', payload.title || 'Brouillon sans titre');
    const facts = element(documentRef, 'dl');
    const rows = [
      ['DATE', `${formatDate(payload.startLocal)} → ${formatDate(payload.endLocal)}`],
      ['TERRAIN', payload.venueName || 'À renseigner'],
      ['LIEU', payload.publicLocationLabel || 'À renseigner'],
      ['POSITION', payload.locationConfirmed ? 'Point confirmé' : 'Point à confirmer'],
      ['CAPACITÉ', payload.maxCapacity == null ? 'À renseigner' : `${payload.maxCapacity} joueurs maximum`],
      ['TOILETTES', payload.toiletsAvailable == null ? 'À renseigner' : (payload.toiletsAvailable ? 'Oui' : 'Non')],
      ['INSCRIPTION', payload.registrationUrl ? 'Lien HTTPS renseigné' : 'Lien manquant'],
      ['RÈGLES', `${payload.rules.length}/7 lignes`],
    ];
    for (const [label, text] of rows) facts.append(
      element(documentRef, 'dt', '', label),
      element(documentRef, 'dd', '', text),
    );
    const warning = element(documentRef, 'p', 'radar-owner-preview-note', 'Relisez le briefing public. La publication devient visible immédiatement si le contrôle serveur réussit.');
    preview.append(title, facts, warning);
  }

  function populate(event) {
    state.current = structuredClone(event);
    fill(form, state.current, ruleEditor);
    root.querySelector('[data-editor-title]').textContent = event.title;
    autosaveStatus.textContent = `Version ${event.version} · ${event.state === 'draft' ? 'brouillon' : 'publiée'}.`;
    initializeMap();
    updateMarker({ center: true });
    setStep(0);
  }

  function showEditor(event) {
    listView.hidden = true;
    editor.hidden = false;
    populate(event);
    editor.scrollIntoView({ block: 'start' });
  }

  function closeEditor() {
    windowRef.clearTimeout(state.saveTimer);
    editor.hidden = true;
    listView.hidden = false;
    state.current = null;
    loadEvents();
  }

  async function saveNow() {
    if (!state.current || !['draft', 'published'].includes(state.current.state)) return state.current;
    if (state.savePromise) {
      state.saveQueued = true;
      await state.savePromise;
      return state.saveQueued ? saveNow() : state.current;
    }
    state.saveQueued = false;
    const payload = collectOwnerPayload(form, state.current, ruleEditor);
    autosaveStatus.textContent = 'Enregistrement serveur…';
    state.savePromise = ownerRepository.update(state.current.id, payload)
      .then(({ event }) => {
        state.current = event;
        autosaveStatus.textContent = `Enregistré · version ${event.version}.`;
        root.querySelector('[data-editor-title]').textContent = event.title;
        updateLocationReading();
        return event;
      })
      .catch((error) => {
        autosaveStatus.textContent = error.message;
        autosaveStatus.dataset.tone = 'error';
        throw error;
      })
      .finally(() => { state.savePromise = null; });
    const saved = await state.savePromise;
    if (state.saveQueued) return saveNow();
    return saved;
  }

  function scheduleSave() {
    if (!state.current) return;
    autosaveStatus.textContent = 'Modifications en attente…';
    autosaveStatus.dataset.tone = '';
    windowRef.clearTimeout(state.saveTimer);
    state.saveTimer = windowRef.setTimeout(() => saveNow().catch(() => {}), 800);
  }

  async function edit(id) {
    announce('Ouverture du briefing…');
    try {
      const { event } = await ownerRepository.get(id);
      showEditor(event);
    } catch (error) {
      announce(error.message, 'error');
    }
  }

  async function duplicate(event) {
    announce(`Duplication de « ${event.title} »…`);
    try {
      const payload = await ownerRepository.duplicate(event.id);
      await loadEvents();
      showEditor(payload.event);
    } catch (error) {
      announce(error.message, 'error');
    }
  }

  function sensitive(type, event) {
    state.pendingAction = { type, event };
    const action = type === 'cancel' ? 'radar_cancel' : 'radar_delete';
    actionDialog.querySelector('[data-action-title]').textContent = type === 'cancel' ? 'Annuler la partie publiée ?' : 'Supprimer cette partie ?';
    actionDialog.querySelector('[data-action-description]').textContent = type === 'cancel'
      ? 'Elle disparaîtra immédiatement du radar. Son URL indiquera encore son annulation.'
      : 'La fiche sera supprimée de ton espace et de toutes les réponses publiques.';
    actionDialog.querySelectorAll('[data-turnstile-action]').forEach((container) => {
      container.hidden = container.dataset.turnstileAction !== action;
    });
    actionDialog.querySelectorAll('[data-turnstile-message]').forEach((message) => {
      message.hidden = message.dataset.turnstileMessage !== action;
    });
    actionStatus.textContent = '';
    actionDialog.showModal();
    turnstileController.activate(action).catch((error) => { actionStatus.textContent = error.message; });
  }

  function renderList() {
    grid.replaceChildren();
    const published = state.events.filter((event) => event.state === 'published').length;
    const drafts = state.events.filter((event) => event.state === 'draft').length;
    summary.textContent = `${published} PUBLIÉE${published > 1 ? 'S' : ''} · ${drafts} BROUILLON${drafts > 1 ? 'S' : ''}`;
    count.textContent = String(state.events.length);
    const handlers = { edit, duplicate, sensitive };
    for (const event of state.events) grid.append(ownerCard(documentRef, event, handlers));
    if (!state.events.length) {
      const empty = element(documentRef, 'div', 'radar-owner-empty');
      empty.append(
        element(documentRef, 'span', '', '◎'),
        element(documentRef, 'h2', '', 'Aucune partie en préparation'),
        element(documentRef, 'p', '', 'Créez un brouillon, confirmez le point et publiez lorsque le briefing est complet.'),
      );
      grid.append(empty);
    }
  }

  async function loadEvents() {
    announce('Synchronisation des parties…');
    try {
      const payload = await ownerRepository.list();
      state.events = payload.events || [];
      renderList();
      announce(`${state.events.length} fiche${state.events.length > 1 ? 's' : ''} synchronisée${state.events.length > 1 ? 's' : ''}.`, 'success');
    } catch (error) {
      announce(error.message, 'error');
    }
  }

  async function initialize() {
    try {
      const session = await accountRepository.getSession();
      if (!session.authenticated) {
        login.hidden = false;
        root.querySelector('[data-owner-create]').hidden = true;
        announce('Connexion requise pour gérer des parties.');
        return;
      }
      state.session = session;
      ownerRepository.client.setCsrfToken(session.csrfToken);
      root.querySelector('[data-account-pseudo]').textContent = session.user.pseudo;
      await loadEvents();
      if (new URLSearchParams(windowRef.location.search).get('action') === 'create') {
        root.querySelector('[data-owner-create]').click();
      }
    } catch (error) {
      login.hidden = false;
      announce(error.message, 'error');
    }
  }

  root.querySelector('[data-owner-create]').addEventListener('click', async () => {
    announce('Création du brouillon…');
    try {
      const { event } = await ownerRepository.create();
      showEditor(event);
    } catch (error) {
      announce(error.message, 'error');
    }
  });
  root.querySelector('[data-editor-close]').addEventListener('click', closeEditor);
  root.querySelector('[data-step-previous]').addEventListener('click', () => setStep(state.step - 1));
  root.querySelector('[data-step-next]').addEventListener('click', async () => {
    try {
      await saveNow();
      setStep(state.step + 1);
    } catch {}
  });
  root.querySelectorAll('[data-step-indicator] button').forEach((button) => {
    button.addEventListener('click', () => setStep(Number(button.parentElement.dataset.stepIndicator)));
  });
  form.addEventListener('input', (event) => {
    if (event.target.name === 'locationSearch') return;
    if (event.target.name === 'locationConfirmed') state.current.locationConfirmed = event.target.checked;
    scheduleSave();
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'locationConfirmed') updateLocationReading();
  });

  let geocodeTimer = 0;
  form.elements.locationSearch.addEventListener('input', () => {
    windowRef.clearTimeout(geocodeTimer);
    const query = form.elements.locationSearch.value.trim();
    const output = root.querySelector('[data-geocode-results]');
    if (query.length < 4) {
      output.replaceChildren();
      root.querySelector('[data-geocode-status]').textContent = 'La recherche démarre à partir de quatre caractères.';
      return;
    }
    geocodeTimer = windowRef.setTimeout(async () => {
      state.geocodeController?.abort();
      state.geocodeController = new AbortController();
      root.querySelector('[data-geocode-status]').textContent = 'Recherche IGN…';
      try {
        const payload = await ownerRepository.geocode(query, { signal: state.geocodeController.signal });
        output.replaceChildren();
        for (const suggestion of payload.suggestions || []) {
          const button = element(documentRef, 'button', 'radar-geocode-result');
          button.type = 'button';
          button.append(
            element(documentRef, 'strong', '', suggestion.label),
            element(documentRef, 'small', '', [suggestion.postalCode, suggestion.city, suggestion.region].filter(Boolean).join(' · ')),
          );
          button.addEventListener('click', () => {
            setPosition(suggestion.latitude, suggestion.longitude, 'geocoded', suggestion);
            output.replaceChildren();
            root.querySelector('[data-geocode-status]').textContent = `Point IGN sélectionné · ${suggestion.source}.`;
          });
          output.append(button);
        }
        root.querySelector('[data-geocode-status]').textContent = payload.suggestions?.length
          ? `${payload.suggestions.length} résultat${payload.suggestions.length > 1 ? 's' : ''} IGN.`
          : 'Aucun résultat IGN.';
      } catch (error) {
        if (error.name !== 'AbortError') root.querySelector('[data-geocode-status]').textContent = error.message;
      }
    }, 350);
  });

  root.querySelector('[data-owner-publish]').addEventListener('click', async () => {
    const button = root.querySelector('[data-owner-publish]');
    button.disabled = true;
    try {
      await saveNow();
      const turnstileToken = await turnstileController.token('radar_publish');
      const payload = await ownerRepository.publish(state.current.id, state.current.version, turnstileToken);
      state.current = payload.event;
      autosaveStatus.textContent = 'Partie publiée sur le Radar.';
      turnstileController.reset('radar_publish');
      windowRef.setTimeout(closeEditor, 700);
    } catch (error) {
      autosaveStatus.textContent = error.message;
      autosaveStatus.dataset.tone = 'error';
      turnstileController.reset('radar_publish');
    } finally {
      button.disabled = false;
    }
  });

  actionDialog.querySelector('[data-action-close]').addEventListener('click', () => actionDialog.close());
  actionDialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.pendingAction) return;
    const { type, event: radarEvent } = state.pendingAction;
    const action = type === 'cancel' ? 'radar_cancel' : 'radar_delete';
    const confirm = actionDialog.querySelector('[data-action-confirm]');
    confirm.disabled = true;
    actionStatus.textContent = 'Validation en cours…';
    try {
      const token = await turnstileController.token(action);
      if (type === 'cancel') await ownerRepository.cancel(radarEvent.id, radarEvent.version, token);
      else await ownerRepository.delete(radarEvent.id, radarEvent.version, token);
      actionDialog.close();
      await loadEvents();
    } catch (error) {
      actionStatus.textContent = error.message;
    } finally {
      confirm.disabled = false;
      turnstileController.reset(action);
    }
  });
  root.querySelector('[data-account-logout]').addEventListener('click', async () => {
    try { await accountRepository.logout(); } finally { windowRef.location.assign('/compte/'); }
  });

  initialize();
  return { state, loadEvents, saveNow, setStep, showEditor, closeEditor };
}
