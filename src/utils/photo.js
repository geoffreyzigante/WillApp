// Helpers purs autour de la photo et de la course (event/race).
// Pas de fetch, pas de hook -- juste manipulation de strings + objets.

// ID monotone court pour les items en queue d'upload. Format :
// {base36 timestamp}_{base36 random}. Collision tres improbable a 1ph/ms.
export function generateItemId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Extrait le burstTs (unix ms) depuis la cle R2 d'une photo.
// Format: {event}/{photographer}/{date}/{time}_{burstTs}_{idx}.heic
// Sert pour grouper les freres d'un meme burst dans /personal-gallery.
export const extractBurstTs = (key) => {
  if (!key) return 0;
  const filename = key.split('/').pop().replace(/\.(jpg|jpeg|png|heic|dng)$/i, '');
  const parts = filename.split('_');
  if (parts.length < 3) return 0;
  const ts = parseInt(parts[parts.length - 2], 10);
  return isNaN(ts) ? 0 : ts;
};

// Index dans le burst (0..N). Cle de tri secondaire au sein d'une rafale
// (idx DESC -> derniere photo prise en tete de groupe, coherent avec le
// tri principal "newest first" entre rafales).
export const extractIdx = (key) => {
  if (!key) return 0;
  const filename = key.split('/').pop().replace(/\.(jpg|jpeg|png|heic|dng)$/i, '');
  const parts = filename.split('_');
  if (parts.length < 3) return 0;
  const idx = parseInt(parts[parts.length - 1], 10);
  return isNaN(idx) ? 0 : idx;
};

// Compose le titre d'une course. label_only=true => juste le label (mode
// nom personnalise). Sinon => `${label} ${km} km` ou `${km} km`.
export function raceTitle({ label, label_only, km } = {}) {
  const l = (label || '').toString().trim();
  if (label_only && l) return l;
  if (l) return `${l} ${km} km`;
  return `${km} km`;
}

// Titre depuis une photo (race + race_label + race_label_only).
export function raceTitleFromPhoto(p) {
  if (!p || p.race === null || p.race === undefined || p.race === '') return '';
  return raceTitle({ label: p.race_label, label_only: p.race_label_only, km: p.race });
}

// Detecte l'extension d'une photo depuis l'URL (puis HEAD si absent).
// MediaLibrary.saveToLibraryAsync exige un fichier local nomme avec une
// extension valide, sinon echoue avec "Could not get the file's extension".
export async function detectPhotoExtension(url) {
  const fromUrl = String(url || '').match(/\.(jpe?g|png|heic|heif|dng|webp)(\?|#|$)/i);
  if (fromUrl) {
    const e = fromUrl[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('heic') || ct.includes('heif')) return 'heic';
    if (ct.includes('png')) return 'png';
    if (ct.includes('x-adobe-dng') || ct.includes('dng')) return 'dng';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  } catch {}
  return 'jpg';
}
