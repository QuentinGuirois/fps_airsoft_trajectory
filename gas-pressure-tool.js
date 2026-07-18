export const PSI_PER_BAR = 14.5037738;
export const MIN_TEMPERATURE_C = -15;
export const MAX_TEMPERATURE_C = 40;

const POINT_PRESENTATIONS = Object.freeze({
  manufacturer_test_point: {
    label: 'valeur publiée',
    tone: 'published',
    warning: '',
  },
  manufacturer_or_distributor_anchor: {
    label: 'valeur source à la température de référence',
    tone: 'published',
    warning: '',
  },
  interpolated_manufacturer_grid: {
    label: 'interpolation entre mesures publiées',
    tone: 'interpolated',
    warning: '',
  },
  estimated_propane_ratio: {
    label: 'estimation depuis la valeur fabricant/distributeur',
    tone: 'estimated',
    warning: '',
  },
  extrapolated_propane_ratio: {
    label: 'extrapolation hors de la plage mesurée',
    tone: 'extrapolated',
    warning: 'Cette valeur est extrapolée au-delà des mesures publiées : son incertitude est renforcée.',
  },
});

const LEGACY_PRODUCT_IDS = Object.freeze({
  'puff-dino-12kg-171': 'puff-dino-12kg-silicone',
  'puff-dino-14kg-199-dry': 'puff-dino-14kg-dry',
});

export function psiToBar(psi) {
  const value = Number(psi);
  return Number.isFinite(value) ? value / PSI_PER_BAR : Number.NaN;
}

export function isUsableGasData(data) {
  if (!Array.isArray(data?.products) || data.products.length === 0) return false;
  if (!Array.isArray(data?.brands) || data.brands.length === 0) return false;
  if (!Array.isArray(data?.sources) || data.sources.length === 0) return false;
  return data.products.every((product) => (
    typeof product.id === 'string'
    && typeof product.brand === 'string'
    && Array.isArray(product.curve)
    && product.curve.length === 56
    && Array.isArray(product.packagingOptions)
    && product.packagingOptions.length > 0
  ));
}

export function normalizeTemperature(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return normalizeTemperature(fallback, 20);
  return Math.min(MAX_TEMPERATURE_C, Math.max(MIN_TEMPERATURE_C, Math.round(parsed)));
}

export function productsForBrand(data, brand) {
  if (!data?.products || typeof brand !== 'string') return [];
  return data.products
    .filter((product) => product.brand === brand)
    .sort((first, second) => first.model.localeCompare(second.model, 'fr'));
}

export function productById(data, id) {
  const resolvedId = LEGACY_PRODUCT_IDS[id] ?? id;
  return data?.products?.find((product) => product.id === resolvedId) ?? null;
}

export function pointForTemperature(product, temperatureC) {
  const temperature = normalizeTemperature(temperatureC);
  return product?.curve?.find((point) => point.temperatureC === temperature) ?? null;
}

export function pointPresentation(status) {
  return POINT_PRESENTATIONS[status] ?? {
    label: 'estimation documentée',
    tone: 'estimated',
    warning: '',
  };
}

export function fullProductName(product) {
  return product ? `${product.brand} — ${product.model}` : '';
}

export function siliconePresentation(value) {
  if (value === 'yes') return { label: 'LUBRIFIÉ', detail: 'avec silicone', tone: 'lubricated' };
  if (value === 'no') return { label: 'SEC', detail: 'sans silicone', tone: 'dry' };
  return { label: 'NON DOCUMENTÉ', detail: 'lubrification non documentée', tone: 'unknown' };
}

export function confidencePresentation(value) {
  if (value === 'high') return 'élevé';
  if (value === 'medium') return 'moyen';
  return 'non qualifié';
}

export function productOptionLabel(product) {
  const condition = siliconePresentation(product?.silicone).detail;
  return product ? `${product.model} · ${product.labelPsi} PSI · ${condition}` : '';
}

export function normalizePackageIndex(product, value) {
  const lastIndex = Math.max(0, (product?.packagingOptions?.length ?? 1) - 1);
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 0;
  return Math.min(lastIndex, Math.max(0, parsed));
}

export function packagingOptionLabel(option) {
  if (!option) return 'Conditionnement non documenté';
  const parts = [];
  if (option.label) parts.push(option.label);
  if (option.containerMl != null) parts.push(`bouteille ${option.containerMl} ml`);
  if (option.fillMl != null) parts.push(`${option.fillMl} ml de gaz`);
  if (option.fillGrams != null) parts.push(`${option.fillGrams} g`);
  if (option.sku) parts.push(`SKU ${option.sku}`);
  if (option.ean) parts.push(`EAN ${option.ean}`);
  return parts.join(' · ') || 'Conditionnement documenté';
}

export function resolveSelection(data, search = '', storedSelection = {}) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search).replace(/^\?/, ''));
  const products = data?.products ?? [];
  const brands = (data?.brands?.map((entry) => entry.brand) ?? [...new Set(products.map((product) => product.brand))])
    .sort((first, second) => first.localeCompare(second, 'fr'));
  const fallbackProduct = products[0] ?? null;

  const urlProduct = params.has('gas') ? productById(data, params.get('gas')) : null;
  const urlBrand = params.has('brand') && brands.includes(params.get('brand')) ? params.get('brand') : null;
  const storedProduct = productById(data, storedSelection?.gas);
  const storedBrand = brands.includes(storedSelection?.brand) ? storedSelection.brand : null;

  let product = urlProduct;
  let brand = urlProduct?.brand ?? urlBrand;

  if (!product && brand) product = productsForBrand(data, brand)[0] ?? null;
  if (!product && !params.has('brand') && !params.has('gas')) {
    product = storedProduct ?? (storedBrand ? productsForBrand(data, storedBrand)[0] : null);
    brand = product?.brand ?? storedBrand;
  }
  product ??= fallbackProduct;
  brand = product?.brand ?? brand ?? brands[0] ?? '';

  const storedTemperature = normalizeTemperature(storedSelection?.t, 20);
  const temperatureC = params.has('t')
    ? normalizeTemperature(params.get('t'), storedTemperature)
    : storedTemperature;
  const packageIndex = normalizePackageIndex(
    product,
    params.has('pack') ? params.get('pack') : storedSelection?.pack,
  );

  return {
    temperatureC,
    brand,
    gas: product?.id ?? '',
    packageIndex,
  };
}

export function selectionSearchParams(selection) {
  const params = new URLSearchParams();
  params.set('t', String(normalizeTemperature(selection?.temperatureC)));
  if (selection?.brand) params.set('brand', selection.brand);
  if (selection?.gas) params.set('gas', selection.gas);
  params.set('pack', String(Math.max(0, Math.trunc(Number(selection?.packageIndex) || 0))));
  return params;
}

export function resultForSelection(data, selection) {
  const product = productById(data, selection?.gas);
  if (!product) return null;
  const temperatureC = normalizeTemperature(selection?.temperatureC);
  const point = pointForTemperature(product, temperatureC);
  if (!point) return null;
  const packageIndex = normalizePackageIndex(product, selection?.packageIndex);
  return {
    product,
    point,
    temperatureC,
    packageIndex,
    packagingOption: product.packagingOptions?.[packageIndex] ?? null,
    estimatedPsi: point.estimatedPsi,
    estimatedBar: psiToBar(point.estimatedPsi),
    presentation: pointPresentation(point.pointStatus),
  };
}
