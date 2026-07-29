import assert from 'node:assert/strict';
import * as G from './framingGuide.js';
const D = (d) => d * Math.PI / 180;
let pass = 0;
const t = (n, f) => { f(); pass++; console.log('  ok  ' + n); };

const FOV = 68;                                   // format.fieldOfView typique 1x
const P = G.fovFromFormat(FOV, 'portrait');
const L = G.fovFromFormat(FOV, 'landscape');

console.log('\n--- champ de vision ---');
t('portrait : axe long vertical', () => {
  assert.ok(Math.abs(P.halfFovV * 180 / Math.PI - 34) < 0.01);
  assert.ok(Math.abs(P.halfFovH * 180 / Math.PI - 26.84) < 0.05);
});
t('paysage : axes inverses', () => {
  assert.ok(Math.abs(L.halfFovH - P.halfFovV) < 1e-12);
  assert.ok(Math.abs(L.halfFovV - P.halfFovH) < 1e-12);
});

console.log('\n--- attitude depuis la gravite ---');
t('a plat ecran vers le haut -> vise le sol (+90)', () => {
  const a = G.attitudeFromGravity({ x: 0, y: 0, z: -1 });
  assert.ok(Math.abs(a.pitch * 180 / Math.PI - 90) < 1e-6);
});
t('droit en portrait -> horizon (0)', () => {
  const a = G.attitudeFromGravity({ x: 0, y: -1, z: 0 });
  assert.ok(Math.abs(a.pitch) < 1e-6);
  assert.ok(Math.abs(a.roll) < 1e-6);
});
t('ecran vers le bas -> vise le ciel (-90)', () => {
  const a = G.attitudeFromGravity({ x: 0, y: 0, z: 1 });
  assert.ok(Math.abs(a.pitch * 180 / Math.PI + 90) < 1e-6);
});
t('roulis detecte, tangage inchange', () => {
  const a = G.attitudeFromGravity({ x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(a.roll * 180 / Math.PI - 90) < 1e-6);
  assert.ok(Math.abs(a.pitch) < 1e-6);
});
t('non normalise (m/s2) accepte', () => {
  const a = G.attitudeFromGravity({ x: 0, y: 0, z: -9.81 });
  assert.ok(Math.abs(a.pitch * 180 / Math.PI - 90) < 1e-6);
});

console.log('\n--- projection sol ---');
t('aller-retour y <-> distance', () => {
  const p = { height: 1.0, pitch: D(8), halfFovV: P.halfFovV };
  for (const d of [2, 3, 4, 6]) {
    const y = G.yForGroundDistance(d, p);
    assert.ok(y !== null && Math.abs(G.groundDistanceAtY(y, p) - d) < 1e-9);
  }
});
t('au-dessus de l horizon -> Infinity', () => {
  assert.equal(G.groundDistanceAtY(0, { height: 1, pitch: 0, halfFovV: P.halfFovV }), Infinity);
});
t('incliner vers le sol remonte le repere', () => {
  const a = G.yForGroundDistance(3.5, { height: 1, pitch: D(0), halfFovV: P.halfFovV });
  const b = G.yForGroundDistance(3.5, { height: 1, pitch: D(12), halfFovV: P.halfFovV });
  assert.ok(b < a);
});

console.log('\n--- visage <-> distance ---');
t('inversion coherente', () => {
  for (const d of [2, 3.5, 6]) {
    const f = G.expectedFaceWidthFraction(d, P.halfFovH);
    assert.ok(Math.abs(G.distanceFromFaceWidth(f, P.halfFovH) - d) < 1e-9);
  }
});

console.log('\n--- verdict ---');
t('etats', () => {
  const o = { roll: 0 };
  assert.equal(G.framingVerdict(2.0, 3.5, o).status, 'too-close');
  assert.equal(G.framingVerdict(3.5, 3.5, o).status, 'ok');
  assert.equal(G.framingVerdict(6.0, 3.5, o).status, 'too-far');
  assert.equal(G.framingVerdict(Infinity, 3.5, o).status, 'no-ground');
  assert.equal(G.framingVerdict(3.5, 3.5, { roll: D(30) }).status, 'tilted');
});

console.log(`\n${pass} tests OK`);

// ── Enjeu de l'orientation du champ : les deux hypotheses cote a cote ──
const speeds = [['Marche', 1.5], ['Route', 3.0], ['Trail', 5.0], ['Velo', 10.0]];
for (const [label, fov] of [['PORTRAIT (axe long vertical)', P], ['PAYSAGE (axe long horizontal)', L]]) {
  console.log(`\n--- ${label} : photos atteignables ---`);
  console.log('             2 m    4 m    6 m     d_min(3 photos)');
  for (const [name, v] of speeds) {
    const cells = [2, 4, 6].map(d => String(G.dwell(d, { halfFovH: fov.halfFovH, speed: v }).achievablePhotos).padStart(5));
    const dmin = G.minDistanceForBudget({ halfFovH: fov.halfFovH, speed: v });
    console.log(`  ${name.padEnd(8)} ${cells.join('  ')}      ${dmin.toFixed(1)} m  (${(dmin / v).toFixed(2)} x v)`);
  }
}

console.log('\n--- repere 3.5 m a l ecran (portrait, h=1 m barriere) ---');
for (const pd of [0, 5, 10, 20, 35]) {
  const y = G.yForGroundDistance(3.5, { height: 1.0, pitch: D(pd), halfFovV: P.halfFovV });
  console.log(`  inclinaison ${String(pd).padStart(2)}deg -> ${y === null ? 'hors cadre' : (y * 100).toFixed(0) + '% du haut'}`);
}

// ─── point au sol (repère bénévole) ───
console.log('\n--- point au sol ---');
const V = { height: 1.0, halfFovH: P.halfFovH, halfFovV: P.halfFovV };
t('sans roulis : point centre horizontalement', () => {
  const p = G.groundPointInImage(3.5, { ...V, pitch: D(0), roll: 0 });
  assert.ok(p && Math.abs(p.x - 0.5) < 1e-9, 'doit etre au centre');
});
t('sans roulis : coherent avec la formule ligne', () => {
  for (const pd of [0, 8, 20]) {
    const p = G.groundPointInImage(3.5, { ...V, pitch: D(pd), roll: 0 });
    const y = G.yForGroundDistance(3.5, { height: 1, pitch: D(pd), halfFovV: P.halfFovV });
    assert.ok(Math.abs(p.y - y) < 1e-9, `pitch=${pd}`);
  }
});
t('roulis : le point se decale lateralement', () => {
  const a = G.groundPointInImage(3.5, { ...V, pitch: D(10), roll: 0 });
  const b = G.groundPointInImage(3.5, { ...V, pitch: D(10), roll: D(15) });
  assert.ok(b.x > a.x + 0.01, 'doit sortir du centre');
});
t('roulis symetrique', () => {
  const l = G.groundPointInImage(3.5, { ...V, pitch: D(10), roll: D(-15) });
  const r = G.groundPointInImage(3.5, { ...V, pitch: D(10), roll: D(15) });
  assert.ok(Math.abs((l.x - 0.5) + (r.x - 0.5)) < 1e-9);
  assert.ok(Math.abs(l.y - r.y) < 1e-9);
});
t('vise le ciel -> null', () => {
  assert.equal(G.groundPointInImage(3.5, { ...V, pitch: D(-40), roll: 0 }), null);
});
t('plus loin = plus haut dans l image', () => {
  const near = G.groundPointInImage(2, { ...V, pitch: D(15), roll: 0 });
  const far = G.groundPointInImage(6, { ...V, pitch: D(15), roll: 0 });
  assert.ok(far.y < near.y);
});
console.log(`\n${pass} tests OK`);

console.log('\n--- position du point 3,5 m (h=1 m) ---');
for (const rd of [0, 10, 25]) {
  const row = [0, 10, 25].map(pd => {
    const p = G.groundPointInImage(3.5, { ...V, pitch: D(pd), roll: D(rd) });
    return p ? `(${(p.x*100).toFixed(0)}%,${(p.y*100).toFixed(0)}%)` : 'hors cadre';
  });
  console.log(`  roulis ${String(rd).padStart(2)}deg  ->  inclinaison 0/10/25deg : ${row.join('  ')}`);
}
