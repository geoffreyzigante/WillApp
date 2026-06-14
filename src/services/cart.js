// Panier d'achat photos : sync local + serveur cross-device.
//
// Le cart vit en AsyncStorage (cle `will:cart:{eventCode}`) mais doit rester
// en phase entre PhotoViewerModal (qui le mute) et EventDetail (qui affiche
// le CTA + la modale). L'emitter notifie les consumers quand une mutation
// locale a lieu, declenchant un refetch dans les composants qui montent
// useCart().
//
// Pour les users authentifies, chaque mutation locale est aussi pushee vers
// /runner/cart cote serveur (best-effort, .catch silent). Sync au login = merge
// union entre local et serveur (cf reference_will_runner_cart_endpoint memoire).

import { API_URL } from '../constants/api';

export const cartChangeListeners = new Set();

export function emitCartChange() {
  cartChangeListeners.forEach((fn) => { try { fn(); } catch {} });
}

// Reference module-scope vers la session runner courante. Pilote par App
// via setCurrentRunnerSession() a chaque changement de runnerSession. Permet
// aux hooks useCart/useAllCarts (qui n'ont pas l'auth en props) de pousser
// vers le backend /runner/cart quand l'user est authentifie.
let _runnerSessionRef = null;
export function setCurrentRunnerSession(s) { _runnerSessionRef = s || null; }
export function getCurrentRunnerSession() { return _runnerSessionRef; }

export function pushCartToBackend(eventCode, keys) {
  const s = getCurrentRunnerSession();
  if (!s?.token || !eventCode) return;
  fetch(`${API_URL}/runner/cart/${encodeURIComponent(eventCode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify({ keys: Array.isArray(keys) ? keys : [] }),
  }).catch(() => {});
}
