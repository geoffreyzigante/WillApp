// Tests du declencheur par lignes — rejeu de sequences de frames synthetiques.
//
// Hors repo : le projet est CommonJS/Babel, node ne peut pas charger le module
// ESM en place. Copier framingGuide-style dans /tmp avec {"type":"module"} :
//   rm -rf /tmp/lttest && mkdir -p /tmp/lttest && \
//   cp src/services/lineTrigger.js src/services/__tests__/lineTrigger.test.mjs /tmp/lttest/ && \
//   cd /tmp/lttest && echo '{"type":"module"}' > package.json && node lineTrigger.test.mjs

import assert from 'node:assert/strict';
import { createLineTrigger, computeLines, LINE_TRIGGER_DEFAULTS } from './lineTrigger.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const FPS = 10;
const STEP = 1 / FPS;                 // secondes entre deux frames Vision
const W = 0.08, H = 0.10;             // visage adulte typique a ~4 m
const AREA = W * H;                   // 0.008 > creditMinArea (0.005)

// Construit une frame plate [ts, n, cx,cy,w,h, ...]
function frame(ts, faces) {
  const out = [ts, faces.length];
  for (const f of faces) out.push(f.x, f.y ?? 0.5, f.w ?? W, f.h ?? H);
  return out;
}

// Rejoue une sequence et retourne tous les tirs.
function run(trigger, seq) {
  const fires = [];
  for (const { ts, faces } of seq) {
    for (const a of trigger.ingest(frame(ts, faces))) fires.push({ ...a, ts });
  }
  return fires;
}

// Passage lineaire : x va de x0 a x1 a la vitesse vx (largeur/s).
function passage(t0, x0, x1, vx, jitter = 0, rnd = null) {
  const seq = [];
  const dir = Math.sign(x1 - x0);
  const dur = Math.abs(x1 - x0) / vx;
  for (let ts = t0; ts <= t0 + dur + 1e-9; ts += STEP) {
    const x = x0 + dir * vx * (ts - t0) + (jitter ? (rnd() * 2 - 1) * jitter : 0);
    seq.push({ ts, faces: [{ x }] });
  }
  return seq;
}

// PRNG deterministe — pas de Math.random dans les tests.
function makeRnd(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const LINES = computeLines(0.30, [-0.45, 0, 0.45]);
console.log(`lignes @ zone 0.30 : ${LINES.map((l) => l.toFixed(4)).join(' / ')}`);
console.log(`span des lignes : ${(LINES[2] - LINES[0]).toFixed(4)}\n`);

// ─── a. Passage normal → exactement 3 tirs ────────────────────────────────
t('a. passage normal (vx 0.35/s) -> exactement 3 tirs', () => {
  const trg = createLineTrigger();
  const fires = run(trg, passage(100, 0.30, 0.70, 0.35));
  assert.equal(fires.length, 3, `attendu 3, obtenu ${fires.length}`);
  assert.ok(fires.every((f) => f.reason === 'line'));
});

// ─── b. Immobile 5 s avec bruit → <= 3 tirs puis silence (F5) ─────────────
t('b. immobile 5 s + bruit bbox ±0.01 -> <= 3 tirs, silence sur la fin', () => {
  const trg = createLineTrigger();
  const rnd = makeRnd(42);
  const seq = [];
  for (let ts = 100; ts <= 105 + 1e-9; ts += STEP) {
    seq.push({ ts, faces: [{ x: 0.50 + (rnd() * 2 - 1) * 0.01 }] });
  }
  const fires = run(trg, seq);
  assert.ok(fires.length <= 3, `attendu <= 3, obtenu ${fires.length}`);
  const late = fires.filter((f) => f.ts > 103);
  assert.equal(late.length, 0, `tirs apres 3 s : ${late.length}`);
  assert.equal(trg.snapshot()[0].isStatic, true, 'le track doit etre STATIQUE');
});

// ─── c. Clignotement en milieu de passage → toujours 3 au total (F3) ──────
t('c. clignotement 400 ms en milieu de passage -> 3 tirs au total', () => {
  const trg = createLineTrigger();
  const full = passage(100, 0.30, 0.70, 0.35);
  const mid = Math.floor(full.length / 2);
  const seq = full.filter((_, i) => i < mid || i >= mid + 4); // 4 frames sautees
  const fires = run(trg, seq);
  assert.equal(fires.length, 3, `attendu 3, obtenu ${fires.length}`);
});

// ─── d. Immobile, detection perdue 2 s, retrouvee → 0 tir en plus ─────────
t('d. immobile, perdu 2 s, retrouve -> aucun tir supplementaire', () => {
  const trg = createLineTrigger();
  const rnd = makeRnd(7);
  const a = [];
  for (let ts = 100; ts <= 104 + 1e-9; ts += STEP) {
    a.push({ ts, faces: [{ x: 0.50 + (rnd() * 2 - 1) * 0.01 }] });
  }
  const before = run(trg, a).length;
  const b = [];
  for (let ts = 106; ts <= 108 + 1e-9; ts += STEP) {
    b.push({ ts, faces: [{ x: 0.50 + (rnd() * 2 - 1) * 0.01 }] });
  }
  const after = run(trg, b).length;
  assert.equal(after, 0, `attendu 0 apres retour, obtenu ${after}`);
  assert.ok(before <= 3);
});

// ─── e. Traversee rapide : 3 lignes en < 150 ms → 1 tir (F2) ──────────────
t('e. traversee rapide -> 1 seul tir, 3 lignes consommees', () => {
  const trg = createLineTrigger();
  const seq = [
    { ts: 100.0, faces: [{ x: 0.38 }] },
    { ts: 100.1, faces: [{ x: 0.62 }] },   // franchit les 3 lignes d'un coup
    { ts: 100.2, faces: [{ x: 0.86 }] },
  ];
  const fires = run(trg, seq);
  assert.equal(fires.length, 1, `attendu 1, obtenu ${fires.length}`);
  assert.equal(fires[0].reason, 'multi-line');
  assert.equal(fires[0].lines.length, 3);
});

// ─── f. Arret avant la 1re ligne puis demi-tour ───────────────────────────
t('f1. entre, s arrete avant la 1re ligne 1 s, ressort -> 1 tir (F1)', () => {
  const trg = createLineTrigger();
  const seq = [];
  for (let ts = 100; ts <= 100.4 + 1e-9; ts += STEP) seq.push({ ts, faces: [{ x: 0.40 - (ts - 100) * 0.10 }] });
  for (let ts = 100.5; ts <= 101.4 + 1e-9; ts += STEP) seq.push({ ts, faces: [{ x: 0.36 }] });
  for (let ts = 101.5; ts <= 102.0 + 1e-9; ts += STEP) seq.push({ ts, faces: [{ x: 0.36 - (ts - 101.5) * 0.30 }] });
  const fires = run(trg, seq);
  assert.equal(fires.length, 1, `attendu 1, obtenu ${fires.length}`);
  assert.equal(fires[0].reason, 'exit-zero');
});

t('f2. meme scenario mais STATIQUE (4 s) -> aucun tir', () => {
  const trg = createLineTrigger();
  const seq = [];
  for (let ts = 100; ts <= 104 + 1e-9; ts += STEP) seq.push({ ts, faces: [{ x: 0.36 }] });
  for (let ts = 104.1; ts <= 104.6 + 1e-9; ts += STEP) seq.push({ ts, faces: [{ x: 0.36 - (ts - 104.1) * 0.30 }] });
  const fires = run(trg, seq);
  assert.equal(fires.length, 0, `attendu 0, obtenu ${fires.length}`);
});

// ─── g. Deux visages qui se croisent → jamais un track a 0 photo ──────────
t('g. croisement de deux coureurs -> aucun track termine a 0 photo', () => {
  const trg = createLineTrigger();
  const seq = [];
  for (let ts = 100; ts <= 101.2 + 1e-9; ts += STEP) {
    const p = ts - 100;
    seq.push({ ts, faces: [{ x: 0.32 + p * 0.30 }, { x: 0.68 - p * 0.30 }] });
  }
  const fires = run(trg, seq);
  const credited = new Set();
  for (const f of fires) for (const id of f.creditedIds) credited.add(id);
  assert.ok(credited.size >= 2, `attendu >= 2 tracks credites, obtenu ${credited.size}`);
  for (const tr of trg.snapshot()) {
    assert.ok(tr.photos > 0, `track ${tr.id} termine a 0 photo`);
  }
});

// ─── h. Peloton de 5 → <= 5 tirs au total (credit) ───────────────────────
t('h. peloton de 5 -> <= 5 tirs au total', () => {
  const trg = createLineTrigger();
  const seq = [];
  for (let ts = 100; ts <= 101.5 + 1e-9; ts += STEP) {
    const base = 0.30 + (ts - 100) * 0.30;
    seq.push({ ts, faces: [0, 1, 2, 3, 4].map((k) => ({ x: base + k * 0.012, y: 0.4 + k * 0.02 })) });
  }
  const fires = run(trg, seq);
  assert.ok(fires.length <= 5, `attendu <= 5, obtenu ${fires.length}`);
  for (const tr of trg.snapshot()) assert.ok(tr.photos > 0, `track ${tr.id} a 0 photo`);
});

console.log(`\n${pass} tests OK\n`);

// ─── Diagnostic : jusqu'a quelle vitesse obtient-on 3 photos ? ────────────
// Le plancher sequentiel du capteur (cooldown 150 ms) borne le nombre de tirs
// sur la duree de traversee des lignes. Information de terrain, pas un test.
console.log('--- tirs obtenus selon la vitesse de traversee ---');
for (const vx of [0.2, 0.3, 0.35, 0.45, 0.6, 0.9, 1.5, 2.5]) {
  const trg = createLineTrigger();
  const n = run(trg, passage(100, 0.30, 0.70, vx)).length;
  const spanMs = ((LINES[2] - LINES[0]) / vx) * 1000;
  console.log(`  vx=${vx.toFixed(2)}/s  (lignes traversees en ${spanMs.toFixed(0)} ms)  ->  ${n} tir(s)`);
}
console.log(`\ncooldown capteur : ${LINE_TRIGGER_DEFAULTS.cooldownMs} ms`);

// Le facteur limitant n'est pas la traversee de la ZONE mais celle du SPAN DES
// LIGNES, qui n'en couvre que 45 %. Combien d'ecartement faut-il pour qu'un
// coureur reel obtienne ses 3 photos ?
console.log('\n--- vitesse max pour 3 tirs, selon l ecartement des lignes ---');
for (const k of [0.45, 0.60, 0.75, 0.90]) {
  const trg = createLineTrigger({ lineOffsets: [-k, 0, k] });
  let vmax = 0;
  for (let vx = 0.10; vx <= 1.5; vx += 0.01) {
    const g = createLineTrigger({ lineOffsets: [-k, 0, k] });
    if (run(g, passage(100, 0.20, 0.80, vx)).length >= 3) vmax = vx;
  }
  const span = trg.getLines()[2] - trg.getLines()[0];
  // vx = v / largeur_image ; largeur_image ~ 1.0 a 1.35 x distance
  const at4m = (vmax * 4.5).toFixed(1), at6m = (vmax * 7).toFixed(1);
  console.log(`  offsets ±${k.toFixed(2)}  span=${span.toFixed(3)}  vx_max=${vmax.toFixed(2)}/s`
    + `  ~= ${at4m} m/s a 4 m, ${at6m} m/s a 6 m`);
}
console.log('\n(coureur sur route = 3 m/s ; marche = 1,5 m/s)');
