// Reducer per-burst : regroupe les items deja scores par burstTs, calcule
// le composite, et marque upload_kept / upload_skipped. Ne supprime RIEN
// (sous-etape C : flags seulement, le drainQueue ignore les flags jusqu'a D).
//
// Conformite CONCEPTION_TRI_QUALITE_LOCAL.md §5 :
//   - Pas de seuil absolu : top-N relatif au burst, toujours au moins 1.
//   - Failsafe "scoring KO complet" : si tous les items du burst sont en
//     qualityScoreFailed, on garde TOUS (pas de discrimination possible).
//   - Failsafe "score uniformement bas" : top-1 garde quand meme, par
//     construction du sort.
//
// Tous les poids sont des PARAMETRES (default ici, runtime-tunable en F).

import { PASSAGE_KEEP_TOP_N_MOBILE, BURST_REDUCE_DELAY_MS } from '../constants/queue';

// Pondérations défaut (Σ = 1.00). Cf CONCEPTION §4.1 :
//   - Miroir serveur : brightness 0.27, face_confidence 0.40, eyes_open 0.13
//     (proportions sharpness-out de 0.2/0.3/+10 redistribuees sur 0.80).
//   - Bonus locaux : face_area 0.10 (tunable au calibrage E),
//     yaw 0.10 (face camera).
export const QUALITY_DEFAULT_WEIGHTS = Object.freeze({
  faceConfidence: 0.30,
  brightness:     0.20,
  eyesOpen:       0.10,
  faceArea:       0.10,
  yaw:            0.10,
  // Centrage du visage : decision user 2026-06-28 event J. Le user veut
  // garder les photos ou il est le plus au milieu de l image. Le scorer
  // renvoyait deja biggestFaceCenter [cx, cy] (oublie d integrer au
  // composite a l implementation). Poids 0.20 (fort) pour matcher
  // l intention produit.
  center:         0.20,
});

// 5 % de l'aire image = score plein (visage proche). Sous 5 %, le score
// est lineaire. Tunable au calibrage E.
export const QUALITY_DEFAULT_FACE_AREA_NORM = 0.05;

// Sanitize une config quality venue de /config (worker, donc untrusted).
// Garde-fous :
//   - poids tous numeriques + non negatifs
//   - Σ poids ∈ [0.9 ; 1.1] (sinon fallback default complet pour eviter
//     une formule degeneree silencieuse)
//   - faceAreaNorm ∈ ]0, 1]
//   - topN entier >= 1
// Retourne TOUJOURS un objet utilisable (jamais d'exception).
export function sanitizeQualityConfig(cfg) {
  const fallback = {
    weights: { ...QUALITY_DEFAULT_WEIGHTS },
    faceAreaNorm: QUALITY_DEFAULT_FACE_AREA_NORM,
    topN: PASSAGE_KEEP_TOP_N_MOBILE,
    reduceDelayMs: BURST_REDUCE_DELAY_MS,
    sanitized: false,
  };
  if (!cfg || typeof cfg !== 'object') return fallback;
  const w = cfg.weights;
  if (!w || typeof w !== 'object') return fallback;
  const keys = ['faceConfidence', 'brightness', 'eyesOpen', 'faceArea', 'yaw'];
  let sum = 0;
  const safe = {};
  for (const k of keys) {
    const v = Number(w[k]);
    if (!Number.isFinite(v) || v < 0) return fallback;
    safe[k] = v;
    sum += v;
  }
  if (sum < 0.9 || sum > 1.1) return fallback;
  const norm = Number(cfg.faceAreaNorm);
  const topN = Number(cfg.topN);
  const reduceDelayMs = Number(cfg.reduceDelayMs);
  return {
    weights: safe,
    faceAreaNorm: Number.isFinite(norm) && norm > 0 && norm <= 1 ? norm : QUALITY_DEFAULT_FACE_AREA_NORM,
    topN: Number.isFinite(topN) && topN >= 1 ? Math.floor(topN) : PASSAGE_KEEP_TOP_N_MOBILE,
    reduceDelayMs: Number.isFinite(reduceDelayMs) && reduceDelayMs > 0 ? reduceDelayMs : BURST_REDUCE_DELAY_MS,
    sanitized: true,
  };
}

// Score pour un item en qualityScoreFailed dans le tri composite. Negatif
// pour qu'un item failed tombe sous tout item scoré, sans pour autant
// faire planter la formule (NaN safety).
const FAILED_SCORE = -1;

// yawScore(y) : retourne 1 pour |y| <= 30°, 0 pour |y| > 60°, transition
// lineaire entre. y en radians (Vision).
function yawScore(yawRad) {
  const yawDeg = Math.abs(yawRad) * 180 / Math.PI;
  if (yawDeg <= 30) return 1;
  if (yawDeg >= 60) return 0;
  return (60 - yawDeg) / 30;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Centrage du visage : 1 si parfaitement centre (cx=0.5, cy=0.5), 0 si
// dans un coin. Distance euclidienne au centre / distance max (sqrt(0.5)).
function centerScore(centerArr) {
  if (!Array.isArray(centerArr) || centerArr.length < 2) return 0;
  const cx = Number(centerArr[0]);
  const cy = Number(centerArr[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return 0;
  const dx = cx - 0.5;
  const dy = cy - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = Math.SQRT1_2; // sqrt(0.5) ≈ 0.7071
  return Math.max(0, Math.min(1, 1 - dist / maxDist));
}

// Calcule scoreComposite ∈ [0, 1] a partir des signaux bruts du scorer
// natif et des poids courants. Pure (testable sans device).
export function computeComposite(signals, weights = QUALITY_DEFAULT_WEIGHTS, faceAreaNorm = QUALITY_DEFAULT_FACE_AREA_NORM) {
  if (!signals) return FAILED_SCORE;
  const w = weights || QUALITY_DEFAULT_WEIGHTS;
  const norm = faceAreaNorm > 0 ? faceAreaNorm : QUALITY_DEFAULT_FACE_AREA_NORM;
  const faceConf = clamp01(signals.faceConfidence ?? 0);
  const brightness = clamp01(signals.brightness ?? 0);
  const eyesOpenContrib =
    (signals.eyesOpenApplicable && signals.eyesOpen) ? 1 : 0;
  const faceAreaContrib = clamp01((signals.biggestFaceArea ?? 0) / norm);
  const yawContrib = yawScore(signals.yaw ?? 0);
  const centerContrib = centerScore(signals.biggestFaceCenter);
  return (
      w.faceConfidence * faceConf
    + w.brightness     * brightness
    + w.eyesOpen       * eyesOpenContrib
    + w.faceArea       * faceAreaContrib
    + w.yaw            * yawContrib
    + (w.center || 0)  * centerContrib
  );
}

// Un item est "ready" pour entrer dans le tri si :
//   - il a un qualityScore OU un qualityScoreFailed, OU
//   - le delai BURST_REDUCE_DELAY_MS depuis sa capture est depasse (alors
//     il sera traite comme score_failed pour ce burst).
// On exclut les items 'processing'/'uploading' pour eviter une race avec
// processQueue/drainQueue.
function isItemRipe(item, nowMs, delayMs) {
  if (!item) return false;
  if (item.status === 'processing' || item.status === 'uploading') return false;
  if (item.qualityScore || item.qualityScoreFailed) return true;
  const captured = item.createdAt || 0;
  return (nowMs - captured) > delayMs;
}

// Regroupe les items par burstTs. Retourne Map<burstTs, items[]>.
function groupByBurst(items) {
  const m = new Map();
  for (const it of items) {
    if (!it || it.burstTs == null) continue;
    const key = String(it.burstTs);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(it);
  }
  return m;
}

// Decide kept/skipped pour UN burst donne. Retourne :
//   { kept: Set<id>, skipped: Set<id>, allFailed: bool, perItem: [...] }
//
// allFailed = true -> failsafe : tous kept, aucun skipped (pas de tri
// possible). PROMESSE "jamais 0 photo livree" garantie ici + par la
// regle "top-1 toujours kept" du sort.
export function reduceBurst(items, weights, faceAreaNorm, topN) {
  if (!items || items.length === 0) {
    return { kept: new Set(), skipped: new Set(), allFailed: false, perItem: [] };
  }
  const TOP_N = topN || PASSAGE_KEEP_TOP_N_MOBILE;

  const allFailed = items.every(it => !it.qualityScore);
  if (allFailed) {
    // Failsafe : aucun signal exploitable, on garde tout. Le worker fera
    // son tri par-dessus si necessaire.
    return {
      kept: new Set(items.map(it => it.id)),
      skipped: new Set(),
      allFailed: true,
      perItem: items.map(it => ({ id: it.id, composite: FAILED_SCORE, decision: 'kept-allfailed' })),
    };
  }

  // Mode "garde tout" 2026-06-28 (event J en cours) : on garde tout si
  //   (a) au moins 1 photo a faceCount >= 2 (peloton ou 2e coureur dans
  //       le cadre)
  //   (b) le burst contient >= 7 photos (suggere plusieurs coureurs passes
  //       sur la duree, meme s ils n etaient jamais simultanement dans
  //       le cadre). Cas signale : 2 coureurs espaces ou le 2e n etait
  //       jamais sur la meme photo que le 1er.
  // Top-3 strict applique UNIQUEMENT au cas solo court (1 visage, burst
  // <= 6 photos).
  const maxFacesInBurst = items.reduce((max, it) => {
    const fc = it.qualityScore?.faceCount;
    return (typeof fc === 'number' && fc > max) ? fc : max;
  }, 0);
  const isMulti = maxFacesInBurst >= 2 || items.length >= 7;
  if (isMulti) {
    // Cutoff dur centrage : meme en mode multi, on skip les photos ou
    // le visage est trop loin du centre horizontal (|cx - 0.5| > 0.3 =
    // visage hors des 60% centraux). Cas signale 2026-06-28 : 2 coureurs
    // mal cadres a gauche, gardes a tort en mode multi. Failsafe : si
    // toutes les photos echouent ce cutoff, on garde tout quand meme
    // (promesse "jamais 0").
    const keptIds = new Set();
    const skippedIds = new Set();
    for (const it of items) {
      const sig = it.qualityScore;
      const cx = Array.isArray(sig?.biggestFaceCenter)
        ? Number(sig.biggestFaceCenter[0])
        : NaN;
      const fc = sig?.faceCount ?? 0;
      const biggestCentered = !Number.isFinite(cx) || Math.abs(cx - 0.5) <= 0.3;
      // On garde si :
      //  - le plus grand visage est centre (cas standard)
      //  - OU la photo a >=2 visages (le scorer natif ne renvoie que le
      //    centre du plus grand ; les autres visages peuvent etre dans
      //    la zone, on prefere la securite de garder)
      // On skip uniquement si 1 seul visage et hors zone, ou aucun visage.
      const keep = biggestCentered || fc >= 2;
      if (keep) keptIds.add(it.id);
      else skippedIds.add(it.id);
    }
    if (keptIds.size === 0) {
      // Failsafe : aucune photo centree -> garde tout pour ne livrer
      // jamais 0 photo. Le worker fera le tri par runner par-dessus.
      return {
        kept: new Set(items.map(it => it.id)),
        skipped: new Set(),
        allFailed: false,
        perItem: items.map(it => ({
          id: it.id,
          composite: it.qualityScore
            ? computeComposite(it.qualityScore, weights, faceAreaNorm)
            : FAILED_SCORE,
          decision: 'kept-multi-fallback',
        })),
      };
    }
    return {
      kept: keptIds,
      skipped: skippedIds,
      allFailed: false,
      perItem: items.map(it => ({
        id: it.id,
        composite: it.qualityScore
          ? computeComposite(it.qualityScore, weights, faceAreaNorm)
          : FAILED_SCORE,
        decision: keptIds.has(it.id) ? 'kept-multi' : 'skipped-offcenter',
      })),
    };
  }

  // Tri composite DESC. Items en score_failed -> composite = FAILED_SCORE
  // (ils tombent sous tout item scoré et ne pousseront pas un scored item
  // hors du top-N).
  const scored = items.map(it => ({
    item: it,
    composite: it.qualityScore
      ? computeComposite(it.qualityScore, weights, faceAreaNorm)
      : FAILED_SCORE,
  }));
  scored.sort((a, b) => b.composite - a.composite);

  const kept = new Set();
  const skipped = new Set();
  const perItem = [];
  for (let i = 0; i < scored.length; i++) {
    const { item, composite } = scored[i];
    if (i < TOP_N) {
      kept.add(item.id);
      perItem.push({ id: item.id, composite, decision: 'kept' });
    } else {
      skipped.add(item.id);
      perItem.push({ id: item.id, composite, decision: 'skipped' });
    }
  }
  return { kept, skipped, allFailed: false, perItem };
}

// API principale : prend la queue complete, retourne un patch a appliquer
// item-par-item ({ id -> {upload_kept|upload_skipped, qualityComposite} }).
// Ne touche QUE les items non encore decidés (pas de upload_kept ni
// upload_skipped) et dont le burst est ripe.
//
// Retourne aussi un summary per-burst pour la telemetrie (cf F).
export function reduceBursts(queueItems, opts = {}) {
  const now = opts.now || Date.now();
  const delayMs = opts.burstReduceDelayMs || BURST_REDUCE_DELAY_MS;
  const weights = opts.weights || QUALITY_DEFAULT_WEIGHTS;
  const faceAreaNorm = opts.faceAreaNorm || QUALITY_DEFAULT_FACE_AREA_NORM;
  const topN = opts.topN || PASSAGE_KEEP_TOP_N_MOBILE;

  // Filtre : items non encore traites par le reducer (pas de flag).
  const pending = (queueItems || []).filter(it =>
    it && !it.upload_kept && !it.upload_skipped
  );
  if (pending.length === 0) return { patches: {}, bursts: [] };

  const groups = groupByBurst(pending);
  const patches = {};
  const bursts = [];

  for (const [burstTsStr, items] of groups) {
    // Burst pas encore complet ET pas encore en timeout : on attend.
    const allRipe = items.every(it => isItemRipe(it, now, delayMs));
    if (!allRipe) continue;

    const out = reduceBurst(items, weights, faceAreaNorm, topN);
    for (const it of items) {
      const composite = (out.perItem.find(p => p.id === it.id) || {}).composite;
      if (out.kept.has(it.id)) {
        patches[it.id] = { upload_kept: true, qualityComposite: composite };
      } else if (out.skipped.has(it.id)) {
        patches[it.id] = { upload_skipped: true, qualityComposite: composite };
      }
    }

    bursts.push({
      burstTs: Number(burstTsStr),
      total: items.length,
      kept: out.kept.size,
      skipped: out.skipped.size,
      allFailed: out.allFailed,
      perItem: out.perItem,
    });
  }

  return { patches, bursts };
}
