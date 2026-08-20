// Wrapper JS du module natif iOS BackgroundUploader (cf
// plugins/BackgroundUploader.m). Delegue les PUT R2 a URLSession.background
// -- iOS continue meme app minimisee/suspended, streaming depuis le fichier
// (zero blob RAM). HTTP/3 auto-negocie (iOS 14.5+).
//
// Si le module n'est pas dans le binary (Expo Go, dev sans build natif),
// hasBackgroundUploader = false et le caller doit fallback fetch.
//
// Pattern d'usage cote drainQueue :
//   pendingBgUploads.set(itemId, { resolve, reject });
//   await BackgroundUploaderModule.enqueueUpload(url, filePath, headers, itemId);
//   // l'event Complete arrive et resolve la promise via pendingBgUploads.

import { NativeModules, NativeEventEmitter } from 'react-native';

export const BackgroundUploaderModule = NativeModules.BackgroundUploader;
export const hasBackgroundUploader = !!(
  BackgroundUploaderModule && BackgroundUploaderModule.enqueueUpload
);

export const bgUploaderEmitter = hasBackgroundUploader
  ? new NativeEventEmitter(BackgroundUploaderModule)
  : null;

// Mapping itemId -> { resolve, reject } pour faire le pont entre l'event
// natif BackgroundUploaderComplete et le worker JS qui await sur le
// resultat. Module-level (pas useRef) pour survivre aux re-renders et au
// cas ou un upload finit juste apres unmount du screen photographe.
export const pendingBgUploads = new Map();

// ─── Uploads ORPHELINS ────────────────────────────────────────────────────
// Un upload lance avant un cold start survit cote iOS mais son await JS a
// disparu avec l ancienne session : l event Complete arrive sans promise en
// attente. Ces cas-la sont reconcilies directement sur la file par App.js.
//
// UN SEUL listener, ici. Avant, App.js en enregistrait un SECOND qui se
// croyait protege par `if (pendingBgUploads.has(itemId)) return`. Ce garde
// etait mort : les listeners RN sont appeles dans l ordre d enregistrement,
// celui-ci s enregistre a l import (donc avant le montage du composant) et
// consomme l entree de la Map — si bien que le garde d App.js voyait
// TOUJOURS une Map vide et reconciliait CHAQUE upload.
//
// Consequence avant correction : "Uploadees" comptait double, et surtout,
// avec l upload en deux temps, la reussite de la COPIE LEGERE declenchait la
// suppression de l ORIGINAL sur le telephone et le retrait de l item de la
// file — l original n ayant jamais ete envoye. R2 n aurait garde que la
// copie degradee, sans que rien ne le signale.
//
// D ou ce dispatch unique : la voie orpheline n est empruntee que si aucune
// promise n attend, ce qui est exactement sa raison d etre.
let orphanHandler = null;

/**
 * Enregistre le gestionnaire des uploads orphelins. Retourne une fonction de
 * desinscription (a appeler dans le cleanup du useEffect).
 */
export function setOrphanUploadHandler(fn) {
  orphanHandler = fn;
  return () => { if (orphanHandler === fn) orphanHandler = null; };
}

if (bgUploaderEmitter) {
  bgUploaderEmitter.addListener('BackgroundUploaderComplete', (evt) => {
    const { itemId, success, statusCode, error } = evt || {};
    const pending = pendingBgUploads.get(itemId);
    if (pending) {
      pendingBgUploads.delete(itemId);
      pending.resolve({ ok: !!success, status: statusCode || 0, error: error || null });
      return;
    }
    if (orphanHandler) {
      try { orphanHandler(evt); } catch (e) { console.warn('[bgupload] orphan handler', e?.message || e); }
    }
  });
}
