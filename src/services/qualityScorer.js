// Wrapper JS du module natif PhotoQualityScorer.
//
// Le module natif vit dans plugins/PhotoQualityScorer.swift sur sa propre
// DispatchQueue serial QoS .utility -- isole physiquement de la queue
// capture. Voir CONCEPTION_TRI_QUALITE_LOCAL.md §3 pour la garantie
// "capture jamais ralentie".
//
// Politique d'echec :
//   - Module natif absent (Expo Go / dev sans rebuild) -> score_failed
//   - .dng ProRAW skip -> score_failed (E_RAW)
//   - Timeout SCORE_TIMEOUT_MS -> score_failed
//   - Exception runtime -> score_failed
// Dans tous les cas : pipeline continue, photo uploadee telle quelle.
// "score_failed" est traite par le reducer comme "score inconnu" et la
// photo reste candidate au top-N (jamais drope par defaut).

import { NativeModules } from 'react-native';
import { SCORE_TIMEOUT_MS } from '../constants/queue';

const { PhotoQualityScorer } = NativeModules;

// Strip "file://" prefix si present : le natif accepte les deux formes
// mais on uniformise pour les logs.
function cleanPath(uri) {
  if (!uri) return uri;
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

// Lance scoreRaw avec un timeout. Retourne :
//   { ok: true,  signals: {...bruts}, elapsedMs }
//   { ok: false, reason: 'no-module' | 'raw' | 'timeout' | 'error', error?: string }
//
// Ne throw JAMAIS. processQueue depend de cette robustesse pour
// failsafer la photo.
export async function scorePhotoSafely(rawUri, timeoutMs = SCORE_TIMEOUT_MS) {
  if (!PhotoQualityScorer?.scoreRaw) {
    return { ok: false, reason: 'no-module' };
  }
  const srcPath = cleanPath(rawUri);
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`scoreRaw timeout ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    const signals = await Promise.race([
      PhotoQualityScorer.scoreRaw(srcPath),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);
    return { ok: true, signals, elapsedMs: signals?.elapsedMs };
  } catch (e) {
    clearTimeout(timeoutHandle);
    const msg = String(e?.message || e || '');
    if (msg.includes('E_RAW')) return { ok: false, reason: 'raw' };
    if (msg.includes('timeout')) return { ok: false, reason: 'timeout', error: msg };
    return { ok: false, reason: 'error', error: msg };
  }
}
