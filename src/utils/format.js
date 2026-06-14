// Formatters d'affichage purs (pas de hook React, pas de side effect).
// Utilises a la fois cote screen et cote composants UI.

// Shutter format : EXIF stocke en seconds. Photographes lisent en 1/N.
// Au-dela d'1s, on garde la notation "Xs" par securite -- jamais vu en pratique
// vu qu'on cap le shutter cote AVCapture.
export function formatShutter(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

// EV BrightnessValue : peut etre negatif (faible lumiere) ou positif (plein
// jour). Signe explicite pour lecture rapide cote voyant luminosite.
export function formatEV(ev) {
  if (!Number.isFinite(ev)) return '—';
  const sign = ev >= 0 ? '+' : '−';
  return `EV ${sign}${Math.abs(ev).toFixed(1)}`;
}

// "il y a quelques secondes" / "il y a 3 min" / "hier" / "le 11/5" -- alerte
// de reprise au demarrage du screen photographe (queue non vide).
export function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'il y a quelques secondes';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  try {
    const d = new Date(ts);
    return `le ${d.getDate()}/${d.getMonth() + 1}`;
  } catch { return ''; }
}

// Mois en francais accentues. Utilises par formatDateLong / formatDateForForm.
export const MONTHS_FULL = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
export const MONTHS_SHORT = ['JANV','FÉVR','MARS','AVR','MAI','JUIN','JUIL','AOÛT','SEPT','OCT','NOV','DÉC'];

// Dates events : single ou plage avec optimisation lecture (memoire dates
// communes : meme mois / meme annee). Tolere isoEnd identique a iso (event 1 jour).
export const formatDateLong = (iso, isoEnd) => {
  if (!iso) return 'Date à venir';
  const ds = new Date(iso);
  if (isNaN(ds.getTime())) return 'Date à venir';
  const single = (d) => `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  if (!isoEnd || isoEnd === iso) return single(ds);
  const de = new Date(isoEnd);
  if (isNaN(de.getTime())) return single(ds);
  const sameYear = ds.getFullYear() === de.getFullYear();
  const sameMonth = sameYear && ds.getMonth() === de.getMonth();
  if (sameMonth) {
    return `Du ${ds.getDate()} au ${de.getDate()} ${MONTHS_FULL[de.getMonth()]} ${de.getFullYear()}`;
  }
  if (sameYear) {
    return `Du ${ds.getDate()} ${MONTHS_FULL[ds.getMonth()]} au ${de.getDate()} ${MONTHS_FULL[de.getMonth()]} ${de.getFullYear()}`;
  }
  return `Du ${ds.getDate()} ${MONTHS_FULL[ds.getMonth()]} ${ds.getFullYear()} au ${de.getDate()} ${MONTHS_FULL[de.getMonth()]} ${de.getFullYear()}`;
};

// Variante affichage formulaire creation event : sur 1 jour on prefixe par le
// jour de la semaine court ("VEN. 15 MAI 2026").
export const formatDateForForm = (iso, isoEnd) => {
  if (!iso) return '';
  const start = new Date(iso); start.setHours(0, 0, 0, 0);
  if (isNaN(start.getTime())) return '';
  if (!isoEnd || isoEnd === iso) {
    const wd = start.toLocaleDateString('fr-FR', { weekday: 'short' }).replace(/\./g, '').toUpperCase();
    return `${wd}. ${formatDateLong(iso, null)}`;
  }
  return formatDateLong(iso, isoEnd);
};

// "a venir / en cours" tant que end (ou start si pas d end) n est pas passe.
// Tolerance 1 jour pour eviter qu un event en cours disparaisse a minuit pile.
export const isUpcoming = (iso, isoEnd) => {
  const ref = isoEnd || iso;
  if (!ref) return true;
  const d = new Date(ref);
  if (isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now() - 86400000;
};

// Label affiche pour event_type ; la valeur stockee reste sans accent ("Velo").
export const displayEventType = (t) => (t === 'Velo' ? 'Vélo' : t);

// "Louviers (27400)" -> "Louviers (27)". Code postal raccourci pour
// l affichage compact dans EventCard.
export const cityLabel = (location) => {
  if (!location) return '';
  return String(location).replace(/\((\d{2})\d{3}\)/, '($1)');
};
