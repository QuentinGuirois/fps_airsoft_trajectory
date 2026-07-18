const SIMULATION_PATHS = new Set([
  '/',
  '/index.html',
  '/simulateur-trajectoire-airsoft/',
]);

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseDecimal(value) {
  const text = String(value ?? '').trim();
  if (!DECIMAL.test(text)) return Number.NaN;
  return Number(text);
}

function parseOrigin(origin) {
  try {
    return new URL(origin);
  } catch {
    return new URL('https://fps-airsoft-trajectory.com');
  }
}

/**
 * Valide un lien produit par le calculateur sans faire confiance aux valeurs
 * qu'il contient. Le serveur devra appliquer exactement les mêmes contrôles.
 */
export function validateSimulationUrl(value, origin = 'https://fps-airsoft-trajectory.com') {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'Le lien de simulation est obligatoire.' };
  }

  const base = parseOrigin(origin);
  let url;
  try {
    url = new URL(value.trim(), base);
  } catch {
    return { ok: false, message: 'Le lien de simulation n’est pas valide.' };
  }

  if (url.origin !== base.origin || url.username || url.password) {
    return { ok: false, message: 'Le lien doit pointer vers le simulateur F.A.T.' };
  }
  if (!SIMULATION_PATHS.has(url.pathname)) {
    return { ok: false, message: 'Utilise le lien généré par le simulateur F.A.T.' };
  }
  if (url.searchParams.getAll('m').length !== 1 || url.searchParams.getAll('j').length !== 1) {
    return { ok: false, message: 'Le lien doit contenir une seule valeur de grammage et d’énergie.' };
  }

  const massG = parseDecimal(url.searchParams.get('m'));
  const energyJ = parseDecimal(url.searchParams.get('j'));
  if (!Number.isFinite(massG) || massG < 0.01 || massG > 5
    || !Number.isFinite(energyJ) || energyJ <= 0 || energyJ > 20) {
    return { ok: false, message: 'Les paramètres du lien ne ressemblent pas à une simulation valide.' };
  }

  return { ok: true, url: url.toString(), massG, energyJ };
}

export function validateYoutubeUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: true, url: '' };

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, message: 'Le lien YouTube est invalide.' };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.protocol !== 'https:' || url.username || url.password
    || !['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    return { ok: false, message: 'Le lien optionnel doit être une URL YouTube HTTPS.' };
  }
  return { ok: true, url: url.toString() };
}

function validatePlainText(value, { label, min, max }) {
  const normalized = String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) {
    return { ok: false, message: `${label} doit contenir entre ${min} et ${max} caractères.` };
  }
  if (/[\u0000-\u001f\u007f<>]/.test(normalized) || /https?:\/\//i.test(normalized)) {
    return { ok: false, message: `${label} contient un caractère ou un lien interdit.` };
  }
  return { ok: true, value: normalized };
}

export function validatePseudo(value) {
  return validatePlainText(value, { label: 'Le pseudo', min: 2, max: 32 });
}

export function validateReplicaName(value) {
  return validatePlainText(value, { label: 'Le nom de la réplique', min: 2, max: 80 });
}

/**
 * Contrôle précoce côté navigateur. Le MIME réel, les dimensions et le contenu
 * doivent être détectés à nouveau côté serveur avant tout stockage.
 */
export function validatePhoto(file) {
  if (!file || typeof file !== 'object') {
    return { ok: false, message: 'Ajoute une photo latérale de ta réplique.' };
  }
  if (!PHOTO_TYPES.has(String(file.type || '').toLowerCase())) {
    return { ok: false, message: 'Formats acceptés : JPEG, PNG ou WebP.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024) {
    return { ok: false, message: 'La photo doit être valide et faire 8 Mo maximum.' };
  }
  return { ok: true };
}

export const REPLICA_SUBMISSION_LIMITS = Object.freeze({
  maximumPhotoBytes: 8 * 1024 * 1024,
  maximumImageEdge: 6000,
  publicImageEdge: 1600,
  allowedPhotoTypes: Object.freeze([...PHOTO_TYPES]),
});
