// Constantes du pipeline upload offline-first.
//
// La queue persiste les metadonnees (status, retries, nextAttemptAt) dans
// AsyncStorage sous UPLOAD_QUEUE_KEY. Les photos elles-memes vivent sur
// disque dans Paths.document/{PENDING_DIR_NAME}/{RAW_SUBDIR|PROCESSED_SUBDIR}/
// pour survivre au kill app / restart iPhone.
//
// MAX_QUEUE_SIZE et STORAGE_WARN_BYTES sont alignes : 1000 photos x ~5 Mo
// HEIC = 5 Go, c'est aussi le seuil d'alerte stockage. Couvre un peloton
// dense entier meme avec 4G saturee.
//
// QUEUE_WARN_THRESHOLD = moitie du cap : suffisamment haut pour ne pas
// spammer en event 4G lente normale. La queue n'est plus jamais tronquee
// silencieusement : la zero-perte est garantie par les garde-fous disque
// (5 Go pendingDir + DISK_CRITICAL_PERCENT du volume iPhone) qui desarment
// l'auto-capture en amont.

export const UPLOAD_QUEUE_KEY = '@will_upload_queue';
export const LAST_CAPTURE_KEY = '@will_last_capture_at';
export const PENDING_DIR_NAME = 'will_pending';
export const RAW_SUBDIR = 'raw';            // capture brute + sidecar JSON
export const PROCESSED_SUBDIR = 'processed'; // post-enhance/burn/encode
export const COVERS_DIR_NAME = 'will_event_covers';

export const MAX_RETRIES_DEFAULT = 5;
export const STORAGE_WARN_BYTES = 5 * 1024 * 1024 * 1024; // 5 Go pendingDir
export const DISK_LOW_BYTES = 1 * 1024 * 1024 * 1024;     // 1 Go iPhone restant
export const QUEUE_WARN_THRESHOLD = 500;
export const MAX_QUEUE_SIZE = 1000;
// Seuil dur d'utilisation disque iPhone : au-dela, on coupe l'auto-capture
// pour eviter la corruption d'ecriture / crash OOM. Reactivation manuelle
// par le photographe une fois l'upload draine.
export const DISK_CRITICAL_PERCENT = 0.95;

// Backoff exponentiel borne : delai (ms) avant retry #n. Plafonne a 8s.
// Reutilise par le worker upload ET le worker burn EXIF (meme bareme).
export function retryDelayMs(retries) {
  return Math.min(2000 * Math.pow(2, Math.max(0, retries - 1)), 8000);
}
