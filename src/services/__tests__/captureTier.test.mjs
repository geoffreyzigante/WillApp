// Tests des niveaux de capture.
//
// Hors repo (projet CommonJS/Babel) :
//   rm -rf /tmp/cttest && mkdir -p /tmp/cttest && \
//   cp src/services/captureTier.js src/services/__tests__/captureTier.test.mjs /tmp/cttest/ && \
//   cd /tmp/cttest && echo '{"type":"module"}' > package.json && node captureTier.test.mjs

import assert from 'node:assert/strict';
import {
  tierFor, normalizeDiscipline, createLatencyProbe, TIERS, TIER_MAX_LATENCY_MS,
  photosPerRunnerFor,
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

t('pression : degradation 3 -> 2 -> 1 -> 0 selon le disque', () => {
  assert.equal(photosPerRunnerFor(0, 0), 3);
  assert.equal(photosPerRunnerFor(1.5 * GB, 0), 3);
  assert.equal(photosPerRunnerFor(3 * GB, 0), 2);
  assert.equal(photosPerRunnerFor(5 * GB, 0), 1);
  assert.equal(photosPerRunnerFor(7 * GB, 0), 0);
});

t('pression : la file d attente degrade aussi, disque libre ou non', () => {
  assert.equal(photosPerRunnerFor(0, 600), 2, 'file 600 -> 2 malgre disque vide');
  assert.equal(photosPerRunnerFor(0, 900), 1);
  assert.equal(photosPerRunnerFor(0, 1200), 0);
});

t('pression : on retient toujours le palier le PLUS severe', () => {
  // Disque OK (palier 3) mais file saturee (palier 1) -> 1.
  assert.equal(photosPerRunnerFor(0.5 * GB, 900), 1);
  // Et l inverse.
  assert.equal(photosPerRunnerFor(5 * GB, 10), 1);
});

t('pression : la degradation commence AVANT l alerte 5 Go', () => {
  // STORAGE_WARN_BYTES = 5 Go. A ce niveau on doit deja etre a 1 photo,
  // sinon l alerte arriverait alors qu on capture encore a plein regime.
  assert.ok(photosPerRunnerFor(5 * GB, 0) <= 1);
  assert.equal(photosPerRunnerFor(2.1 * GB, 0), 2, 'degradation des 2 Go');
});

t('pression : entrees invalides -> aucune degradation abusive', () => {
  for (const v of [null, undefined, NaN, -1, 'x']) {
    assert.equal(photosPerRunnerFor(v, v), 3, `valeur ${String(v)}`);
  }
});

t('pression : paliers surchargeables', () => {
  const steps = [{ maxBytes: 1e9, maxPipeline: 100, photos: 3 },
                 { maxBytes: 2e9, maxPipeline: 200, photos: 1 }];
  assert.equal(photosPerRunnerFor(0.5e9, 0, steps), 3);
  assert.equal(photosPerRunnerFor(1.5e9, 0, steps), 1);
  assert.equal(photosPerRunnerFor(3e9, 0, steps), 0);
});

console.log(`\n${pass} tests OK\n`);
