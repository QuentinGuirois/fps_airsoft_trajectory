import { validateSimulationUrl, validateYoutubeUrl } from '../../replica-utils.js?v=20260718-28';

export const REPLICA_STATES = Object.freeze(['draft', 'pending', 'published', 'rejected', 'archived']);
export const IMAGE_STATES = Object.freeze(['queued', 'processing', 'ready', 'rejected', 'failed']);

export const REPLICA_STATE_PRESENTATION = Object.freeze({
  draft: { label: 'BROUILLON', tone: 'draft' },
  pending: { label: 'EN MODÉRATION', tone: 'pending' },
  published: { label: 'PUBLIÉE', tone: 'published' },
  rejected: { label: 'REJETÉE', tone: 'rejected' },
  archived: { label: 'ARCHIVÉE', tone: 'archived' },
});

export const IMAGE_STATE_PRESENTATION = Object.freeze({
  queued: 'DÉTOURAGE EN FILE',
  processing: 'DÉTOURAGE EN COURS',
  ready: '',
  rejected: 'PHOTO REJETÉE — FOURNIS UNE AUTRE PHOTO',
  failed: 'DÉTOURAGE ÉCHOUÉ — FOURNIS UNE AUTRE PHOTO',
});

const SENSITIVE_FIELDS = new Set(['photoUrl', 'simUrl', 'massG', 'energyJ']);

export function stateAfterReplicaUpdate(currentState, changedFields = []) {
  return currentState === 'published' && changedFields.some((field) => SENSITIVE_FIELDS.has(field))
    ? 'pending'
    : currentState;
}

function safeSameOriginPath(value, origin) {
  if (typeof value !== 'string' || !value.trim() || /^(?:blob|data):/i.test(value.trim())) return '';
  try {
    const url = new URL(value, origin);
    return url.origin === new URL(origin).origin ? `${url.pathname}${url.search}` : '';
  } catch { return ''; }
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeReplicaCardData(input, {
  origin = 'https://fps-airsoft-trajectory.com',
} = {}) {
  const data = input && typeof input === 'object' ? input : {};
  const state = REPLICA_STATES.includes(data.state) ? data.state : 'draft';
  const imageStatus = IMAGE_STATES.includes(data.imageStatus) ? data.imageStatus : 'queued';
  const simulation = validateSimulationUrl(String(data.simUrl || ''), origin);
  const youtube = validateYoutubeUrl(String(data.user?.youtubeUrl || ''));
  const imagePath = safeSameOriginPath(data.photoUrl, origin);
  return {
    id: String(data.id || ''),
    name: String(data.name || 'Réplique sans nom').slice(0, 80),
    type: String(data.type || 'TYPE NON RENSEIGNÉ').slice(0, 24),
    state,
    imageStatus,
    photoUrl: /\.webp(?:\?|$)/i.test(imagePath) ? imagePath : '',
    massG: finiteOrNull(data.massG),
    energyJ: finiteOrNull(data.energyJ),
    usefulRangeM: finiteOrNull(data.usefulRangeM),
    maximumRangeM: finiteOrNull(data.maximumRangeM),
    version: Math.max(1, Number.parseInt(data.version, 10) || 1),
    curveThumbSvg: typeof data.curveThumbSvg === 'string' && data.curveThumbSvg.length <= 80_000 ? data.curveThumbSvg : '',
    simUrl: simulation.ok ? `${new URL(simulation.url).pathname}${new URL(simulation.url).search}` : '',
    user: {
      pseudo: String(data.user?.pseudo || 'OPÉRATEUR').slice(0, 32),
      avatarUrl: safeSameOriginPath(data.user?.avatarUrl, origin),
      youtubeUrl: youtube.ok ? youtube.url : '',
      chrony: data.user?.chrony === true,
    },
  };
}

const ALLOWED_SVG_TAGS = new Set(['svg', 'rect', 'line', 'path', 'circle', 'text']);
const ALLOWED_SVG_ATTRS = new Set(['xmlns', 'viewBox', 'role', 'aria-label', 'class', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'cx', 'cy', 'r', 'd']);

export function sanitizedCurveSvg(svg, doc = globalThis.document) {
  if (!doc?.defaultView?.DOMParser || typeof svg !== 'string' || !svg.trim()) return null;
  const parsed = new doc.defaultView.DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) return null;
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (!ALLOWED_SVG_TAGS.has(node.localName)) return null;
    for (const attribute of [...node.attributes]) {
      if (!ALLOWED_SVG_ATTRS.has(attribute.name) || /^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }
  return doc.importNode(root, true);
}

const format = (value, digits = 2) => value == null
  ? '—'
  : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(value);

function element(doc, tag, className, text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const HTMLElementBase = globalThis.HTMLElement || class {};

export class ReplicaCardElement extends HTMLElementBase {
  #data = normalizeReplicaCardData({});
  #slide = 'replica';
  #pointerStart = null;

  set data(value) {
    this.#data = normalizeReplicaCardData(value, { origin: globalThis.location?.origin });
    this.render();
  }
  get data() { return this.#data; }

  connectedCallback() { this.render(); }

  #dispatch(action) {
    this.dispatchEvent(new CustomEvent(`replica:${action}`, {
      bubbles: true,
      detail: { id: this.#data.id, replica: this.#data },
    }));
  }

  #setSlide(value) {
    if (value === 'curve' && !this.#data.curveThumbSvg) return;
    this.#slide = value;
    this.querySelector('.replica-card-track')?.classList.toggle('show-curve', value === 'curve');
    this.querySelectorAll('[data-card-slide]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.cardSlide === value));
    });
  }

  render() {
    if (!this.isConnected) return;
    const doc = this.ownerDocument;
    const data = this.#data;
    const management = this.getAttribute('mode') === 'management';
    const article = element(doc, 'article', `replica-card-shell replica-state-${data.state}`);
    article.dataset.state = data.state;
    article.dataset.imageStatus = data.imageStatus;
    article.setAttribute('aria-label', `${data.name}, ${REPLICA_STATE_PRESENTATION[data.state].label}`);

    const header = element(doc, 'header', 'replica-card-header');
    const avatar = element(doc, 'span', 'replica-avatar', data.user.pseudo.slice(0, 1).toUpperCase());
    if (data.user.avatarUrl) {
      const image = element(doc, 'img');
      image.src = data.user.avatarUrl;
      image.alt = '';
      avatar.replaceChildren(image);
    }
    header.append(avatar, element(doc, 'span', 'replica-pseudo', data.user.pseudo));
    const trust = element(doc, 'span', 'replica-trust', data.user.chrony ? 'CHRONY ✓' : 'DÉCLARÉ');
    trust.dataset.trust = data.user.chrony ? 'measured' : 'declared';
    header.append(trust);
    if (data.user.youtubeUrl) {
      const youtube = element(doc, 'a', 'replica-youtube', '▶ YOUTUBE');
      youtube.href = data.user.youtubeUrl;
      youtube.target = '_blank';
      youtube.rel = 'ugc noopener noreferrer';
      header.append(youtube);
    }
    if (management) {
      const state = element(doc, 'span', 'replica-state-badge', REPLICA_STATE_PRESENTATION[data.state].label);
      state.dataset.tone = REPLICA_STATE_PRESENTATION[data.state].tone;
      header.append(state);
    }

    const media = element(doc, 'div', 'replica-card-media');
    const track = element(doc, 'div', 'replica-card-track');
    const replicaPane = element(doc, 'div', 'replica-card-pane replica-card-photo');
    if (data.photoUrl && data.imageStatus === 'ready') {
      const image = element(doc, 'img');
      image.src = data.photoUrl;
      image.alt = `Vue latérale de ${data.name}`;
      image.loading = 'lazy';
      replicaPane.append(image);
    } else {
      const status = IMAGE_STATE_PRESENTATION[data.imageStatus] || 'PHOTO MANQUANTE';
      replicaPane.append(element(doc, 'span', 'replica-media-placeholder', status || 'PHOTO MANQUANTE'));
    }
    const curvePane = element(doc, 'div', 'replica-card-pane replica-card-curve');
    const curve = sanitizedCurveSvg(data.curveThumbSvg, doc);
    if (curve) curvePane.append(curve);
    else curvePane.append(element(doc, 'span', 'replica-media-placeholder', 'COURBE NON ENREGISTRÉE'));
    track.append(replicaPane, curvePane);
    media.append(track);

    const toggle = element(doc, 'div', 'replica-card-toggle');
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Média de la carte');
    for (const [value, label] of [['replica', 'RÉPLIQUE'], ['curve', 'COURBE']]) {
      const button = element(doc, 'button', '', label);
      button.type = 'button';
      button.dataset.cardSlide = value;
      button.setAttribute('aria-pressed', String(value === this.#slide));
      if (value === 'curve' && !curve) button.disabled = true;
      button.addEventListener('click', () => this.#setSlide(value));
      toggle.append(button);
    }
    media.append(toggle);
    media.addEventListener('pointerdown', (event) => { this.#pointerStart = event.clientX; });
    media.addEventListener('pointerup', (event) => {
      if (this.#pointerStart == null || Math.abs(event.clientX - this.#pointerStart) < 42) return;
      this.#setSlide(event.clientX < this.#pointerStart ? 'curve' : 'replica');
      this.#pointerStart = null;
    });

    const body = element(doc, 'div', 'replica-card-body');
    const heading = element(doc, 'div', 'replica-card-heading');
    heading.append(element(doc, 'h2', '', data.name), element(doc, 'span', '', data.type));
    body.append(heading);
    const stats = element(doc, 'dl', 'replica-card-stats');
    for (const [label, value, key] of [
      ['BILLE', `${format(data.massG)} g`, 'mass'],
      ['ÉNERGIE', `${format(data.energyJ)} J`, 'energy'],
      ['P. UTILE', `${format(data.usefulRangeM, 0)} m`, 'useful'],
      ['P. MAX', `${format(data.maximumRangeM, 0)} m`, 'maximum'],
    ]) {
      const item = element(doc, 'div');
      item.dataset.metric = key;
      item.append(element(doc, 'dt', '', label), element(doc, 'dd', '', value));
      stats.append(item);
    }
    body.append(stats);

    const actions = element(doc, 'div', 'replica-card-actions');
    if (management) {
      const primary = element(doc, 'button', data.state === 'draft' ? 'button-primary' : '', data.state === 'draft' ? 'TERMINER' : 'MODIFIER');
      primary.type = 'button';
      primary.addEventListener('click', () => this.#dispatch('edit'));
      actions.append(primary);
      if (data.simUrl) {
        const curveLink = element(doc, 'a', '', 'COURBE');
        curveLink.href = data.simUrl;
        actions.append(curveLink);
      }
      if (['rejected', 'failed'].includes(data.imageStatus)) {
        const retry = element(doc, 'button', '', 'NOUVELLE PHOTO');
        retry.type = 'button';
        retry.addEventListener('click', () => this.#dispatch('retry'));
        actions.append(retry);
      }
      if (data.state !== 'archived') {
        const archive = element(doc, 'button', 'replica-archive', 'ARCHIVER');
        archive.type = 'button';
        archive.addEventListener('click', () => this.#dispatch('archive'));
        actions.append(archive);
      }
    } else {
      if (data.simUrl) {
        const open = element(doc, 'a', 'button-primary', 'OUVRIR LA COURBE →');
        open.href = data.simUrl;
        actions.append(open);
        const copy = element(doc, 'button', 'replica-copy', '⧉');
        copy.type = 'button';
        copy.setAttribute('aria-label', 'Copier le lien de la courbe');
        copy.addEventListener('click', async () => {
          const url = new URL(data.simUrl, location.origin).href;
          try { await navigator.clipboard.writeText(url); } catch { /* Le lien principal reste disponible. */ }
          const live = this.querySelector('.replica-card-live');
          if (live) live.textContent = 'Copié';
        });
        actions.append(copy);
      }
    }
    body.append(actions, element(doc, 'span', 'replica-card-live visually-hidden'));
    body.lastElementChild.setAttribute('aria-live', 'polite');
    article.append(header, media, body);
    this.replaceChildren(article);
    this.#setSlide(this.#slide);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('replica-card')) {
  customElements.define('replica-card', ReplicaCardElement);
}
