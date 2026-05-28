import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions, RefreshControl,
  StatusBar, SafeAreaView, Platform, KeyboardAvoidingView, Animated, Easing, Keyboard, Linking,
  AppState, Share, NativeModules,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as Font from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraDevices,
  useCameraPermission,
  useFrameProcessor,
  useCameraFormat,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';

// Frame processor plugin natif (Swift) : detection humaine via Apple Vision
// VNDetectHumanRectanglesRequest. Enregistre par le config plugin
// with-human-detector au build EAS. Retourne { count: number }.
const humanDetectorPlugin = VisionCameraProxy.initFrameProcessorPlugin('detectHumans', {});
function detectHumans(frame, options) {
  'worklet';
  if (humanDetectorPlugin == null) {
    throw new Error('detectHumans plugin not loaded — rebuild required');
  }
  return humanDetectorPlugin.call(frame, options);
}

// Frame processor plugin natif (Swift) : lit l'ISO/shutter/brightness live
// depuis les attachments EXIF du CMSampleBuffer de preview, en lecture seule
// (n'altere PAS l'exposition auto). Sert au voyant lumiere dans la vue
// photographe : actif des l'ouverture de la camera, avant toute capture.
// Enregistre par le config plugin with-exposure-reader au build EAS.
// Retourne { iso, shutter, brightness } ou null.
const exposureReaderPlugin = VisionCameraProxy.initFrameProcessorPlugin('readExposure', {});
function readExposure(frame) {
  'worklet';
  if (exposureReaderPlugin == null) {
    throw new Error('readExposure plugin not loaded — rebuild required');
  }
  return exposureReaderPlugin.call(frame);
}

// Format shutter EXIF (secondes -> fraction lisible) pour debug overlay.
// Sur preview iOS, le shutter est cape par l'intervalle frame (1/30s a
// 30 fps) : on ne descend jamais sous quelques 1/30s, l'auto-expo monte
// l'ISO a la place. Donc tjrs format "1/N" en pratique, mais on garde
// le cas >= 1s par securite (jamais vu sur preview video).
function formatShutter(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `1/${Math.round(1 / seconds)}`;
}
// EV BrightnessValue : peut etre negatif (faible lumiere) ou positif
// (plein jour). Affichage avec signe explicite pour lecture rapide.
function formatEV(ev) {
  if (!Number.isFinite(ev)) return '—';
  const sign = ev >= 0 ? '+' : '−';
  return `EV ${sign}${Math.abs(ev).toFixed(1)}`;
}
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import Svg, { Path, Circle, Ellipse, Defs, Mask, Rect, SvgXml } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import NetInfo from '@react-native-community/netinfo';
import { Paths, File, Directory } from 'expo-file-system';
import * as Updates from 'expo-updates';

// Active le panneau debug en build de dev (Metro/expo start) ou de preview
// (EAS preview channel). En production, le bouton ⚙️ est masque pour ne pas
// laisser fuiter des toggles internes a l'utilisateur final.
const IS_PREVIEW_OR_DEV = __DEV__ || Updates.channel === 'preview';

const API_URL = 'https://will-api.geoffreyzigante.workers.dev';
const R2_PUBLIC = 'https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev';
const { width: SCREEN_W } = Dimensions.get('window');

// ─── E2 — PUSH NOTIFS ────────────────────────────────────────────────────
// Foreground handler : quand une notif arrive avec l app au premier plan,
// on affiche tout de meme la banniere + son (sinon iOS la "consomme" en
// silence). Le badge applicatif est gere ailleurs (E3 — pastille onglet).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── SecureStore : stockage chiffre des sessions/consentement (M-S08) ─────
// Cles a migrer d AsyncStorage → SecureStore : sessions runner/organizer/
// photographer + consentement biometrique. SecureStore n accepte que
// [A-Za-z0-9._-] : on normalise les cles "@will_*" en "will_*".
const SECURE_KEYS = [
  '@will_runner',
  '@will_organizer',
  '@will_photographer_session',
  '@will_biometric_consent_v1',
];
const toSecureKey = (k) => k.replace(/^@/, 'will_');
const Secure = {
  getItem: (k) => SecureStore.getItemAsync(toSecureKey(k)),
  setItem: (k, v) => SecureStore.setItemAsync(toSecureKey(k), v),
  removeItem: (k) => SecureStore.deleteItemAsync(toSecureKey(k)),
};

// Migration one-shot au demarrage : pour chaque cle sensible, si elle existe
// dans AsyncStorage, on la copie vers SecureStore puis on l efface. Idempotent
// (skip si AsyncStorage vide ou SecureStore deja peuple).
async function migrateSensitiveKeysToSecureStore() {
  for (const k of SECURE_KEYS) {
    try {
      const v = await AsyncStorage.getItem(k);
      if (v === null) continue;
      const existing = await SecureStore.getItemAsync(toSecureKey(k));
      if (existing === null) await SecureStore.setItemAsync(toSecureKey(k), v);
      await AsyncStorage.removeItem(k);
    } catch (e) {
      console.warn('[migrate-secure]', k, e?.message || e);
    }
  }
}

// Mode photographe offline-first : queue persistante d'uploads
// + photos stockées hors-cache pour survivre au kill / nettoyage iOS.
//
// Pipeline decouple capture / traitement (refactor mai 2026) :
//   capture (takePhoto) → will_pending/raw/{id}.heic + sidecar {id}.json
//                       → queue item { processed:false, status:'pending' }
//   processQueue worker → enhance + burn EXIF + reencode HEIC (natif, serial)
//                       → will_pending/processed/{id}.heic
//                       → queue item { processed:true, status:'pending' }
//   drainQueue (existant) → PUT R2, gated par NetInfo + backoff exponentiel
//
// Le bit `processed` est orthogonal au `status` (pending/uploading/failed).
// drainQueue ne touche que les items processed=true. processQueue ne touche
// que les items processed=false. Les deux peuvent tourner en parallele sans
// se marcher dessus.
const UPLOAD_QUEUE_KEY = '@will_upload_queue';
const LAST_CAPTURE_KEY = '@will_last_capture_at';
const PENDING_DIR_NAME = 'will_pending';
const RAW_SUBDIR = 'raw';            // capture brute + sidecar JSON
const PROCESSED_SUBDIR = 'processed'; // post-enhance/burn/encode, pret upload
const COVERS_DIR_NAME = 'will_event_covers';
const MAX_RETRIES_DEFAULT = 5;
const STORAGE_WARN_BYTES = 5 * 1024 * 1024 * 1024; // 5 Go pendingDir
const DISK_LOW_BYTES = 1 * 1024 * 1024 * 1024;     // 1 Go iPhone restant
const QUEUE_WARN_THRESHOLD = 100;
// Plafond dur de la queue : au-dela, on FIFO-drop les plus anciens 'pending'/
// 'failed' (jamais 'uploading') pour eviter qu'un evenement long sans reseau
// ne sature le stockage. Aligne sur le brief Phase 2 (200 photos).
const MAX_QUEUE_SIZE = 200;
// Backoff exponentiel borne : delai (ms) avant retry #n. Plafonne a 8s.
function retryDelayMs(retries) {
  return Math.min(2000 * Math.pow(2, Math.max(0, retries - 1)), 8000);
}

function pendingDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME);
}

function rawDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME, RAW_SUBDIR);
}

function processedDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME, PROCESSED_SUBDIR);
}

function coversDir() {
  return new Directory(Paths.document, COVERS_DIR_NAME);
}

function ensurePendingDir() {
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

// Sidecar JSON : metadonnees de capture (EXIF + contexte race/km) ecrites
// a cote du fichier brut. Atomic write via tmp + rename pour eviter une
// lecture partielle en cas de crash entre write et fsync.
async function writeSidecar(id, payload) {
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

function readSidecar(id) {
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

function deleteSidecar(id) {
  try {
    const f = new File(rawDir(), `${id}.json`);
    if (f.exists) f.delete();
  } catch {}
}

function ensureCoversDir() {
  try {
    const d = coversDir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  } catch { return null; }
}

// Télécharge le cover de l'event vers le dossier persistant pour affichage
// offline. Retourne l'URI local ou null. Idempotent : si le fichier existe
// déjà, on renvoie l'URI sans re-télécharger.
async function cacheEventCover(eventCode, remoteUrl) {
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

// "Il y a 3 min", "Il y a 2 h", "Hier", "Le 11 mai" — pour alerte de reprise.
function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'il y a quelques secondes';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  try {
    const d = new Date(ts);
    return `le ${d.getDate()}/${d.getMonth() + 1}`;
  } catch { return ''; }
}

async function loadUploadQueue() {
  try {
    const raw = await AsyncStorage.getItem(UPLOAD_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function saveUploadQueue(arr) {
  try {
    await AsyncStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(arr));
  } catch (e) { console.warn('saveUploadQueue', e?.message); }
}

function pendingDirSizeBytes() {
  // Recursif : depuis le refactor pipeline, les photos sont reparties entre
  // pendingDir/raw/{id}.heic + sidecar et pendingDir/processed/{id}.heic.
  // L'alerte STORAGE_WARN_BYTES doit voir l'ensemble.
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

function generateItemId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------- DESIGN TOKENS ----------
const C = {
  bg: '#FFFFFF',
  primary: '#7B2FFF',
  primaryDark: '#5A1FCC',
  primaryLight: '#E8DEFF',
  text: '#0A0A0A',
  textSoft: '#6B6B7B',
  white: '#FFFFFF',
  pillBg: '#EFE7FF',
  pinkPill: '#F4A6FF',
  pinkPillText: '#FFFFFF',
  pinkPillBg: '#FDECFF',
  pinkPillActive: '#E673FF',
  violetAccent: '#7C3AED',
  card: '#FFFFFF',
  shadow: 'rgba(123, 47, 255, 0.08)',
};

// Palette arc-en-ciel synchronisée avec dashboard (src/orga/pages/EventCard.js
// → TYPE_TINTS) et landing (will-app.com section "Pour qui"). Toute
// modification doit être répercutée sur les trois surfaces.
// Clés en lowercase pour que le lookup soit insensible à la casse + aux
// espaces parasites du champ event_type stocké en R2 — utiliser colorForType()
// au lieu d'indexer directement TYPE_COLORS.
const TYPE_COLORS = {
  trail: '#22C55E',
  'course sur route': '#3B82F6',
  cross: '#A855F7',
  triathlon: '#6366F1',
  velo: '#F97316',
  marche: '#EAB308',
  autre: '#EF4444',
};
const colorForType = (eventType) => {
  const k = (eventType || '').toLowerCase().trim();
  return TYPE_COLORS[k] || TYPE_COLORS.autre;
};

// Label affiché pour event_type ; la valeur stockée reste sans accent ("Velo").
const displayEventType = (t) => (t === 'Velo' ? 'Vélo' : t);

// ---------- ICONS (custom SVG) ----------
const Icon = {
  User: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size * (18.96/17.61)} height={size} viewBox="0 0 18.96 17.61" fill={color}>
      <Path d="M10.16,0h-1.35C3.94,0,0,3.94,0,8.8s3.94,8.8,8.8,8.8h1.35c4.86,0,8.8-3.94,8.8-8.8S15.02,0,10.16,0ZM9.48,2.77c1.28,0,2.32,1.14,2.32,2.55s-1.04,2.55-2.32,2.55-2.32-1.14-2.32-2.55,1.04-2.55,2.32-2.55ZM9.48,14.33c-2.58,0-4.67-1.23-4.67-2.75s2.09-2.75,4.67-2.75,4.67,1.23,4.67,2.75-2.09,2.75-4.67,2.75Z" />
    </Svg>
  ),
  Search: ({ size = 18, color = '#FFFFFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Circle cx="9" cy="9" r="6" stroke={color} strokeWidth={2} />
      <Path d="M14 14L18 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  Home: ({ size = 24, color = '#7B2FFF' }) => (
    <Svg width={size} height={size * (17.61/16.44)} viewBox="0 0 16.44 17.61" fill={color}>
      <Path d="M9.38.44c-.66-.59-1.66-.59-2.32,0L.58,6.23c-.37.33-.58.8-.58,1.3v8.34c0,.96.78,1.74,1.74,1.74h12.96c.96,0,1.74-.78,1.74-1.74V7.53c0-.5-.21-.97-.58-1.3L9.38.44ZM10.81,15.11c0,.62-.5,1.12-1.12,1.12h-2.95c-.62,0-1.12-.5-1.12-1.12v-4.21c0-.62.5-1.12,1.12-1.12h2.95c.62,0,1.12.5,1.12,1.12v4.21Z" />
    </Svg>
  ),
  Events: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (17.61/17.65)} viewBox="0 0 17.65 17.61" fill={color}>
      <Path d="M17.64,7.63c0-.16-.28-.3-.42-.31l-2.1-.22c-.13-.55-.31-1.02-.58-1.48l1.34-1.71c.12-.15.14-.35,0-.49l-1.6-1.6c-.11-.11-.31-.13-.46-.1l-1.87,1.32c-.48-.23-.95-.42-1.48-.59l-.23-2.18C10.23.12,10.06,0,9.93,0h-2.22C7.58,0,7.42.12,7.4.25l-.23,2.18c-.53.17-1,.36-1.48.59l-1.87-1.32c-.15-.03-.35,0-.46.1l-1.6,1.6c-.14.14-.12.35,0,.49l1.34,1.71c-.27.46-.45.93-.58,1.48l-2.1.22c-.13.01-.41.15-.42.31v2.41c0,.13.11.3.24.31l2.18.23c.17.52.35.98.59,1.48l-1.38,1.78c-.14.18.05.45.17.57l1.52,1.52c.11.11.3.12.43.04l1.76-1.38c.47.28.95.44,1.48.59l.22,2.16c0,.15.12.29.28.29h1.29s1.29,0,1.29,0c.16,0,.29-.13.28-.29l.22-2.16c.54-.15,1.02-.3,1.48-.59l1.76,1.38c.13.08.32.08.43-.04l1.52-1.52c.12-.12.31-.39.17-.57l-1.38-1.78c.24-.5.43-.96.59-1.48l2.18-.23c.13-.01.25-.18.25-.31v-2.41ZM7.92,11.67c-1.56-.44-2.53-1.83-2.37-3.23.22-1.4,1.52-2.48,3.14-2.49,1.81-.02,3.38,1.3,3.43,2.99,0,.13-.02.26-.03.38-.02.13-.03.25-.07.38-.5,1.62-2.36,2.47-4.1,1.98Z" />
    </Svg>
  ),
  PhotoCam: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (15.67/18.58)} viewBox="0 0 18.58 15.67" fill={color}>
      <Path d="M17.11,2.19h-2.91v-1.15C14.2.47,13.73,0,13.16,0H5.1C4.53,0,4.07.47,4.07,1.04v1.15H1.47C.66,2.19,0,2.85,0,3.66v10.54C0,15.01.66,15.67,1.47,15.67h15.64c.81,0,1.47-.66,1.47-1.47V3.66c0-.81-.66-1.47-1.47-1.47ZM4.06,5.65c-.32-.31-.36-.81-.08-1.12.02-.02.05-.04.07-.06.03-.02.05-.04.08-.05.37-.2.84-.02,1.06.37.19.35.12.76-.15.98-.28.21-.7.17-.98-.11ZM11.07,12.71c-1.89,1.05-4.12.66-5.3-.82-1.12-1.53-.9-3.78.61-5.33,1.69-1.73,4.42-1.97,6.07-.42.13.12.23.26.33.39.1.14.21.27.29.42,1.06,2,.1,4.57-2.01,5.75Z" />
    </Svg>
  ),
  Photos: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size} viewBox="0 0 17.61 17.61" fill={color}>
      <Path d="M16.21,0H1.4C.62,0,0,.62,0,1.4v14.82c0,.77.62,1.4,1.4,1.4h14.82c.77,0,1.4-.62,1.4-1.4V1.4c0-.77-.62-1.4-1.4-1.4ZM15.75,11.73c0,.77-.62,1.4-1.4,1.4h-1.01c-.43-2.28-2.29-4-4.53-4s-4.11,1.72-4.53,4h-1.01c-.77,0-1.4-.62-1.4-1.4V3.28c0-.77.62-1.4,1.4-1.4h11.09c.77,0,1.4.62,1.4,1.4v8.45Z" />
      <Path d="M8.8,2.52c-1.44,0-2.61,1.26-2.61,2.82s1.17,2.82,2.61,2.82,2.61-1.26,2.61-2.82-1.17-2.82-2.61-2.82Z" />
    </Svg>
  ),
  Calendar: ({ size = 22, color = '#7B2FFF' }) => (
    <Svg width={size} height={size * (17.61/18.58)} viewBox="0 0 18.58 17.61" fill={color}>
      <Path d="M17.11,2.19h-2.91v-1.15c0-.57-.47-1.04-1.04-1.04h0c-.57,0-1.04.47-1.04,1.04v1.15h-5.98v-1.15c0-.57-.47-1.04-1.04-1.04s-1.04.47-1.04,1.04v1.15H1.47c-.81,0-1.47.66-1.47,1.47v12.48c0,.81.66,1.47,1.47,1.47h15.64c.81,0,1.47-.66,1.47-1.47V3.66c0-.81-.66-1.47-1.47-1.47ZM16.52,13.77c0,.8-.65,1.44-1.44,1.44H3.5c-.8,0-1.44-.65-1.44-1.44v-6.07c0-.8.65-1.44,1.44-1.44h11.57c.8,0,1.44.65,1.44,1.44v6.07Z" />
      <Path d="M14.2,8.47H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,11.74H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
    </Svg>
  ),
  Logo: ({ width = 80, color = '#5313B7' }) => (
    <Svg width={width} height={width * (66.36/127.33)} viewBox="0 0 127.33 66.36" fill={color}>
      <Path d="M80.01,20.33c-9.07,1.29-11.83-10.42-3.21-13.19,9.56-2.16,14.01,11.8,3.21,13.19Z" />
      <Path d="M103.25,65.19c-9.47-.6-9.54-35.03-10.66-43.66-.66-5.07-1.51-11.09.7-15.8,2.11-4.28,5.82-2.22,7.54,1.11,4.05,8.13,3.56,16.1,5.36,25.37,1.01,7.78,6.52,33.58-2.95,32.98Z" />
      <Path d="M112.92,37.52c-.69-7.04-1.66-13.5-2.64-20.04-.65-4.7-1.19-10.78.89-14.94,2.14-4.13,5.55-2.82,7.58,1.13,3.45,7.32,4.39,16.8,5.58,24.99.93,7.63,1.92,16.11,2.58,22.84.33,4.05,1.91,15.3-4.43,14.86s-8.49-21.49-9.57-28.83Z" />
      <Path d="M81.5,63.99c-9.82-.59-8.03-40.1-1.97-38.95,7.97,1.52,15.08,39.74,1.97,38.95Z" />
      <Path d="M2.68,9.21c9.2,1.81,11.16,28.79,20.62,31.64s1.71-26.61,13.11-24.42,9.84,27.02,18.65,27.02.09-22.85,9.46-21.01c5.56,1.1,5.97,40.86-4.93,40.1s-11.66-21.66-20.46-20.49-3.22,18.82-14.62,18.02S-7.36,7.24,2.68,9.21Z" />
    </Svg>
  ),
  // Engrenage (pill organisation - côté gauche)
  GearOrg: ({ size = 20, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (15.42/15.46)} viewBox="0 0 15.46 15.42" fill={color}>
      <Path d="M15.45,6.68c0-.14-.25-.26-.36-.27l-1.84-.19c-.12-.48-.27-.89-.51-1.3l1.18-1.5c.1-.13.12-.31,0-.43l-1.4-1.4c-.09-.09-.27-.11-.4-.09l-1.63,1.16c-.42-.2-.83-.37-1.3-.52l-.2-1.91c-.01-.11-.16-.22-.27-.22h-1.94c-.11,0-.26.11-.27.22l-.2,1.91c-.47.15-.88.32-1.3.52l-1.63-1.16c-.13-.02-.3,0-.4.09l-1.4,1.4c-.12.12-.11.3,0,.43l1.18,1.5c-.24.4-.39.82-.51,1.3l-1.84.19c-.12.01-.36.13-.36.27v2.11c0,.11.1.26.21.27l1.91.2c.15.46.31.86.52,1.29l-1.21,1.56c-.12.16.04.39.15.5l1.33,1.33c.1.1.27.1.38.03l1.55-1.21c.41.25.83.39,1.3.51l.2,1.89c0,.13.1.25.25.25h1.13s1.13,0,1.13,0c.14,0,.25-.12.25-.25l.2-1.89c.47-.13.89-.26,1.3-.51l1.55,1.21c.11.07.28.07.38-.03l1.33-1.33c.11-.11.27-.34.15-.5l-1.21-1.56c.21-.44.37-.84.52-1.29l1.91-.2c.11-.01.22-.16.22-.27v-2.11ZM6.94,10.22c-1.36-.39-2.22-1.6-2.08-2.83.19-1.22,1.33-2.17,2.75-2.18,1.58-.02,2.96,1.14,3.01,2.62,0,.12-.01.22-.03.34-.02.11-.03.22-.06.33-.44,1.42-2.07,2.16-3.59,1.73Z" />
    </Svg>
  ),
  // Caméra (pill organisation - côté droit, photographe)
  CamOrg: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (15.42/18.29)} viewBox="0 0 18.29 15.42" fill={color}>
      <Path d="M16.84,2.15h-2.86v-1.13c0-.56-.46-1.02-1.02-1.02h-7.93c-.56,0-1.02.46-1.02,1.02v1.13H1.45c-.8,0-1.45.65-1.45,1.45v10.37c0,.8.65,1.45,1.45,1.45h15.39c.8,0,1.45-.65,1.45-1.45V3.6c0-.8-.65-1.45-1.45-1.45ZM4,5.56c-.31-.31-.36-.8-.08-1.1.02-.02.05-.04.07-.06.02-.02.05-.04.08-.05.36-.19.83-.02,1.04.36.19.34.12.75-.15.96-.28.2-.69.16-.97-.11ZM10.89,12.51c-1.86,1.04-4.06.65-5.21-.8-1.1-1.5-.89-3.72.6-5.24,1.67-1.7,4.35-1.94,5.98-.41.13.12.22.25.33.39.1.14.2.26.28.42,1.04,1.97.1,4.5-1.98,5.66Z" />
    </Svg>
  ),
  // Liste (Mes events - bottom nav)
  ListEvents: ({ size = 22, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (15.42/18.58)} viewBox="0 0 18.58 15.42" fill={color}>
      <Path d="M17.11,0H1.47C.66,0,0,.66,0,1.47v12.48c0,.81.66,1.47,1.47,1.47h15.64c.81,0,1.47-.66,1.47-1.47V1.47c0-.81-.66-1.47-1.47-1.47ZM16.52,11.81c0,.8-.65,1.44-1.44,1.44H3.5c-.8,0-1.44-.65-1.44-1.44V3.61c0-.8.65-1.44,1.44-1.44h11.58c.8,0,1.44.65,1.44,1.44v8.19Z" />
      <Path d="M14.2,7.03H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,3.88H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,10.19H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
    </Svg>
  ),
  // Œil ouvert : affiche le mot de passe
  Eye: ({ size = 20, color = '#9CA3AF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
    </Svg>
  ),
  // Œil barré : masque le mot de passe
  EyeOff: ({ size = 20, color = '#9CA3AF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 2l20 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
};

// Champ mot de passe avec icône œil pour afficher/masquer
function PasswordInput({ value, onChangeText, placeholder, style, autoFocus, autoCapitalize = 'none', placeholderTextColor }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ position: 'relative', justifyContent: 'center' }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        secureTextEntry={!visible}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        style={[style, { paddingRight: 44 }]}
      />
      <TouchableOpacity
        onPress={() => setVisible(v => !v)}
        hitSlop={10}
        style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}
      >
        {visible ? <Icon.EyeOff size={20} color="#9CA3AF" /> : <Icon.Eye size={20} color="#9CA3AF" />}
      </TouchableOpacity>
    </View>
  );
}

// ---------- LOADING / PULL-TO-REFRESH ----------
const LoadingIcon = ({ size = 26, color = '#c9beed' }) => (
  <Svg width={size} height={size} viewBox="0 0 57.49 57.49">
    <Path
      fill={color}
      d="M51.14,31.27c.13-.05.26-.1.39-.16,4.9-2.25,7.25-7.59,5.25-11.93-1.72-3.74-6.1-5.5-10.41-4.49.05-.13.11-.25.16-.39,1.87-5.05-.25-10.49-4.73-12.15-3.86-1.43-8.21.42-10.53,4.19-.05-.13-.1-.26-.16-.39C28.86,1.07,23.52-1.28,19.18.71c-3.74,1.72-5.5,6.1-4.49,10.41-.13-.05-.25-.11-.39-.16-5.05-1.87-10.49.25-12.15,4.73-1.43,3.86.42,8.21,4.19,10.53-.13.05-.26.1-.39.16-4.9,2.25-7.25,7.59-5.25,11.93,1.72,3.74,6.1,5.5,10.41,4.49-.05.13-.11.25-.16.39-1.87,5.05.25,10.49,4.73,12.15,3.86,1.43,8.21-.42,10.53-4.19.05.13.1.26.16.39,2.25,4.9,7.59,7.25,11.93,5.25,3.74-1.72,5.5-6.1,4.49-10.41.13.05.25.11.39.16,5.05,1.87,10.49-.25,12.15-4.73,1.43-3.86-.42-8.21-4.19-10.53ZM36.36,39.02c-5.03,3.73-12.52,2.15-16.72-3.53-4.2-5.68-3.53-13.3,1.5-17.02s12.52-2.15,16.72,3.53c4.2,5.68,3.53,13.3-1.5,17.02Z"
    />
  </Svg>
);

const SpinningLoader = ({ size = 24, color = '#c9beed' }) => {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [rotation]);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <LoadingIcon size={size} color={color} />
    </Animated.View>
  );
};

const PULL_THRESHOLD = 70;

const RefreshableScrollView = React.forwardRef(({ onRefresh, hideTopRefresh, children, ...props }, ref) => {
  const [refreshing, setRefreshing] = useState(false);
  const scrollPosRef = useRef(0);
  const refreshingRef = useRef(false);
  const rotation = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  useEffect(() => {
    if (refreshing) {
      Animated.spring(translateYAnim, {
        toValue: 40, useNativeDriver: true, tension: 90, friction: 12,
      }).start();
      Animated.timing(opacityAnim, {
        toValue: 1, duration: 120, useNativeDriver: true,
      }).start();
      rotation.setValue(0);
      const anim = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
        })
      );
      anim.start();
      return () => anim.stop();
    }
    Animated.timing(opacityAnim, {
      toValue: 0, duration: 320, useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) translateYAnim.setValue(15);
    });
  }, [refreshing, rotation, opacityAnim, translateYAnim]);

  const onScroll = (e) => {
    scrollPosRef.current = e.nativeEvent.contentOffset.y;
  };

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.resolve(onRefresh?.());
    } finally {
      setRefreshing(false);
    }
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY(8)
    .runOnJS(true)
    .onUpdate((e) => {
      if (scrollPosRef.current <= 0 && !refreshingRef.current && e.translationY > 0) {
        const dist = Math.min(e.translationY * 0.55, 140);
        const progress = Math.min(1, dist / PULL_THRESHOLD);
        translateYAnim.setValue(Math.max(15, dist * 0.5));
        rotation.setValue(progress);
        opacityAnim.setValue(progress);
      }
    })
    .onEnd((e) => {
      if (refreshingRef.current) return;
      if (e.translationY * 0.55 >= PULL_THRESHOLD && scrollPosRef.current <= 0) {
        triggerRefresh();
      } else {
        Animated.parallel([
          Animated.timing(translateYAnim, { toValue: 15, duration: 220, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(rotation, { toValue: 0, duration: 220, useNativeDriver: true }),
        ]).start();
      }
    });

  const composed = Gesture.Simultaneous(panGesture, Gesture.Native());

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ flex: 1 }}>
      {!hideTopRefresh && (
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          alignItems: 'center', zIndex: 1000,
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        }}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <LoadingIcon size={26} color="#c9beed" />
          </Animated.View>
        </Animated.View>
      )}
      <GestureDetector gesture={composed}>
        <ScrollView
          ref={ref}
          {...props}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
      </GestureDetector>
    </View>
  );
});

// ErrorBoundary générique pour les écrans à liste (galerie photos perso /
// orga / event). Évite qu'une URL malformée ou un render thrown dans une
// cellule fasse planter tout l'écran. Affiche un fallback avec retry.
class GridErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.warn('GridErrorBoundary caught:', error?.message || error, info?.componentStack);
  }
  reset = () => this.setState({ hasError: false, error: null });
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ color: '#1a1a1a', fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
            Impossible d'afficher cette page
          </Text>
          <Text style={{ color: '#888', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
            {this.state.error?.message || 'Erreur de rendu inattendue.'}
          </Text>
          <TouchableOpacity onPress={this.reset} style={{ backgroundColor: '#7B2FFF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ---------- HELPERS ----------
// Format date uppercase pour le bandeau (mono-jour) ou la plage (multi-jours).
// Synchronisé avec dashboard/EventCard.js → formatDateMobile et la page
// publique /event/<code> sur will-app.com. Toute modification ici doit être
// répercutée sur les deux autres surfaces.
const MONTHS_FULL = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
const MONTHS_SHORT = ['JANV','FÉVR','MARS','AVR','MAI','JUIN','JUIL','AOÛT','SEPT','OCT','NOV','DÉC'];
const formatDateLong = (iso, isoEnd) => {
  if (!iso) return 'DATE À VENIR';
  const ds = new Date(iso);
  if (isNaN(ds.getTime())) return 'DATE À VENIR';
  const single = (d) => `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  if (!isoEnd || isoEnd === iso) return single(ds);
  const de = new Date(isoEnd);
  if (isNaN(de.getTime())) return single(ds);
  const sameYear = ds.getFullYear() === de.getFullYear();
  const sameMonth = sameYear && ds.getMonth() === de.getMonth();
  if (sameMonth) {
    return `DU ${ds.getDate()} AU ${de.getDate()} ${MONTHS_SHORT[de.getMonth()]} ${de.getFullYear()}`;
  }
  if (sameYear) {
    return `DU ${ds.getDate()} ${MONTHS_SHORT[ds.getMonth()]} AU ${de.getDate()} ${MONTHS_SHORT[de.getMonth()]} ${de.getFullYear()}`;
  }
  return `DU ${ds.getDate()} ${MONTHS_SHORT[ds.getMonth()]} ${ds.getFullYear()} AU ${de.getDate()} ${MONTHS_SHORT[de.getMonth()]} ${de.getFullYear()}`;
};

// Variante du format pour le champ "Date(s)" du formulaire de création d'event.
// Sur 1 jour on préfixe par le jour de la semaine court ("VEN. 15 MAI 2026")
// pour aider l'orga à confirmer visuellement le bon jour ; sur une plage on
// retombe sur formatDateLong (déjà explicite avec "DU ... AU ...").
const formatDateForForm = (iso, isoEnd) => {
  if (!iso) return '';
  const start = new Date(iso); start.setHours(0, 0, 0, 0);
  if (isNaN(start.getTime())) return '';
  if (!isoEnd || isoEnd === iso) {
    const wd = start.toLocaleDateString('fr-FR', { weekday: 'short' }).replace(/\./g, '').toUpperCase();
    return `${wd}. ${formatDateLong(iso, null)}`;
  }
  return formatDateLong(iso, isoEnd);
};

// Event "à venir / en cours" si la date de fin (ou la date de début si pas
// d'end) n'est pas passée. Couvre les events multi-jours : tant que end >= today,
// l'event reste dans la liste "À venir".
const isUpcoming = (iso, isoEnd) => {
  const ref = isoEnd || iso;
  if (!ref) return true;
  const d = new Date(ref);
  if (isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now() - 86400000;
};

// Extrait le burstTs (timestamp unix ms) depuis le filename d'une photo
// Format: {event}/{photographer}/{date}/{time}_{burstTs}_{idx}.jpg
const extractBurstTs = (key) => {
  if (!key) return 0;
  const filename = key.split('/').pop().replace(/\.(jpg|jpeg|png|heic|dng)$/i, '');
  const parts = filename.split('_');
  if (parts.length < 3) return 0;
  const ts = parseInt(parts[parts.length - 2], 10);
  return isNaN(ts) ? 0 : ts;
};

// Index dans le burst (0..N). Cle de tri secondaire au sein d'une rafale
// (idx DESC -> derniere photo prise en tete de groupe, coherent avec le
// tri principal "newest first" entre rafales).
const extractIdx = (key) => {
  if (!key) return 0;
  const filename = key.split('/').pop().replace(/\.(jpg|jpeg|png|heic|dng)$/i, '');
  const parts = filename.split('_');
  if (parts.length < 3) return 0;
  const idx = parseInt(parts[parts.length - 1], 10);
  return isNaN(idx) ? 0 : idx;
};

const cityLabel = (location) => {
  if (!location) return '';
  // "Louviers (27400)" → "Louviers (27)"
  return String(location).replace(/\((\d{2})\d{3}\)/, '($1)');
};

// Détecte l'extension d'une photo depuis l'URL (puis HEAD si absent).
// MediaLibrary.saveToLibraryAsync exige un fichier local nommé avec une
// extension valide, sinon échoue avec "Could not get the file's extension".
async function detectPhotoExtension(url) {
  const fromUrl = String(url || '').match(/\.(jpe?g|png|heic|heif|dng|webp)(\?|#|$)/i);
  if (fromUrl) {
    const e = fromUrl[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('heic') || ct.includes('heif')) return 'heic';
    if (ct.includes('png')) return 'png';
    if (ct.includes('x-adobe-dng') || ct.includes('dng')) return 'dng';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  } catch {}
  return 'jpg';
}

// ---------- API ----------
const api = {
  async getEvents() {
    const r = await fetch(`${API_URL}/public-events`);
    return r.ok ? r.json() : [];
  },
  async login(code, password, role, photographer_name) {
    const r = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, role, photographer_name }),
    });
    if (r.ok) return r.json();
    // Non-OK : on remonte status + error pour distinguer 429 (rate limit)
    // de 401 (PIN incorrect). Le caller affiche le message adapte.
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },

  // RGPD biométrie — Suivre un event = geste de consentement explicite.
  // 400 'selfie_required' si pas de selfie deposé → l'UI ouvre SelfieModal puis relance.
  async follow(eventCode, token) {
    const r = await fetch(`${API_URL}/runner/follow/${encodeURIComponent(eventCode)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ consent: true }),
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  async unfollow(eventCode, token) {
    const r = await fetch(`${API_URL}/runner/follow/${encodeURIComponent(eventCode)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  // Wipe biometrique chirurgical : supprime selfie + empreintes sans toucher au compte.
  async deleteFaceData(token) {
    const r = await fetch(`${API_URL}/runner/face-data`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) return r.json();
    let error = '';
    try { error = (await r.json())?.error || ''; } catch {}
    return { status: r.status, error };
  },
  // E2 — enregistre le token Expo push cote worker.
  async registerPushToken(runnerToken, expoToken, platform) {
    try {
      const r = await fetch(`${API_URL}/runner/push-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runnerToken}` },
        body: JSON.stringify({ token: expoToken, platform }),
      });
      return r.ok;
    } catch { return false; }
  },
  async deletePushToken(runnerToken) {
    try {
      await fetch(`${API_URL}/runner/push-token`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${runnerToken}` },
      });
    } catch {}
  },
};

// E2 — wrapper unique pour (a) silent re-register au boot si deja autorise,
// (b) ask + register apres premier follow. Idempotent : iOS ne re-affiche
// pas le prompt une fois denied (Notifications.requestPermissionsAsync
// retourne la decision existante).
async function ensurePushRegistered(runnerToken, { ask = false } = {}) {
  if (!Device.isDevice) return; // simulator -> rien a faire
  if (!runnerToken) return;
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    if (!ask) return; // boot silencieux : on n'embete pas le user
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
    if (status !== 'granted') return;
  }
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId
    || Constants?.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] projectId introuvable dans expo.extra.eas');
    return;
  }
  try {
    const tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoToken = tokenObj?.data;
    if (!expoToken) return;
    await api.registerPushToken(runnerToken, expoToken, Platform.OS);
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync', e?.message || e);
  }
}

// ---------- SCREENS ----------

function SelfieBlock({ selfieUri, onPress, onDelete, missing = false }) {
  if (selfieUri) {
    return (
      <View style={s.selfieDoneBanner}>
        <ExpoImage
          source={{ uri: selfieUri }}
          style={{ width: 44, height: 44, borderRadius: 999 }}
          contentFit="cover"
        />
        <View style={{ flex: 1 }}>
          <Text style={s.selfieDoneTitle}>Selfie enregistré</Text>
          <Text style={s.selfieDoneSub}>Will t'envoie tes photos automatiquement</Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={10} style={s.selfieDelete}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M6 6l12 12M18 6l-12 12" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    );
  }
  // Etat renforce "selfie manquant" : encadre orange + CTA explicite. Active
  // quand le coureur a explicitement skippe l'etape 2 du signup wizard.
  if (missing) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        <LinearGradient
          colors={['#8B3FFF', '#5A1FCC']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.selfieCard, { borderWidth: 2, borderColor: '#F59E0B', flexDirection: 'column', alignItems: 'stretch' }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[s.selfieAvatar, { width: 56, height: 56, borderRadius: 14 }]}>
              <Icon.User size={32} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFD89B', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
                Selfie manquant
              </Text>
              <Text style={[s.selfieSub, { marginTop: 0, fontSize: 13, lineHeight: 17 }]}>
                Prends ton selfie pour récupérer tes photos
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 12, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: C.primary, fontWeight: '700', fontSize: 14 }}>Faire mon selfie maintenant</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <LinearGradient colors={['#8B3FFF', '#5A1FCC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.selfieCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.selfieTitle}>Un selfie suffit</Text>
          <Text style={s.selfieSub}>Pour recevoir tes photos{'\n'}de tous les événements Will</Text>
        </View>
        <View style={s.selfieAvatar}>
          <Icon.User size={40} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, follows, onToggleFollow, onRefresh, runnerFirstName, selfieSkipped = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const tabFiltered = events.filter(e => {
    if (tab === 'upcoming') return isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'past') return !isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'follows') return follows.includes(e.code);
    return true;
  });
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? tabFiltered.filter(e => (e.name || '').toLowerCase().includes(q))
    : tabFiltered;
  const scrollRef = useRef(null);

  // Quand le clavier se ferme : remonter le scroll en haut
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  return (
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      {/* Header : avatar + "Bienvenue sur Will" + pills orga/photographe */}
      <View style={s.headerRow}>
        <View style={[s.headerLeft, { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }]}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: '#10B981',
                borderWidth: 2,
                borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
            {runnerFirstName ? (
              <Text style={[s.welcome, { color: '#c9beed', fontSize: 17 }]} numberOfLines={1}>
                Hello {runnerFirstName}
              </Text>
            ) : (
              <>
                <Text style={[s.welcome, { color: '#c9beed', fontSize: 17 }]} numberOfLines={1}>Bienvenue sur </Text>
                <Icon.Logo width={36} color="#c9beed" />
              </>
            )}
          </View>
        </View>
        <View style={s.orgToggle}>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole('organizer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.GearOrg size={22} color={C.pinkPill} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole('photographer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.CamOrg size={24} color={C.pinkPill} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Carte selfie : uniquement si pas encore pris.
          Marge verticale 14px alignee sur le bouton "+ Creer un evenement"
          de la page Mes events (meme position Y sous le header pour les deux
          CTA de premiere page). */}
      {!selfieUri && (
        <>
          <View style={{ height: 14 }} />
          <SelfieBlock selfieUri={null} onPress={onOpenSelfie} onDelete={onDeleteSelfie} missing={selfieSkipped} />
        </>
      )}

      {/* Champ recherche : filtre la liste juste en dessous */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#E5E0FF',
        paddingHorizontal: 16,
        paddingVertical: 4,
        marginBottom: 8,
      }}>
        <Icon.Search size={18} color={C.primary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un événement..."
          placeholderTextColor={C.textSoft}
          style={{ flex: 1, marginLeft: 10, fontSize: 14, color: C.text, paddingVertical: 8 }}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10} style={{ paddingHorizontal: 6 }}>
            <Text style={{ color: C.textSoft, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs row : À venir / Passés / Favoris (pleine largeur) */}
      <View style={{
        flexDirection: 'row',
        backgroundColor: C.pillBg,
        borderRadius: 16,
        padding: 4,
        marginBottom: 8,
      }}>
        <TouchableOpacity onPress={() => setTab('upcoming')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'upcoming' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>À venir</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('past')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'past' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>Passés</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('follows')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'follows' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'follows' && s.pillTextActive]}>Suivis</Text>
        </TouchableOpacity>
      </View>

      {/* Events list / état vide */}
      {filtered.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <View style={{ marginBottom: 12, opacity: 0.4 }}>
            <Icon.Calendar size={36} color={C.textSoft} />
          </View>
          <Text style={{ color: C.textSoft, fontSize: 14 }}>
            {tab === 'follows' ? 'Aucun event suivi' : tab === 'upcoming' ? 'Aucun événement à venir' : 'Aucun événement passé'}
          </Text>
        </View>
      ) : (
        filtered.map((event) => (
          <EventCard
            key={event.code}
            event={event}
            onPress={() => onOpenEvent(event)}
            isFollowing={follows.includes(event.code)}
            onToggleFollow={() => onToggleFollow(event.code)}
            style={{ marginBottom: 8 }}
          />
        ))
      )}
    </RefreshableScrollView>
  );
}

function EventCard({ event, onPress, isFollowing, onToggleFollow, style }) {
  const tint = colorForType(event.event_type);

  return (
    <View style={[s.eventCard, style]}>
      {/* Layer 0 : aplat coloré solide pleine carte. Sert de fallback total
          quand pas de cover, et de fond sous l'image (techniquement caché par
          l'image dans ce cas, mais protège contre tout artefact d'aliasing). */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
      {/* Layer 1 : cover image pleine carte. Le gradient au-dessus la masque
          totalement à gauche et la révèle progressivement à droite. */}
      {event.cover_image ? (
        <ExpoImage
          source={{ uri: event.cover_image }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : null}
      {/* Layer 2 : gradient coloré pleine largeur. locations=[0.5, 1] →
          - 0% à 50% : tint 100% opaque (aplat pur, image complètement masquée)
          - 50% à 100% : tint passe de 100% à 10% (image émerge progressivement)
          tint+'1A' = #RRGGBB1A = 10% opacité (alpha 0x1A = 26/255). */}
      {event.cover_image ? (
        <LinearGradient
          colors={[tint, tint + '1A']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0.5, 1]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
      ) : null}
      {/* Zone tactile principale (ouvre l'événement) */}
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={StyleSheet.absoluteFillObject} />
      {/* Texte par-dessus la zone tactile (pointerEvents none pour que le tap passe au TouchableOpacity en dessous) */}
      <View style={s.eventCardCenter} pointerEvents="none">
        <Text style={s.eventDate}>{formatDateLong(event.event_date, event.event_date_end)}</Text>
        <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
        <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
      </View>
      {/* Pastille type de course (bas droite) */}
      {event.event_type ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            backgroundColor: '#fff',
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            zIndex: 3,
          }}
        >
          <Text style={{ color: tint, fontSize: 10, fontWeight: '700' }}>
            {displayEventType(event.event_type)}
          </Text>
        </View>
      ) : null}
      {/* Bouton Suivre (geste de consentement biometrique RGPD).
          Etoile pleine si suivi, contour si non-suivi. */}
      {onToggleFollow && (
        <TouchableOpacity
          onPress={onToggleFollow}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61" fill={isFollowing ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
            <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
          </Svg>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Illustration selfie pour l'onboarding (visage stylise + FaceID).
// Source: assets/Selfie.svg, inline pour eviter un require asset transform.
const SELFIE_ILLUSTRATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17.61 17.61">
  <path fill="#7B2FFF" d="M1.86,3.28c0-.77.62-1.4,1.4-1.4h4.12V0H1.4C.62,0,0,.62,0,1.4v5.98h1.86V3.28Z"/>
  <path fill="#7B2FFF" d="M16.21,0h-5.98v1.88h4.12c.77,0,1.4.62,1.4,1.4v4.1h1.86V1.4C17.61.62,16.98,0,16.21,0Z"/>
  <path fill="#7B2FFF" d="M15.75,13.64c0,.54-.31,1.01-.76,1.24-.23-1.89-2.9-3.38-6.18-3.38s-5.95,1.49-6.18,3.38c-.45-.23-.76-.7-.76-1.24v-3.41H0v5.98C0,16.98.62,17.61,1.4,17.61h2.84s0,0,0,0h9.12s0,0,0,0h2.84c.77,0,1.4-.62,1.4-1.4v-5.98h-1.86v3.41Z"/>
  <path fill="#7B2FFF" d="M5.73,6.82c0,1.87,1.38,3.38,3.08,3.38s3.08-1.51,3.08-3.38-1.38-3.38-3.08-3.38-3.08,1.51-3.08,3.38Z"/>
</svg>`;
function SelfieIllustration({ size = 128 }) {
  return <SvgXml xml={SELFIE_ILLUSTRATION_XML} width={size} height={size} />;
}

// Ecran "Photos" quand le coureur n'est pas connecte. Explique la valeur
// (un selfie suffit) avant de proposer l'inscription. Les CTA pointent vers
// AuthRunnerModal en mode register ou login selon le bouton.
function PhotosUnauthScreen({ onSignup, onLogin }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <SelfieIllustration size={128} />
        </View>
        <Text
          style={{
            fontSize: 30,
            fontWeight: '700',
            color: '#1A1A1A',
            textAlign: 'center',
            letterSpacing: -0.6,
            marginBottom: 16,
            fontFamily: 'AVEstiana',
          }}
        >
          Toutes tes photos{'\n'}en un selfie
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: '400',
            color: '#71717A',
            textAlign: 'center',
            lineHeight: 24,
            marginBottom: 48,
          }}
        >
          Crée ton compte, prends un selfie, et retrouve toutes tes photos sur tous les events Will.
        </Text>
        <TouchableOpacity
          onPress={onSignup}
          activeOpacity={0.85}
          style={{
            backgroundColor: C.primary,
            paddingVertical: 16,
            borderRadius: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>Créer mon compte</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogin} style={{ marginTop: 16, alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ color: C.primary, fontSize: 15, fontWeight: '500' }}>
            J'ai déjà un compte, me connecter
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function PhotosScreen({ events = [], onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, follows, onFindEvent, runnerToken, onOpenPhoto, photoFavoritesSet, onTogglePhotoFavorite, selfieSkipped = false, isActive = true }) {
  const hasFollows = follows && follows.length > 0;
  // Photos agregees sur tous les follows + flag global "any event still searching"
  // pour decider d afficher le spinner / le sous-titre "recherche...".
  const [photos, setPhotos] = useState([]);
  const [anySearching, setAnySearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Pagination progressive cote client (eviter de monter 500 cellules d un coup
  // au premier render quand un coureur cumule plusieurs events).
  const [visibleCount, setVisibleCount] = useState(30);

  // E4 — marqueur "derniere photo vue" par burstTs (max global tous events).
  // Sert au pull-to-refresh pour afficher "X nouvelles photos" / "Rien de
  // nouveau". Persiste dans AsyncStorage. Cote client uniquement pour V1.
  const lastSeenRef = useRef(0);
  const lastSeenLoadedRef = useRef(false);
  const baselineSetRef = useRef(false);
  const [refreshToast, setRefreshToast] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('@will_last_seen_burst_ts').then(v => {
      lastSeenRef.current = v ? parseInt(v, 10) : 0;
      lastSeenLoadedRef.current = true;
    }).catch(() => { lastSeenLoadedRef.current = true; });
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  // tint par event_code (couleur du type d event) pour ourler la thumb.
  const eventTintMap = useMemo(() => {
    const map = {};
    for (const e of events) map[e.code] = colorForType(e.event_type);
    return map;
  }, [events]);

  // Charge /personal-gallery sur tous les follows en parallele, fusionne, trie.
  // anySearching = au moins un event en moins de 90s avec 0 photos -> polling.
  // Retourne le tableau fusionne (utilise par onPullRefresh pour calculer le
  // delta "X nouvelles photos" — E4).
  const refreshAll = useCallback(async () => {
    if (!hasFollows || !runnerToken) {
      setPhotos([]);
      setAnySearching(false);
      setLoading(false);
      return [];
    }
    const started = {};
    for (const code of follows) {
      const s = await AsyncStorage.getItem(`@will_follow_started_${code}`);
      started[code] = s ? parseInt(s, 10) : 0;
    }
    const results = await Promise.all(follows.map(async (code) => {
      try {
        const r = await fetch(`${API_URL}/personal-gallery/${encodeURIComponent(code)}`, {
          headers: { Authorization: `Bearer ${runnerToken}` },
        });
        if (!r.ok) return { code, photos: [] };
        const data = await r.json();
        return { code, photos: Array.isArray(data.photos) ? data.photos : [] };
      } catch { return { code, photos: [] }; }
    }));
    const now = Date.now();
    const merged = [];
    let searching = false;
    for (const { code, photos: list } of results) {
      const tint = eventTintMap[code] || TYPE_COLORS.autre;
      if (list.length === 0) {
        const startedTs = started[code];
        const elapsed = startedTs ? (now - startedTs) : Infinity;
        if (elapsed < 90000) searching = true;
        continue;
      }
      for (const p of list) {
        merged.push({
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
        });
      }
    }
    merged.sort((a, b) => {
      const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
      if (dt !== 0) return dt;
      return extractIdx(b.id) - extractIdx(a.id);
    });
    setPhotos(merged);
    setAnySearching(searching);
    setLoading(false);
    setVisibleCount(30);
    return merged;
  }, [follows, hasFollows, runnerToken, eventTintMap]);

  // E4 — baseline last_seen au premier load reussi : on aligne le marqueur
  // sur le max actuel pour que le 1er pull-to-refresh apres cold start
  // affiche "Rien de nouveau" si rien n a bouge (sinon le coureur aurait
  // un faux positif "N nouvelles" alors qu il vient de tout voir s afficher).
  useEffect(() => {
    if (baselineSetRef.current || !lastSeenLoadedRef.current || loading) return;
    if (photos.length === 0) return;
    baselineSetRef.current = true;
    let maxTs = 0;
    for (const p of photos) {
      const ts = extractBurstTs(p.id);
      if (ts > maxTs) maxTs = ts;
    }
    if (maxTs > lastSeenRef.current) {
      lastSeenRef.current = maxTs;
      AsyncStorage.setItem('@will_last_seen_burst_ts', String(maxTs)).catch(() => {});
    }
  }, [loading, photos]);

  // Initial fetch + re-fetch quand follows change
  useEffect(() => { setLoading(true); refreshAll(); }, [refreshAll]);

  // Polling 7s tant qu au moins un event est en fenetre 90s ET l ecran est focus.
  // Cleanup auto -> pas de drain batterie en background.
  useEffect(() => {
    if (!isActive || !anySearching) return;
    const timer = setInterval(refreshAll, 7000);
    return () => clearInterval(timer);
  }, [isActive, anySearching, refreshAll]);

  // Affichage progressif (eviter freeze sur 500 photos d un coup)
  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const t = setTimeout(() => setVisibleCount(v => Math.min(v + 30, photos.length)), 250);
    return () => clearTimeout(t);
  }, [visibleCount, photos.length]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    const merged = await refreshAll();
    setRefreshing(false);
    // E4 — calcul du delta + toast "X nouvelles photos" / "Rien de nouveau".
    // baselineSetRef garantit qu on a deja seedge lastSeenRef au boot, donc
    // le premier pull dit "Rien de nouveau" si rien n a change depuis cold
    // start (et pas "47 nouvelles" alors que le coureur vient de tout voir).
    if (!lastSeenLoadedRef.current) return;
    const prev = lastSeenRef.current;
    let maxTs = 0, newCount = 0;
    for (const p of merged) {
      const ts = extractBurstTs(p.id);
      if (ts > maxTs) maxTs = ts;
      if (ts > prev) newCount++;
    }
    if (maxTs > prev) {
      lastSeenRef.current = maxTs;
      AsyncStorage.setItem('@will_last_seen_burst_ts', String(maxTs)).catch(() => {});
    }
    const msg = newCount === 0
      ? 'Rien de nouveau pour toi'
      : newCount === 1
        ? 'Bonne nouvelle, 1 nouvelle photo de toi 📸'
        : `Bonne nouvelle, ${newCount} nouvelles photos de toi 📸`;
    setRefreshToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setRefreshToast(null), 3000);
  }, [refreshAll]);

  return (
    <RefreshableScrollView
      hideTopRefresh
      onRefresh={onPullRefresh}
      refreshing={refreshing}
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            hitSlop={10}
            onPress={onOpenProfile}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute', top: 4, right: 4,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: '#10B981', borderWidth: 2, borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
        </View>
        <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes photos</Text>
        <View style={{ width: 40, height: 40 }} />
      </View>

      <View style={{ height: 14 }} />

      {/* E4 — Toast 3s "X nouvelles photos" / "Rien de nouveau pour toi"
          declenche par le pull-to-refresh. */}
      {refreshToast && (
        <View style={{
          backgroundColor: '#5E1AD6',
          borderRadius: 999,
          paddingVertical: 10,
          paddingHorizontal: 16,
          marginBottom: 12,
          alignSelf: 'center',
          shadowColor: '#5E1AD6', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
        }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
            {refreshToast}
          </Text>
        </View>
      )}

      {/* Carte selfie si pas encore depose */}
      {!selfieUri && (
        <SelfieBlock selfieUri={null} onPress={onOpenSelfie} onDelete={onDeleteSelfie} missing={selfieSkipped} />
      )}

      {!hasFollows ? (
        // ETAT VIDE : 3 etapes pedagogiques + CTA "Trouver un event"
        <PhotosEmptyState selfieUri={selfieUri} onFindEvent={onFindEvent} />
      ) : loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <SpinningLoader size={26} color="#c9beed" />
          <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 10 }}>Chargement…</Text>
        </View>
      ) : photos.length === 0 && anySearching ? (
        // Pas encore de photos mais on est dans la fenetre 90s -> spinner explicite.
        <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
          <SpinningLoader size={26} color="#7B2FFF" />
          <Text style={{ color: '#5E1AD6', fontSize: 13, marginTop: 12, textAlign: 'center', fontWeight: '600' }}>
            Will recherche tes photos…
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 17 }}>
            Cela peut prendre quelques secondes après l'upload du photographe.
          </Text>
        </View>
      ) : photos.length === 0 ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Aucune photo pour le moment.{'\n'}Reviens après la course !
          </Text>
        </View>
      ) : (
        <>
          {anySearching && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10,
              backgroundColor: '#F5F3FF', borderRadius: 999, alignSelf: 'flex-start',
            }}>
              <SpinningLoader size={12} color="#7B2FFF" />
              <Text style={{ color: '#5E1AD6', fontSize: 12, fontWeight: '600' }}>
                Will continue de chercher…
              </Text>
            </View>
          )}
          <PhotoGrid
            photos={photos.slice(0, visibleCount)}
            onPress={(p, _i, _photos, origin) => onOpenPhoto?.(p, photos, { origin })}
            photoFavoritesSet={photoFavoritesSet}
            onToggleFavorite={onTogglePhotoFavorite}
          />
        </>
      )}
    </RefreshableScrollView>
  );
}

// État vide pédagogique : 3 étapes + CTA "Trouver un event".
function PhotosEmptyState({ selfieUri, onFindEvent }) {
  return (
    <View style={{ paddingVertical: 24, paddingHorizontal: 16 }}>
      {/* Gros badge violet avec coeur */}
      <View style={{
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: '#7B2FFF',
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'center', marginBottom: 18,
        shadowColor: '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
      }}>
        <Svg width={34} height={30} viewBox="-1 -1.5 22.78 20.61" fill="#fff">
          <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
        </Svg>
      </View>

      <Text style={{
        fontSize: 22, fontWeight: '800', color: '#1A1426',
        textAlign: 'center', letterSpacing: -0.3, marginBottom: 10,
      }}>
        Suis un event pour{'\n'}recevoir tes photos
      </Text>
      <Text style={{
        fontSize: 14, color: '#5A5468', lineHeight: 20,
        textAlign: 'center', marginBottom: 22,
        paddingHorizontal: 12,
      }}>
        Will te reconnaît uniquement sur les events que tu suis. Ajoute-en un, et tes photos arrivent toutes seules.
      </Text>

      {onFindEvent && (
        <TouchableOpacity
          onPress={onFindEvent}
          activeOpacity={0.85}
          style={{
            backgroundColor: '#7B2FFF', borderRadius: 999,
            paddingVertical: 13, paddingHorizontal: 22,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 8,
            alignSelf: 'center', marginBottom: 26,
            shadowColor: '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="11" cy="11" r="8" />
            <Path d="M21 21l-4-4" />
          </Svg>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Trouver un event</Text>
        </TouchableOpacity>
      )}

      {/* 3 étapes pédagogiques */}
      <View style={{ paddingHorizontal: 8 }}>
        <PhotosStepRow num={1} text={selfieUri ? "Ton selfie est déjà enregistré ✓" : "Ajoute ton selfie"} done={!!selfieUri} />
        <PhotosStepRow num={2} text="Tu suis l'event de ta course" />
        <PhotosStepRow num={3} text="Tes photos arrivent automatiquement" />
      </View>
    </View>
  );
}

function PhotosStepRow({ num, text, done = false }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 8,
    }}>
      <View style={{
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: done ? '#10B981' : '#EDE4FF',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {done ? (
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M20 6L9 17l-5-5" />
          </Svg>
        ) : (
          <Text style={{ color: '#7B2FFF', fontSize: 13, fontWeight: '700' }}>{num}</Text>
        )}
      </View>
      <Text style={{ flex: 1, color: '#1A1426', fontSize: 14 }}>{text}</Text>
    </View>
  );
}

// Cellule d'une thumbnail : memo + onError fallback. La taille est passee
// pour pouvoir s'adapter au numColumns du parent.
const PhotoCell = React.memo(function PhotoCell({ photo, size, onPress, showHeart, isFav, onToggleFav }) {
  const [errored, setErrored] = React.useState(false);
  const cellRef = React.useRef(null);
  // size optionnel : si fourni, on fixe la taille (skeletons / autres usages) ;
  // sinon flex: 1 + aspectRatio: 1 pour remplir la rangee FlatList et garder le carre.
  const sizeStyle = size ? { width: size, height: size } : { flex: 1, aspectRatio: 1 };
  // Wrapping ref + measureInWindow pour shared-element : le caller recoit
  // { x, y, w, h } de la thumb tapee et anime la photo viewer depuis cette
  // position vers le plein ecran.
  const handlePress = () => {
    if (!onPress) return;
    if (cellRef.current?.measureInWindow) {
      cellRef.current.measureInWindow((x, y, w, h) => onPress({ x, y, w, h }));
    } else {
      onPress(null);
    }
  };
  return (
    <TouchableOpacity
      ref={cellRef}
      style={sizeStyle}
      activeOpacity={0.85}
      onPress={handlePress}
    >
      {/* Bg gris affiche pendant le chargement et en cas d'erreur (fallback) */}
      <View style={{ flex: 1, borderRadius: 12, backgroundColor: C.primaryLight, overflow: 'hidden' }}>
        {!errored && (
          <ExpoImage
            source={{ uri: photo.uri }}
            style={{ flex: 1 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="low"
            transition={150}
            recyclingKey={photo.id}
            onError={(e) => {
              console.warn('[gallery] image load failed:', photo.uri, e?.error || e);
              setErrored(true);
            }}
          />
        )}
        {errored && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M3 16l5-5 4 4 3-3 6 6M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" stroke="#9ca3af" strokeWidth={1.5} />
            </Svg>
          </View>
        )}
      </View>
      {showHeart && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onToggleFav?.(); }}
          hitSlop={12}
          style={{ position: 'absolute', top: 6, right: 6 }}
        >
          <Svg width={20} height={18} viewBox="-1 -1.5 22.78 20.61"
            fill={isFav ? '#fff' : 'none'}
            stroke="#fff" strokeWidth={1.6}>
            <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
          </Svg>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
});

// Cellule skeleton (pulse gris) affichee pendant le chargement initial.
function SkeletonCell({ size }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.5, duration: 750, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [op]);
  return (
    <Animated.View style={{
      width: size, height: size,
      borderRadius: 12,
      // Violet leger brand (C.primaryLight) au lieu du gris #E5E7EB
      // -> placeholder coherent avec l identite, page jamais blanche.
      backgroundColor: C.primaryLight,
      opacity: op,
    }} />
  );
}

function PhotoGrid({ photos = [], onPress, photoFavoritesSet, onToggleFavorite }) {
  // Si pas de photos : grille de placeholders
  if (photos.length === 0) {
    return (
      <View style={s.grid}>
        {Array.from({ length: 16 }, (_, i) => (
          <View key={`ph-${i}`} style={s.gridItem}>
            <View style={s.gridPlaceholder} />
          </View>
        ))}
      </View>
    );
  }

  const showHearts = !!onToggleFavorite && !!photoFavoritesSet;

  return (
    <View style={s.grid}>
      {photos.map((p, i) => (
        <PhotoGridItem
          key={p.id || `p-${i}`}
          p={p}
          i={i}
          photos={photos}
          onPress={onPress}
          showHearts={showHearts}
          fav={showHearts && photoFavoritesSet.has(p.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </View>
  );
}

// Sous-composant : chaque thumb a sa propre ref pour permettre
// measureInWindow (shared-element transition viewer). Le caller recoit
// onPress(photo, index, photosList, origin) ou origin = {x,y,w,h} de la
// thumb tapee, ou null si la mesure echoue.
function PhotoGridItem({ p, i, photos, onPress, showHearts, fav, onToggleFavorite }) {
  const itemRef = React.useRef(null);
  const handlePress = () => {
    if (!onPress) return;
    if (itemRef.current?.measureInWindow) {
      itemRef.current.measureInWindow((x, y, w, h) => onPress(p, i, photos, { x, y, w, h }));
    } else {
      onPress(p, i, photos, null);
    }
  };
  return (
    <TouchableOpacity
      ref={itemRef}
      style={s.gridItem}
      activeOpacity={0.85}
      onPress={handlePress}
    >
      <ExpoImage
        source={{ uri: p.uri }}
        style={s.gridImg}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="low"
        transition={100}
        recyclingKey={p.id}
      />
      {showHearts && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onToggleFavorite(p.id); }}
          hitSlop={12}
          style={{ position: 'absolute', top: 6, right: 6 }}
        >
          <Svg width={20} height={18} viewBox="-1 -1.5 22.78 20.61"
            fill={fav ? '#fff' : 'none'}
            stroke="#fff" strokeWidth={1.6}>
            <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
          </Svg>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function EventDetailScreen(props) {
  return (
    <GridErrorBoundary>
      <EventDetailScreenInner {...props} />
    </GridErrorBoundary>
  );
}

function EventDetailScreenInner({ event, onClose, onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, onOpenPhoto, isFollowing, onToggleFollow }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Pagination cote client : on n'affiche que les N premieres photos pour
  // limiter le DOM rendu (au-dela de la virtualisation FlatList).
  // onEndReached -> +30 jusqu'a couvrir filteredPhotos.length.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | composite key
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false); // Phase D3 : confirm "Ne plus suivre"
  const tint = colorForType(event.event_type);
  const upcoming = isUpcoming(event.event_date, event.event_date_end);

  // Compte à rebours multi-jours : "J-3" avant, "GO !" pendant toute la durée
  // (event_date → event_date_end), "J+5" après. End absent → single-day.
  const countdown = (() => {
    if (!event.event_date) return null;
    const start = new Date(event.event_date);
    if (isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    const end = event.event_date_end ? new Date(event.event_date_end) : new Date(event.event_date);
    if (isNaN(end.getTime())) end.setTime(start.getTime());
    end.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (t < start) return `J-${Math.round((start - t) / 86400000)}`;
    if (t <= end) return 'GO !';
    return `J+${Math.round((t - end) / 86400000)}`;
  })();

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/list-public/${event.code}`);
      const data = r.ok ? await r.json() : { photos: [] };
      const list = (data.photos || []).map(p => {
        const parts = (p.key || '').split('/');
        const photographerId = parts.length >= 2 ? parts[1] : null;
        return {
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          // thumbUri : version 400px JPEG (~15-25 KB) servie par /photo-thumb
          // worker avec cache R2. Utilisee pour la grille ; le viewer plein
          // ecran continue d utiliser `uri` (haute resolution).
          thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
          race: p.race,
          km: p.km,
          photographer: photographerId,
        };
      });
      // Tri : burstTs DESC puis idx DESC au sein d'une rafale.
      list.sort((a, b) => {
        const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
        if (dt !== 0) return dt;
        return extractIdx(b.id) - extractIdx(a.id);
      });
      // Limite removed: la virtualisation FlatList tient les milliers de
      // photos sans probleme (~15-30 cellules montees a la fois).
      setPhotos(list);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [event.code, tint]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadPhotos();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, [loadPhotos]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    await loadPhotos();
    setRefreshing(false);
  }, [loadPhotos]);

  // Reset la pagination quand on change de filtre (sinon "30 / 25 photos" possible).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeFilter]);

  // Liste des courses et photographes uniques (depuis les photos reçues)
  const uniqueRaces = Array.from(new Set(photos.map(p => p.race).filter(Boolean)));
  const uniquePhotographers = Array.from(new Set(photos.map(p => p.photographer).filter(Boolean)));
  const photographerIndex = (id) => uniquePhotographers.indexOf(id) + 1; // 1-based

  // Construction des onglets selon le nombre de courses x photographes
  const nRaces = uniqueRaces.length;
  const nPhotographers = uniquePhotographers.length;

  const tabs = (() => {
    if (nRaces <= 1 && nPhotographers <= 1) return []; // pas d'onglets
    if (nRaces <= 1 && nPhotographers > 1) {
      // 1 course / N photographes : "Toutes" + "{km} km｜km{i}"
      const kmLabel = uniqueRaces[0] ? `${uniqueRaces[0]} km` : 'Course';
      return [
        { key: 'all', label: 'Toutes' },
        ...uniquePhotographers.map((ph, i) => ({
          key: `ph:${ph}`,
          label: `${kmLabel}｜km${i + 1}`,
        })),
      ];
    }
    if (nRaces > 1 && nPhotographers <= 1) {
      // N courses / 1 photographe : "{km} km"
      return uniqueRaces.map(km => ({
        key: `race:${km}`,
        label: `${km} km`,
      }));
    }
    // N courses / N photographes : "Toutes" + combinaisons "{km} km｜km{i}"
    const combos = [];
    for (const km of uniqueRaces) {
      for (const ph of uniquePhotographers) {
        combos.push({
          key: `combo:${km}:${ph}`,
          label: `${km} km｜km${photographerIndex(ph)}`,
        });
      }
    }
    return [{ key: 'all', label: 'Toutes' }, ...combos];
  })();

  const filteredPhotos = (() => {
    if (activeFilter === 'all') return photos;
    if (activeFilter.startsWith('race:')) {
      const km = activeFilter.slice(5);
      return photos.filter(p => String(p.race) === String(km));
    }
    if (activeFilter.startsWith('ph:')) {
      const ph = activeFilter.slice(3);
      return photos.filter(p => p.photographer === ph);
    }
    if (activeFilter.startsWith('combo:')) {
      const [, km, ph] = activeFilter.split(':');
      return photos.filter(p => String(p.race) === String(km) && p.photographer === ph);
    }
    return photos;
  })();

  const distances = Array.isArray(event.distances) ? event.distances : [];

  const openWebsite = () => {
    if (!event.website) return;
    const url = event.website.startsWith('http') ? event.website : `https://${event.website}`;
    Linking.openURL(url).catch(() => {});
  };

  // Grille simple 3 colonnes alignees. Padding horizontal symetrique
  // via columnWrapperStyle. Photos via flex: 1 + aspectRatio: 1 pour
  // remplir la rangee sans depasser (s.scroll a deja un paddingHorizontal
  // de 20 que cellSize n'aurait pas pris en compte si on calculait a la main).
  // cellSize n'est utilise que pour les skeletons et tient compte des 20px de s.scroll.
  const NUM_COLS = 3;
  const GRID_PADDING_H = 8;
  const GRID_GAP = 6;
  const SCROLL_PADDING_H = 20; // doit matcher s.scroll.paddingHorizontal
  const cellSize = (SCREEN_W - SCROLL_PADDING_H * 2 - GRID_PADDING_H * 2 - GRID_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  // Header de la FlatList : tout ce qui s'affiche au-dessus de la grille.
  // Renvoie une seule View ; FlatList le rend une fois en haut, sans virtualisation.
  const renderHeader = () => (
    <View>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute', top: -2, right: -2, width: 10, height: 10,
                borderRadius: 5, backgroundColor: '#10B981', borderWidth: 2, borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>

      <View style={{ position: 'relative', marginTop: 12, marginBottom: 8 }}>
        {/* Override le marginBottom: 10 hérité de s.eventCard — l'espacement
            avec le bloc suivant est géré par le wrapper (marginBottom: 8). */}
        <View style={[s.eventCard, { marginBottom: 0 }]}>
          {/* Layer 0 : aplat coloré pleine carte (fallback + fond sous image) */}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
          {/* Layer 1 : cover image pleine carte */}
          {event.cover_image ? (
            <ExpoImage
              source={{ uri: event.cover_image }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
            />
          ) : null}
          {/* Layer 2 : gradient — solide à gauche (0-50%), fade 100→10% à droite (50-100%) */}
          {event.cover_image ? (
            <LinearGradient
              colors={[tint, tint + '1A']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              locations={[0.5, 1]}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          ) : null}
          {/* Stack vertical : Date > Nom (header) > Lieu + type.
              paddingRight réserve l'espace du décompte bottom-right. */}
          <View style={[s.eventCardCenter, { paddingRight: 84 }]}>
            <Text style={s.eventDate} numberOfLines={1}>
              {formatDateLong(event.event_date, event.event_date_end)}
            </Text>
            <Text style={[s.eventName, { fontSize: 22 }]} numberOfLines={1}>{event.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'nowrap' }}>
              {cityLabel(event.location) ? (
                <Text style={[s.eventLocation, { marginTop: 0, flexShrink: 1 }]} numberOfLines={1}>
                  {cityLabel(event.location)}
                </Text>
              ) : null}
              {event.event_type ? (
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{displayEventType(event.event_type)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Bouton Suivre en haut a droite (geste de consentement RGPD).
            Etoile pleine si suivi, contour si non-suivi. */}
        {onToggleFollow && (
          <TouchableOpacity
            onPress={onToggleFollow}
            hitSlop={10}
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 40, height: 40,
              alignItems: 'center', justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61"
              fill={isFollowing ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Décompte en bas droite : J-X / GO ! / J+X (multi-jours supporté).
            Taille réduite pour laisser le nom dominer la hiérarchie visuelle. */}
        {countdown ? (
          <View style={{ position: 'absolute', bottom: 14, right: 16 }}>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontStyle: 'italic', letterSpacing: -0.8 }}>
              {countdown}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Phase D3 — geste de consentement biometrique RGPD.
          NON SUIVI : gros CTA degrade violet + encart consentement.
          SUIVI : pill statut + lien "Ne plus suivre" (avec confirm modal). */}
      {onToggleFollow && (
        isFollowing ? (
          <View style={{ marginTop: 4, marginBottom: 12 }}>
            <View style={{
              backgroundColor: '#EDE4FF',
              borderRadius: 14,
              paddingVertical: 14, paddingHorizontal: 16,
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}>
              <Svg width={20} height={18} viewBox="-1 -1.5 22.78 20.61" fill="#7B2FFF">
                <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
              </Svg>
              <Text style={{ color: '#5E1AD6', fontSize: 15, fontWeight: '700', flex: 1 }}>
                Tu suis cet event
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowUnfollowConfirm(true)}
              hitSlop={10}
              style={{ alignSelf: 'center', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12 }}
            >
              <Text style={{ color: '#918BA0', fontSize: 13, textDecorationLine: 'underline' }}>
                Ne plus suivre
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginTop: 4, marginBottom: 12 }}>
            <TouchableOpacity onPress={onToggleFollow} activeOpacity={0.88}>
              <LinearGradient
                colors={['#7B2FFF', '#5E1AD6']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: 16,
                  paddingVertical: 16, paddingHorizontal: 18,
                  shadowColor: '#7B2FFF', shadowOpacity: 0.35,
                  shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <Svg width={20} height={18} viewBox="-1 -1.5 22.78 20.61" fill="#fff">
                    <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
                  </Svg>
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    Suivre et recevoir mes photos
                  </Text>
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
                  Tes photos arriveront automatiquement, dès qu'elles sont prises.
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <View style={{
              marginTop: 12,
              backgroundColor: '#fff',
              borderColor: '#E4E0EC', borderWidth: 1,
              borderRadius: 14, padding: 14,
              flexDirection: 'row', gap: 10, alignItems: 'flex-start',
            }}>
              <View style={{
                width: 30, height: 30, borderRadius: 9,
                backgroundColor: '#EDE4FF',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#7B2FFF" strokeWidth={2}>
                  <Circle cx="12" cy="8" r="4" />
                  <Path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
                </Svg>
              </View>
              <Text style={{ flex: 1, fontSize: 12, color: '#5A5468', lineHeight: 17 }}>
                En suivant cet event, tu autorises Will à analyser ton visage pour y retrouver tes photos. Tu peux arrêter à tout moment.{' '}
                <Text
                  style={{ color: '#7B2FFF', textDecorationLine: 'underline' }}
                  onPress={() => Linking.openURL('https://will-app.com/confidentialite').catch(() => {})}
                >
                  En savoir plus
                </Text>
              </Text>
            </View>
          </View>
        )
      )}

      {/* CTA Site web : juste sous le header, coloré au type d'épreuve.
          Pleine largeur (comme les autres blocs), texte centré. Caché si pas
          de website. */}
      {event.website ? (
        <TouchableOpacity
          onPress={openWebsite}
          activeOpacity={0.85}
          style={{
            backgroundColor: tint,
            borderRadius: 14,
            paddingVertical: 10,
            paddingHorizontal: 24,
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
            {event.website.replace(/^https?:\/\//, '')} →
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Courses : un seul bloc avec header de labels + lignes de valeurs.
          !loading sinon le bloc distances flashe pendant le fetch initial. */}
      {distances.length > 0 && photos.length === 0 && !loading && (
        <View style={{
          marginBottom: 8,
          backgroundColor: `${tint}1A`,
          borderRadius: 12,
          paddingVertical: 12, paddingHorizontal: 16,
        }}>
          {/* Header labels */}
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DISTANCE</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DÉPART</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DÉNIVELÉ</Text>
            </View>
          </View>
          {/* Lignes de valeurs */}
          {distances.map((d, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: `${tint}33`,
              }}
            >
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{d.km} km</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                  {upcoming && d.time ? d.time : '—'}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                  {upcoming && d.elevation ? d.elevation : '—'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Galerie ou message a venir. On AJOUTE !loading sinon le block "a
          venir" flashe pendant le fetch initial (etat photos=[] + loading=true
          puis photos remplit). */}
      {upcoming && photos.length === 0 && !loading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center', backgroundColor: `${tint}1A`, borderRadius: 16 }}>
          <Icon.PhotoCam size={40} color={tint} />
          <Text style={{ color: tint, fontSize: 14, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
            Photos disponibles le jour J
          </Text>
          <Text style={{ color: tint, fontSize: 12, marginTop: 4, textAlign: 'center', opacity: 0.75 }}>
            Reviens le jour de l'événement pour voir tes photos
          </Text>
        </View>
      ) : (
        <>
          {/* Onglets de filtre (course / photographe / combine).
              Pas de placeholder loading (espace vide perceptible meme sans
              chips visibles). On tolere le shift discret quand les vrais
              tabs apparaissent, qui ne concerne que les events multi-races
              / multi-photographes (cas minoritaire). */}
          {tabs.length > 0 && photos.length > 0 && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 4 }}
              style={{ marginVertical: 8 }}
            >
              {tabs.map((t) => {
                const active = activeFilter === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => setActiveFilter(t.key)}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                      backgroundColor: active ? C.primary : '#f5f3ff',
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginVertical: 14, gap: 8 }}>
            <Text style={s.sectionTitle}>Photos</Text>
            {filteredPhotos.length > 0 && (
              <Text style={{ color: C.textSoft, fontSize: 13, opacity: 0.7 }}>
                {`${filteredPhotos.length} photo${filteredPhotos.length > 1 ? 's' : ''}`}
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );

  // Mode "a venir, 0 photo" : on n'affiche pas de grille, juste le header.
  // !loading sinon les skeletons ne s affichent pas pour un event upcoming
  // (renderListEmpty return null si showEmptyMessage=true).
  const showEmptyMessage = upcoming && photos.length === 0 && !loading;

  // Empty state de la FlatList : skeletons pendant le chargement, ou message.
  // Pour un event upcoming, jamais de skeletons ni de message "aucune photo" :
  // le header affichera "Photos disponibles le jour J" une fois loading=false.
  // Sinon les 9 carres violets clairs flashent pendant la fraction de seconde
  // du fetch initial.
  const renderListEmpty = () => {
    if (showEmptyMessage) return null;
    if (upcoming) return null;
    if (loading) {
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GRID_PADDING_H, gap: GRID_GAP }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonCell key={`sk-${i}`} size={cellSize} />
          ))}
        </View>
      );
    }
    return (
      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
        <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>
      </View>
    );
  };

  // Rendu d'une cellule : flex: 1 + aspectRatio: 1 (pas de width fixe pour
  // eviter tout decalage horizontal cause par s.scroll paddingHorizontal: 20).
  const renderItem = ({ item }) => (
    <PhotoCell
      // Pour la grille on utilise thumbUri (~25 KB) au lieu de uri (~2-5 MB).
      // Le viewer plein ecran recoit item entier (avec uri haute resolution).
      photo={{ ...item, uri: item.thumbUri || item.uri }}
      onPress={(origin) => onOpenPhoto?.(item, filteredPhotos, {
        origin,
        eventTitle: event?.name,
        eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
      })}
    />
  );

  const renderFooter = () => {
    if (!hasMore || showEmptyMessage) return null;
    return (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={C.primary} />
      </View>
    );
  };

  return (
    <>
      <FlatList
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 120 }}
        data={showEmptyMessage ? [] : visiblePhotos}
        keyExtractor={(item) => item.id || item.uri}
        renderItem={renderItem}
        numColumns={NUM_COLS}
        columnWrapperStyle={NUM_COLS > 1 ? {
          paddingHorizontal: GRID_PADDING_H,
          gap: GRID_GAP,
          marginBottom: GRID_GAP,
        } : undefined}
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={5}
        removeClippedSubviews={true}
        onEndReached={() => {
          if (hasMore) setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPhotos.length));
        }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderListEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Confirm modal "Ne plus suivre" (Phase D3). Le toggle via le coeur
          top-right reste instantane (gestures rapides), seule la voie
          deliberee via le lien sous le hero passe par cette confirmation. */}
      <Modal
        visible={showUnfollowConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnfollowConfirm(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(26,20,38,0.5)',
          justifyContent: 'center', padding: 24,
        }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 22 }}>
            <Text style={{
              fontSize: 17, fontWeight: '800', color: '#1A1426',
              marginBottom: 10, textAlign: 'center',
            }}>
              Ne plus suivre cet event ?
            </Text>
            <Text style={{
              fontSize: 14, color: '#5A5468', lineHeight: 20,
              marginBottom: 20, textAlign: 'center',
            }}>
              Tes données faciales sur cet event seront supprimées. Tu ne recevras plus tes photos.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setShowUnfollowConfirm(false)}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 999,
                  borderWidth: 1.5, borderColor: '#E4E0EC',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#5A5468', fontSize: 14, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowUnfollowConfirm(false); onToggleFollow(); }}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 999,
                  backgroundColor: '#EF4444',
                  alignItems: 'center',
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Ne plus suivre</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// Roulette 3 items visibles, style "overlay" : pastille centrale rose, items
// au-dessus/en-dessous attenues. Top-fade en degrade vers le panneau noir
// pour fondre la roulette sous le titre.
function OverlayWheel({ items, selectedIndex, onChange }) {
  const ITEM_H = 26;
  const VISIBLE = 3;
  const HEIGHT = VISIBLE * ITEM_H;
  const PAD_V = ((VISIBLE - 1) / 2) * ITEM_H;
  const scrollRef = useRef(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: true });
  }, [selectedIndex]);
  return (
    <View style={{ height: HEIGHT, alignSelf: 'stretch', position: 'relative' }}>
      {/* Pastille de selection au centre, contour rose + bg blanc subtil, pill arrondi */}
      <View pointerEvents="none" style={{
        position: 'absolute',
        top: PAD_V, left: 8, right: 8,
        height: ITEM_H,
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.06)',
        borderWidth: 0.5,
        borderColor: 'rgba(230,115,255,0.45)',
      }} />
      <ScrollView
        ref={scrollRef}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: selectedIndex * ITEM_H }}
        contentContainerStyle={{ paddingVertical: PAD_V }}
        onMomentumScrollEnd={e => {
          const idx = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
          if (idx !== selectedIndex) onChange(idx);
        }}
      >
        {items.map((it, i) => {
          const isSel = i === selectedIndex;
          return (
            <View key={i} style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{
                color: isSel ? '#E673FF' : 'rgba(255,255,255,0.4)',
                fontSize: isSel ? 15 : 13,
                fontWeight: '500',
              }}>{it.label}</Text>
            </View>
          );
        })}
      </ScrollView>
      {/* Top-fade : confine STRICTEMENT a la zone au-dessus de la selection
          (height = PAD_V exactement). Opaque sur 75% (couvre le texte du
          haut centre a 50%), puis fade-out vers transparent juste avant
          le top de la pastille selectionnee. Pas de chevauchement. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,1)', 'rgba(0,0,0,1)', 'rgba(0,0,0,0)']}
        locations={[0, 0.75, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: PAD_V,
        }}
      />
    </View>
  );
}

function PhotographerScreen({ session, onLogout, onExit }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  // Capteur principal = .builtInWideAngleCamera singleton physique. On
  // utilise useCameraDevices() (liste exhaustive) + filtre strict pour
  // garantir le singleton et exclure les virtuels multi-cam
  // (.builtInDualWideCamera, .builtInTripleCamera) qui pourraient scorer
  // "acceptable" avec useCameraDevice() et causer un fallback sur
  // l'ultra-wide via bascule auto AVCapture interne.
  const allDevices = useCameraDevices();
  const device = useMemo(() => {
    if (!allDevices) return undefined;
    return allDevices.find(d =>
      d.position === 'back' &&
      Array.isArray(d.physicalDevices) &&
      d.physicalDevices.length === 1 &&
      d.physicalDevices[0] === 'wide-angle-camera'
    );
  }, [allDevices]);

  // Configuration globale (chargée au mount, défauts si offline / nouveau schéma 6 sections)
  const [eventConfig, setEventConfig] = useState({
    capture: {
      burstCount: 8,          // legacy (mode rafale, plus utilise)
      interBurstMs: 150,      // legacy
      cooldownSec: 5,         // legacy
      intervalMs: 150,        // cadence min entre 2 photos (takePhoto HQ ~300-800ms borne haute, isCapturingRef gate le rythme reel)
      toleranceMs: 500,       // fenetre de tolerance perte de visage
      quality: "ultrahd",   // standard / hd / ultrahd / proraw
      format: "jpeg",       // jpeg / heic / dng
      videoResolution: "hd",   // hd (1920x1080) / 4k (3840x2160) — contrainte useCameraFormat
      // Reglages photo cablables cote VisionCamera 4.x : focus (continu par
      // defaut, locked declenche un warning car la prop n'est pas exposee en JS)
      // et exposureCompensation (prop `exposure`, mappe device.min/max).
      // shutterSpeed / iso / whiteBalance retires : non exposes par VisionCamera 4.x.
      aperture: "auto",
      focus: "continuous",
      exposureCompensation: 0, // -2..+2 EV par pas de 0.5
    },
    rekognition: { similarityThreshold: 80, maxMatchesPerPhoto: 5, collectionTtlDays: 14 },
    imageProcessing: {
      generateThumbnail: true, generatePreview: true,
      thumbnailWidthPx: 400, previewWidthPx: 1200, previewQuality: 80,
      // Post-capture filter (Vision framework, iOS only). Une photo doit
      // contenir au moins 1 visage >= minFaceWidthPx, sinon elle est trashee
      // avant upload. Le score VNDetectFaceCaptureQuality (Apple Vision) a
      // ete neutralise (minQuality=0) : le pipeline natif AVCapturePhotoOutput
      // + Deep Fusion + cap shutter 1/500 garantit deja la nettete. Le score
      // Apple, calibre studio-grade, rejetait abusivement les coureurs a
      // distance (scores 0.3-0.5 sur des photos OK). On garde quand meme le
      // filtre visage : il evite d'uploader les photos sans personne (faux
      // declenchements MLKit, capteur cache, etc).
      // - enabled:false pour bypasser temporairement (debug).
      postCaptureFilter: { enabled: true, minFaceWidthPx: 40, minQuality: 0 },
    },
    upload: { mode: "immediate", batchSize: 10, maxRetries: 5, compressBeforeUpload: false },
    debug: {
      verboseLogs: true, skipRekognition: false, saveUnmatchedFrames: false,
    },
    // Pipeline mobile 2026-05 : iPhone gere TOUT en natif (AE/AF continus,
    // Deep Fusion, Smart HDR, reduction de bruit). Plus de shutter custom.
    // shutterSpeed garde dans le config par retro-compatibilite (back-end
    // peut continuer a le servir) mais ignore cote app -- le natif n'en
    // depend plus. zone = bande verticale de capture (filtrage bbox face).
    camera: {
      captureZoneWidthPercent: 30,
      shutterSpeed: 1000,
    },
  });

  useEffect(() => {
    fetch(`${API_URL}/config`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (!cfg) return;
        setEventConfig(prev => ({ ...prev, ...cfg }));
        // Note : will_shutter.json n'est plus ecrit -> WillShutterController
        // a ete neutralise 2026-05 (rendu iPhone natif, exposition auto
        // continue, plus de shutter custom).
      })
      .catch(() => {});
  }, []);

  // Format 4:3 binne du capteur principal. Heuristique ratio-moitie : sur
  // un capteur 48 MP (iPhone 14 Pro+/15/16), la photoWidth max 4:3 est
  // 8064 et le format binne expose 4032 = max/2 (binning 2x2 quad-Bayer).
  // Sur un capteur 12 MP natif (iPhone 12/13 non-Pro), pas de moitie ->
  // fallback sur le max 4032. Resultat : 4032x3024 sur tous les iPhones
  // modernes, qui est exactement ce que l'app Camera native utilise par
  // defaut. AUCUNE dimension hardcodee.
  //
  // FRAGILITE : l'heuristique suppose binning 2x2 (ratio 1/2). Si un futur
  // capteur utilise binning 3x3 ou 4x4 (ratio 1/3 ou 1/4), il faudra
  // elargir la tolerance ou cross-checker avec un signal natif
  // (isVideoBinned sur AVCaptureDeviceFormat, non expose en JS).
  const format = useMemo(() => {
    if (!device || !device.formats?.length) return undefined;

    const fmts4_3 = device.formats.filter(f => {
      if (!f.photoWidth || !f.photoHeight) return false;
      return Math.abs(f.photoWidth / f.photoHeight - 4 / 3) < 0.01;
    });
    if (!fmts4_3.length) return undefined;

    const maxPhotoW = Math.max(...fmts4_3.map(f => f.photoWidth));
    const HALF_TOL = 0.05; // ±5%
    const binned = fmts4_3.filter(f => {
      const ratio = f.photoWidth / maxPhotoW;
      return Math.abs(ratio - 0.5) < HALF_TOL;
    });
    const pool = binned.length > 0
      ? binned
      : fmts4_3.filter(f => f.photoWidth === maxPhotoW);

    // Disambig : max video buffer dans le pool -> meilleure preview +
    // meilleure detection face sur le frame processor.
    return pool.reduce((best, f) =>
      !best || (f.videoWidth * f.videoHeight) > (best.videoWidth * best.videoHeight)
        ? f
        : best
    , null);
  }, [device]);
  const cameraRef = useRef(null);

  // Log device + format -> deplaces cote Swift NSLog [WILL-CAM] (hook
  // WillShutterController.attachDevice). console.log JS n'apparait pas
  // dans Console.app sur build EAS preview ; NSLog est lui visible.

  // VisionCamera 4.x ne propose pas de prop `enableContinuousAutoFocus` ou
  // equivalent en JS RN : le focus continu est actif par defaut, et seul un
  // focus ponctuel imperatif `camera.focus({x,y})` est expose. Si l'admin
  // demande `locked`, on ne peut que le logger — le focus reste continu.
  useEffect(() => {
    const focusMode = eventConfig?.capture?.focus;
    if (focusMode === 'locked') {
      console.warn(
        '[camera] capture.focus="locked" demande mais VisionCamera 4.x ne le supporte pas en JS RN ; focus continu maintenu.'
      );
    }
  }, [eventConfig?.capture?.focus]);

  const videoStabilizationMode = useMemo(() => {
    const modes = format?.videoStabilizationModes || [];
    if (modes.includes('cinematic-extended')) return 'cinematic-extended';
    if (modes.includes('cinematic')) return 'cinematic';
    if (modes.includes('standard')) return 'standard';
    return 'off';
  }, [format]);

  // Compensation d'exposition : VisionCamera 4.x expose la prop `exposure` (number)
  // dans l'intervalle device.minExposure..device.maxExposure (EV bias). On clamp
  // pour eviter de planter sur un device dont la plage est plus etroite que -2..+2.
  // focus / aperture ne sont PAS exposes en JS RN par VisionCamera 4.x :
  // ces valeurs sont lues mais inertes (focus continu par defaut natif).
  const cameraExposure = useMemo(() => {
    const raw = Number(eventConfig.capture?.exposureCompensation);
    if (!Number.isFinite(raw) || raw === 0) return undefined;
    const minE = typeof device?.minExposure === 'number' ? device.minExposure : -8;
    const maxE = typeof device?.maxExposure === 'number' ? device.maxExposure : 8;
    return Math.max(minE, Math.min(maxE, raw));
  }, [device, eventConfig.capture?.exposureCompensation]);

  const isCapturingRef = useRef(false);
  // True dès qu'une frame analysée détecte ≥1 humain dans la zone. Mis à
  // jour à CHAQUE frame (count>0 OU count=0) -- sert de condition d'arrêt
  // à la boucle de capture (visage sorti = stop immédiat).
  const faceInZoneRef = useRef(false);
  // Incrémenté à chaque dispatch onHumansDetectedJS (count=0 OU >0). Permet
  // à la boucle d'attendre une analyse FRAÎCHE post-capture avant de
  // décider de relancer (le frame processor peut se figer ~100-400ms
  // pendant Deep Fusion : sans cette attente, on relit un ref stale).
  const frameSeqRef = useRef(0);
  // True pendant qu'une boucle de capture est en cours. Empêche un 2e
  // démarrage concurrent si plusieurs frames "face détecté" arrivent rapprochées.
  const burstLoopRef = useRef(false);
  const isMountedRef = useRef(true);
  const isDetectionEnabledRef = useRef(false);
  // Auto-capture arme par Go/Stop. Quand true, une frame avec >=1 humain
  // declenche captureOne. Quand false, le frame processor logue mais ne
  // tire pas. Ref pour le worklet, state pour le rendu du bouton.
  const isAutoArmedRef = useRef(false);

  const [isShooting, setIsShooting] = useState(false);
  const [isAutoArmed, setIsAutoArmed] = useState(false);
  const [isDetectionEnabled, setIsDetectionEnabled] = useState(false);
  // Compteur de session "Capturees" -- incremente a chaque enqueue (succes
  // takePhoto + write disque). Reset au mount du screen (session photographe).
  // Ref pour l'increment cote captureOne, state pour le rendu du badge UI.
  const capturedCountRef = useRef(0);
  const [capturedCount, setCapturedCount] = useState(0);
  // "Uploadees" -- incremente UNIQUEMENT a la confirmation PUT 200 OK cote
  // worker dans drainQueue. Verite R2 cote app (modulo le delete LLaVA
  // desormais neutralise cote worker). Si capturedCount > uploadedCount
  // longtemps, le photographe sait qu'il y a un decalage capture vs upload.
  const uploadedCountRef = useRef(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  // "Perdues" -- incremente sur tout chemin DESTRUCTIF du pipeline :
  //   - enqueueBurstItems throw (move/copy ou writeSidecar fail)
  //   - processQueue drop d'un item dont le raw a disparu sur disque
  // Pas incremente pour les retries 'failed' (recuperable manuellement).
  // Affiche au photographe pour qu'il sache combien de photos sont VRAIMENT
  // perdues (vs simplement en queue). Toute perte = log loud + bump ici.
  const lostCountRef = useRef(0);
  const [lostCount, setLostCount] = useState(0);
  // "En vol" -- Set de Promises captureOne en cours d'execution (mode burst
  // pipeline). Le burst loop attend (Promise.race) si la taille atteint
  // MAX_IN_FLIGHT. RAM borne, parasites de sortie bornes (max = MAX_IN_FLIGHT).
  const inFlightSetRef = useRef(new Set());
  const [inFlight, setInFlight] = useState(0);

  // Synchronise les states UI depuis inFlightSetRef. Centralise setIsShooting
  // (true ssi >=1 capture en vol) + setInFlight pour le compteur.
  function updateInFlight() {
    const n = inFlightSetRef.current.size;
    if (!isMountedRef.current) return;
    setInFlight(n);
    setIsShooting(n > 0);
  }

  // Voyant lumière : ISO+shutter+brightness LIVE lus via frame processor
  // natif (ExposureReaderPlugin) depuis les attachments EXIF du CMSampleBuffer
  // de preview, AVANT toute capture. Permet au bénévole de vérifier que
  // l'emplacement est bien éclairé dès l'ouverture de la caméra. Lissage
  // médiane sur les N derniers samples (à ~1 Hz natif => ~N secondes de
  // mémoire) pour éviter le clignotement du voyant. Lecture seule : ne
  // change rien à l'exposition (mode natif auto inchangé).
  //
  // shutter/brightness ne sont pas utilises par le voyant (calcule sur l'ISO
  // seul) mais affiches dans le readout debug IS_PREVIEW_OR_DEV : objectif
  // diagnostic terrain — voir en direct la vitesse d'obturation effective
  // (cap a 1/30s en preview 30 fps, donc indicateur "shutter sature + ISO qui
  // grimpe = flou imminent").
  const ISO_SAMPLE_SIZE = 4;
  const liveExposureRef = useRef([]);
  const [liveExposureSamples, setLiveExposureSamples] = useState([]);
  function pushLiveExposureSample(sample) {
    if (!sample) return;
    const iso = Number(sample.iso);
    if (!Number.isFinite(iso) || iso <= 0) return;
    const shutter = Number(sample.shutter);
    const brightness = Number(sample.brightness);
    const clean = {
      iso,
      shutter: Number.isFinite(shutter) && shutter > 0 ? shutter : null,
      brightness: Number.isFinite(brightness) ? brightness : null,
    };
    const next = [...liveExposureRef.current, clean].slice(-ISO_SAMPLE_SIZE);
    liveExposureRef.current = next;
    if (isMountedRef.current) setLiveExposureSamples(next);
  }

  // Stub no-op : conserve les call sites addDebugLog dispersés (sera retire
  // si plus aucun reste apres simplification).
  const addDebugLog = () => {};

  // Compteur frames pour throttle ~10 fps d'analyse (1 frame sur 3 a 30 fps).
  // VNDetectHumanRectangles est ~3-5x plus lourd que MLKit face : 30 fps
  // d'analyse charge thermal + batterie pour rien. 10 fps suffit largement
  // pour qu'un coureur traversant la zone soit detecte.
  const frameSkipSV = useMemo(() => Worklets.createSharedValue(0), []);
  // Throttle ISO live : compteur tournant ~1 Hz a 30 fps (lecture toutes les
  // 30 frames). Le dict lookup EXIF est presque gratuit cote natif, on
  // pourrait lire a chaque frame, mais le bridge worklet -> JS reste a 1 Hz
  // suffit largement pour un voyant et evite des renders inutiles.
  const isoTickSV = useMemo(() => Worklets.createSharedValue(0), []);
  // Largeur zone de capture (fraction 0..1) lue par le plugin Swift pour
  // filtrer les humains hors-bande. Mise a jour quand eventConfig change.
  const zoneSV = useMemo(() => Worklets.createSharedValue(0.3), []);

  // Caméra ancrée juste sous le header (au lieu de absoluteFill + letterbox 4:3
  // qui laissait un grand vide noir entre le header et l'image visible sur les
  // grands écrans). La preview est dimensionnée explicitement en 4:3.
  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  const previewH = Math.min(winH, winW * (4 / 3));
  const CAMERA_TOP = 148;

  // Course + km posté
  const [selectedRace, setSelectedRace] = useState(null); // null = "Toutes les courses"
  const [selectedKm, setSelectedKm] = useState(0);
  const distances = Array.isArray(session?.event?.distances) ? session.event.distances : [];
  const hasDistances = distances.length > 0;
  // Course "Toutes" : ceiling = plus longue distance de l'event (pas un floor
  // arbitraire). Course choisie : ceiling = sa distance. Fallback 50 km si
  // aucune distance valide (event mal configure).
  const validKms = distances.map(d => parseFloat(d.km) || 0).filter(n => n > 0);
  const maxKm = validKms.length > 0 ? Math.max(...validKms) : 50;
  const kmCeiling = selectedRace
    ? Math.ceil(parseFloat(selectedRace.km) || maxKm)
    : Math.ceil(maxKm);

  const badgePulse = useRef(new Animated.Value(1)).current;
  const badgeOpacity = useRef(new Animated.Value(1)).current;

  // Flash blanc full-screen au début d'une rafale + animations de l'UI.
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const captureScale = useRef(new Animated.Value(1)).current;
  const headerSlideY = useRef(new Animated.Value(-120)).current;
  const footerSlideY = useRef(new Animated.Value(300)).current;

  // Callback JS bindee depuis le worklet du frame processor : recoit la
  // mesure d'exposition live {iso, shutter, brightness} lue cote natif
  // (~1 Hz). pushLiveExposureSample applique le lissage et la validation.
  const onExposureSampleJS = useMemo(
    () => Worklets.createRunOnJS((sample) => {
      pushLiveExposureSample(sample);
    }),
    [],
  );

  const onHumansDetectedJS = useMemo(
    () => Worklets.createRunOnJS((count) => {
      // Met à jour faceInZoneRef à CHAQUE frame analysée (count>=1 OU 0) et
      // incrémente frameSeqRef pour que la boucle puisse détecter l'arrivée
      // d'une analyse fraîche post-capture. Si armé + visage en zone +
      // aucune boucle en cours -> démarre captureBurstLoop (séquentiel strict,
      // s'arrête dès que faceInZoneRef repasse à false).
      if (!isDetectionEnabledRef.current) return;
      frameSeqRef.current += 1;
      faceInZoneRef.current = count > 0;
      if (!isAutoArmedRef.current) return;
      if (!faceInZoneRef.current) return;
      if (burstLoopRef.current) return;
      captureBurstLoop();
    }),
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (!hasPermission) requestPermission();
    return () => {
      isMountedRef.current = false;
      // Annule le timer de retry pour ne pas declencher un drainQueue
      // post-unmount (qui ferait des fetch vers API_URL pour rien).
      if (retryTickTimeoutRef.current) {
        clearTimeout(retryTickTimeoutRef.current);
        retryTickTimeoutRef.current = null;
      }
    };
  }, [hasPermission]);

  useEffect(() => {
    if (isShooting) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(badgePulse, { toValue: 1.04, duration: 700, useNativeDriver: true }),
          Animated.timing(badgePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      badgePulse.stopAnimation();
      Animated.timing(badgePulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [isShooting]);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(badgeOpacity, { toValue: 0.5, duration: 120, useNativeDriver: true }),
      Animated.timing(badgeOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [isShooting, isDetectionEnabled]);

  // Sync de la zone vers le worklet a chaque change config.
  useEffect(() => {
    const pct = eventConfig.camera?.captureZoneWidthPercent ?? 30;
    zoneSV.value = Math.max(0.1, Math.min(1, pct / 100));
  }, [eventConfig.camera?.captureZoneWidthPercent, zoneSV]);

  // Axe de filtrage detection wide 1x : hypothese theorique midX (Vision
  // avec frame.orientation=.right rotate l'image en portrait -> midX =
  // axe gauche-droite sur ecran = matche la bande visuelle dessinee par
  // les lignes verticales leftPct/rightPct). A valider via log
  // [FaceDetector] axis=midX bboxes=(x=,y=) : coureur visuellement centre
  // doit donner x~0.5. Si le log montre que y varie quand le coureur
  // bouge horizontalement, on swap vers midY au build suivant.
  // Le plugin native dump TOUJOURS x ET y dans les logs pour ce diag.

  // Frame processor : ~30 fps appel worklet, throttle 1/3 -> ~10 fps d'analyse
  // Vision (economie batterie + thermal). Apple Vision tourne sur la queue
  // VisionCamera (background) ; le runOnJS ne bloque pas le rendu.
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // ISO live : tick ~1 Hz a 30 fps (independant du throttle Vision pour
    // que le voyant lumiere reste reactif meme quand detectHumans skip).
    // Lecture seule de la metadata EXIF du buffer, ~qq us, ne bloque rien.
    isoTickSV.value = (isoTickSV.value + 1) % 30;
    if (isoTickSV.value === 0) {
      const exp = readExposure(frame);
      if (exp && exp.iso) onExposureSampleJS(exp);
    }

    frameSkipSV.value = (frameSkipSV.value + 1) % 3;
    if (frameSkipSV.value !== 0) return;
    const result = detectHumans(frame, {
      zoneWidthPercent: zoneSV.value,
      axis: 'midX',
    });
    const count = result?.count ?? 0;
    onHumansDetectedJS(count);
  }, [onHumansDetectedJS, onExposureSampleJS, frameSkipSV, isoTickSV, zoneSV]);

  // === Mode offline-first : queue persistante ===
  // - Photos copiées dans Paths.document/will_pending/ (survit au kill app)
  // - Métadonnées dans AsyncStorage UPLOAD_QUEUE_KEY (single global queue)
  // - Upload gated par NetInfo (pas de tentative si offline)
  // - status: 'pending' | 'uploading' | 'failed' (max retries atteint)
  const [queueStats, setQueueStats] = useState({ total: 0, pending: 0, uploading: 0, failed: 0 });
  const [isOnline, setIsOnline] = useState(true);
  const queueRef = useRef([]);
  const drainingRef = useRef(false);
  // Anti-spam de l'alerte "queue > 100" et seuil "espace disque faible".
  const lastQueueWarnAtRef = useRef(0);
  const lastDiskWarnAtRef = useRef(0);
  // Progress bar : nombre de fichiers à uploader au démarrage du drain courant.
  // Reset à 0 quand le drain finit. Affichée si > 5.
  const drainStartTotalRef = useRef(0);
  const [drainStartTotal, setDrainStartTotal] = useState(0);

  function recomputeStats(arr) {
    const stats = { total: arr.length, pending: 0, uploading: 0, failed: 0 };
    for (const it of arr) {
      if (it.status === 'failed') stats.failed++;
      else if (it.status === 'uploading') stats.uploading++;
      else stats.pending++;
    }
    return stats;
  }

  // Chaîne de sérialisation des writes AsyncStorage. queueRef.current est
  // toujours mis à jour synchrone (pas de race en mémoire), mais les
  // AsyncStorage.setItem peuvent partir dans le désordre si on n'attend pas
  // -- en cadence rafale (jusqu'à MAX_IN_FLIGHT captureOne en parallèle,
  // chacun appelant enqueueBurstItems puis commitQueue), ça garantit que les
  // écritures disque s'enchaînent dans l'ordre des appels et que la dernière
  // setItem écrit toujours l'état le plus récent.
  const commitChainRef = useRef(Promise.resolve());

  async function commitQueue(arr) {
    queueRef.current = arr;     // SYNC : état mémoire à jour immédiatement
    if (isMountedRef.current) {
      setQueueStats(recomputeStats(arr));
    }
    // SERIAL : chain le setItem derrière le précédent. saveUploadQueue lit
    // queueRef.current AU MOMENT DE L'EXÉCUTION du setItem (après await prev),
    // donc on persiste toujours l'état le plus à jour, jamais un snapshot
    // stale.
    const prev = commitChainRef.current;
    commitChainRef.current = (async () => {
      try { await prev; } catch {}
      await saveUploadQueue(queueRef.current);
    })();
    await commitChainRef.current;
  }

  // Charge la queue au démarrage du screen + reconcile fichiers manquants
  // + reset des items 'uploading' / 'processing' (interrompus par crash/kill).
  // Migration legacy : items sans champ `processed` -> processed:true (ils
  // sont passes par l'ancien pipeline qui faisait enhance/burn/encode inline).
  // Si queue non vide, propose à l'utilisateur de reprendre l'upload.
  useEffect(() => {
    let alive = true;
    (async () => {
      ensurePendingDir();
      const arr = await loadUploadQueue();
      // Photos d'un autre event (ou sans eventCode) : on les purge silencieusement
      // pour eviter qu'un photographe qui change d'event voie l'ancienne session.
      const currentEvent = session?.event?.code;
      const cleaned = [];
      const orphans = [];
      for (const rawIt of arr) {
        // Migration : items legacy sans `processed` ont deja ete enhance/burn
        // par l'ancien pipeline -> on les marque processed:true.
        const it = rawIt.processed === undefined
          ? { ...rawIt, processed: true }
          : rawIt;
        if (it.eventCode !== currentEvent) {
          orphans.push(it);
          continue;
        }
        const fileExists = (() => {
          try { return new File(it.localUri).exists; } catch { return false; }
        })();
        if (!fileExists) {
          // raw orphan : si sidecar present, on pourrait reconstruire mais
          // sans le brut HEIC c'est inutile -> drop silencieux + cleanup sidecar.
          if (it.processed === false && it.id) deleteSidecar(it.id);
          continue;
        }
        // recovery: 'uploading' (drain interrompu) -> 'pending', cooldown reset
        // pour partir au prochain tick. Idem 'processing' (worker burn interrompu).
        if (it.status === 'uploading' || it.status === 'processing') {
          cleaned.push({ ...it, status: 'pending', nextAttemptAt: null });
        } else {
          cleaned.push(it);
        }
      }
      // Suppression des fichiers physiques des orphelins (espace disque) +
      // sidecar associe si processed:false.
      for (const o of orphans) {
        try { new File(o.localUri).delete(); } catch {}
        if (o.processed === false && o.id) deleteSidecar(o.id);
      }
      if (!alive) return;
      await commitQueue(cleaned);
      if (cleaned.length === 0) return;
      // Demarrage immediat des workers : process pour les brut, drain pour les
      // processed. Si online, les deux partent en parallele (workers separes).
      processQueue();
      const state = await NetInfo.fetch().catch(() => null);
      const online = state ? (!!state.isConnected && state.isInternetReachable !== false) : true;
      if (online) drainQueue();
      // Alerte de reprise : "X photos en attente depuis [date]. Reprendre ?"
      const lastTsRaw = await AsyncStorage.getItem(LAST_CAPTURE_KEY).catch(() => null);
      const lastTs = lastTsRaw ? parseInt(lastTsRaw, 10) : 0;
      const whenLabel = lastTs ? formatTimeAgo(lastTs) : 'de ta session précédente';
      const n = cleaned.length;
      Alert.alert(
        'Photos en attente',
        `Tu as ${n} photo${n > 1 ? 's' : ''} en attente d'upload (${whenLabel}). Reprendre maintenant ?`,
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Reprendre', onPress: () => drainQueue() },
        ],
      );
    })();
    return () => { alive = false; };
  }, []);

  // NetInfo: relance le drain au retour du réseau, met à jour l'indicateur.
  // processQueue est offline-safe (pas d'upload) donc on le pousse aussi :
  // si on etait au repos pendant offline, autant rattraper le retard de burn.
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (isMountedRef.current) setIsOnline(online);
      processQueue();
      if (online) drainQueue();
    });
    return () => unsub();
  }, []);

  // Heartbeat 30s : filet de sécurité au cas où NetInfo manquerait un évènement,
  // et reveil periodique du worker process si jamais un item reste 'raw' (rare,
  // mais ceinture+bretelles : un worker mort silencieusement serait relance).
  useEffect(() => {
    const t = setInterval(() => { processQueue(); drainQueue(); }, 30000);
    return () => clearInterval(t);
  }, []);

  // AppState : retour foreground → kick les deux workers (au cas où la
  // connexion soit revenue pendant que l'app était en background, ou que des
  // brut n'aient pas eu le temps d'etre traites avant la mise en background).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') { processQueue(); drainQueue(); }
    });
    return () => sub.remove();
  }, []);

  // Enqueue: deplace le fichier brut capture vers will_pending/raw/{id}.heic,
  // ecrit son sidecar JSON, et ajoute l'item a la queue en `processed:false`
  // pour que processQueue le prenne en charge. Le move (vs copy) est volontaire :
  // le tmp VisionCamera n'est pas persistant, et un move atomique sur meme
  // volume est l'operation la moins couteuse possible cote latence capture.
  async function enqueueBurstItems(rawItems) {
    if (rawItems.length === 0) return;
    ensurePendingDir();
    const dir = rawDir();
    const newQueueItems = [];
    // Garde-fou défensif : tripwire pour détecter une collision de clé R2.
    // Avec le schéma {burstTs}_{idx} (idx monotone par burst), la collision
    // est impossible par construction. Mais si une régression future réintroduit
    // le bug (idx hardcodé, burstTs per-photo, etc.), on ne perd PAS la photo :
    // on renomme la clé avec un suffixe random et on log loudly pour alerter.
    const existingKeys = new Set(queueRef.current.map(it => it.key));
    // Politique : tout échec ici (move/copy, writeSidecar, autre) THROW au
    // caller. Caller (captureOne) catch, incrémente "Perdues" et n'incrémente
    // PAS "Capturées" -- compteur reste honnête. Aucun `continue` silencieux.
    for (const r of rawItems) {
      let finalKey = r.key;
      if (existingKeys.has(finalKey)) {
        const suffix = Math.random().toString(36).slice(2, 8);
        const dotIdx = finalKey.lastIndexOf('.');
        finalKey = dotIdx > -1
          ? `${finalKey.slice(0, dotIdx)}-dup${suffix}${finalKey.slice(dotIdx)}`
          : `${finalKey}-dup${suffix}`;
        console.error(`[enqueue] KEY COLLISION (régression !) : ${r.key} → renommé ${finalKey}`);
      }
      existingKeys.add(finalKey);
      // Capture HEIC garantie par with-heic-capture plugin (AVCapturePhotoOutput
      // bascule sur codec HEVC). On etiquette le brut en .heic pour eviter
      // l'extension menteuse .jpg qui trainait avant le refactor.
      const ext = r.isRaw ? 'dng' : 'heic';
      const id = generateItemId();
      const dest = new File(dir, `${id}.${ext}`);
      const src = new File(r.tempPath.startsWith('file://') ? r.tempPath : `file://${r.tempPath}`);
      // Move atomique (meme volume Documents/...). Fallback copy si move
      // echoue (cross-device, permission). Si LES DEUX echouent -> throw
      // explicite avec les 2 raisons : on ne perd PAS la photo en silence.
      try { src.move(dest); }
      catch (eMove) {
        try { src.copy(dest); }
        catch (eCopy) {
          throw new Error(`enqueue move/copy failed for ${finalKey}: move="${eMove?.message || eMove}" copy="${eCopy?.message || eCopy}"`);
        }
      }
      // Sidecar : EXIF de capture + contexte race/km. Si l'ecriture echoue,
      // on throw : le HEIC est deja dans raw/ (orphelin sur disque), mais
      // l'item n'est PAS en queue -- on prefere ce trade-off (un fichier
      // orphelin a sweep plus tard) plutot qu'un item queue sans sidecar
      // (processQueue calerait au burn sans label, dans un etat ambigu).
      try {
        await writeSidecar(id, {
          id,
          exif: r.exif || null,
          race: r.race ?? null,
          km: r.km ?? null,
          eventCode: session?.event?.code || 'unknown',
          photographerId: session?.photographer_id || null,
          key: finalKey,
          burstTs: r.burstTs,
          idx: r.idx,
          capturedAt: Date.now(),
        });
      } catch (eSidecar) {
        throw new Error(`enqueue writeSidecar failed for ${finalKey} id=${id}: ${eSidecar?.message || eSidecar}`);
      }
      newQueueItems.push({
        id,
        localUri: dest.uri,             // pointe sur raw/{id}.heic en phase brut
        eventCode: session?.event?.code || 'unknown',
        photographerName: session?.photographer_name || session?.photographer_id || 'unknown',
        burstTs: r.burstTs,
        idx: r.idx,
        createdAt: Date.now(),
        retries: 0,
        status: 'pending',
        processed: false,               // sera flip a true par processQueue
        // métadonnées pour upload
        key: finalKey,
        isRaw: !!r.isRaw,
        race: r.race,
        km: r.km,
      });
    }
    let next = [...queueRef.current, ...newQueueItems];

    // FIFO eviction : si la queue depasse MAX_QUEUE_SIZE (200), on vire les
    // plus anciens items 'pending' ou 'failed' (jamais 'uploading' ni
    // 'processing' pour ne pas casser un worker en cours). Delete les
    // fichiers locaux + sidecar (si brut) pour liberer le stockage.
    if (next.length > MAX_QUEUE_SIZE) {
      const excess = next.length - MAX_QUEUE_SIZE;
      const dropped = [];
      const kept = [];
      let droppedCount = 0;
      for (const it of next) {
        const inFlight = it.status === 'uploading' || it.status === 'processing';
        if (droppedCount < excess && !inFlight) {
          dropped.push(it);
          droppedCount++;
        } else {
          kept.push(it);
        }
      }
      for (const it of dropped) {
        try { new File(it.localUri).delete(); } catch {}
        if (it.processed === false && it.id) deleteSidecar(it.id);
      }
      if (dropped.length > 0) {
        console.warn(`[upload] FIFO drop ${dropped.length} oldest items (queue at max ${MAX_QUEUE_SIZE})`);
      }
      next = kept;
    }
    await commitQueue(next);

    // Timestamp de dernière capture — utilisé par l'alerte de reprise au démarrage.
    AsyncStorage.setItem(LAST_CAPTURE_KEY, String(Date.now())).catch(() => {});

    // Alerte de stockage local (pendingDir) — déjà en place
    const sizeBytes = pendingDirSizeBytes();
    if (sizeBytes > STORAGE_WARN_BYTES) {
      Alert.alert(
        'Stockage local plein',
        `Plus de 5 Go de photos en attente d'upload (${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} Go). Connecte-toi à un wifi pour libérer de l'espace.`,
      );
    }

    // Warning si beaucoup de photos en attente (throttle 5 min). Mentionne
    // explicitement le FIFO eviction au-dela de MAX_QUEUE_SIZE pour que le
    // photographe sache qu'il risque de perdre les plus anciennes.
    const now = Date.now();
    if (next.length >= QUEUE_WARN_THRESHOLD && now - lastQueueWarnAtRef.current > 5 * 60 * 1000) {
      lastQueueWarnAtRef.current = now;
      const tail = next.length >= MAX_QUEUE_SIZE
        ? ` Au-dela de ${MAX_QUEUE_SIZE}, les plus anciennes sont supprimees automatiquement.`
        : '';
      Alert.alert(
        'Beaucoup de photos en attente',
        `${next.length} photos en attente d'upload. Pense à retrouver du réseau pour les envoyer.${tail}`,
      );
    }

    // Espace disque iPhone (best effort — l'API n'est pas garantie sur toutes les versions)
    try {
      const free = Paths.document?.availableSpace ?? Paths.cache?.availableSpace;
      if (typeof free === 'number' && free > 0 && free < DISK_LOW_BYTES
          && now - lastDiskWarnAtRef.current > 10 * 60 * 1000) {
        lastDiskWarnAtRef.current = now;
        Alert.alert(
          'Espace faible',
          `Moins de 1 Go disponible sur ton iPhone. Pense à uploader tes photos.`,
        );
      }
    } catch {}

    // Les nouveaux items sont processed:false -> ils sortent par processQueue
    // d'abord (enhance/burn/encode), qui kickera drainQueue quand le brut est
    // prêt. On evite donc de tenter un upload sur un brut non traite.
    processQueue();
  }

  // setTimeout id pour le re-trigger de drain apres un cooldown de backoff.
  // Reset/replace dans scheduleRetryTick pour ne pas accumuler les callbacks.
  const retryTickTimeoutRef = useRef(null);

  // Programme un re-trigger des workers au plus proche nextAttemptAt parmi
  // les items 'pending' (que ce soit pour burn -> processQueue, ou pour upload
  // -> drainQueue). Si rien n'est en cooldown, no-op. Appele a la fin de
  // chaque drain/process pour reprendre les retries 2/4/8s sans attendre le
  // heartbeat 30s.
  function scheduleRetryTick() {
    if (retryTickTimeoutRef.current) {
      clearTimeout(retryTickTimeoutRef.current);
      retryTickTimeoutRef.current = null;
    }
    const arr = queueRef.current;
    const now = Date.now();
    let nextAt = Infinity;
    for (const it of arr) {
      if (it.status !== 'pending') continue;
      if (it.nextAttemptAt && it.nextAttemptAt > now && it.nextAttemptAt < nextAt) {
        nextAt = it.nextAttemptAt;
      }
    }
    if (!isFinite(nextAt)) return;
    const delay = Math.max(50, nextAt - now);
    retryTickTimeoutRef.current = setTimeout(() => {
      retryTickTimeoutRef.current = null;
      // On reveille les deux workers : ils filtrent eux-memes sur processed.
      processQueue();
      drainQueue();
    }, delay);
  }

  // Calcule le nouvel etat d'un item apres echec d'upload. Sous maxRetries :
  // bumps retries + planifie le prochain essai avec backoff exponentiel
  // (retryDelayMs : 2s, 4s, 8s, plafond 8s). Au-dela : 'failed' definitif
  // (l'utilisateur peut force-retry via le sous-ecran admin).
  function nextRetryState(item, maxRetries) {
    const retries = (item.retries || 0) + 1;
    if (retries >= maxRetries) {
      return { ...item, retries, status: 'failed', nextAttemptAt: null };
    }
    return {
      ...item,
      retries,
      status: 'pending',
      nextAttemptAt: Date.now() + retryDelayMs(retries),
    };
  }

  // === Worker process : enhance + burn EXIF + encode HEIC ===
  // Boucle sequentielle (single-flight via processingRef). Prend le plus
  // ancien item processed:false, lit son sidecar, appelle le natif
  // PhotoMetadataBurner (lui-meme serial DispatchQueue cote iOS pour borner
  // la memoire), deplace raw/ -> processed/, flip processed:true, kicke
  // drainQueue. Offline-safe : ne touche jamais le reseau.
  //
  // Sur erreur : bump retries, backoff exponentiel (meme barreme que upload).
  // Au-dela de MAX_RETRIES_DEFAULT, marque l'item 'failed' (l'admin peut
  // force-retry via le sous-ecran admin -> reset retries -> picked up here).
  const processingRef = useRef(false);
  async function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (true) {
        const arr = [...queueRef.current];
        const now = Date.now();
        const idx = arr.findIndex(it =>
          it && it.processed === false
            && it.status !== 'failed'
            && it.status !== 'processing'  // garde-fou
            && (!it.nextAttemptAt || it.nextAttemptAt <= now)
        );
        if (idx === -1) break;
        const item = arr[idx];

        // Sanity : brut present sur disque ?
        let srcExists = false;
        try { srcExists = new File(item.localUri).exists; } catch {}
        if (!srcExists) {
          // Brut manquant entre enqueue et passage de processQueue (purge iOS
          // sous pression stockage, crash partiel, race). On ne peut PAS
          // recuperer cette photo -> log loud + bump lostCount + drop. Avant
          // le fix on droppait en silence -> l'utilisateur croyait que la
          // photo avait ete envoyee.
          console.error(`[process] LOST: id=${item.id} key=${item.key} (raw missing on disk at ${item.localUri})`);
          lostCountRef.current += 1;
          if (isMountedRef.current) setLostCount(lostCountRef.current);
          deleteSidecar(item.id);
          const cleaned = queueRef.current.filter(it => it.id !== item.id);
          await commitQueue(cleaned);
          continue;
        }

        // Mark processing pour que la boucle ne reprenne pas le meme item
        // au prochain tour (ceinture+bretelles avec processingRef).
        const beforeProcess = queueRef.current.map(it =>
          it.id === item.id ? { ...it, status: 'processing' } : it
        );
        await commitQueue(beforeProcess);

        // Calcule le label EXIF depuis sidecar (shutter / ISO / aperture).
        const sidecar = readSidecar(item.id);
        const exif = sidecar?.exif || {};
        const exposureSeconds = Number(exif.ExposureTime);
        const iso = Array.isArray(exif.ISOSpeedRatings) ? exif.ISOSpeedRatings[0] : exif.ISOSpeedRatings;
        const fnum = Number(exif.FNumber);
        const parts = [];
        if (Number.isFinite(exposureSeconds) && exposureSeconds > 0) {
          parts.push(`1/${Math.round(1 / exposureSeconds)}s`);
        }
        if (Number.isFinite(iso) && iso > 0) parts.push(`ISO ${iso}`);
        if (Number.isFinite(fnum) && fnum > 0) parts.push(`f/${fnum.toFixed(1)}`);
        const label = parts.join(' · ');

        // Burn natif vers processed/{id}.heic. Le natif gere sa propre serial
        // DispatchQueue : pas de pic memoire meme en cas d'enchainement rapide.
        ensurePendingDir();
        const dstFile = new File(processedDir(), `${item.id}.heic`);
        const srcPath = item.localUri.startsWith('file://') ? item.localUri.slice(7) : item.localUri;
        const dstPath = dstFile.uri.startsWith('file://') ? dstFile.uri.slice(7) : dstFile.uri;

        // exifJson = serialisation du sidecar EXIF (capture photo.metadata
        // au takePhoto). Passe au natif pour injection dans la EXIF box
        // HEIF sans recompression image, via CGImageDestinationAddImageFromSource
        // + Finalize (cf PhotoMetadataBurner.swift fast path). Si vide /
        // "{}" cote Swift -> fallback copie byte-pour-byte.
        const exifJson = JSON.stringify(exif || {});
        // Diag taille exifJson -> deplace cote Swift NSLog [WILL-CAM]
        // (debut de burnMetadata). console.log JS invisible en prod.
        try {
          if (label && NativeModules.PhotoMetadataBurner?.burnMetadata) {
            await NativeModules.PhotoMetadataBurner.burnMetadata(srcPath, dstPath, label, exifJson);
          } else if (NativeModules.PhotoMetadataBurner?.burnMetadata) {
            // Sidecar absent / EXIF vide : on burn quand meme (le natif tolere
            // un label vide -> juste enhance + reencode, badge omis).
            await NativeModules.PhotoMetadataBurner.burnMetadata(srcPath, dstPath, '', exifJson);
          } else {
            // Module natif absent (cas degrade dev / Expo Go) : on copie le
            // brut tel quel vers processed/ pour que drainQueue puisse l'envoyer.
            new File(item.localUri).copy(dstFile);
          }

          // Succes : delete brut + sidecar, flip processed=true, retries reset
          // (le compteur d'upload repart de zero), localUri pointe sur processed/.
          try { new File(item.localUri).delete(); } catch {}
          deleteSidecar(item.id);
          const afterProcess = queueRef.current.map(it =>
            it.id === item.id
              ? { ...it, processed: true, status: 'pending', retries: 0, nextAttemptAt: null, localUri: dstFile.uri }
              : it
          );
          await commitQueue(afterProcess);
        } catch (e) {
          // Echec burn : on traite comme un retry, backoff exponentiel via
          // nextRetryState (meme barreme que upload, MAX_RETRIES_DEFAULT).
          console.warn(`[process] burn failed ${item.id}: ${e?.message || e}`);
          addDebugLog(`[process] err ${item.id}: ${e?.message || e}`);
          const updated = nextRetryState(item, MAX_RETRIES_DEFAULT);
          const onErr = queueRef.current.map(it =>
            it.id === item.id ? { ...updated, processed: false } : it
          );
          await commitQueue(onErr);
        }
      }
    } catch (e) {
      console.warn('processQueue', e?.message);
    } finally {
      processingRef.current = false;
      // Si on a flip des items en processed:true, ils sont prets pour upload.
      drainQueue();
      // Reschedule un tick si un brut est en cooldown (retry burn).
      scheduleRetryTick();
    }
  }

  async function drainQueue() {
    if (drainingRef.current) return;
    if (!session?.token) return;

    // Gate réseau : on lit l'état NetInfo en synchrone via fetch sync (mais c'est async).
    // On utilise isOnline pour éviter un await coûteux. Si offline, on quitte direct.
    const state = await NetInfo.fetch().catch(() => null);
    const online = state ? (!!state.isConnected && state.isInternetReachable !== false) : isOnline;
    if (!online) return;

    drainingRef.current = true;
    try {
      const arr = [...queueRef.current];
      const now = Date.now();
      // 'failed' = max retries atteint -> on n'essaie plus automatiquement
      // (l'utilisateur peut retry manuellement). Pour 'pending', on respecte
      // le cooldown nextAttemptAt (backoff exponentiel).
      // processed===true uniquement : les bruts non traites sont gerees par
      // processQueue, jamais uploades tels quels.
      const uploadable = arr
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it.processed === true
          && it.status === 'pending'
          && (!it.nextAttemptAt || it.nextAttemptAt <= now));
      if (uploadable.length === 0) {
        drainingRef.current = false;
        scheduleRetryTick();
        return;
      }

      const verbose = !!eventConfig.debug?.verboseLogs;
      const maxRetries = eventConfig.upload?.maxRetries ?? MAX_RETRIES_DEFAULT;
      const uploadMode = eventConfig.upload?.mode || 'immediate';
      const batchSize = eventConfig.upload?.batchSize ?? 10;
      // mode 'wifi' : si Cellular, on défère
      if (uploadMode === 'wifi' && state?.type && state.type !== 'wifi') {
        if (verbose) console.log('[upload] mode=wifi, type=', state.type, '— on attend');
        drainingRef.current = false;
        return;
      }
      if (uploadMode === 'batch' && uploadable.length < batchSize) {
        if (verbose) console.log(`[upload] mode=batch, ${uploadable.length}/${batchSize} pending`);
        drainingRef.current = false;
        return;
      }

      if (verbose) {
        const m = `[upload] drain ${uploadable.length} items (online=${online})`;
        console.log(m); addDebugLog(m);
      }

      // Mémorise le total initial pour la progress bar du header.
      drainStartTotalRef.current = uploadable.length;
      if (isMountedRef.current) setDrainStartTotal(uploadable.length);

      // CONCURRENCY 3 : compromis entre debit utile (3 connexions saturent
      // un 4G/5G correct) et battery / thermal (4 workers en parallele
      // chauffent le NPU/CPU plus vite). Conforme au brief Phase 2.
      const CONCURRENCY = 3;
      let cursor = 0;
      // mark all as uploading upfront so UI reflète. MERGE-COMMIT (pas
      // overwrite) : on lit queueRef.current AU MOMENT DU COMMIT et on
      // patche uniquement les items qu'on traite par id -- jamais d'ecrasement
      // d'items ajoutes entre la prise du snapshot et ce commit (race window
      // microsecondes mais bulletproofing).
      for (const { i } of uploadable) arr[i] = { ...arr[i], status: 'uploading', nextAttemptAt: null };
      const uploadingIds = new Set(uploadable.map(({ it }) => it.id));
      const initialCommit = queueRef.current.map(it =>
        uploadingIds.has(it.id) ? { ...it, status: 'uploading', nextAttemptAt: null } : it
      );
      await commitQueue(initialCommit);

      async function worker() {
        while (cursor < uploadable.length) {
          const { i } = uploadable[cursor++];
          const item = arr[i];
          if (!item) continue;
          // sanity: file still there ?
          // Si le fichier processed (burned EXIF) a disparu entre
          // processQueue success commit et drainQueue, on ne peut PAS
          // uploader. Avant le fix on droppait en silence (warn gate par
          // verbose, off en prod) -> photo perdue invisible. Maintenant :
          // log loud + bump lostCount. La cause racine (burn natif qui
          // resout sans ecrire ? purge iOS ?) reste a investiguer mais
          // au moins le photographe la voit.
          let fileExists = false;
          try { fileExists = new File(item.localUri).exists; } catch {}
          if (!fileExists) {
            console.error(`[upload] LOST: id=${item.id} key=${item.key} (processed file missing at ${item.localUri})`);
            lostCountRef.current += 1;
            if (isMountedRef.current) setLostCount(lostCountRef.current);
            arr[i] = null;
            continue;
          }
          try {
            const blob = await (await fetch(item.localUri)).blob();
            const headers = {
              'Content-Type': item.isRaw ? 'image/x-adobe-dng' : 'image/jpeg',
              Authorization: `Bearer ${session.token}`,
            };
            if (item.race) headers['X-Will-Race'] = String(item.race);
            if (item.km) headers['X-Will-Km'] = String(item.km);
            const res = await fetch(`${API_URL}/${item.key}`, { method: 'PUT', headers, body: blob });
            if (res.ok) {
              // succès → delete fichier local + drop item + bump "Uploadees"
              // (verite R2 cote app : on n'incremente QUE sur PUT 200 OK).
              try { new File(item.localUri).delete(); } catch {}
              arr[i] = null;
              uploadedCountRef.current += 1;
              if (isMountedRef.current) setUploadedCount(uploadedCountRef.current);
              if (verbose) {
                const m = `[upload] OK ${item.id} (key=${item.key})`;
                console.log(m); addDebugLog(m);
              }
            } else {
              const updated = nextRetryState(item, maxRetries);
              const m = `[upload] HTTP ${res.status} ${item.id} -> retries=${updated.retries}, next=${updated.nextAttemptAt ?? 'never'}`;
              if (verbose) console.warn(m);
              addDebugLog(m);
              arr[i] = updated;
            }
          } catch (e) {
            const updated = nextRetryState(item, maxRetries);
            const m = `[upload] err ${item.id} -> retries=${updated.retries}: ${e?.message || e?.code || e}`;
            if (verbose) console.warn(m);
            addDebugLog(m);
            arr[i] = updated;
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }).map(() => worker()));
      // MERGE-COMMIT critique (la race destructive qu'on a chasse 5 fois) :
      // les workers ont awaited fetch pendant 500ms-2s. PENDANT ce temps,
      // captureBurstLoop a pu enqueuer de nouveaux items via commitQueue.
      // Si on ecrasait queueRef.current avec notre snapshot local `arr`
      // (post-workers), ces nouveaux items seraient WIPED silencieusement
      // -- AUCUN compteur ne le verrait. Le symptome 2-1-0-0 (Capt 2, Upload
      // 1, Attente 0, Perdues 0) etait exactement ca.
      //
      // Fix : on construit un delta {droppedIds, updatedById} depuis `arr`,
      // puis on l'applique sur queueRef.current LU MAINTENANT (qui peut
      // avoir grossi). Items ajoutes pendant le drain = preserves.
      const droppedIds = new Set();
      const updatedById = new Map();
      for (const { it: origItem, i: arrIdx } of uploadable) {
        const cur = arr[arrIdx];
        if (cur === null) {
          // Worker a uploaded OK (PUT 200) ou marque LOST (file missing).
          // Dans les deux cas le compteur a deja bumpe -> on retire de la queue.
          droppedIds.add(origItem.id);
        } else if (cur && cur !== origItem) {
          // Worker a update l'item (retry state 'pending' ou 'failed').
          updatedById.set(origItem.id, cur);
        }
      }
      const finalCommit = queueRef.current
        .filter(it => !droppedIds.has(it.id))
        .map(it => updatedById.has(it.id) ? updatedById.get(it.id) : it);
      await commitQueue(finalCommit);
    } catch (e) {
      console.warn('drainQueue', e?.message);
    } finally {
      drainingRef.current = false;
      drainStartTotalRef.current = 0;
      if (isMountedRef.current) setDrainStartTotal(0);
      // Re-trigger drain au plus proche cooldown : les retries 2/4/8s
      // partent sans attendre le heartbeat 30s ni un evt NetInfo.
      scheduleRetryTick();
    }
  }

  async function retryAllFailed() {
    const next = queueRef.current.map(it =>
      it.status === 'failed'
        ? { ...it, retries: 0, status: 'pending', nextAttemptAt: null }
        : it,
    );
    await commitQueue(next);
    drainQueue();
  }

  // Supprime un item de la queue + son fichier local. Pour les items 'failed'
  // que l'utilisateur veut éliminer définitivement.
  async function deleteQueueItem(id) {
    const target = queueRef.current.find(it => it.id === id);
    if (target) {
      try { new File(target.localUri).delete(); } catch {}
    }
    const next = queueRef.current.filter(it => it.id !== id);
    await commitQueue(next);
  }

  // Force l'upload d'un item : reset retries + status pending + cooldown,
  // puis trigger drain. Le reset de nextAttemptAt evite que l'item soit
  // skip par le filtre du worker si on est encore dans la fenetre 2/4/8s.
  async function forceUploadItem(id) {
    const next = queueRef.current.map(it =>
      it.id === id
        ? { ...it, retries: 0, status: 'pending', nextAttemptAt: null }
        : it,
    );
    await commitQueue(next);
    drainQueue();
  }

  function startSession() {
    isDetectionEnabledRef.current = true;
    setIsDetectionEnabled(true);
  }

  function stopSession() {
    isDetectionEnabledRef.current = false;
    setIsDetectionEnabled(false);
  }

  // Détection activée par défaut dès l'ouverture de l'écran photographe — la
  // capture button et le frame processor declenchent tous les deux captureOne().
  // Slide-in du header/footer au mount.
  useEffect(() => {
    startSession();
    Animated.parallel([
      Animated.timing(headerSlideY, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(footerSlideY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bouton Go/Stop : toggle de l'auto-capture.
  function onCapturePress() {
    const next = !isAutoArmedRef.current;
    isAutoArmedRef.current = next;
    setIsAutoArmed(next);
    console.log(`[auto] tap → armed=${next}`);
    Animated.sequence([
      Animated.timing(captureScale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(captureScale, { toValue: 1, tension: 180, friction: 7, useNativeDriver: true }),
    ]).start();
  }

  // Plafond max de photos par passage de coureur. Sécurité anti-boucle si un
  // visage reste planté dans la zone (photographe qui teste la caméra, ou
  // détection figée sans qu'on l'ait remarqué).
  const MAX_BURST_SHOTS = 15;

  // Cadence rafale pipelinée : on lance takePhoto SANS attendre la resolution
  // de la precedente. MAX_IN_FLIGHT borne le nombre de takePhoto AVFoundation
  // en vol simultanement. Avec speed mode, AVFoundation processe les captures
  // a ~5-7 ph/s sequentiellement sur le capteur quoi qu'il arrive : MAX_IN_FLIGHT
  // ne change PAS la cadence stable, il borne juste la RAM (~30 Mo par photo
  // en vol) et le nombre de captures deja engagees au moment ou le visage
  // sort (= parasites max). 3 est l'optimum : meme cadence qu'a 5, moitie
  // moins de parasites possibles a la sortie.
  const MAX_IN_FLIGHT = 3;

  // Cap dur du pipeline (queue persistante + in-flight). Au-dela, le burst
  // loop break -- on PREFERE rater 1 coureur a saturer la memoire. Le drain
  // ramene le total sous le seuil avant la rafale suivante.
  const MAX_TOTAL_IN_PIPELINE = 50;

  // Boucle de capture pipelinée (Palier 1, cf échange 2026-05-20).
  // Lance takePhoto SANS attendre la résolution : MAX_IN_FLIGHT captures
  // peuvent être engagées en parallèle côté AVFoundation. Le hardware traite
  // sérialement sur le capteur à ~5-7 ph/s en speed mode.
  //
  // Conditions d'arrêt :
  //   - faceInZoneRef passe à false (visage sorti de la zone)
  //   - plafond MAX_BURST_SHOTS atteint
  //   - backpressure : queue + in-flight >= MAX_TOTAL_IN_PIPELINE
  //   - démontage / désarmement / détection désactivée
  //
  // Défense anti-photo-parasite :
  //   - pre-shot guard : re-check faceInZoneRef juste avant chaque lancement
  //   - MAX_IN_FLIGHT borne le nombre de captures déjà engagées au moment
  //     d'une sortie (parasites max = MAX_IN_FLIGHT, irréductible car
  //     takePhoto n'est PAS annulable côté iOS)
  // Pire cas : MAX_IN_FLIGHT photos "parasites" si visage sort pile au
  // moment où on a saturé le pipeline.
  async function captureBurstLoop() {
    if (burstLoopRef.current) return;
    burstLoopRef.current = true;
    let shotsInBurst = 0;
    const burstStartedAt = Date.now();
    // burstTs partage par toutes les photos du burst (cf historique :
    // garantit unicite des cles R2 via {burstTs}_{idx}, et permet au
    // worker /personal-gallery de regrouper les freres d'un match Rekognition).
    const burstTs = burstStartedAt;
    try {
      while (
        faceInZoneRef.current &&
        shotsInBurst < MAX_BURST_SHOTS &&
        isMountedRef.current &&
        isAutoArmedRef.current &&
        isDetectionEnabledRef.current
      ) {
        // Pre-shot guard : re-check juste avant chaque lancement.
        if (!faceInZoneRef.current) break;

        // Backpressure dur : si le pipeline total (queue + in-flight) atteint
        // MAX_TOTAL_IN_PIPELINE, on stoppe la rafale -- on PREFERE rater 1
        // coureur a saturer la memoire. Le drain ramene le total sous le
        // seuil naturellement.
        const pipelineLoad = queueRef.current.length + inFlightSetRef.current.size;
        if (pipelineLoad >= MAX_TOTAL_IN_PIPELINE) {
          console.warn(`[burst] backpressure: pipeline=${pipelineLoad}/${MAX_TOTAL_IN_PIPELINE} — pause burst`);
          break;
        }

        // Throttle : si MAX_IN_FLIGHT takePhoto deja en vol, attendre qu'au
        // moins UN resolve avant d'en lancer un nouveau. AVFoundation processe
        // les captures sequentiellement sur le capteur, donc le wait est de
        // ~150-200 ms en speed mode.
        while (
          inFlightSetRef.current.size >= MAX_IN_FLIGHT &&
          faceInZoneRef.current &&
          isMountedRef.current
        ) {
          await Promise.race([...inFlightSetRef.current]);
        }
        if (!faceInZoneRef.current || !isMountedRef.current) break;

        // Launch SANS await : capture part en parallele. On enregistre la
        // promesse dans le set pour le suivi. updateInFlight bump le compteur
        // UI. Le .finally retire la promesse a la resolution (succes OU echec),
        // ce qui libere le slot in-flight pour la prochaine iteration.
        const p = captureOne({ burstTs, idx: shotsInBurst });
        inFlightSetRef.current.add(p);
        updateInFlight();
        p.finally(() => {
          inFlightSetRef.current.delete(p);
          updateInFlight();
        });
        shotsInBurst += 1;
      }
      const dt = Date.now() - burstStartedAt;
      const reason = !faceInZoneRef.current ? 'face-left-zone'
                   : shotsInBurst >= MAX_BURST_SHOTS ? 'max-burst-cap'
                   : (queueRef.current.length + inFlightSetRef.current.size) >= MAX_TOTAL_IN_PIPELINE ? 'backpressure'
                   : 'disarmed';
      console.log(`[burst] launched ${shotsInBurst} shots in ${dt}ms (${reason}), inFlight=${inFlightSetRef.current.size}`);
    } finally {
      burstLoopRef.current = false;
    }
  }

  // Capture single shot. Pipeline decouple (mai 2026) :
  //   takePhoto -> move vers raw/{id}.heic + sidecar JSON + enqueue
  //                  (gate isCapturingRef libere ici)
  //   processQueue (worker fond, serial)  -> enhance + burn + encode HEIC
  //   drainQueue (worker fond, online)    -> upload R2
  //
  // Sur le fil de capture on ne fait QUE le strict minimum pour libérer
  // le shutter le plus vite possible. Tout le traitement lourd est defere
  // a processQueue (PhotoMetadataBurner natif, serial DispatchQueue) pour
  // ne plus empiler plusieurs UIImage 4032x3024 en memoire en parallele
  // (cause du crash OOM constate lorsqu'un visage restait longtemps en zone).
  // burstCtx (optionnel) : { burstTs, idx } passé par captureBurstLoop pour
  // garantir des clés R2 uniques au sein du burst. Si null (appel hors burst,
  // e.g. shutter manuel futur), on retombe sur un "burst de 1" : burstTs = t0
  // frais, idx = 0. Compatible avec le schéma legacy.
  //
  // PAS DE GATE isCapturingRef ici : en mode burst pipeline, plusieurs
  // captureOne tournent en parallele jusqu'a MAX_IN_FLIGHT, la concurrency
  // est managee par captureBurstLoop. setIsShooting est centralise dans
  // updateInFlight (true ssi >=1 capture en vol).
  async function captureOne(burstCtx = null) {
    if (!cameraRef.current || !isMountedRef.current) return;
    if (!isDetectionEnabledRef.current) return;

    const t0 = Date.now();
    const burstTs = burstCtx?.burstTs ?? t0;
    const idx = burstCtx?.idx ?? 0;

    let photo = null;
    try {
      photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: false,
      });
      const dt = Date.now() - t0;
      let sizeKb = '?';
      try {
        const fpath = photo?.path?.startsWith('file://') ? photo.path : `file://${photo?.path}`;
        const sz = new File(fpath).size;
        if (typeof sz === 'number') sizeKb = Math.round(sz / 1024);
      } catch {}
      console.log(`[capture] takePhoto resolved ${sizeKb}kb in ${dt}ms`);
    } catch (e) {
      console.warn(`[capture] takePhoto FAILED: ${e?.message || String(e)}`);
    }

    if (!photo) return;

    let exif = null;
    try { exif = photo?.metadata?.['{Exif}'] || null; } catch {}
    // ISO post-capture supprime : la source de verite du voyant lumiere est
    // desormais le frame processor live (ExposureReaderPlugin), alimente en
    // continu des l'ouverture de la camera.

    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
    // photoKey hoisted HORS du try : sinon le catch (qui doit logger la cle
    // pour le LOST) n'y aurait pas acces (block-scoped const).
    const photoKey = `${session.event.code}/${session.photographer_id}/${dateStr}/${timeStr}_${burstTs}_${idx}.jpg`;
    try {
      await enqueueBurstItems([{
        key: photoKey,
        tempPath: photo.path,
        isRaw: false,
        burstTs,
        idx,
        race: selectedRace ? String(selectedRace.km) : null,
        km: selectedKm ? String(selectedKm) : null,
        exif,
      }]);
      capturedCountRef.current += 1;
      if (isMountedRef.current) setCapturedCount(capturedCountRef.current);
    } catch (e) {
      // Echec dans le chemin enqueue (move/copy/writeSidecar) -> photo
      // PERDUE entre takePhoto et la queue. Log loud + bump lostCount
      // pour que le photographe la voie. capturedCount n'est PAS
      // incremente (le compteur ne ment pas).
      console.error(`[capture] LOST: ${photoKey} reason="${e?.message || String(e)}"`);
      lostCountRef.current += 1;
      if (isMountedRef.current) setLostCount(lostCountRef.current);
    }
    // Pas de finally setIsShooting : centralise dans updateInFlight via
    // le .finally attache cote captureBurstLoop quand le slot in-flight
    // est retire du set. isCapturingRef supprime (mode burst pipeline).
  }

  if (!hasPermission) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: C.text, textAlign: 'center', marginBottom: 16 }}>Permission caméra requise</Text>
        <TouchableOpacity style={s.btnPrimary} onPress={requestPermission}>
          <Text style={s.btnPrimaryText}>Autoriser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: C.text, textAlign: 'center' }}>Caméra arrière indisponible</Text>
      </View>
    );
  }

  // Label statut affiché dans le header flottant.
  // État neutre / par défaut : PRÊT vert dès que la caméra est ouverte et online.
  // Capture rouge pendant rafale ; Hors ligne orange si offline.
  const statusInfo = isShooting
    ? { label: 'Capture', dot: '#EF4444', bg: 'rgba(239,68,68,0.2)', text: '#EF4444' }
    : !isOnline
      ? {
          label: queueStats.total > 0 ? `Hors ligne · ${queueStats.total}` : 'Hors ligne',
          dot: '#F59E0B', bg: 'rgba(245,158,11,0.2)', text: '#F59E0B',
        }
      : { label: 'Prêt', dot: '#22C55E', bg: 'rgba(34,197,94,0.2)', text: '#22C55E' };

  // Progression du drain courant : affichée sous le header pendant l'upload
  // si le batch initial dépassait 5 photos.
  const drainShowBar = drainStartTotal > 5 && queueStats.uploading > 0;
  const drainProgress = drainStartTotal > 0
    ? Math.max(0, Math.min(1, 1 - (queueStats.pending + queueStats.uploading) / drainStartTotal))
    : 0;

  // Voyant luminosite : pilote la couleur via le SHUTTER live (pas l'ISO).
  // Justification terrain (test 2026-05-26) : l'ISO reste a son plancher (50)
  // en interieur clair comme en exterieur, ne bouge qu'en vraie penombre —
  // inutile comme predicteur du flou. Le shutter est la donnee directe qui
  // determine si un sujet en mouvement sera fige.
  //
  // Label "Luminosite" (pas "Nettete") : techniquement on mesure le shutter,
  // qui est la cause directe du flou, mais le shutter rapide EST en pratique
  // la consequence de "il y a assez de lumiere". Pour un benevole non
  // photographe, "Luminosite faible/OK" est plus parlant que "Nettete" et
  // suggere implicitement l'action (chercher un emplacement plus eclaire).
  //
  // Attention sens des durees : shutter est en SECONDES, plus court = plus
  // rapide = mieux. 1/2000s (0.0005s) < 1/500s (0.002s) : 1/2000 est plus
  // rapide. Comparer les durees, pas les denominateurs.
  //
  // Seuils (a affiner terrain) :
  //   Vert  : <= 1/1000s (<= 0.001s) -> fige coureurs ET cyclistes
  //   Jaune : 1/1000 -- 1/500s       -> ok coureurs a pied, limite velos/rapides
  //   Rouge : >  1/500s  (>  0.002s) -> risque de flou de bouge
  //
  // Source : frame processor natif (ExposureReaderPlugin), ~1 Hz, mediane
  // sur ring buffer (~quelques secondes) pour eviter le clignotement.
  // Etat neutre (gris, "Luminosite —") tant que le natif n'a pas remonte de
  // shutter exploitable (camera qui ouvre, ou EXIF.ExposureTime absent).
  let lightDot = 'rgba(255,255,255,0.45)';
  let lightLabel = 'Luminosité —';
  const shutterSamples = liveExposureSamples
    .map(s => s.shutter)
    .filter(v => Number.isFinite(v) && v > 0);
  if (shutterSamples.length > 0) {
    const sorted = shutterSamples.sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    if (mid <= 0.001) { lightDot = '#22C55E'; lightLabel = 'Luminosité OK'; }
    else if (mid <= 0.002) { lightDot = '#FBBF24'; lightLabel = 'Luminosité moyenne'; }
    else { lightDot = '#F43F5E'; lightLabel = 'Luminosité faible'; }
  }

  // "En attente" = photos pas encore confirmees R2 PUT 200 mais qui vont
  // partir : captures en vol + items pending/uploading en queue. EXCLUT
  // les failed (qui apparaissent sur la ligne "X a renvoyer" si > 0 — c'est
  // une anomalie qui demande une action, pas un transit normal).
  const pendingCount = inFlight + queueStats.pending + queueStats.uploading;
  const cloudActive = pendingCount > 0;
  const cloudColor = cloudActive ? '#3B82F6' : 'rgba(255,255,255,0.85)';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Caméra — resizeMode 'contain' (letterbox naturel), bandes noires explicites par-dessus.
          La détection (frame processor) reste en coordonnées sensor : performance Rekognition inchangée. */}
      <VisionCamera
        ref={cameraRef}
        style={{
          position: 'absolute',
          top: CAMERA_TOP,
          left: 0, right: 0,
          height: previewH,
        }}
        device={device}
        format={format}
        isActive={true}
        // video=true pour le frame processor (detection humains Apple Vision).
        // photo=true + photoQualityBalance="speed" : AVCapturePhotoOutput skip
        // Deep Fusion + Night mode -> capture en 80-200 ms au lieu de 300-800 ms.
        // Trade-off : qualite legerement degradee en faible lumiere, mais
        // excellente en plein jour (capteur 12 MP + ISP basique). Choix global
        // pour soutenir la cadence rafale pipelinee (5-7 photos/s).
        // Les 2 outputs coexistent sur la meme AVCaptureSession.
        video={true}
        photo={true}
        photoQualityBalance="speed"
        // HDR active si le format wide actif le supporte. Restaure les
        // contrastes ecrases dans la preview (contre-jour sportif) +
        // ameliore la photo HEIC/HDR-10 a la capture.
        photoHdr={!!format?.supportsPhotoHdr}
        videoHdr={!!format?.supportsVideoHdr}
        // Low-light boost iOS : gros gain en faible lumiere sans monter
        // le bruit ISO.
        lowLightBoost={!!device?.supportsLowLightBoost}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        zoom={device.minZoom}
        resizeMode="contain"
        videoStabilizationMode={videoStabilizationMode}
        exposure={cameraExposure}
        enableLocation={false}
      />

      {/* Guides zone de capture (lignes verticales discretes au centre).
          Caches a 100% (toute la frame est active). */}
      {(eventConfig.camera?.captureZoneWidthPercent ?? 30) < 100 && (() => {
        const zoneW = (eventConfig.camera?.captureZoneWidthPercent ?? 30) / 100;
        const leftPct = (1 - zoneW) / 2 * 100;
        const rightPct = (1 + zoneW) / 2 * 100;
        return (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: CAMERA_TOP, height: previewH, left: 0, right: 0 }}
          >
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${leftPct}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${rightPct}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.3)' }} />
          </View>
        );
      })()}

      {/* ─── FLASH RAFALE (full-screen, blanc, 120ms) ─── */}
      <Animated.View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: '#fff',
          opacity: flashOpacity,
        }}
      />

      {/* ─── TOP AREA (style iOS Camera : dark gradient + floating row, pas de boîte) ─── */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 56, paddingBottom: 8, paddingHorizontal: 20,
          transform: [{ translateY: headerSlideY }],
          zIndex: 10,
        }}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        {/* Row 1 : retour | titre+date centré | spacer */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={onExit || onLogout}
            hitSlop={10}
            style={{
              paddingHorizontal: 14, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M19 12H5M12 19l-7-7 7-7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
            <Text
              style={{
                color: '#fff', fontSize: 18, fontWeight: '700',
                fontFamily: 'AVEstiana', fontStyle: 'normal',
                textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
              }}
              numberOfLines={1}
            >
              {session?.event?.name || 'Événement'}
            </Text>
            {session?.event?.event_date ? (
              <Text
                style={{
                  color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1,
                  textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
                }}
                numberOfLines={1}
              >
                {formatDateLong(session.event.event_date, session.event.event_date_end)}
              </Text>
            ) : null}
          </View>

          {/* Cluster a droite : Deconnexion. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Se déconnecter ?',
                  'Tu devras saisir à nouveau le mot de passe pour reprendre ton événement.',
                  [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Déconnexion', style: 'destructive', onPress: onLogout },
                  ],
                  { cancelable: true }
                );
              }}
              hitSlop={10}
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.12)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M12 2v10" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
                <Path d="M5.64 7.05A9 9 0 1 0 18.36 7.05" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        </View>

        {/* Status bar refondue (2026-05-26) : 1 seule ligne horizontale,
            edge-to-edge (marginHorizontal negatif pour casser le padding 20 du
            parent et s'aligner sur la largeur du bouton Stop ci-dessous).
            3 infos compactes separees par " · " :
              [voyant lumiere]  ·  [N sauvegardees]  ·  [N en attente]
            - Lumiere : voyant ISO live (frame processor natif, source de
              verite des l'ouverture camera, AVANT toute capture).
            - Sauvegardees : uploadedCount, incremente UNIQUEMENT sur PUT 200
              OK confirme par R2.
            - En attente : captures en vol + queue pending/uploading. EXCLUT
              les failed (qui restent sur la ligne orange "X a renvoyer" si > 0,
              car c'est une anomalie qui demande une action — pas un transit).
            Compteurs internes (capturedCount, inFlight, queueStats, lostCount)
            restent calcules pour la logique drain/debug, plus affiches ici. */}
        <View style={{
          marginTop: 8,
          marginHorizontal: -20,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Voyant lumiere */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: lightDot,
            }} />
            <Text style={{
              color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600',
              letterSpacing: 0.3,
              textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
            }}>
              {lightLabel}
            </Text>
          </View>

          {/* Separateur */}
          <Text style={{
            color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600',
            marginHorizontal: 10,
            textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
          }}>·</Text>

          {/* Sauvegardees (cloud + compteur, toujours visible) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path
                d="M17.5 19a4.5 4.5 0 00.5-8.97 6 6 0 00-11.62-1.5A4.5 4.5 0 006.5 19h11z"
                stroke={cloudColor}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={cloudActive ? 'rgba(59,130,246,0.18)' : 'none'}
              />
            </Svg>
            <Text style={{
              color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600',
              letterSpacing: 0.3,
              textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
            }}>
              {uploadedCount} sauvegardée{uploadedCount > 1 ? 's' : ''}
            </Text>
          </View>

          {/* Separateur */}
          <Text style={{
            color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600',
            marginHorizontal: 10,
            textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
          }}>·</Text>

          {/* En attente (transit normal, toujours visible) */}
          <Text style={{
            color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600',
            letterSpacing: 0.3,
            textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
          }}>
            {pendingCount} en attente
          </Text>
        </View>

        {/* Debug readout (preview/dev only) : derniere mesure live brute du
            frame processor — ISO + shutter effectif + EV. Sert au diagnostic
            terrain "pourquoi cette photo est floue" : shutter cape a 1/30s
            sur preview 30 fps + ISO qui grimpe = scene trop sombre, flou de
            mouvement imminent. Aucun affichage en production (gated par
            IS_PREVIEW_OR_DEV). */}
        {IS_PREVIEW_OR_DEV && liveExposureSamples.length > 0 && (() => {
          const last = liveExposureSamples[liveExposureSamples.length - 1];
          return (
            <Text style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '600',
              textAlign: 'center', marginTop: 4, letterSpacing: 0.4,
              fontVariant: ['tabular-nums'],
              textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
            }}>
              ISO {Math.round(last.iso)}  ·  {formatShutter(last.shutter)}  ·  {formatEV(last.brightness)}
            </Text>
          );
        })()}

        {/* Filet de securite : n'apparait QUE si une photo est bloquee (failed
            apres retries ou perdue dans le pipeline). Anomalie qui demande
            une action, garde ce filet rouge orange pour ne pas etre noyee
            dans la ligne neutre du transit normal. */}
        {(lostCount + queueStats.failed) > 0 && (
          <Text style={{
            color: '#FB923C', fontSize: 11, fontWeight: '700',
            letterSpacing: 0.3, textAlign: 'center', marginTop: 4,
            textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
          }}>
            {lostCount + queueStats.failed} à renvoyer
          </Text>
        )}

        {/* Progress bar : visible quand un drain en cours porte sur > 5 photos. */}
        {drainShowBar && (
          <View style={{ marginTop: 8, paddingHorizontal: 40 }}>
            <View style={{
              height: 3, borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.18)',
              overflow: 'hidden',
            }}>
              <View style={{
                width: `${Math.round(drainProgress * 100)}%`,
                height: '100%',
                backgroundColor: '#22C55E',
                borderRadius: 2,
              }} />
            </View>
            <Text style={{
              color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '600',
              textAlign: 'center', marginTop: 4, letterSpacing: 0.3,
            }}>
              {Math.round(drainProgress * drainStartTotal)} / {drainStartTotal} envoyées
            </Text>
          </View>
        )}
      </Animated.View>

      {/* ─── BOTTOM AREA : footer noir compact, layout vertical en 2 rows (chips / shutter).
          - Outer Animated.View : positionnement absolu + slide d'entrée
          - Inner panel : bg #000 solide, padding 16/12/36 (safe area), gap 14 entre rows
          - Row 1 : chips course dans un container à contour blanc, taille auto centrée
          - Row 2 : [Pill Zoom 90] / [Bouton Go 140×60] / [Pill KM 90] avec space-between
          Aucun wrapper sans dimension explicite — chaque élément a width fixe pour
          garantir que Go! reste entièrement visible. ─── */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          transform: [{ translateY: footerSlideY }],
          zIndex: 10,
        }}
      >
        <View style={{
          paddingHorizontal: 16,
          paddingTop: 0,
          paddingBottom: 36,
          backgroundColor: '#000',
          // Étend le panneau vers le haut jusqu'au bas de la caméra : sans ça,
          // l'espace entre camera_bottom et inner_top est aussi noir (parent bg)
          // mais Go! reste en bas de cette zone — visuellement il semble décalé.
          minHeight: Math.max(0, winH - (CAMERA_TOP + previewH)),
        }}>
          {/* Row 1 : bandeau Go!/Stop — top aligné strictement avec le haut du panneau noir */}
          <TouchableOpacity
            onPress={onCapturePress}
            activeOpacity={0.9}
            style={{
              height: 60,
              marginHorizontal: -16,
              marginTop: 0,
              backgroundColor: isAutoArmed ? '#FF3B30' : C.pinkPillActive,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{
              color: '#fff',
              fontSize: 22,
              fontStyle: 'italic',
              fontWeight: '800',
              fontFamily: 'AVEstiana',
              letterSpacing: 1,
            }}>{isAutoArmed ? 'Stop' : 'Go!'}</Text>
          </TouchableOpacity>

          {/* Row 2 : bandeau 2 sections (COURSE / KM) collé au Go!, edge-to-edge.
              Quand une section est active, la roulette REMPLACE le texte de cette cellule. */}
          <View style={{
            flexDirection: 'row',
            marginTop: 0,
            marginHorizontal: -16,
            backgroundColor: '#000',
            alignItems: 'stretch',
          }}>
            {/* Section COURSE (gauche, 50%) — label + roulette 3-items toujours visible */}
            {(() => {
              const courseItems = [{ label: 'Toutes', value: null }, ...distances.map(d => ({ label: `${d.km} km`, value: d }))];
              const rawIdx = courseItems.findIndex(it => (it.value?.km ?? null) === (selectedRace?.km ?? null));
              const courseIdx = rawIdx >= 0 ? rawIdx : 0;
              const setCourseIdx = (idx) => {
                const v = courseItems[idx].value;
                setSelectedRace(v);
                if (v && selectedKm > Math.ceil(parseFloat(v.km) || 0)) setSelectedKm(0);
              };
              return (
                <View style={{ flex: 1, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 10, alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => setSelectedRace(null)} hitSlop={6} activeOpacity={0.7} style={{ zIndex: 2, marginBottom: -16 }}>
                    <Text style={{
                      color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5,
                      fontFamily: 'AVEstiana', fontStyle: 'normal',
                    }}>Course</Text>
                  </TouchableOpacity>
                  <OverlayWheel
                    items={courseItems}
                    selectedIndex={courseIdx}
                    onChange={setCourseIdx}
                  />
                </View>
              );
            })()}

            {/* Separator vertical entre les 2 sections */}
            <View style={{ width: 0.5, backgroundColor: 'rgba(255,255,255,0.15)' }} />

            {/* Section KM (droite, 50%) — label + roulette 3-items toujours visible */}
            {(() => {
              const kmItems = Array.from({ length: kmCeiling + 1 }).map((_, k) => ({ label: `${k} km`, value: k }));
              return (
                <View style={{ flex: 1, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 10, alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => setSelectedKm(0)} hitSlop={6} activeOpacity={0.7} style={{ zIndex: 2, marginBottom: -16 }}>
                    <Text style={{
                      color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5,
                      fontFamily: 'AVEstiana', fontStyle: 'normal',
                    }}>Km</Text>
                  </TouchableOpacity>
                  <OverlayWheel
                    items={kmItems}
                    selectedIndex={selectedKm}
                    onChange={setSelectedKm}
                  />
                </View>
              );
            })()}
          </View>

        </View>
      </Animated.View>

    </View>
  );
}


const formSectionStyle = StyleSheet.create({
  heading: { fontSize: 13, fontWeight: '700', color: C.textSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  input: { backgroundColor: '#faf9ff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, marginBottom: 8 },
});

// Modal de cadrage 2:1 custom (la card mobile est 4:1 mais l'image occupe la
// moitié droite seulement, soit 2:1). iOS ignore aspect:[2,1] dans son cropper
// natif, donc on affiche l'image complète avec un cadre 2:1 superposé que
// l'utilisateur positionne via pan + pinch gestures, puis on crop via
// expo-image-manipulator.
function CropImageModal({ visible, asset, onCancel, onConfirm }) {
  const screenW = Dimensions.get('window').width;
  const FRAME_W = screenW - 32;
  const FRAME_H = FRAME_W / 2;

  const srcAspect = asset && asset.height ? asset.width / asset.height : 1;
  const FRAME_ASPECT = 2;
  let baseW, baseH;
  if (srcAspect >= FRAME_ASPECT) {
    baseH = FRAME_H;
    baseW = FRAME_H * srcAspect;
  } else {
    baseW = FRAME_W;
    baseH = FRAME_W / srcAspect;
  }

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && asset) {
      tx.value = 0; savedTx.value = 0;
      ty.value = 0; savedTy.value = 0;
      scale.value = 1; savedScale.value = 1;
    }
  }, [visible, asset?.uri]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      const txMax = Math.max(0, (baseW * scale.value - FRAME_W) / 2);
      const tyMax = Math.max(0, (baseH * scale.value - FRAME_H) / 2);
      const clampedTx = Math.max(-txMax, Math.min(txMax, tx.value));
      const clampedTy = Math.max(-tyMax, Math.min(tyMax, ty.value));
      if (tx.value !== clampedTx) tx.value = withTiming(clampedTx, { duration: 180 });
      if (ty.value !== clampedTy) ty.value = withTiming(clampedTy, { duration: 180 });
      savedTx.value = clampedTx;
      savedTy.value = clampedTy;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(4, Math.max(1, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const txMax = Math.max(0, (baseW * scale.value - FRAME_W) / 2);
      const tyMax = Math.max(0, (baseH * scale.value - FRAME_H) / 2);
      const clampedTx = Math.max(-txMax, Math.min(txMax, tx.value));
      const clampedTy = Math.max(-tyMax, Math.min(tyMax, ty.value));
      if (tx.value !== clampedTx) tx.value = withTiming(clampedTx, { duration: 180 });
      if (ty.value !== clampedTy) ty.value = withTiming(clampedTy, { duration: 180 });
      savedTx.value = clampedTx;
      savedTy.value = clampedTy;
    });

  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const doConfirm = async () => {
    if (!asset || busy) return;
    setBusy(true);
    try {
      const ratio = asset.width / baseW;
      const widthInSrc = (FRAME_W * ratio) / scale.value;
      const heightInSrc = (FRAME_H * ratio) / scale.value;
      const centerX = asset.width / 2 - (tx.value * ratio) / scale.value;
      const centerY = asset.height / 2 - (ty.value * ratio) / scale.value;
      const originX = Math.max(0, Math.round(centerX - widthInSrc / 2));
      const originY = Math.max(0, Math.round(centerY - heightInSrc / 2));
      const width = Math.max(1, Math.min(asset.width - originX, Math.round(widthInSrc)));
      const height = Math.max(1, Math.min(asset.height - originY, Math.round(heightInSrc)));
      const out = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      onConfirm(out);
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Impossible de cadrer l\'image');
    } finally {
      setBusy(false);
    }
  };

  if (!asset) return null;

  const overlayBg = 'rgba(0,0,0,0.6)';
  const vMargin = stageSize.h > 0 ? (stageSize.h - FRAME_H) / 2 : 0;
  const hMargin = stageSize.w > 0 ? (stageSize.w - FRAME_W) / 2 : 0;

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={{ paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Cadrer l'image (2:1)</Text>
            <Text style={{ color: '#bbb', fontSize: 12, marginTop: 4 }}>Glisse pour déplacer · pince pour zoomer</Text>
          </View>

          <GestureDetector gesture={composed}>
            <View
              style={{ flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}
              onLayout={(e) => setStageSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            >
              <ReAnimated.Image
                source={{ uri: asset.uri }}
                style={[{ width: baseW, height: baseH }, animStyle]}
                resizeMode="cover"
              />
              {stageSize.w > 0 ? (
                <>
                  <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vMargin, backgroundColor: overlayBg }} />
                  <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: vMargin, backgroundColor: overlayBg }} />
                  <View pointerEvents="none" style={{ position: 'absolute', top: vMargin, left: 0, width: hMargin, height: FRAME_H, backgroundColor: overlayBg }} />
                  <View pointerEvents="none" style={{ position: 'absolute', top: vMargin, right: 0, width: hMargin, height: FRAME_H, backgroundColor: overlayBg }} />
                  <View pointerEvents="none" style={{ position: 'absolute', top: vMargin, left: hMargin, width: FRAME_W, height: FRAME_H, borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)' }} />
                </>
              ) : null}
            </View>
          </GestureDetector>

          <View style={{ flexDirection: 'row', padding: 20, gap: 12 }}>
            <TouchableOpacity onPress={onCancel} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#555', alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={doConfirm} disabled={busy} style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{busy ? 'Traitement…' : 'Valider le cadrage'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Sous-modale slide-up reutilisable pour editer 1 champ texte (nom, email,
// telephone, site web). Auto-focus a l'ouverture, KeyboardAvoidingView pour
// que le bouton Enregistrer reste visible. Save par section via onSave.
function SubModalInputText({ visible, title, value, onChangeText, placeholder, keyboardType, autoCapitalize, secureTextEntry, onClose, onSave, busy }) {
  // Suivi manuel de la hauteur clavier : KeyboardAvoidingView est peu fiable
  // sur iOS dans une Modal (encore moins avec presentationStyle). On applique
  // un paddingBottom dynamique au container du bouton Enregistrer pour qu'il
  // reste toujours au-dessus du clavier.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!visible) { setKbHeight(0); return; }
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sh = Keyboard.addListener(showName, e => setKbHeight(e?.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideName, () => setKbHeight(0));
    return () => { sh.remove(); hd.remove(); };
  }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
        <View style={{
          paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
          backgroundColor: '#fff',
        }}>
          <View style={{ width: 60 }} />
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
            <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12 }} keyboardShouldPersistTaps="handled">
          <TextInput
            value={value || ''}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor="#9CA3AF"
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            secureTextEntry={!!secureTextEntry}
            style={{
              fontSize: 17, color: C.text,
              paddingVertical: 14, paddingHorizontal: 16,
              backgroundColor: '#fff', borderRadius: 14,
              marginHorizontal: 16,
            }}
            autoFocus
          />
        </ScrollView>
        <View style={{ paddingBottom: kbHeight }}>
          <TouchableOpacity
            onPress={onSave}
            disabled={busy}
            style={{
              marginHorizontal: 16, marginBottom: kbHeight > 0 ? 12 : 28,
              paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// CalendarRangeModal — picker calendrier custom (sans dépendance externe).
// Mode plage : 1er tap = début, 2e tap = fin. Si le 2e tap est < début, la
// sélection redémarre depuis ce jour. Même jour tapé deux fois ⇒ event 1 jour
// (end === start). Le grid affiche 6 semaines × 7 jours commençant un lundi
// pour rester proche du Calendrier iOS / dashboard.
function CalendarRangeModal({ visible, onClose, initialStart, initialEnd, minDate, onConfirm }) {
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const minD = useMemo(() => {
    if (!minDate) return null;
    const d = new Date(minDate); d.setHours(0, 0, 0, 0); return d;
  }, [minDate]);
  const initialView = initialStart || today;
  const [viewYear, setViewYear] = useState(initialView.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialView.getMonth());
  const [start, setStart] = useState(initialStart ? new Date(initialStart) : null);
  const [end, setEnd] = useState(initialEnd ? new Date(initialEnd) : null);

  useEffect(() => {
    if (visible) {
      const init = initialStart || today;
      setViewYear(init.getFullYear());
      setViewMonth(init.getMonth());
      setStart(initialStart ? new Date(initialStart) : null);
      setEnd(initialEnd ? new Date(initialEnd) : null);
    }
  }, [visible]);

  const monthDays = useMemo(() => {
    // 6 rangées × 7 jours en partant du lundi précédent le 1er du mois.
    const first = new Date(viewYear, viewMonth, 1);
    const firstWeekday = (first.getDay() + 6) % 7; // 0=Lun ... 6=Dim
    const grid = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(viewYear, viewMonth, 1 - firstWeekday + i);
      d.setHours(0, 0, 0, 0);
      grid.push(d);
    }
    return grid;
  }, [viewYear, viewMonth]);

  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isCurrentMonth = (d) => d.getMonth() === viewMonth;
  const isBeforeMin = (d) => minD && d < minD;

  const onTapDay = (d) => {
    if (isBeforeMin(d) || !isCurrentMonth(d)) return;
    const dn = new Date(d); dn.setHours(0, 0, 0, 0);
    if (!start || (start && end)) {
      // Nouvelle sélection
      setStart(dn); setEnd(null);
      return;
    }
    // start déjà défini, end pas encore.
    if (sameDay(dn, start)) {
      // Tap deux fois sur le même jour ⇒ event 1 jour (end === start).
      setEnd(dn);
      return;
    }
    if (dn < start) {
      // Redémarre la sélection depuis le 2e tap.
      setStart(dn); setEnd(null);
    } else {
      setEnd(dn);
    }
  };

  const goPrev = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const goNext = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const canConfirm = !!start;
  const isSingle = start && (!end || sameDay(start, end));
  const handleConfirm = () => {
    if (!start) return;
    onConfirm(start, isSingle ? null : end);
    onClose();
  };

  const monthRaw = new Date(viewYear, viewMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const monthLabel = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);

  const summary = (() => {
    if (!start) return 'Tape un jour pour commencer';
    if (!end) return `Début : ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · tape un 2e jour pour finir (ou le même pour 1 jour)`;
    return formatDateForForm(start.toISOString().slice(0, 10), sameDay(start, end) ? null : end.toISOString().slice(0, 10));
  })();

  // Cell renderer factorisé : on sépare le fill (bar pale violet) du dot (cercle
  // primary), pour rendre les bords du range proprement. On gate sur inMonth pour
  // ne pas tracer la range sur les jours grisés du mois adjacent.
  const renderCell = (d, idx) => {
    const inMonth = isCurrentMonth(d);
    const disabled = !inMonth || isBeforeMin(d);
    const isStart = inMonth && sameDay(d, start);
    const isEnd = inMonth && sameDay(d, end);
    const hasRange = start && end && !sameDay(start, end);
    const inMiddle = inMonth && hasRange && d > start && d < end;
    const showLeftBar = inMonth && hasRange && (inMiddle || (isEnd && !isStart));
    const showRightBar = inMonth && hasRange && (inMiddle || (isStart && !isEnd));
    const isEdge = isStart || isEnd;
    return (
      <TouchableOpacity
        key={idx}
        onPress={() => onTapDay(d)}
        disabled={disabled}
        activeOpacity={0.7}
        style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' }}
      >
        {showLeftBar ? (
          <View style={{ position: 'absolute', top: 6, bottom: 6, left: 0, right: '50%', backgroundColor: '#EDE5FF' }} />
        ) : null}
        {showRightBar ? (
          <View style={{ position: 'absolute', top: 6, bottom: 6, left: '50%', right: 0, backgroundColor: '#EDE5FF' }} />
        ) : null}
        {isEdge ? (
          <View style={{ position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary }} />
        ) : null}
        <Text style={{
          color: disabled ? '#cfcadd' : isEdge ? '#fff' : (showLeftBar || showRightBar) ? C.text : C.text,
          fontWeight: isEdge ? '700' : '500',
          fontSize: 14,
        }}>
          {d.getDate()}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <TouchableOpacity onPress={goPrev} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f5f3ff' }}>
              <Text style={{ fontSize: 22, color: C.primary, marginTop: -2 }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{monthLabel}</Text>
            <TouchableOpacity onPress={goNext} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#f5f3ff' }}>
              <Text style={{ fontSize: 22, color: C.primary, marginTop: -2 }}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', marginBottom: 2 }}>
            {['L','M','M','J','V','S','D'].map((d, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, fontWeight: '700' }}>{d}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: 6 }).map((_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {monthDays.slice(row * 7, row * 7 + 7).map((d, i) => renderCell(d, `${row}-${i}`))}
            </View>
          ))}
          <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', marginTop: 14, paddingHorizontal: 4, lineHeight: 17 }}>
            {summary}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f5f3ff' }}>
              <Text style={{ color: C.primary, fontSize: 15, fontWeight: '700' }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirm} disabled={!canConfirm} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill, opacity: canConfirm ? 1 : 0.5 }}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Helpers PIN photographe (4 chiffres). Centralise la generation aleatoire
// et la validation pour eviter les divergences entre wizard / edition / login.
const PIN_REGEX = /^\d{4}$/;
const isValidPin = (v) => PIN_REGEX.test(String(v || ''));
const generateRandomPin = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');

// Composant input PIN : 4 cases numeriques separees, auto-focus + auto-advance.
// Utilise dans le wizard de creation (step 4), l'edition drill-down, et le
// login photographe. La prop `autoSubmit` declenche onComplete quand la
// derniere case est remplie (cas login).
function PinInputRow({ value, onChange, onComplete, autoFocus = true, focusTrigger = 0, error = false, size = 'lg' }) {
  const inputs = useRef([null, null, null, null]);
  const digits = String(value || '').padEnd(4, ' ').split('').slice(0, 4).map(c => c === ' ' ? '' : c);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputs.current[0]?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // focusTrigger : bumpe par le parent pour reposer le focus sur la 1ere case
  // (ex: passage a l'etape PIN du wizard, ou re-affichage du modal d'edition).
  useEffect(() => {
    if (focusTrigger > 0) {
      const t = setTimeout(() => inputs.current[0]?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (!error) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [error, shake]);

  const setDigitAt = (i, raw) => {
    const d = String(raw || '').replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = d;
    const joined = next.join('').slice(0, 4);
    onChange(joined);
    if (d && i < 3) inputs.current[i + 1]?.focus();
    if (joined.length === 4 && /^\d{4}$/.test(joined) && onComplete) {
      setTimeout(() => onComplete(joined), 80);
    }
  };

  const onKeyPress = (i, e) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
      const next = [...digits];
      next[i - 1] = '';
      onChange(next.join(''));
    }
  };

  const boxW = size === 'lg' ? 60 : 52;
  const boxH = size === 'lg' ? 68 : 60;
  const fontSize = size === 'lg' ? 30 : 26;

  return (
    <Animated.View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, transform: [{ translateX: shake }] }}>
      {[0, 1, 2, 3].map(i => {
        const filled = !!digits[i];
        return (
          <TextInput
            key={i}
            ref={r => (inputs.current[i] = r)}
            value={digits[i]}
            onChangeText={v => setDigitAt(i, v)}
            onKeyPress={e => onKeyPress(i, e)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
            textContentType="oneTimeCode"
            style={{
              width: boxW, height: boxH,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: error ? '#DC2626' : (filled ? C.primary : '#e8defc'),
              backgroundColor: filled ? '#faf9ff' : '#fff',
              fontSize, fontWeight: '700',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              color: C.primary,
              textAlign: 'center',
            }}
          />
        );
      })}
    </Animated.View>
  );
}

// Pour l'affichage en lecture seule (detail event, masque/reveal) : 4 chiffres
// gros, espaces, monospace violet.
function PinDisplay({ pin, masked = true }) {
  const valid = isValidPin(pin);
  const chars = valid ? String(pin).split('') : ['', '', '', ''];
  const display = masked ? ['•', '•', '•', '•'] : chars;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {display.map((c, i) => (
        <Text
          key={i}
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 28, fontWeight: '700',
            color: valid ? C.primary : C.textSoft,
            minWidth: 22, textAlign: 'center',
          }}
        >
          {valid ? c : '—'}
        </Text>
      ))}
    </View>
  );
}

function CreateEventModal({ visible, onClose, onCreated, organizerSession, editEvent }) {
  const isEdit = !!editEvent;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [eventDate, setEventDate] = useState(null); // Date object | null
  const [eventDateEnd, setEventDateEnd] = useState(null); // Date object | null (null ⇒ event 1 jour)
  const [showCalendar, setShowCalendar] = useState(false);
  const [startTime, setStartTime] = useState(''); // "HH:MM"
  const [photographerPwd, setPhotographerPwd] = useState('');
  const [revealPwd, setRevealPwd] = useState(false);
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [eventType, setEventType] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [distances, setDistances] = useState([]); // [{km, time, elevation}]
  const [timePickerIdx, setTimePickerIdx] = useState(null);
  const [elevPickerIdx, setElevPickerIdx] = useState(null);
  const [kmPickerIdx, setKmPickerIdx] = useState(null);
  const [coverImage, setCoverImage] = useState(null); // URL distante après upload
  const [pendingCoverLocal, setPendingCoverLocal] = useState(null); // URI locale pendant la création (pas encore d'event)
  const [coverBusy, setCoverBusy] = useState(false);
  const [cropAsset, setCropAsset] = useState(null); // asset {uri,width,height} → ouvre CropImageModal
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [sheetW, setSheetW] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const [userEditedCode, setUserEditedCode] = useState(false);
  const [showErr, setShowErr] = useState({ 1: false, 2: false, 3: false, 4: false });
  // Mode edition style "iOS Settings drill-down" : la home liste les sections,
  // tap sur une row ouvre une sous-modale dediee avec save par section
  // (PUT partiel via la whitelist worker).
  const [editingField, setEditingField] = useState(null);
  const [partialBusy, setPartialBusy] = useState(false);
  // Hauteur du clavier pour ajuster les sub-modales d'edition (Lieu, Distances)
  // ou KeyboardAvoidingView n'est pas fiable sur iOS avec une Modal RN.
  const [editKbHeight, setEditKbHeight] = useState(0);
  useEffect(() => {
    if (!isEdit || !editingField) { setEditKbHeight(0); return; }
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sh = Keyboard.addListener(showName, e => setEditKbHeight(e?.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideName, () => setEditKbHeight(0));
    return () => { sh.remove(); hd.remove(); };
  }, [isEdit, editingField]);

  const parseLocation = (loc = '') => {
    // Format attendu: "Louviers (27400)" ou "Louviers (27)"
    const m = String(loc).match(/^(.+?)\s*\((\d{2,5})\)\s*$/);
    if (m) {
      const city = m[1].trim();
      const code = m[2];
      // Si c'est un code de département (2 chiffres), on n'a pas le code postal complet
      if (code.length === 5) return { city, postalCode: code };
      return { city, postalCode: '' };
    }
    return { city: loc, postalCode: '' };
  };

  useEffect(() => {
    if (visible) {
      setStep(1);
      setShowErr({ 1: false, 2: false, 3: false, 4: false });
      slideX.setValue(0);
      setUserEditedCode(false);
      setEditingField(null);
      if (isEdit) {
        setName(editEvent.name || '');
        setCode(editEvent.code || '');
        setPassword('');
        setEventDate(editEvent.event_date ? new Date(editEvent.event_date) : null);
        setEventDateEnd(editEvent.event_date_end ? new Date(editEvent.event_date_end) : null);
        setStartTime(editEvent.start_time || '');
        setPhotographerPwd(editEvent.photographer_password || '');
        setRevealPwd(false);
        const { city: cy, postalCode: pc } = parseLocation(editEvent.location || '');
        setPostalCode(pc); setCity(cy); setCitySuggestions([]);
        setEventType(editEvent.event_type || '');
        setWebsite(editEvent.website || '');
        // Fallback en cascade : contact (email saisi à la creation) -> email orga -> ''.
        // organizerSession est structuré { token, profile } — l'email est sous profile.
        setContact(editEvent.contact || organizerSession?.profile?.email || '');
        setPhone(editEvent.phone || '');
        setDistances(Array.isArray(editEvent.distances) ? editEvent.distances.map(d => ({
          km: String(d.km || ''), time: d.time || '', elevation: d.elevation || '',
        })) : []);
        setCoverImage(editEvent.cover_image || null);
        setPendingCoverLocal(null);
      } else {
        setName(''); setCode(''); setPassword('');
        setEventDate(null); setEventDateEnd(null);
        setStartTime(''); setPhotographerPwd(''); setRevealPwd(false);
        setPostalCode(''); setCity(''); setCitySuggestions([]);
        setEventType('');
        // Pré-rempli avec l'email du compte orga connecté (éditable). La session
        // est structurée { token, profile } — l'email est sous profile.email. Si
        // la session arrive de manière asynchrone après l'ouverture du modal, un
        // second useEffect ci-dessous (deps [visible, isEdit, organizerSession])
        // re-tire l'email tant que l'utilisateur n'a rien saisi.
        setWebsite(''); setContact(organizerSession?.profile?.email || ''); setPhone(''); setDistances([]);
        setCoverImage(null); setPendingCoverLocal(null);
      }
    }
  }, [visible, isEdit]);

  // Fallback : si organizerSession arrive APRES l'ouverture du modal (race au
  // boot, restore AsyncStorage asynchrone), on retire l'email pré-rempli tant
  // que le user n'a rien saisi. Ne touche pas au champ en mode édition.
  useEffect(() => {
    if (!visible || isEdit) return;
    const email = organizerSession?.profile?.email;
    if (email && !contact) setContact(email);
    // contact est volontairement hors deps : on ne veut pas écraser une saisie
    // user. Le check `&& !contact` dans le corps de l'effet suffit.
  }, [visible, isEdit, organizerSession]);

  // Slug auto-généré depuis le nom (création seulement, tant que l'utilisateur ne l'a pas modifié manuellement)
  useEffect(() => {
    if (isEdit || userEditedCode) return;
    const slug = (name || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    setCode(slug);
  }, [name, isEdit, userEditedCode]);

  // Suggestions de villes selon code postal
  useEffect(() => {
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode]);

  const addDistance = () => setDistances(d => [...d, { km: '', time: '', elevation: '' }]);
  const updateDistance = (idx, field, value) => {
    setDistances(d => d.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };
  const removeDistance = (idx) => setDistances(d => d.filter((_, i) => i !== idx));

  // Sélection de l'image. iOS ignore aspect dans son cropper natif sur les
  // ratios non-standards, donc on ouvre notre CropImageModal pour que
  // l'utilisateur cadre lui-même en 2:1 (image moitié droite des cards 4:1).
  const pickAndUploadCover = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Autorisation refusée', 'Active l\'accès à tes photos dans les réglages.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      setCropAsset(r.assets[0]);
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Impossible de sélectionner l\'image');
    }
  };

  // Validé depuis la CropImageModal → upload (édition) ou stockage local (création).
  const handleCropConfirm = async (cropped) => {
    setCropAsset(null);
    const localUri = cropped.uri;
    if (isEdit && editEvent?.code) {
      setCoverBusy(true);
      try {
        const res = await fetch(localUri);
        const blob = await res.blob();
        const up = await fetch(`${API_URL}/organizer/cover/${editEvent.code}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg',
            Authorization: `Bearer ${organizerSession.token}`,
          },
          body: blob,
        });
        const data = await up.json();
        if (up.ok) setCoverImage(data.cover_image);
        else Alert.alert('Erreur', data.error || 'Échec de l\'upload');
      } catch (e) {
        Alert.alert('Erreur', e.message || 'Échec de l\'upload');
      } finally { setCoverBusy(false); }
    } else {
      setPendingCoverLocal(localUri);
    }
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contact || '').trim());
  const locationOk = /^\d{5}$/.test(postalCode) && !!city?.trim();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const dateOk = !!eventDate && eventDate >= todayMidnight;
  // Distances optionnelles : un event peut être créé sans aucune course (event
  // type "course non chronométrée", marche libre, etc.). Si l'orga ajoute des
  // courses, chacune doit avoir un km > 0 pour rester cohérente.
  const distancesOk = distances.length === 0 || distances.every(d => parseFloat(d.km) > 0);
  const step1Ok = !!name?.trim() && !!eventType && dateOk;
  const step2Ok = locationOk && distancesOk;
  // En creation : step 3 valide uniquement le contact (email). Le PIN photographe
  // a sa propre etape dediee (step 4). En edition : le PIN est gere dans le
  // drill-down dedie, donc on n'exige rien ici.
  const step3Ok = emailOk && (isEdit || !!code?.trim());
  // Step 4 (PIN photographe) : 4 chiffres exactement, obligatoire en creation.
  // En edition, le PIN s'edite via le drill-down — etape inexistante dans le wizard.
  const step4Ok = isEdit || isValidPin(password);
  // Step 5 (cover) est toujours valide — la cover est optionnelle, le bouton
  // "Ajouter plus tard" passe directement à la soumission sans upload.
  const step5Ok = true;
  const canSubmit = step1Ok && step2Ok && step3Ok && step4Ok && step5Ok && !busy;

  const TOTAL_STEPS = isEdit ? 4 : 5;
  const goStep = (n) => {
    if (n < 1 || n > TOTAL_STEPS || !sheetW) { setStep(n); return; }
    setStep(n);
    Animated.timing(slideX, {
      toValue: -(n - 1) * sheetW,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };
  const tryNext = () => {
    if (step === 1) { if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); return; } goStep(2); return; }
    if (step === 2) { if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); return; } goStep(3); return; }
    if (step === 3) { if (!step3Ok) { setShowErr(e => ({ ...e, 3: true })); return; } goStep(4); return; }
    if (step === 4) { if (!step4Ok) { setShowErr(e => ({ ...e, 4: true })); return; } goStep(5); return; }
  };
  const trySubmit = () => {
    if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); goStep(1); return; }
    if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); goStep(2); return; }
    if (!step3Ok) { setShowErr(e => ({ ...e, 3: true })); goStep(3); return; }
    if (!step4Ok) { setShowErr(e => ({ ...e, 4: true })); goStep(4); return; }
    submit();
  };
  const errStyle = { color: '#DC2626', fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const url = isEdit ? `/organizer/event/${editEvent.code}` : `/auth/submit-event`;
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        name,
        contact,
        phone: phone.trim(),
        event_date: eventDate ? eventDate.toISOString().slice(0, 10) : '',
        event_date_end: eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : '',
        location: city ? `${city} (${postalCode})` : '',
        event_type: eventType,
        website,
        distances: distances
          .filter(d => d.km)
          .map(d => ({
            km: parseFloat(d.km) || 0,
            time: d.time || '',
            elevation: d.elevation || '',
          })),
      };
      if (!isEdit) {
        payload.code = code;
        payload.password = password;
      }
      const r = await fetch(`${API_URL}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        Alert.alert('Erreur', data.error || 'Échec');
      } else {
        // Si création + cover en attente, on l'uploade maintenant — strictement
        // séquentiel (POST submit-event terminé avant PUT cover) pour éviter
        // les 404 "event introuvable".
        let coverFailed = false;
        if (!isEdit && pendingCoverLocal) {
          const slug = code.toLowerCase().replace(/\s+/g, '-');
          console.log('[create-event] starting cover upload', { slug, uri: pendingCoverLocal });
          try {
            const res = await fetch(pendingCoverLocal);
            const blob = await res.blob();
            console.log('[create-event] cover blob ready', { size: blob?.size, type: blob?.type });
            const up = await fetch(`${API_URL}/organizer/cover/${slug}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                Authorization: `Bearer ${organizerSession.token}`,
              },
              body: blob,
            });
            console.log('[create-event] cover upload result', up.status);
            if (!up.ok) {
              const txt = await up.text();
              console.warn('[create-event] cover upload failed', up.status, txt);
              coverFailed = true;
            }
          } catch (e) {
            console.warn('[create-event] cover upload error', e?.message || e);
            coverFailed = true;
          }
        }
        const successTitle = isEdit ? 'Modifications enregistrées' : 'Demande envoyée';
        const successMsg = isEdit ? '' : 'Ton événement sera validé sous peu.';
        if (coverFailed) {
          Alert.alert(
            successTitle,
            (successMsg ? successMsg + '\n\n' : '') +
              "L'image de couverture n'a pas pu être envoyée. Tu pourras la recharger depuis l'édition de l'événement."
          );
        } else {
          Alert.alert(successTitle, successMsg);
        }
        onCreated?.();
        onClose();
      }
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  const types = ['Trail', 'Course sur route', 'Cross', 'Triathlon', 'Velo', 'Marche', 'Autre'];

  // ───────────────── PICKERS COMMUNS (heure/denivele/km/crop/date) ─────────────────
  // Extraits en helper pour etre reutilises par le wizard (creation) et le
  // mode Settings (edition). Reference le scope local (state + setters).
  // Pickers Km/Heure/Denivele — rendus DANS la sub-modal Distances (mode
  // edition) ou DANS le Modal principal (mode creation/wizard) pour que les
  // pickers se presentent au-dessus de la modal parente sur iOS.
  const renderDistancePickers = () => (
    <>
      {/* Picker Heure */}
      <Modal visible={timePickerIdx !== null} transparent animationType="slide" onRequestClose={() => setTimePickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setTimePickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Heure de départ</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>HEURES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/^(\d{1,2})h(\d{2})?/);
                    const curH = m ? parseInt(m[1], 10) : -1;
                    const active = curH === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => {
                          const cur2 = distances[timePickerIdx]?.time || '';
                          const m2 = cur2.match(/h(\d{2})/);
                          const min = m2 ? m2[1] : '00';
                          updateDistance(timePickerIdx, 'time', `${h}h${min}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{h}h</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>MINUTES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const min = i * 5;
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/h(\d{2})/);
                    const curM = m ? parseInt(m[1], 10) : -1;
                    const active = curM === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => {
                          const cur2 = distances[timePickerIdx]?.time || '';
                          const m2 = cur2.match(/^(\d{1,2})h/);
                          const h = m2 ? m2[1] : '9';
                          updateDistance(timePickerIdx, 'time', `${h}h${String(min).padStart(2, '0')}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{String(min).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity onPress={() => setTimePickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Dénivelé */}
      <Modal visible={elevPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setElevPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setElevPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Dénivelé positif</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>Par incréments de 10 m</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 301 }).map((_, i) => {
                const m = i * 10;
                const cur = distances[elevPickerIdx]?.elevation || '';
                const curM = parseInt((cur.match(/(\d+)/) || [])[1], 10);
                const active = curM === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => updateDistance(elevPickerIdx, 'elevation', `${m}m D+`)}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{m} m</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setElevPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Distance (km) */}
      <Modal visible={kmPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setKmPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKmPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Distance</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>De 1 à 200 km</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const km = i + 1;
                const cur = distances[kmPickerIdx]?.km || '';
                const curKm = parseFloat(cur);
                const active = curKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    onPress={() => updateDistance(kmPickerIdx, 'km', String(km))}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setKmPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );

  // CropImageModal rendu separement (utilise par la cover de la home + le
  // wizard de creation). Pas besoin d'etre dans une sub-modal precise.
  const renderCropModal = () => (
    <CropImageModal
      visible={!!cropAsset}
      asset={cropAsset}
      onCancel={() => setCropAsset(null)}
      onConfirm={handleCropConfirm}
    />
  );

  // ───────────────── MODE EDITION : iOS Settings drill-down ─────────────────
  // Home page liste les sections (rows avec icone + valeur courante). Tap sur
  // une row ouvre une sous-modale dediee qui save uniquement le champ modifie
  // via PUT /organizer/event/:slug (whitelist worker existante).
  if (isEdit) {
    const sectionHeaderStyle = {
      color: '#6B7280', fontSize: 13, fontWeight: '700',
      letterSpacing: 0.6, textTransform: 'uppercase',
      marginBottom: 8, marginLeft: 32, marginTop: 24,
    };
    const sectionCardStyle = {
      backgroundColor: '#fff', borderRadius: 14,
      marginHorizontal: 16, overflow: 'hidden',
    };
    const rowStyle = {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14, minHeight: 48,
    };
    const rowSeparatorStyle = {
      height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB', marginLeft: 16,
    };
    const subModalHeader = {
      paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
      backgroundColor: '#fff',
    };
    const saveBtnStyle = {
      marginHorizontal: 16, marginBottom: 28,
      paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center',
    };

    // Previews valeurs courantes pour la home
    const previewDate = eventDate
      ? formatDateForForm(
          eventDate.toISOString().slice(0, 10),
          eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : null,
        )
      : 'Non définie';
    const previewLocation = city
      ? (postalCode ? `${city} (${postalCode})` : city)
      : (editEvent?.location || 'Non défini');
    const previewDistances = distances.length === 0
      ? 'Aucune'
      : distances.map(d => d.km ? `${d.km} km` : '?').join(', ');

    // PUT partiel : met a jour uniquement les champs presents dans `patch`.
    const savePartial = async (patch) => {
      if (!editEvent?.code) return false;
      setPartialBusy(true);
      try {
        const r = await fetch(`${API_URL}/organizer/event/${editEvent.code}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
          },
          body: JSON.stringify(patch),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          Alert.alert('Erreur', data.error || 'Échec de la modification');
          return false;
        }
        onCreated?.();
        return true;
      } catch (e) {
        Alert.alert('Erreur', e.message || 'Erreur réseau');
        return false;
      } finally {
        setPartialBusy(false);
      }
    };

    const SettingsRow = ({ label, value, onPress }) => {
      return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={rowStyle}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '600', flex: 1 }}>{label}</Text>
          <Text style={{ color: '#6B7280', fontSize: 14, marginRight: 8, maxWidth: 140 }} numberOfLines={1}>
            {value || '—'}
          </Text>
          <Text style={{ color: '#9CA3AF', fontSize: 18, fontWeight: '300' }}>›</Text>
        </TouchableOpacity>
      );
    };

    return (
      <>
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="formSheet">
          <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
            {/* Header */}
            <View style={{
              paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#F2F2F7',
            }}>
              <View style={{ width: 32 }} />
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>
                Modifier l'événement
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 32, alignItems: 'flex-end' }}>
                <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
              {/* Cover 4:1 cliquable (ouvre le cropper via pickAndUploadCover) */}
              <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={pickAndUploadCover}
                  disabled={coverBusy}
                  activeOpacity={0.85}
                  style={{
                    aspectRatio: 4, borderRadius: 14, overflow: 'hidden',
                    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
                    borderWidth: (coverImage || pendingCoverLocal) ? 0 : 1,
                    borderStyle: 'dashed', borderColor: '#d9d4ec',
                  }}
                >
                  {coverBusy ? (
                    <ActivityIndicator color={C.primary} />
                  ) : (coverImage || pendingCoverLocal) ? (
                    <ExpoImage source={{ uri: pendingCoverLocal || coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : (
                    <Text style={{ color: C.textSoft, fontSize: 13 }}>+ Ajouter une image de couverture</Text>
                  )}
                </TouchableOpacity>
                {(coverImage || pendingCoverLocal) && !coverBusy && (
                  <TouchableOpacity onPress={pickAndUploadCover} style={{ marginTop: 6 }}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600', textAlign: 'right' }}>
                      Changer l'image
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ───── GÉNÉRAL ───── */}
              <Text style={sectionHeaderStyle}>GÉNÉRAL</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Nom" value={name} onPress={() => setEditingField('name')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Type d'épreuve" value={eventType ? displayEventType(eventType) : ''} onPress={() => setEditingField('type')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Date" value={previewDate} onPress={() => setEditingField('date')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Heure de départ" value={startTime || ''} onPress={() => setEditingField('start_time')} />
              </View>

              {/* ───── LIEU & CONTACT ───── */}
              <Text style={sectionHeaderStyle}>LIEU & CONTACT</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Lieu" value={previewLocation} onPress={() => setEditingField('location')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Téléphone" value={phone} onPress={() => setEditingField('phone')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Email contact" value={contact} onPress={() => setEditingField('email')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Site web" value={website} onPress={() => setEditingField('website')} />
              </View>

              {/* ───── DISTANCES ───── */}
              <Text style={sectionHeaderStyle}>DISTANCES</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Distances proposées" value={previewDistances} onPress={() => setEditingField('distances')} />
              </View>

              {/* ───── CODE PIN PHOTOGRAPHE ───── */}
              {isEdit && (
                <>
                  <Text style={sectionHeaderStyle}>CODE PIN PHOTOGRAPHE</Text>
                  <Text style={{ paddingHorizontal: 28, marginBottom: 6, fontSize: 12, color: C.textSoft }}>
                    À transmettre à tes photographes le jour J
                  </Text>
                  <View style={sectionCardStyle}>
                    <View style={[rowStyle, { paddingVertical: 18, justifyContent: 'center' }]}>
                      <PinDisplay pin={photographerPwd} masked={!revealPwd} />
                    </View>
                    <View style={rowSeparatorStyle} />
                    <View style={[rowStyle, { gap: 0 }]}>
                      <TouchableOpacity onPress={() => setRevealPwd(v => !v)} disabled={!isValidPin(photographerPwd)} style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: isValidPin(photographerPwd) ? 1 : 0.4 }}>
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>{revealPwd ? 'Masquer' : 'Afficher'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          if (!isValidPin(photographerPwd)) return;
                          // Pas de Clipboard natif (expo-clipboard pas installé) — on
                          // passe par Share qui propose Copier dans la share-sheet iOS.
                          try { await Share.share({ message: photographerPwd }); } catch {}
                        }}
                        disabled={!isValidPin(photographerPwd)}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: isValidPin(photographerPwd) ? 1 : 0.4 }}
                      >
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Copier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingField('photographer_password')} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>{isValidPin(photographerPwd) ? 'Modifier' : 'Définir'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* ───── FACTURATION ───── */}
                  <Text style={sectionHeaderStyle}>FACTURATION</Text>
                  <View style={sectionCardStyle}>
                    <View style={rowStyle}>
                      <Text style={{ color: C.text, fontSize: 16, fontWeight: '500', flex: 1 }}>
                        Offre partenaire gratuite
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
          {renderCropModal()}

          {/* ─── Sub-modal: Nom ─── */}
          <SubModalInputText
            visible={editingField === 'name'}
            title="Nom de l'événement"
            value={name}
            onChangeText={setName}
            placeholder="Ex : Trail des Violettes"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              if (!name?.trim()) { Alert.alert('Nom requis'); return; }
              const ok = await savePartial({ name: name.trim() });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Type d'épreuve (save immediat sur tap) ─── */}
          <Modal visible={editingField === 'type'} animationType="slide" onRequestClose={() => setEditingField(null)} presentationStyle="formSheet">
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={subModalHeader}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Type d'épreuve</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
                <View style={sectionCardStyle}>
                  {types.map((t, idx) => {
                    const active = eventType === t;
                    return (
                      <React.Fragment key={t}>
                        <TouchableOpacity
                          onPress={async () => {
                            setEventType(t);
                            const ok = await savePartial({ event_type: t });
                            if (ok) setEditingField(null);
                          }}
                          disabled={partialBusy}
                          style={[rowStyle, { paddingVertical: 16 }]}
                        >
                          <Text style={{ color: active ? C.primary : C.text, fontSize: 16, fontWeight: '500', flex: 1 }}>
                            {displayEventType(t)}
                          </Text>
                          {active && (
                            <Text style={{ color: C.primary, fontSize: 18, fontWeight: '700' }}>✓</Text>
                          )}
                        </TouchableOpacity>
                        {idx < types.length - 1 && <View style={rowSeparatorStyle} />}
                      </React.Fragment>
                    );
                  })}
                </View>
                {partialBusy && <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />}
              </ScrollView>
            </View>
          </Modal>

          {/* ─── Sub-modal: Date (plage start + end) ─── */}
          {/* Réutilise le CalendarRangeModal de la création : tap 2x le même jour
              pour un event 1 jour, sinon plage. Sauvegarde directe via savePartial
              à la confirmation (PUT { event_date, event_date_end }). */}
          <CalendarRangeModal
            visible={editingField === 'date'}
            onClose={() => setEditingField(null)}
            initialStart={eventDate}
            initialEnd={eventDateEnd}
            minDate={null}
            onConfirm={async (start, end) => {
              setEventDate(start);
              setEventDateEnd(end);
              const startStr = start ? start.toISOString().slice(0, 10) : '';
              const endStr = end ? end.toISOString().slice(0, 10) : '';
              if (!startStr) { Alert.alert('Date requise'); return; }
              await savePartial({ event_date: startStr, event_date_end: endStr });
            }}
          />

          {/* ─── Sub-modal: Heure de départ (time picker) ─── */}
          <Modal visible={editingField === 'start_time'} animationType="slide" onRequestClose={() => setEditingField(null)} presentationStyle="formSheet">
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={subModalHeader}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Heure de départ</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingTop: 16 }}>
                <DateTimePicker
                  value={(() => {
                    const m = String(startTime || '').match(/^(\d{1,2}):(\d{2})$/);
                    const d = new Date();
                    if (m) { d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0); }
                    else { d.setHours(8, 0, 0, 0); }
                    return d;
                  })()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, selected) => {
                    if (!selected) return;
                    const hh = String(selected.getHours()).padStart(2, '0');
                    const mm = String(selected.getMinutes()).padStart(2, '0');
                    setStartTime(`${hh}:${mm}`);
                  }}
                  locale="fr-FR"
                  is24Hour
                  style={{ width: 320 }}
                />
              </View>
              <TouchableOpacity
                onPress={async () => {
                  if (!/^\d{1,2}:\d{2}$/.test(startTime)) { Alert.alert('Format invalide', 'Heure attendue HH:MM'); return; }
                  const ok = await savePartial({ start_time: startTime });
                  if (ok) setEditingField(null);
                }}
                disabled={partialBusy}
                style={[saveBtnStyle, { opacity: partialBusy ? 0.6 : 1 }]}
              >
                {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </Modal>

          {/* ─── Sub-modal: Code PIN photographe (4 chiffres) ─── */}
          <Modal visible={editingField === 'photographer_password'} animationType="slide" transparent onRequestClose={() => setEditingField(null)}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <TouchableOpacity activeOpacity={1} onPress={() => setEditingField(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }}>
                <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderRadius: 18, padding: 24 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 }}>Code PIN photographe</Text>
                  <Text style={{ fontSize: 13, color: C.textSoft, marginBottom: 22, lineHeight: 18 }}>
                    4 chiffres à transmettre à tes photographes le jour J.
                  </Text>
                  <PinInputRow
                    value={photographerPwd}
                    onChange={setPhotographerPwd}
                    autoFocus
                  />
                  <TouchableOpacity
                    onPress={() => setPhotographerPwd(generateRandomPin())}
                    style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8 }}
                  >
                    <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Générer aléatoirement</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
                    <TouchableOpacity
                      onPress={() => setEditingField(null)}
                      style={{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.primary, fontSize: 14, fontWeight: '700' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        if (!isValidPin(photographerPwd)) { Alert.alert('Code PIN', 'Le code PIN doit être composé de 4 chiffres.'); return; }
                        const ok = await savePartial({ photographer_password: photographerPwd });
                        if (ok) { setEditingField(null); setRevealPwd(false); }
                      }}
                      disabled={!isValidPin(photographerPwd) || partialBusy}
                      style={{
                        flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
                        backgroundColor: isValidPin(photographerPwd) ? C.primary : '#e9e4f9',
                        opacity: partialBusy ? 0.6 : 1,
                      }}
                    >
                      {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: isValidPin(photographerPwd) ? '#fff' : C.textSoft, fontSize: 14, fontWeight: '700' }}>Confirmer</Text>}
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* ─── Sub-modal: Lieu (postalCode + city) ─── */}
          <Modal visible={editingField === 'location'} animationType="slide" onRequestClose={() => setEditingField(null)}>
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={[subModalHeader, { paddingTop: 56 }]}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Lieu</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
                <Text style={sectionHeaderStyle}>CODE POSTAL</Text>
                <View style={sectionCardStyle}>
                  <TextInput
                    value={postalCode}
                    onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); if (v !== postalCode) setCity(''); }}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="75001"
                    placeholderTextColor="#9CA3AF"
                    style={{ paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: C.text }}
                  />
                </View>
                <Text style={sectionHeaderStyle}>VILLE</Text>
                <View style={sectionCardStyle}>
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    placeholder="Paris"
                    placeholderTextColor="#9CA3AF"
                    style={{ paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: C.text }}
                  />
                </View>
                {citySuggestions.length > 0 && !city && (
                  <View style={[sectionCardStyle, { marginTop: 8 }]}>
                    {citySuggestions.slice(0, 6).map((c, idx, arr) => (
                      <React.Fragment key={c}>
                        <TouchableOpacity onPress={() => { setCity(c); setCitySuggestions([]); }} style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
                          <Text style={{ color: C.primary, fontSize: 15 }}>{c}</Text>
                        </TouchableOpacity>
                        {idx < arr.length - 1 && <View style={rowSeparatorStyle} />}
                      </React.Fragment>
                    ))}
                  </View>
                )}
                <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 12, marginHorizontal: 32 }}>
                  Format suggéré : Ville (Département)
                </Text>
              </ScrollView>
              <View style={{ paddingBottom: editKbHeight }}>
                <TouchableOpacity
                  onPress={async () => {
                    if (!city?.trim()) { Alert.alert('Ville requise'); return; }
                    const loc = postalCode ? `${city} (${postalCode})` : city;
                    const ok = await savePartial({ location: loc });
                    if (ok) setEditingField(null);
                  }}
                  disabled={partialBusy}
                  style={[saveBtnStyle, { marginBottom: editKbHeight > 0 ? 12 : 28, opacity: partialBusy ? 0.6 : 1 }]}
                >
                  {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* ─── Sub-modal: Téléphone ─── */}
          <SubModalInputText
            visible={editingField === 'phone'}
            title="Téléphone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="06 12 34 56 78"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              const v = (phone || '').trim();
              if (v) {
                const digits = v.replace(/[\s.\-]/g, '');
                if (!/^(\+33\d{9}|0\d{9}|\+?\d{10,15})$/.test(digits)) {
                  Alert.alert('Téléphone invalide', 'Format attendu : 06 12 34 56 78 ou +33...');
                  return;
                }
              }
              const ok = await savePartial({ phone: v });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Email ─── */}
          <SubModalInputText
            visible={editingField === 'email'}
            title="Email contact"
            value={contact}
            onChangeText={setContact}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="contact@event.com"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              if (!emailOk) { Alert.alert('Email invalide'); return; }
              const ok = await savePartial({ contact: contact.trim() });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Site web ─── */}
          <SubModalInputText
            visible={editingField === 'website'}
            title="Site web"
            value={website}
            onChangeText={setWebsite}
            keyboardType="url"
            autoCapitalize="none"
            placeholder="traildesviolettes.fr"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              let v = (website || '').trim();
              if (v && !/^https?:\/\//.test(v)) v = `https://${v}`;
              const ok = await savePartial({ website: v });
              if (ok) {
                setWebsite(v);
                setEditingField(null);
              }
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Distances ─── */}
          <Modal visible={editingField === 'distances'} animationType="slide" onRequestClose={() => setEditingField(null)}>
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={[subModalHeader, { paddingTop: 56 }]}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Distances</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                {distances.map((d, idx) => (
                  <View key={idx} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#6B7280', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DISTANCE</Text>
                        <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.km ? C.text : '#9CA3AF', fontSize: 14 }}>{d.km ? `${d.km} km` : '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#6B7280', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉPART</Text>
                        <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.time ? C.text : '#9CA3AF', fontSize: 14 }}>{d.time || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1.2 }}>
                        <Text style={{ color: '#6B7280', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉNIVELÉ</Text>
                        <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.elevation ? C.text : '#9CA3AF', fontSize: 14 }}>{d.elevation || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 8 }}>
                      <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={addDistance} style={{ paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: '#fff', marginTop: 4 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 15 }}>+ Ajouter une distance</Text>
                </TouchableOpacity>
              </ScrollView>
              <View style={{ paddingBottom: editKbHeight }}>
                <TouchableOpacity
                  onPress={async () => {
                    const cleaned = distances.filter(d => d.km).map(d => ({
                      km: parseFloat(d.km) || 0,
                      time: d.time || '',
                      elevation: d.elevation || '',
                    }));
                    if (cleaned.length === 0) { Alert.alert('Au moins une distance requise'); return; }
                    if (!cleaned.every(d => d.km > 0)) { Alert.alert('Distance > 0 requise pour chaque course'); return; }
                    const ok = await savePartial({ distances: cleaned });
                    if (ok) setEditingField(null);
                  }}
                  disabled={partialBusy}
                  style={[saveBtnStyle, { marginBottom: editKbHeight > 0 ? 12 : 28, opacity: partialBusy ? 0.6 : 1 }]}
                >
                  {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
                </TouchableOpacity>
              </View>
            </View>
            {/* Pickers Km/Heure/Denivele rendus DANS la sub-modal Distances
                pour qu'ils s'affichent au-dessus d'elle (iOS z-order). */}
            {renderDistancePickers()}
          </Modal>
        </Modal>
      </>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: '90%' }]} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            {/* Header : titre + étape */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>{isEdit ? 'Modifier l\'événement' : 'Créer un événement'}</Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Étape {step} sur {TOTAL_STEPS}</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Barre de progression */}
            <View style={{ height: 4, backgroundColor: '#e9e4f9', borderRadius: 2, marginBottom: 14 }}>
              <View style={{ height: 4, width: `${(step / TOTAL_STEPS) * 100}%`, backgroundColor: C.primary, borderRadius: 2 }} />
            </View>

            {/* Wizard slide */}
            <View
              style={{ overflow: 'hidden' }}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w && w !== sheetW) {
                  setSheetW(w);
                  slideX.setValue(-(step - 1) * w);
                }
              }}
            >
              <Animated.View style={{ flexDirection: 'row', width: sheetW * TOTAL_STEPS, transform: [{ translateX: slideX }] }}>

                {/* ===== STEP 1 : Identité ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Nom de l'événement *</Text>
                    <TextInput placeholder="Ex : Trail des Violettes" placeholderTextColor={C.textSoft} value={name} onChangeText={setName} style={formSectionStyle.input} />
                    {showErr[1] && !name?.trim() && <Text style={errStyle}>Champ requis</Text>}

                    <Text style={formSectionStyle.heading}>Type d'épreuve *</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {types.map(t => (
                        <TouchableOpacity key={t} onPress={() => setEventType(t)} style={[s.typePill, eventType === t && s.typePillActive]}>
                          <Text style={[s.typePillText, eventType === t && { color: '#fff' }]}>{displayEventType(t)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {showErr[1] && !eventType && <Text style={errStyle}>Sélectionne un type</Text>}

                    <Text style={formSectionStyle.heading}>Date(s) de l'événement *</Text>
                    <TouchableOpacity
                      onPress={() => setShowCalendar(true)}
                      style={[formSectionStyle.input, { justifyContent: 'center' }]}
                    >
                      <Text style={{ color: eventDate ? C.text : C.textSoft, fontSize: 15 }}>
                        {eventDate
                          ? formatDateForForm(
                              eventDate.toISOString().slice(0, 10),
                              eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : null,
                            )
                          : 'Choisir une date (ou une plage)'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: C.textSoft, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 }}>
                      Tape 2 fois la même date pour un événement sur 1 jour.
                    </Text>
                    {showErr[1] && !dateOk && <Text style={errStyle}>Date requise (pas dans le passé)</Text>}
                  </ScrollView>
                </View>

                {/* ===== STEP 2 : Lieu + Courses ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Lieu</Text>
                    <TextInput
                      placeholder="Code postal *"
                      placeholderTextColor={C.textSoft}
                      value={postalCode}
                      onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                      keyboardType="number-pad"
                      maxLength={5}
                      style={formSectionStyle.input}
                    />
                    {showErr[2] && !/^\d{5}$/.test(postalCode) && <Text style={errStyle}>5 chiffres requis</Text>}
                    {citySuggestions.length > 0 && !city && (
                      <ScrollView
                        style={{ maxHeight: 140, marginBottom: 8, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                        keyboardShouldPersistTaps="handled"
                      >
                        {citySuggestions.map((c) => (
                          <TouchableOpacity
                            key={c}
                            onPress={() => { setCity(c); setCitySuggestions([]); }}
                            style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                          >
                            <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                    {city ? (
                      <TouchableOpacity
                        onPress={() => setCity('')}
                        style={[formSectionStyle.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                      >
                        <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                        <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                      </TouchableOpacity>
                    ) : null}
                    {showErr[2] && !city?.trim() && <Text style={errStyle}>Ville requise</Text>}

                    <Text style={formSectionStyle.heading}>Courses</Text>
                    {distances.map((d, idx) => (
                      <View key={idx} style={{ backgroundColor: '#faf9ff', borderRadius: 12, padding: 10, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DISTANCE</Text>
                            <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.km ? C.text : C.textSoft, fontSize: 15 }}>{d.km ? `${d.km} km` : '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉPART</Text>
                            <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.time ? C.text : C.textSoft, fontSize: 15 }}>{d.time || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1.2 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉNIVELÉ</Text>
                            <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.elevation ? C.text : C.textSoft, fontSize: 15 }}>{d.elevation || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                          <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={addDistance}
                      style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 12, backgroundColor: '#f5f3ff', marginBottom: 8 }}
                    >
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>+ Ajouter une course</Text>
                    </TouchableOpacity>
                    {showErr[2] && distances.length > 0 && !distances.every(d => parseFloat(d.km) > 0) && (
                      <Text style={errStyle}>Distance &gt; 0 requise pour chaque course</Text>
                    )}
                  </ScrollView>
                </View>

                {/* ===== STEP 3 : Contact ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Contact</Text>
                    <TextInput placeholder="Site web (optionnel)" placeholderTextColor={C.textSoft} value={website} onChangeText={setWebsite} autoCapitalize="none" style={formSectionStyle.input} />
                    <TextInput placeholder="Email de contact *" placeholderTextColor={C.textSoft} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    <Text style={{ color: C.textSoft, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 }}>
                      Cet email sera affiché publiquement sur la page de ton événement.
                    </Text>
                    {showErr[3] && !emailOk && <Text style={errStyle}>Email invalide</Text>}
                    <TextInput placeholder="Téléphone de contact (optionnel)" placeholderTextColor={C.textSoft} value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={formSectionStyle.input} />
                  </ScrollView>
                </View>

                {/* ===== STEP 4 : Code PIN photographe ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Code PIN photographe</Text>
                    <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 22, marginLeft: 4, lineHeight: 18 }}>
                      4 chiffres à transmettre à tes photographes le jour J. Ils l'utiliseront pour se connecter à ton event sur l'app Will.
                    </Text>
                    {!isEdit && (
                      <>
                        <PinInputRow
                          value={password}
                          onChange={setPassword}
                          autoFocus={false}
                          focusTrigger={step === 4 ? 1 : 0}
                          error={showErr[4] && !isValidPin(password)}
                        />
                        <TouchableOpacity
                          onPress={() => setPassword(generateRandomPin())}
                          style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 14 }}
                        >
                          <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Générer aléatoirement</Text>
                        </TouchableOpacity>
                        {showErr[4] && !isValidPin(password) && (
                          <Text style={[errStyle, { textAlign: 'center', marginTop: 6 }]}>Le code PIN doit être composé de 4 chiffres</Text>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>

                {/* ===== STEP 5 : Cover image (skippable) ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Image de couverture</Text>
                    <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 10, marginLeft: 4, lineHeight: 17 }}>
                      Cette image sera affichée sur la page de ton event et dans l'app coureur. Format paysage 16:9 recommandé.
                    </Text>
                    <TouchableOpacity
                      onPress={pickAndUploadCover}
                      disabled={coverBusy}
                      style={{
                        height: 160, borderRadius: 12, backgroundColor: '#faf9ff', marginBottom: 8,
                        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
                        borderWidth: (coverImage || pendingCoverLocal) ? 0 : 1, borderStyle: 'dashed', borderColor: '#d9d4ec',
                      }}
                    >
                      {coverBusy ? (
                        <ActivityIndicator color={C.primary} />
                      ) : (coverImage || pendingCoverLocal) ? (
                        <ExpoImage source={{ uri: pendingCoverLocal || coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      ) : (
                        <>
                          <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>+ Choisir une image</Text>
                          <Text style={{ color: C.textSoft, fontSize: 11 }}>Depuis ta galerie</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {(coverImage || pendingCoverLocal) && !coverBusy && (
                      <TouchableOpacity onPress={pickAndUploadCover} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: 8 }}>
                        <Text style={{ color: C.primary, fontSize: 12, fontWeight: '600' }}>Changer l'image</Text>
                      </TouchableOpacity>
                    )}
                    {!(coverImage || pendingCoverLocal) && (
                      <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 17 }}>
                        Pas de visuel sous la main ? Tu peux ajouter l'image plus tard depuis l'édition de ton event.
                      </Text>
                    )}
                  </ScrollView>
                </View>

              </Animated.View>
            </View>

            {/* Bottom nav : Précédent / Suivant ou Soumettre / Ajouter plus tard */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {step > 1 && (
                <TouchableOpacity
                  onPress={() => goStep(step - 1)}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                >
                  <Text style={{ color: C.primary, fontSize: 15, fontWeight: '700' }}>Précédent</Text>
                </TouchableOpacity>
              )}
              {step < TOTAL_STEPS ? (
                <TouchableOpacity
                  onPress={tryNext}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Suivant</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={trySubmit}
                  disabled={busy}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      {isEdit
                        ? 'Enregistrer'
                        : (coverImage || pendingCoverLocal) ? 'Soumettre' : 'Ajouter plus tard'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>

      {/* Calendrier custom (range) — remplace le DateTimePicker natif iOS */}
      <CalendarRangeModal
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        initialStart={eventDate}
        initialEnd={eventDateEnd}
        minDate={(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()}
        onConfirm={(start, end) => {
          setEventDate(start);
          setEventDateEnd(end);
        }}
      />

      {/* Picker Heure */}
      <Modal visible={timePickerIdx !== null} transparent animationType="slide" onRequestClose={() => setTimePickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setTimePickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Heure de départ</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>HEURES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/^(\d{1,2})h(\d{2})?/);
                    const curH = m ? parseInt(m[1], 10) : -1;
                    const active = curH === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/h(\d{2})/);
                          const min = m2 ? m2[1] : '00';
                          updateDistance(timePickerIdx, 'time', `${h}h${min}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{h}h</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>MINUTES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const min = i * 5;
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/h(\d{2})/);
                    const curM = m ? parseInt(m[1], 10) : -1;
                    const active = curM === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/^(\d{1,2})h/);
                          const h = m2 ? m2[1] : '9';
                          updateDistance(timePickerIdx, 'time', `${h}h${String(min).padStart(2, '0')}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{String(min).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity onPress={() => setTimePickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Dénivelé */}
      <Modal visible={elevPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setElevPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setElevPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Dénivelé positif</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>Par incréments de 10 m</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 301 }).map((_, i) => {
                const m = i * 10;
                const cur = distances[elevPickerIdx]?.elevation || '';
                const curM = parseInt((cur.match(/(\d+)/) || [])[1], 10);
                const active = curM === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => {
                      updateDistance(elevPickerIdx, 'elevation', `${m}m D+`);
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{m} m</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setElevPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Distance (km) */}
      <Modal visible={kmPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setKmPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKmPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Distance</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>De 1 à 200 km</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const km = i + 1;
                const cur = distances[kmPickerIdx]?.km || '';
                const curKm = parseFloat(cur);
                const active = curKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    onPress={() => {
                      updateDistance(kmPickerIdx, 'km', String(km));
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setKmPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CropImageModal
        visible={!!cropAsset}
        asset={cropAsset}
        onCancel={() => setCropAsset(null)}
        onConfirm={handleCropConfirm}
      />
    </Modal>
  );
}

function OrganizationModal({ visible, onClose, onPickRole }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4 }]}>
            Organisation
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 20 }}>
            Choisis ton espace
          </Text>

          {/* Carte Espace organisateur */}
          <TouchableOpacity
            onPress={() => onPickRole('organizer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.pinkPill,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.Events color="#fff" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace organisateur</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Crée et gère tes événements</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Carte Espace photographe */}
          <TouchableOpacity
            onPress={() => onPickRole('photographer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.PhotoCam size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace photographe</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Capture les coureurs en direct</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const BIOMETRIC_CONSENT_KEY = '@will_biometric_consent_v1';

// Sous-modal : viewport caméra custom avec masque rond circulaire.
// Caméra avant en Vision Camera : grand angle natif explicite + viewport
// dimensionné au ratio 4:3 du capteur pour éviter le crop/zoom apparent
// causé par le cover-fill sur écran 9:19.5. Le cercle est purement visuel
// (overlay SVG), il ne crope pas la preview ; l'image sauvée est l'image
// native non rognée (le crop carré final reste à faire au save côté upload).
function SelfieCameraModal({ visible, onClose, onCaptured }) {
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front', {
    physicalDevices: ['wide-angle-camera'],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission]);

  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  const OVAL_W = 260;
  const OVAL_H = 340;
  const cx = winW / 2;
  // Ovale décalé légèrement vers le haut pour laisser respirer la zone
  // capture/croix en bas (qui occupe ~bottomInset + 80 + 16 ≈ 154px).
  const cy = winH / 2 - 40;
  // Approximation safe-area bas : home indicator iOS ~34, +24 demandés.
  const bottomInset = Platform.OS === 'ios' ? 58 : 32;

  const captureScale = useRef(new Animated.Value(1)).current;
  const onCapturePressIn = () => {
    Animated.spring(captureScale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onCapturePressOut = () => {
    Animated.spring(captureScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const shoot = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      const path = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      onCaptured?.(path);
    } catch (e) {
      Alert.alert('Erreur', e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {hasPermission && device ? (
          <VisionCamera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible}
            photo={true}
            zoom={device.minZoom}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 16 }}>
              {!device
                ? "Aucune caméra avant disponible sur cet appareil."
                : "Will a besoin d'accéder à la caméra pour prendre ton selfie."}
            </Text>
            {!hasPermission && (
              <TouchableOpacity onPress={requestPermission} style={s.btnPrimary}>
                <Text style={s.btnPrimaryText}>Autoriser</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Voile semi-transparent plein écran avec trou ovale au centre.
            Pas de bordure : la forme est définie par le contraste entre la
            zone visible et le voile. */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Mask id="selfieMask">
              <Rect width="100%" height="100%" fill="white" />
              <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} fill="black" />
            </Mask>
          </Defs>
          <Rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#selfieMask)" />
        </Svg>

        <Text style={{
          position: 'absolute',
          top: cy + OVAL_H / 2 + 24,
          left: 0, right: 0, textAlign: 'center',
          color: '#fff', fontSize: 14, fontWeight: '600',
          textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4,
        }}>
          Place ton visage dans l'ovale
        </Text>

        {/* Bouton capture centré, style iOS Camera : blanc plein, sans bordure. */}
        <View style={{
          position: 'absolute',
          bottom: bottomInset,
          left: 0, right: 0,
          alignItems: 'center',
        }}>
          <Animated.View style={{ transform: [{ scale: captureScale }] }}>
            <TouchableOpacity
              onPress={shoot}
              onPressIn={onCapturePressIn}
              onPressOut={onCapturePressOut}
              disabled={busy || !hasPermission || !device}
              activeOpacity={1}
              style={{
                width: 80, height: 80, borderRadius: 999,
                backgroundColor: '#fff',
                opacity: busy || !hasPermission || !device ? 0.4 : 1,
              }}
            />
          </Animated.View>
        </View>

        {/* Croix fermer en bas droite, au même niveau vertical que le bouton capture. */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={10}
          style={{
            position: 'absolute',
            bottom: bottomInset + 16,
            right: 24,
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: 'rgba(255,255,255,0.15)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// Modale d'information au 1er boot post-Phase D RGPD. Affichee une seule
// fois si l'utilisateur avait des favoris (vidés a ce moment). Pour la
// re-tester en dev : depuis la console React Native, appeler
//   await global.__resetPhaseD()
// (re-supprime le flag + recharge l'app via DevSettings.reload).
function PhaseDResetModal({ visible, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(26,20,38,0.45)',
        justifyContent: 'center', padding: 24,
      }}>
        <View style={{
          backgroundColor: '#fff', borderRadius: 20, padding: 24,
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
        }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: '#EDE4FF',
            alignItems: 'center', justifyContent: 'center',
            alignSelf: 'center', marginBottom: 14,
          }}>
            <Svg width={28} height={26} viewBox="-1 -1.5 22.78 20.61" fill="#7B2FFF">
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </View>
          <Text style={{
            fontSize: 18, fontWeight: '800', color: '#1A1426',
            textAlign: 'center', marginBottom: 10, letterSpacing: -0.3,
          }}>
            Will respecte mieux ta vie privée
          </Text>
          <Text style={{
            fontSize: 14, color: '#5A5468', lineHeight: 20,
            textAlign: 'center', marginBottom: 22,
          }}>
            Tu dois maintenant <Text style={{ fontWeight: '700', color: '#1A1426' }}>Suivre</Text> explicitement chaque event pour recevoir tes photos. Tes anciens favoris ont été retirés. Tu peux les Suivre à nouveau pour réactiver l'envoi automatique.
          </Text>
          <TouchableOpacity onPress={onClose} style={{
            backgroundColor: '#7B2FFF', borderRadius: 999,
            paddingVertical: 13, alignItems: 'center',
          }} activeOpacity={0.85}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>J'ai compris</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SelfieModal({ visible, onClose, onSaved, userId, runnerToken, signupMode = false, onSkip }) {
  const [uri, setUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Consentement biométrique RGPD art. 9 : on demande explicitement la 1ère fois
  // et on persiste la date d'acceptation (révocable via suppression du selfie).
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(null); // null = en cours de chargement, true/false sinon

  const previewScale = useRef(new Animated.Value(1)).current;
  const onPreviewPressIn = () => {
    Animated.spring(previewScale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onPreviewPressOut = () => {
    Animated.spring(previewScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  useEffect(() => {
    if (!visible) return;
    Secure.getItem(BIOMETRIC_CONSENT_KEY).then(v => {
      setConsentGiven(!!v);
      setConsentChecked(false);
    });
  }, [visible]);

  const acceptConsent = async () => {
    if (!consentChecked) return;
    await Secure.setItem(BIOMETRIC_CONSENT_KEY, new Date().toISOString());
    setConsentGiven(true);
  };

  const take = () => {
    setCameraOpen(true);
  };

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission refusée');
    const r = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!r.canceled && r.assets?.[0]?.uri) setUri(r.assets[0].uri);
  };

  const save = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      // 1. Sauvegarde locale (réactivité immédiate)
      await AsyncStorage.setItem('@will_selfie', uri);
      onSaved?.(uri);

      // 2. Upload sur R2 pour la reconnaissance faciale (en background, non bloquant)
      // Auth runner obligatoire : le worker exige Bearer + match userId === token.userId
      if (userId && runnerToken) {
        (async () => {
          try {
            const blob = await (await fetch(uri)).blob();
            await fetch(`${API_URL}/selfie/${userId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                Authorization: `Bearer ${runnerToken}`,
              },
              body: blob,
            });
          } catch (e) {
            console.warn('selfie upload R2', e);
          }
        })();
      }

      onClose();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          {consentGiven === false ? (
            <>
              <Text style={s.modalTitle}>Reconnaissance faciale</Text>
              <Text style={[s.modalSub, { textAlign: 'left', lineHeight: 20 }]}>
                Pour t'envoyer automatiquement tes photos d'événement, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées, stockées sur des serveurs européens, et supprimées 30 jours après ton dernier événement.{'\n\n'}
                Tu peux retirer ton consentement à tout moment en supprimant ton selfie depuis l'app.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://will-app.com/privacy').catch(() => {})}
                style={{ marginBottom: 16, alignSelf: 'flex-start' }}
                hitSlop={10}
              >
                <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
                  Lire la Politique de confidentialité
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConsentChecked(c => !c)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 }}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                  borderColor: consentChecked ? C.primary : '#bbb',
                  backgroundColor: consentChecked ? C.primary : 'transparent',
                  marginRight: 10, marginTop: 2, alignItems: 'center', justifyContent: 'center',
                }}>
                  {consentChecked ? (
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path d="m5 12 5 5L20 7" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  ) : null}
                </View>
                <Text style={{ flex: 1, color: C.text, fontSize: 14, lineHeight: 19 }}>
                  J'accepte le traitement biométrique de mon image (RGPD art. 9).
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, !consentChecked && { opacity: 0.4 }]}
                onPress={acceptConsent}
                disabled={!consentChecked}
              >
                <Text style={s.btnPrimaryText}>Continuer</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
          {signupMode && (
            <Text style={{ color: C.textSoft, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
              Étape 2 sur 2
            </Text>
          )}
          <Text style={s.modalTitle}>{signupMode ? 'Prends ton selfie' : 'Mon selfie'}</Text>
          <Text style={s.modalSub}>
            {signupMode
              ? "Will reconnaîtra ton visage sur les photos des events auxquels tu participes. Image chiffrée, serveurs européens, supprimée 30 jours après ton dernier événement."
              : "Ton selfie est utilisé pour la reconnaissance faciale. Il est chiffré, stocké sur des serveurs européens, et supprimé automatiquement 30 jours après ton dernier événement."}
          </Text>

          <View style={s.selfiePreviewWrap}>
            <Animated.View style={{ transform: [{ scale: previewScale }] }}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={take}
                onPressIn={onPreviewPressIn}
                onPressOut={onPreviewPressOut}
              >
                {uri ? (
                  <ExpoImage source={{ uri }} style={s.selfiePreview} contentFit="cover" />
                ) : (
                  <View style={[s.selfiePreview, { backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                    <Icon.User size={80} color={C.primary} />
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={take}>
              <Text style={s.btnSecondaryText}>Prendre une photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={pick}>
              <Text style={s.btnSecondaryText}>Choisir</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.btnPrimary, !uri && { opacity: 0.4 }]} onPress={save} disabled={!uri || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Enregistrer mon selfie</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.modalCancel} onPress={signupMode ? (onSkip || onClose) : onClose}>
            <Text style={s.modalCancelText}>{signupMode ? 'Faire mon selfie plus tard' : 'Fermer'}</Text>
          </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>

      <SelfieCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(capturedUri) => {
          setUri(capturedUri);
          setCameraOpen(false);
        }}
      />
    </Modal>
  );
}

function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Reset flow (organisateur uniquement) : 'login' → 'reset-request' → 'reset-verify'
  const [resetMode, setResetMode] = useState('login');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  // PIN error UI (photographe) : shake animation + message inline + compteur tentatives.
  const [pinError, setPinError] = useState('');
  const [pinErrorTick, setPinErrorTick] = useState(0); // bumpe pour relancer le shake
  const [pinAttempts, setPinAttempts] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode(''); setPassword('');
      setResetMode('login'); setResetCode(''); setResetNewPassword('');
      setPinError(''); setPinAttempts(0); setRateLimited(false);
    }
  }, [visible]);

  const upcoming = events.filter(e => isUpcoming(e.event_date, e.event_date_end));

  const doLogin = async (pwdOverride) => {
    const pwd = (pwdOverride ?? password).trim();
    if (!code) return Alert.alert('Événement requis', role === 'photographer' ? 'Choisis un événement.' : 'Entre le code.');
    if (!pwd) {
      if (role === 'photographer') setPinError('Code PIN requis');
      else Alert.alert('Mot de passe requis');
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(code.trim(), pwd, role, 'photographer');
      setBusy(false);
      if (!r?.token) {
        if (role === 'photographer') {
          // 429 ou auth fail. api.login renvoie { error } sur non-2xx (cf api wrapper).
          const isRate = r?.status === 429 || /5 minutes|rate/i.test(String(r?.error || ''));
          if (isRate) {
            setRateLimited(true);
            setPinError('Trop de tentatives. Patiente 5 min.');
          } else {
            setPinAttempts(n => n + 1);
            setPinError(pinAttempts + 1 >= 3 ? 'Trop de tentatives. Patiente 5 min.' : 'Code PIN incorrect');
          }
          setPinErrorTick(t => t + 1);
          setPassword('');
        } else {
          Alert.alert('Échec', 'Identifiants invalides.');
        }
        return;
      }
      onSuccess(r);
    } catch {
      setBusy(false);
      if (role === 'photographer') {
        setPinError('Hors ligne');
        setPinErrorTick(t => t + 1);
      } else {
        Alert.alert(
          'Hors ligne',
          'Première connexion impossible sans réseau. Connecte-toi en wifi pour activer ton événement — ensuite l\'app fonctionnera offline.',
        );
      }
    }
  };
  const submit = () => doLogin();

  const requestReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!slug) return Alert.alert('Code requis', 'Saisis le code de ton événement avant de demander un reset.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/request-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data.error || 'Impossible d\'envoyer le code.');
        return;
      }
      setResetMode('reset-verify');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  const verifyReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!resetCode.trim()) return Alert.alert('Code requis', 'Saisis le code reçu par email.');
    if (!resetNewPassword || resetNewPassword.length < 4) return Alert.alert('Mot de passe trop court', '4 caractères minimum.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/verify-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug, reset_code: resetCode.trim(), new_password: resetNewPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Échec', data.error || 'Code invalide.');
        return;
      }
      // Mdp réinitialisé : on prépare l'auto-fill et on reviens à login
      setPassword(resetNewPassword);
      setResetMode('login');
      setResetCode(''); setResetNewPassword('');
      Alert.alert('Mot de passe réinitialisé', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            <Text style={[s.welcome, { color: role === 'photographer' ? C.pinkPill : C.primary, fontSize: 22, marginBottom: 4, marginTop: 4 }]}>
              {role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}
            </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18 }}>
              {role === 'photographer' ? 'Sélectionne ton événement et entre ton code PIN' : 'Connecte-toi à ton événement'}
            </Text>

            {role === 'photographer' ? (
              <>
                <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Événement</Text>
                <ScrollView style={{ maxHeight: 260, marginBottom: 12 }}>
                  {upcoming.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: C.textSoft, fontSize: 13 }}>Aucun événement à venir</Text>
                    </View>
                  )}
                  {(code ? upcoming.filter(e => e.code === code) : upcoming).map(e => {
                    const active = code === e.code;
                    return (
                      <TouchableOpacity
                        key={e.code}
                        onPress={() => setCode(active ? '' : e.code)}
                        activeOpacity={0.85}
                        style={{
                          backgroundColor: active ? C.pinkPill : '#faf9ff',
                          borderRadius: 12,
                          padding: 14,
                          marginBottom: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: active ? '#fff' : C.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{e.name}</Text>
                          <Text style={{ color: active ? 'rgba(255,255,255,0.85)' : C.textSoft, fontSize: 11, marginTop: 2 }}>
                            {formatDateLong(e.event_date, e.event_date_end)}{e.location ? ` · ${cityLabel(e.location)}` : ''}
                          </Text>
                        </View>
                        {active && (
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                              <Path d="M5 12l5 5L20 7" stroke={C.pinkPill} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                            </Svg>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {code ? (
                  <>
                    <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Code PIN photographe</Text>
                    <View style={{ marginTop: 4, marginBottom: 8 }}>
                      <PinInputRow
                        key={pinErrorTick /* force remount sur erreur pour reset focus */}
                        value={password}
                        onChange={(v) => { setPassword(v); if (pinError) setPinError(''); }}
                        autoFocus
                        error={!!pinError}
                        onComplete={(full) => {
                          if (rateLimited) return;
                          doLogin(full);
                        }}
                      />
                      {pinError ? (
                        <Text style={{ color: '#DC2626', fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: '500' }}>
                          {pinError}
                        </Text>
                      ) : null}
                      {busy ? (
                        <View style={{ alignItems: 'center', marginTop: 12 }}>
                          <ActivityIndicator color={C.pinkPill} />
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </>
            ) : resetMode !== 'login' ? (
              <>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
                  {resetMode === 'reset-request' ? 'Réinitialiser ton mot de passe' : 'Vérifier le code reçu'}
                </Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 14 }}>
                  {resetMode === 'reset-request'
                    ? `Un code à 6 chiffres sera envoyé à l'email enregistré pour cet événement.`
                    : `Code envoyé à l'email de l'organisateur. Valable 15 minutes.`}
                </Text>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  editable={resetMode === 'reset-request'}
                  style={[formSectionStyle.input, resetMode !== 'reset-request' && { opacity: 0.6 }]}
                />
                {resetMode === 'reset-verify' && (
                  <>
                    <TextInput
                      placeholder="Code reçu (6 chiffres)"
                      placeholderTextColor={C.textSoft}
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      style={formSectionStyle.input}
                    />
                    <TextInput
                      placeholder="Nouveau mot de passe"
                      placeholderTextColor={C.textSoft}
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                      secureTextEntry
                      style={formSectionStyle.input}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  style={formSectionStyle.input}
                />
                <TextInput
                  placeholder="Mot de passe"
                  placeholderTextColor={C.textSoft}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={formSectionStyle.input}
                />
                <TouchableOpacity
                  onPress={() => setResetMode('reset-request')}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginTop: -4, marginBottom: 4 }}
                >
                  <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
                </TouchableOpacity>
              </>
            )}

            {resetMode !== 'login' ? (
              <>
                <TouchableOpacity
                  onPress={resetMode === 'reset-request' ? requestReset : verifyReset}
                  disabled={resetBusy || (resetMode === 'reset-request' ? !code : (!resetCode || !resetNewPassword))}
                  style={{
                    backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14,
                    alignItems: 'center', marginTop: 8,
                    opacity: resetBusy ? 0.7 : 1,
                  }}
                >
                  {resetBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      {resetMode === 'reset-request' ? 'M\'envoyer un code' : 'Réinitialiser le mot de passe'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setResetMode('login'); setResetCode(''); setResetNewPassword(''); }}
                  hitSlop={6}
                  style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}
                >
                  <Text style={{ color: C.textSoft, fontSize: 13 }}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code || !password}
                style={{
                  backgroundColor: (code && password) ? C.primary : '#e9e4f9',
                  paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
                }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: (code && password) ? '#fff' : C.textSoft, fontSize: 15, fontWeight: '700' }}>Continuer</Text>}
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SearchModal({ visible, events, onClose, onPick }) {
  const upcoming = events.filter(e => isUpcoming(e.event_date, e.event_date_end));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>Mon événement</Text>
          <ScrollView style={{ maxHeight: 400, marginTop: 8 }}>
            {upcoming.length === 0 && <Text style={s.empty}>Aucun événement à venir</Text>}
            {upcoming.map(e => (
              <TouchableOpacity key={e.code} style={s.eventPick} onPress={() => { onPick(e); onClose(); }}>
                <Text style={s.eventPickName}>{e.name}</Text>
                <Text style={s.eventPickDate}>{formatDateLong(e.event_date, e.event_date_end)} · {cityLabel(e.location)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------- ROOT ----------
function ProfileMenuModal({ visible, onClose, selfieUri, onView, onRetake, onDelete, runnerSession, onLogout, onLogin, onUpdateProfile, onDeleteAccount, onDeleteFaceData }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const profile = runnerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await fetch(`${API_URL}/runner/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runnerSession.token}` },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setCurrentPwd(''); setNewPwd(''); setPwdConfirm('');
      setChangingPwd(false);
      Alert.alert('Mot de passe modifié', 'Ton nouveau mot de passe est actif.');
    } catch (e) {
      setPwdError('Erreur réseau');
    } finally {
      setPwdBusy(false);
    }
  };

  // Parse "27400 Louviers" → postalCode "27400", city "Louviers"
  const parseDept = (str = '') => {
    const m = String(str).match(/^(\d{5})\s+(.+)$/);
    return m ? { postalCode: m[1], city: m[2] } : { postalCode: '', city: str };
  };

  // Pré-remplit les champs en mode édition
  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
      const { postalCode: pc, city: cy } = parseDept(profile.department);
      setPostalCode(pc);
      setCity(cy);
    }
  }, [editing, profile]);

  // Suggestions ville
  useEffect(() => {
    if (!editing) return;
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setCitySuggestions((data || []).map(c => c.nom));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdateProfile?.({
        firstName,
        lastName,
        department: `${postalCode} ${city}`.trim(),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* En-tête */}
            {profile ? (
              <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                Hello {profile.firstName}
              </Text>
            ) : (
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>
                  Connecte-toi pour retrouver tes photos sur tous tes appareils
                </Text>
                <TouchableOpacity
                  style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 }}
                  onPress={() => { onClose(); onLogin?.(); }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Se connecter / S'inscrire</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bloc Selfie */}
            {profile && (
              <View style={profileCardStyles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => { onClose(); onRetake(); }}
                    style={{ width: 56, height: 56 }}
                    hitSlop={6}
                  >
                    {selfieUri ? (
                      <ExpoImage
                        source={{ uri: selfieUri }}
                        style={{ width: 56, height: 56, borderRadius: 999 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{
                        width: 56, height: 56, borderRadius: 999,
                        backgroundColor: C.primaryLight,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon.User size={28} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <Text style={profileCardStyles.label}>Selfie</Text>
                  <View style={{ flex: 1 }} />
                  {!selfieUri ? (
                    <TouchableOpacity onPress={() => { onClose(); onRetake(); }}>
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Ajouter</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 18 }}>
                      <TouchableOpacity onPress={onView}>
                        <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Voir</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { onClose(); onDelete(); }}>
                        <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Supprimer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Bloc Infos */}
            {profile && !editing && (
              <View style={profileCardStyles.card}>
                <InfoRow label="Prénom" value={profile.firstName} />
                <InfoRow label="Nom" value={profile.lastName} />
                <InfoRow label="Email" value={profile.email} />
                <InfoRow label="Ville" value={profile.department} last />
                <TouchableOpacity
                  onPress={() => setEditing(true)}
                  style={{ marginTop: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bloc Édition */}
            {profile && editing && (
              <View style={profileCardStyles.card}>
                <TextInput
                  placeholder="Prénom" placeholderTextColor={C.textSoft}
                  value={firstName} onChangeText={setFirstName}
                  style={authStyles.input}
                />
                <TextInput
                  placeholder="Nom" placeholderTextColor={C.textSoft}
                  value={lastName} onChangeText={setLastName}
                  style={authStyles.input}
                />
                <TextInput
                  placeholder="Code postal" placeholderTextColor={C.textSoft}
                  value={postalCode}
                  onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                  keyboardType="number-pad" maxLength={5}
                  style={authStyles.input}
                />
                {citySuggestions.length > 0 && !city && (
                  <ScrollView
                    style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                    keyboardShouldPersistTaps="handled"
                  >
                    {citySuggestions.map((c) => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => { setCity(c); setCitySuggestions([]); }}
                        style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                      >
                        <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                {city ? (
                  <TouchableOpacity
                    onPress={() => setCity('')}
                    style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                  >
                    <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                    <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setEditing(false)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                  >
                    <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={save} disabled={busy}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Enregistrer</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {profile && !editing && !changingPwd && (
              <TouchableOpacity onPress={() => setChangingPwd(true)} style={{ alignItems: 'center', marginTop: 6, paddingVertical: 10 }}>
                <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
              </TouchableOpacity>
            )}

            {profile && changingPwd && (
              <View style={profileCardStyles.card}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                  Changer mon mot de passe
                </Text>
                <PasswordInput
                  placeholder="Mot de passe actuel" placeholderTextColor={C.textSoft}
                  value={currentPwd} onChangeText={setCurrentPwd}
                  style={authStyles.input}
                />
                <PasswordInput
                  placeholder="Nouveau mot de passe (10 car. min)" placeholderTextColor={C.textSoft}
                  value={newPwd} onChangeText={setNewPwd}
                  style={authStyles.input}
                />
                <PasswordInput
                  placeholder="Confirmer le nouveau" placeholderTextColor={C.textSoft}
                  value={pwdConfirm} onChangeText={setPwdConfirm}
                  style={authStyles.input}
                />
                {pwdError ? <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 4 }}>{pwdError}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => { setChangingPwd(false); setCurrentPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                  >
                    <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={submitPwd} disabled={pwdBusy}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: pwdBusy ? 0.6 : 1 }}
                  >
                    {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Modifier</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {profile && (
              <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
                <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
              </TouchableOpacity>
            )}

            {profile && onDeleteFaceData && (
              <TouchableOpacity onPress={onDeleteFaceData} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 10 }}>
                <Text style={{ color: '#7B2FFF', fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
                  Supprimer mes données faciales
                </Text>
              </TouchableOpacity>
            )}

            {profile && onDeleteAccount && (
              <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                  Supprimer mon compte
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: '#f0eaff',
    }}>
      <Text style={{ color: C.textSoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' }} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

function OrganizerProfileMenuModal({ visible, onClose, organizerSession, onLogout, onUpdate, onDeleteAccount }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const profile = organizerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await fetch(`${API_URL}/organizer/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerSession.token}` },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      const data = await r.json();
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setOldPwd(''); setNewPwd(''); setPwdConfirm('');
      setChangingPwd(false);
      Alert.alert('Mot de passe modifié', 'Ton nouveau mot de passe est actif.');
    } catch (e) {
      setPwdError('Erreur réseau');
    } finally {
      setPwdBusy(false);
    }
  };

  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
    }
  }, [editing, profile]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdate?.({ firstName, lastName });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {profile && (
                <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                  Hello {profile.firstName}
                </Text>
              )}

              {profile && !editing && (
                <View style={profileCardStyles.card}>
                  <InfoRow label="Prénom" value={profile.firstName} />
                  <InfoRow label="Nom" value={profile.lastName} />
                  <InfoRow label="Email" value={profile.email} last />
                  <TouchableOpacity onPress={() => setEditing(true)} style={{ marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                  </TouchableOpacity>
                </View>
              )}

              {profile && editing && (
                <View style={profileCardStyles.card}>
                  <TextInput
                    placeholder="Prénom" placeholderTextColor={C.textSoft}
                    value={firstName} onChangeText={setFirstName}
                    style={authStyles.input}
                  />
                  <TextInput
                    placeholder="Nom" placeholderTextColor={C.textSoft}
                    value={lastName} onChangeText={setLastName}
                    style={authStyles.input}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => setEditing(false)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={save} disabled={busy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: busy ? 0.6 : 1 }}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Enregistrer</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && !editing && !changingPwd && (
                <TouchableOpacity onPress={() => setChangingPwd(true)} style={{ alignItems: 'center', marginTop: 6, paddingVertical: 10 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
                </TouchableOpacity>
              )}

              {profile && changingPwd && (
                <View style={profileCardStyles.card}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                    Changer mon mot de passe
                  </Text>
                  <PasswordInput
                    placeholder="Ancien mot de passe" placeholderTextColor={C.textSoft}
                    value={oldPwd} onChangeText={setOldPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Nouveau mot de passe (10 car. min)" placeholderTextColor={C.textSoft}
                    value={newPwd} onChangeText={setNewPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Confirmer le nouveau" placeholderTextColor={C.textSoft}
                    value={pwdConfirm} onChangeText={setPwdConfirm}
                    style={authStyles.input}
                  />
                  {pwdError ? <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 4 }}>{pwdError}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => { setChangingPwd(false); setOldPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitPwd} disabled={pwdBusy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: pwdBusy ? 0.6 : 1 }}
                    >
                      {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Modifier</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && (
                <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
                  <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
                </TouchableOpacity>
              )}

              {profile && onDeleteAccount && (
                <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                  <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                    Supprimer mon compte
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const profileCardStyles = StyleSheet.create({
  card: { backgroundColor: '#faf9ff', borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { color: C.text, fontSize: 16, fontWeight: '600' },
});

function SelfieViewerModal({ visible, uri, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' }}>
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 60, right: 20, padding: 10 }} hitSlop={20}>
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
        {uri ? (
          <ExpoImage source={{ uri }} style={{ width: '85%', aspectRatio: 1, borderRadius: 999 }} contentFit="cover" />
        ) : null}
      </View>
    </Modal>
  );
}

// expo-haptics : require optional pour rester OTA-safe.
// - Sur le build actuel (sans module natif expo-haptics linke) : les appels
//   selectionAsync echouent silencieusement via le catch (pas de crash).
// - Apres rebuild EAS (qui inclura le natif suite a la commande
//   `npx expo install expo-haptics`), les appels fonctionnent automatiquement
//   et declenchent UISelectionFeedbackGenerator (= tap court galerie iPhone).
let Haptics;
try { Haptics = require('expo-haptics'); } catch {}

// expo-splash-screen : controle manuel du hide du splash iOS natif.
// Sans ce module, iOS hide le splash automatiquement des que le bundle JS
// est charge -> contenu app apparait avant que les fonts (Font.loadAsync
// ~100-500ms) et le state initial soient prets -> saut visuel.
// preventAutoHideAsync() empeche le hide auto au load du bundle ; on appelle
// hideAsync() apres fontsLoaded (cf App() useEffect).
// Require optional pour OTA-safety : sans module natif linke, les appels
// echouent silencieusement -> aucun crash. Au prochain rebuild EAS, le
// natif sera inclus et le splash restera visible jusqu au hide explicite.
let SplashScreen;
try { SplashScreen = require('expo-splash-screen'); } catch {}
try { SplashScreen?.preventAutoHideAsync?.(); } catch {}

// Flag fonctionnalite Supprimer dans la visionneuse. Refonte 2026-05 : la
// suppression est en stand-by, on cable plus tard avec une confirmation
// adaptee. Garde le code mort pour activer en un flip. allowDelete continue
// d arriver via les opts du caller (compat) mais est ignore tant que ce flag
// est false.
const ENABLE_VIEWER_DELETE = false;

function PhotoViewerModal({
  visible, photo, photos, onClose,
  allowDelete, onDelete,
  photoFavoritesSet, onTogglePhotoFavorite,
  onTogglePhotoVisibility,
  origin, eventTitle, eventDate,
}) {
  const [busy, setBusy] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const winWidth = Dimensions.get('window').width;
  const winHeight = Dimensions.get('window').height;

  // SafeArea iPhone (sans dependance react-native-safe-area-context)
  const topPad = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0);
  const bottomPad = Platform.OS === 'ios' ? 34 : 16;

  // ─── Refonte v2 2026-05-21 : layout titre / photo / slider / bouton ─────
  // Animation shared-element : si origin est fourni (mesure measureInWindow
  // de la thumb tapee dans la grille), la photo demarre depuis cette position
  // et s anime vers sa cible (marge 5px, sous le titre). A la fermeture,
  // anim inverse vers origin puis onClose. Sinon fallback : apparition rapide.
  // 100% OTA via Reanimated 3 (deja installe).
  //
  // Role : detecte via props presentes (convention existante).
  const isOrga = !!onTogglePhotoVisibility;
  const isRunner = !!onTogglePhotoFavorite && !isOrga;

  // Override local optimiste du flag hidden de la photo courante. Le worker
  // est la source de verite ; cette map evite un lag visuel le temps que le
  // caller refetche apres le toggle. Reset a chaque ouverture du viewer.
  const [localHiddenMap, setLocalHiddenMap] = useState({});
  const effectiveHidden = (p) => {
    if (!p) return false;
    const ov = localHiddenMap[p.id];
    return ov === undefined ? p.hidden === true : ov;
  };

  // Layout cible (hauteurs fixes pour calcul de la zone photo)
  const HEADER_H = 56;          // titre + date
  const SLIDER_H = 64;          // slider 56px + padding
  const BUTTON_AREA_H = 78;     // bouton + paddings
  const photoMargin = 20;       // marge G/D autour de la photo principale
  const targetX = photoMargin;
  const targetY = topPad + HEADER_H;
  const targetW = winWidth - photoMargin * 2;
  const targetH = winHeight - topPad - HEADER_H - SLIDER_H - BUTTON_AREA_H - bottomPad - 8;

  // ── v2.3 refonte : Animation shared-element en TRANSFORM-ONLY ─────────
  // Au lieu d'animer left/top/width/height (re-layout cher → saccades), on
  // anime UNIQUEMENT translateX/Y + scale via Reanimated worklet (GPU-only).
  // Le conteneur photo a des dimensions FIXES (target) ; ce qui bouge est
  // sa transformation. C'est l'approche utilisee par Photos iOS, Instagram,
  // Twitter et co pour les transitions hero/shared-element fluides.
  //
  // entryTx/entryTy/entryScale : transform au mount depuis (thumb origin)
  // vers (0, 0, 1). Au unmount : transform vers la valeur (thumb origin).
  const entryTx = useSharedValue(0);
  const entryTy = useSharedValue(0);
  const entryScale = useSharedValue(1);
  const pradius = useSharedValue(18);     // anime de 8 -> 18 (paint-only, pas de re-layout)
  const bgOpacity = useSharedValue(0);    // fond viewer global
  const uiOpacity = useSharedValue(0);    // titre / date / slider / bouton / icones

  // Easing worklet inline pour transitions hero -> cubic ease-out
  // (ease out doux, pas d'overshoot). 320ms = sweet spot iOS Photos.
  // Worklet pour pouvoir etre invoque depuis le UI thread Reanimated.
  const HERO_DURATION = 320;
  const HERO_EASING = (t) => {
    'worklet';
    return 1 - Math.pow(1 - t, 3);
  };

  // Swipe horizontal du rail (3 cartes) + vertical (close)
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Zoom (pinch + double-tap) sur la card current uniquement
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const zoomTranslateX = useSharedValue(0);
  const savedZoomTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Bump du coeur favori
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  const resetTransforms = () => {
    translateX.value = 0;
    translateY.value = 0;
    scale.value = 1;
    savedScale.value = 1;
    savedTranslateY.value = 0;
    zoomTranslateX.value = 0;
    savedZoomTranslateX.value = 0;
  };

  // Card cible : full winWidth (pour permettre le peek carrousel des voisines).
  // Centre = (winWidth/2, targetY + targetH/2). photoMargin reste interne a
  // chaque card pour la marge G/D + radius.
  const cardW = winWidth;
  const cardH = targetH;
  const targetCardCx = winWidth / 2;
  const targetCardCy = targetY + targetH / 2;

  // ── Animation d'ouverture transform-only ──
  const animateIn = () => {
    if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) && origin.w > 0 && origin.h > 0) {
      // Centre de la thumb dans l'ecran
      const originCx = origin.x + origin.w / 2;
      const originCy = origin.y + origin.h / 2;
      // Transformations initiales pour que la card target apparaisse EXACTEMENT
      // a la position et taille de la thumb d'origine
      entryTx.value = originCx - targetCardCx;
      entryTy.value = originCy - targetCardCy;
      entryScale.value = origin.w / cardW;
      pradius.value = 10;                // approx radius grille
      // Animations transform-only (GPU-accelerated) avec easing iOS-like
      entryTx.value = withTiming(0, { duration: HERO_DURATION, easing: HERO_EASING });
      entryTy.value = withTiming(0, { duration: HERO_DURATION, easing: HERO_EASING });
      entryScale.value = withTiming(1, { duration: HERO_DURATION, easing: HERO_EASING });
      pradius.value = withTiming(18, { duration: HERO_DURATION, easing: HERO_EASING });
    } else {
      // Pas d'origin -> apparition directe (pas de transition shared-element)
      entryTx.value = 0; entryTy.value = 0; entryScale.value = 1;
      pradius.value = 18;
    }
    bgOpacity.value = withTiming(1, { duration: 220, easing: HERO_EASING });
    uiOpacity.value = withTiming(1, { duration: HERO_DURATION + 40, easing: HERO_EASING });
  };

  // ── Animation de fermeture : retrecit vers origin puis onClose ──
  const animateOutAndClose = () => {
    uiOpacity.value = withTiming(0, { duration: 160, easing: HERO_EASING });
    bgOpacity.value = withTiming(0, { duration: 260, easing: HERO_EASING });
    if (origin && Number.isFinite(origin.x)) {
      const originCx = origin.x + origin.w / 2;
      const originCy = origin.y + origin.h / 2;
      entryTx.value = withTiming(originCx - targetCardCx, { duration: 280, easing: HERO_EASING });
      entryTy.value = withTiming(originCy - targetCardCy, { duration: 280, easing: HERO_EASING });
      pradius.value = withTiming(10, { duration: 280, easing: HERO_EASING });
      entryScale.value = withTiming(origin.w / cardW, { duration: 280, easing: HERO_EASING }, (finished) => {
        if (finished) runOnJS(onClose)();
      });
    } else {
      setTimeout(onClose, 260);
    }
  };

  // À chaque ouverture du viewer : sync index, reset transforms, anim d'entree
  useEffect(() => {
    if (!visible) return;
    if (photo && photos) {
      const i = photos.findIndex(p => p.id === photo.id);
      if (i >= 0) setCurrentIndex(i);
    }
    resetTransforms();
    setLocalHiddenMap({});
    animateIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Bascule visibilite publique de la photo courante (orga uniquement).
  // Optimistic update local + appel callback worker, revert si echec.
  const handleToggleVisibility = async () => {
    if (!onTogglePhotoVisibility || !currentPhoto?.id || busy) return;
    const wasHidden = effectiveHidden(currentPhoto);
    setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: !wasHidden }));
    setBusy(true);
    try {
      const ok = await onTogglePhotoVisibility(currentPhoto.id, wasHidden);
      if (ok === false) {
        // Caller a fail (erreur reseau, 4xx, etc.). On revert.
        setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: wasHidden }));
      }
    } catch {
      setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: wasHidden }));
    } finally {
      setBusy(false);
    }
  };

  // Reset uniquement zoom au changement d'index (pas translateX qui est géré par l'anim)
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    zoomTranslateX.value = 0;
    savedZoomTranslateX.value = 0;
    translateY.value = 0;
    savedTranslateY.value = 0;
  }, [currentIndex]);

  // Refs pour callbacks stables
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const goToNext = () => {
    const i = currentIndexRef.current + 1;
    if (photos && i < photos.length) {
      setCurrentIndex(i);
      // Repositionne le rail instantanément (sans transition) pour que la nouvelle "current" soit centrée
      translateX.value = 0;
    } else {
      // Pas de suivante : retour
      translateX.value = withTiming(0, { duration: 200 });
    }
  };
  const goToPrev = () => {
    const i = currentIndexRef.current - 1;
    if (i >= 0) {
      setCurrentIndex(i);
      translateX.value = 0;
    } else {
      translateX.value = withTiming(0, { duration: 200 });
    }
  };

  // Refonte v2.2 : swipe type carte Tinder. Chaque photo = carte independante.
  // Drag horizontal -> translation + rotation legere (4-6deg max). Swipe
  // valide -> sortie franche + changement de currentIndex. Drag vertical bas
  // -> animateOutAndClose. Pinch zoom desactive le swipe horizontal.
  // v2.4 : panGesture VERTICAL UNIQUEMENT (swipe bas = close). Le swipe
  // horizontal est delegue au FlatList natif (pagingEnabled) pour eviter
  // le flash de l'ancienne carte au commit du swipe (bug v2.3 : race
  // entre translateX.value=0 sync et setCurrentIndex async React).
  // - activeOffsetY([-15,15]) : pan devient actif si drag vertical > 15px
  // - failOffsetX([-30,30]) : pan fail si drag horizontal > 30px (FlatList prend)
  // Pinch zoom + double-tap zoom restent intacts.
  const panGesture = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      if (scale.value > 1) {
        zoomTranslateX.value = savedZoomTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1) {
        savedZoomTranslateX.value = zoomTranslateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      // Swipe vertical bas -> fermeture
      if (translateY.value > 100 || e.velocityY > 800) {
        runOnJS(animateOutAndClose)();
        return;
      }
      translateY.value = withTiming(0, { duration: 220 });
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withTiming(1);
        zoomTranslateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedZoomTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  // Double-tap : toggle zoom 1 <-> 2.5x sur la photo courante.
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(280)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1, { duration: 180 });
        savedScale.value = 1;
        zoomTranslateX.value = withTiming(0, { duration: 180 });
        savedZoomTranslateX.value = 0;
        translateY.value = withTiming(0, { duration: 180 });
        savedTranslateY.value = 0;
      } else {
        scale.value = withTiming(2.5, { duration: 180 });
        savedScale.value = 2.5;
      }
    });

  // Refonte v2 : plus de single-tap toggle overlays — tout est statique.
  // Le X de fermeture et le coeur favori sont positionnes en bas-droite de
  // la photo, toujours visibles via uiOpacity (anim du fade in/out global).
  const composed = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

  const currentPhoto = photos?.[currentIndex] || photo;
  const prevPhoto = photos?.[currentIndex - 1];
  const nextPhoto = photos?.[currentIndex + 1];

  const download = async () => {
    if (!currentPhoto?.uri || busy) return;
    setBusy(true);
    let staged = null;
    try {
      // Permission iOS : write-only suffit pour ajouter à la pellicule (moins invasif).
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert('Permission refusée', 'Autorise l\'accès aux photos pour sauvegarder dans la pellicule.');
        return;
      }

      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) {
        Alert.alert('Hors ligne', 'Pas de connexion internet — impossible de télécharger la photo.');
        return;
      }

      const url = currentPhoto.uri;
      const ext = await detectPhotoExtension(url);
      const filename = `will_${Date.now()}.${ext}`;
      staged = new File(Paths.cache, filename);
      const downloaded = await File.downloadFileAsync(url, staged, { idempotent: true });
      const localUri = downloaded?.uri || staged.uri;

      try {
        await MediaLibrary.saveToLibraryAsync(localUri);
        Alert.alert('Photo sauvegardée', 'Disponible dans ta pellicule Photos.');
      } catch (saveErr) {
        // ProRAW (.dng) : la pellicule peut refuser sur certains iOS.
        if (ext === 'dng') {
          Alert.alert(
            'Format DNG non supporté',
            'La pellicule iOS n\'accepte pas ce fichier RAW. Demande au photographe une version JPEG.'
          );
        } else {
          throw saveErr;
        }
      }
    } catch (e) {
      const msg = e?.message || '';
      const friendly =
        /Network|network|ENOTFOUND|ECONN|timeout|UnableToDownload/i.test(msg)
          ? 'Échec du téléchargement — vérifie ta connexion et réessaie.'
          : (msg || 'Impossible de sauvegarder');
      Alert.alert('Erreur', friendly);
    } finally {
      try { if (staged?.exists) staged.delete(); } catch {}
      setBusy(false);
    }
  };

  const deleteCurrent = () => {
    if (!currentPhoto?.id) return;
    Alert.alert(
      'Supprimer cette photo ?',
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            onDelete?.([currentPhoto.id]);
            if (photos && photos.length > 1) {
              if (currentIndex >= photos.length - 1) {
                setCurrentIndex(currentIndex - 1);
              }
            } else {
              onClose();
            }
          },
        },
      ]
    );
  };

  const currentHidden = effectiveHidden(currentPhoto);
  const fav = currentPhoto?.id && photoFavoritesSet?.has(currentPhoto.id);

  // Sync bidirectionnel slider <-> photo principale via currentIndex :
  // - tap miniature OU scroll slider -> setCurrentIndex
  // - useEffect ci-dessous propage a la fois au slider et a la FlatList photo
  // L'animation native FlatList est doucement amortie (decelerationRate normal).
  const sliderRef = useRef(null);
  // Index de la derniere miniature qui a declenche un haptic. Evite de
  // re-tapper sur le meme idx quand onScroll fire plusieurs fois pour la
  // meme position. Initialise au currentIndex courant.
  const lastHapticIdxRef = useRef(currentIndex);
  useEffect(() => {
    if (!photos || currentIndex < 0 || currentIndex >= photos.length) return;
    try { sliderRef.current?.scrollToOffset({ offset: currentIndex * 50, animated: true }); }
    catch {}
    // Photo principale : scroll-to-index avec animation. Pas necessaire si
    // l'index vient d'un onMomentumScrollEnd de cette meme FlatList (deja a
    // jour), mais inoffensif (animated:true ne re-scroll pas si deja en place).
    // v2.5 point 3 : animation grande photo SUPPRIMEE quand le slider change.
    // Snap instantane (animated:false) -> l'image en haut apparait directement,
    // pas de glissement parasite. Le swipe horizontal sur la grande photo
    // reste anime nativement par FlatList pagingEnabled (geste direct user).
    try { photoListRef.current?.scrollToOffset({ offset: currentIndex * cardW, animated: false }); }
    catch {}
  }, [currentIndex, photos]);

  // v2.5 point 1 : re-prefetch des photos au retour foreground pour eviter
  // le grisage. iOS purge le cache memoire d ExpoImage en background ;
  // au retour, declencher prefetch sur (current, next, prev) anticipe la
  // decompression et evite le placeholder gris.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !photos || !visible) return;
      const urls = [];
      const cur = photos[currentIndex];
      const next = photos[currentIndex + 1];
      const prev = photos[currentIndex - 1];
      if (cur?.uri) urls.push(cur.uri);
      if (next?.uri) urls.push(next.uri);
      if (prev?.uri) urls.push(prev.uri);
      if (urls.length && ExpoImage.prefetch) {
        ExpoImage.prefetch(urls).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [currentIndex, photos, visible]);

  // Progressive loading : precharge la photo suivante et precedente pour que
  // les swipes Tinder enchainent sans latence. ExpoImage cache memory-disk
  // -> les prefetches restent en cache pour le swap instantane.
  useEffect(() => {
    if (!photos) return;
    const urls = [];
    const next = photos[currentIndex + 1];
    const prev = photos[currentIndex - 1];
    if (next?.uri) urls.push(next.uri);
    if (prev?.uri) urls.push(prev.uri);
    if (urls.length && ExpoImage.prefetch) {
      ExpoImage.prefetch(urls).catch(() => {});
    }
  }, [currentIndex, photos]);

  // ── Styles animes v2.3 : tout en TRANSFORM, dimensions FIXES ──
  // entryStyle : transform global de la card target depuis origin
  // (translation + scale), pas de left/top/width/height anime
  const entryStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: entryTx.value },
      { translateY: entryTy.value },
      { scale: entryScale.value },
    ],
  }));
  // radius anime (paint-only, pas de re-layout)
  const radiusStyle = useAnimatedStyle(() => ({ borderRadius: pradius.value }));
  const bgStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
  const uiStyle = useAnimatedStyle(() => ({ opacity: uiOpacity.value }));

  // Drop-shadow NOIR pour icones BLANCHES (coeur favori bas-droite photo) :
  // lisibles sur photo claire (ombre noire derriere le blanc cree relief)
  // ET sur photo sombre (icone blanche se detache nettement).
  const iconShadowWhiteStyle = Platform.OS === 'ios'
    ? { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }
    : null;

  // Couleur du fond viewer : blanc (l'app est globalement blanche)
  const viewerBg = '#fff';

  // v2.4 : FlatList horizontal pagingEnabled gere le swipe horizontal nativement
  // (plus de rail manuel 3 cartes -> elimine le bug flash v2.3). Le vertStyle
  // n applique que translateY pour le close-swipe vertical.
  const vertStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  // Ref FlatList photo principale : permet le sync depuis le slider
  // (tap miniature -> scrollToIndex).
  const photoListRef = useRef(null);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={animateOutAndClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {/* Fond blanc anime (fade in au mount, fade out a la fermeture) */}
          <ReAnimated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: viewerBg }, bgStyle]}
          />

          {/* Header : titre event + date (fade in apres l'anim shared-element) */}
          <ReAnimated.View
            pointerEvents="none"
            style={[{
              position: 'absolute', top: topPad, left: 0, right: 0, height: HEADER_H,
              alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
            }, uiStyle]}
          >
            {eventTitle ? (
              <Text numberOfLines={1} style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 }}>
                {eventTitle}
              </Text>
            ) : null}
            {eventDate ? (
              <Text style={{ color: '#9ca3af', fontSize: 13, marginTop: 2 }}>{eventDate}</Text>
            ) : null}
          </ReAnimated.View>

          {/* Photo principale : container target fixe (position+taille) anime
              en TRANSFORM (translate + scale) depuis origin. A l'interieur,
              un rail de 3 cartes (prev/current/next) avec peek visible des
              voisines aux bords. */}
          {/* v2.4 : photo principale en FlatList horizontal pagingEnabled.
              Le scroll natif elimine le flash bug v2.3 (race race translateX
              reset / setCurrentIndex). Le wrapper entryStyle anime depuis
              origin (shared-element) en transform-only. */}
          <ReAnimated.View
            pointerEvents="box-none"
            style={[{
              position: 'absolute',
              left: 0, top: targetY,
              width: cardW, height: cardH,
            }, entryStyle]}
          >
            <GestureDetector gesture={composed}>
              <ReAnimated.View style={[{ flex: 1 }, vertStyle]}>
                <FlatList
                  ref={photoListRef}
                  data={photos}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={currentIndex}
                  keyExtractor={(p, i) => p.id || `photo-${i}`}
                  getItemLayout={(_, index) => ({ length: cardW, offset: cardW * index, index })}
                  onScrollToIndexFailed={(info) => {
                    setTimeout(() => photoListRef.current?.scrollToOffset({
                      offset: cardW * info.index, animated: false,
                    }), 50);
                  }}
                  onMomentumScrollEnd={(e) => {
                    const offset = e.nativeEvent.contentOffset.x;
                    const idx = Math.round(offset / cardW);
                    if (idx !== currentIndex && idx >= 0 && photos && idx < photos.length) {
                      setCurrentIndex(idx);
                    }
                  }}
                  renderItem={({ item }) => (
                    <View style={{ width: cardW, height: cardH, paddingHorizontal: photoMargin }}>
                      <ReAnimated.View style={[{ flex: 1, overflow: 'hidden', backgroundColor: '#f5f5f5' }, radiusStyle]}>
                        {item?.uri ? (
                          <ExpoImage
                            source={{ uri: item.uri }}
                            placeholder={{ uri: item.uri }}
                            style={{ flex: 1 }}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            priority="high"
                            transition={0}
                            recyclingKey={item.id}
                          />
                        ) : null}
                      </ReAnimated.View>
                    </View>
                  )}
                />
              </ReAnimated.View>
            </GestureDetector>

            {/* Coeur favori en overlay au-dessus de la FlatList photo.
                Un seul coeur, lie au currentIndex (pas duplique par item).
                Blanc + drop-shadow noir pour lisibilite cross-fond. */}
            {isRunner ? (
              <ReAnimated.View
                pointerEvents="box-none"
                style={[{
                  position: 'absolute', bottom: 12, right: photoMargin + 8,
                }, uiStyle]}
              >
                <ReAnimated.View style={heartStyle}>
                  <TouchableOpacity
                    onPress={() => {
                      heartScale.value = withTiming(0.85, { duration: 90 }, () => {
                        heartScale.value = withTiming(1, { duration: 140 });
                      });
                      onTogglePhotoFavorite(currentPhoto.id);
                    }}
                    hitSlop={12}
                    style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
                    accessibilityLabel={fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                  >
                    <Svg width={26} height={26} viewBox="-1 -1.5 22.78 20.61"
                      fill={fav ? '#fff' : 'none'} stroke="#fff" strokeWidth={2}
                      style={iconShadowWhiteStyle}
                    >
                      <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
                    </Svg>
                  </TouchableOpacity>
                </ReAnimated.View>
              </ReAnimated.View>
            ) : null}
          </ReAnimated.View>

          {/* X haut-droite de la PAGE, noire (point 6). Toujours visible
              pendant l'animation hero (fade-in via uiStyle). */}
          <ReAnimated.View
            style={[{
              position: 'absolute', top: topPad + 4, right: 12, zIndex: 20,
            }, uiStyle]}
          >
            <TouchableOpacity
              onPress={animateOutAndClose}
              hitSlop={16}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Fermer"
            >
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path d="m8 8 8 8M16 8l-8 8" stroke="#000" strokeWidth={2.6} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </ReAnimated.View>

          {/* Slider PELLICULE à cadre central FIXE (style scrubber video iPhone).
              Les miniatures coulissent ; un cadre rose absolute marque la
              position centrale. La miniature sous le cadre = photo courante.
              Sync bidirectionnelle :
                - tap miniature → setCurrentIndex
                - scroll slider → onMomentumScrollEnd → setCurrentIndex
                - swipe carte → useEffect → scrollToOffset */}
          <ReAnimated.View
            style={[{
              position: 'absolute', left: 0, right: 0,
              top: targetY + cardH + 8, height: SLIDER_H,
              justifyContent: 'center',
            }, uiStyle]}
          >
            {photos && photos.length > 0 ? (
              <>
                <FlatList
                  ref={sliderRef}
                  data={photos}
                  horizontal
                  keyExtractor={(p, i) => p.id || `slider-${i}`}
                  showsHorizontalScrollIndicator={false}
                  initialNumToRender={12}
                  windowSize={5}
                  snapToInterval={50}
                  decelerationRate="fast"
                  getItemLayout={(_, index) => ({ length: 50, offset: 50 * index, index })}
                  onScrollToIndexFailed={(info) => {
                    setTimeout(() => sliderRef.current?.scrollToOffset({
                      offset: (info.averageItemLength || 50) * info.index, animated: true,
                    }), 50);
                  }}
                  // Haptic tap iOS (UISelectionFeedbackGenerator) sur CHAQUE
                  // miniature qui passe sous le cadre central pendant le scroll
                  // -- pas seulement au snap final. Style galerie iPhone.
                  // lastHapticIdxRef evite de re-tapper sur la meme miniature
                  // si onScroll fire plusieurs fois pour le meme index.
                  scrollEventThrottle={16}
                  onScroll={(e) => {
                    const offset = e.nativeEvent.contentOffset.x;
                    const idx = Math.round(offset / 50);
                    if (idx !== lastHapticIdxRef.current && idx >= 0 && idx < photos.length) {
                      lastHapticIdxRef.current = idx;
                      try { Haptics?.selectionAsync?.(); } catch {}
                    }
                  }}
                  onMomentumScrollEnd={(e) => {
                    // Commit du currentIndex UNIQUEMENT au snap final (sinon la
                    // grande photo en haut sauterait a chaque miniature passee).
                    const offset = e.nativeEvent.contentOffset.x;
                    const idx = Math.round(offset / 50);
                    if (idx !== currentIndex && idx >= 0 && idx < photos.length) {
                      setCurrentIndex(idx);
                    }
                  }}
                  // v2.5 point 4 : padding extra a la FIN pour permettre de
                  // slider un peu plus que la derniere miniature (effet
                  // over-scroll iPhone Photos). Le padding gauche reste pile
                  // pour que l item 0 tombe sous le cadre central.
                  contentContainerStyle={{
                    alignItems: 'center',
                    paddingLeft: (winWidth - 44) / 2,
                    paddingRight: (winWidth - 44) / 2 + 60,   // +60 = over-scroll droit
                  }}
                  renderItem={({ item, index }) => (
                    <TouchableOpacity
                      onPress={() => setCurrentIndex(index)}
                      activeOpacity={0.85}
                      style={{
                        // v2.5 point 4 : thumb 44x44 (etait 56x56) -> plus de
                        // miniatures visibles a la fois, slider plus aere.
                        width: 44, height: 44, marginRight: 6,
                        borderRadius: 6, overflow: 'hidden',
                      }}
                    >
                      {/* v2.5 point 2 : hint de taille au decodeur (downsample
                          si supporte). Reduit la conso memoire + le temps de
                          decompression au retour foreground. */}
                      <ExpoImage
                        source={{ uri: item.uri, width: 88, height: 88 }}
                        style={{ flex: 1 }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        priority="low"
                        transition={80}
                        recyclingKey={item.id}
                      />
                    </TouchableOpacity>
                  )}
                />
                {/* Cadre rose central FIXE (overlay pointer-events:none) */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: (winWidth - 44) / 2 - 2, // -2 pour centrer le cadre sur la thumb 44
                    top: (SLIDER_H - 44) / 2 - 2,
                    width: 48, height: 48,
                    borderRadius: 8,
                    borderWidth: 2,
                    borderColor: '#F4A6FF',
                  }}
                />
                {/* v2.4 point 2 : fade-out blanc aux extremites du slider.
                    LinearGradient overlay gauche (blanc -> transparent) et
                    droite (transparent -> blanc), pointerEvents=none pour ne
                    pas bloquer le scroll. Largeur 40px = ~2/3 d'une miniature. */}
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 40,
                  }}
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 40,
                  }}
                />
              </>
            ) : null}
          </ReAnimated.View>

          {/* Bouton bas : Telecharger (coureur, violet primary) OU
              Publier/Masquer (orga, rose Will). Supprimer cache par flag. */}
          <ReAnimated.View
            style={[{
              position: 'absolute', left: 0, right: 0, bottom: bottomPad,
              height: BUTTON_AREA_H, paddingHorizontal: 24,
              alignItems: 'center', justifyContent: 'center',
            }, uiStyle]}
          >
            {isOrga ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
                <TouchableOpacity
                  onPress={handleToggleVisibility}
                  disabled={busy}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, paddingVertical: 14, borderRadius: 999,
                    backgroundColor: '#F4A6FF',   // rose Will pinkPill (orga)
                    alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'row', gap: 8,
                    opacity: busy ? 0.65 : 1,
                  }}
                  accessibilityLabel={currentHidden ? 'Publier dans la galerie publique' : 'Masquer de la galerie publique'}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : currentHidden ? (
                    <>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                        <Path d="m4 12 5 5L20 6" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Publier</Text>
                    </>
                  ) : (
                    <>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                        <Path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5.5 0 9.5 5 9.5 6-.3.6-1 1.7-2 2.9M6.6 6.6C4.3 8.1 3 10.5 2.5 12c0 1 4 6 9.5 6 1.7 0 3.2-.4 4.5-1" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
                        <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
                      </Svg>
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Masquer</Text>
                    </>
                  )}
                </TouchableOpacity>
                {ENABLE_VIEWER_DELETE && allowDelete ? (
                  <TouchableOpacity
                    onPress={deleteCurrent}
                    activeOpacity={0.85}
                    style={{
                      width: 50, paddingVertical: 14, borderRadius: 999,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'rgba(255,255,255,0.12)',
                    }}
                    accessibilityLabel="Supprimer"
                  >
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                      <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <TouchableOpacity
                onPress={download}
                disabled={busy}
                activeOpacity={0.85}
                style={{
                  paddingVertical: 14, paddingHorizontal: 32, borderRadius: 999,
                  backgroundColor: '#7B2FFF',   // violet primary (coureur)
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 8,
                  opacity: busy ? 0.65 : 1, minWidth: 220,
                }}
                accessibilityLabel="Télécharger la photo"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Télécharger</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </ReAnimated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: C.textSoft };
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  // 0-1: faible, 2: moyen, 3-4: fort, 5: très fort
  if (score <= 1) return { score: 1, label: 'Faible', color: '#EF4444' };
  if (score === 2) return { score: 2, label: 'Moyen', color: '#F59E0B' };
  if (score <= 4) return { score: 3, label: 'Fort', color: '#10B981' };
  return { score: 4, label: 'Très fort', color: '#059669' };
}

function AuthRunnerModal({ visible, onClose, onSuccess, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pré-remplit l'email avec la dernière valeur connue à chaque ouverture.
  // Et resynchronise le mode (login/register) sur l'intention d'ouverture.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    AsyncStorage.getItem('@will_last_email_runner').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible, initialMode]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setPostalCode(''); setCity(''); setCitySuggestions([]);
    setError(''); setBusy(false);
  };

  const pwdStrength = passwordStrength(password);

  // Quand le code postal change → fetch les villes
  useEffect(() => {
    if (mode !== 'register') return;
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        // Auto-sélectionne si 1 seule ville pour ce code postal
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode, mode]);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, firstName, lastName, department: `${postalCode} ${city}`.trim() };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile, isNewSignup: mode === 'register' });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        >
          <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
          {mode === 'register' && (
            <Text style={{ color: C.textSoft, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
              Étape 1 sur 2
            </Text>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>

          {mode === 'register' && (
            <>
              <TextInput
                placeholder="Prénom"
                placeholderTextColor={C.textSoft}
                value={firstName}
                onChangeText={setFirstName}
                style={authStyles.input}
              />
              <TextInput
                placeholder="Nom"
                placeholderTextColor={C.textSoft}
                value={lastName}
                onChangeText={setLastName}
                style={authStyles.input}
              />
              <TextInput
                placeholder="Code postal"
                placeholderTextColor={C.textSoft}
                value={postalCode}
                onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                keyboardType="number-pad"
                maxLength={5}
                style={authStyles.input}
              />
              {citySuggestions.length > 0 && !city && (
                <ScrollView
                  style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                  keyboardShouldPersistTaps="handled"
                >
                  {citySuggestions.map((c) => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => { setCity(c); setCitySuggestions([]); }}
                      style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                    >
                      <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {city ? (
                <TouchableOpacity
                  onPress={() => setCity('')}
                  style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                >
                  <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                  <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
          <TextInput
            placeholder="Email"
            placeholderTextColor={C.textSoft}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={authStyles.input}
          />
          <PasswordInput
            placeholder="Mot de passe"
            placeholderTextColor={C.textSoft}
            value={password}
            onChangeText={setPassword}
            style={authStyles.input}
          />
          {mode === 'register' && password ? (
            <View style={{ marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                {[1, 2, 3, 4].map((i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9',
                    }}
                  />
                ))}
              </View>
              <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>
                {pwdStrength.label}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4, marginBottom: 8 }}>{error}</Text>
          ) : null}

          <TouchableOpacity
            onPress={submit}
            disabled={busy}
            style={{
              backgroundColor: C.primary,
              paddingVertical: 14,
              borderRadius: 14,
              alignItems: 'center',
              marginTop: 12,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                {mode === 'login' ? 'Se connecter' : "S'inscrire"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Text style={{ color: C.textSoft, fontSize: 13 }}>
              {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
            </Text>
          </TouchableOpacity>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const authStyles = StyleSheet.create({
  input: {
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    marginBottom: 10,
  },
});

function AuthOrganizerModal({ visible, onClose, onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pré-remplit l'email avec la dernière valeur connue à chaque ouverture.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem('@will_last_email_organizer').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setError(''); setBusy(false);
  };

  const pwdStrength = passwordStrength(password);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const url = mode === 'login' ? '/organizer/login' : '/organizer/register';
      const body = mode === 'login' ? { email, password } : { email, password, firstName, lastName };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>
                {mode === 'login' ? 'Espace organisateur' : 'Créer un compte organisateur'}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            {mode === 'register' && (
              <>
                <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={authStyles.input} />
                <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={authStyles.input} />
              </>
            )}
            <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={authStyles.input} />
            <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={authStyles.input} />

            {mode === 'register' && password ? (
              <View style={{ marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>{pwdStrength.label}</Text>
              </View>
            ) : null}

            {error ? <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4, marginBottom: 8 }}>{error}</Text> : null}

            <TouchableOpacity onPress={submit} disabled={busy} style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: C.textSoft, fontSize: 13 }}>
                {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Détail événement (vue orga). Reproduit la card expanded du dashboard /orga :
// bandeau coloré + statut + actions + identifiants + facturation + lien delete.
// ─────────────────────────────────────────────────────────────────────────────
function OrganizerEventDetailScreen({ session, event, onClose, onEdit, onOpenPhotos, onDeleted }) {
  const tint = colorForType(event.event_type);
  const [revealPwd, setRevealPwd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photographerPwd = event?.photographer_password || '';
  const isReady = !!event?.active;
  const dotColor = isReady ? '#34D399' : '#FBBF24';
  const statusLabel = isReady ? 'Prêt à démarrer' : 'En attente';

  const dateStr = event.event_date
    ? new Date(event.event_date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '').toUpperCase()
    : 'Date à définir';

  // "J-3" avant l'event, "GO !" pendant toute la durée (event_date →
  // event_date_end), "J+5" après. End absent → single-day (start = end).
  const countdown = (() => {
    if (!event.event_date) return null;
    const start = new Date(event.event_date);
    if (isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    const end = event.event_date_end ? new Date(event.event_date_end) : new Date(event.event_date);
    if (isNaN(end.getTime())) end.setTime(start.getTime());
    end.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (t < start) return `J-${Math.round((start - t) / 86400000)}`;
    if (t <= end) return 'GO !';
    return `J+${Math.round((t - end) / 86400000)}`;
  })();

  const copyPwd = async () => {
    if (!photographerPwd) return;
    try { await Share.share({ message: photographerPwd }); } catch {}
  };

  const sharePublicLink = async () => {
    try { await Share.share({ message: `https://will-app.com/event/${event.code}` }); } catch {}
  };

  const confirmDelete = () => {
    Alert.alert(
      'Supprimer cet événement ?',
      'Cette action est définitive et irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const r = await fetch(`${API_URL}/organizer/event/${event.code}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.token}` },
              });
              if (!r.ok) {
                const data = await r.json().catch(() => ({}));
                Alert.alert('Erreur', data.error || 'Suppression impossible');
                setDeleting(false);
                return;
              }
              onDeleted?.();
            } catch (e) {
              Alert.alert('Erreur', e.message || 'Erreur réseau');
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const sub = [event.location, event.event_type ? displayEventType(event.event_type) : null].filter(Boolean).join(' · ');

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 }}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={{ color: C.primary, fontSize: 16, fontWeight: '500' }}>‹ Fermer</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Bandeau coloré */}
          <View style={{ height: 180, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: tint, position: 'relative' }}>
            {event.cover_image ? (
              <ExpoImage source={{ uri: event.cover_image }} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" />
            ) : null}
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.55)']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <View style={{ flex: 1, padding: 18, justifyContent: 'flex-end' }}>
              <Text style={{ color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600', letterSpacing: 1.2, marginBottom: 6 }}>
                {dateStr}
              </Text>
              <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }} numberOfLines={1}>
                {event.name}
              </Text>
              {sub ? (
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4 }} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
              <View style={{ marginTop: 10, flexDirection: 'row' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' }}>
                  <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor }} />
                  <Text style={{ color: '#1A1A1A', fontSize: 12, fontWeight: '500' }}>{statusLabel}</Text>
                </View>
              </View>
            </View>
            {countdown ? (
              <Text style={{ position: 'absolute', right: 14, bottom: 10, color: '#fff', fontSize: 32, fontWeight: '700', fontStyle: 'italic', letterSpacing: -1 }}>
                {countdown}
              </Text>
            ) : null}
          </View>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 16 }}>
            <TouchableOpacity onPress={onOpenPhotos} style={{ flex: 2, backgroundColor: C.primary, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Voir les photos</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} style={{ flex: 2, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Modifier</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={sharePublicLink} style={{ flex: 1, backgroundColor: '#F3EBFF', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: C.primary, fontSize: 18, fontWeight: '600' }}>↗</Text>
            </TouchableOpacity>
          </View>

          {/* Code PIN photographe */}
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Code PIN photographe</Text>
            <Text style={{ fontSize: 13, color: C.textSoft, marginTop: 2 }}>À transmettre à tes photographes le jour J</Text>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              {isValidPin(photographerPwd) ? (
                <PinDisplay pin={photographerPwd} masked={!revealPwd} />
              ) : (
                <Text style={{ color: C.textSoft, fontSize: 14 }}>Non défini</Text>
              )}
              <View style={{ flexDirection: 'row', gap: 18, marginTop: 14 }}>
              {isValidPin(photographerPwd) ? (
                <>
                  <TouchableOpacity onPress={() => setRevealPwd(v => !v)} hitSlop={8}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>{revealPwd ? 'Masquer' : 'Afficher'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={copyPwd} hitSlop={8}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Copier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onEdit} hitSlop={8}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Modifier</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity onPress={onEdit} hitSlop={8}>
                  <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>Définir</Text>
                </TouchableOpacity>
              )}
              </View>
            </View>
          </View>

          {/* Facturation */}
          <View style={{ marginHorizontal: 16, marginTop: 28 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Facturation</Text>
            <Text style={{ fontSize: 14, color: C.text, marginTop: 8 }}>Offre partenaire gratuite</Text>
          </View>

          {/* Lien Supprimer */}
          <View style={{ marginTop: 36, alignItems: 'center' }}>
            <TouchableOpacity onPress={confirmDelete} disabled={deleting} hitSlop={12}>
              <Text style={{ color: deleting ? C.textSoft : '#DC2626', fontSize: 14, fontWeight: '500' }}>
                {deleting ? 'Suppression…' : 'Supprimer cet événement'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OrganizerEventPhotosScreen({ session, event, onClose, onOpenPhoto }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [raceFilter, setRaceFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  // Compteur "X masquées" en tête de galerie + busy state pour le toggle.
  const [hiddenCount, setHiddenCount] = useState(0);
  const [busyKey, setBusyKey] = useState(null);
  const tint = colorForType(event.event_type);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setVisibleCount(20);
    try {
      const r = await fetch(`${API_URL}/organizer/event-photos/${event.code}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = r.ok ? await r.json() : { before_event: [], during_event: [], hidden_count: 0 };
      // Le worker separe les photos en before_event (setup/test avant l'heure
      // de depart) et during_event (course). Cote mobile on les fusionne et
      // on trie par burstTs DESC : les plus recentes en haut, ce qui revient
      // naturellement a mettre during_event au-dessus de before_event.
      // Filtre defensif : on jette les entrees qui n'ont pas url+key string
      // valides — une entree bancale peut faire crasher ExpoImage au render.
      const raw = [...(data.during_event || []), ...(data.before_event || [])];
      const list = raw
        .filter(p => p && typeof p.url === 'string' && p.url.length > 0
                       && typeof p.key === 'string' && p.key.length > 0)
        .map(p => ({
          uri: p.url,
          id: p.key,
          tint,
          race: p.race,
          km: p.km,
          hidden: p.hidden === true,   // propagation du flag worker
        }));
      setHiddenCount(typeof data.hidden_count === 'number' ? data.hidden_count : 0);
      // Tri : burstTs DESC puis idx DESC au sein d'une rafale.
      list.sort((a, b) => {
        const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
        if (dt !== 0) return dt;
        return extractIdx(b.id) - extractIdx(a.id);
      });
      setPhotos(list.slice(0, 500));
    } catch (e) {
      console.warn('loadPhotos failed:', e?.message || e);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [event.code, session.token, tint]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadPhotos(); } finally { setRefreshing(false); }
  }, [loadPhotos]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadPhotos();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, [loadPhotos]);

  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const t = setTimeout(() => setVisibleCount(v => Math.min(v + 20, photos.length)), 300);
    return () => clearTimeout(t);
  }, [visibleCount, photos.length]);

  const filteredPhotos = raceFilter === 'all'
    ? photos
    : photos.filter(p => p.race === raceFilter || !p.race);

  const distances = Array.isArray(event.distances) ? event.distances : [];

  const toggleSelect = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePhotoPress = (photo) => {
    if (selectionMode) {
      toggleSelect(photo.id);
    } else {
      // onTogglePhotoVisibility est consomme par PhotoViewerModal pour offrir
      // le bouton Publier/Masquer. Renvoie true/false (cf handleTogglePublish).
      // eventTitle/eventDate alimentent le header du viewer v2.
      onOpenPhoto?.(photo, filteredPhotos, {
        allowDelete: true,
        onDelete: deleteFromViewer,
        onTogglePhotoVisibility: handleTogglePublish,
        eventTitle: event?.name,
        eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
      });
    }
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  };

  const deleteSelected = async () => {
    if (selectedKeys.size === 0) return;
    Alert.alert(
      `Supprimer ${selectedKeys.size} photo${selectedKeys.size > 1 ? 's' : ''} ?`,
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const r = await fetch(`${API_URL}/organizer/delete-photos`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ keys: Array.from(selectedKeys) }),
              });
              if (r.ok) {
                const keysToRemove = selectedKeys;
                setPhotos(prev => prev.filter(p => !keysToRemove.has(p.id)));
                exitSelection();
              } else {
                const data = await r.json();
                Alert.alert('Erreur', data.error || 'Échec de la suppression');
              }
            } catch (e) {
              Alert.alert('Erreur', e.message || 'Erreur réseau');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const deleteFromViewer = async (keys) => {
    if (!keys || keys.length === 0) return;
    try {
      const r = await fetch(`${API_URL}/organizer/delete-photos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ keys }),
      });
      if (r.ok) {
        const keysSet = new Set(keys);
        setPhotos(prev => prev.filter(p => !keysSet.has(p.id)));
      }
    } catch {}
  };

  const ListHeader = (
    <>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={[s.welcome, { color: C.primary, fontSize: 18 }]}>
            {selectionMode ? `${selectedKeys.size} sélectionnée${selectedKeys.size > 1 ? 's' : ''}` : "Photos de l'event"}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {!selectionMode && photos.length > 0 ? (
            <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
              <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Sélectionner</Text>
            </TouchableOpacity>
          ) : selectionMode ? (
            <TouchableOpacity onPress={exitSelection} hitSlop={10}>
              <Text style={{ color: C.textSoft, fontSize: 14, fontWeight: '600' }}>Annuler</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.eventCard, { marginTop: 12, marginBottom: 14 }]}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
        {event.cover_image ? (
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', overflow: 'hidden' }}>
            <ExpoImage source={{ uri: event.cover_image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            <LinearGradient
              colors={[tint, 'transparent']}
              locations={[0, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          </View>
        ) : null}
        <View style={s.eventCardCenter}>
          <Text style={s.eventDate}>{formatDateLong(event.event_date, event.event_date_end)}</Text>
          <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
          <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
        </View>
      </View>

      <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={{ marginRight: 10 }}>
          <Circle cx="12" cy="12" r="9" stroke="#92400E" strokeWidth={1.8} />
          <Path d="M12 8v5M12 16h.01" stroke="#92400E" strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
        <Text style={{ color: '#92400E', fontSize: 12, flex: 1 }}>
          Mode preview : tu vois toutes les photos, même celles prises avant le départ.{'\n'}Les coureurs ne voient que les photos après l'heure de leur course.
        </Text>
      </View>

      {distances.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 8 }}
        >
          <TouchableOpacity
            onPress={() => setRaceFilter('all')}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
              backgroundColor: raceFilter === 'all' ? C.primary : '#f5f3ff',
            }}
          >
            <Text style={{ color: raceFilter === 'all' ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>Toutes</Text>
          </TouchableOpacity>
          {distances.map((d, i) => {
            const val = String(d.km);
            const active = raceFilter === val;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setRaceFilter(val)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                  backgroundColor: active ? C.primary : '#f5f3ff',
                }}
              >
                <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{d.km} km</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Text style={[s.sectionTitle, { marginVertical: 10 }]}>
        Photos {photos.length > 0 ? `(${filteredPhotos.length})` : ''}
        {hiddenCount > 0 && (
          <Text style={{ color: '#EF4444', fontSize: 13, fontWeight: '600' }}>
            {'  · '}{hiddenCount} masquée{hiddenCount > 1 ? 's' : ''}
          </Text>
        )}
      </Text>
    </>
  );

  const ListEmpty = (
    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
      {loading
        ? <ActivityIndicator color={C.primary} />
        : <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>}
    </View>
  );

  // Toggle visibilite d'une photo masquee -> publication galerie publique.
  // Action MANUELLE de l'orga, jamais automatique. Refresh complet de la
  // galerie apres bascule pour re-fetcher le hidden_count.
  // Renvoie true en cas de succes, false sinon. Le boolean est consomme par
  // PhotoViewerModal qui maintient un override local optimiste -- si l appel
  // echoue, le viewer revert son visuel.
  async function handleTogglePublish(photoKey, currentlyHidden) {
    if (busyKey) return false;
    setBusyKey(photoKey);
    try {
      const r = await fetch(`${API_URL}/organizer/photo-visibility`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: photoKey, visible: currentlyHidden }), // currentlyHidden=true -> visible=true (publier)
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data?.error || 'Modification impossible');
        return false;
      }
      await loadPhotos();
      return true;
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Modification impossible');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  // Cellule grille — extraite en fonction pour clarté et keyExtractor stable.
  const renderItem = ({ item: photo, index }) => {
    const isSelected = selectedKeys.has(photo.id);
    const isHidden = photo.hidden === true;
    const isBusy = busyKey === photo.id;
    return (
      <TouchableOpacity
        onPress={() => handlePhotoPress(photo)}
        onLongPress={() => {
          if (!selectionMode) setSelectionMode(true);
          toggleSelect(photo.id);
        }}
        activeOpacity={0.85}
        style={{ width: '33.333%', aspectRatio: 1, padding: 2 }}
      >
        <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#eee' }}>
          <ExpoImage
            source={{ uri: photo.uri }}
            style={[StyleSheet.absoluteFillObject, isHidden ? { opacity: 0.55 } : null]}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="low"
            transition={100}
            recyclingKey={photo.id}
          />
          {selectionMode && (
            <View style={{
              position: 'absolute', top: 6, right: 6,
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: isSelected ? C.primary : 'rgba(0,0,0,0.4)',
              borderWidth: 2, borderColor: '#fff',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {isSelected && (
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="m4 12 6 6L20 6" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
            </View>
          )}
          {isSelected && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(124, 58, 237, 0.25)' }]} />
          )}
          {/* Point rouge en haut a gauche : photo masquee (face_count=0).
              On evite top-right (conflit avec le cercle de selection). */}
          {isHidden && !selectionMode && (
            <View
              accessibilityLabel="Photo masquée"
              style={{
                position: 'absolute', top: 6, left: 6,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: '#EF4444',
                borderWidth: 2, borderColor: '#fff',
              }}
            />
          )}
          {/* Bouton "Publier" en overlay : clic explicite de l'orga pour
              basculer une photo masquee vers la galerie publique. Jamais
              automatique. Hide en mode selection (le tap doit aller au toggle
              de selection, pas au publish). */}
          {isHidden && !selectionMode && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                handleTogglePublish(photo.id, true);
              }}
              disabled={isBusy}
              hitSlop={6}
              style={{
                position: 'absolute', bottom: 4, right: 4,
                backgroundColor: isBusy ? 'rgba(0,0,0,0.4)' : C.primary,
                paddingHorizontal: 8, paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {isBusy ? '…' : 'Publier'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // FlatList virtualisée comme root scroller (au lieu de RefreshableScrollView
  // qui mountait tout en arbre). Réduit drastiquement le pic mémoire sur
  // les events à 100+ photos.
  return (
    <GridErrorBoundary>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <FlatList
          data={loading ? [] : filteredPhotos.slice(0, visibleCount)}
          numColumns={3}
          keyExtractor={(item, index) => item.id || `p-${index}`}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={C.primary} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
        />

        {selectionMode && selectedKeys.size > 0 && (
          <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
            <TouchableOpacity
              onPress={deleteSelected}
              disabled={deleting}
              style={{
                backgroundColor: '#DC2626',
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                opacity: deleting ? 0.6 : 1,
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    Supprimer ({selectedKeys.size})
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GridErrorBoundary>
  );
}

function OrganizerDashboardScreen({ session, onLogout, onCreateEvent, onEditEvent, onOpenProfile, onOpenEventPhotos, onOpenEventDetail, onOpenOrgRole, refreshKey = 0 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null); // slug en cours de paiement

  const reload = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/organizer/my-events`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await r.json();
      setEvents(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [refreshKey]);

  const pay = async (slug) => {
    setPaying(slug);
    try {
      const r = await fetch(`${API_URL}/organizer/pay-event/${slug}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (r.ok) {
        Alert.alert('Paiement réussi', 'Ton événement est maintenant en ligne !');
        reload();
      } else {
        const data = await r.json();
        Alert.alert('Erreur', data.error || 'Échec du paiement');
      }
    } finally { setPaying(null); }
  };

  const deleteEvent = (e) => {
    Alert.alert(
      'Supprimer cet événement ?',
      `"${e.name}" sera définitivement supprimé, ainsi que toutes ses photos. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await fetch(`${API_URL}/organizer/event/${e.code}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.token}` },
              });
              if (r.ok) reload();
              else {
                const data = await r.json();
                Alert.alert('Erreur', data.error || 'Échec de la suppression');
              }
            } catch (err) {
              Alert.alert('Erreur', err.message);
            }
          },
        },
      ]
    );
  };

  // Valeurs alignées avec le worker (status renvoyé par /organizer/my-events) :
  //   pending           → soumission en cours de validation admin
  //   validated         → admin a validé, en attente de décision billing (transitoire)
  //   pending_payment   → admin a fixé un montant, en attente du règlement orga
  //   free              → activé en mode gratuit, en ligne
  //   paid              → réglé, en ligne
  //   rejected          → refusé par admin
  const statusInfo = (st) => {
    if (st === 'pending') return { label: 'En cours de validation', color: '#F59E0B', bg: '#FEF3C7' };
    if (st === 'validated') return { label: 'En cours d\'activation', color: '#8B5CF6', bg: '#EDE9FE' };
    if (st === 'pending_payment') return { label: 'À régler', color: '#EC4899', bg: '#FCE7F3' };
    if (st === 'free') return { label: 'En ligne · gratuit', color: '#10B981', bg: '#D1FAE5' };
    if (st === 'paid') return { label: 'En ligne', color: '#10B981', bg: '#D1FAE5' };
    if (st === 'rejected') return { label: 'Refusé', color: '#DC2626', bg: '#FEE2E2' };
    return { label: st, color: C.textSoft, bg: '#f5f3ff' };
  };

  return (
    <RefreshableScrollView onRefresh={reload} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* Header (avatar gauche | bloc orga/photo droit) avec titre centre
          en absolute pour ne pas etre decale par la difference de largeur
          entre l'avatar (40x40) et le bloc orga/photo (~92). Structure et
          dimensions strictement identiques au header de PhotosScreen pour
          que l'avatar reste alignement Y/X au pixel pres entre les 2 onglets. */}
      <View style={[s.headerRow, { position: 'relative' }]}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            hitSlop={10}
            onPress={onOpenProfile}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            <Icon.User size={30} color={C.pinkPill} />
          </TouchableOpacity>
        </View>
        <View style={s.orgToggle}>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole?.('organizer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.GearOrg size={22} color={C.pinkPill} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole?.('photographer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.CamOrg size={24} color={C.pinkPill} />
          </TouchableOpacity>
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0, right: 0,
            // Match s.headerRow paddings (12 top / 4 bottom) pour que le
            // centre vertical de l'overlay = centre vertical de l'avatar
            // et du bloc orga/photo (qui sont dans la zone "content").
            top: 12, bottom: 4,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes events</Text>
        </View>
      </View>

      {/* Marge verticale entre le header et le contenu (14px = meme marge
          que la search bar de HomeScreen). */}
      <View style={{ height: 14 }} />

      <TouchableOpacity
        onPress={onCreateEvent}
        style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 18 }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>+ Créer un événement</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
      ) : events.length === 0 ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
            Tu n'as pas encore créé d'événement.{'\n'}Clique sur le bouton ci-dessus pour démarrer.
          </Text>
        </View>
      ) : (
        events.map((e, i) => {
          const info = statusInfo(e.status);
          return (
            <View key={i} style={{ marginBottom: 14 }}>
              {/* Carte event style accueil + badge statut en haut à droite.
                  Tap sur la card → écran Détail event (vue orga). */}
              <View style={{ position: 'relative' }}>
                <EventCard event={e} onPress={() => (onOpenEventDetail || onOpenEventPhotos)?.(e)} />
                <View style={{
                  position: 'absolute',
                  top: 10, right: 10,
                  backgroundColor: info.bg,
                  paddingHorizontal: 10, paddingVertical: 5,
                  borderRadius: 8,
                  zIndex: 10,
                }}>
                  <Text style={{ color: info.color, fontSize: 11, fontWeight: '700' }}>{info.label}</Text>
                </View>
              </View>

              {/* Bloc actions sous la carte */}
              <View style={{ backgroundColor: '#faf9ff', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, marginTop: -10, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12 }}>
                {e.status === 'pending_payment' && (
                  <TouchableOpacity
                    onPress={() => pay(e.code)}
                    disabled={paying === e.code}
                    style={{ backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10, alignItems: 'center', marginBottom: 8, opacity: paying === e.code ? 0.6 : 1 }}
                  >
                    {paying === e.code ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Mettre en ligne</Text>
                    )}
                  </TouchableOpacity>
                )}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => onEditEvent?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: C.primary, borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onOpenEventPhotos?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Photos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deleteEvent(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#DC2626' }}
                  >
                    <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600' }}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}
    </RefreshableScrollView>
  );
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [tab, setTab] = useState('upcoming');
  const [bottomTab, setBottomTab] = useState('home');
  const [photosUnread, setPhotosUnread] = useState(0); // E3 — pastille rouge onglet Photos
  const [events, setEvents] = useState([]);
  const [openedEvent, setOpenedEvent] = useState(null);
  const [orgModal, setOrgModal] = useState(false);
  const [selfieModal, setSelfieModal] = useState(false);
  const [searchModal, setSearchModal] = useState(false);
  const [createEventModal, setCreateEventModal] = useState(false);
  const [editEventTarget, setEditEventTarget] = useState(null);
  const [orgRefreshKey, setOrgRefreshKey] = useState(0);
  const [loginRole, setLoginRole] = useState(null);
  const [selfieUri, setSelfieUri] = useState(null);
  const [session, setSession] = useState(null);
  // Distinct de `session` : permet de sortir du mode plein écran sans effacer
  // la session SecureStore (le photographe revient sans re-saisir son mdp).
  const [inPhotographerMode, setInPhotographerMode] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [selfieViewer, setSelfieViewer] = useState(false);
  const [openedPhoto, setOpenedPhoto] = useState(null); // { photo, photos, allowDelete, onDelete }
  const [follows, setFollows] = useState([]);  // Events suivis (consentement biometrique RGPD)
  const pendingFollowRef = useRef(null);  // Stocke eventCode si selfie requis → relance follow apres selfie
  const [photoFavorites, setPhotoFavorites] = useState([]); // array d'IDs photo (keys R2)
  const [userId, setUserId] = useState(null);
  const [runnerSession, setRunnerSession] = useState(null); // { token, profile }
  const [organizerSession, setOrganizerSession] = useState(null); // { token, profile }
  const [organizerAuthVisible, setOrganizerAuthVisible] = useState(false);
  const [organizerProfileMenu, setOrganizerProfileMenu] = useState(false);
  const [organizerEventPhotosTarget, setOrganizerEventPhotosTarget] = useState(null);
  const [organizerEventDetailTarget, setOrganizerEventDetailTarget] = useState(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState('login'); // mode d'ouverture par defaut du modal auth
  // Etape 2 du signup : selfie. Quand true, SelfieModal s'ouvre en mode "wizard"
  // (indicateur etape 2/2 + bouton "Plus tard" qui passe l'etape sans selfie).
  const [signupSelfieStep, setSignupSelfieStep] = useState(false);
  // Persistance "selfie skippe a l'inscription" → l'accueil affiche un etat
  // renforce sur la carte selfie tant que le coureur n'aura pas pris son selfie.
  const [selfieSkipped, setSelfieSkipped] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);  // Phase D reset modal au 1er boot
  const pendingActionRef = useRef(null); // action à exécuter après login

  const reloadEvents = useCallback(async () => {
    try {
      const data = await api.getEvents();
      if (Array.isArray(data) && data.length > 0) setEvents(data);
    } catch {
      // offline : on garde la liste cachée (préchargée au boot)
    }
  }, []);

  // Dev-only helper pour re-tester la modale Phase D : depuis la console
  // RN (Hermes debugger / Expo dev menu → Open JS Debugger), taper :
  //   await global.__resetPhaseD()
  // → supprime le flag, recharge l'app, modale reapparait au prochain boot.
  useEffect(() => {
    if (__DEV__) {
      global.__resetPhaseD = async () => {
        await AsyncStorage.removeItem('@will_phase_d_reset_done');
        // Restaure un favori fictif pour que la modale s'affiche (sinon vidage silencieux)
        await AsyncStorage.setItem('@will_favorites', JSON.stringify(['__test-reset__']));
        console.log('[Phase D reset] Flag cleared + 1 fake favorite set. Reload the app (shake → Reload).');
        try {
          const DevSettings = require('react-native').DevSettings;
          DevSettings?.reload?.();
        } catch {}
      };
    }
  }, []);

  // Auto-cache : à chaque fois qu'on a une liste non vide, on la persiste
  // pour que le prochain boot offline ait une liste à afficher.
  useEffect(() => {
    if (events.length > 0) {
      AsyncStorage.setItem('@will_events_cache', JSON.stringify(events)).catch(() => {});
    }
  }, [events]);

  useEffect(() => {
    Font.loadAsync({
      AVEstiana: require('./assets/fonts/AV_Estiana-VF.ttf'),
    }).then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
  }, []);

  // Splash overlay JS : ecran blanc avec icone fleur Will centree
  // (LoadingIcon, meme que pull-to-refresh) qui prend le relais du
  // splash iOS natif. Reste visible 1 seconde minimum puis fade out
  // 400ms. L overlay est demonte a la fin du fade pour ne pas bloquer
  // les interactions.
  const splashOverlayOpacity = useSharedValue(1);
  const splashOverlayStyle = useAnimatedStyle(() => ({ opacity: splashOverlayOpacity.value }));
  const [splashOverlayVisible, setSplashOverlayVisible] = useState(true);

  // Logo Will violet primary statique. Pas de fade-in (l opacity
  // partielle sur fond blanc faisait paraitre le logo plus clair au
  // debut). Apparait direct a 100%. Disparait avec le fond via le
  // parent splashOverlay qui fade out a la fin (fontsLoaded + 1s).

  useEffect(() => {
    if (!fontsLoaded) return;
    // 1. Hide splash iOS immediatement : l overlay JS (blanc + avatar)
    // prend le relais visuel, donc pas de saut.
    try { SplashScreen?.hideAsync?.(); } catch {}
    // 2. Attendre 1 seconde minimum d affichage puis fade out.
    const t = setTimeout(() => {
      splashOverlayOpacity.value = withTiming(
        0,
        {
          duration: 400,
          easing: (v) => { 'worklet'; return 1 - Math.pow(1 - v, 3); },
        },
        (finished) => {
          if (finished) runOnJS(setSplashOverlayVisible)(false);
        }
      );
    }, 1000);
    return () => clearTimeout(t);
  }, [fontsLoaded]);

  useEffect(() => {
    // Précharge la liste events depuis le cache pour que le LoginModal soit
    // utilisable en offline (sélection d'event possible sans réseau). Guard :
    // si reloadEvents a déjà set une liste fraîche, on ne l'écrase pas.
    AsyncStorage.getItem('@will_events_cache').then(v => {
      if (!v) return;
      try {
        const cached = JSON.parse(v);
        if (Array.isArray(cached) && cached.length > 0) {
          setEvents(prev => (prev.length === 0 ? cached : prev));
        }
      } catch {}
    });
    reloadEvents();
    AsyncStorage.getItem('@will_selfie').then(v => v && setSelfieUri(v));
    AsyncStorage.getItem('@will_selfie_skipped').then(v => setSelfieSkipped(v === '1'));
    // Phase D RGPD : reset propre des favoris au 1er boot post-deploiement.
    // Le geste "Favori" devient "Suivre" et exige consentement biometrique
    // explicite via POST /runner/follow. Les anciens favoris ne declenchent
    // plus rien → on les vide une fois, on informe l'utilisateur.
    (async () => {
      const resetDone = await AsyncStorage.getItem('@will_phase_d_reset_done');
      const storedOldFavorites = await AsyncStorage.getItem('@will_favorites');
      if (__DEV__) console.log('[Phase D reset] @will_phase_d_reset_done =', resetDone, 'old @will_favorites =', storedOldFavorites);
      if (resetDone === '1') {
        // Boot normal post-reset : charge follows depuis @will_follows si présent
        const storedFollows = await AsyncStorage.getItem('@will_follows');
        if (storedFollows) {
          try { setFollows(JSON.parse(storedFollows)); } catch { setFollows([]); }
        }
        return;
      }
      // 1er boot post-Phase D : vide anciens favoris + flag + affiche modale si non-vide
      let hadFavorites = false;
      if (storedOldFavorites) {
        try { hadFavorites = Array.isArray(JSON.parse(storedOldFavorites)) && JSON.parse(storedOldFavorites).length > 0; } catch {}
      }
      setFollows([]);
      await AsyncStorage.removeItem('@will_favorites').catch(() => {});
      await AsyncStorage.setItem('@will_phase_d_reset_done', '1');
      if (hadFavorites) setShowResetModal(true);
    })();
    // user_id unique généré au premier lancement
    AsyncStorage.getItem('@will_user_id').then(v => {
      if (v) {
        setUserId(v);
      } else {
        // Génère un ID aléatoire (Math.random + timestamp, suffisant pour identifier un device)
        const id = Date.now().toString(36) +
          Math.random().toString(36).substring(2, 10) +
          Math.random().toString(36).substring(2, 10);
        AsyncStorage.setItem('@will_user_id', id);
        setUserId(id);
      }
    });
    // Sessions sensibles : migration AsyncStorage → SecureStore puis lecture.
    (async () => {
      await migrateSensitiveKeysToSecureStore();
      Secure.getItem('@will_runner').then(v => {
        if (v) try { setRunnerSession(JSON.parse(v)); } catch {}
      });
      Secure.getItem('@will_organizer').then(v => {
        if (v) try { setOrganizerSession(JSON.parse(v)); } catch {}
      });
      // Boot : on lit la session pour permettre un retour rapide en mode
      // photographe (sans re-saisir le mdp), mais on ouvre par défaut sur
      // l'accueil. L'utilisateur tap "Photographe" pour entrer dans le mode.
      Secure.getItem('@will_photographer_session').then(v => {
        if (v) try { setSession(JSON.parse(v)); } catch {}
      });
    })();
  }, []);

  // Quand un compte runner est connecté, on aligne userId sur runner.userId
  // pour que selfie + galerie perso utilisent le même identifiant
  useEffect(() => {
    if (runnerSession?.profile?.userId) {
      setUserId(runnerSession.profile.userId);
      AsyncStorage.setItem('@will_user_id', runnerSession.profile.userId).catch(() => {});
    }
  }, [runnerSession?.profile?.userId]);

  // Favoris photos perso (locaux par device, scopés par userId).
  // Rechargés quand userId change (ex: login runner → userId aligne sur runner.userId).
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(`@will_photo_favorites_${userId}`).then(v => {
      if (v) {
        try { setPhotoFavorites(JSON.parse(v)); } catch { setPhotoFavorites([]); }
      } else {
        setPhotoFavorites([]);
      }
    });
  }, [userId]);

  const handleAuthSuccess = useCallback((session) => {
    const { isNewSignup, ...stored } = session || {};
    setRunnerSession(stored);
    Secure.setItem('@will_runner', JSON.stringify(stored)).catch(() => {});
    setAuthModalVisible(false);
    // Etape 2 du wizard d'inscription : si c'est un nouveau compte sans selfie,
    // on enchaine sur SelfieModal en mode "signup step". Bouton "Plus tard"
    // ferme l'etape et marque @will_selfie_skipped pour renforcer la carte
    // d'accueil. Sinon, comportement legacy : action en attente (login flow).
    if (isNewSignup) {
      AsyncStorage.removeItem('@will_selfie_skipped').catch(() => {});
      setSelfieSkipped(false);
      setTimeout(() => { setSignupSelfieStep(true); setSelfieModal(true); }, 300);
      return;
    }
    if (pendingActionRef.current) {
      const a = pendingActionRef.current;
      pendingActionRef.current = null;
      setTimeout(() => a(), 100);
    }
  }, []);

  // Refetch automatique du selfie depuis R2 quand un runner est connecte mais
  // qu'on n'a pas (ou plus) son URI local. Couvre 2 cas :
  //  - Login fresh sur un compte qui a deja un selfie en R2 (re-login mobile,
  //    nouveau device, AsyncStorage vide apres logout).
  //  - Boot de l'app avec session restoree depuis SecureStore mais selfie
  //    AsyncStorage absent.
  // Idempotent : early-return si selfieUri deja set, donc pas de boucle.
  useEffect(() => {
    const token = runnerSession?.token;
    if (!token || selfieUri) return;
    let cancelled = false;
    fetch(`${API_URL}/runner/selfie`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.exists && data?.uri) {
          setSelfieUri(data.uri);
          AsyncStorage.setItem('@will_selfie', data.uri).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [runnerSession?.token, selfieUri]);

  // E2 — register silencieux du token push au boot si l utilisateur a
  // deja accorde la permission (ex. reinstall, nouveau token Expo apres
  // build). Aucun prompt ici ; le prompt est gere par toggleFollow au
  // premier follow.
  useEffect(() => {
    const token = runnerSession?.token;
    if (!token) return;
    ensurePushRegistered(token, { ask: false });
  }, [runnerSession?.token]);

  // E3 — Pastille onglet Photos : compte les notifs "new_photos" recues
  // pendant que l onglet Photos n est pas focus. Reset a 0 quand le user
  // ouvre l onglet (cf useEffect [bottomTab] plus bas).
  // 3 sources d update :
  //  a) Notif arrivee app ouverte/background -> addNotificationReceivedListener
  //  b) Tap sur notif app ouverte/background -> addNotificationResponseReceivedListener
  //     (bascule sur l onglet Photos automatiquement)
  //  c) Cold start via tap notif -> getLastNotificationResponseAsync
  useEffect(() => {
    const sub1 = Notifications.addNotificationReceivedListener(notif => {
      const data = notif?.request?.content?.data;
      if (data?.type === 'new_photos') {
        const c = typeof data.count === 'number' ? data.count : 1;
        setPhotosUnread(prev => prev + c);
      }
    });
    const sub2 = Notifications.addNotificationResponseReceivedListener(resp => {
      const data = resp?.notification?.request?.content?.data;
      if (data?.type === 'new_photos') {
        setBottomTab('photos');
        setOpenedEvent(null);
        setOrganizerEventPhotosTarget(null);
      }
    });
    Notifications.getLastNotificationResponseAsync().then(resp => {
      const data = resp?.notification?.request?.content?.data;
      if (data?.type === 'new_photos') {
        setBottomTab('photos');
      }
    }).catch(() => {});
    return () => { sub1.remove(); sub2.remove(); };
  }, []);

  // E3 — reset pastille a l ouverture de l onglet Photos.
  useEffect(() => {
    if (bottomTab === 'photos') setPhotosUnread(0);
  }, [bottomTab]);

  const requireAuth = useCallback((action) => {
    if (runnerSession) {
      action();
    } else {
      pendingActionRef.current = action;
      setAuthModalVisible(true);
    }
  }, [runnerSession]);

  const logoutRunner = useCallback(() => {
    const lastEmail = runnerSession?.profile?.email;
    if (lastEmail) AsyncStorage.setItem('@will_last_email_runner', lastEmail).catch(() => {});
    // E2 — best-effort : decroche le token push avant de perdre le bearer.
    // Sinon ce device continuerait de recevoir des notifs apres logout.
    const tk = runnerSession?.token;
    if (tk) { api.deletePushToken(tk); }
    setRunnerSession(null);
    setSelfieUri(null);
    Secure.removeItem('@will_runner').catch(() => {});
    AsyncStorage.removeItem('@will_selfie').catch(() => {});
  }, [runnerSession]);

  const handleOrganizerAuthSuccess = useCallback((session) => {
    setOrganizerSession(session);
    Secure.setItem('@will_organizer', JSON.stringify(session)).catch(() => {});
    setOrganizerAuthVisible(false);
    setBottomTab('events');
  }, []);

  const logoutOrganizer = useCallback(() => {
    const lastEmail = organizerSession?.profile?.email;
    if (lastEmail) AsyncStorage.setItem('@will_last_email_organizer', lastEmail).catch(() => {});
    setOrganizerSession(null);
    Secure.removeItem('@will_organizer').catch(() => {});
    setBottomTab('home');
  }, [organizerSession]);

  // RGPD chirurgical : supprime selfie + empreintes biometriques sur TOUS
  // les events suivis, sans toucher au compte. Le coureur peut redeposer
  // un selfie et re-suivre des events ensuite. Cf DELETE /runner/face-data.
  const deleteFaceData = useCallback(() => {
    if (!runnerSession?.token) return;
    Alert.alert(
      'Supprimer tes données faciales ?',
      'Ton selfie et ton visage seront retirés de tous les events que tu suis. Ton compte est conservé. Tu pourras tout recommencer en redéposant un selfie.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          const r = await api.deleteFaceData(runnerSession.token);
          if (r?.success) {
            // Cleanup local : selfie, follows, follow_started timestamps
            setSelfieUri(null);
            setFollows([]);
            await AsyncStorage.removeItem('@will_selfie').catch(() => {});
            await AsyncStorage.removeItem('@will_follows').catch(() => {});
            // Purge tous les @will_follow_started_* presents
            try {
              const allKeys = await AsyncStorage.getAllKeys();
              const startedKeys = allKeys.filter(k => k.startsWith('@will_follow_started_'));
              if (startedKeys.length > 0) await AsyncStorage.multiRemove(startedKeys);
            } catch {}
            setProfileMenu(false);
            Alert.alert('Données faciales supprimées', 'Tout est nettoyé. Tu peux redéposer un selfie quand tu veux.');
          } else {
            Alert.alert('Erreur', r?.error || 'Impossible de supprimer. Reessaie.');
          }
        }},
      ]
    );
  }, [runnerSession]);

  // RGPD : suppression définitive du compte coureur (App Store Guideline 5.1.1(v))
  const deleteRunnerAccount = useCallback(() => {
    if (!runnerSession?.token) return;
    Alert.alert(
      'Supprimer mon compte ?',
      'Cette action est définitive. Ton selfie, ton profil coureur et toutes tes données associées seront supprimés. Tes photos d\'événements ne te seront plus envoyées.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          try {
            const r = await fetch(`${API_URL}/runner/account`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${runnerSession.token}` },
            });
            if (!r.ok) {
              const data = await r.json().catch(() => ({}));
              Alert.alert('Erreur', data.error || 'Impossible de supprimer le compte. Réessaie plus tard.');
              return;
            }
            await Promise.all([
              Secure.removeItem('@will_runner'),
              Secure.removeItem(BIOMETRIC_CONSENT_KEY),
              AsyncStorage.removeItem('@will_selfie'),
            ]);
            setRunnerSession(null);
            setSelfieUri(null);
            Alert.alert('Compte supprimé', 'Toutes tes données ont été supprimées.');
          } catch (e) {
            Alert.alert('Erreur réseau', 'Vérifie ta connexion et réessaie.');
          }
        }},
      ]
    );
  }, [runnerSession]);

  // RGPD : suppression définitive du compte organisateur + tous ses events
  const deleteOrganizerAccount = useCallback(() => {
    if (!organizerSession?.token) return;
    Alert.alert(
      'Supprimer mon compte organisateur ?',
      'Cette action est définitive. Ton profil organisateur et TOUS tes événements (photos, métadonnées, données biométriques associées) seront supprimés. Aucun retour en arrière possible.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          try {
            const r = await fetch(`${API_URL}/organizer/account`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${organizerSession.token}` },
            });
            if (!r.ok) {
              const data = await r.json().catch(() => ({}));
              Alert.alert('Erreur', data.error || 'Impossible de supprimer le compte. Réessaie plus tard.');
              return;
            }
            await Secure.removeItem('@will_organizer');
            setOrganizerSession(null);
            setBottomTab('home');
            Alert.alert('Compte supprimé', 'Toutes tes données et événements ont été supprimés.');
          } catch (e) {
            Alert.alert('Erreur réseau', 'Vérifie ta connexion et réessaie.');
          }
        }},
      ]
    );
  }, [organizerSession]);

  const updateRunnerProfile = useCallback(async (changes) => {
    if (!runnerSession?.token) return;
    try {
      const r = await fetch(`${API_URL}/runner/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runnerSession.token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await r.json();
      if (r.ok && data.profile) {
        const next = { ...runnerSession, profile: data.profile };
        setRunnerSession(next);
        Secure.setItem('@will_runner', JSON.stringify(next)).catch(() => {});
      } else {
        Alert.alert('Erreur', data.error || 'Impossible de modifier les infos');
      }
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Erreur réseau');
    }
  }, [runnerSession]);

  const updateOrganizerProfile = useCallback(async (changes) => {
    if (!organizerSession?.token) return;
    try {
      const r = await fetch(`${API_URL}/organizer/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${organizerSession.token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await r.json();
      if (r.ok && data.profile) {
        const next = { ...organizerSession, profile: data.profile };
        setOrganizerSession(next);
        Secure.setItem('@will_organizer', JSON.stringify(next)).catch(() => {});
      } else {
        Alert.alert('Erreur', data.error || 'Impossible de modifier les infos');
      }
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Erreur réseau');
    }
  }, [organizerSession]);

  // Suivre / ne plus suivre un event = consentement biometrique RGPD.
  // Pre-requis : runner connecte (requireAuth fait par le caller) + selfie
  // depose (sinon 400 selfie_required → on ouvre SelfieModal puis on relance
  // via pendingFollowRef dans le onSaved du modal).
  const toggleFollow = useCallback(async (eventCode) => {
    const token = runnerSession?.token;
    if (!token) {
      // Garde-fou : appel direct sans auth. Le caller doit utiliser requireAuth.
      Alert.alert('Connexion requise', 'Connecte-toi a ton compte coureur pour suivre un event.');
      return;
    }
    const isCurrentlyFollowing = follows.includes(eventCode);
    if (isCurrentlyFollowing) {
      const r = await api.unfollow(eventCode, token);
      if (r?.ok || r?.note === 'already_unfollowed') {
        setFollows(prev => {
          const next = prev.filter(c => c !== eventCode);
          AsyncStorage.setItem('@will_follows', JSON.stringify(next)).catch(() => {});
          return next;
        });
        AsyncStorage.removeItem(`@will_follow_started_${eventCode}`).catch(() => {});
      } else {
        Alert.alert('Erreur', r?.error || 'Impossible de retirer le suivi. Reessaie.');
      }
      return;
    }
    // Follow
    const r = await api.follow(eventCode, token);
    if (r?.ok || r?.note === 'already_following') {
      const wasEmpty = follows.length === 0;
      setFollows(prev => {
        if (prev.includes(eventCode)) return prev;
        const next = [...prev, eventCode];
        AsyncStorage.setItem('@will_follows', JSON.stringify(next)).catch(() => {});
        return next;
      });
      AsyncStorage.setItem(`@will_follow_started_${eventCode}`, String(Date.now())).catch(() => {});
      // E2 — premier follow du coureur = bon moment pour demander la
      // permission notif. Sinon (deja des follows), on tente un register
      // silencieux au cas ou le token n a pas encore ete envoye.
      ensurePushRegistered(token, { ask: wasEmpty });
      return;
    }
    // 400 "Selfie requis" → ouvre SelfieModal puis relance follow apres save
    if (r?.status === 400 && r?.error && r.error.toLowerCase().includes('selfie')) {
      pendingFollowRef.current = eventCode;
      setSelfieModal(true);
      return;
    }
    // 400 "Aucun visage detecte" → message dedie
    if (r?.status === 400 && r?.error && r.error.toLowerCase().includes('visage')) {
      Alert.alert('Selfie a refaire', r.error);
      return;
    }
    // Autre erreur
    Alert.alert('Erreur', r?.error || 'Impossible de suivre cet event. Reessaie.');
  }, [follows, runnerSession?.token]);

  const photoFavoritesSet = useMemo(() => new Set(photoFavorites), [photoFavorites]);
  const togglePhotoFavorite = useCallback((photoId) => {
    if (!photoId || !userId) return;
    setPhotoFavorites(prev => {
      const next = prev.includes(photoId)
        ? prev.filter(k => k !== photoId)
        : [...prev, photoId];
      AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [userId]);

  const deleteSelfie = useCallback(() => {
    Alert.alert('Supprimer le selfie ?', 'Tu pourras en reprendre un nouveau.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        // 1. Supprime le selfie cote serveur en premier. Sinon le useEffect
        //    refetch (GET /runner/selfie) restaurerait la pastille verte
        //    instantanement apres le clear local.
        const token = runnerSession?.token;
        if (token) {
          try {
            await fetch(`${API_URL}/runner/selfie`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (e) { console.warn('delete selfie', e?.message); }
        }
        // 2. Clear local. RGPD : revoque aussi le consentement biometrique.
        await Promise.all([
          AsyncStorage.removeItem('@will_selfie'),
          Secure.removeItem(BIOMETRIC_CONSENT_KEY),
        ]);
        setSelfieUri(null);
      }},
    ]);
  }, [runnerSession]);

  const handlePickRole = (role) => {
    setOrgModal(false);
    if (role === 'organizer') {
      if (organizerSession) {
        setBottomTab('events');
      } else {
        setOrganizerAuthVisible(true);
      }
      return;
    }
    if (role === 'create') {
      setCreateEventModal(true);
      return;
    }
    // photographer : si une session existe déjà (déjà loggué + sorti via
    // bouton retour), on entre direct sans redemander le mdp.
    if (session?.role === 'photographer') {
      setInPhotographerMode(true);
      return;
    }
    setLoginRole(role);
  };

  const tabs = useMemo(() => {
    const t = ['home', 'photos'];
    if (organizerSession) t.push('events');
    return t;
  }, [organizerSession]);

  const tabsTranslateX = useRef(new Animated.Value(0)).current;

  // Pas de fade-in JS au mount : le splash screen iOS natif se hide tout
  // seul, ajouter un fade par dessus etait percu comme un lag. On accepte
  // le saut splash->contenu natif (geste OS standard, l utilisateur s y
  // attend). Pour eliminer ce saut completement il faut installer
  // expo-splash-screen + rebuild EAS (pas OTA).

  // ─── Nav meta-rail Accueil <-> Event (carrousel horizontal 2 panneaux) ───
  // Layout : EVENT (left=0) | ACCUEIL (left=SCREEN_W). Le rail entier translate.
  //   navTranslateX = -SCREEN_W -> rail decale d une largeur vers la gauche
  //                              -> panneau ACCUEIL aligne au viewport
  //   navTranslateX =  0        -> rail a origine
  //                              -> panneau EVENT aligne au viewport
  // Init -SCREEN_W : pas d animation au mount (l accueil est deja en place).
  const navTranslateX = useSharedValue(-SCREEN_W);
  const navStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: navTranslateX.value }],
  }));
  // Easing iOS-like (cubic out doux). Worklet pour UI thread.
  const navEasing = (t) => {
    'worklet';
    return 1 - Math.pow(1 - t, 3);
  };
  // L event reste rendu dans le panneau gauche PENDANT l anim de close
  // (sinon React le demonte instantanement au setOpenedEvent(null) et on
  // voit l accueil glisser tout seul avec un panneau gauche vide). Cleared
  // au callback de fin d animation.
  const [eventInPanel, setEventInPanel] = useState(null);

  // Anime translateX quand openedEvent change. Pas d anim au mount (init OK).
  useEffect(() => {
    if (openedEvent) {
      // Ouverture : monte EventDetailScreen immediatement puis anime.
      setEventInPanel(openedEvent);
    }
    navTranslateX.value = withTiming(
      openedEvent ? 0 : -SCREEN_W,
      { duration: 380, easing: navEasing },
      (finished) => {
        // Fin de l anim close -> on peut maintenant demonter EventDetailScreen.
        if (finished && !openedEvent) {
          runOnJS(setEventInPanel)(null);
        }
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedEvent]);
  // Swipe back : drag horizontal sur le panneau Event pour ramener l accueil.
  // activeOffsetX([-15, 15]) -> active uniquement sur drag horizontal > 15px.
  // failOffsetY([-25, 25])    -> fail si scroll vertical > 25px (laisse passer
  //                              les scrolls de la galerie FlatList).
  const closeEventJS = useCallback(() => setOpenedEvent(null), []);
  const navPan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-25, 25])
    .onUpdate((e) => {
      // translateX = 0 (event affiche) + e.translationX (negatif si drag gauche)
      // Clamp [-SCREEN_W, 0] : empeche d aller au-dela des limites.
      const t = Math.max(-SCREEN_W, Math.min(0, e.translationX));
      navTranslateX.value = t;
    })
    .onEnd((e) => {
      const closeThreshold = -SCREEN_W / 3;
      const velocityThreshold = -500;
      const shouldClose = e.translationX < closeThreshold || e.velocityX < velocityThreshold;
      if (shouldClose) {
        navTranslateX.value = withTiming(-SCREEN_W, { duration: 280, easing: navEasing }, (finished) => {
          if (finished) runOnJS(closeEventJS)();
        });
      } else {
        navTranslateX.value = withTiming(0, { duration: 280, easing: navEasing });
      }
    }), [closeEventJS]);

  useEffect(() => {
    const idx = tabs.indexOf(bottomTab);
    if (idx === -1) return;
    Animated.spring(tabsTranslateX, {
      toValue: -idx * SCREEN_W,
      useNativeDriver: true,
      tension: 90, friction: 13,
    }).start();
  }, [bottomTab, tabs]);

  const swipeNav = useMemo(() => {
    const idx = tabs.indexOf(bottomTab);
    return Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-15, 15])
      .runOnJS(true)
      .onUpdate((e) => {
        if (idx === -1) return;
        let val = -idx * SCREEN_W + e.translationX;
        const minX = -(tabs.length - 1) * SCREEN_W;
        if (val > 0) val = val * 0.3;
        if (val < minX) val = minX + (val - minX) * 0.3;
        tabsTranslateX.setValue(val);
      })
      .onEnd((e) => {
        if (idx === -1) return;
        const threshold = SCREEN_W * 0.22;
        let nextIdx = idx;
        if ((e.translationX < -threshold || e.velocityX < -800) && idx < tabs.length - 1) {
          nextIdx = idx + 1;
        } else if ((e.translationX > threshold || e.velocityX > 800) && idx > 0) {
          nextIdx = idx - 1;
        }
        const target = tabs[nextIdx];
        if (target === bottomTab) {
          Animated.spring(tabsTranslateX, {
            toValue: -idx * SCREEN_W, useNativeDriver: true, tension: 90, friction: 13,
          }).start();
          return;
        }
        setBottomTab(target);
        setOpenedEvent(null);
        if (target !== 'events') {
          setOrganizerEventPhotosTarget(null);
          setOrganizerEventDetailTarget(null);
        }
      });
  }, [tabs, bottomTab, runnerSession, requireAuth]);

  // Pas de spinner fallback : on rend directement le contenu reel meme
  // si fontsLoaded est encore false. Le splash iOS (controle par
  // expo-splash-screen) reste visible pendant ce temps via
  // preventAutoHideAsync, donc l utilisateur ne voit pas le contenu avec
  // font systeme. Le hideAsync est differe via requestAnimationFrame +
  // setTimeout pour laisser React stabiliser le layout apres le 1er
  // render reel.

  // Mode photographe (full screen caméra)
  if (inPhotographerMode && (session?.role === 'photographer' || session?.role === 'organizer')) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
          <PhotographerScreen
            session={session}
            // Bouton retour : sort du mode sans effacer la session — le
            // photographe peut revenir avec un seul tap (pas de re-saisie mdp).
            onExit={() => setInPhotographerMode(false)}
            // Vraie déconnexion : efface la session SecureStore + queue locale.
            // Au prochain login (meme event ou autre), la galerie repart vide :
            // les photos uploadees restent consultables via le dashboard orga.
            onLogout={async () => {
              try { await AsyncStorage.multiRemove([UPLOAD_QUEUE_KEY, LAST_CAPTURE_KEY]); } catch {}
              try { const d = pendingDir(); if (d.exists) d.delete(); } catch {}
              setSession(null);
              setInPhotographerMode(false);
              Secure.removeItem('@will_photographer_session').catch(() => {});
            }}
          />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {!organizerEventPhotosTarget && (
      <ReAnimated.View style={[
        { flex: 1, flexDirection: 'row', width: SCREEN_W * 2 },
        navStyle,
      ]}>
        {/* PANNEAU GAUCHE : EVENT. eventInPanel reste set PENDANT l anim
            close (cf useEffect [openedEvent] qui clear au callback de fin
            d anim), permettant a EventDetailScreen de glisser vers la
            gauche au lieu de disparaitre instantanement. */}
        <View style={{ width: SCREEN_W, height: '100%', backgroundColor: C.bg }}>
          <SafeAreaView style={{ flex: 1 }}>
            {eventInPanel && (
              <GestureDetector gesture={navPan}>
                <View style={{ flex: 1 }}>
                  <EventDetailScreen
                    event={eventInPanel}
                    onClose={() => setOpenedEvent(null)}
                    onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                    selfieUri={selfieUri}
                    onDeleteSelfie={deleteSelfie}
                    onOpenProfile={() => setProfileMenu(true)}
                    onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...(opts || {}) })}
                    isFollowing={follows.includes(eventInPanel.code)}
                    onToggleFollow={() => requireAuth(() => toggleFollow(eventInPanel.code))}
                  />
                </View>
              </GestureDetector>
            )}
          </SafeAreaView>
        </View>

        {/* PANNEAU DROIT : ACCUEIL (HomeScreen + tabs internes) */}
        <View style={{ width: SCREEN_W, height: '100%' }}>
          <SafeAreaView style={{ flex: 1 }}>
        <GestureDetector gesture={swipeNav}>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View style={{
              flex: 1,
              flexDirection: 'row',
              width: SCREEN_W * tabs.length,
              transform: [{ translateX: tabsTranslateX }],
            }}>
              <View style={{ width: SCREEN_W }}>
                <HomeScreen
                  events={events}
                  onOpenEvent={setOpenedEvent}
                  onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                  onOpenOrg={() => setOrgModal(true)}
                  onOpenOrgRole={handlePickRole}
                  onOpenSearch={() => setSearchModal(true)}
                  tab={tab}
                  setTab={setTab}
                  selfieUri={selfieUri}
                  onDeleteSelfie={deleteSelfie}
                  onOpenProfile={() => setProfileMenu(true)}
                  follows={follows}
                  onToggleFollow={(code) => requireAuth(() => toggleFollow(code))}
                  onRefresh={reloadEvents}
                  runnerFirstName={runnerSession?.profile?.firstName}
                  selfieSkipped={!!runnerSession && selfieSkipped && !selfieUri}
                />
              </View>
              <View style={{ width: SCREEN_W }}>
                {runnerSession ? (
                  <PhotosScreen
                    events={events}
                    onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                    selfieUri={selfieUri}
                    onDeleteSelfie={deleteSelfie}
                    onOpenProfile={() => setProfileMenu(true)}
                    follows={follows}
                    runnerToken={runnerSession?.token}
                    onFindEvent={() => setBottomTab('home')}
                    onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...(opts || {}) })}
                    photoFavoritesSet={photoFavoritesSet}
                    onTogglePhotoFavorite={togglePhotoFavorite}
                    isActive={bottomTab === 'photos'}
                    selfieSkipped={selfieSkipped && !selfieUri}
                  />
                ) : (
                  <PhotosUnauthScreen
                    onSignup={() => { setAuthInitialMode('register'); setAuthModalVisible(true); }}
                    onLogin={() => { setAuthInitialMode('login'); setAuthModalVisible(true); }}
                  />
                )}
              </View>
              {organizerSession && (
                <View style={{ width: SCREEN_W }}>
                  <OrganizerDashboardScreen
                    session={organizerSession}
                    onLogout={logoutOrganizer}
                    onCreateEvent={() => setCreateEventModal(true)}
                    onEditEvent={(e) => setEditEventTarget(e)}
                    onOpenProfile={() => setOrganizerProfileMenu(true)}
                    onOpenEventPhotos={(e) => setOrganizerEventPhotosTarget(e)}
                    onOpenEventDetail={(e) => setOrganizerEventDetailTarget(e)}
                    onOpenOrgRole={handlePickRole}
                    refreshKey={orgRefreshKey}
                  />
                </View>
              )}
            </Animated.View>
          </View>
        </GestureDetector>
          </SafeAreaView>
        </View>
      </ReAnimated.View>
      )}

      {organizerEventPhotosTarget && bottomTab === 'events' && organizerSession && (
        <OrganizerEventPhotosScreen
          session={organizerSession}
          event={organizerEventPhotosTarget}
          onClose={() => setOrganizerEventPhotosTarget(null)}
          onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...opts })}
        />
      )}

      {organizerEventDetailTarget && bottomTab === 'events' && organizerSession && (
        <OrganizerEventDetailScreen
          session={organizerSession}
          event={organizerEventDetailTarget}
          onClose={() => setOrganizerEventDetailTarget(null)}
          onEdit={() => {
            const e = organizerEventDetailTarget;
            setOrganizerEventDetailTarget(null);
            setEditEventTarget(e);
          }}
          onOpenPhotos={() => {
            const e = organizerEventDetailTarget;
            setOrganizerEventDetailTarget(null);
            setOrganizerEventPhotosTarget(e);
          }}
          onDeleted={() => {
            setOrganizerEventDetailTarget(null);
            setOrgRefreshKey(k => k + 1);
          }}
        />
      )}

      {/* Degrade blanc qui fond le contenu vers le menu footer (au lieu d'une
          ligne nette + marche des coins arrondis). pointerEvents=none pour ne
          pas bloquer les taps. Hauteur 50 = suffisant pour effacer la
          discontinuite visuelle sans couper le contenu utile. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']}
        locations={[0, 0.6]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,         // jusqu en bas (couvre la zone navbar = blanc opaque)
          height: 180,       // 100 fondu + 80 zone navbar
          zIndex: 5,
        }}
      />

      {/* Bottom Nav */}
      <View style={s.bottomNav}>
        <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('home'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); }}>
          <View style={s.navIconWrap}>
            <Icon.Home size={22} filled={bottomTab === 'home'} color={bottomTab === 'home' ? C.primary : C.text} />
          </View>
          <Text style={[s.navLabel, bottomTab === 'home' && { color: C.primary, fontWeight: '700' }]}>Accueil</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('photos'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); }}>
          <View style={s.navIconWrap}>
            <Icon.Photos size={22} filled={bottomTab === 'photos'} color={bottomTab === 'photos' ? C.primary : C.text} />
            {/* E3 — pastille rouge unread. Affichee si photosUnread > 0 et
                qu on n est pas deja sur l onglet Photos (reset sinon). */}
            {photosUnread > 0 && bottomTab !== 'photos' && (
              <View style={{
                position: 'absolute', top: -3, right: -8,
                minWidth: 16, height: 16, borderRadius: 8,
                paddingHorizontal: 4,
                backgroundColor: '#EF4444',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1.5, borderColor: C.bg,
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 11 }}>
                  {photosUnread > 99 ? '99+' : photosUnread}
                </Text>
              </View>
            )}
          </View>
          <Text style={[s.navLabel, bottomTab === 'photos' && { color: C.primary, fontWeight: '700' }]}>Photos</Text>
        </TouchableOpacity>
        {organizerSession && (
          <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('events'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); }}>
            <View style={s.navIconWrap}>
              <Icon.ListEvents size={26} color={bottomTab === 'events' ? C.pinkPill : C.text} />
            </View>
            <Text style={[s.navLabel, bottomTab === 'events' && { color: C.pinkPill, fontWeight: '700' }]}>Mes events</Text>
          </TouchableOpacity>
        )}
      </View>

      <SearchModal
        visible={searchModal}
        events={events}
        onClose={() => setSearchModal(false)}
        onPick={(e) => setOpenedEvent(e)}
      />

      <OrganizationModal
        visible={orgModal}
        onClose={() => setOrgModal(false)}
        onPickRole={handlePickRole}
      />

      <PhaseDResetModal
        visible={showResetModal}
        onClose={() => setShowResetModal(false)}
      />

      <SelfieModal
        visible={selfieModal}
        onClose={() => { setSelfieModal(false); setSignupSelfieStep(false); pendingFollowRef.current = null; }}
        onSaved={(uri) => {
          setSelfieUri(uri);
          // Selfie pris → on retire la pastille "selfie manquant" sur l'accueil.
          AsyncStorage.removeItem('@will_selfie_skipped').catch(() => {});
          setSelfieSkipped(false);
          setSignupSelfieStep(false);
          // Phase D : si un follow attendait le selfie, relance-le maintenant.
          const pendingEvent = pendingFollowRef.current;
          if (pendingEvent) {
            pendingFollowRef.current = null;
            // setTimeout pour laisser le modal se fermer proprement avant le toast eventuel
            setTimeout(() => { toggleFollow(pendingEvent); }, 200);
          }
        }}
        userId={userId}
        runnerToken={runnerSession?.token}
        signupMode={signupSelfieStep}
        onSkip={() => {
          AsyncStorage.setItem('@will_selfie_skipped', '1').catch(() => {});
          setSelfieSkipped(true);
          setSignupSelfieStep(false);
          setSelfieModal(false);
        }}
      />

      <LoginModal
        visible={!!loginRole}
        role={loginRole}
        events={events}
        onClose={() => setLoginRole(null)}
        onSuccess={(r) => {
          setLoginRole(null);
          // Merge metadata complets (cover_image, location, distances…) depuis
          // la liste events — la réponse worker peut ne contenir qu'un sous-ensemble.
          const code = r?.event?.code;
          const fullEvent = (code && events.find(e => e.code === code)) || {};
          const mergedEvent = { ...fullEvent, ...(r?.event || {}) };
          const next = { ...r, event: mergedEvent, role: loginRole };
          setSession(next);
          setInPhotographerMode(true);
          // Persistance pour accès hors ligne (sessions photographe / organizer event)
          Secure.setItem('@will_photographer_session', JSON.stringify(next)).catch(() => {});
          // Téléchargement du cover en local pour affichage offline. On met à
          // jour la session une fois le fichier disponible (fire and forget).
          if (loginRole === 'photographer' && mergedEvent.cover_image) {
            cacheEventCover(mergedEvent.code, mergedEvent.cover_image).then(localUri => {
              if (!localUri) return;
              const updated = {
                ...next,
                event: { ...mergedEvent, cover_local_uri: localUri },
              };
              setSession(updated);
              Secure.setItem('@will_photographer_session', JSON.stringify(updated)).catch(() => {});
            });
          }
        }}
      />

      <CreateEventModal
        visible={createEventModal}
        onClose={() => setCreateEventModal(false)}
        organizerSession={organizerSession}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <CreateEventModal
        visible={!!editEventTarget}
        onClose={() => setEditEventTarget(null)}
        organizerSession={organizerSession}
        editEvent={editEventTarget}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <ProfileMenuModal
        visible={profileMenu}
        onClose={() => setProfileMenu(false)}
        selfieUri={selfieUri}
        onView={() => { setProfileMenu(false); setSelfieViewer(true); }}
        onRetake={() => requireAuth(() => setSelfieModal(true))}
        onDelete={deleteSelfie}
        runnerSession={runnerSession}
        onLogout={logoutRunner}
        onLogin={() => setAuthModalVisible(true)}
        onUpdateProfile={updateRunnerProfile}
        onDeleteAccount={() => { setProfileMenu(false); deleteRunnerAccount(); }}
        onDeleteFaceData={() => { setProfileMenu(false); deleteFaceData(); }}
      />

      <SelfieViewerModal
        visible={selfieViewer}
        uri={selfieUri}
        onClose={() => { setSelfieViewer(false); setProfileMenu(true); }}
      />

      <PhotoViewerModal
        visible={!!openedPhoto}
        photo={openedPhoto?.photo}
        photos={openedPhoto?.photos}
        allowDelete={openedPhoto?.allowDelete}
        onDelete={openedPhoto?.onDelete}
        onTogglePhotoVisibility={openedPhoto?.onTogglePhotoVisibility}
        origin={openedPhoto?.origin}
        eventTitle={openedPhoto?.eventTitle}
        eventDate={openedPhoto?.eventDate}
        onClose={() => setOpenedPhoto(null)}
        photoFavoritesSet={photoFavoritesSet}
        onTogglePhotoFavorite={togglePhotoFavorite}
      />

      <AuthRunnerModal
        visible={authModalVisible}
        onClose={() => setAuthModalVisible(false)}
        onSuccess={handleAuthSuccess}
        initialMode={authInitialMode}
      />

      <AuthOrganizerModal
        visible={organizerAuthVisible}
        onClose={() => setOrganizerAuthVisible(false)}
        onSuccess={handleOrganizerAuthSuccess}
      />

      <OrganizerProfileMenuModal
        visible={organizerProfileMenu}
        onClose={() => setOrganizerProfileMenu(false)}
        organizerSession={organizerSession}
        onLogout={logoutOrganizer}
        onUpdate={updateOrganizerProfile}
        onDeleteAccount={() => { setOrganizerProfileMenu(false); deleteOrganizerAccount(); }}
      />

    </SafeAreaView>

    {/* Splash overlay : ecran blanc + LoadingIcon (fleur Will) violet light
        centre. Meme icone que le pull-to-refresh des galeries -> ressenti
        coherent. Hors SafeAreaView pour couvrir notch + status bar.
        Visible 1s minimum apres splash iOS natif, puis fade out 400ms. */}
    {splashOverlayVisible && (
      <ReAnimated.View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: '#fff', zIndex: 9999, alignItems: 'center', justifyContent: 'center' },
          splashOverlayStyle,
        ]}
      >
        {/* Logo Will violet primary charte (#7B2FFF), static. */}
        <Icon.Logo width={100} color={C.primary} />
      </ReAnimated.View>
    )}
    </GestureHandlerRootView>
  );
}

// ---------- STYLES ----------
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orgToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(244, 166, 255, 0.2)',
    borderRadius: 16,
    padding: 4,
    alignItems: 'center',
    gap: 4,
  },
  orgToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  welcome: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 18, color: C.text, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 18 },

  selfieDoneBanner: { backgroundColor: C.white, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8, borderWidth: 1, borderColor: C.primaryLight },
  selfieCheckCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4A6FF', alignItems: 'center', justifyContent: 'center' },
  selfieDoneTitle: { fontWeight: '700', fontSize: 15, color: C.primary, fontFamily: 'AVEstiana', fontStyle: 'normal' },
  selfieDoneSub: { fontSize: 12, color: C.textSoft, marginTop: 2, lineHeight: 16 },
  selfieDelete: { padding: 6 },

  selfieCard: { borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', minHeight: 110, marginBottom: 8 },
  selfieTitle: { color: '#fff', fontSize: 24, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal', lineHeight: 28 },
  selfieSub: { color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: 12.5, lineHeight: 17 },
  selfieAvatar: { width: 68, height: 68, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  eventPick: { backgroundColor: C.white, borderRadius: 14, padding: 14, marginTop: 8 },
  eventPickName: { fontWeight: '700', fontSize: 15, color: C.text },
  eventPickDate: { fontSize: 12, color: C.textSoft, marginTop: 2 },

  sectionTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text },
  pill: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12 },
  pillActive: { backgroundColor: C.primary },
  pillText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: '#fff' },

  empty: { textAlign: 'center', color: C.textSoft, marginTop: 24, fontSize: 14 },

  eventCard: { height: 90, borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: '#222', justifyContent: 'center' },
  eventCardCenter: { paddingHorizontal: 16, zIndex: 2 },
  eventDate: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1, opacity: 0.9, marginBottom: 2 },
  eventName: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal' },
  eventLocation: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },

  pageTitleCenter: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 26, fontWeight: '700', color: C.primary, textAlign: 'center', marginVertical: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: (SCREEN_W - 40 - 24) / 4, height: (SCREEN_W - 40 - 24) / 4, marginBottom: 8 },
  gridPlaceholder: { flex: 1, backgroundColor: C.primaryLight, borderRadius: 12 },
  gridImg: { flex: 1, borderRadius: 12 },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'transparent', flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 28, paddingTop: 12, paddingHorizontal: 16, zIndex: 6 },
  navBtn: { alignItems: 'center', justifyContent: 'flex-start', gap: 4, minWidth: 80 },
  navIconWrap: { height: 26, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 12, color: C.text, marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D0CCE3', alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  modalSub: { color: C.textSoft, textAlign: 'center', marginBottom: 18, fontSize: 13 },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 12 },
  modalCancelText: { color: C.textSoft, fontWeight: '600' },

  btnPrimary: { backgroundColor: C.primary, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnSecondaryText: { color: C.primary, fontWeight: '600', fontSize: 14 },

  selfiePreviewWrap: { alignItems: 'center', marginVertical: 16 },
  selfiePreview: { width: 160, height: 160, borderRadius: 80 },

  typePill: { backgroundColor: C.white, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  typePillActive: { backgroundColor: C.primary },
  typePillText: { fontSize: 12, color: C.text, fontWeight: '600' },
});
