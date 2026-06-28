// Tests des failsafes du tri qualite local (sous-etape C).
//
// But : prouver, AVANT de coder la sous-etape D (qui supprime vraiment des
// photos), les deux invariants critiques du reducer :
//
//   1. "Toutes basses" : un burst dont toutes les photos scorent un
//      composite tres bas garde quand meme le top-N (top-1 minimum). On
//      ne livre JAMAIS 0 photo.
//
//   2. "Scoring KO" : un burst dont toutes les photos sont en
//      qualityScoreFailed=true est integralement garde (failsafe : pas
//      de tri possible, on n'elimine rien).
//
// Lancement :
//   node scripts/test_quality_failsafes.mjs
//
// Exit code != 0 si un invariant n'est pas tenu.

import { reduceBurst, reduceBursts, computeComposite } from '../src/services/qualityReducer.js';

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Test 1 : Burst dont toutes les photos scorent BAS -> garde top-N
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 1] Toutes basses → garde la meilleure (top-N, min top-1)');
{
  // 4 photos, toutes avec des signaux "mauvais" mais legerement differents
  // pour qu'un sort soit possible. Aucun visage, brightness moyenne basse,
  // yaw en biais.
  const burst = [
    { id: 'a', burstTs: 1000, status: 'pending',
      qualityScore: { faceCount: 0, faceConfidence: 0,    biggestFaceArea: 0,    yaw: 0.7, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.10 } },
    { id: 'b', burstTs: 1000, status: 'pending',
      qualityScore: { faceCount: 0, faceConfidence: 0,    biggestFaceArea: 0,    yaw: 0.6, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.12 } },
    { id: 'c', burstTs: 1000, status: 'pending',
      qualityScore: { faceCount: 0, faceConfidence: 0,    biggestFaceArea: 0,    yaw: 0.8, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.20 } },
    { id: 'd', burstTs: 1000, status: 'pending',
      qualityScore: { faceCount: 0, faceConfidence: 0,    biggestFaceArea: 0,    yaw: 0.9, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.08 } },
  ];
  const out = reduceBurst(burst);
  const composites = burst.map(it => ({
    id: it.id,
    composite: computeComposite(it.qualityScore),
  }));
  console.log('  composites :', composites.map(c => `${c.id}=${c.composite.toFixed(3)}`).join(', '));

  assert(out.allFailed === false, 'allFailed=false (les photos ont des scores, meme bas)');
  assert(out.kept.size >= 1, `kept.size >= 1 (= ${out.kept.size})`);
  assert(out.kept.size === 3, `kept.size === TOP_N=3 (= ${out.kept.size})`);
  assert(out.skipped.size === 1, `skipped.size === 1 (= ${out.skipped.size})`);
  // Le top-1 doit etre celui de composite max (= 'c' avec brightness 0.20)
  assert(out.kept.has('c'), 'le top-1 (id=c, brightness 0.20) est kept');
  // Le bas du tri doit etre celui de composite min (= 'd' brightness 0.08)
  assert(out.skipped.has('d'), 'le bottom-1 (id=d, brightness 0.08) est skipped');
  assert(burst.every(it => out.kept.has(it.id) || out.skipped.has(it.id)),
         'tous les items sont classes (pas d orphan)');
}

// ──────────────────────────────────────────────────────────────────────
// Test 2 : Burst dont TOUTES les photos sont en qualityScoreFailed
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 2] Scoring KO complet → garde TOUT');
{
  const burst = [
    { id: 'e', burstTs: 2000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'timeout' },
    { id: 'f', burstTs: 2000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'timeout' },
    { id: 'g', burstTs: 2000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'error' },
    { id: 'h', burstTs: 2000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'no-module' },
  ];
  const out = reduceBurst(burst);
  assert(out.allFailed === true, 'allFailed=true');
  assert(out.kept.size === burst.length, `kept.size === ${burst.length} (TOUT garde)`);
  assert(out.skipped.size === 0, 'skipped.size === 0 (rien jete)');
  assert(burst.every(it => out.kept.has(it.id)),
         `chaque item ${burst.map(b=>b.id).join('/')} est dans kept`);
}

// ──────────────────────────────────────────────────────────────────────
// Test 3 (sanity) : Burst mixte (scored + failed) -> les scored gagnent
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 3 sanity] Burst mixte scored+failed → failed tombent au fond');
{
  const burst = [
    { id: 'i', burstTs: 3000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.95, biggestFaceArea: 0.08, yaw: 0,    eyesOpen: true,  eyesOpenApplicable: true, brightness: 0.55 } },
    { id: 'j', burstTs: 3000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.85, biggestFaceArea: 0.06, yaw: 0.3,  eyesOpen: true,  eyesOpenApplicable: true, brightness: 0.50 } },
    { id: 'k', burstTs: 3000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.60, biggestFaceArea: 0.03, yaw: 0.6,  eyesOpen: false, eyesOpenApplicable: false, brightness: 0.40 } },
    { id: 'l', burstTs: 3000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'timeout' },
    { id: 'm', burstTs: 3000, status: 'pending', qualityScoreFailed: true, qualityScoreFailReason: 'timeout' },
  ];
  const out = reduceBurst(burst);
  console.log('  kept    :', [...out.kept]);
  console.log('  skipped :', [...out.skipped]);
  assert(out.allFailed === false, 'allFailed=false (mixte)');
  assert(out.kept.size === 3, `kept.size === 3 (= TOP_N) [got ${out.kept.size}]`);
  // Les 3 scored doivent gagner contre les 2 failed
  assert(out.kept.has('i') && out.kept.has('j') && out.kept.has('k'),
         'les 3 scored (i, j, k) sont kept');
  assert(out.skipped.has('l') && out.skipped.has('m'),
         'les 2 failed (l, m) tombent en skipped');
}

// ──────────────────────────────────────────────────────────────────────
// Test 4 (sanity reduceBursts) : 2 bursts en parallele, traitement correct
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4 sanity] 2 bursts paralleles → reduits independamment');
{
  const now = Date.now();
  const old = now - 10000; // > BURST_REDUCE_DELAY_MS, donc ripe
  const queue = [
    // Burst A : 2 scored (top-3 non plein -> tous kept)
    { id: 'n1', burstTs: 100, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.9, biggestFaceArea: 0.07, yaw: 0, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.5 } },
    { id: 'n2', burstTs: 100, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.7, biggestFaceArea: 0.05, yaw: 0.2, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.45 } },
    // Burst B : 5 scored (top-3 plein, 2 skipped)
    { id: 'm1', burstTs: 200, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.95, biggestFaceArea: 0.08, yaw: 0, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.6 } },
    { id: 'm2', burstTs: 200, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.90, biggestFaceArea: 0.07, yaw: 0.1, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.55 } },
    { id: 'm3', burstTs: 200, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.85, biggestFaceArea: 0.06, yaw: 0.2, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.50 } },
    { id: 'm4', burstTs: 200, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.70, biggestFaceArea: 0.04, yaw: 0.4, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.40 } },
    { id: 'm5', burstTs: 200, status: 'pending', createdAt: old,
      qualityScore: { faceCount: 1, faceConfidence: 0.50, biggestFaceArea: 0.02, yaw: 0.7, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.30 } },
  ];
  const { patches, bursts } = reduceBursts(queue, { now });
  assert(bursts.length === 2, `2 bursts reduits (= ${bursts.length})`);
  const a = bursts.find(b => b.burstTs === 100);
  const b = bursts.find(b => b.burstTs === 200);
  assert(a.total === 2 && a.kept === 2 && a.skipped === 0,
         `burstA: total=2 kept=2 skipped=0 (got total=${a.total} kept=${a.kept} skipped=${a.skipped})`);
  assert(b.total === 5 && b.kept === 3 && b.skipped === 2,
         `burstB: total=5 kept=3 skipped=2 (got total=${b.total} kept=${b.kept} skipped=${b.skipped})`);
  // Les top-3 de B doivent etre m1, m2, m3 (composites desc)
  assert(patches.m1?.upload_kept && patches.m2?.upload_kept && patches.m3?.upload_kept,
         'burstB top-3 = m1, m2, m3 marques upload_kept');
  assert(patches.m4?.upload_skipped && patches.m5?.upload_skipped,
         'burstB m4, m5 marques upload_skipped');
}

// ──────────────────────────────────────────────────────────────────────
// Test 5 (edge) : burst d'un seul item (cas burst tronque ou single shot)
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 5 edge] Burst single → toujours kept (jamais 0)');
{
  const single = [
    { id: 'solo', burstTs: 4000, status: 'pending',
      qualityScore: { faceCount: 0, faceConfidence: 0, biggestFaceArea: 0, yaw: 1.5, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.05 } },
  ];
  const out = reduceBurst(single);
  assert(out.kept.size === 1, `single burst -> kept.size=1 (got ${out.kept.size})`);
  assert(out.kept.has('solo'), 'solo est kept');
}

// ──────────────────────────────────────────────────────────────────────
// Test 6 RETIRE 2026-06-28 : mode peloton desactive (cf qualityReducer).
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
// Test 7 : Solo (max faceCount = 1) -> top-3 normal
// ──────────────────────────────────────────────────────────────────────
console.log('\n[TEST 7] Solo (max faceCount = 1) → top-3 normal');
{
  const burst = [
    { id: 's1', burstTs: 6000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.9, biggestFaceArea: 0.08, yaw: 0, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.6 } },
    { id: 's2', burstTs: 6000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.7, biggestFaceArea: 0.05, yaw: 0.2, eyesOpen: true, eyesOpenApplicable: true, brightness: 0.5 } },
    { id: 's3', burstTs: 6000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.5, biggestFaceArea: 0.03, yaw: 0.4, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.4 } },
    { id: 's4', burstTs: 6000, status: 'pending',
      qualityScore: { faceCount: 1, faceConfidence: 0.3, biggestFaceArea: 0.02, yaw: 0.6, eyesOpen: false, eyesOpenApplicable: false, brightness: 0.3 } },
  ];
  const out = reduceBurst(burst);
  assert(out.kept.size === 3, `kept.size === 3 (top-N solo) [got ${out.kept.size}]`);
  assert(out.skipped.size === 1, `skipped.size === 1 (got ${out.skipped.size})`);
}

// ──────────────────────────────────────────────────────────────────────
// Bilan
// ──────────────────────────────────────────────────────────────────────
console.log(failures === 0
  ? '\n✓ Tous les failsafes sont tenus.\n'
  : `\n✗ ${failures} assertion(s) KO.\n`);
process.exit(failures === 0 ? 0 : 1);
