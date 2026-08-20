// Tests de la copie legere (upload en deux temps).
//
// Hors repo (projet CommonJS/Babel) :
//   rm -rf /tmp/lctest && mkdir -p /tmp/lctest && \
//   cp src/services/lightCopy.js src/services/__tests__/lightCopy.test.mjs /tmp/lctest/ && \
//   cd /tmp/lctest && echo '{"type":"module"}' > package.json && node lightCopy.test.mjs

import assert from 'node:assert/strict';
import {
  lightPlanFor, lightIsWorthIt,
  LIGHT_MAX_WIDTH, LIGHT_QUALITY_DEFAULT, LIGHT_MIN_GAIN,
} from './lightCopy.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

// ─── La regle de resolution ───────────────────────────────────────────────
// Elle doit etre IDENTIQUE a celle du worker : transform({width: 2400,
// fit: 'scale-down'}). Toute divergence produit une degradation invisible
// (zero match Rekognition, aucune erreur nulle part).

t('capture nominale 2400x3200 (portrait) : intacte', () => {
  // Le piege : une regle "grand cote <= 2400" la reduirait a 1800x2400,
  // soit 25% de resolution en moins que ce que le serveur analyse.
  const p = lightPlanFor(2400, 3200);
  assert.equal(p.resize, null);
  assert.equal(p.outWidth, 2400);
  assert.equal(p.outHeight, 3200);
  assert.equal(p.reason, 'deja-sous-la-limite');
});

t('source 4032x3024 (paysage) : largeur ramenee a 2400', () => {
  const p = lightPlanFor(4032, 3024);
  assert.deepEqual(p.resize, { width: 2400 });
  assert.equal(p.outWidth, 2400);
  assert.equal(p.outHeight, 1800);        // 3024 * 2400/4032
});

t('source 3024x4032 (portrait large) : largeur ramenee, hauteur suit', () => {
  const p = lightPlanFor(3024, 4032);
  assert.deepEqual(p.resize, { width: 2400 });
  assert.equal(p.outWidth, 2400);
  assert.equal(p.outHeight, 3200);        // 4032 * 2400/3024
});

t('la largeur ne depasse JAMAIS la limite, et ne descend jamais en dessous sans raison', () => {
  const sources = [
    [800, 600], [2400, 3200], [3000, 3000], [4032, 3024], [8000, 1000], [1000, 8000],
  ];
  for (const [w, h] of sources) {
    const p = lightPlanFor(w, h);
    assert.ok(p.outWidth <= LIGHT_MAX_WIDTH, `${w}x${h} -> largeur ${p.outWidth} > limite`);
    // scale-down : la seule raison de reduire est d avoir depasse la limite.
    assert.equal(p.outWidth, Math.min(w, LIGHT_MAX_WIDTH), `${w}x${h}`);
  }
});

t('une source deja etroite n est PAS agrandie', () => {
  const p = lightPlanFor(1280, 960);
  assert.equal(p.resize, null);           // pas d upscale : aucune info ajoutee
  assert.equal(p.outWidth, 1280);
  assert.equal(p.outHeight, 960);
});

t('carre 3000x3000 -> 2400x2400', () => {
  const p = lightPlanFor(3000, 3000);
  assert.deepEqual(p.resize, { width: 2400 });
  assert.equal(p.outWidth, 2400);
  assert.equal(p.outHeight, 2400);
});

t('meme geometrie que compressForAnalysis cote worker', () => {
  // Reimplementation independante de scale-down sur la largeur. Si ce test
  // casse, c est que lightPlanFor a diverge du serveur.
  const serveur = (w, h, max) => (w <= max ? [w, h] : [max, Math.round(h * (max / w))]);
  for (const [w, h] of [[2400, 3200], [4032, 3024], [1280, 960], [5000, 5000], [2401, 1000]]) {
    const p = lightPlanFor(w, h);
    assert.deepEqual([p.outWidth, p.outHeight], serveur(w, h, LIGHT_MAX_WIDTH), `${w}x${h}`);
  }
});

// ─── Dimensions inconnues : on degrade en securite ───────────────────────
// Si on ne sait pas lire les dimensions, deviner une taille serait le seul
// moyen de tomber sous le plancher sans s en apercevoir. On ne devine pas.

t('dimensions absentes -> recompression seule, resolution intacte', () => {
  for (const bad of [[0, 0], [-1, 100], [NaN, 3200], [undefined, undefined], [null, 12]]) {
    const p = lightPlanFor(bad[0], bad[1]);
    assert.equal(p.resize, null, `${bad} devrait ne pas redimensionner`);
    assert.equal(p.reason, 'dims-inconnues');
  }
});

// ─── Qualite ──────────────────────────────────────────────────────────────

t('qualite par defaut appliquee si non fournie', () => {
  assert.equal(lightPlanFor(2400, 3200).quality, LIGHT_QUALITY_DEFAULT);
});

t('qualite runtime respectee (pilotable via /config)', () => {
  assert.equal(lightPlanFor(2400, 3200, { quality: 0.6 }).quality, 0.6);
});

t('qualite bornee : jamais 0 (image vide), jamais > 1', () => {
  assert.equal(lightPlanFor(2400, 3200, { quality: 0 }).quality, 0.05);
  assert.equal(lightPlanFor(2400, 3200, { quality: -5 }).quality, 0.05);
  assert.equal(lightPlanFor(2400, 3200, { quality: 3 }).quality, 1);
  assert.equal(lightPlanFor(2400, 3200, { quality: 'oui' }).quality, LIGHT_QUALITY_DEFAULT);
});

t('largeur max surchargeable, mais une valeur invalide retombe sur 2400', () => {
  assert.deepEqual(lightPlanFor(4032, 3024, { maxWidth: 3000 }).resize, { width: 3000 });
  assert.deepEqual(lightPlanFor(4032, 3024, { maxWidth: 0 }).resize, { width: 2400 });
  assert.deepEqual(lightPlanFor(4032, 3024, { maxWidth: null }).resize, { width: 2400 });
  assert.deepEqual(lightPlanFor(4032, 3024, { maxWidth: 'large' }).resize, { width: 2400 });
});

// ─── Le gain vaut-il le double aller-retour ? ────────────────────────────

t('gain suffisant -> on garde la copie legere', () => {
  assert.equal(lightIsWorthIt(1_940_000, 300_000), true);    // facteur 6.5
  assert.equal(lightIsWorthIt(1_000_000, 500_000), true);    // facteur 2.0 pile
});

t('gain insuffisant -> on envoie directement l original', () => {
  assert.equal(lightIsWorthIt(1_000_000, 600_000), false);   // facteur 1.7
  assert.equal(lightIsWorthIt(400_000, 390_000), false);     // photo deja legere
});

t('la copie plus LOURDE que l original est rejetee', () => {
  // Arrive vraiment : un HEIC tres compresse redecode en JPEG q45 peut
  // grossir. Sans ce garde-fou on paierait deux uploads pour un malus.
  assert.equal(lightIsWorthIt(300_000, 350_000), false);
});

t('entrees aberrantes -> refus (jamais de crash, jamais de true par accident)', () => {
  assert.equal(lightIsWorthIt(0, 100), false);
  assert.equal(lightIsWorthIt(100, 0), false);
  assert.equal(lightIsWorthIt(NaN, 100), false);
  assert.equal(lightIsWorthIt(null, undefined), false);
});

t('seuil de gain surchargeable', () => {
  assert.equal(lightIsWorthIt(1_000_000, 400_000, 3), false);  // 2.5 < 3
  assert.equal(lightIsWorthIt(1_000_000, 300_000, 3), true);   // 3.33 >= 3
  assert.equal(LIGHT_MIN_GAIN, 2.0);
});

console.log(`\n${pass} tests OK`);
