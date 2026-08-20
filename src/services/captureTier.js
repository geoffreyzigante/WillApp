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

export function createRollingMedian(sampleSize = 9, minSamples = 5) {
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

// La sonde de latence en est un cas particulier. Le poids des photos en est
// un autre : meme besoin de mediane (une photo aberrante ne doit pas fausser
// le budget), meme fenetre glissante (la taille varie avec la lumiere).
export const createLatencyProbe = createRollingMedian;
export const createPhotoSizeProbe = createRollingMedian;

// ─── Pression de stockage ─────────────────────────────────────────────────
//
// Objectif : photographier TOUT LE MONDE, meme hors connexion. Plutot que de
// couper a la saturation — ce qui fait repartir des coureurs sans aucune
// photo — on reduit le nombre de photos par passage a mesure que le
// telephone se remplit. Trois photos coutent trois fois plus qu une ; a
// budget egal, une photo par coureur couvre trois fois plus de coureurs.
//
// La mesure est RELATIVE a la place reellement disponible, pas a un seuil
// absolu. Un iPhone avec 60 Go libres n a aucune raison de se degrader parce
// qu il a accumule 2 Go ; un telephone avec 4 Go libres doit se degrader
// tres tot pour tenir toute la course.

// Marge laissee au systeme. En dessous, iOS commence a mal se comporter
// (echecs d ecriture, purge de caches) bien avant le disque plein reel.
export const STORAGE_RESERVE_BYTES = 3 * 1024 * 1024 * 1024;

// Marge de securite appliquee a TOUT budget calcule. On ne vise jamais la
// limite theorique : le poids des photos varie (lumiere, format), le nombre
// de coureurs annonce est une estimation, et un event deborde souvent son
// horaire. 15 % couvre ces trois derives sans sacrifier de niveau dans les
// cas normaux.
export const BUDGET_SAFETY = 0.85;

// Plancher produit : on ne descend a 1 photo QUE si 2 ne permettrait pas de
// couvrir tout le monde. La promesse est 2 a 3 photos par passage ; une
// seule photo est un mode de survie, pas un regime de croisiere.
export const MIN_PHOTOS_NOMINAL = 2;

// Part du budget utilisable deja consommee -> photos autorisees.
// Regime nominal : 3 puis 2 photos. Le palier a 1 est un SECOURS, place tard
// (95 % du budget) : sans lui on passerait de 2 a l arret complet d un coup,
// et des coureurs repartiraient bredouilles alors qu il restait de la place
// pour une photo. La promesse produit reste "2 a 3" ; 1 photo signale que le
// telephone est en fin de course.
export const STORAGE_USAGE_STEPS = [
  { maxUsage: 0.45, photos: 3 },
  { maxUsage: 0.85, photos: 2 },
  { maxUsage: 0.95, photos: 1 },
];

// Repli quand la place libre est inconnue (API indisponible) : on retombe sur
// des seuils absolus prudents plutot que de supposer un disque infini.
export const STORAGE_ABSOLUTE_STEPS = [
  { maxBytes: 2 * 1024 * 1024 * 1024, photos: 3 },
  { maxBytes: 5 * 1024 * 1024 * 1024, photos: 2 },
  { maxBytes: 7 * 1024 * 1024 * 1024, photos: 1 },
];

// Plafond memoire du suivi en RAM, independant du disque. Une file de 900
// items veut dire que l upload ne suit pas : degrader est justifie meme si
// le disque est vide.
export const PIPELINE_STEPS = [
  { maxLoad: 500, photos: 3 },
  { maxLoad: 1000, photos: 2 },
  { maxLoad: 1400, photos: 1 },
];

function stepValue(steps, value, key) {
  for (const s of steps) if (value < s[key]) return s.photos;
  return 0;
}

// Nombre de photos autorisees par passage. Retourne 0 = plus aucune capture.
//
//   pendingBytes : poids des photos en attente d upload
//   pipelineLoad : items en file + captures en vol
//   freeBytes    : place libre sur l appareil (null/0 = inconnue)
//
// On retient TOUJOURS le palier le plus severe des deux axes : disque et
// file mesurent deux facons differentes de ne pas suivre.
export function photosPerRunnerFor(pendingBytes, pipelineLoad, freeBytes = null, opts = {}) {
  const pending = Number.isFinite(pendingBytes) && pendingBytes > 0 ? pendingBytes : 0;
  const load = Number.isFinite(pipelineLoad) && pipelineLoad > 0 ? pipelineLoad : 0;
  const free = Number.isFinite(freeBytes) && freeBytes > 0 ? freeBytes : 0;
  const reserve = opts.reserveBytes ?? STORAGE_RESERVE_BYTES;

  const parPipeline = stepValue(opts.pipelineSteps ?? PIPELINE_STEPS, load, 'maxLoad');

  let parDisque;
  if (free > 0) {
    // Budget = ce qu on peut encore ecrire sans mordre sur la reserve. Les
    // photos deja en attente en font partie : elles seront liberees a
    // l upload, elles comptent donc dans le total, pas contre lui.
    const budget = Math.max(0, free - reserve) + pending;
    parDisque = budget <= 0 ? 0
      : stepValue(opts.usageSteps ?? STORAGE_USAGE_STEPS, pending / budget, 'maxUsage');
  } else {
    parDisque = stepValue(opts.absoluteSteps ?? STORAGE_ABSOLUTE_STEPS, pending, 'maxBytes');
  }

  // Budget prospectif : combien peut-on tenir jusqu au dernier coureur ?
  // Null si on ignore le nombre attendu ou le poids d une photo.
  // Coureurs restant a couvrir. L appelant fournit soit le reste directement,
  // soit attendus + deja vus.
  let restants = null;
  if (Number.isFinite(opts.remainingRunners)) {
    restants = opts.remainingRunners;
  } else if (Number.isFinite(opts.expectedRunners)) {
    restants = opts.expectedRunners - (Number.isFinite(opts.seenRunners) ? opts.seenRunners : 0);
  }

  let parBudget;
  if (restants !== null && restants <= 0) {
    // Estimation DEPASSEE : il passe plus de monde que l organisateur n en
    // annoncait. On ne sait plus combien il en reste — l hypothese prudente
    // est qu il en reste beaucoup. On se rabat sur 1 photo pour etirer le
    // budget au maximum, au lieu de redevenir genereux (ce que ferait un
    // simple max(1, restants), qui vide le disque d autant plus vite).
    parBudget = 1;
  } else {
    parBudget = photosPerRunnerForBudget(free, restants, opts.photoBytes, opts);
  }

  // Le plus severe des trois. Le budget seul ne suffit pas — si l estimation
  // de l organisateur est trop basse, les paliers reactifs rattrapent.
  const paliers = [parPipeline, parDisque];
  if (parBudget !== null) paliers.push(parBudget);
  return Math.min(...paliers);
}

// Photos par coureur que la place restante permet de tenir JUSQU AU BOUT.
//
// C est la piece maitresse. Les paliers d usage reagissent au remplissage :
// genereux au debut, ils affament la fin. Simulation a 1000 coureurs sur un
// telephone a 5 Go libres : 313 coureurs repartaient sans aucune photo.
//
// Ici on repartit le budget AVANT de commencer. Le nombre de coureurs vient
// de l organisateur (estimated_participants) ; le poids d une photo est
// mesure sur les captures reelles. A defaut de l un ou l autre, on ne se
// prononce pas (null) et seuls les paliers reactifs s appliquent.
//
// ATTENTION — le compte doit etre celui des coureurs QUI RESTENT, pas du
// total. Budgeter la place restante sur le total alors qu ils defilent fait
// tomber le calcul a zero a mi-course : a 1000 coureurs sur un telephone a
// 5 Go, la simulation coupait tout au 366e. Avec le reste a couvrir, le
// budget se reevalue correctement a chaque passage.
export function photosPerRunnerForBudget(freeBytes, remainingRunners, photoBytes, opts = {}) {
  const reserve = opts.reserveBytes ?? STORAGE_RESERVE_BYTES;
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return null;
  if (!Number.isFinite(remainingRunners) || remainingRunners <= 0) return null;
  if (!Number.isFinite(photoBytes) || photoBytes <= 0) return null;
  const marge = opts.safety ?? BUDGET_SAFETY;
  const budget = Math.max(0, freeBytes - reserve) * marge;
  const parCoureur = budget / (remainingRunners * photoBytes);
  if (parCoureur >= 3) return 3;
  if (parCoureur >= 2) return 2;
  if (parCoureur >= 1) return 1;
  return 0;   // le telephone ne peut pas couvrir l event, meme a 1 photo
}

// Combien de coureurs peut-on encore couvrir avec la place restante ?
// Sert au message affiche au benevole : un chiffre concret vaut mieux qu une
// jauge. Retourne null si la place libre est inconnue.
export function runnersRemaining(freeBytes, photoBytes, photosPerRunner, reserveBytes = STORAGE_RESERVE_BYTES) {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return null;
  if (!Number.isFinite(photoBytes) || photoBytes <= 0) return null;
  if (!Number.isFinite(photosPerRunner) || photosPerRunner <= 0) return 0;
  const budget = Math.max(0, freeBytes - reserveBytes);
  return Math.floor(budget / (photoBytes * photosPerRunner));
}

// ─── Garde-fous adaptatifs ────────────────────────────────────────────────
//
// Les constantes d origine sont absolues : MAX_QUEUE_SIZE = 1000 photos et
// STORAGE_WARN_BYTES = 5 Go, censes s equivaloir a "~5 Mo par photo". Le
// poids reel mesure sur les HEIC en production est de 1,94 Mo : les deux
// gardes sont decales d un facteur 2,6, et celui du disque ne mord jamais.
//
// Plutot que de corriger un chiffre en dur par un autre, on le derive de ce
// qu on mesure : le poids reel des photos et la place reellement libre. La
// meme fonction vaudra sur Android, ou ni l un ni l autre ne ressemblent a
// l iPhone.

// Poids de repli tant que la sonde n a pas assez d echantillons. Mediane
// mesuree en production le 2026-08 sur 10 HEIC (min 1,90 / max 1,99).
export const PHOTO_BYTES_FALLBACK = 1.94 * 1024 * 1024;

// Seuil d alerte stockage : la moitie du budget utilisable, borne pour rester
// utile sur les extremes (un telephone vide ne doit pas alerter a 40 Go, un
// telephone plein doit alerter avant qu il soit trop tard).
export function storageWarnBytesFor(freeBytes, opts = {}) {
  const reserve = opts.reserveBytes ?? STORAGE_RESERVE_BYTES;
  const min = opts.minWarnBytes ?? 512 * 1024 * 1024;
  const max = opts.maxWarnBytes ?? 8 * 1024 * 1024 * 1024;
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return max;
  const budget = Math.max(0, freeBytes - reserve);
  return Math.min(max, Math.max(min, budget * 0.5 * (opts.safety ?? BUDGET_SAFETY)));
}

// Plafond de la file, exprime en PHOTOS et non en octets : c est la borne
// memoire du suivi en RAM. On le derive du budget disque et du poids reel
// pour que les deux gardes disent la meme chose, au lieu de se contredire.
export function maxQueueSizeFor(freeBytes, photoBytes, opts = {}) {
  const reserve = opts.reserveBytes ?? STORAGE_RESERVE_BYTES;
  const min = opts.minQueue ?? 200;
  const max = opts.maxQueue ?? 4000;   // au-dela, le suivi RAM devient lourd
  const poids = Number.isFinite(photoBytes) && photoBytes > 0
    ? photoBytes : PHOTO_BYTES_FALLBACK;
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) return min;
  const budget = Math.max(0, freeBytes - reserve);
  const marge = opts.safety ?? BUDGET_SAFETY;
  return Math.min(max, Math.max(min, Math.floor((budget * marge) / poids)));
}
