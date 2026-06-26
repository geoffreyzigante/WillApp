// Telemetrie session du tri qualite local. Garde en memoire la distribution
// des signaux bruts + composite, et un cumul par burst, pour fournir au
// calibrage E (sous-etape suivante) des donnees concretes plutot que des
// intuitions.
//
// Pas de persistance disque ici : la telemetrie est session-scopee (perdue
// au kill app). Suffisant pour le calibrage : on capture un event de test,
// on lit le summary a la fin de session avant kill.
//
// Volume : a 1500 coureurs x 3 passages x 8 photos = 36 000 entrees, on
// stocke ~250 octets/entree = ~9 Mo de RAM. Acceptable pour une session.
// On cap a SESSION_CAP=50 000 par securite (au-dela on stoppe l'accumulation
// mais on continue a tenir compteurs).

const SESSION_CAP = 50000;

function emptyState() {
  return {
    perPhoto: [],          // [{ id, burstTs, signals?, scoreFailed, composite?, decision? }]
    perBurst: [],          // [{ burstTs, total, kept, skipped, allFailed }]
    counters: {
      scored: 0,
      scoreFailed: 0,
      kept: 0,
      skipped: 0,
      bursts: 0,
      burstsAllFailed: 0,
    },
    capReached: false,
  };
}

let state = emptyState();

export function resetTelemetry() {
  state = emptyState();
}

export function recordScore(item, result) {
  if (state.perPhoto.length >= SESSION_CAP) {
    state.capReached = true;
    return;
  }
  if (result.ok) {
    state.counters.scored += 1;
    state.perPhoto.push({
      id: item.id,
      burstTs: item.burstTs,
      signals: result.signals,
      elapsedMs: result.signals?.elapsedMs ?? null,
      scoreFailed: false,
    });
  } else {
    state.counters.scoreFailed += 1;
    state.perPhoto.push({
      id: item.id,
      burstTs: item.burstTs,
      reason: result.reason,
      scoreFailed: true,
    });
  }
}

export function recordBurstReduction(burst) {
  if (state.perBurst.length >= SESSION_CAP) {
    state.capReached = true;
    return;
  }
  state.counters.bursts += 1;
  if (burst.allFailed) state.counters.burstsAllFailed += 1;
  state.counters.kept += burst.kept;
  state.counters.skipped += burst.skipped;
  state.perBurst.push({
    burstTs: burst.burstTs,
    total: burst.total,
    kept: burst.kept,
    skipped: burst.skipped,
    allFailed: burst.allFailed,
  });
}

// Distribution synthese : moyennes / mediane / p10 / p90 par signal.
function summarize(values) {
  const xs = values.filter(v => Number.isFinite(v));
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  const idx = p => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(p * xs.length)))];
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    n: xs.length,
    mean: round(mean, 4),
    p10: round(idx(0.10), 4),
    median: round(idx(0.50), 4),
    p90: round(idx(0.90), 4),
    min: round(xs[0], 4),
    max: round(xs[xs.length - 1], 4),
  };
}

function round(x, digits) {
  const f = Math.pow(10, digits);
  return Math.round(x * f) / f;
}

export function getSummary() {
  const photos = state.perPhoto.filter(p => !p.scoreFailed && p.signals);
  return {
    counters: { ...state.counters },
    capReached: state.capReached,
    photosScored: photos.length,
    burstsReduced: state.perBurst.length,
    signals: {
      faceConfidence:   summarize(photos.map(p => p.signals.faceConfidence)),
      brightness:       summarize(photos.map(p => p.signals.brightness)),
      biggestFaceArea:  summarize(photos.map(p => p.signals.biggestFaceArea)),
      yaw:              summarize(photos.map(p => Math.abs(p.signals.yaw || 0))),
      elapsedMs:        summarize(photos.map(p => p.elapsedMs)),
    },
    burstSizeDistribution: summarize(state.perBurst.map(b => b.total)),
  };
}

// Dump JSON brut pour analyse offline (calibrage E).
export function getRawTelemetry() {
  return JSON.parse(JSON.stringify(state));
}
