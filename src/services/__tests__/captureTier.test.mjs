// Tests des niveaux de capture.
//
// Hors repo (projet CommonJS/Babel) :
//   rm -rf /tmp/cttest && mkdir -p /tmp/cttest && \
//   cp src/services/captureTier.js src/services/__tests__/captureTier.test.mjs /tmp/cttest/ && \
//   cd /tmp/cttest && echo '{"type":"module"}' > package.json && node captureTier.test.mjs

import assert from 'node:assert/strict';
import {
  tierFor, normalizeDiscipline, createLatencyProbe, TIERS, TIER_MAX_LATENCY_MS,
  photosPerRunnerFor, photosPerRunnerForBudget, runnersRemaining, STORAGE_RESERVE_BYTES,
} from './captureTier.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

// ─── Normalisation des libelles saisis par l organisateur ─────────────────
t('libelles reels -> disciplines connues', () => {
  assert.equal(normalizeDiscipline('Course sur route'), 'route');
  assert.equal(normalizeDiscipline('Trail'), 'trail');
  assert.equal(normalizeDiscipline('Vélo'), 'velo');       // accent
  assert.equal(normalizeDiscipline('Velo'), 'velo');       // sans accent
  assert.equal(normalizeDiscipline('CROSS'), 'cross');     // casse
  assert.equal(normalizeDiscipline('Marche nordique'), 'marche');
  assert.equal(normalizeDiscipline(''), 'autre');
  assert.equal(normalizeDiscipline(null), 'autre');
  assert.equal(normalizeDiscipline('Course d orientation'), 'route');
});

// ─── Le niveau depend de la latence ───────────────────────────────────────
t('route : 150ms -> niv1, 300ms -> niv2, 800ms -> niv3', () => {
  assert.equal(tierFor(150, 'Course sur route').tier, 1);
  assert.equal(tierFor(300, 'Course sur route').tier, 2);
  assert.equal(tierFor(800, 'Course sur route').tier, 3);
});

// ─── ...ET de la discipline : c est tout l interet ────────────────────────
t('un meme 400ms : niv1 en marche, niv2 en trail, niv3 en velo', () => {
  assert.equal(tierFor(400, 'Marche').tier, 1);
  assert.equal(tierFor(400, 'Trail').tier, 2);
  assert.equal(tierFor(400, 'Vélo').tier, 3);
});

// ─── Frontieres exactes : <= est inclusif ─────────────────────────────────
t('frontieres route (230 / 530) inclusives', () => {
  assert.equal(tierFor(230, 'route').tier, 1);
  assert.equal(tierFor(231, 'route').tier, 2);
  assert.equal(tierFor(530, 'route').tier, 2);
  assert.equal(tierFor(531, 'route').tier, 3);
});

// ─── Latence inconnue -> meilleur cas, jamais de declassement gratuit ─────
t('latence absente/invalide -> niv1 (le probe corrigera)', () => {
  for (const v of [null, undefined, 0, -5, NaN, 'abc']) {
    assert.equal(tierFor(v, 'route').tier, 1, `valeur ${String(v)}`);
  }
});

// ─── Le niveau porte bien une config de lignes exploitable ────────────────
t('chaque niveau expose offsets + nb de photos coherents', () => {
  for (const tier of [1, 2, 3]) {
    const { offsets, photos } = TIERS[tier];
    assert.equal(offsets.length, photos, `niv${tier}: ${offsets.length} lignes pour ${photos} photos`);
  }
  assert.deepEqual(tierFor(100, 'route').offsets, [-0.90, 0, 0.90]);
  assert.deepEqual(tierFor(9999, 'route').offsets, [0]);
});

// ─── Coherence de la table de seuils ──────────────────────────────────────
t('seuils : niv1 < niv2 pour toute discipline, et decroissants avec la vitesse', () => {
  for (const [d, tbl] of Object.entries(TIER_MAX_LATENCY_MS)) {
    assert.ok(tbl[1] < tbl[2], `${d}: niv1 (${tbl[1]}) doit etre < niv2 (${tbl[2]})`);
  }
  // Plus la discipline est rapide, plus le seuil est severe.
  const order = ['marche', 'trail', 'cross', 'route', 'velo'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      TIER_MAX_LATENCY_MS[order[i]][1] <= TIER_MAX_LATENCY_MS[order[i - 1]][1],
      `${order[i]} doit etre plus severe que ${order[i - 1]}`,
    );
  }
});

// ─── Surcharge /config ────────────────────────────────────────────────────
t('overrides /config remplacent la table par discipline', () => {
  const ov = { route: { 1: 500, 2: 900 } };
  assert.equal(tierFor(400, 'route', ov).tier, 1);   // serait niv2 sans override
  assert.equal(tierFor(400, 'route').tier, 2);       // table par defaut intacte
  // Discipline absente de l override -> table par defaut.
  assert.equal(tierFor(400, 'trail', ov).tier, 2);
});

// ─── Sonde de latence ─────────────────────────────────────────────────────
t('probe : null tant que trop peu d echantillons', () => {
  const p = createLatencyProbe(9, 5);
  assert.equal(p.median(), null);
  p.push(150); p.push(160); p.push(155); p.push(158);
  assert.equal(p.median(), null, '4 echantillons < minSamples 5');
  p.push(152);
  assert.equal(typeof p.median(), 'number');
});

t('probe : mediane, pas moyenne — une capture aberrante ne declasse pas', () => {
  const p = createLatencyProbe(9, 5);
  [150, 155, 160, 152, 158].forEach((v) => p.push(v));
  assert.equal(p.median(), 155);
  p.push(3000);                      // GC / ecriture disque lente
  // Une moyenne donnerait (150+155+160+152+158+3000)/6 = 629 -> niveau 3.
  assert.equal(p.median(), 156.5, 'la mediane absorbe l aberration');
  assert.equal(tierFor(p.median(), 'route').tier, 1, 'ne doit pas declasser');
});

t('probe : fenetre glissante, suit une degradation reelle (thermique)', () => {
  const p = createLatencyProbe(5, 5);
  [150, 150, 150, 150, 150].forEach((v) => p.push(v));
  assert.equal(tierFor(p.median(), 'route').tier, 1);
  // L appareil chauffe : la fenetre se remplit de valeurs degradees.
  [400, 400, 400, 400, 400].forEach((v) => p.push(v));
  assert.equal(p.median(), 400, 'les anciens echantillons doivent etre sortis');
  assert.equal(tierFor(p.median(), 'route').tier, 2, 'doit se declasser');
});

t('probe : ignore les valeurs invalides', () => {
  const p = createLatencyProbe(9, 3);
  [null, undefined, 0, -1, NaN, 'x'].forEach((v) => p.push(v));
  assert.equal(p.count(), 0);
  assert.equal(p.median(), null);
});

// ─── Pression de stockage ─────────────────────────────────────────────────
const GB = 1024 * 1024 * 1024;

t('pression : un telephone spacieux ne se degrade PAS pour 2 Go', () => {
  // 60 Go libres, 2 Go en attente -> budget 59 Go, usage 3,4 % : plein regime.
  assert.equal(photosPerRunnerFor(2 * GB, 0, 60 * GB), 3);
  // C est tout l interet du relatif : les seuils absolus donnaient 2 ici.
  assert.equal(photosPerRunnerFor(2 * GB, 0, null), 2, 'repli absolu, plus severe');
});

t('pression : un telephone plein se degrade a mesure qu il se remplit', () => {
  // 5 Go libres, reserve 3 -> budget utile 2 Go. La degradation est
  // REACTIVE : elle suit le remplissage reel, elle n anticipe pas.
  assert.equal(photosPerRunnerFor(0.5 * GB, 0, 5 * GB), 3);   // usage 20 %
  assert.equal(photosPerRunnerFor(1.5 * GB, 0, 5 * GB), 2);   // usage 43 %
  assert.equal(photosPerRunnerFor(5.0 * GB, 0, 5 * GB), 1);   // usage 71 %
});

// ─── LE test qui compte : personne n est laisse de cote ───────────────────
const PHOTO = 1.5 * 1024 * 1024;   // HEIC typique

// Rejoue un event complet HORS LIGNE : rien ne part, tout s empile.
function simulerEvent({ libre, coureurs, attendus }) {
  let attente = 0, oublies = 0, total = 0;
  const parNiveau = { 3: 0, 2: 0, 1: 0, 0: 0 };
  for (let i = 0; i < coureurs; i++) {
    const n = photosPerRunnerFor(attente, 0, libre, {
      expectedRunners: attendus, seenRunners: i,
      photoBytes: PHOTO,
    });
    parNiveau[n]++;
    if (n === 0) oublies++;
    total += n;
    attente += n * PHOTO;
    libre -= n * PHOTO;
  }
  return { oublies, total, parNiveau };
}

t('SANS budget : 1000 coureurs, 5 Go libres -> des coureurs sont oublies', () => {
  // Contre-epreuve. Les paliers reactifs seuls sont genereux au debut et
  // affament la fin : c est exactement le defaut que le budget corrige.
  const r = simulerEvent({ libre: 5 * GB, coureurs: 1000, attendus: null });
  assert.ok(r.oublies > 0, 'la contre-epreuve doit echouer');
  console.log(`        -> ${r.oublies} coureurs sans photo (attendu : c est le bug)`);
});

t('AVEC budget : 1000 coureurs, 5 Go libres -> AUCUN oublie', () => {
  const r = simulerEvent({ libre: 5 * GB, coureurs: 1000, attendus: 1000 });
  assert.equal(r.oublies, 0, `${r.oublies} coureurs sans aucune photo`);
  assert.ok(r.total >= 1000, `${r.total} photos pour 1000 coureurs`);
  console.log(`        -> ${r.total} photos ; 3x${r.parNiveau[3]} 2x${r.parNiveau[2]} 1x${r.parNiveau[1]}`);
});

t('AVEC budget : un telephone spacieux garde ses 3 photos', () => {
  const r = simulerEvent({ libre: 60 * GB, coureurs: 1000, attendus: 1000 });
  assert.equal(r.oublies, 0);
  assert.equal(r.parNiveau[3], 1000, 'aucune degradation ne se justifie ici');
});

t('AVEC budget : estimation 5x trop basse -> on fait mieux que sans budget', () => {
  // L orga annonce 300 coureurs, il en passe 1500. Le telephone ne PEUT pas
  // tout couvrir : 2 Go utiles / 1,5 Mo = 1365 photos pour 1500 coureurs.
  // La garantie ne vaut que ce que vaut l estimation — mais la degradation
  // doit quand meme faire mieux que rien.
  const avec = simulerEvent({ libre: 5 * GB, coureurs: 1500, attendus: 300 });
  const sans = simulerEvent({ libre: 5 * GB, coureurs: 1500, attendus: null });
  console.log(`        -> avec budget : ${avec.oublies} oublies | sans : ${sans.oublies}`);
  assert.ok(avec.oublies <= sans.oublies, 'le budget ne doit jamais empirer les choses');
  const plafondPhysique = Math.floor((5 * GB - STORAGE_RESERVE_BYTES) / PHOTO);
  assert.ok(1500 - avec.oublies <= plafondPhysique, 'on ne depasse pas le disque');
});

t('budget : le calcul par coureur', () => {
  // 60 Go libres - 3 de reserve = 57 Go / 1000 coureurs = 57 Mo -> 3 photos.
  assert.equal(photosPerRunnerForBudget(60 * GB, 1000, PHOTO), 3);
  // 5 Go - 3 = 2 Go / 1000 = 2 Mo -> 1 photo (1,5 Mo l unite).
  assert.equal(photosPerRunnerForBudget(5 * GB, 1000, PHOTO), 1);
  // 4 Go - 3 = 1 Go / 1000 = 1 Mo -> meme pas une photo.
  assert.equal(photosPerRunnerForBudget(4 * GB, 1000, PHOTO), 0);
  // Donnee manquante -> pas d avis, les paliers reactifs decident seuls.
  assert.equal(photosPerRunnerForBudget(60 * GB, null, PHOTO), null);
  // Et le point cle : le calcul porte sur le RESTE a couvrir.
  assert.equal(photosPerRunnerForBudget(1.46 * GB, 634, PHOTO), 0,
    'sous la reserve systeme -> plus rien, ce n est pas une absence d avis');
  assert.equal(photosPerRunnerForBudget(4.46 * GB, 634, PHOTO), 1,
    'mi-course : 1,46 Go pour 634 coureurs -> 1 photo');
  assert.equal(photosPerRunnerForBudget(60 * GB, 1000, null), null);
  assert.equal(photosPerRunnerForBudget(null, 1000, PHOTO), null);
});

t('couverture : a 3 photos figees, le meme telephone couvrirait un tiers', () => {
  const budget = 5 * GB - STORAGE_RESERVE_BYTES;
  const couverts = Math.floor(budget / (3 * PHOTO));
  assert.ok(couverts < 1000, `${couverts} coureurs couverts sur 1000 — d ou la degradation`);
});

t('pression : sous la reserve systeme, tout s arrete', () => {
  // 2 Go libres < reserve 3 Go et rien en attente -> budget nul.
  assert.equal(photosPerRunnerFor(0, 0, 2 * GB), 0);
});

t('pression : la file degrade aussi, disque libre ou non', () => {
  assert.equal(photosPerRunnerFor(0, 600, 100 * GB), 2, 'file 600 malgre 100 Go');
  assert.equal(photosPerRunnerFor(0, 900, 100 * GB), 1);
  assert.equal(photosPerRunnerFor(0, 1200, 100 * GB), 0);
});

t('pression : on retient toujours le palier le PLUS severe', () => {
  assert.equal(photosPerRunnerFor(0.1 * GB, 900, 100 * GB), 1, 'file severe');
  // 5 Go libres, 5 Go deja en attente -> budget 2+5=7, usage 71 % -> 1.
  assert.equal(photosPerRunnerFor(5 * GB, 0, 5 * GB), 1, 'disque severe');
});

t('pression : place inconnue -> repli sur des seuils absolus prudents', () => {
  assert.equal(photosPerRunnerFor(1 * GB, 0, null), 3);
  assert.equal(photosPerRunnerFor(3 * GB, 0, 0), 2);
  assert.equal(photosPerRunnerFor(5 * GB, 0, NaN), 1);
  assert.equal(photosPerRunnerFor(7 * GB, 0, undefined), 0);
});

t('pression : entrees invalides -> aucune degradation abusive', () => {
  for (const v of [null, undefined, NaN, -1, 'x']) {
    assert.equal(photosPerRunnerFor(v, v, 100 * GB), 3, `valeur ${String(v)}`);
  }
});

t('pression : paliers surchargeables par /config', () => {
  const usageSteps = [{ maxUsage: 0.9, photos: 3 }];
  // free et pending sont lies : ce qu on ecrit sort de la place libre. Un
  // couple incoherent (50 Go libres ET 48 Go ecrits) ne se produit jamais.
  assert.equal(photosPerRunnerFor(5 * GB, 0, 45 * GB, { usageSteps }), 3);
  assert.equal(photosPerRunnerFor(48 * GB, 0, 2 * GB, { usageSteps }), 0);
});

// ─── Couverture : combien de coureurs reste-t-il ? ───────────────────────
t('couverture : 1 photo/coureur couvre 3x plus que 3 photos', () => {
  const PHOTO = 1.5 * 1024 * 1024;              // ~1,5 Mo par HEIC
  const a = runnersRemaining(20 * GB, PHOTO, 3);
  const b = runnersRemaining(20 * GB, PHOTO, 1);
  // Arrondi a l entier inferieur des deux cotes : tolerance de 3 coureurs.
  assert.ok(b >= a * 3 && b <= a * 3 + 3, `${b} vs ${a}x3`);
  assert.ok(a > 3000, `${a} coureurs a 3 photos — largement au-dela d un event`);
});

t('couverture : un telephone presque plein couvre encore une course entiere', () => {
  // 5 Go libres, reserve 3 -> 2 Go utiles.
  const n = runnersRemaining(5 * GB, PHOTO, 1);
  assert.ok(n >= 1000, `attendu >= 1000 coureurs, obtenu ${n}`);
});

t('couverture : inconnue si la place libre ne peut pas etre lue', () => {
  assert.equal(runnersRemaining(null, 1e6, 1), null);
  assert.equal(runnersRemaining(10 * GB, 0, 1), null);
  assert.equal(runnersRemaining(10 * GB, 1e6, 0), 0);
});

console.log(`\n${pass} tests OK\n`);
