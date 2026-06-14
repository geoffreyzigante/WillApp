// Persistance locale : file system (pendingDir + raw/processed/covers),
// sidecar JSON metadonnees photos, queue d'upload AsyncStorage.
//
// Le pipeline upload est offline-first : photos sur disque dans
// Paths.document/{PENDING_DIR_NAME}/{RAW_SUBDIR|PROCESSED_SUBDIR}/{id}.heic,
// metadonnees queue dans AsyncStorage sous UPLOAD_QUEUE_KEY. Survit au
// kill app, restart iPhone, et meme aux purges iOS sous pression stockage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Paths, File, Directory } from 'expo-file-system';

import {
  UPLOAD_QUEUE_KEY,
  PENDING_DIR_NAME,
  RAW_SUBDIR,
  PROCESSED_SUBDIR,
  COVERS_DIR_NAME,
} from '../constants/queue';

// === Dirs ===

export function pendingDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME);
}

export function rawDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME, RAW_SUBDIR);
}

export function processedDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME, PROCESSED_SUBDIR);
}

export function coversDir() {
  return new Directory(Paths.document, COVERS_DIR_NAME);
}

export function ensurePendingDir() {
  try {
    const d = pendingDir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    const r = rawDir();
    if (!r.exists) r.create({ intermediates: true, idempotent: true });
    const p = processedDir();
    if (!p.exists) p.create({ intermediates: true, idempotent: true });
    return d;
  } catch (e) {
    console.warn('ensurePendingDir', e?.message);
    return null;
  }
}

export function ensureCoversDir() {
  try {
    const d = coversDir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  } catch { return null; }
}

// === Sidecar JSON ===
// Metadonnees de capture (EXIF + contexte race/km) ecrites a cote du fichier
// brut. Atomic write via tmp + rename pour eviter une lecture partielle en
// cas de crash entre write et fsync.

export async function writeSidecar(id, payload) {
  try {
    const dir = rawDir();
    const tmp = new File(dir, `${id}.json.tmp`);
    const final = new File(dir, `${id}.json`);
    const json = JSON.stringify(payload);
    if (tmp.exists) { try { tmp.delete(); } catch {} }
    tmp.create();
    tmp.write(json);
    try { if (final.exists) final.delete(); } catch {}
    tmp.move(final);
    return final.uri;
  } catch (e) {
    console.warn('writeSidecar', id, e?.message);
    return null;
  }
}

export function readSidecar(id) {
  try {
    const f = new File(rawDir(), `${id}.json`);
    if (!f.exists) return null;
    const raw = f.textSync();
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('readSidecar', id, e?.message);
    return null;
  }
}

export function deleteSidecar(id) {
  try {
    const f = new File(rawDir(), `${id}.json`);
    if (f.exists) f.delete();
  } catch {}
}

// === Event covers cache offline ===
// Telecharge le cover de l'event vers le dossier persistant pour affichage
// offline. Idempotent : si le fichier existe deja, on renvoie l'URI sans
// re-telecharger.

export async function cacheEventCover(eventCode, remoteUrl) {
  if (!eventCode || !remoteUrl) return null;
  try {
    ensureCoversDir();
    const cleanPath = remoteUrl.split('?')[0];
    const rawExt = (cleanPath.split('.').pop() || 'jpg').toLowerCase();
    const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg';
    const safeCode = String(eventCode).replace(/[^a-zA-Z0-9_-]/g, '_');
    const dest = new File(coversDir(), `${safeCode}.${ext}`);
    if (dest.exists && (dest.size || 0) > 0) return dest.uri;
    const d = await File.downloadFileAsync(remoteUrl, dest, { idempotent: true });
    return d?.uri || dest.uri;
  } catch (e) {
    console.warn('cacheEventCover', e?.message);
    return null;
  }
}

// === Queue persistante ===

export async function loadUploadQueue() {
  try {
    const raw = await AsyncStorage.getItem(UPLOAD_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function saveUploadQueue(arr) {
  try {
    await AsyncStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(arr));
  } catch (e) { console.warn('saveUploadQueue', e?.message); }
}

// === Taille disque pendingDir ===
// Recursif : depuis le refactor pipeline, les photos sont reparties entre
// pendingDir/raw/{id}.heic + sidecar et pendingDir/processed/{id}.heic.
// L'alerte STORAGE_WARN_BYTES doit voir l'ensemble.

export function pendingDirSizeBytes() {
  function walk(dir) {
    if (!dir.exists) return 0;
    let total = 0;
    try {
      for (const node of dir.list()) {
        if (node instanceof File) total += node.size || 0;
        else if (node instanceof Directory) total += walk(node);
      }
    } catch {}
    return total;
  }
  try { return walk(pendingDir()); } catch { return 0; }
}

// Version throttle pour le backpressure burst : pendingDirSizeBytes() walk
// recursivement le dir (peut etre 1000 fichiers en pleine course), trop
// lourd a appeler par shot. On cache la valeur 30s -- assez frais pour
// servir de circuit breaker disque sans ralentir la cadence rafale (5-7 ph/s).
let _pendingDirCachedBytes = 0;
let _pendingDirCachedAt = 0;
export function pendingDirSizeBytesCached(maxAgeMs = 30000) {
  const now = Date.now();
  if (now - _pendingDirCachedAt < maxAgeMs) return _pendingDirCachedBytes;
  _pendingDirCachedBytes = pendingDirSizeBytes();
  _pendingDirCachedAt = now;
  return _pendingDirCachedBytes;
}
