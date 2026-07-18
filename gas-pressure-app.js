import {
  confidencePresentation,
  fullProductName,
  isUsableGasData,
  normalizeTemperature,
  normalizePackageIndex,
  packagingOptionLabel,
  productById,
  productOptionLabel,
  productsForBrand,
  resolveSelection,
  resultForSelection,
  selectionSearchParams,
  siliconePresentation,
} from './gas-pressure-tool.js';

const DATA_URL = '/data/green-gas-pressure-curves.json';
const STORAGE_KEY = 'fat-green-gas-selection-v1';
const REQUIRED_DISCLAIMER = 'La pression affichée est une estimation théorique calculée à partir des valeurs publiées par les fabricants ou distributeurs. Elle ne garantit ni la pression réelle dans un chargeur, ni la compatibilité avec une réplique, ni la puissance obtenue.';

const elements = {
  form: document.querySelector('[data-gas-form]'),
  temperature: document.querySelector('#gas-temperature'),
  temperatureRange: document.querySelector('#gas-temperature-range'),
  temperatureOutput: document.querySelector('#gas-temperature-output'),
  brand: document.querySelector('#gas-brand'),
  product: document.querySelector('#gas-product'),
  packageStep: document.querySelector('[data-package-step]'),
  package: document.querySelector('#gas-package'),
  status: document.querySelector('#gas-tool-status'),
  result: document.querySelector('#gas-result'),
  psi: document.querySelector('#gas-result-psi'),
  bar: document.querySelector('#gas-result-bar'),
  name: document.querySelector('#gas-result-name'),
  siliconeBadge: document.querySelector('#gas-silicone-badge'),
  commercial: document.querySelector('#gas-result-commercial'),
  reference: document.querySelector('#gas-result-reference'),
  selectedTemperature: document.querySelector('#gas-result-temperature'),
  packaging: document.querySelector('#gas-result-packaging'),
  confidence: document.querySelector('#gas-result-confidence'),
  identifiers: document.querySelector('#gas-result-identifiers'),
  precise: document.querySelector('#gas-result-precise'),
  kind: document.querySelector('#gas-result-kind'),
  kindPill: document.querySelector('#gas-result-kind-pill'),
  rangeWarning: document.querySelector('#gas-range-warning'),
  extrapolationWarning: document.querySelector('#gas-extrapolation-warning'),
  notes: document.querySelector('#gas-result-notes'),
  sources: document.querySelector('#gas-result-sources'),
  collectionDate: document.querySelector('#gas-result-date'),
  copy: document.querySelector('#gas-copy'),
  share: document.querySelector('#gas-share'),
  feedback: document.querySelector('#gas-share-feedback'),
  compare: document.querySelector('#gas-compare'),
  compareResult: document.querySelector('#gas-compare-result'),
  chartPrimary: document.querySelector('#gas-chart-primary'),
  chartComparison: document.querySelector('#gas-chart-comparison'),
  chartMarker: document.querySelector('#gas-chart-marker'),
  chartComparisonMarker: document.querySelector('#gas-chart-comparison-marker'),
  chartMinLabel: document.querySelector('#gas-chart-min-label'),
  chartMaxLabel: document.querySelector('#gas-chart-max-label'),
  chartCaption: document.querySelector('#gas-chart-caption'),
};

const numberFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const preciseFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });

let data = null;
let state = null;
let currentResult = null;

function readStoredSelection() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSelection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      t: state.temperatureC,
      brand: state.brand,
      gas: state.gas,
      pack: state.packageIndex,
    }));
  } catch {
    // Le résultat reste utilisable lorsque le stockage privé est indisponible.
  }
}

function updateUrl() {
  const params = selectionSearchParams(state);
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
}

function fillSelect(select, options, selectedValue) {
  select.replaceChildren();
  for (const { value, label } of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    select.append(option);
  }
}

function populateBrands() {
  fillSelect(
    elements.brand,
    data.brands
      .map(({ brand }) => brand)
      .sort((first, second) => first.localeCompare(second, 'fr'))
      .map((brand) => ({ value: brand, label: brand })),
    state.brand,
  );
}

function populateProducts(preferredId = state.gas) {
  const products = productsForBrand(data, state.brand);
  const selected = products.some(({ id }) => id === preferredId) ? preferredId : products[0]?.id;
  state.gas = selected ?? '';
  fillSelect(
    elements.product,
    products.map((product) => ({ value: product.id, label: productOptionLabel(product) })),
    state.gas,
  );
}

function populatePackaging(preferredIndex = state.packageIndex) {
  const product = productById(data, state.gas);
  const options = product?.packagingOptions ?? [];
  state.packageIndex = normalizePackageIndex(product, preferredIndex);
  fillSelect(
    elements.package,
    options.map((option, index) => ({ value: String(index), label: packagingOptionLabel(option) })),
    String(state.packageIndex),
  );
  const hasSeveralOptions = options.length > 1;
  elements.packageStep.hidden = !hasSeveralOptions;
  elements.package.disabled = !hasSeveralOptions;
}

function populateComparison() {
  const previous = elements.compare.value;
  const fragment = document.createDocumentFragment();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Choisir une deuxième bouteille';
  fragment.append(empty);
  for (const { brand } of data.brands) {
    const group = document.createElement('optgroup');
    group.label = brand;
    for (const product of productsForBrand(data, brand)) {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = productOptionLabel(product);
      group.append(option);
    }
    fragment.append(group);
  }
  elements.compare.replaceChildren(fragment);
  elements.compare.value = previous === state.gas ? '' : previous;
}

function formatOperatingRange(range) {
  if (!range || (range.min == null && range.max == null)) return 'aucune plage publiée';
  if (range.min != null && range.max != null) return `de ${range.min} à ${range.max} °C`;
  if (range.min != null) return `à partir de ${range.min} °C`;
  return `jusqu’à ${range.max} °C`;
}

function commercialPressureText(product) {
  if (product.labelPsi === product.referencePsi) return `${product.labelPsi} PSI`;
  return `${product.labelPsi} PSI (nom commercial ; ancre fabricant ${product.referencePsi} PSI)`;
}

function renderSources(product) {
  const sourceMap = new Map(data.sources.map((source) => [source.id, source]));
  elements.sources.replaceChildren();
  for (const sourceId of product.sourceIds) {
    const source = sourceMap.get(sourceId);
    if (!source) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.publisher;
    const detail = document.createElement('span');
    detail.textContent = ` — ${source.supports}`;
    item.append(link, detail);
    elements.sources.append(item);
  }
}

function renderNotes(product) {
  elements.notes.replaceChildren();
  for (const note of product.notesFr ?? []) {
    const item = document.createElement('li');
    item.textContent = note;
    elements.notes.append(item);
  }
  elements.notes.closest('[data-notes-block]').hidden = elements.notes.childElementCount === 0;
}

function setWarning(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function chartTrust(tone) {
  if (tone === 'published') return 'measured';
  if (tone === 'interpolated') return 'interpolated';
  if (tone === 'extrapolated') return 'extrapolated';
  return 'estimated';
}

function renderPressureChart(compared = null) {
  if (!currentResult || !elements.chartPrimary) return;
  const primaryCurve = currentResult.product.curve;
  const comparisonCurve = compared?.product.curve ?? [];
  const points = [...primaryCurve, ...comparisonCurve];
  const minPsi = Math.min(...points.map((point) => point.estimatedPsi));
  const maxPsi = Math.max(...points.map((point) => point.estimatedPsi));
  const span = Math.max(maxPsi - minPsi, 1);
  const x = (temperatureC) => 48 + ((temperatureC + 15) / 55) * 652;
  const y = (psi) => 174 - ((psi - minPsi) / span) * 146;
  const pathFor = (curve) => curve.map((point, index) => `${index ? 'L' : 'M'}${x(point.temperatureC).toFixed(1)} ${y(point.estimatedPsi).toFixed(1)}`).join(' ');
  const primaryPoint = primaryCurve.find((point) => point.temperatureC === state.temperatureC);

  elements.chartPrimary.setAttribute('d', pathFor(primaryCurve));
  elements.chartMarker.setAttribute('cx', x(state.temperatureC).toFixed(1));
  elements.chartMarker.setAttribute('cy', y(primaryPoint.estimatedPsi).toFixed(1));
  elements.chartMinLabel.textContent = `${numberFormat.format(minPsi)} PSI`;
  elements.chartMaxLabel.textContent = `${numberFormat.format(maxPsi)} PSI`;

  if (compared) {
    const comparisonPoint = comparisonCurve.find((point) => point.temperatureC === state.temperatureC);
    elements.chartComparison.setAttribute('d', pathFor(comparisonCurve));
    elements.chartComparison.hidden = false;
    elements.chartComparisonMarker.setAttribute('cx', x(state.temperatureC).toFixed(1));
    elements.chartComparisonMarker.setAttribute('cy', y(comparisonPoint.estimatedPsi).toFixed(1));
    elements.chartComparisonMarker.hidden = false;
    elements.chartCaption.textContent = `${fullProductName(currentResult.product)} et ${fullProductName(compared.product)} ; les points marquent ${state.temperatureC} °C.`;
  } else {
    elements.chartComparison.hidden = true;
    elements.chartComparisonMarker.hidden = true;
    elements.chartCaption.textContent = `${fullProductName(currentResult.product)} ; le point marque ${state.temperatureC} °C.`;
  }
}

function renderResult({ announce = true } = {}) {
  currentResult = resultForSelection(data, state);
  if (!currentResult) return;
  const { product, point, presentation, packagingOption, estimatedPsi, estimatedBar, temperatureC } = currentResult;
  const silicone = siliconePresentation(product.silicone);
  const hasSeveralPackages = product.packagingOptions?.length > 1;
  const sku = packagingOption?.sku ?? (hasSeveralPackages ? null : product.sku);
  const ean = packagingOption?.ean ?? (hasSeveralPackages ? null : product.ean);

  elements.psi.textContent = numberFormat.format(estimatedPsi);
  elements.bar.textContent = preciseFormat.format(estimatedBar);
  elements.name.textContent = fullProductName(product);
  elements.siliconeBadge.textContent = silicone.label;
  elements.siliconeBadge.dataset.tone = silicone.tone;
  elements.commercial.textContent = commercialPressureText(product);
  elements.reference.textContent = `${product.referencePsi} PSI à ${product.referenceTemperatureC} °C`;
  elements.selectedTemperature.textContent = `${temperatureC} °C`;
  elements.packaging.textContent = packagingOptionLabel(packagingOption);
  elements.confidence.textContent = confidencePresentation(product.confidence);
  elements.identifiers.textContent = [sku ? `SKU ${sku}` : '', ean ? `EAN ${ean}` : ''].filter(Boolean).join(' · ')
    || (hasSeveralPackages ? 'non documentés pour ce format' : 'non documentés');
  elements.precise.textContent = `${preciseFormat.format(estimatedPsi)} PSI · ${preciseFormat.format(estimatedBar)} bar`;
  elements.kind.textContent = presentation.label;
  elements.kindPill.textContent = presentation.label;
  elements.kindPill.dataset.tone = presentation.tone;
  elements.kindPill.dataset.trust = chartTrust(presentation.tone);
  elements.collectionDate.textContent = dateFormat.format(new Date(`${data.generatedAt}T00:00:00Z`));

  setWarning(
    elements.rangeWarning,
    point.insidePublishedOperatingRange === false
      ? `Température hors de la plage d’utilisation publiée (${formatOperatingRange(product.operatingRangeC)}). Cette indication n’est pas une validation de sécurité.`
      : '',
  );
  setWarning(elements.extrapolationWarning, presentation.warning);
  renderSources(product);
  renderNotes(product);
  elements.result.hidden = false;
  if (announce) elements.status.textContent = `${fullProductName(product)} : ${numberFormat.format(estimatedPsi)} PSI à ${temperatureC} °C.`;
  renderPressureChart();
  renderComparison();
}

function appendComparisonRow(body, label, result) {
  const row = document.createElement('tr');
  const name = document.createElement('th');
  const psi = document.createElement('td');
  const bar = document.createElement('td');
  const origin = document.createElement('td');
  name.scope = 'row';
  name.textContent = label;
  psi.textContent = `${numberFormat.format(result.estimatedPsi)} PSI`;
  bar.textContent = `${preciseFormat.format(result.estimatedBar)} bar`;
  const tag = document.createElement('span');
  tag.className = 'trust-tag';
  tag.dataset.trust = chartTrust(result.presentation.tone);
  tag.textContent = result.presentation.label;
  origin.append(tag);
  row.append(name, psi, bar, origin);
  body.append(row);
}

function renderComparison() {
  const gas = elements.compare.value;
  if (!gas || gas === state.gas) {
    elements.compareResult.hidden = true;
    elements.compareResult.replaceChildren();
    renderPressureChart();
    return;
  }
  const compared = resultForSelection(data, { gas, temperatureC: state.temperatureC });
  if (!compared) return;
  const difference = compared.estimatedPsi - currentResult.estimatedPsi;
  const sign = difference > 0 ? '+' : '';
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const body = document.createElement('tbody');
  caption.textContent = `Comparaison à ${state.temperatureC} °C`;
  for (const text of ['Bouteille', 'Pression', 'Équivalent', 'Provenance']) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.textContent = text;
    headRow.append(header);
  }
  head.append(headRow);
  appendComparisonRow(body, fullProductName(currentResult.product), currentResult);
  appendComparisonRow(body, fullProductName(compared.product), compared);
  table.append(caption, head, body);
  const summary = document.createElement('p');
  summary.textContent = `Écart : ${sign}${numberFormat.format(difference)} PSI. Cette différence ne constitue pas une échelle de sécurité.`;
  elements.compareResult.replaceChildren(table, summary);
  elements.compareResult.hidden = false;
  renderPressureChart(compared);
}

function syncTemperature(value, { commit = true } = {}) {
  const temperatureC = normalizeTemperature(value, state.temperatureC);
  state.temperatureC = temperatureC;
  elements.temperature.value = String(temperatureC);
  elements.temperatureRange.value = String(temperatureC);
  elements.temperatureOutput.textContent = `${temperatureC} °C`;
  if (commit) commitSelection();
}

function commitSelection() {
  saveSelection();
  updateUrl();
  renderResult();
}

function resultText() {
  if (!currentResult) return '';
  const { product, packagingOption, estimatedPsi, estimatedBar, temperatureC, presentation } = currentResult;
  return [
    `${fullProductName(product)} à ${temperatureC} °C`,
    `${numberFormat.format(estimatedPsi)} PSI (${preciseFormat.format(estimatedBar)} bar)`,
    `${siliconePresentation(product.silicone).label} · ${packagingOptionLabel(packagingOption)}`,
    `Pression commerciale : ${commercialPressureText(product)}`,
    `Confiance des données : ${confidencePresentation(product.confidence)}`,
    `Type : ${presentation.label}`,
    'Résultat théorique estimé, à vérifier dans les conditions réelles.',
    REQUIRED_DISCLAIMER,
    location.href,
  ].join('\n');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copie indisponible');
}

function showFeedback(message) {
  elements.feedback.textContent = message;
  window.setTimeout(() => {
    if (elements.feedback.textContent === message) elements.feedback.textContent = '';
  }, 4000);
}

async function handleCopy() {
  try {
    await copyText(resultText());
    showFeedback('Résultat copié.');
  } catch {
    showFeedback('La copie automatique est indisponible sur ce navigateur.');
  }
}

async function handleShare() {
  const product = currentResult?.product;
  if (!product) return;
  const shareData = {
    title: `Pression théorique — ${fullProductName(product)}`,
    text: resultText(),
    url: location.href,
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showFeedback('Résultat partagé.');
    } catch (error) {
      if (error?.name !== 'AbortError') await handleCopy();
    }
    return;
  }
  await handleCopy();
}

function bindEvents() {
  elements.form.addEventListener('submit', (event) => event.preventDefault());
  elements.temperatureRange.addEventListener('input', () => syncTemperature(elements.temperatureRange.value));
  elements.temperature.addEventListener('change', () => syncTemperature(elements.temperature.value));
  elements.temperature.addEventListener('input', () => {
    if (elements.temperature.value !== '') syncTemperature(elements.temperature.value);
  });
  elements.brand.addEventListener('change', () => {
    state.brand = elements.brand.value;
    populateProducts('');
    populatePackaging(0);
    populateComparison();
    commitSelection();
  });
  elements.product.addEventListener('change', () => {
    state.gas = elements.product.value;
    populatePackaging(0);
    populateComparison();
    commitSelection();
  });
  elements.package.addEventListener('change', () => {
    state.packageIndex = normalizePackageIndex(productById(data, state.gas), elements.package.value);
    commitSelection();
  });
  elements.compare.addEventListener('change', renderComparison);
  elements.copy.addEventListener('click', handleCopy);
  elements.share.addEventListener('click', handleShare);
}

async function initialize() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    if (!isUsableGasData(data)) throw new Error('Jeu de données gaz vide ou incomplet');
    state = resolveSelection(data, location.search, readStoredSelection());
    populateBrands();
    populateProducts(state.gas);
    populatePackaging(state.packageIndex);
    populateComparison();
    syncTemperature(state.temperatureC, { commit: false });
    bindEvents();
    saveSelection();
    updateUrl();
    renderResult({ announce: false });
    elements.status.textContent = `Outil chargé : ${data.products.length} références disponibles.`;
    document.documentElement.dataset.gasPressureReady = 'true';
  } catch (error) {
    elements.status.textContent = 'Impossible de charger les données de pression. Réessaie après une première visite en ligne.';
    elements.form.setAttribute('aria-disabled', 'true');
    for (const control of elements.form.elements) control.disabled = true;
    console.error('Chargement de l’outil gaz impossible', error);
  }
}

initialize();
