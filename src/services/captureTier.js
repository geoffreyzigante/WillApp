// Niveaux de capture — adapte le nombre de photos au materiel ET a la course.
//
// POURQUOI
// --------
// Le declencheur par lignes suppose un plancher de latence capteur. Trois
// photos exigent que le coureur reste entre les lignes au moins deux fois
// cette latence. Un telephone lent ne peut pas tenir cette promesse : plutot
// que de le refuser, on degrade par paliers.
//
//   Niveau 1  3 lignes  -> 3 photos
//   Niveau 2  2 lignes  -> 2 photos
//   Niveau 3  1 ligne   -> 1 photo (la plus centree, la meilleure pour
//                          Rekognition)
//
// Un niveau n'est qu'un `lineOffsets` de longueur differente : lineTrigger.js
// n'a AUCUNE modification a subir, computeLines mappe deja sur le tableau.
//
// Deux proprietes verifiees par simulation sur le module reel :
//   - le niveau 3 ne rate personne (1 photo garantie jusqu'a 5 m/s sur un
//     appareil a 700 ms, par le failsafe F1) ;
//   - le palier produit de MEILLEURES photos, pas seulement un affichage
//     honnete : a 300 ms la config 3 lignes donne deja 2 photos, mais prises
//     presque au meme endroit (les deux premieres lignes franchies), la ou la
//     config 2 lignes les espace deliberement.
//
// Module PUR : aucun import, aucune horloge interne, rejouable. Les seuils
// sont des donnees, pas de la logique — ils se testent et se poussent par
// /config sans rebuild.

// Vitesse de reference par discipline, en m/s. Sert a choisir le niveau :
// un meme telephone ne merite pas le meme niveau sur une marche et sur du
// velo. La cle est normalisee depuis event.event_type.
export const DISCIPLINE_SPEED = {
  marche: 1.4,
  trail: 2.0,
  cross: 2.6,
  route: 3.0,
  triathlon: 3.0,
  velo: 6.0,
  autre: 3.0,
};

// Definition des niveaux. `offsets` est passe tel quel a createLineTrigger.
export const TIERS = {
  1: { photos: 3, offsets: [-0.90, 0, 0.90] },
  2: { photos: 2, offsets: [-0.90, 0.90] },
  3: { photos: 1, offsets: [0] },
};

// Latence de capture MAXIMALE (ms) a laquelle chaque niveau tient encore sa
// promesse. Genere par simulation sur le vrai lineTrigger.js, zone 0.37,
// detection a 10 fps.
//
// ATTENTION : ces valeurs dependent de `captureZoneWidthPercent`. Si la zone
// change significativement, il faut les regenerer — sinon un appareil sera
// classe niveau 1 sans pouvoir tenir 3 photos. C'est de la donnee mesuree,
// pas une constante universelle.
export const TIER_MAX_LATENCY_MS = {
  marche: { 1: 530, 2: 1130 },
  trail: { 1: 390, 2: 820 },
  cross: { 1: 290, 2: 680 },
  route: { 1: 230, 2: 530 },
  triathlon: { 1: 230, 2: 530 },
  velo: { 1: 120, 2: 290 },
  autre: { 1: 230, 2: 530 },
};

// event_type est saisi cote organisateur, avec des libelles varies
// ("Course sur route", "Vélo", "Trail"...). On normalise vers les cles
// ci-dessus. Inconnu -> 'autre' (traite comme de la route : prudent).
export function normalizeDiscipline(eventType) {
  const t = String(eventType || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (!t) return 'autre';
  if (t.includes('marche') || t.includes('rando')) return 'marche';
  if (t.includes('trail')) return 'trail';
  if (t.includes('cross')) return 'cross';
  if (t.includes('velo') || t.includes('cyclo') || t.includes('bike')) return 'velo';
  if (t.includes('triathlon')) return 'triathlon';
  if (t.includes('route') || t.includes('course')) return 'route';
  return 'autre';
}

// Niveau pour une latence mesuree et une discipline.
// Retourne { tier, photos, offsets, discipline }.
export function tierFor(latencyMs, eventType, overrides = null) {
  const discipline = normalizeDiscipline(eventType);
  const table = (overrides && overrides[discipline]) || TIER_MAX_LATENCY_MS[discipline]
    || TIER_MAX_LATENCY_MS.autre;
  // Latence inconnue (pas encore de mesure) : on suppose le meilleur cas.
  // Le probe corrigera des la premiere capture, et le failsafe F1 garantit
  // qu'aucun coureur ne repart a zero photo entre-temps.
  const l = Number.isFinite(latencyMs) && latencyMs > 0 ? latencyMs : 0;
  let tier = 3;
  if (l <= table[1]) tier = 1;
  else if (l <= table[2]) tier = 2;
  return { tier, photos: TIERS[tier].photos, offsets: TIERS[tier].offsets, discipline };
}

// ─── Sonde de latence ─────────────────────────────────────────────────────
//
// Calibration PASSIVE : on n'impose pas de rafale de calibration au demarrage,
// on observe les captures reelles. Deux avantages — aucune photo gachee, et
// la mesure suit les conditions du moment (throttling thermique, pression
// disque en fin d'event) au lieu de figer un chiffre pris a froid.
//
// Mediane et non moyenne : une capture aberrante (GC, ecriture disque lente)
// ne doit pas declasser l'appareil pour toute la course.

export function createLatencyProbe(sampleSize = 9, minSamples = 5) {
  const samples = [];
  return {
    // dt : duree de takePhoto en ms.
    push(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      samples.push(dt);
      if (samples.length > sampleSize) samples.shift();
    },
    // null tant qu'on n'a pas assez d'echantillons -> tierFor suppose le
    // meilleur cas, ce qui evite de degrader un bon appareil sur un demarrage
    // a froid (la premiere capture est systematiquement la plus lente).
    median() {
      if (samples.length < minSamples) return null;
      const s = samples.slice().sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
    count: () => samples.length,
    reset() { samples.length = 0; },
  };
}
