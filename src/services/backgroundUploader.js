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

if (bgUploaderEmitter) {
  bgUploaderEmitter.addListener('BackgroundUploaderComplete', (evt) => {
    const { itemId, success, statusCode, error } = evt || {};
    const pending = pendingBgUploads.get(itemId);
    if (!pending) return;
    pendingBgUploads.delete(itemId);
    pending.resolve({ ok: !!success, status: statusCode || 0, error: error || null });
  });
}
