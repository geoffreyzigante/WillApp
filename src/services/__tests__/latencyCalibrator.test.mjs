// Tests de l auto-calibration de la latence.
//
//   rm -rf /tmp/lctest2 && mkdir -p /tmp/lctest2 && \
//   cp src/services/latencyCalibrator.js src/services/__tests__/latencyCalibrator.test.mjs /tmp/lctest2/ && \
//   cd /tmp/lctest2 && echo '{"type":"module"}' > package.json && node latencyCalibrator.test.mjs

import assert from 'node:assert/strict';
import {
  erreurLatenceMs, prochaineLatence, creerCalibrateur,
  VX_MIN, ERREUR_MAX_MS, LATENCE_MIN_MS, LATENCE_MAX_MS, ECHANTILLONS_MIN, PAS_MAX_MS,
} from './latencyCalibrator.js';

let pass = 0;
const t = (nom, fn) => { fn(); pass++; console.log('  ok  ' + nom); };
// Comparaison tolerante : les calculs passent par des divisions flottantes,
// 100 ms ressort a 100.00000000000009.
const proche = (a, b, tol = 0.01) =>
  assert.ok(a !== null && Math.abs(a - b) <= tol, `${a} != ${b} (± ${tol})`);

// ─── La mesure elle-meme ─────────────────────────────────────────────────

t('photo en retard -> erreur positive', () => {
  // Predit a 0.50, trouve a 0.55, vitesse 0.5 largeur/s.
  // 0.05 largeur / 0.5 largeur/s = 0.1 s de retard.
  proche(erreurLatenceMs(0.50, 0.55, 0.5), 100);
});

t('photo en avance -> erreur negative', () => {
  proche(erreurLatenceMs(0.55, 0.50, 0.5), -100);
});

t('sens de deplacement inverse : le signe suit', () => {
  // Coureur allant vers la gauche (vx negatif) et photo en retard : il est
  // plus a GAUCHE que prevu, donc x_reel < x_predit, et vx < 0 -> positif.
  proche(erreurLatenceMs(0.50, 0.45, -0.5), 100);
});

t('latence juste -> erreur nulle', () => {
  proche(erreurLatenceMs(0.5, 0.5, 0.6), 0);
});

// ─── Ce qu on refuse de mesurer ──────────────────────────────────────────

t('sujet trop lent : la division amplifierait le bruit', () => {
  assert.equal(erreurLatenceMs(0.50, 0.52, 0.01), null);
  assert.equal(erreurLatenceMs(0.50, 0.52, VX_MIN - 0.001), null);
  assert.notEqual(erreurLatenceMs(0.50, 0.52, VX_MIN), null);
});

t('sujet immobile : jamais de mesure, jamais de division par zero', () => {
  assert.equal(erreurLatenceMs(0.5, 0.7, 0), null);
});

t('erreur aberrante rejetee — c est la garde anti-inversion d axe', () => {
  // Un axe inverse entre detecteur et photo produit des ecarts enormes et
  // incoherents. Sans ce plafond, la calibration divergerait en silence.
  assert.equal(erreurLatenceMs(0.10, 0.90, 0.5), null);   // 1600 ms
  assert.equal(erreurLatenceMs(0.90, 0.10, 0.5), null);
  // Juste sous le plafond : accepte. 0.399 s x 0.5 largeur/s = 0.1995 largeur.
  proche(erreurLatenceMs(0.5, 0.5 + 0.1995, 0.5), 399, 0.5);
  // Juste au-dessus : refuse.
  assert.equal(erreurLatenceMs(0.5, 0.5 + 0.2005, 0.5), null);
});

t('positions hors image rejetees', () => {
  assert.equal(erreurLatenceMs(-0.1, 0.5, 0.5), null);
  assert.equal(erreurLatenceMs(0.5, 1.4, 0.5), null);
});

t('entrees non numeriques rejetees, jamais de NaN propage', () => {
  for (const bad of [[NaN, 0.5, 0.5], [0.5, undefined, 0.5], [0.5, 0.5, null], ['a', 'b', 'c']]) {
    assert.equal(erreurLatenceMs(bad[0], bad[1], bad[2]), null);
  }
});

// ─── La correction ───────────────────────────────────────────────────────

t('pas assez d echantillons -> on ne touche a rien', () => {
  assert.equal(prochaineLatence(100, 40, ECHANTILLONS_MIN - 1), null);
  assert.notEqual(prochaineLatence(100, 40, ECHANTILLONS_MIN), null);
});

t('mediane absente -> on ne touche a rien', () => {
  assert.equal(prochaineLatence(100, null, 50), null);
});

t('correction amortie : jamais plus d un pas a la fois', () => {
  // Erreur de 200 ms mesuree, mais on n avance que de PAS_MAX_MS.
  proche(prochaineLatence(100, 200, 50), 100 + PAS_MAX_MS);
  proche(prochaineLatence(100, -200, 50), 100 - PAS_MAX_MS);
});

t('convergence : repeter la correction finit par atteindre la cible', () => {
  // Le systeme reel a 180 ms de latence, on part de 60.
  let latence = 60;
  for (let i = 0; i < 40; i++) {
    const suivante = prochaineLatence(latence, 180 - latence, 50);
    if (suivante === null) break;
    latence = suivante;
  }
  assert.ok(Math.abs(latence - 180) <= 1, `converge a ${latence}, attendu ~180`);
});

t('bornes respectees : jamais hors [30, 250]', () => {
  assert.equal(prochaineLatence(LATENCE_MAX_MS, 500, 50), null);   // deja au plafond
  assert.equal(prochaineLatence(LATENCE_MIN_MS, -500, 50), null);  // deja au plancher
  assert.equal(prochaineLatence(245, 100, 50), LATENCE_MAX_MS);
  assert.equal(prochaineLatence(35, -100, 50), LATENCE_MIN_MS);
});

t('correction negligeable -> null, on ne recree pas le tracker pour rien', () => {
  // Recreer le tracker jette l etat des tracks en cours : ca ne se fait pas
  // pour un demi-milliseconde.
  assert.equal(prochaineLatence(100, 0.4, 50), null);
  assert.equal(prochaineLatence(100, 0, 50), null);
});

t('latence courante absurde -> on repart du milieu de la plage', () => {
  proche(prochaineLatence(NaN, 100, 50), (LATENCE_MIN_MS + LATENCE_MAX_MS) / 2 + PAS_MAX_MS);
});

// ─── L accumulateur ──────────────────────────────────────────────────────

t('mediane et non moyenne : un echantillon aberrant ne deplace pas tout', () => {
  const c = creerCalibrateur();
  // Cinq mesures a ~100 ms, puis une aberrante a 390.
  for (const x of [0.55, 0.551, 0.549, 0.55, 0.552]) c.ajouter(0.50, x, 0.5);
  c.ajouter(0.50, 0.50 + 0.195, 0.5);    // 390 ms, dans les clous mais extreme
  const m = c.mediane();
  assert.ok(m > 95 && m < 115, `mediane ${m} devrait rester proche de 100`);
});

t('les echantillons refuses ne comptent pas', () => {
  const c = creerCalibrateur();
  assert.equal(c.ajouter(0.5, 0.55, 0.5), true);
  assert.equal(c.ajouter(0.5, 0.55, 0.001), false);   // trop lent
  assert.equal(c.ajouter(0.1, 0.9, 0.5), false);      // aberrant
  assert.equal(c.taille(), 1);
});

t('fenetre glissante : les vieilles mesures sortent', () => {
  const c = creerCalibrateur(5);
  for (let i = 0; i < 12; i++) c.ajouter(0.5, 0.55, 0.5);
  assert.equal(c.taille(), 5);
});

t('calibrateur vide -> mediane null, pas 0', () => {
  // 0 signifierait « latence parfaite » et figerait la calibration.
  const c = creerCalibrateur();
  assert.equal(c.mediane(), null);
  assert.equal(prochaineLatence(100, c.mediane(), c.taille()), null);
});

t('reinitialisation', () => {
  const c = creerCalibrateur();
  c.ajouter(0.5, 0.55, 0.5);
  c.reinitialiser();
  assert.equal(c.taille(), 0);
  assert.equal(c.mediane(), null);
});

// ─── Bout en bout ────────────────────────────────────────────────────────

t('la fenetre est videe des qu une correction est rendue', () => {
  // Sans ca, les echantillons mesures sous l ancien reglage continuent de
  // peser et la correction s emballe (cf. en-tete du module).
  const c = creerCalibrateur();
  for (let i = 0; i < 8; i++) c.ajouter(0.5, 0.55, 0.5);
  assert.equal(c.taille(), 8);
  assert.notEqual(c.proposerLatence(100), null);
  assert.equal(c.taille(), 0);
});

t('proposerLatence ne vide PAS la fenetre quand elle ne corrige rien', () => {
  const c = creerCalibrateur();
  for (let i = 0; i < 3; i++) c.ajouter(0.5, 0.55, 0.5);   // < ECHANTILLONS_MIN
  assert.equal(c.proposerLatence(100), null);
  assert.equal(c.taille(), 3);
});

t('scenario reel : latence supposee 50 ms, reelle 170, on converge', () => {
  const REELLE = 170, SUPPOSEE_DEPART = 50;
  const vx = 0.55;                      // coureur sur route
  let latence = SUPPOSEE_DEPART;
  const c = creerCalibrateur();

  for (let passage = 0; passage < 60; passage++) {
    // Le tracker predit la position en supposant `latence`. La photo tombe
    // en realite REELLE ms apres le tir -> le sujet a avance davantage.
    const xPredit = 0.5;
    const derive = ((REELLE - latence) / 1000) * vx;
    const bruit = ((passage % 5) - 2) * 0.002;      // bruit de detection
    c.ajouter(xPredit, xPredit + derive + bruit, vx);
    const suivante = c.proposerLatence(latence);
    if (suivante !== null) latence = suivante;
  }
  assert.ok(Math.abs(latence - REELLE) <= 5, `converge a ${latence}, attendu ~${REELLE}`);
});

console.log(`\n${pass} tests OK`);
