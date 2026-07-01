// Service heartbeat photographe + queue alertes offline.
// LOT 1.6 du plan pilote event 500+.
//
// Objectif : l orga (Geoffrey) est prevenu automatiquement si le benevole
// a un probleme, meme si son iPhone n a plus de reseau.
//
// Design :
// - Heartbeat toutes les 10 min sur POST /photographer/heartbeat.
//   Payload : etat batterie/reseau/stockage/thermal/queue + flag crash.
//   L absence de heartbeat serveur > 15 min declenche une alerte Discord
//   (logique cote worker/cron dans LOT 3.3).
//
// - Alertes evenementielles (kind = network/battery/storage/...) :
//   posees dans une queue AsyncStorage avec started_at (moment ou le
//   probleme a commence). Envoyees en POST /photographer/alerts des que
//   le reseau revient. Ne se perdent pas si l app est tuee.
//
// - "L absence de signal EST le signal" : le worker considere un silence
//   heartbeat comme un incident meme si aucune alerte n a ete recue.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import NetInfo from '@react-native-community/netinfo';
import { Paths } from 'expo-file-system';
import { getCurrentThermalState } from './thermalMonitor';
import { photographerRuntime } from '../utils/photographerRuntime';

const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const ALERT_QUEUE_KEY = '@will:photographer_alerts_queue';
const DEVICE_ID_KEY = '@will:photographer_device_id';

let heartbeatTimer = null;
let getContext = null; // callback qui renvoie l etat live du screen
let netUnsub = null;
// Cache module-level du dernier contexte capture (eventCode + deviceId).
// Utilise par enqueueAlert pour stamper l alerte AU MOMENT ou elle est
// creee (audit code 2026-07-01 : sans ca, une alerte enfilee sous
// eventA puis drainee sous eventB serait envoyee avec le mauvais code).
let lastKnownEventCode = null;
let lastKnownDeviceId = null;

async function getDeviceId() {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY).catch(() => null);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id).catch(() => {});
  }
  return id;
}

// Public : appele par PhotographerScreen des qu un rawCriticalKind bascule
// a une nouvelle valeur. On garde started_at (moment ou le probleme a
// vraiment commence). Dedupe : une seule entree active PAR (kind, event_code).
// event_code / device_id : stampes ici (pas au drain) pour survivre a un
// switch d event pendant l offline (une alerte de eventA drainee sous
// eventB doit garder eventA -- sinon le worker rejette 403 event_mismatch).
export async function enqueueAlert(kind, detail = null) {
  const now = Date.now();
  const eventCode = lastKnownEventCode;
  const deviceId = lastKnownDeviceId;
  // Sans contexte connu (avant premier heartbeat), on met en attente : le
  // stampage se fera au premier heartbeat qui hydrate lastKnownEventCode.
  // Cas rare car startHeartbeat resout deviceId synchronement au mount.
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    const q = raw ? JSON.parse(raw) : [];
    // Dedupe strict : meme kind + meme event + toujours en attente.
    if (q.some(a => a.kind === kind && !a.sent_at && a.event_code === eventCode)) return;
    q.push({
      kind,
      detail,
      event_code: eventCode || null,
      device_id: deviceId || null,
      started_at: now,
      sent_at: null,
    });
    await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

// Drain : envoie les alertes en attente dont l event_code == currentEventCode.
// Une alerte stampee sur un autre event reste en queue jusqu au prochain
// startHeartbeat sur cet event-la (rare : app photographe = 1 event / session).
async function drainAlertQueue(apiFetch, currentEventCode, currentDeviceId) {
  if (!currentEventCode || !currentDeviceId) return;
  try {
    const raw = await AsyncStorage.getItem(ALERT_QUEUE_KEY);
    const q = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(q) || q.length === 0) return;
    // Toutes les alertes non-envoyees. On backfill event_code / device_id
    // si l entree est nue (enqueueAlert avant premier heartbeat).
    const now = Date.now();
    const pending = q.filter(a => !a.sent_at);
    const toSend = pending.filter(a => (a.event_code || currentEventCode) === currentEventCode);
    if (toSend.length === 0) return;
    const batch = toSend.map(a => ({
      event_code: a.event_code || currentEventCode,
      device_id: a.device_id || currentDeviceId,
      kind: a.kind,
      detail: a.detail || null,
      started_at: a.started_at,
      sent_at: now,
    }));
    const res = await apiFetch('/photographer/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: batch }),
    });
    if (!res?.ok) return;
    // Marque envoyees UNIQUEMENT celles envoyees dans ce batch. On les
    // identifie par started_at (assez unique en pratique : ms + kind).
    const sentSignatures = new Set(toSend.map(a => `${a.kind}:${a.started_at}`));
    const updated = q.map(a => {
      if (a.sent_at) return a;
      const sig = `${a.kind}:${a.started_at}`;
      if (sentSignatures.has(sig)) return { ...a, sent_at: now };
      return a;
    });
    const cutoff = now - 24 * 60 * 60 * 1000;
    const trimmed = updated.filter(a => !a.sent_at || a.sent_at >= cutoff).slice(-100);
    await AsyncStorage.setItem(ALERT_QUEUE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[heartbeat] drainAlertQueue failed', e?.message);
  }
}

async function buildContext() {
  if (!getContext) return null;
  let live = null;
  try { live = getContext(); } catch { return null; }
  if (!live || !live.eventCode) return null;
  const [free, batteryLevel, batteryState, netState] = await Promise.all([
    (async () => {
      try {
        const f = Paths.document?.availableSpace ?? Paths.cache?.availableSpace;
        return typeof f === 'number' ? f : null;
      } catch { return null; }
    })(),
    Battery.getBatteryLevelAsync().catch(() => null),
    Battery.getBatteryStateAsync().catch(() => null),
    NetInfo.fetch().catch(() => null),
  ]);
  const online = netState ? (!!netState.isConnected && netState.isInternetReachable !== false) : true;
  return {
    event_code: live.eventCode,
    device_id: live.deviceId,
    network_ok: online,
    battery_level: batteryLevel != null ? Math.round(batteryLevel * 100) / 100 : null,
    battery_charging: batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL,
    storage_free_gb: free != null ? Math.round((free / (1024 * 1024 * 1024)) * 10) / 10 : null,
    thermal_state: getCurrentThermalState(),
    queue_pending: live.pendingCount || 0,
    last_upload_at: live.lastUploadAt || null,
    armed: !!live.armed,
    recovered_from_crash: !!photographerRuntime.recoveredFromCrash,
    client_ts: Date.now(),
  };
}

async function sendHeartbeat(apiFetch) {
  const ctx = await buildContext();
  if (!ctx?.event_code) return;
  try {
    const res = await apiFetch('/photographer/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
    });
    if (res?.ok) {
      // Consomme le flag crash apres un heartbeat reussi.
      if (photographerRuntime.recoveredFromCrash) photographerRuntime.recoveredFromCrash = false;
      // Reseau confirme OK -> tenter drain queue alertes.
      await drainAlertQueue(apiFetch, ctx.event_code, ctx.device_id);
    }
  } catch {}
}

// Public : demarre le service. contextGetter doit renvoyer :
//   { eventCode, pendingCount, armed, lastUploadAt }
// (deviceId est injecte ici, PhotographerScreen n a pas a le connaitre).
// Retourne une cleanup function.
export async function startHeartbeat(apiFetch, contextGetter) {
  const deviceId = await getDeviceId();
  lastKnownDeviceId = deviceId;
  // Wrappe le getter pour injecter deviceId + hydrater le cache module.
  const wrappedGetter = () => {
    const live = contextGetter() || {};
    if (live.eventCode) lastKnownEventCode = live.eventCode;
    return { ...live, deviceId };
  };
  getContext = wrappedGetter;
  // Premier envoi immediat (au mount du screen). Fire-and-forget : si
  // offline, il rate silencieusement, le netInfo listener redemarrera
  // au retour reseau.
  sendHeartbeat(apiFetch);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => { sendHeartbeat(apiFetch); }, HEARTBEAT_INTERVAL_MS);
  // Sur retour reseau : force un heartbeat + drain queue immediat pour
  // envoyer les alertes bufferisees pendant l offline.
  if (netUnsub) { try { netUnsub(); } catch {} netUnsub = null; }
  netUnsub = NetInfo.addEventListener(state => {
    const online = !!state.isConnected && state.isInternetReachable !== false;
    if (online) sendHeartbeat(apiFetch);
  });
  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (netUnsub) { try { netUnsub(); } catch {} netUnsub = null; }
    getContext = null;
    // Note : on garde lastKnownEventCode / lastKnownDeviceId pour que les
    // alertes queued survivent au unmount (ex: retour bouton Retour puis
    // remount, les alertes offline non-drainees seront envoyees au 1er
    // heartbeat post-remount).
  };
}
