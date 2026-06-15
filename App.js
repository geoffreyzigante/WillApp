import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions, RefreshControl,
  StatusBar, SafeAreaView, Platform, KeyboardAvoidingView, Animated, Easing, Keyboard, Linking,
  AppState, Share, NativeModules, PanResponder, LayoutAnimation,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
function readExposure(frame, options) {
  'worklet';
  if (exposureReaderPlugin == null) {
    throw new Error('readExposure plugin not loaded — rebuild required');
  }
  // options optionnel : { setCapSeconds, brightnessLabel } -> le plugin
  // applique device.activeMaxExposureDuration via WillShutterController.
  return options
    ? exposureReaderPlugin.call(frame, options)
    : exposureReaderPlugin.call(frame);
}

// Format shutter EXIF (secondes -> fraction lisible) pour debug overlay.
// Sur preview iOS, le shutter est cape par l'intervalle frame (1/30s a
// 30 fps) : on ne descend jamais sous quelques 1/30s, l'auto-expo monte
// l'ISO a la place. Donc tjrs format "1/N" en pratique, mais on garde
// le cas >= 1s par securite (jamais vu sur preview video).
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolateColor,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Svg, { Path, Circle, Ellipse, Defs, Mask, Rect, SvgXml } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import NetInfo from '@react-native-community/netinfo';
import { Paths, File, Directory } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { useKeepAwake } from 'expo-keep-awake';
import * as Battery from 'expo-battery';

import { API_URL, R2_PUBLIC, PRICE_PER_PHOTO_EUR } from './src/constants/api';
import {
  UPLOAD_QUEUE_KEY,
  LAST_CAPTURE_KEY,
  PENDING_DIR_NAME,
  RAW_SUBDIR,
  PROCESSED_SUBDIR,
  COVERS_DIR_NAME,
  MAX_RETRIES_DEFAULT,
  STORAGE_WARN_BYTES,
  DISK_LOW_BYTES,
  QUEUE_WARN_THRESHOLD,
  MAX_QUEUE_SIZE,
  retryDelayMs,
} from './src/constants/queue';
import {
  formatShutter,
  formatEV,
  formatTimeAgo,
  MONTHS_FULL,
  MONTHS_SHORT,
  formatDateLong,
  formatDateForForm,
  isUpcoming,
  displayEventType,
  cityLabel,
} from './src/utils/format';
import {
  generateItemId,
  extractBurstTs,
  extractIdx,
  raceTitle,
  raceTitleFromPhoto,
  detectPhotoExtension,
} from './src/utils/photo';
import {
  pendingDir,
  rawDir,
  processedDir,
  coversDir,
  ensurePendingDir,
  ensureCoversDir,
  writeSidecar,
  readSidecar,
  deleteSidecar,
  cacheEventCover,
  loadUploadQueue,
  saveUploadQueue,
  pendingDirSizeBytes,
  pendingDirSizeBytesCached,
} from './src/services/storage';
import {
  BackgroundUploaderModule,
  hasBackgroundUploader,
  bgUploaderEmitter,
  pendingBgUploads,
} from './src/services/backgroundUploader';
import {
  hasThermalMonitor,
  concurrencyForThermal,
  getCurrentThermalState,
} from './src/services/thermalMonitor';
import { C, TYPE_COLORS, colorForType } from './src/constants/colors';
import {
  cartChangeListeners,
  emitCartChange,
  setCurrentRunnerSession,
  getCurrentRunnerSession,
  pushCartToBackend,
} from './src/services/cart';
import {
  SECURE_KEYS,
  toSecureKey,
  Secure,
  migrateSensitiveKeysToSecureStore,
} from './src/services/secureStore';
import { api, apiFetch, ensurePushRegistered, uploadSelfieToR2 } from './src/services/api';
import { modeChipStyleApp, modeChipTextStyleApp, selfieDotColor } from './src/utils/styleHelpers';
import { Icon } from './src/components/Icon';
import { PasswordInput } from './src/components/PasswordInput';
import {
  LoadingIcon,
  SpinningLoader,
  PULL_THRESHOLD,
  RefreshableScrollView,
} from './src/components/loaders';
import { GridErrorBoundary } from './src/components/GridErrorBoundary';
import { SelfieIllustration } from './src/components/SelfieIllustration';
import { PhotosStepRow } from './src/components/PhotosStepRow';
import { FavStar } from './src/components/FavStar';
import { SkeletonCell } from './src/components/SkeletonCell';
import { InfoRow } from './src/components/InfoRow';
import { SelfieBlock } from './src/components/SelfieBlock';
import { EventCard } from './src/components/EventCard';
import { ConsentRenewBanner } from './src/components/ConsentRenewBanner';
import { PhotosEmptyState } from './src/components/PhotosEmptyState';
import {
  WHEEL_ITEM_W,
  WHEEL_H,
  WHEEL_LOOPS,
  WheelItem,
  FilterWheel,
  RaceDropdown,
} from './src/components/wheels';
import { PhotosUnauthScreen } from './src/screens/PhotosUnauthScreen';
import { PIN_REGEX, isValidPin, generateRandomPin } from './src/utils/pin';
import { PinInputRow } from './src/components/PinInputRow';
import { PinDisplay } from './src/components/PinDisplay';
import { Haptics } from './src/services/haptics';
import { PhotoCell, PhotoGrid, PhotoGridItem } from './src/components/PhotoGrid';
import { OverlayWheel } from './src/components/OverlayWheel';
import { SearchModal } from './src/components/modals/SearchModal';
import { PhaseDResetModal } from './src/components/modals/PhaseDResetModal';
import { SelfieViewerModal } from './src/components/modals/SelfieViewerModal';
import { OrganizationModal } from './src/components/modals/OrganizationModal';
import { SubModalInputText } from './src/components/modals/SubModalInputText';
import { CalendarRangeModal } from './src/components/modals/CalendarRangeModal';
import { CropImageModal } from './src/components/modals/CropImageModal';
import { s } from './src/constants/styles';

// Active le panneau debug en build de dev (Metro/expo start) ou de preview
// (EAS preview channel). En production, le bouton ⚙️ est masque pour ne pas
// laisser fuiter des toggles internes a l'utilisateur final.
const IS_PREVIEW_OR_DEV = __DEV__ || Updates.channel === 'preview';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── PANIER ───
// Helpers module-level (cartChangeListeners, emitCartChange,
// setCurrentRunnerSession, getCurrentRunnerSession, pushCartToBackend)
// -> src/services/cart.js
// useCart / useAllCarts ci-dessous restent pour l'instant : ils utilisent
// du React state qui est plus tendu a extraire sans test iPhone.

function useCart(eventCode) {
  const [cart, setCart] = useState([]);
  const [version, setVersion] = useState(0);
  const storageKey = eventCode ? `will:cart:${eventCode}` : null;
  useEffect(() => {
    if (!storageKey) { setCart([]); return; }
    let cancelled = false;
    AsyncStorage.getItem(storageKey).then((v) => {
      if (cancelled) return;
      try {
        const arr = v ? JSON.parse(v) : [];
        setCart(Array.isArray(arr) ? arr : []);
      } catch { setCart([]); }
    }).catch(() => { if (!cancelled) setCart([]); });
    return () => { cancelled = true; };
  }, [storageKey, version]);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    cartChangeListeners.add(fn);
    return () => { cartChangeListeners.delete(fn); };
  }, []);
  const persist = useCallback((next) => {
    setCart(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
      pushCartToBackend(eventCode, next);
    }
  }, [storageKey, eventCode]);
  const toggle = useCallback((key) => {
    if (!key) return;
    setCart((prev) => {
      const i = prev.indexOf(key);
      const next = i >= 0 ? prev.filter((k) => k !== key) : [...prev, key];
      if (storageKey) {
        AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        pushCartToBackend(eventCode, next);
      }
      return next;
    });
  }, [storageKey, eventCode]);
  const remove = useCallback((key) => {
    if (!key) return;
    setCart((prev) => {
      const next = prev.filter((k) => k !== key);
      if (storageKey) {
        AsyncStorage.setItem(storageKey, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        pushCartToBackend(eventCode, next);
      }
      return next;
    });
  }, [storageKey, eventCode]);
  return { cart, count: cart.length, toggle, remove, persist };
}

// Aggrege TOUTES les cles `will:cart:*` d AsyncStorage en une Map
// <eventCode, photoKeys[]>. Utilise par PanierScreen (onglet Panier
// global) pour afficher le panier cross-event + total agrege. Sync
// via cartChangeListeners.
function useAllCarts() {
  const [carts, setCarts] = useState(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Phase 1 : lecture locale (rapide)
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const cartKeys = (allKeys || []).filter((k) => k.startsWith('will:cart:'));
        const entries = cartKeys.length > 0 ? await AsyncStorage.multiGet(cartKeys) : [];
        if (cancelled) return;
        const m = new Map();
        for (const [k, v] of entries) {
          const code = k.substring('will:cart:'.length);
          try {
            const arr = JSON.parse(v || '[]');
            if (Array.isArray(arr) && arr.length > 0) m.set(code, arr);
          } catch {}
        }
        setCarts(m);
      } catch {
        if (!cancelled) setCarts(new Map());
      }
      // Phase 2 : fetch backend si authed, REPLACE local (backend = source
      // of truth). La migration union du panier anonyme est faite UNE fois
      // dans App.useEffect au login (flag `will:cart:syncDone:{userId}`).
      // Ici on remplace strict pour respecter les suppressions cross-device.
      const s = getCurrentRunnerSession();
      if (!s?.token || cancelled) return;
      try {
        const r = await fetch(`${API_URL}/runner/cart`, {
          headers: { Authorization: `Bearer ${s.token}` },
        });
        if (!r.ok || cancelled) return;
        const data = await r.json().catch(() => null);
        const backend = (data && data.carts && typeof data.carts === 'object') ? data.carts : {};
        const allKeys2 = await AsyncStorage.getAllKeys();
        const cartKeys2 = (allKeys2 || []).filter((k) => k.startsWith('will:cart:'));
        if (cancelled) return;
        const localCodes = cartKeys2.map((k) => k.substring('will:cart:'.length));
        const allCodes = new Set([...Object.keys(backend), ...localCodes]);
        const merged = new Map();
        for (const code of allCodes) {
          const remote = backend[code] || [];
          if (remote.length > 0) {
            merged.set(code, remote);
            await AsyncStorage.setItem(`will:cart:${code}`, JSON.stringify(remote));
          } else {
            // Backend dit pas de panier pour cet event -> wipe local.
            await AsyncStorage.removeItem(`will:cart:${code}`);
          }
        }
        if (cancelled) return;
        setCarts(merged);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [version]);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    cartChangeListeners.add(fn);
    return () => { cartChangeListeners.delete(fn); };
  }, []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const total = useMemo(() => {
    let n = 0;
    for (const arr of carts.values()) n += arr.length;
    return n;
  }, [carts]);
  const remove = useCallback((eventCode, photoKey) => {
    if (!eventCode || !photoKey) return;
    const k = `will:cart:${eventCode}`;
    AsyncStorage.getItem(k).then((v) => {
      try {
        const arr = JSON.parse(v || '[]');
        const next = Array.isArray(arr) ? arr.filter((x) => x !== photoKey) : [];
        if (next.length === 0) {
          AsyncStorage.removeItem(k).then(() => emitCartChange()).catch(() => {});
        } else {
          AsyncStorage.setItem(k, JSON.stringify(next)).then(() => emitCartChange()).catch(() => {});
        }
        pushCartToBackend(eventCode, next);
      } catch {}
    }).catch(() => {});
  }, []);
  return { carts, total, remove, refresh };
}

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

// SecureStore wrapper + migration (M-S08) -> src/services/secureStore.js

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

// Background URLSession (Phase B1) et ThermalMonitor (Phase B2) sont
// initialises au module-load dans src/services/backgroundUploader.js et
// src/services/thermalMonitor.js (cf imports en haut du fichier). Les
// listeners natifs sont attaches une fois pour toute, partages cross-render.






// ---------- DESIGN TOKENS ----------
// C, TYPE_COLORS, colorForType -> src/constants/colors.js


// modeChipStyleApp + modeChipTextStyleApp + selfieDotColor -> src/utils/styleHelpers.js
// apiFetch + uploadSelfieToR2 -> src/services/api.js

// ---------- ICONS (custom SVG) ----------

// ErrorBoundary générique pour les écrans à liste (galerie photos perso /
// orga / event). Évite qu'une URL malformée ou un render thrown dans une
// cellule fasse planter tout l'écran. Affiche un fallback avec retry.

// ---------- HELPERS ----------


// ---------- API ----------
// api + ensurePushRegistered -> src/services/api.js

// ---------- SCREENS ----------


function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, follows, onToggleFollow, onRefresh, runnerFirstName, selfieSkipped = false, isAuthed = false, onOpenAuthSignup, onOpenAuthLogin, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, cartTotal = 0, onOpenPanier }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Indicateur violet qui glisse entre les 3 pills. Mesure une fois la largeur
  // du conteneur (- padding), divise par 3 = largeur d un slot. Spring sur
  // translateX synchronise avec le state tab.
  const TAB_KEYS = ['upcoming', 'past', 'follows'];
  const tabIdx = Math.max(0, TAB_KEYS.indexOf(tab));
  const [tabsContainerW, setTabsContainerW] = useState(0);
  const tabsSlideX = useRef(new Animated.Value(0)).current;
  const slotW = tabsContainerW > 0 ? tabsContainerW / 3 : 0;
  useEffect(() => {
    if (slotW <= 0) return;
    Animated.spring(tabsSlideX, {
      toValue: slotW * tabIdx,
      useNativeDriver: true,
      tension: 110, friction: 14,
    }).start();
  }, [tabIdx, slotW, tabsSlideX]);

  // Transition du CONTENU sous les pills : fade + slide horizontal directionnel
  // (entrée par la droite si on va vers un tab "plus loin", par la gauche
  // sinon). Donne un sentiment de "page qui glisse" en synchronisation avec
  // l indicateur des pills.
  const lastTabIdxRef = useRef(tabIdx);
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentSlideX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (lastTabIdxRef.current === tabIdx) return;
    const direction = tabIdx > lastTabIdxRef.current ? 1 : -1;
    lastTabIdxRef.current = tabIdx;
    contentFade.setValue(0);
    contentSlideX.setValue(direction * 20);
    Animated.parallel([
      Animated.timing(contentFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(contentSlideX, { toValue: 0, useNativeDriver: true, tension: 50, friction: 12 }),
    ]).start();
  }, [tabIdx, contentFade, contentSlideX]);
  const tabFiltered = events.filter(e => {
    if (tab === 'upcoming') return isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'past') return !isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'follows') return follows.includes(e.code);
    return true;
  });
  const q = searchQuery.trim().toLowerCase();
  const filtered = (q
    ? tabFiltered.filter(e => (e.name || '').toLowerCase().includes(q))
    : tabFiltered
  ).slice().sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
  const scrollRef = useRef(null);

  // Quand le clavier se ferme : remonter le scroll en haut
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  // Tap sur l onglet Accueil quand deja sur Accueil = scroll-to-top.
  // scrollToTopSignal est un entier incremente par le parent a chaque tap.
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [scrollToTopSignal]);

  return (
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      {/* Header : avatar + "Bienvenue sur Will" + pills orga/photographe */}
      <View style={s.headerRow}>
        <View style={[s.headerLeft, { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }]}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            {selfieUri ? (
              <Image
                source={{ uri: selfieUri }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#c9beed' }}
              />
            ) : (
              <Icon.User size={30} color="#c9beed" />
            )}
            {selfieUri && (
              <TouchableOpacity
                onPress={(e) => {
                  if (selfieUploadState === 'failed') { e.stopPropagation?.(); onRetryUpload?.(); }
                }}
                disabled={selfieUploadState !== 'failed'}
                activeOpacity={selfieUploadState === 'failed' ? 0.6 : 1}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: selfieDotColor(selfieUploadState),
                  borderWidth: 2,
                  borderColor: C.bg,
                }}
              />
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* Pill panier : visible uniquement quand cart > 0. Tap ouvre
              la modale panier (comme l espace orga/photo). */}
          {cartTotal > 0 && onOpenPanier ? (
            <TouchableOpacity
              onPress={onOpenPanier}
              activeOpacity={0.7}
              hitSlop={6}
              style={{
                width: 40, height: 40,
                alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}
              accessibilityLabel="Voir mon panier"
            >
              <Svg width={26} height={24} viewBox="0 0 18.96 17.61" fill="#c9beed">
                <Path d="M9.49,9.19c-.38,0-.68.3-.68.68v3.38c0,.37.31.68.68.68s.68-.3.68-.68v-3.38c0-.37-.31-.68-.68-.68Z" />
                <Path d="M12.94,9.23c-.37-.06-.73.18-.79.55l-.59,3.33c-.07.37.18.72.55.78.37.06.73-.18.79-.55l.59-3.33c.07-.37-.18-.72-.55-.78Z" />
                <Path d="M6.04,9.23c-.37.06-.62.42-.55.78l.59,3.33c.07.37.42.61.79.55.37-.06.62-.42.55-.78l-.59-3.33c-.07-.37-.42-.61-.79-.55Z" />
                <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
              </Svg>
              <View style={{
                position: 'absolute', top: -4, right: -4,
                minWidth: 18, height: 18, borderRadius: 9,
                paddingHorizontal: 4,
                backgroundColor: C.primary,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 11 }}>
                  {cartTotal > 99 ? '99+' : cartTotal}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}
          <View style={s.orgToggle}>
            <TouchableOpacity
              style={s.orgToggleBtn}
              onPress={() => onOpenOrgRole('organizer')}
              activeOpacity={0.7}
              hitSlop={6}
            >
              <Icon.GearOrg size={22} color={C.pinkPillFg} />
            </TouchableOpacity>
            <View style={s.orgToggleDivider} />
            <TouchableOpacity
              style={s.orgToggleBtn}
              onPress={() => onOpenOrgRole('photographer')}
              activeOpacity={0.7}
              hitSlop={6}
            >
              <Icon.CamOrg size={24} color={C.pinkPillFg} />
            </TouchableOpacity>
          </View>
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
      {/* Si selfie deja pris, ajoute une marge respiratoire au-dessus du
          toggle de tri (sinon les pills A venir / Passes / Favoris sont
          collees au header Hello / + d infos). */}
      {selfieUri && <View style={{ height: 18 }} />}

      {/* Barre de recherche : rendue plus bas, EN DESSOUS de la row tabs.
          Cf. apres la fermeture de </View> de la row tabs + bouton loupe. */}

      {/* Row tabs (flex:1) + bouton loupe a droite qui toggle searchOpen.
          Le bouton loupe est en surface du meme fond C.pillBg pour rester
          coherent avec la row pills, mais SQUARED (40x40 r:12) avec icone
          loupe blanche dans rond violet, comme la pill recherche dossard. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <View
        onLayout={(e) => setTabsContainerW(e.nativeEvent.layout.width - 8)}
        style={{
          flex: 1,
          flexDirection: 'row',
          backgroundColor: C.pillBg,
          borderRadius: 16,
          padding: 4,
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Indicateur slide (violet sous les pills). Ne se rend qu une fois
            la largeur du conteneur connue, pour eviter un flash a 0. */}
        {slotW > 0 && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 4, top: 4, bottom: 4,
              width: slotW,
              backgroundColor: C.primary,
              borderRadius: 12,
              transform: [{ translateX: tabsSlideX }],
            }}
          />
        )}
        {/* 3 pills transparentes par-dessus. activeOpacity haut = feedback
            tap doux qui n eclipse pas le slide de l indicateur. */}
        <TouchableOpacity onPress={() => setTab('upcoming')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
          <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>À venir</Text>
        </TouchableOpacity>
        {tab === 'follows' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
        <TouchableOpacity onPress={() => setTab('past')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
          <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>Passés</Text>
        </TouchableOpacity>
        {tab === 'upcoming' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
        <TouchableOpacity onPress={() => setTab('follows')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
          <Text style={[s.pillText, tab === 'follows' && s.pillTextActive]}>Favoris</Text>
        </TouchableOpacity>
      </View>
      {/* Bouton loupe a droite des tabs : toggle l affichage de la barre
          de recherche. Au close, la query est videe pour reset le filtre. */}
      <TouchableOpacity
        onPress={() => {
          if (searchOpen) { setSearchQuery(''); Keyboard.dismiss(); }
          setSearchOpen(o => !o);
        }}
        activeOpacity={0.85}
        style={{
          width: 40, height: 40, borderRadius: 16,
          backgroundColor: searchOpen ? C.primary : C.pillBg,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Path d="M21 21l-4.35-4.35" stroke={searchOpen ? '#fff' : C.primary} strokeWidth={1.8} strokeLinecap="round" />
          <Path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" stroke={searchOpen ? '#fff' : C.primary} strokeWidth={1.7} />
        </Svg>
      </TouchableOpacity>
      </View>

      {/* Barre de recherche : visible UNIQUEMENT quand searchOpen, juste
          en-dessous des tabs. Pas de loupe interne (le bouton loupe a droite
          des tabs sert deja de declencheur visuel). Au close, on vide la
          query pour reset le filtre liste. */}
      {searchOpen && (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#fff',
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: '#E5E0FF',
          paddingHorizontal: 14,
          paddingVertical: 4,
          gap: 8,
          marginBottom: 8,
        }}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Rechercher un event"
            placeholderTextColor="#c9beed"
            style={{ flex: 1, fontSize: 14, color: C.primary, fontWeight: '400', paddingVertical: 8 }}
            returnKeyType="search"
            autoFocus
          />
          <TouchableOpacity
            onPress={() => { setSearchQuery(''); setSearchOpen(false); Keyboard.dismiss(); }}
            hitSlop={10}
            style={{ paddingHorizontal: 6 }}
          >
            <Text style={{ color: C.textSoft, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Events list / état vide. Cas special : Favoris en deconnecte
          -> empty state pedagogique 3 etapes (compte / selfie / favori)
          + value prop "photos avant la ligne d arrivee", PAS de modal de
          connexion automatique. Le user clique les CTA pour ouvrir l auth.
          Wrap dans Animated.View pour fade + slide a chaque switch de tab. */}
      <Animated.View style={{ opacity: contentFade, transform: [{ translateX: contentSlideX }] }}>
      {tab === 'follows' && !isAuthed ? (
        <View style={{ paddingVertical: 24, paddingHorizontal: 8, alignItems: 'center' }}>
          <SelfieIllustration size={84} />
          <Text style={{
            fontSize: 22, fontFamily: 'AVEstiana', color: C.text,
            textAlign: 'center', marginTop: 16, marginBottom: 8, lineHeight: 26,
          }}>
            Tes photos avant même{'\n'}la ligne d'arrivée
          </Text>
          <Text style={{
            fontSize: 13, color: C.textSoft, textAlign: 'center',
            lineHeight: 18, marginBottom: 22, paddingHorizontal: 8,
          }}>
            Ajoute tes events en favoris pour les suivre. Un selfie suffit pour être reconnu sur toutes les photos publiées (valable 12 mois renouvelables).
          </Text>
          {/* 3 etapes numerotees */}
          <View style={{ alignSelf: 'stretch', gap: 10, marginBottom: 22 }}>
            {[
              { n: 1, t: 'Crée ton compte et prends ton selfie' },
              { n: 2, t: 'Ajoute tes events en favoris pour les suivre' },
              { n: 3, t: "Profite, Will s'occupe du reste" },
            ].map(({ n, t }) => (
              <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FAF7FF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{n}</Text>
                </View>
                <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{t}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={onOpenAuthSignup}
            activeOpacity={0.88}
            style={{
              backgroundColor: C.primary,
              paddingVertical: 14, paddingHorizontal: 32,
              borderRadius: 14, alignSelf: 'stretch', alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Créer mon compte</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenAuthLogin} style={{ marginTop: 12, paddingVertical: 6 }} activeOpacity={0.7}>
            <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>J'ai déjà un compte</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <View style={{ marginBottom: 12, opacity: 0.4 }}>
            <Icon.Calendar size={36} color={C.textSoft} />
          </View>
          <Text style={{ color: C.textSoft, fontSize: 14 }}>
            {tab === 'follows' ? 'Aucun event en favoris' : tab === 'upcoming' ? 'Aucun événement à venir' : 'Aucun événement passé'}
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
      </Animated.View>
    </RefreshableScrollView>
  );
}


// Illustration selfie pour l'onboarding (visage stylise + FaceID).
// Source: assets/Selfie.svg, inline pour eviter un require asset transform.
// Couleur dynamique : violet primary par defaut (sur fond clair), blanc pour
// usage sur fond violet (ex. selfie card de l accueil).

// Ecran "Photos" quand le coureur n'est pas connecte. Explique la valeur
// (un selfie suffit) avant de proposer l'inscription. Les CTA pointent vers
// AuthRunnerModal en mode register ou login selon le bouton.

// Bandeau de renouvellement consentement biometrique (C8b).
// S affiche si le consent global expire dans < 30j. Couleur ambre a J-30,
// rouge a J-7. CTA Renouveler appelle POST /selfie/renew (sans re-upload).
// Fetch au mount + AppState 'active' pour rester a jour.

function PhotosScreen({ events = [], onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, follows, onFindEvent, runnerApiFetch, runnerUserId, onOpenPhoto, photoFavoritesSet, onTogglePhotoFavorite, onRefreshFavorites, selfieSkipped = false, isActive = true, selfieUploadState = 'idle', onRetryUpload }) {
  // Cle de cache locale photos, scopee par userId. Sans le scope :
  //  - user B sur le meme device verrait les photos de A apres logout/login (RGPD)
  //  - on devait clear le cache au logout -> rechargement reseau a la reconnexion
  //    qui faisait "tourner la recherche" pour des photos deja trouvees.
  // Scopee : on garde le cache au logout, hydratation instantanee a la
  // reconnexion du meme compte.
  const photosCacheKey = runnerUserId ? `@will_photos_cache_${runnerUserId}` : '@will_photos_cache';
  const knownEventsCacheKey = runnerUserId ? `@will_known_events_${runnerUserId}` : null;
  // knownEvents = events ou l user a un consent (actif OU revoke). Source
  // de verite pour /personal-gallery cote mobile : permet d afficher les
  // photos matchees meme apres un unfollow (decision produit 2026-06-03).
  // Persiste en AsyncStorage pour hydratation instantanee au cold start.
  const [knownEvents, setKnownEvents] = useState([]);
  // Union (follows + knownEvents) pour ne pas perdre les events fraichement
  // follow tant que knownEvents n a pas encore ete refresh.
  const eventsToQuery = useMemo(() => {
    const set = new Set();
    for (const c of follows) set.add(c);
    for (const c of knownEvents) set.add(c);
    return [...set];
  }, [follows, knownEvents]);
  const hasFollows = eventsToQuery.length > 0;
  const [photos, setPhotos] = useState([]);
  const [anySearching, setAnySearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Pagination progressive cote client (eviter de monter 500 cellules d un coup
  // au premier render quand un coureur cumule plusieurs events).
  const [visibleCount, setVisibleCount] = useState(30);

  // Sélection multi + download batch : "Sélectionner" en haut a droite de
  // la grille des qu il y a > 1 photo. Permet d en cocher plusieurs et de
  // les sauver d un coup dans la pellicule iOS.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [downloading, setDownloading] = useState(false);
  // Filtre 3 onglets : Moi (personal-gallery) / Mes favoris / Tous.
  // _isPersonalMatch marque les photos de /personal-gallery (match reco
  // faciale sur events suivis), pour les distinguer des fav cross-event.
  // Style identique aux pills "A venir / Passes / Favoris" de l accueil :
  // indicateur violet glisse en spring sur le tab actif (parite charte).
  const [viewFilter, setViewFilter] = useState('me'); // 'me' | 'favs' | 'all'
  const VIEW_KEYS = ['me', 'favs', 'all'];
  const viewIdx = Math.max(0, VIEW_KEYS.indexOf(viewFilter));
  const [viewTabsContainerW, setViewTabsContainerW] = useState(0);
  const viewTabsSlideX = useRef(new Animated.Value(0)).current;
  const viewSlotW = viewTabsContainerW > 0 ? viewTabsContainerW / 3 : 0;
  useEffect(() => {
    if (viewSlotW <= 0) return;
    Animated.spring(viewTabsSlideX, {
      toValue: viewSlotW * viewIdx,
      useNativeDriver: true,
      tension: 110, friction: 14,
    }).start();
  }, [viewIdx, viewSlotW, viewTabsSlideX]);
  const visiblePhotos = useMemo(() => {
    if (viewFilter === 'favs') {
      return photoFavoritesSet ? photos.filter(p => photoFavoritesSet.has(p.id)) : [];
    }
    if (viewFilter === 'me') {
      return photos.filter(p => p._isPersonalMatch);
    }
    return photos;
  }, [photos, viewFilter, photoFavoritesSet]);
  const meCount = useMemo(() => photos.filter(p => p._isPersonalMatch).length, [photos]);
  const favCount = useMemo(() => (
    photoFavoritesSet ? photos.filter(p => photoFavoritesSet.has(p.id)).length : 0
  ), [photos, photoFavoritesSet]);

  const togglePhotoSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);
  // Sort la selection auto quand on quitte l onglet Photos -> retour propre.
  useEffect(() => { if (!isActive) exitSelection(); }, [isActive, exitSelection]);

  // Refresh forcee des favs depuis le serveur a chaque passage sur l onglet
  // photos. Couvre le cas : user fav une photo sur le site, ouvre l app, va
  // sur "Mes photos" -> ses nouveaux favs apparaissent sans cold start.
  useEffect(() => {
    if (isActive) onRefreshFavorites?.();
  }, [isActive, onRefreshFavorites]);

  // E4 — marqueur "derniere photo vue" par burstTs (max global tous events).
  // Sert au pull-to-refresh pour afficher "X nouvelles photos" / "Rien de
  // nouveau". Persiste dans AsyncStorage. Cote client uniquement pour V1.
  const lastSeenRef = useRef(0);
  const lastSeenLoadedRef = useRef(false);
  const baselineSetRef = useRef(false);
  // Toast cross-fade avec le titre "Mes photos" : pendant un refresh on
  // affiche fleur+"Recherche...", apres on affiche le message resultat,
  // toast disparait -> titre revient. Aucun shift de la grille (le toast
  // ne pousse rien).
  const [toastPhase, setToastPhase] = useState('idle'); // 'idle' | 'searching' | 'result'
  const [refreshToast, setRefreshToast] = useState(null);
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('@will_last_seen_burst_ts').then(v => {
      lastSeenRef.current = v ? parseInt(v, 10) : 0;
      lastSeenLoadedRef.current = true;
    }).catch(() => { lastSeenLoadedRef.current = true; });
    // Hydrate la galerie depuis le cache local pour affichage immediat au
    // cold start. Le refresh API tourne en parallele et remplace si besoin.
    AsyncStorage.getItem(photosCacheKey).then(s => {
      if (!s) { setLoading(true); return; }
      try {
        const cached = JSON.parse(s);
        if (Array.isArray(cached) && cached.length > 0) {
          setPhotos(cached);
          setLoading(false); // grille immediatement visible
        }
      } catch {}
    }).catch(() => {});
    // Hydrate knownEvents depuis le cache aussi pour que la 1ere passe de
    // refreshAll inclue deja tous les events (sinon 2 passes : 1 avec
    // follows seul, 1 quand knownEvents arrive du reseau).
    if (knownEventsCacheKey) {
      AsyncStorage.getItem(knownEventsCacheKey).then(s => {
        if (!s) return;
        try {
          const cached = JSON.parse(s);
          if (Array.isArray(cached)) setKnownEvents(cached);
        } catch {}
      }).catch(() => {});
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  // tint par event_code (couleur du type d event) pour ourler la thumb.
  const eventTintMap = useMemo(() => {
    const map = {};
    for (const e of events) map[e.code] = colorForType(e.event_type);
    return map;
  }, [events]);

  // Refresh /runner/known-events (events avec consent actif OU revoque)
  // pour avoir la liste complete des sources de photos, independante de
  // follows[] (UI favoris). Permet d afficher les photos matchees apres
  // un unfollow.
  const refreshKnownEvents = useCallback(async () => {
    if (!runnerApiFetch) return [];
    try {
      const r = await runnerApiFetch(`/runner/known-events`);
      if (!r.ok) return [];
      const data = await r.json();
      const list = Array.isArray(data?.events) ? data.events : [];
      setKnownEvents(list);
      if (knownEventsCacheKey) {
        AsyncStorage.setItem(knownEventsCacheKey, JSON.stringify(list)).catch(() => {});
      }
      return list;
    } catch { return []; }
  }, [runnerApiFetch, knownEventsCacheKey]);

  // Au mount + sur token change : fetch knownEvents 1x.
  useEffect(() => { refreshKnownEvents(); }, [refreshKnownEvents]);

  // Charge /personal-gallery sur tous les eventsToQuery (= follows U knownEvents)
  // en parallele, fusionne, trie. anySearching = au moins un event recemment
  // follow (< 90s) avec 0 photos -> polling.
  const refreshAll = useCallback(async () => {
    const queryList = eventsToQuery;
    if (queryList.length === 0 || !runnerApiFetch) {
      setPhotos([]);
      setAnySearching(false);
      setLoading(false);
      return [];
    }
    const started = {};
    for (const code of queryList) {
      const s = await AsyncStorage.getItem(`@will_follow_started_${code}`);
      started[code] = s ? parseInt(s, 10) : 0;
    }
    const results = await Promise.all(queryList.map(async (code) => {
      try {
        const r = await runnerApiFetch(`/personal-gallery/${encodeURIComponent(code)}`);
        if (!r.ok) return { code, photos: [], paid: false };
        const data = await r.json();
        return { code, photos: Array.isArray(data.photos) ? data.photos : [], paid: !!data.photos_for_sale };
      } catch { return { code, photos: [], paid: false }; }
    }));
    const now = Date.now();
    const merged = [];
    let searching = false;
    for (const { code, photos: list, paid } of results) {
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
          paid,
          eventCode: code,
          _isPersonalMatch: true,
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
    // Persiste pour hydratation au prochain cold start (V1 simple : tout le
    // tableau merge serialise en JSON, suffisant tant que < quelques centaines
    // de photos).
    AsyncStorage.setItem(photosCacheKey, JSON.stringify(merged)).catch(() => {});
    return merged;
  }, [eventsToQuery, runnerApiFetch, eventTintMap, photosCacheKey]);

  // Fetch les photos fav des events NON couverts par /personal-gallery
  // (favoris cross-event : photos d events non suivis ou non matchees par
  // la reco faciale). Permet a l onglet "Mes favoris" + "Tous" de les
  // afficher. /list-public est public (sans auth), guard de re-fetch via
  // Set des codes deja explores.
  const favExtraFetchedRef = useRef(new Set());
  useEffect(() => {
    if (!photoFavoritesSet || photoFavoritesSet.size === 0) return;
    const favEventCodes = new Set();
    photoFavoritesSet.forEach((key) => {
      const m = String(key || '').match(/^([^\/]+)\//);
      if (m) favEventCodes.add(m[1]);
    });
    const coveredCodes = new Set(eventsToQuery);
    const missing = [...favEventCodes].filter((c) => !coveredCodes.has(c) && !favExtraFetchedRef.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => favExtraFetchedRef.current.add(c));
    Promise.all(missing.map(async (code) => {
      try {
        const r = await fetch(`${API_URL}/list-public/${encodeURIComponent(code)}`);
        if (!r.ok) return { code, photos: [] };
        const d = await r.json();
        return { code, photos: Array.isArray(d.photos) ? d.photos : [] };
      } catch { return { code, photos: [] }; }
    })).then((results) => {
      setPhotos((current) => {
        const existingIds = new Set(current.map((p) => p.id));
        const extras = [];
        for (const { code, photos: list } of results) {
          const tint = eventTintMap[code] || TYPE_COLORS.autre;
          for (const p of list) {
            if (!photoFavoritesSet.has(p.key)) continue;
            if (existingIds.has(p.key)) continue;
            extras.push({
              uri: p.url || `${R2_PUBLIC}/${p.key}`,
              thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
              id: p.key,
              tint,
              paid: false,
              eventCode: code,
              _isPersonalMatch: false,
            });
          }
        }
        if (extras.length === 0) return current;
        const merged = [...current, ...extras];
        merged.sort((a, b) => {
          const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
          if (dt !== 0) return dt;
          return extractIdx(b.id) - extractIdx(a.id);
        });
        return merged;
      });
    });
  }, [photoFavoritesSet, eventsToQuery, eventTintMap]);

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

  // Initial fetch + re-fetch quand follows change. Pas de setLoading(true)
  // ici : si la cache locale a deja hydrate, la galerie reste visible
  // pendant le refresh background. Si pas de cache, useState(true) initial
  // garde le spinner jusqu a la fin du fetch.
  useEffect(() => { refreshAll(); }, [refreshAll]);

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
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setRefreshing(true);
    // Cross-fade : titre "Mes photos" sort, toast "Recherche…" entre.
    setToastPhase('searching');
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Refresh la liste known-events EN PREMIER (sinon refreshAll utiliserait
    // une liste stale -> rate les nouveaux events follow ou les events
    // recemment revoked).
    await refreshKnownEvents();
    const merged = await refreshAll();
    setRefreshing(false);

    // Phase resultat : on garde le toast a opacity 1, on change juste le
    // contenu (de "Recherche…" -> message). Pas de re-fade pour eviter le
    // clignotement.
    if (!lastSeenLoadedRef.current) {
      // Cross-fade retour : titre revient.
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => setToastPhase('idle'));
      return;
    }
    // E4 — calcul du delta vs marqueur lastSeenRef.
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
    setToastPhase('result');
    // Reste 2s puis cross-fade inverse : toast sort, titre revient.
    toastTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => {
        setToastPhase('idle');
        setRefreshToast(null);
      });
    }, 2000);
  }, [refreshAll, titleOpacity, toastOpacity]);

  const downloadSelected = useCallback(async () => {
    if (selectedIds.size === 0 || downloading) return;
    setDownloading(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert('Permission refusée', 'Autorise l\'accès aux photos pour sauvegarder dans la pellicule.');
        return;
      }
      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) {
        Alert.alert('Hors ligne', 'Pas de connexion internet — impossible de télécharger.');
        return;
      }
      let saved = 0, failed = 0;
      let i = 0;
      for (const id of selectedIds) {
        const photo = photos.find(p => p.id === id);
        if (!photo?.uri) { failed++; continue; }
        let staged = null;
        try {
          const ext = await detectPhotoExtension(photo.uri);
          const filename = `will_${Date.now()}_${i}.${ext}`;
          staged = new File(Paths.cache, filename);
          const downloaded = await File.downloadFileAsync(photo.uri, staged, { idempotent: true });
          const localUri = downloaded?.uri || staged.uri;
          await MediaLibrary.saveToLibraryAsync(localUri);
          saved++;
        } catch (e) {
          failed++;
          console.warn('[multi-download]', id, e?.message || e);
        } finally {
          try { if (staged?.exists) staged.delete(); } catch {}
          i++;
        }
      }
      const savedMsg = saved === 1 ? '1 photo' : `${saved} photos`;
      const failedSuffix = failed > 0 ? ` (${failed} échec${failed > 1 ? 's' : ''})` : '';
      Alert.alert(
        saved > 0 ? 'Enregistré' : 'Erreur',
        saved > 0
          ? `${savedMsg} dans ta pellicule${failedSuffix}.`
          : 'Aucune photo n a pu etre sauvegardee. Verifie ta connexion et reessaie.'
      );
      if (saved > 0) exitSelection();
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de télécharger les photos.');
    } finally {
      setDownloading(false);
    }
  }, [selectedIds, photos, downloading, exitSelection]);

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
            {selfieUri ? (
              <Image
                source={{ uri: selfieUri }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#c9beed' }}
              />
            ) : (
              <Icon.User size={30} color="#c9beed" />
            )}
            {selfieUri && (
              <TouchableOpacity
                onPress={(e) => {
                  if (selfieUploadState === 'failed') { e.stopPropagation?.(); onRetryUpload?.(); }
                }}
                disabled={selfieUploadState !== 'failed'}
                activeOpacity={selfieUploadState === 'failed' ? 0.6 : 1}
                hitSlop={8}
                style={{
                  position: 'absolute', top: 0, right: 0,
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: selfieDotColor(selfieUploadState),
                  borderWidth: 2, borderColor: C.bg,
                }}
              />
            )}
          </TouchableOpacity>
        </View>
        {/* SLOT CENTRE : cross-fade titre <-> toast refresh. */}
        <View style={{ flex: 1, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', opacity: titleOpacity }}>
            <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes photos</Text>
          </Animated.View>
          {toastPhase !== 'idle' && (
            <Animated.View style={{
              position: 'absolute',
              opacity: toastOpacity,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}>
              {toastPhase === 'searching' && <SpinningLoader size={14} color="#c9beed" />}
              <Text style={{ color: '#c9beed', fontSize: 14, fontWeight: '500' }}>
                {toastPhase === 'searching' ? 'Recherche…' : (refreshToast || '')}
              </Text>
            </Animated.View>
          )}
        </View>
        <View style={{ width: 40, height: 40 }} />
      </View>

      <View style={{ height: 14 }} />
      <ConsentRenewBanner runnerApiFetch={runnerApiFetch} isAuthed={!!runnerUserId} />

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
          {/* Segmented Moi / Mes favoris / Tous : style identique aux pills
              "A venir / Passes / Favoris" de l accueil (indicateur slide
              spring sur le tab actif + meme typo s.pillText). */}
          {!selectionMode && (
            <View
              onLayout={(e) => setViewTabsContainerW(e.nativeEvent.layout.width - 8)}
              style={{
                flexDirection: 'row',
                backgroundColor: C.pillBg,
                borderRadius: 16,
                padding: 4,
                alignItems: 'center',
                position: 'relative',
                marginBottom: 10,
              }}
            >
              {viewSlotW > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 4, top: 4, bottom: 4,
                    width: viewSlotW,
                    backgroundColor: C.primary,
                    borderRadius: 12,
                    transform: [{ translateX: viewTabsSlideX }],
                  }}
                />
              )}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('me'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'me' && s.pillTextActive]} numberOfLines={1}>Moi ({meCount})</Text>
              </TouchableOpacity>
              {viewFilter === 'all' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('favs'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'favs' && s.pillTextActive]} numberOfLines={1}>Mes favoris ({favCount})</Text>
              </TouchableOpacity>
              {viewFilter === 'me' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('all'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'all' && s.pillTextActive]} numberOfLines={1}>Tous ({photos.length})</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Barre selection en flow normal (occupe une vraie hauteur)
              pour eviter le conflit visuel avec la SelfieBlock placee juste
              au-dessus quand le selfie est absent. */}
          {photos.length > 1 && (
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              paddingHorizontal: 2, paddingTop: 4, marginBottom: 8,
            }}>
              {selectionMode ? (
                <>
                  <TouchableOpacity onPress={exitSelection} hitSlop={10} disabled={downloading}>
                    <Text style={{ color: C.textSoft, fontSize: 13, fontWeight: '500' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={downloadSelected}
                    hitSlop={10}
                    disabled={selectedIds.size === 0 || downloading}
                    style={{ opacity: (selectedIds.size === 0 || downloading) ? 0.35 : 1 }}
                  >
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '700' }}>
                      {downloading
                        ? 'Téléchargement…'
                        : `Télécharger${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
                    <Text style={{ color: '#c9beed', fontSize: 13, fontWeight: '500' }}>Sélectionner</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
          {visiblePhotos.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
                {viewFilter === 'favs'
                  ? 'Aucune photo en favoris pour le moment.'
                  : viewFilter === 'me'
                    ? 'Aucune photo de toi pour le moment.'
                    : 'Aucune photo.'}
              </Text>
            </View>
          ) : (
            <PhotoGrid
              photos={visiblePhotos.slice(0, visibleCount)}
              numColumns={Math.max(1, Math.min(visiblePhotos.length, 4))}
              onPress={(p, _i, _photos, origin) => onOpenPhoto?.(p, visiblePhotos, {
                origin,
                photosForSale: !!p?.paid,
                eventCode: p?.eventCode || null,
              })}
              photoFavoritesSet={photoFavoritesSet}
              onToggleFavorite={onTogglePhotoFavorite}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onTogglePhotoSelect={togglePhotoSelect}
            />
          )}
        </>
      )}
    </RefreshableScrollView>
  );
}

// État vide pédagogique : 3 étapes + CTA "Trouver un event".


// Icone "favori photo" = etoile (Favoris_3.svg). Distingue les favoris de
// PHOTOS (etoile) des favoris d EVENTS (coeur) pour eviter la confusion
// visuelle entre les deux types de favoris.


// Roulette horizontale infinie (style picker iOS). Le filtre actif est
// au centre, derriere un cadre accent. Items dupliques N fois pour
// simuler l infini : on demarre au milieu de la copie centrale. La
// couleur du texte est interpolee EN LIVE sur le UI thread via

function EventDetailScreen(props) {
  return (
    <GridErrorBoundary>
      <EventDetailScreenInner {...props} />
    </GridErrorBoundary>
  );
}

function EventDetailScreenInner({ event, onClose, onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, onOpenPhoto, isFollowing, onToggleFollow, runnerFirstName, bibQuery = '', bibResults = null, bibSearching = false, photoFavoritesSet = null, isAuthed = false, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, onPhotosCountChange, onScrolledChange }) {
  const isFav = (id) => isAuthed && !!photoFavoritesSet?.has(id);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Pagination cote client : on n'affiche que les N premieres photos pour
  // limiter le DOM rendu (au-dela de la virtualisation FlatList).
  // onEndReached -> +30 jusqu'a couvrir filteredPhotos.length.
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Hierarchie 2 niveaux (mirror dashboard EventPage.js V2 2026-05-28) :
  // niveau 1 race (course), niveau 2 km (position photographe) au sein d une
  // course. activeKmFilter pertinent uniquement si activeRaceFilter !== "all".
  const [activeRaceFilter, setActiveRaceFilter] = useState('all');
  const [activeKmFilter, setActiveKmFilter] = useState('all');
  // Tri photos : true = recentes en haut (default, burstTs DESC), false = plus
  // anciennes en haut. Bouton sur la droite des pills permet de basculer.
  const [sortDesc, setSortDesc] = useState(true);
  // Filtre favoris : true = affiche uniquement les photos likees. Toggle pill
  // coeur a cote du bouton tri. Reserve aux users logges (isAuthed).
  const [favOnly, setFavOnly] = useState(false);
  // Recherche par dossard : bibQuery/bibResults/bibSearching arrivent en
  // props depuis App.js (state lifte pour rendre la pill au root, au-dessus
  // du degrade blanc du footer). Cf. fetch debounced + listener clavier
  // dans App.js (autour de la decl eventInPanel).
  // Bottom sheet "+ d'infos" sur le header de l event (courses, horaires,
  // bouton site organisateur).
  // infoSheetOpen pilote l affichage inline de la section "Infos pratiques"
  // sous le hero (anciennement un bottom-sheet modal). Toggle au tap du CTA
  // dans le hero. useDismissibleSheet retire en meme temps que le Modal.
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  // Animated sliding pill iOS-style. Layout de chaque tab mesure via
  // onLayout. La pill slide vers la position du tab actif.
  const raceTabLayoutsRef = useRef({});
  const kmTabLayoutsRef = useRef({});
  const raceIndicatorX = useRef(new Animated.Value(0)).current;
  const raceIndicatorW = useRef(new Animated.Value(0)).current;
  const kmIndicatorX = useRef(new Animated.Value(0)).current;
  const kmIndicatorW = useRef(new Animated.Value(0)).current;
  // Refs : true quand la pill a deja ete positionnee au moins une fois sur
  // le tab actif (premier mount). Permet a onLayout de snap-set la pill
  // INSTANTANEMENT si pas encore initialisee.
  const raceIndicatorInitRef = useRef(false);
  const kmIndicatorInitRef = useRef(false);
  // Fade + slide-in pour la row Posté quand elle apparait.
  const kmRowAnim = useRef(new Animated.Value(0)).current;
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
          // thumbMdUri : version 800px (~50-90 KB) servie par /photo-thumb-md
          // pour la GRANDE tuile 2x2 de la mosaique (~666px physiques) — le
          // thumb 400px y etait upscale 1.67x → flou. Fallback thumb_url si
          // worker pas encore deploye, puis url HD.
          thumbMdUri: p.thumb_md_url || p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
          race: p.race,
          race_distance_id: p.race_distance_id || null,
          km: p.km,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
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

  // Reset la pagination quand un filtre change.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeRaceFilter, activeKmFilter]);

  // Reset le filtre km quand la course change (revient a "Tous" naturellement)
  // + reset la flag d init de la pill km (les anciens layouts km appartiennent
  // a une autre course, le snap-set devra refire au prochain layout).
  useEffect(() => {
    setActiveKmFilter('all');
    kmIndicatorInitRef.current = false;
    kmTabLayoutsRef.current = {};
  }, [activeRaceFilter]);

  // Cle canonique de course pour une photo : race_distance_id (resolu worker,
  // distingue deux courses de meme km, post-fix 2026-06-10) sinon p.race brut
  // pour les events pas encore backfilles.
  const photoRaceKey = (p) => (p && p.race_distance_id) ? String(p.race_distance_id) : (p && p.race ? String(p.race) : null);

  // Niveau 1 — courses uniques presentes dans les photos. Trie numerique asc
  // sur le km associe (pour conserver l ordre intuitif quand on a des IDs).
  const uniqueRaces = (() => {
    const keys = Array.from(new Set(photos.map(photoRaceKey).filter(Boolean)));
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    const kmOf = (k) => {
      const d = evDistances.find(x => x && (x.id === k || String(x.km) === String(k)));
      return d ? Number(d.km) : Number(k);
    };
    return keys.sort((a, b) => kmOf(a) - kmOf(b));
  })();

  // Map race_key -> { label, label_only } injecte par worker (race_label +
  // race_label_only sur la photo) ou fallback event.distances local.
  // raceTabLabel respecte label_only (mode nom personnalise = label seul).
  const raceLabelById = useMemo(() => {
    const m = {};
    for (const p of photos) {
      const key = photoRaceKey(p);
      if (key && p.race_label && !m[key]) {
        m[key] = { label: p.race_label, label_only: p.race_label_only === true };
      }
    }
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    for (const d of evDistances) {
      if (!d) continue;
      const entry = { label: d.label, label_only: d.label_only === true };
      if (d.id && !m[d.id] && d.label) m[d.id] = entry;
      const k = String(d.km);
      if (!m[k] && d.label) m[k] = entry;
    }
    return m;
  }, [photos, event.distances]);
  const raceTabLabel = (raceKey) => {
    const entry = raceLabelById[raceKey];
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    const d = evDistances.find(x => x && (x.id === raceKey || String(x.km) === String(raceKey)));
    const km = d ? d.km : raceKey;
    if (entry) return raceTitle({ label: entry.label, label_only: entry.label_only, km });
    return `${km} km`;
  };

  // Niveau 2 — positions km presentes pour la course active. Exclut les
  // photos sans km (cran "-" cote photographe) -> elles ne creent pas
  // d onglet, on les retrouve uniquement dans le sous-onglet "Tous".
  const kmsForActiveRace = (() => {
    if (activeRaceFilter === 'all') return [];
    const kms = photos
      .filter(p => photoRaceKey(p) === activeRaceFilter)
      .map(p => p.km)
      .filter(k => k !== null && k !== undefined && k !== '');
    // Tri : Depart (0) puis Arrivee ('arrivee') puis km N croissant. 'arrivee'
    // place a 0.5 = entre Depart (0) et km 1, miroir de la roulette de capture.
    return Array.from(new Set(kms.map(String))).sort((a, b) => {
      const na = a === 'arrivee' ? 0.5 : Number(a);
      const nb = b === 'arrivee' ? 0.5 : Number(b);
      return na - nb;
    });
  })();


  // Slide animation de l indicator race vers le tab actif.
  useEffect(() => {
    const l = raceTabLayoutsRef.current[activeRaceFilter];
    if (!l) return;
    Animated.parallel([
      Animated.spring(raceIndicatorX, { toValue: l.x, useNativeDriver: false, friction: 10, tension: 80 }),
      Animated.spring(raceIndicatorW, { toValue: l.width, useNativeDriver: false, friction: 10, tension: 80 }),
    ]).start();
  }, [activeRaceFilter]);

  // Slide animation de l indicator km + fade-in de la row.
  useEffect(() => {
    const visible = activeRaceFilter !== 'all' && kmsForActiveRace.length > 1;
    Animated.spring(kmRowAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      friction: 11, tension: 80,
    }).start();
    if (!visible) return;
    const l = kmTabLayoutsRef.current[activeKmFilter];
    if (!l) return;
    Animated.parallel([
      Animated.spring(kmIndicatorX, { toValue: l.x, useNativeDriver: false, friction: 10, tension: 80 }),
      Animated.spring(kmIndicatorW, { toValue: l.width, useNativeDriver: false, friction: 10, tension: 80 }),
    ]).start();
  }, [activeKmFilter, activeRaceFilter, kmsForActiveRace.length]);


  // Tabs course (Toutes + 1 par race). Vide si aucune photo n a de race.
  const raceTabs = uniqueRaces.length === 0
    ? []
    : [
        { key: 'all', label: 'Toutes' },
        ...uniqueRaces.map(km => ({ key: String(km), label: raceTabLabel(String(km)) })),
      ];

  // Tabs km (apparaissent uniquement si course specifique selectionnee ET
  // > 1 position km distincte pour cette course — sinon pas de choix utile).
  // Labels speciaux : "Départ" (k='0'), "Arrivée" (k='arrivee'). Le reste = "km N".
  const kmTabs = (activeRaceFilter === 'all' || kmsForActiveRace.length <= 1)
    ? []
    : [
        { key: 'all', label: 'Tous' },
        ...kmsForActiveRace.map(k => ({
          key: k,
          label: k === '0' ? 'Départ' : k === 'arrivee' ? 'Arrivée' : `km ${k}`,
        })),
      ];

  const filteredPhotos = (() => {
    let list;
    if (activeRaceFilter === 'all') {
      list = photos;
    } else {
      list = photos.filter(p => photoRaceKey(p) === activeRaceFilter);
      if (activeKmFilter !== 'all') {
        list = list.filter(p => String(p.km) === activeKmFilter);
      }
    }
    if (favOnly && isAuthed && photoFavoritesSet) {
      list = list.filter(p => photoFavoritesSet.has(p.id));
    }
    // photos est deja trie burstTs DESC dans loadPhotos. sortDesc=false ->
    // on inverse pour avoir les plus anciennes en premier.
    return sortDesc ? list : [...list].reverse();
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
  // 0 : la grille s'aligne sur les memes edges gauche/droite que les autres
  // blocs du header (hero card, CTA, filtres) — tous calés sur les 20 px de
  // s.scroll. Avant : 8 px en plus → grille 28 px du bord, desalignement.
  const GRID_PADDING_H = 0;
  const GRID_GAP = 6;
  const SCROLL_PADDING_H = 20; // doit matcher s.scroll.paddingHorizontal
  const cellSize = (SCREEN_W - SCROLL_PADDING_H * 2 - GRID_PADDING_H * 2 - GRID_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  // Header de la FlatList : tout ce qui s'affiche au-dessus de la grille.
  // Renvoie une seule View ; FlatList le rend une fois en haut, sans virtualisation.
  const renderHeader = () => (
    // gap: 8 px uniforme entre chaque bloc (header row → hero card → CTA
    // favoris → "à venir" / filtres). paddingBottom: 8 px termine le rythme
    // avant la grille. Chaque enfant ne doit PAS porter de marginTop/Bottom.
    <View style={{ gap: 8, paddingBottom: 8 }}>
      <View style={[s.headerRow, { paddingBottom: 0 }]}>
        <View style={[s.headerLeft, { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }]}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            {selfieUri ? (
              <Image
                source={{ uri: selfieUri }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#c9beed' }}
              />
            ) : (
              <Icon.User size={30} color="#c9beed" />
            )}
            {selfieUri && (
              <TouchableOpacity
                onPress={(e) => {
                  if (selfieUploadState === 'failed') { e.stopPropagation?.(); onRetryUpload?.(); }
                }}
                disabled={selfieUploadState !== 'failed'}
                activeOpacity={selfieUploadState === 'failed' ? 0.6 : 1}
                hitSlop={8}
                style={{
                  position: 'absolute', top: -2, right: -2, width: 10, height: 10,
                  borderRadius: 5, backgroundColor: selfieDotColor(selfieUploadState),
                  borderWidth: 2, borderColor: C.bg,
                }}
              />
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
        {/* Pill "Infos pratiques" deplace dans le hero (sous le lieu, avec
            divider). HeaderRow ne garde que le profil + Hello sur la gauche. */}
      </View>

      {/* CTA Favoris en ONGLET : place au-dessus du hero, se glisse PAR DESSOUS
          le hero via marginBottom negative (annule le gap 8 px + cree 16 px
          d overlap). Coins bas carres pour effet onglet (bottom hidden sous
          hero). marginTop: 8 → espace le CTA du header (gap 8 + 8 = 16 px).
          Visible uniquement si NON SUIVI. */}
      {onToggleFollow && !isFollowing && (
        <View style={{ marginTop: 8, marginBottom: -24, position: 'relative' }}>
          <TouchableOpacity onPress={onToggleFollow} activeOpacity={0.88}>
            <LinearGradient
              colors={['#7B2FFF', '#5E1AD6']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{
                borderTopLeftRadius: 16, borderTopRightRadius: 16,
                paddingTop: 14, paddingBottom: 14 + 16, paddingHorizontal: 18,
                shadowColor: '#7B2FFF', shadowOpacity: 0.3,
                shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
              }}
            >
              {/* Titre 2 lignes : ligne 1 bold (action) + ligne 2 regular
                  (consequence). Aligne sur le web (.fav-title-reg). */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <Svg width={18} height={16} viewBox="-1 -1.5 22.78 20.61" fill="#fff">
                  <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
                </Svg>
                <Text
                  numberOfLines={2}
                  ellipsizeMode="tail"
                  style={{ color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Montserrat', flexShrink: 1 }}
                >
                  Mets en favoris pour suivre cet event,{'\n'}
                  <Text style={{ fontWeight: '400' }}>tes photos arrivent dès leur publication</Text>
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
          {/* Ombre INTERNE au bas du CTA en VRAI gradient (LinearGradient
              expo, fade smooth sans steps visibles). Couvre y=44 a y=80
              (= bord visible CTA jusqu'a sous le hero). Pas de zIndex :
              RN iOS fait fuiter zIndex, l ordre DOM suffit. Le hero
              (sibling DOM-after du wrapper) couvre le gradient dans la
              zone d overlap SAUF aux coins arrondis ou les slivers liberes
              par le radius rendent l ombre visible. rgba explicit (pas
              'transparent' qui peut mal parser) pour fiabilite cross-platform. */}
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0, right: 0,
              bottom: 0, height: 36,
            }}
          />
        </View>
      )}

      <View style={{ position: 'relative', zIndex: 1 }}>
        {/* zIndex: 1 → le hero reste au-dessus de SES voisins overlappants :
            le CTA favoris (DOM-avant, marginBottom:-24) ET la section infos
            pratiques (DOM-apres, marginTop:-24). Sans zIndex, infos serait
            rendu APRES hero donc DEVANT — pas le comportement onglet voulu.
            Override le marginBottom: 10 hérité de s.eventCard — l'espacement
            avec le bloc suivant est géré par le gap du parent renderHeader. */}
        <View style={[s.eventCard, { marginBottom: 0, height: undefined }]}>
          {/* Layer 0 : aplat coloré pleine carte (fallback + fond sous image) */}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
          {/* Layer 1 : cover image sur la MOITIE DROITE seulement (left:50%
              -> right:0). La gauche garde l aplat tint pour lisibilite du
              texte. */}
          {event.cover_image ? (
            <ExpoImage
              source={{ uri: event.cover_image }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', right: 0 }}
              contentFit="cover"
            />
          ) : null}
          {/* Layer 2 : gradient sur la moitie droite (image), tint 100%
              au seam (x=0.5) -> tint 10% au bord droit (x=1.0).
              L image fade donc progressivement de invisible (gauche) a
              90% visible (droite). */}
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
          {/* Stack vertical : Date > Nom (header) > Lieu + type > Divider >
              Infos pratiques (CTA inline). paddingRight réserve l'espace du
              décompte bottom-right. paddingVertical: 16 donne la respiration
              du hero a hauteur dynamique (pas de height fixe sur eventCard). */}
          <View style={[s.eventCardCenter, { paddingRight: 84, paddingVertical: 16 }]}>
            <Text style={s.eventDate} numberOfLines={1}>
              {formatDateLong(event.event_date, event.event_date_end)}
            </Text>
            <Text style={[s.eventName, { fontSize: 22, lineHeight: 27 }]} numberOfLines={2} ellipsizeMode="tail">{event.name}</Text>
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
            {/* Divider blanc semi-transparent + ligne "Infos pratiques"
                tappable (ouvre le bottom sheet info). Reste dans le content
                column (respecte paddingRight: 84 → ne deborde pas sous le
                countdown). */}
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, marginBottom: 12 }} />
            <TouchableOpacity
              onPress={() => setInfoSheetOpen(v => !v)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              {/* Chevron : down quand ferme (= "deplier en bas"), up quand
                  ouvert (= "replier"). Convention accordion. La section
                  d infos pratiques s affiche maintenant inline sous le hero
                  (plus dans un modal). */}
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d={infoSheetOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                  stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                />
              </Svg>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Montserrat' }}>Infos pratiques</Text>
            </TouchableOpacity>
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

      {/* Section "Infos pratiques" en ONGLET sous le hero (symetrique au CTA
          favoris au-dessus) : marginTop: -24 (= -8 gap cancel + -16 overlap),
          coins haut carres (caches sous hero), coins bas arrondis 16
          (visibles), paddingTop: 32 (= 16 normal + 16 compensation overlap),
          LinearGradient interne en haut pour ombre du hero projetee sur la
          surface. Visible quand chevron ouvert. */}
      {infoSheetOpen && (
        <View style={{ marginTop: -24, position: 'relative' }}>
          <View style={{
            backgroundColor: `${tint}1A`,
            borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
            paddingTop: 16 + 16, paddingBottom: 16, paddingHorizontal: 16,
          }}>
            {distances.length > 0 && (
              <View>
                {/* Layout empile : label en titre de ligne (fallback `${km} km`),
                    puis km / heure / denivele en dessous. Plus lisible que 3
                    colonnes serrees, surtout quand le label est custom. */}
                {distances.map((d, i) => (
                  <View key={i} style={{
                    paddingVertical: 12,
                    borderBottomWidth: i === distances.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: `${tint}40`,
                  }}>
                    <View style={{ marginBottom: 4 }}>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: tint, fontSize: 15, fontWeight: '700' }}>
                        {raceTitle(d)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                        Départ {d.time || '—'}
                      </Text>
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                        Dénivelé {d.elevation || '—'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Lien discret "Site organisateur" : juste texte + fleche, en
                couleur tint. Plus de bouton solide violet plein largeur. */}
            {event.website ? (
              <TouchableOpacity
                onPress={openWebsite}
                activeOpacity={0.6}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  marginTop: distances.length > 0 ? 14 : 4,
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: tint, fontSize: 13, fontWeight: '600', fontFamily: 'Montserrat' }}>
                  Site organisateur
                </Text>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12h14M13 6l6 6-6 6" stroke={tint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>
            ) : null}
          </View>
          {/* Ombre INTERNE au top de la section infos — teintee de la couleur
              du type de course (tint), opacite legere 25 % → 0. Plus discret
              que le black 0.6 precedent, integre la palette de l event. Les
              16 premiers px sont caches sous le hero, les 20 suivants creent
              un fade visible sur le haut de l infos section. */}
          <LinearGradient
            colors={[`${tint}40`, `${tint}00`]}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: 0, height: 36,
            }}
          />
        </View>
      )}

      {/* CTA Site web retire : redondant avec le bouton "Site organisateur"
          dans le bottom sheet "+ d'infos" du header. */}

      {/* Card unique "a venir" : header (photo jour J) + tableau distances
          si dispo. Une seule unite visuelle pour la hierarchie d ecran. */}
      {upcoming && photos.length === 0 && !loading ? (
        <View style={{
          paddingVertical: 16, paddingHorizontal: 16,
          backgroundColor: `${tint}1A`, borderRadius: 16,
        }}>
          {/* Header centre : icone + titre + sous-titre alignes au centre */}
          <View style={{ alignItems: 'center' }}>
            <Icon.PhotoCam size={28} color={tint} />
            <Text style={{ color: tint, fontSize: 14, fontWeight: '700', marginTop: 8, textAlign: 'center' }}>
              Photos disponibles le jour J
            </Text>
            <Text style={{ color: tint, fontSize: 11, marginTop: 2, opacity: 0.75, textAlign: 'center' }}>
              Reviens le jour de l'événement pour les voir
            </Text>
          </View>

          {/* Divider blanc full-width (edge-to-edge) entre le header photos
              et la section distances. marginHorizontal -16 pour casser le
              paddingHorizontal 16 de la card et atteindre les bords. */}
          {distances.length > 0 && (
            <View style={{
              height: 1,
              backgroundColor: '#fff',
              marginTop: 14,
              marginHorizontal: -16,
            }} />
          )}

          {/* Distances integrees, layout empile (label en titre, km/heure/denivele en dessous). */}
          {distances.length > 0 && (
            <View style={{ marginTop: 14 }}>
              {distances.map((d, i) => (
                <View key={i} style={{
                  paddingVertical: 12,
                  borderBottomWidth: i === distances.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  borderBottomColor: `${tint}40`,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 }}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: tint, fontSize: 15, fontWeight: '700', flex: 1 }}>
                      {d.label || `${d.km} km`}
                    </Text>
                    {d.label ? (
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.7, marginLeft: 8 }}>{d.km} km</Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                      Départ {d.time || '—'}
                    </Text>
                    <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                      Dénivelé {d.elevation || '—'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          {/* Onglets : race (N1) + km (N2 conditionnel) sur UNE meme ligne
              scrollable horizontalement. Le N1 est suivi (a droite) d un
              separateur fin puis du N2 si pertinent. Ensemble pill discrete
              (pill 12px, height contenue, fond pale) pour ne pas dominer
              la hero card + lien follow + CTA site qui sont au-dessus. */}
          {uniqueRaces.length > 1 && photos.length > 0 && (() => {
            // iOS UISegmentedControl-style : pill animee qui glisse derriere
            // l onglet actif. onLayout mesure chaque tab ; la pill (Animated
            // .View absolute z-0) slide entre les tabs. Au PREMIER layout
            // de l onglet actif, on snap-set la pill sans animation pour
            // qu elle apparaisse direct (fix bug "pill absent au mount").
            const Tab = ({ tabKey, label, active, onPress, layoutsRef, indicatorX, indicatorW, initRef, small = false }) => (
              <TouchableOpacity
                onPress={onPress}
                onLayout={(e) => {
                  const layout = e.nativeEvent.layout;
                  layoutsRef.current[tabKey] = layout;
                  if (active && !initRef.current) {
                    initRef.current = true;
                    indicatorX.setValue(layout.x);
                    indicatorW.setValue(layout.width);
                  }
                }}
                activeOpacity={0.7}
                style={{
                  flex: 1,
                  // minWidth garantit un seuil de lisibilite ; quand le total
                  // des tabs depasse la largeur du conteneur, la ScrollView
                  // parent prend le relais et scroll horizontalement.
                  minWidth: small ? 56 : 64,
                  paddingHorizontal: small ? 12 : 14,
                  paddingVertical: small ? 6 : 7,
                  alignItems: 'center',
                  zIndex: 1,
                }}
              >
                <Text style={{
                  fontSize: small ? 12.5 : 13.5,
                  fontWeight: active ? '700' : '500',
                  // Actif : blanc sur la pill. Inactif : couleur d accent
                  // selon la row -> violet (race, principal) ou rose (km, sub).
                  color: active ? '#fff' : (small ? C.pinkPill : C.primary),
                  fontFamily: 'Montserrat',
                  textAlign: 'center',
                }}>{label}</Text>
              </TouchableOpacity>
            );
            return (
              <View>
                {/* Row 1 : DROPDOWN course. Bouton compact (titre = course
                    active), tap ouvre un Modal avec la liste des courses.
                    Plus simple a parcourir que la roulette infinie quand il
                    y a 5+ courses. */}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <RaceDropdown
                    items={[{ key: 'all', label: 'Toutes les photos' }, ...uniqueRaces.map(r => ({ key: String(r), label: raceTabLabel(String(r)) }))]}
                    activeKey={activeRaceFilter}
                    onChange={(key) => {
                      LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
                      setActiveRaceFilter(key);
                      if (key === 'all') setActiveKmFilter('all');
                    }}
                    accent={C.primary}
                    bg="#f5f3ff"
                  />
                  {activeRaceFilter !== 'all' && kmsForActiveRace.length > 1 && (
                    <RaceDropdown
                      items={[{ key: 'all', label: 'km' }, ...kmsForActiveRace.map(k => ({
                        key: k,
                        label: k === '0' ? 'Départ' : k === 'arrivee' ? 'Arrivée' : `km ${k}`,
                      }))]}
                      activeKey={activeKmFilter}
                      onChange={setActiveKmFilter}
                      accent={C.primary}
                      bg="#f5f3ff"
                      compact
                    />
                  )}
                {/* Bouton inverser l ordre du tri (recente / ancien).
                    Meme bg que la race row pour cohesion visuelle. */}
                <TouchableOpacity
                  onPress={() => {
                    try { Haptics?.selectionAsync?.(); } catch {}
                    setSortDesc(v => !v);
                  }}
                  hitSlop={10}
                  activeOpacity={0.7}
                  accessibilityLabel={sortDesc ? 'Trier du plus ancien au plus recent' : 'Trier du plus recent au plus ancien'}
                  style={{
                    width: 30, height: 30, borderRadius: 15,
                    backgroundColor: '#f5f3ff',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    {/* Fleche gauche : oriente bas par defaut (sortDesc) ;
                        cote droit : oriente haut. Sortie : alternance qui
                        signifie "inverser le sens". */}
                    <Path d="M7 4v16M3 16l4 4 4-4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M17 20V4M13 8l4-4 4 4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>
                {isAuthed && (
                  <TouchableOpacity
                    onPress={() => {
                      try { Haptics?.selectionAsync?.(); } catch {}
                      setFavOnly(v => !v);
                    }}
                    hitSlop={10}
                    activeOpacity={0.7}
                    accessibilityLabel={favOnly ? 'Afficher toutes les photos' : 'Afficher uniquement les favoris'}
                    style={{
                      width: 30, height: 30, borderRadius: 15,
                      backgroundColor: favOnly ? C.primary : '#f5f3ff',
                      alignItems: 'center', justifyContent: 'center',
                      marginLeft: 6,
                    }}
                  >
                    <FavStar
                      size={14}
                      fill={favOnly ? '#fff' : C.primary}
                      stroke={favOnly ? '#fff' : C.primary}
                      strokeWidth={1.8}
                    />
                  </TouchableOpacity>
                )}
                </View>
              </View>
            );
          })()}

          {/* Espacement avant la grille gere par paddingBottom: 16 du
              parent renderHeader (rythme uniforme avec les autres blocs). */}
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
      favIndicator={isFav(item.id)}
      onPress={(origin) => onOpenPhoto?.(item, filteredPhotos, {
        origin,
        eventTitle: event?.name,
        eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
        photosForSale: !!event?.photos_for_sale,
        eventCode: event?.code,
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

  // Grid 3-col carre avec 1 big (2x2) tous les 12 photos = 3 rangs de
  // small entre chaque big. Chunks de 12 photos, chaque chunk rend :
  //   row 1+2 : [BIG 2x2][s][s]   (1 big + 2 small empilees)
  //   row 3   : [s][s][s]
  //   row 4   : [s][s][s]
  //   row 5   : [s][s][s]
  // Position du big alterne entre gauche (chunks pairs) et droite (impairs).
  const bigSize = 2 * cellSize + GRID_GAP;
  const photoChunks = (() => {
    const chunks = [];
    for (let i = 0; i < visiblePhotos.length; i += 12) {
      chunks.push(visiblePhotos.slice(i, i + 12));
    }
    return chunks;
  })();

  const renderPhotoSized = (photo, width, height, key) => {
    if (!photo) return <View key={key} style={{ width, height }} />;
    // Grande tuile 2x2 (~666px physiques @3x) → source 800px (thumbMdUri)
    // pour eviter le flou d upscale. Petites vignettes 3-col → thumbUri 400px.
    const sourceUri = key === 'big'
      ? (photo.thumbMdUri || photo.thumbUri || photo.uri)
      : (photo.thumbUri || photo.uri);
    return (
      <View key={key} style={{ width, height }}>
        <PhotoCell
          photo={{ ...photo, uri: sourceUri }}
          size={{ width, height }}
          favIndicator={isFav(photo.id)}
          onPress={(origin) => onOpenPhoto?.(photo, filteredPhotos, {
            origin,
            eventTitle: event?.name,
            eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
            photosForSale: !!event?.photos_for_sale,
            eventCode: event?.code,
          })}
        />
      </View>
    );
  };

  // Resultats de la recherche par dossard. Grille 3-col simple (pas
  // de bento) car ces resultats sont deja filtres et tries par confidence.
  // Le list arg passe a onOpenPhoto est bibResults (et non filteredPhotos),
  // pour que le swipe horizontal dans le PhotoViewerModal reste sur les
  // resultats de la recherche.
  const renderBibPhotoSized = (photo, width, height, key) => {
    if (!photo) return null;
    return (
      <View key={key} style={{ width, height }}>
        <PhotoCell
          photo={{ ...photo, uri: photo.thumbUri || photo.uri }}
          size={{ width, height }}
          favIndicator={isFav(photo.id)}
          onPress={(origin) => onOpenPhoto?.(photo, bibResults, {
            origin,
            eventTitle: event?.name,
            eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
            photosForSale: !!event?.photos_for_sale,
            eventCode: event?.code,
          })}
        />
      </View>
    );
  };
  const renderBibResults = () => {
    if (bibSearching) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      );
    }
    if (!bibResults || bibResults.length === 0) {
      return (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
            Aucune photo trouvée pour le dossard {bibQuery.trim()}
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', lineHeight: 17 }}>
            Scrolle la galerie pour chercher manuellement.
          </Text>
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: GRID_PADDING_H }}>
        <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 8, marginBottom: 10 }}>
          {bibResults.length} photo{bibResults.length > 1 ? 's' : ''} trouvée{bibResults.length > 1 ? 's' : ''} pour le dossard {bibQuery.trim()}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {bibResults.map((p, i) => renderBibPhotoSized(p, cellSize, cellSize, `bib-${i}`))}
        </View>
      </View>
    );
  };

  const renderChunks = () => {
    if (showEmptyMessage || photoChunks.length === 0) return null;
    return (
      <View style={{ paddingHorizontal: GRID_PADDING_H }}>
        {photoChunks.map((chunk, idx) => {
          // Position du big : alterne gauche (idx pair) / droite (idx impair).
          const bigLeft = idx % 2 === 0;
          return (
            <View key={idx} style={{ marginBottom: GRID_GAP }}>
              {/* Ligne du big : 2x2 + colonne de 2 small */}
              <View style={{ flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP }}>
                {bigLeft ? (
                  <>
                    {renderPhotoSized(chunk[0], bigSize, bigSize, 'big')}
                    <View style={{ gap: GRID_GAP, justifyContent: 'space-between' }}>
                      {renderPhotoSized(chunk[1], cellSize, cellSize, 's1')}
                      {renderPhotoSized(chunk[2], cellSize, cellSize, 's2')}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ gap: GRID_GAP, justifyContent: 'space-between' }}>
                      {renderPhotoSized(chunk[1], cellSize, cellSize, 's1')}
                      {renderPhotoSized(chunk[2], cellSize, cellSize, 's2')}
                    </View>
                    {renderPhotoSized(chunk[0], bigSize, bigSize, 'big')}
                  </>
                )}
              </View>
              {/* 3 rangs de 3 small (chacun masque si la rangee est vide en
                  fin de liste pour eviter des spacers fantomes). */}
              {[
                [chunk[3], chunk[4], chunk[5]],
                [chunk[6], chunk[7], chunk[8]],
                [chunk[9], chunk[10], chunk[11]],
              ].map((row, ri) => (
                (row[0] || row[1] || row[2]) ? (
                  <View
                    key={`row${ri}`}
                    style={{
                      flexDirection: 'row',
                      gap: GRID_GAP,
                      marginBottom: ri < 2 ? GRID_GAP : 0,
                    }}
                  >
                    {renderPhotoSized(row[0], cellSize, cellSize, `r${ri}-0`)}
                    {renderPhotoSized(row[1], cellSize, cellSize, `r${ri}-1`)}
                    {renderPhotoSized(row[2], cellSize, cellSize, `r${ri}-2`)}
                  </View>
                ) : null
              ))}
            </View>
          );
        })}
      </View>
    );
  };

  // Ref scroll pour back-to-top trigger depuis App.js (bib pill arrow).
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [scrollToTopSignal]);
  // Remonte le count photos au parent pour conditionner l affichage de la
  // pill bib (cachee sur les events sans photos).
  useEffect(() => {
    if (onPhotosCountChange) onPhotosCountChange(photos.length, loading);
  }, [photos.length, loading, onPhotosCountChange]);
  // Reset onScrolledChange a false quand le ScrollView retombe au top
  // (apres scroll-to-top). Tracked via hasScrolledRef pour eviter les emits
  // redondants sur chaque tick onScroll. Threshold 50px (souple).
  const hasScrolledRef = useRef(false);

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 180 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          // Detect crossing du seuil 50px -> emit toggle au parent pour
          // afficher/cacher la fleche back-to-top dans la pill bib.
          const scrolled = contentOffset.y > 50;
          if (scrolled !== hasScrolledRef.current) {
            hasScrolledRef.current = scrolled;
            onScrolledChange?.(scrolled);
          }
          if (!hasMore) return;
          const distFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
          if (distFromBottom < 600) {
            setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPhotos.length));
          }
        }}
        scrollEventThrottle={250}
        showsVerticalScrollIndicator={false}
      >
        {renderHeader()}
        {bibQuery.trim().length > 0
          ? renderBibResults()
          : favOnly && visiblePhotos.length === 0 && !loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
                Aucune photo en favoris pour cet event.
              </Text>
            </View>
          ) : ((loading || upcoming) && visiblePhotos.length === 0 ? renderListEmpty() : renderChunks())}
        {bibQuery.trim().length === 0 && renderFooter()}
      </ScrollView>

      {/* Pill recherche par dossard rendue au root App.js (zIndex au-dessus
          du degrade blanc footer). Cf. App.js juste apres le bottom nav. */}

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
              Retirer cet event des favoris ?
            </Text>
            <Text style={{
              fontSize: 14, color: C.text, lineHeight: 20,
              marginBottom: 10, textAlign: 'center',
            }}>
              Tu ne recevras plus de notifs pour les nouvelles photos de cet event. Les photos déjà identifiées restent dans ta galerie.
            </Text>
            <Text style={{
              fontSize: 11, color: C.textSoft, lineHeight: 15,
              marginBottom: 20, textAlign: 'center',
            }}>
              Ta reconnaissance faciale globale n'est pas affectée — tu restes reconnaissable sur les autres events Will que tu suis. Pour la retirer, utilise « Supprimer mon selfie » dans ton profil.
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
                <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 14, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowUnfollowConfirm(false); onToggleFollow(); }}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 999,
                  backgroundColor: C.primary,
                  alignItems: 'center',
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Retirer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* (Le bottom sheet "+ d'infos" a ete remplace par une section inline
          sous le hero, controlee par le chevron du CTA "Infos pratiques"
          dans le hero. Voir renderHeader plus haut.) */}

      {/* CTA flottant retire 2026-06-09 : l acces au panier se fait
          desormais via l onglet Panier (bottom nav) qui montre toutes
          les events agregees. */}
    </>
  );
}


// ─── PanierScreen : onglet Panier global (agrege cross-event) ────────
// Liste toutes les cles `will:cart:*` via useAllCarts, groupe par event
// (avec metadata depuis allEvents = /public-events), affiche un footer
// total + bouton Commander disable (Stripe a venir).
function PanierScreen({ allEvents = [], onOpenEvent, isActive = true, onClose, embedded = false }) {
  const { carts, total, remove, refresh } = useAllCarts();
  // Re-fetch backend a chaque fois qu on entre dans le panier.
  // Permet de rattraper les ajouts faits depuis un autre device (web).
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (isActive && !wasActiveRef.current) refresh();
    wasActiveRef.current = isActive;
  }, [isActive, refresh]);
  const eventsMap = useMemo(() => {
    const m = new Map();
    for (const ev of allEvents) if (ev && ev.code) m.set(ev.code, ev);
    return m;
  }, [allEvents]);
  // embedded : rendu dans une sheet (parent gere le handle/padding). On retire
  // le topPad et l absolute bottom du footer pour utiliser le flex naturel.
  const topPad = embedded ? 0 : (Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0) + 12);
  const cellW = (SCREEN_W - 32 - 16) / 3;
  const orderedCodes = useMemo(() => Array.from(carts.keys()), [carts]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header style charte modal (AuthOrganizerModal) : titre AVEstiana
          rose centre + sous-titre textSoft. En embedded la fermeture passe
          par le handle drag + tap backdrop, pas de X. */}
      <View style={{ paddingTop: topPad, paddingHorizontal: 22, paddingBottom: 14, alignItems: 'center' }}>
        <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginTop: 4, marginBottom: 4, textAlign: 'center' }]}>
          Mon panier
        </Text>
        <Text style={{ color: C.textSoft, fontSize: 13, textAlign: 'center' }}>
          {total === 0 ? 'Vide pour le moment.' : `${total} photo${total > 1 ? 's' : ''} dans ton panier.`}
        </Text>
        {!embedded && onClose ? (
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Fermer" style={{ position: 'absolute', right: 16, top: topPad, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.6} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {total === 0 ? (
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 36, alignItems: 'center' }}>
            <View style={{
              width: 56, height: 56, borderRadius: 999,
              backgroundColor: '#F2EDFD',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Svg width={30} height={28} viewBox="0 0 18.96 17.61" fill="#7B2FFF">
                <Path d="M9.49,9.19c-.38,0-.68.3-.68.68v3.38c0,.37.31.68.68.68s.68-.3.68-.68v-3.38c0-.37-.31-.68-.68-.68Z" />
                <Path d="M12.94,9.23c-.37-.06-.73.18-.79.55l-.59,3.33c-.07.37.18.72.55.78.37.06.73-.18.79-.55l.59-3.33c.07-.37-.18-.72-.55-.78Z" />
                <Path d="M6.04,9.23c-.37.06-.62.42-.55.78l.59,3.33c.07.37.42.61.79.55.37-.06.62-.42.55-.78l-.59-3.33c-.07-.37-.42-.61-.79-.55Z" />
                <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
              </Svg>
            </View>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 8 }}>
              Aucune photo dans ton panier
            </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, textAlign: 'center', lineHeight: 18 }}>
              Parcours les galeries de tes événements et ajoute les photos que tu souhaites télécharger.
            </Text>
          </View>
        ) : (
          orderedCodes.map((code) => {
            const keys = carts.get(code) || [];
            const meta = eventsMap.get(code) || { name: code, event_date: '' };
            const dateLabel = meta.event_date ? formatDateLong(meta.event_date, meta.event_date_end) : '';
            return (
              <View key={code} style={{ backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ fontFamily: 'Montserrat', fontSize: 16, fontWeight: '800', color: C.text, letterSpacing: -0.2 }} numberOfLines={2}>
                      {meta.name || code}
                    </Text>
                    <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>
                      {[dateLabel, `${keys.length} photo${keys.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {onOpenEvent ? (
                    <TouchableOpacity onPress={() => onOpenEvent(meta)} activeOpacity={0.7}>
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Voir →</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {keys.map((k) => {
                    const thumbUri = `${API_URL}/photo-thumb/${encodeURIComponent(k)}?v=wm19`;
                    return (
                      <View key={k} style={{ width: cellW, height: cellW, borderRadius: 12, overflow: 'hidden', backgroundColor: C.primaryLight, position: 'relative' }}>
                        <ExpoImage
                          source={{ uri: thumbUri }}
                          style={{ width: '100%', height: '100%' }}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                          transition={100}
                        />
                        <TouchableOpacity
                          onPress={() => remove(code, k)}
                          hitSlop={8}
                          accessibilityLabel="Retirer du panier"
                          style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 26, height: 26, borderRadius: 999,
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" />
                          </Svg>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {total > 0 ? (
        <View style={{
          backgroundColor: '#fff',
          borderTopWidth: 1, borderTopColor: '#EFEAFB',
          paddingHorizontal: 20, paddingTop: 14, paddingBottom: embedded ? 18 : 14,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <View>
            <Text style={{ color: C.textSoft, fontSize: 12, fontFamily: 'Montserrat' }}>Total</Text>
            <Text style={{ fontFamily: 'Montserrat', fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 }}>
              {`${total * PRICE_PER_PHOTO_EUR} €`}
            </Text>
          </View>
          <TouchableOpacity
            disabled
            style={{ backgroundColor: '#C9BEEF', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999 }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Montserrat', fontSize: 14, fontWeight: '700' }}>Commander · bientôt</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// Roulette 3 items visibles, style "overlay" : pastille centrale rose, items
// au-dessus/en-dessous attenues. Top-fade en degrade vers le panneau noir
// pour fondre la roulette sous le titre.

function PhotographerScreen({ session, onLogout, onExit, photographerApiFetch }) {
  // Ecran toujours allume pendant la session photographe : evite que la veille
  // iOS suspende process/drain (les fetch upload sont coupes en background).
  // Cas terrain : benevole pose l'iPhone branche sur powerbank, capture +
  // upload tournent en continu 4-5h sans interruption. Auto-deactive au
  // unmount du screen (retour Home / logout).
  useKeepAwake();
  // Monitoring batterie : auto-pause capture si <10% ET pas branche, pour
  // laisser 10-20 min de marge pour drainer la queue avant kill iOS. Affiche
  // aussi le % dans le header (utile au benevole sur le terrain).
  const [batteryLevel, setBatteryLevel] = useState(1);
  const [batteryState, setBatteryState] = useState(Battery.BatteryState.UNKNOWN);
  const { hasPermission, requestPermission } = useCameraPermission();
  // Audit B13 : si iOS a deja denied une fois, requestPermission() devient
  // inerte. On bascule le bouton vers Linking.openSettings() quand on
  // detecte qu une 1ere tentative n a pas accorde la permission.
  const [hasRequestedCameraPermission, setHasRequestedCameraPermission] = useState(false);
  const cameraPermissionDenied = hasRequestedCameraPermission && !hasPermission;
  const requestCameraPermission = async () => {
    setHasRequestedCameraPermission(true);
    await requestPermission();
  };
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
    // Pipeline mobile 2026-05 : iPhone gere AE/AF continus + Deep Fusion +
    // Smart HDR. shutterSpeed (v1) ignore. v2 = shutter cap adaptatif via
    // activeMaxExposureDuration (cf with-shutter-lock v2) : on plafonne la
    // duree max d expo SANS quitter le mode auto -> rendu iPhone preserve
    // mais coureur fige meme sous-bois. Cap decide cote JS d apres le
    // voyant luminosite, push au natif via le frame processor.
    //   - shutterSpeedMaxBright : cap en lumiere OK (denominateur, 0 = no cap).
    //                             Defaut 0 : iOS choisit librement en pleine
    //                             lumiere (il pique deja a 1/2000+ tout seul,
    //                             un cap arbitraire ne servirait a rien).
    //   - shutterSpeedMaxDim    : cap en lumiere moyenne / faible (defaut 500
    //                             = 1/500s, 0 = no cap pour debug).
    // captureZoneWidthPercent = bande verticale capture (filtre bbox face).
    camera: {
      captureZoneWidthPercent: 30,
      shutterSpeed: 1000, // legacy, non utilise depuis 2026-05
      shutterSpeedMaxBright: 0,
      shutterSpeedMaxDim: 500,
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
  // Caméra physique (prop isActive de <VisionCamera>). Distincte de
  // isAutoArmed (intention de capturer). Pilotée par AppState : iOS suspend
  // l'AVCaptureSession en background ; on toggle false→true au retour
  // foreground pour forcer vision-camera à réattacher caméra + frame processor
  // (sans ce toggle, onHumansDetectedJS n'est plus appelé même si Go! reste actif).
  const [cameraActive, setCameraActive] = useState(true);
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
  // Shutter cap adaptatif (v2) : pousse vers le natif via readExposure args.
  // Default 1/500 + label "init" avant que le voyant luminosite ait stabilise.
  // Note : ces SV ne servent QUE de bridge JS->worklet->native. Le calcul du
  // cap se fait dans le useEffect [liveExposureSamples, eventConfig.camera.*]
  // plus bas, base sur le meme shutter median que le voyant.
  const capSecondsSV = useMemo(() => Worklets.createSharedValue(0.002), []);
  const brightnessLabelSV = useMemo(() => Worklets.createSharedValue('init'), []);
  // Cadence dynamique Vision : 0 = normal (skip 1/3 -> ~10 fps analyse), 1 = idle
  // (skip 1/6 -> ~5 fps). Bascule en idle apres IDLE_AFTER_MS sans visage detecte
  // pour economiser CPU/NPU + thermal sur event long. Retour immediat a normal
  // des qu'un visage est vu (cf onHumansDetectedJS).
  const idleModeSV = useMemo(() => Worklets.createSharedValue(0), []);

  // Caméra ancrée juste sous le header (au lieu de absoluteFill + letterbox 4:3
  // qui laissait un grand vide noir entre le header et l'image visible sur les
  // grands écrans). La preview est dimensionnée explicitement en 4:3.
  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  // Marge horizontale autour du viewer pour respirer (et garder le ratio
  // 4:3 strict sur la nouvelle largeur reduite).
  const PREVIEW_MARGIN_H = 20;
  const previewW = winW - PREVIEW_MARGIN_H * 2;
  const previewH = Math.min(winH, previewW * (4 / 3));
  // Strip galerie supprime, viewer demarre juste sous le header (148).
  const CAMERA_TOP = 148;

  // Course + km posté
  const [selectedRace, setSelectedRace] = useState(null); // null = "Toutes les courses"
  const [selectedKm, setSelectedKm] = useState(null); // null = cran "Non posté" (default)
  // Refs synchrones aux state ci-dessus. captureOne est invoque depuis un
  // worklet (onHumansDetectedJS via Worklets.createRunOnJS) memoize avec
  // deps:[] -> la closure est figee au mount. Lire les state directement
  // donnerait toujours la valeur initiale (null/null). Lecture via ref =
  // valeur courante a chaque shot.
  const selectedRaceRef = useRef(null);
  const selectedKmRef = useRef(null);
  useEffect(() => { selectedRaceRef.current = selectedRace; }, [selectedRace]);
  useEffect(() => { selectedKmRef.current = selectedKm; }, [selectedKm]);
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

  // Idle threshold avant de passer en cadence Vision reduite. 30s : large
  // marge pour ne pas rater un coureur isole qui arrive apres une accalmie.
  const IDLE_AFTER_MS = 30000;
  const idleTimeoutRef = useRef(null);

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
      // Cadence Vision dynamique : visage detecte -> repasse immediatement
      // a 10 fps. Si pas de visage -> arme un timeout 30s qui bascule en idle
      // (5 fps Vision) jusqu'au prochain visage. Le worklet lit idleModeSV
      // a chaque frame pour ajuster le skip mod.
      if (count > 0) {
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }
        if (idleModeSV.value !== 0) idleModeSV.value = 0;
      } else if (!idleTimeoutRef.current && idleModeSV.value === 0) {
        idleTimeoutRef.current = setTimeout(() => {
          idleTimeoutRef.current = null;
          idleModeSV.value = 1;
        }, IDLE_AFTER_MS);
      }
      if (!isAutoArmedRef.current) return;
      if (!faceInZoneRef.current) return;
      if (burstLoopRef.current) return;
      captureBurstLoop();
    }),
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (!hasPermission) {
      setHasRequestedCameraPermission(true);
      requestPermission();
    }
    return () => {
      isMountedRef.current = false;
      // Annule le timer de retry pour ne pas declencher un drainQueue
      // post-unmount (qui ferait des fetch vers API_URL pour rien).
      if (retryTickTimeoutRef.current) {
        clearTimeout(retryTickTimeoutRef.current);
        retryTickTimeoutRef.current = null;
      }
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
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

  // Battery monitoring : init + listeners.
  // Threshold 10% : pause capture (mais drain continue tant que possible) +
  // alerte one-shot par session. Auto-restart si le benevole branche un
  // powerbank apres la pause. throttle 5 min entre 2 alertes batterie pour
  // ne pas spammer si le niveau oscille autour du seuil.
  const lastBatteryWarnAtRef = useRef(0);
  const BATTERY_PAUSE_THRESHOLD = 0.10;
  useEffect(() => {
    let levelSub = null;
    let stateSub = null;
    (async () => {
      try {
        const lvl = await Battery.getBatteryLevelAsync();
        const st = await Battery.getBatteryStateAsync();
        if (!isMountedRef.current) return;
        setBatteryLevel(lvl);
        setBatteryState(st);
      } catch (e) { console.warn('battery init', e?.message); }
      levelSub = Battery.addBatteryLevelListener(({ batteryLevel: lvl }) => {
        if (!isMountedRef.current) return;
        setBatteryLevel(lvl);
      });
      stateSub = Battery.addBatteryStateListener(({ batteryState: st }) => {
        if (!isMountedRef.current) return;
        setBatteryState(st);
      });
    })();
    return () => {
      try { levelSub?.remove?.(); } catch {}
      try { stateSub?.remove?.(); } catch {}
    };
  }, []);

  // BackgroundUploader : listener Complete pour les uploads en cours qui
  // survivent a un cold start. Le wrapper Promise dans le worker drainQueue
  // resout les uploads "actifs" de la session JS courante (via pendingBgUploads),
  // mais un upload encore en cours iOS apres restart n'a pas de promise pending.
  // Ce listener applique le resultat directement a queueRef pour ces cas-la.
  useEffect(() => {
    if (!bgUploaderEmitter) return;
    const sub = bgUploaderEmitter.addListener('BackgroundUploaderComplete', (evt) => {
      const { itemId, success, statusCode } = evt || {};
      if (!itemId) return;
      // Si une promise pending existe, le wrapper drainQueue gere -- skip.
      if (pendingBgUploads.has(itemId)) return;
      // Sinon : reconcile direct queueRef. Trouve l'item, applique le succes
      // ou bumpe les retries.
      const cur = queueRef.current;
      const idx = cur.findIndex(it => it.id === itemId);
      if (idx === -1) return;
      const item = cur[idx];
      const ok = !!success && statusCode >= 200 && statusCode < 300;
      if (ok) {
        try { new File(item.localUri).delete(); } catch {}
        uploadedCountRef.current += 1;
        if (isMountedRef.current) setUploadedCount(uploadedCountRef.current);
        const next = cur.filter((_, i) => i !== idx);
        commitQueue(next);
      } else {
        const updated = nextRetryState(item, MAX_RETRIES_DEFAULT);
        const next = cur.map((it, i) => i === idx ? updated : it);
        commitQueue(next);
        scheduleRetryTick();
      }
    });
    return () => sub.remove();
  }, []);

  // Reagit au level/state : pause capture si <10% ET pas en charge.
  useEffect(() => {
    const charging = batteryState === Battery.BatteryState.CHARGING
                  || batteryState === Battery.BatteryState.FULL;
    if (batteryLevel <= BATTERY_PAUSE_THRESHOLD && !charging && isAutoArmedRef.current) {
      isAutoArmedRef.current = false;
      setIsAutoArmed(false);
      const now = Date.now();
      if (now - lastBatteryWarnAtRef.current > 5 * 60 * 1000) {
        lastBatteryWarnAtRef.current = now;
        Alert.alert(
          'Batterie faible',
          `${Math.round(batteryLevel * 100)}% restant. Capture pausee pour laisser l'upload finir. Branche un powerbank pour reprendre.`,
        );
      }
    }
  }, [batteryLevel, batteryState]);

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

  // E5 cap shutter adaptatif — en lumiere OK on ne plafonne PAS (iOS choisit
  // librement, deja a 1/2000+ tout seul) ; en lumiere moyenne / faible on
  // applique un cap pour figer le coureur. Le shutter median (meme seuil que
  // le voyant) decide. La SV est lue au tick 1Hz suivant par le worklet et
  // poussee au natif via readExposure args. Cap = 1.0s = pas de plafond
  // effectif (la native clampe a activeFormat.maxExposureDuration ~= 1s).
  useEffect(() => {
    const shutters = liveExposureSamples
      .map(s => s.shutter)
      .filter(v => Number.isFinite(v) && v > 0);
    if (shutters.length === 0) return;
    const sorted = [...shutters].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    const camCfg = eventConfig?.camera || {};
    const denBright = Number(camCfg.shutterSpeedMaxBright) || 0; // 0 = no cap (defaut)
    const denDim = Number(camCfg.shutterSpeedMaxDim) || 500;
    let label, cap;
    if (mid <= 0.001) {
      label = 'OK';
      cap = denBright > 0 ? 1.0 / denBright : 0; // 0 = RELEASE (no cap)
    } else if (mid <= 0.002) {
      label = 'moyenne';
      cap = denDim > 0 ? 1.0 / denDim : 0;
    } else {
      label = 'faible';
      cap = denDim > 0 ? 1.0 / denDim : 0;
    }
    capSecondsSV.value = cap;
    brightnessLabelSV.value = label;
  }, [liveExposureSamples, eventConfig?.camera?.shutterSpeedMaxBright, eventConfig?.camera?.shutterSpeedMaxDim, capSecondsSV, brightnessLabelSV]);

  // Frame processor : ~30 fps appel worklet, throttle 1/3 -> ~10 fps d'analyse
  // Vision (economie batterie + thermal). Apple Vision tourne sur la queue
  // VisionCamera (background) ; le runOnJS ne bloque pas le rendu.
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // ISO live : tick ~1 Hz a 30 fps (independant du throttle Vision pour
    // que le voyant lumiere reste reactif meme quand detectHumans skip).
    // Lecture seule de la metadata EXIF du buffer, ~qq us, ne bloque rien.
    // En meme temps : push du cap shutter adaptatif au natif (no-op si meme
    // cap+label que precedent, dedupe interne au WillShutterController).
    isoTickSV.value = (isoTickSV.value + 1) % 30;
    if (isoTickSV.value === 0) {
      const exp = readExposure(frame, {
        setCapSeconds: capSecondsSV.value,
        brightnessLabel: brightnessLabelSV.value,
      });
      if (exp && exp.iso) onExposureSampleJS(exp);
    }

    // Skip dynamique : 1/3 (10 fps) en normal, 1/6 (5 fps) en idle.
    // idleModeSV est togglee par onHumansDetectedJS (cf timeout 30s).
    const skipMod = idleModeSV.value === 1 ? 6 : 3;
    frameSkipSV.value = (frameSkipSV.value + 1) % skipMod;
    if (frameSkipSV.value !== 0) return;
    const result = detectHumans(frame, {
      zoneWidthPercent: zoneSV.value,
      axis: 'midX',
    });
    const count = result?.count ?? 0;
    onHumansDetectedJS(count);
  }, [onHumansDetectedJS, onExposureSampleJS, frameSkipSV, isoTickSV, zoneSV, capSecondsSV, brightnessLabelSV, idleModeSV]);

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
      // Reconcile BackgroundUploader : ces itemIds sont encore en cours cote
      // iOS (URLSession.background survit aux restarts JS). On preserve leur
      // status 'uploading' au lieu de reset a 'pending' -- sinon le drain JS
      // les enqueue une 2e fois cote iOS = doublon.
      let activeBgItemIds = new Set();
      if (hasBackgroundUploader) {
        try {
          const { activeItemIds } = await BackgroundUploaderModule.getActiveUploads();
          activeBgItemIds = new Set(Array.isArray(activeItemIds) ? activeItemIds : []);
          if (activeBgItemIds.size > 0) {
            console.log(`[BackgroundUploader] reconcile: ${activeBgItemIds.size} uploads encore actifs cote iOS`);
          }
        } catch (e) { console.warn('getActiveUploads', e?.message); }
      }
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
        // EXCEPTION : si l'itemId est encore actif dans URLSession background,
        // on preserve 'uploading' -- l'event Complete arrivera quand iOS finit.
        if (it.status === 'uploading' && activeBgItemIds.has(it.id)) {
          cleaned.push(it);
        } else if (it.status === 'uploading' || it.status === 'processing') {
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
  // Pilote aussi cameraActive (prop isActive de <VisionCamera>) : sans le
  // toggle false→true, le frame processor ne reprend pas après suspension iOS
  // et la capture auto reste gelée alors que le bouton Go! affiche actif.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        processQueue();
        drainQueue();
        // Reset throttles : sinon la 1ère frame post-foreground peut être
        // filtrée (frameSkipSV % 3) et retarder la 1ère détection de ~100ms.
        try { frameSkipSV.value = 0; isoTickSV.value = 0; } catch {}
        setCameraActive(true);
      } else if (next === 'background' || next === 'inactive') {
        setCameraActive(false);
      }
    });
    return () => sub.remove();
  }, []);

  // ─── Mini-galerie photographe ─────────────────────────────────────────
  // Chip 28px dans le header montre la derniere photo uploadee ; tap →
  // sheet grille des N dernieres pour cet event. Source : worker R2 via
  // /photographer/my-photos (filtre prefix {eventCode}/{photographerId}/).
  // Pas de liste locale : les fichiers sont supprimes apres PUT 200 OK.
  // Refresh sur 3 triggers, jamais en polling :
  //   - mount + retour foreground
  //   - bump uploadedCount (debounce 800ms : un burst declenche 1 fetch et
  //     pas N)
  // Erreur reseau silencieuse : la mini-galerie ne bloque PAS la capture.
  const [myPhotos, setMyPhotos] = useState([]);
  const [myPhotosLoading, setMyPhotosLoading] = useState(false);
  const [myPhotosError, setMyPhotosError] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryViewerPhoto, setGalleryViewerPhoto] = useState(null);
  const myPhotosFetchInFlightRef = useRef(false);
  const myPhotosDebounceRef = useRef(null);
  // Animated.Value pour le scroll horizontal du strip — alimente
  // l interpolation d opacite par thumb (fade transparent aux bords
  // de la vue visible, plutot qu un overlay noir).
  const stripScrollX = useRef(new Animated.Value(0)).current;

  // Readout technique ISO/shutter/EV : replie par defaut sous une fleche
  // pour ne pas polluer la vue benevole. Toujours gate IS_PREVIEW_OR_DEV
  // (jamais visible en prod, meme deplie).
  const [techExpanded, setTechExpanded] = useState(false);
  // Menu flottant a gauche du viewer : ferme par defaut, ouvert via chevron.
  const [menuOpen, setMenuOpen] = useState(false);
  // Animated.Value pour open/close en spring (rotation chevron + fade/translate
  // des boutons d action + opacite du backdrop).
  const menuAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(menuAnim, {
      toValue: menuOpen ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [menuOpen]);

  const toggleMenu = () => {
    try { Haptics?.selectionAsync?.(); } catch {}
    setMenuOpen(v => !v);
  };

  const fetchMyPhotos = useCallback(async () => {
    if (!session?.event?.code || !session?.token) return;
    if (myPhotosFetchInFlightRef.current) return;
    myPhotosFetchInFlightRef.current = true;
    if (isMountedRef.current) setMyPhotosLoading(true);
    try {
      // UI-11 : migre vers photographerApiFetch (auto-Bearer + humanise erreurs reseau + garde 401)
      const r = await photographerApiFetch(
        `/photographer/my-photos?eventCode=${encodeURIComponent(session.event.code)}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const list = Array.isArray(data?.photos) ? data.photos : [];
      // Tri burstTs DESC puis idx DESC -- meme convention que loadPhotos
      // public/orga ; recente en tete pour que la chip montre la derniere.
      list.sort((a, b) => {
        const dt = extractBurstTs(b.key) - extractBurstTs(a.key);
        if (dt !== 0) return dt;
        return extractIdx(b.key) - extractIdx(a.key);
      });
      if (isMountedRef.current) {
        setMyPhotos(list);
        setMyPhotosError(false);
      }
    } catch (e) {
      console.warn('[my-photos] fetch failed:', e?.message || e);
      if (isMountedRef.current) setMyPhotosError(true);
    } finally {
      myPhotosFetchInFlightRef.current = false;
      if (isMountedRef.current) setMyPhotosLoading(false);
    }
  }, [session?.event?.code, session?.token]);

  useEffect(() => {
    fetchMyPhotos();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fetchMyPhotos();
    });
    return () => sub.remove();
  }, [fetchMyPhotos]);

  // Debounce 800ms sur le bump uploadedCount : pendant un burst plusieurs
  // PUT 200 arrivent en <1s, on declenche UN fetch ~800ms apres le dernier.
  useEffect(() => {
    if (uploadedCount === 0) return;
    if (myPhotosDebounceRef.current) clearTimeout(myPhotosDebounceRef.current);
    myPhotosDebounceRef.current = setTimeout(() => {
      myPhotosDebounceRef.current = null;
      fetchMyPhotos();
    }, 800);
    return () => {
      if (myPhotosDebounceRef.current) {
        clearTimeout(myPhotosDebounceRef.current);
        myPhotosDebounceRef.current = null;
      }
    };
  }, [uploadedCount, fetchMyPhotos]);

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

      // CONCURRENCY 3 par defaut, adapte dynamiquement selon ProcessInfo.thermalState :
      //   nominal/fair -> 3 (debit utile, 4G/5G correct)
      //   serious      -> 2 (CPU/GPU throttling actif, on soulage)
      //   critical     -> 1 (proche shutdown iOS, on minimise)
      // L'etat est mis a jour par le listener module-level dans
      // src/services/thermalMonitor.js. Si le module natif n'est pas dispo,
      // reste 'nominal' = 3.
      const CONCURRENCY = concurrencyForThermal(getCurrentThermalState());
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
            const headers = {
              'Content-Type': item.isRaw ? 'image/x-adobe-dng' : 'image/heic',
              Authorization: `Bearer ${session.token}`,
            };
            if (item.race) headers['X-Will-Race'] = String(item.race);
            if (item.km) headers['X-Will-Km'] = String(item.km);
            const uploadUrl = `${API_URL}/${item.key}`;

            // Voie native iOS si dispo : streaming depuis fichier (zero blob
            // RAM), HTTP/3, iOS gere le transfer meme app minimisee. L'enqueue
            // resolve immediatement (task creee), on attend le resultat via
            // event BackgroundUploaderComplete dispatchee dans pendingBgUploads.
            // Fallback fetch si module absent (dev sans build natif).
            let result;
            if (hasBackgroundUploader) {
              result = await new Promise((resolve, reject) => {
                pendingBgUploads.set(item.id, { resolve, reject });
                BackgroundUploaderModule
                  .enqueueUpload(uploadUrl, item.localUri, headers, item.id)
                  .catch((e) => {
                    pendingBgUploads.delete(item.id);
                    reject(e);
                  });
              });
            } else {
              const blob = await (await fetch(item.localUri)).blob();
              const res = await fetch(uploadUrl, { method: 'PUT', headers, body: blob });
              result = { ok: res.ok, status: res.status, error: null };
            }

            if (result.ok) {
              // succès → delete fichier local + drop item + bump "Uploadees"
              // (verite R2 cote app : on n'incremente QUE sur PUT 200 OK).
              try { new File(item.localUri).delete(); } catch {}
              arr[i] = null;
              uploadedCountRef.current += 1;
              if (isMountedRef.current) setUploadedCount(uploadedCountRef.current);
              if (verbose) {
                const m = `[upload] OK ${item.id} (key=${item.key}) via=${hasBackgroundUploader ? 'bg' : 'fetch'}`;
                console.log(m); addDebugLog(m);
              }
            } else {
              const updated = nextRetryState(item, maxRetries);
              const m = `[upload] HTTP ${result.status} ${item.id} -> retries=${updated.retries}, next=${updated.nextAttemptAt ?? 'never'}${result.error ? ` err=${result.error}` : ''}`;
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
    // Si une task BackgroundUploader est encore en cours pour cet item, on
    // la cancel cote iOS pour eviter qu'elle finisse en zombie.
    if (hasBackgroundUploader) {
      try { await BackgroundUploaderModule.cancelUpload(id); } catch {}
    }
    // Resout la promise pending eventuelle pour debloquer un worker JS.
    const pending = pendingBgUploads.get(id);
    if (pending) {
      pendingBgUploads.delete(id);
      pending.resolve({ ok: false, status: 0, error: 'cancelled by user' });
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

  // Cap dur du pipeline (queue persistante + in-flight). Aligne sur
  // MAX_QUEUE_SIZE (1000) : on autorise la capture tant qu'on n'a pas atteint
  // le seuil FIFO drop. Defense memoire obsolete depuis le refactor pipeline
  // mai 2026 (les photos sont disque-backed via pendingDir/raw|processed,
  // queueRef ne contient que ~200 octets de metadonnees par item).
  // Le vrai garde-fou physique est le check disque ci-dessous via
  // pendingDirSizeBytesCached > STORAGE_WARN_BYTES (5 Go).
  const MAX_TOTAL_IN_PIPELINE = 1000;

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

        // Backpressure dur — deux gardes independantes :
        //
        // 1. Queue + in-flight atteint MAX_TOTAL_IN_PIPELINE (1000) : on est
        //    sur le point de declencher la FIFO eviction (MAX_QUEUE_SIZE).
        //    Plutot que d'enqueuer pour pousser une ancienne dehors, on stoppe
        //    le burst -- la prochaine photo en captureerait une autre derriere.
        //
        // 2. pendingDir disque > STORAGE_WARN_BYTES (5 Go) : circuit breaker
        //    physique. Throttle 30s (pendingDirSizeBytesCached) car walk
        //    recursif ne doit PAS tourner par shot a 5-7 ph/s. Au-dela on
        //    risque de saturer le disque iPhone ; mieux vaut pauser que rendre
        //    le tel inutilisable pour le reste de la course.
        const pipelineLoad = queueRef.current.length + inFlightSetRef.current.size;
        if (pipelineLoad >= MAX_TOTAL_IN_PIPELINE) {
          console.warn(`[burst] backpressure: pipeline=${pipelineLoad}/${MAX_TOTAL_IN_PIPELINE} — pause burst`);
          break;
        }
        const diskBytes = pendingDirSizeBytesCached();
        if (diskBytes > STORAGE_WARN_BYTES) {
          console.warn(`[burst] backpressure disque: ${(diskBytes / 1024 / 1024 / 1024).toFixed(1)} Go > 5 Go — pause burst`);
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
                   : (queueRef.current.length + inFlightSetRef.current.size) >= MAX_TOTAL_IN_PIPELINE ? 'backpressure-queue'
                   : pendingDirSizeBytesCached() > STORAGE_WARN_BYTES ? 'backpressure-disk'
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
    const photoKey = `${session.event.code}/${session.photographer_id}/${dateStr}/${timeStr}_${burstTs}_${idx}.heic`;
    try {
      await enqueueBurstItems([{
        key: photoKey,
        tempPath: photo.path,
        isRaw: false,
        burstTs,
        idx,
        // Lecture via ref (cf selectedRaceRef/selectedKmRef) : captureOne tourne
        // dans un worklet a closure figee au mount, donc lire les state donnerait
        // toujours null/null. La ref pointe sur la valeur courante de la roulette.
        race: selectedRaceRef.current ? String(selectedRaceRef.current.km) : null,
        // selectedKm = null -> non posté ; 0 = "Départ" ; 'arrivee' = "Arrivée" ; N = km N.
        km: selectedKmRef.current !== null ? String(selectedKmRef.current) : null,
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
        <Text style={{ color: C.text, textAlign: 'center', marginBottom: 16 }}>
          {cameraPermissionDenied
            ? "L'accès à la caméra a été refusé. Ouvre les réglages pour l'autoriser."
            : 'Permission caméra requise'}
        </Text>
        <TouchableOpacity
          style={s.btnPrimary}
          onPress={cameraPermissionDenied ? () => Linking.openSettings() : requestCameraPermission}
        >
          <Text style={s.btnPrimaryText}>
            {cameraPermissionDenied ? 'Ouvrir les réglages' : 'Autoriser'}
          </Text>
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
    ? { label: 'Capture', dot: C.error, bg: 'rgba(239,68,68,0.2)', text: C.error }
    : !isOnline
      ? {
          label: queueStats.total > 0 ? `Hors ligne · ${queueStats.total}` : 'Hors ligne',
          dot: C.warning, bg: 'rgba(245,158,11,0.2)', text: C.warning,
        }
      : { label: 'Prêt', dot: '#22C55E', bg: 'rgba(34,197,94,0.2)', text: '#22C55E' };

  // Progression du drain courant : affichée sous le header pendant l'upload
  // si le batch initial dépassait 5 photos.
  const drainShowBar = drainStartTotal > 5 && queueStats.uploading > 0;
  const drainProgress = drainStartTotal > 0
    ? Math.max(0, Math.min(1, 1 - (queueStats.pending + queueStats.uploading) / drainStartTotal))
    : 0;

  // Date compacte pour le header refondu (refonte 2026-06-01) : just le jour
  // de depart, "30 MAI 2026". Sur un event multi-jour on perd le range mais
  // la date complete reste visible sur la home / event card / public page.
  const compactDate = (() => {
    if (!session?.event?.event_date) return null;
    const d = new Date(session.event.event_date);
    if (isNaN(d.getTime())) return null;
    return `${d.getDate()} ${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
  })();

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
    else if (mid <= 0.002) { lightDot = '#F97316'; lightLabel = 'Luminosité moyenne'; }
    else { lightDot = '#F43F5E'; lightLabel = 'Luminosité faible'; }
  }

  // "En attente" = photos pas encore confirmees R2 PUT 200 mais qui vont
  // partir : captures en vol + items pending/uploading en queue. EXCLUT
  // les failed (qui apparaissent sur la ligne "X a renvoyer" si > 0 — c'est
  // une anomalie qui demande une action, pas un transit normal).
  const pendingCount = inFlight + queueStats.pending + queueStats.uploading;
  const cloudActive = pendingCount > 0;
  const cloudColor = cloudActive ? '#3B82F6' : 'rgba(255,255,255,0.85)';

  // Garde-fou UX avant sortie d'ecran : si des photos sont encore en transit
  // (in-flight ou en queue pending/uploading), on previent le benevole pour
  // qu'il garde l'app au premier plan jusqu'a la fin. La queue est persistante
  // (recovery au remount) donc rien n'est PERDU s'il quitte, mais le JS thread
  // doit vivre pour que les fetch finissent -- d'ou le message rassurant
  // "elles repartiront a ta prochaine ouverture". Ton volontairement neutre,
  // pas de style destructive sur "Quitter quand meme" (action reversible).
  function confirmLeaveWithPending(proceed) {
    if (pendingCount === 0) { proceed(); return; }
    Alert.alert(
      'Photos en cours d\'envoi',
      `Il te reste ${pendingCount} photo${pendingCount > 1 ? 's' : ''} à envoyer. Garde l'app ouverte encore un instant pour qu'elles partent. Si tu quittes, elles repartiront à ta prochaine ouverture.`,
      [
        { text: 'Rester', style: 'cancel' },
        { text: 'Quitter quand même', onPress: proceed },
      ],
      { cancelable: true },
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Caméra — resizeMode 'contain' (letterbox naturel), bandes noires explicites par-dessus.
          La détection (frame processor) reste en coordonnées sensor : performance Rekognition inchangée. */}
      <VisionCamera
        ref={cameraRef}
        style={{
          position: 'absolute',
          top: CAMERA_TOP,
          left: PREVIEW_MARGIN_H, right: PREVIEW_MARGIN_H,
          height: previewH,
          borderRadius: 16,
          overflow: 'hidden',
        }}
        device={device}
        format={format}
        isActive={cameraActive}
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
            style={{ position: 'absolute', top: CAMERA_TOP, height: previewH, left: PREVIEW_MARGIN_H, right: PREVIEW_MARGIN_H, borderRadius: 16, overflow: 'hidden' }}
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

      {/* ─── TOP AREA — refonte 2026-06-02 ─────────────────────────────
          Header pousse vers le bas du black band (paddingTop 80) pour
          rapprocher le contenu de la preview camera. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 80, paddingBottom: 12, paddingHorizontal: 16,
          transform: [{ translateY: headerSlideY }],
          zIndex: 10,
        }}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0)']}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        {/* alignItems: 'flex-end' aligne back, titre, et cluster sur la
            baseline du NOM ; la date "kicker" sit au-dessus dans le bloc
            titre sans casser l'alignement vertical des icones. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <TouchableOpacity
            onPress={() => confirmLeaveWithPending(onExit || onLogout)}
            hitSlop={10}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: '#1a1a1a',
              alignItems: 'center', justifyContent: 'center',
            }}
            accessibilityLabel="Retour"
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M19 12H5M12 19l-7-7 7-7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Bloc titre : date kicker au-dessus, nom dessous (baseline = bottom). */}
          <View style={{ flex: 1, minWidth: 0 }}>
            {compactDate ? (
              <Text
                style={{
                  color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '700',
                  letterSpacing: 0.8, marginBottom: 1,
                  textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
                }}
                numberOfLines={1}
              >
                {compactDate}
              </Text>
            ) : null}
            <Text
              style={{
                color: '#fff', fontSize: 19, fontWeight: '700',
                fontFamily: 'AVEstiana', fontStyle: 'normal',
                textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
                lineHeight: 22,
              }}
              numberOfLines={1}
            >
              {session?.event?.name || 'Événement'}
            </Text>
          </View>

          {/* Chevron + power deplaces dans le cluster flottant sur le viewer */}
        </View>

        {/* Panneau details replie : 2 LIGNES centrees sur aplat noir edge-
            to-edge. Ligne 1 = compteurs + erreur (toujours visible si
            techExpanded). Ligne 2 = ISO/shutter/EV (preview/dev only). */}
        {techExpanded && (
          <View style={{
            marginTop: 8,
            marginHorizontal: -16,
            paddingHorizontal: 16, paddingVertical: 10,
            backgroundColor: '#000',
          }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              flexWrap: 'wrap',
              columnGap: 10,
              rowGap: 4,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M17.5 19a4.5 4.5 0 00.5-8.97 6 6 0 00-11.62-1.5A4.5 4.5 0 006.5 19h11z"
                    stroke={cloudColor}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={cloudActive ? 'rgba(59,130,246,0.18)' : 'none'}
                  />
                </Svg>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' }}>
                  {uploadedCount} sauvegardée{uploadedCount > 1 ? 's' : ''}
                </Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>·</Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' }}>
                {pendingCount} en attente
              </Text>
              {(lostCount + queueStats.failed) > 0 && (
                <>
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>·</Text>
                  <Text style={{ color: '#FB923C', fontSize: 12, fontWeight: '600' }}>
                    {lostCount + queueStats.failed} à renvoyer
                  </Text>
                </>
              )}
            </View>
            {IS_PREVIEW_OR_DEV && liveExposureSamples.length > 0 && (() => {
              const last = liveExposureSamples[liveExposureSamples.length - 1];
              return (
                <Text style={{
                  marginTop: 4,
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '500',
                  fontVariant: ['tabular-nums'],
                }}>
                  ISO {Math.round(last.iso)} · {formatShutter(last.shutter)} · {formatEV(last.brightness)}
                </Text>
              );
            })()}
          </View>
        )}
      </Animated.View>

      {/* ─── ZONE Go! + ROULETTE ─── Go! chevauche le bas du viewer (moitie
          dessus, moitie dessous : center au niveau du bord bas du viewer).
          Course/Km en dessous, sur fond root (pas de bandeau noir). ─── */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: CAMERA_TOP + previewH - 30, // Go! top : half overlap viewer bottom
          left: 0, right: 0,
          transform: [{ translateY: footerSlideY }],
          zIndex: 10,
        }}
      >
        {/* Go!/Stop : cercle centre 84px. */}
        <TouchableOpacity
          onPress={onCapturePress}
          activeOpacity={0.9}
          style={{
            width: 84,
            height: 84,
            borderRadius: 42,
            alignSelf: 'center',
            backgroundColor: isAutoArmed ? '#FF3B30' : C.pinkPillActive,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{
            color: '#fff',
            fontSize: 28,
            fontStyle: 'italic',
            fontWeight: '800',
            fontFamily: 'AVEstiana',
            letterSpacing: 0.5,
          }}>{isAutoArmed ? 'Stop' : 'Go!'}</Text>
        </TouchableOpacity>

        {/* Row Course/Km, juste sous Go! (8px gap). Plus de fond noir : la
            roulette s appuie sur le fond root (#000) sans bandeau dedie. */}
        <View style={{
          flexDirection: 'row',
          marginTop: 8,
          alignItems: 'stretch',
        }}>
            {/* Section COURSE (gauche, 50%) — label + roulette 3-items toujours visible */}
            {(() => {
              const courseItems = [{ label: 'Toutes', value: null }, ...distances.map(d => ({ label: raceTitle(d), value: d }))];
              const rawIdx = courseItems.findIndex(it => (it.value?.km ?? null) === (selectedRace?.km ?? null));
              const courseIdx = rawIdx >= 0 ? rawIdx : 0;
              const setCourseIdx = (idx) => {
                const v = courseItems[idx].value;
                setSelectedRace(v);
                if (v && selectedKm !== null && selectedKm > Math.ceil(parseFloat(v.km) || 0)) setSelectedKm(null);
              };
              return (
                <View style={{ flex: 1, paddingTop: 4, paddingBottom: 4, paddingHorizontal: 10, alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => setSelectedRace(null)} hitSlop={6} activeOpacity={0.7} style={{ zIndex: 2, marginBottom: 0 }}>
                    <Text style={{
                      color: 'rgba(255,255,255,0.45)',
                      fontSize: 10, fontWeight: '600', letterSpacing: 1.5,
                      fontFamily: 'Montserrat',
                      textTransform: 'uppercase',
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

            {/* Section KM (droite, 50%) — label + roulette 3-items toujours visible.
                Premier item = "-" (value=null), default cran vide non posté.
                Disambigue le 0 km = "Départ" explicite : une photo prise en
                cran "-" n écrit PAS de km sur customMetadata R2 (header
                X-Will-Km absent a l upload).
                Format items : "Départ" (value=0), "Arrivée" (value='arrivee'),
                puis "km N" pour N>=1. La value 'arrivee' est traitee comme
                chaine opaque cote worker (cf reassignPhotoMeta, list endpoints,
                isPhotoVisibleToPublic n utilise que photo.race). */}
            {(() => {
              const kmItems = [
                { label: '-', value: null },
                { label: 'Départ', value: 0 },
                { label: 'Arrivée', value: 'arrivee' },
                ...Array.from({ length: kmCeiling }, (_, k) => ({
                  label: `km ${k + 1}`,
                  value: k + 1,
                })),
              ];
              const rawIdx = kmItems.findIndex(it => it.value === selectedKm);
              const kmIdx = rawIdx >= 0 ? rawIdx : 0;
              const setKmIdx = (idx) => setSelectedKm(kmItems[idx].value);
              return (
                <View style={{ flex: 1, paddingTop: 4, paddingBottom: 4, paddingHorizontal: 10, alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => setSelectedKm(null)} hitSlop={6} activeOpacity={0.7} style={{ zIndex: 2, marginBottom: 0 }}>
                    <Text style={{
                      color: 'rgba(255,255,255,0.45)',
                      fontSize: 10, fontWeight: '600', letterSpacing: 1.5,
                      fontFamily: 'Montserrat',
                      textTransform: 'uppercase',
                    }}>Posté</Text>
                  </TouchableOpacity>
                  <OverlayWheel
                    items={kmItems}
                    selectedIndex={kmIdx}
                    onChange={setKmIdx}
                  />
                </View>
              );
            })()}
        </View>
      </Animated.View>

      {/* ─── Pill Luminosité ─── flottante en haut de la preview, centree.
          Visible UNIQUEMENT si lumi != OK. Pill solide bright sans band
          colore derriere. */}
      {(lightDot === '#F97316' || lightDot === '#F43F5E') && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // Pill DANS le viewer (16px sous le bord superieur) pour ne pas
            // chevaucher le strip galerie au-dessus du viewer.
            top: CAMERA_TOP + 16 + (techExpanded ? 36 : 0),
            left: 0, right: 0,
            alignItems: 'center',
            zIndex: 5,
          }}
        >
          <View style={{
            backgroundColor: lightDot,
            paddingHorizontal: 22, paddingVertical: 7,
            borderRadius: 999,
          }}>
            <Text style={{
              color: '#fff', fontSize: 13, fontWeight: '700',
              letterSpacing: 0.3,
            }}>
              {lightLabel}
            </Text>
          </View>
        </View>
      )}

      {/* Strip galerie supprime : remplace par un bouton dans le cluster
          flottant a gauche du viewer (ouvre directement la sheet grille). */}

      {/* ─── Backdrop dismiss ─── couvre toute la zone capture quand le
          menu est ouvert ; tap dessus = ferme. Transparent : aucun
          assombrissement, juste un layer de hit-test. */}
      {menuOpen && (
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 5,
          }}
        />
      )}

      {/* ─── Menu iOS UIMenu-style ─── BlurView dark frosted, rows
          label+icon avec hairline separators. Scale+fade depuis le
          trigger (anim origin bas-gauche). */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: winH - (CAMERA_TOP + previewH - 16),
          left: PREVIEW_MARGIN_H + 14,
          alignItems: 'flex-start',
          zIndex: 6,
        }}
      >
        <Animated.View
          pointerEvents={menuOpen ? 'auto' : 'none'}
          style={{
            width: 230,
            borderRadius: 14,
            overflow: 'hidden',
            marginBottom: 10,
            opacity: menuAnim,
            transform: [
              // Scale depuis origine bas-gauche : on translate la View vers
              // l origine, on scale, on retranslate. Effet : le menu sort
              // du trigger plutot que d apparaitre au centre.
              { translateX: -115 }, // -width/2
              { translateY: 90 },   // approx +height/2 (3 rows ~60 chacun = 180/2 = 90)
              { scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
              { translateX: 115 },
              { translateY: -90 },
            ],
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          <BlurView intensity={85} tint="dark" style={{ borderRadius: 14, overflow: 'hidden' }}>
            {/* Galerie */}
            <TouchableOpacity
              onPress={() => { setMenuOpen(false); setGalleryOpen(true); }}
              activeOpacity={0.5}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13, paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '400', fontFamily: 'Montserrat' }}>Voir mes photos</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M4 7h3l2-2h6l2 2h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" stroke="#fff" strokeWidth={1.8} />
              </Svg>
            </TouchableOpacity>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)', marginLeft: 16 }} />

            {/* Infos (toggle techExpanded) */}
            <TouchableOpacity
              onPress={() => { setMenuOpen(false); setTechExpanded(v => !v); }}
              activeOpacity={0.5}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13, paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '400', fontFamily: 'Montserrat' }}>
                {techExpanded ? 'Masquer les infos' : 'Afficher les infos'}
              </Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M12 8h.01M11 12h1v4h1" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <Path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="#fff" strokeWidth={1.8} />
              </Svg>
            </TouchableOpacity>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)', marginLeft: 16 }} />

            {/* Deconnexion (destructive iOS red) */}
            <TouchableOpacity
              onPress={() => {
                setMenuOpen(false);
                if (pendingCount > 0) {
                  Alert.alert(
                    'Photos en cours d\'envoi',
                    `Il te reste ${pendingCount} photo${pendingCount > 1 ? 's' : ''} à envoyer. Garde l'app ouverte encore un instant pour qu'elles partent. Si tu te déconnectes, elles repartiront à ta prochaine connexion (tu devras ressaisir ton mot de passe).`,
                    [
                      { text: 'Rester', style: 'cancel' },
                      { text: 'Se déconnecter quand même', style: 'destructive', onPress: onLogout },
                    ],
                    { cancelable: true }
                  );
                } else {
                  Alert.alert(
                    'Se déconnecter ?',
                    'Tu devras saisir à nouveau le mot de passe pour reprendre ton événement.',
                    [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Déconnexion', style: 'destructive', onPress: onLogout },
                    ],
                    { cancelable: true }
                  );
                }
              }}
              activeOpacity={0.5}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingVertical: 13, paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: '#FF453A', fontSize: 15, fontWeight: '400', fontFamily: 'Montserrat' }}>Déconnexion</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M12 2v10" stroke="#FF453A" strokeWidth={2} strokeLinecap="round" />
                <Path d="M5.64 7.05A9 9 0 1 0 18.36 7.05" stroke="#FF453A" strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </BlurView>
        </Animated.View>

        {/* Trigger : bouton rond avec ellipsis iOS (3 points horizontaux),
            BlurView dark frosted. Pas de rotation : iOS UIButton avec menu
            ne tourne pas non plus. */}
        <TouchableOpacity
          onPress={toggleMenu}
          activeOpacity={0.7}
          accessibilityLabel={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          style={{
            width: 36, height: 36, borderRadius: 18,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.25, shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          <BlurView intensity={70} tint="dark" style={{
            width: '100%', height: '100%',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Animated.View style={{
              transform: [{
                rotate: menuAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }),
              }],
            }}>
              <Svg width={16} height={10} viewBox="0 0 16 10" fill="none">
                <Path
                  d="M2 8L8 2L14 8"
                  stroke="#fff"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Animated.View>
          </BlurView>
        </TouchableOpacity>
      </View>

      {/* ─── Mini-galerie sheet ─── ouverte au tap d'une vignette de la bande,
          grille 3 cols complete. Tap vignette dans la sheet → viewer plein
          ecran. Pull-to-refresh + bouton rafraichir manuel. ─── */}
      <Modal
        visible={galleryOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setGalleryOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: 'rgba(255,255,255,0.12)',
          }}>
            <TouchableOpacity
              onPress={() => setGalleryOpen(false)}
              hitSlop={10}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: 'rgba(255,255,255,0.12)',
                alignItems: 'center', justifyContent: 'center',
              }}
              accessibilityLabel="Fermer"
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
            <Text style={{
              color: '#fff', fontSize: 16, fontWeight: '700',
              fontFamily: 'AVEstiana',
            }}>
              Mes photos{myPhotos.length > 0 ? ` (${myPhotos.length})` : ''}
            </Text>
            <TouchableOpacity
              onPress={fetchMyPhotos}
              disabled={myPhotosLoading}
              hitSlop={10}
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: 'rgba(255,255,255,0.12)',
                alignItems: 'center', justifyContent: 'center',
                opacity: myPhotosLoading ? 0.5 : 1,
              }}
              accessibilityLabel="Rafraîchir"
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
          </View>

          {myPhotosLoading && myPhotos.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : myPhotosError && myPhotos.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', marginBottom: 14 }}>
                Impossible de charger tes photos pour l'instant.
              </Text>
              <TouchableOpacity
                onPress={fetchMyPhotos}
                style={{ backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          ) : myPhotos.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                Aucune photo encore.{'\n'}Les photos que tu prends apparaissent ici dès qu'elles sont sauvegardées.
              </Text>
            </View>
          ) : (
            <FlatList
              data={myPhotos.slice(0, 60)}
              keyExtractor={(item) => item.key}
              numColumns={3}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => setGalleryViewerPhoto(item)}
                  activeOpacity={0.85}
                  style={{ width: '33.333%', aspectRatio: 1, padding: 2 }}
                >
                  <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1a1a1a' }}>
                    <ExpoImage
                      source={{ uri: item.thumb_url }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      priority="low"
                      transition={100}
                      recyclingKey={item.key}
                    />
                  </View>
                </TouchableOpacity>
              )}
              refreshControl={
                <RefreshControl
                  refreshing={myPhotosLoading}
                  onRefresh={fetchMyPhotos}
                  tintColor="#fff"
                />
              }
              contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
              initialNumToRender={12}
              maxToRenderPerBatch={9}
              windowSize={5}
            />
          )}
        </View>
      </Modal>

      {/* ─── Viewer fullscreen ─── ouvert quand on tape une vignette de la
          sheet. Tap n'importe ou (ou X) pour fermer. Source : photo.url
          (pleine resolution via /photo-jpeg pour HEIC). */}
      <Modal
        visible={!!galleryViewerPhoto}
        transparent
        animationType="fade"
        onRequestClose={() => setGalleryViewerPhoto(null)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setGalleryViewerPhoto(null)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            {galleryViewerPhoto && (
              <ExpoImage
                source={{ uri: galleryViewerPhoto.url }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={200}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setGalleryViewerPhoto(null)}
            hitSlop={10}
            style={{
              position: 'absolute', top: 54, right: 16,
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(0,0,0,0.55)',
              alignItems: 'center', justifyContent: 'center',
            }}
            accessibilityLabel="Fermer"
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}


const formSectionStyle = StyleSheet.create({
  // Audit UI : titres de sections en violet charte 100% (retour user create event).
  heading: { fontSize: 13, fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  // Sous-titres explicateurs en violet plus fonce que C.textSoft (rgba 30%
  // = trop pale). #5E1AD6 deja utilise pour le texte "Will recherche...".
  subheading: { fontSize: 12, color: '#5E1AD6', marginBottom: 8, lineHeight: 17 },
  input: { backgroundColor: '#faf9ff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, marginBottom: 8 },
});

// Modal de cadrage 2:1 custom (la card mobile est 4:1 mais l'image occupe la
// moitié droite seulement, soit 2:1). iOS ignore aspect:[2,1] dans son cropper
// natif, donc on affiche l'image complète avec un cadre 2:1 superposé que
// l'utilisateur positionne via pan + pinch gestures, puis on crop via
// expo-image-manipulator.

// Sous-modale slide-up reutilisable pour editer 1 champ texte (nom, email,
// telephone, site web). Auto-focus a l'ouverture, KeyboardAvoidingView pour
// que le bouton Enregistrer reste visible. Save par section via onSave.

// PIN helpers + PinInputRow + PinDisplay -> src/utils/pin.js, src/components/Pin*


function CreateEventModal({ visible, onClose, onCreated, organizerSession, organizerApiFetch, editEvent }) {
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
  // Audit B12b / UI-10 — geo.api.gouv.fr KO/timeout/sans match -> fallback saisie manuelle.
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
  const [eventType, setEventType] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  // UI-12 : contact administratif separe du contact public. Pre-rempli avec
  // l email de login orga (pattern existant) mais editable independamment.
  const [contactAdmin, setContactAdmin] = useState('');
  const [phone, setPhone] = useState('');
  // distances : [{ label, label_only, km, time, elevation }].
  // Mode Type (label_only=false) : label = event_type, affichage final
  // `${label} ${km} km`. Mode Nom (label_only=true) : label libre,
  // affichage = label seul (sans km).
  const [distances, setDistances] = useState([]);
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
        setContactAdmin(editEvent.contact_admin || editEvent.organizer_email || organizerSession?.profile?.email || '');
        setPhone(editEvent.phone || '');
        setDistances(Array.isArray(editEvent.distances) ? editEvent.distances.map(d => ({
          label: d.label || '',
          label_only: d.label_only === true,
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
        setWebsite(''); setContact(organizerSession?.profile?.email || ''); setContactAdmin(organizerSession?.profile?.email || ''); setPhone(''); setDistances([]);
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
    if (email && !contactAdmin) setContactAdmin(email);
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

  // Suggestions de villes selon code postal (pattern B12b - UI-10)
  useEffect(() => {
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      setCityFetchFailed(false);
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    ctl.timedOut = false;
    const timeoutId = setTimeout(() => { ctl.timedOut = true; ctl.abort(); }, 3000);
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`, { signal: ctl.signal });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        setCityFetchFailed(cities.length === 0);
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch (e) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (e?.name === 'AbortError' && !ctl.timedOut) return; // cleanup useEffect, pas vraie erreur
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
  }, [postalCode]);

  const addDistance = () => setDistances(d => [...d, { label: eventType || '', label_only: false, km: '', time: '', elevation: '' }]);
  const setDistanceMode = (idx, labelOnly) => {
    setDistances(d => d.map((it, i) => {
      if (i !== idx) return it;
      let nextLabel = it.label;
      if (!labelOnly && !nextLabel) nextLabel = eventType || '';
      if (labelOnly && nextLabel === eventType) nextLabel = '';
      return { ...it, label_only: labelOnly, label: nextLabel };
    }));
  };
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
        const up = await organizerApiFetch(`/organizer/cover/${editEvent.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
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

  const emailPublicFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contact || '').trim());
  const emailAdminFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contactAdmin || '').trim());
  // UI-12 v2 (decision user 2026-06-04) : contact public = au moins UNE des
  // 3 infos (email valide, telephone non vide, site web non vide). Aucune
  // n est individuellement obligatoire.
  const hasPublicContact = (contact?.trim() && emailPublicFormat) || !!phone?.trim() || !!website?.trim();
  // emailOk : utilise dans l affichage erreur en bas du form (le seul cas
  // ou on affiche "Email invalide" est si le user a tape un email public
  // mal forme — un email vide est OK puisqu il y a tel/web possible).
  const emailOk = !contact?.trim() || emailPublicFormat;
  const locationOk = /^\d{5}$/.test(postalCode) && !!city?.trim();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const dateOk = !!eventDate && eventDate >= todayMidnight;
  // Distances optionnelles : un event peut être créé sans aucune course (event
  // type "course non chronométrée", marche libre, etc.). Si l'orga ajoute des
  // courses, chacune doit avoir un km > 0 pour rester cohérente.
  const distancesOk = distances.length === 0 || distances.every(d => parseFloat(d.km) > 0);
  const step1Ok = !!name?.trim() && !!eventType && dateOk;
  const step2Ok = locationOk && distancesOk;
  // Step 3 : contact admin valide ET au moins un contact public (email valide,
  // telephone, ou site web). + code event en creation.
  const step3Ok = emailAdminFormat && emailOk && hasPublicContact && (isEdit || !!code?.trim());
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
  const errStyle = { color: C.error, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const url = isEdit ? `/organizer/event/${editEvent.code}` : `/auth/submit-event`;
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        name,
        contact,
        contact_admin: contactAdmin.trim().toLowerCase(), // UI-12
        phone: phone.trim(),
        event_date: eventDate ? eventDate.toISOString().slice(0, 10) : '',
        event_date_end: eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : '',
        location: city ? `${city} (${postalCode})` : '',
        event_type: eventType,
        website,
        distances: distances
          .filter(d => d.km)
          .map(d => ({
            label: (d.label || '').trim().slice(0, 40),
            label_only: !!d.label_only,
            km: parseFloat(d.km) || 0,
            time: d.time || '',
            elevation: d.elevation || '',
          })),
      };
      if (!isEdit) {
        payload.code = code;
        payload.password = password;
      }
      // Audit B14b — O2 : /auth/submit-event peut etre appele sans organizerSession
      // (cf handlePickRole role='create'). apiFetch direct sans onAuthFailure,
      // Bearer conditionnel. Le 401 propage comme erreur HTTP normale.
      const r = await apiFetch(url, {
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
            // Audit B14b — O3 : post-submit cover upload. Si le submit etait
            // anonyme (cf O2), organizerSession peut etre null. apiFetch direct
            // + Bearer conditionnel.
            const up = await apiFetch(`/organizer/cover/${slug}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
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
      color: 'rgba(123,47,255,0.3)', fontSize: 13, fontWeight: '700',
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
      height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(123,47,255,0.3)', marginLeft: 16,
    };
    const subModalHeader = {
      paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(123,47,255,0.3)',
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
      : distances.map(d => d.km ? raceTitle(d) : '?').join(', ');

    // PUT partiel : met a jour uniquement les champs presents dans `patch`.
    const savePartial = async (patch) => {
      if (!editEvent?.code) return false;
      setPartialBusy(true);
      try {
        const r = await organizerApiFetch(`/organizer/event/${editEvent.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
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
          <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 14, marginRight: 8, maxWidth: 140 }} numberOfLines={1}>
            {value || '—'}
          </Text>
          <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 18, fontWeight: '300' }}>›</Text>
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
                {cityFetchFailed && (
                  <Text style={{ color: C.textSoft, fontSize: 12, marginHorizontal: 32, marginBottom: 6 }}>
                    Recherche de villes indisponible. Saisis ta ville manuellement.
                  </Text>
                )}
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
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                      <TouchableOpacity onPress={() => setDistanceMode(idx, false)} style={modeChipStyleApp(!d.label_only)}>
                        <Text style={modeChipTextStyleApp(!d.label_only)}>Type d'épreuve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setDistanceMode(idx, true)} style={modeChipStyleApp(!!d.label_only)}>
                        <Text style={modeChipTextStyleApp(!!d.label_only)}>Nom personnalisé</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ marginBottom: 8 }}>
                      <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>{d.label_only ? 'NOM' : 'TYPE'}</Text>
                      <TextInput
                        value={d.label}
                        onChangeText={(v) => updateDistance(idx, 'label', v.slice(0, 40))}
                        placeholder={d.label_only ? 'Nom de la course' : (eventType || 'Type')}
                        placeholderTextColor="rgba(123,47,255,0.3)"
                        maxLength={40}
                        style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', paddingHorizontal: 12, color: C.text, fontSize: 14 }}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DISTANCE</Text>
                        <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.km ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.km ? `${d.km} km` : '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉPART</Text>
                        <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.time ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.time || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1.2 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉNIVELÉ</Text>
                        <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.elevation ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.elevation || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 8 }}>
                      <Text style={{ color: C.error, fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
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
                      label: (d.label || '').trim().slice(0, 40),
                      label_only: !!d.label_only,
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
                        <TouchableOpacity key={t} onPress={() => setEventType(t)} style={[s.typePill, eventType === t && { backgroundColor: colorForType(t) }]}>
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
                    {cityFetchFailed && !city && (
                      <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 8, marginLeft: 4 }}>
                        Recherche de villes indisponible. Saisis ta ville manuellement.
                      </Text>
                    )}
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
                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                          <TouchableOpacity onPress={() => setDistanceMode(idx, false)} style={modeChipStyleApp(!d.label_only)}>
                            <Text style={modeChipTextStyleApp(!d.label_only)}>Type d'épreuve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setDistanceMode(idx, true)} style={modeChipStyleApp(!!d.label_only)}>
                            <Text style={modeChipTextStyleApp(!!d.label_only)}>Nom personnalisé</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={{ marginBottom: 8 }}>
                          <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>{d.label_only ? 'NOM' : 'TYPE'}</Text>
                          <TextInput
                            value={d.label}
                            onChangeText={(v) => updateDistance(idx, 'label', v.slice(0, 40))}
                            placeholder={d.label_only ? 'Nom de la course' : (eventType || 'Type')}
                            placeholderTextColor={C.textSoft}
                            maxLength={40}
                            style={[formSectionStyle.input, { marginBottom: 0 }]}
                          />
                        </View>
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
                          <Text style={{ color: C.error, fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
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

                {/* ===== STEP 3 : Contact (UI-12 : 2 sections admin/public) ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Contact administratif</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 11, marginTop: -8, marginBottom: 8, marginLeft: 4, lineHeight: 16 }]}>
                      Email interne pour la validation de ton event et les messages d'admin Will. NON affiché publiquement.
                    </Text>
                    <TextInput placeholder="Email administratif *" placeholderTextColor={C.textSoft} value={contactAdmin} onChangeText={setContactAdmin} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    {showErr[3] && !emailAdminFormat && <Text style={errStyle}>Email administratif invalide</Text>}

                    <Text style={[formSectionStyle.heading, { marginTop: 12 }]}>Contact public</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 11, marginTop: -8, marginBottom: 8, marginLeft: 4, lineHeight: 16 }]}>
                      Au moins UNE info parmi email, téléphone et site web. Affichées sur la page publique de ton événement.
                    </Text>
                    <TextInput placeholder="Email de contact public" placeholderTextColor={C.textSoft} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    {showErr[3] && contact?.trim() && !emailPublicFormat && <Text style={errStyle}>Email public invalide</Text>}
                    <TextInput placeholder="Téléphone" placeholderTextColor={C.textSoft} value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={formSectionStyle.input} />
                    <TextInput placeholder="Site web" placeholderTextColor={C.textSoft} value={website} onChangeText={setWebsite} autoCapitalize="none" style={formSectionStyle.input} />
                    {showErr[3] && !hasPublicContact && <Text style={errStyle}>Renseigne au moins une info de contact public.</Text>}
                  </ScrollView>
                </View>

                {/* ===== STEP 4 : Code PIN photographe ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Code PIN photographe</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 13, marginBottom: 22, marginLeft: 4, lineHeight: 18 }]}>
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
  // Audit B13 : meme pattern que PhotographerScreen pour gerer le cas
  // permission deja denied de facon permanente cote iOS.
  const [hasRequestedCameraPermission, setHasRequestedCameraPermission] = useState(false);
  const cameraPermissionDenied = hasRequestedCameraPermission && !hasPermission;
  const requestCameraPermission = async () => {
    setHasRequestedCameraPermission(true);
    await requestPermission();
  };

  useEffect(() => {
    if (visible && !hasPermission) {
      setHasRequestedCameraPermission(true);
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
                : cameraPermissionDenied
                  ? "L'accès à la caméra a été refusé. Ouvre les réglages pour l'autoriser."
                  : "Will a besoin d'accéder à la caméra pour prendre ton selfie."}
            </Text>
            {!hasPermission && (
              <TouchableOpacity
                onPress={cameraPermissionDenied ? () => Linking.openSettings() : requestCameraPermission}
                style={s.btnPrimary}
              >
                <Text style={s.btnPrimaryText}>
                  {cameraPermissionDenied ? 'Ouvrir les réglages' : 'Autoriser'}
                </Text>
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

function SelfieModal({ visible, onClose, onSaved, userId, signupMode = false, onSkip }) {
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
    // Reset uri local a louverture : le component SelfieModal reste monte
    // entre les ouvertures (Modal cache != unmount). Sans ce reset, apres
    // une suppression de selfie suivie de la reouverture du modal, le state
    // uri local garde lancienne photo et la preview montre lancien selfie.
    setUri(null);
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
      // Audit B14a followup : await onSaved pour attendre la confirmation
      // R2 cote App avant de fermer la modal. Sinon le pendingFollow relance
      // toggleFollow alors que le PUT R2 n est pas encore propage serveur,
      // worker repond selfie_required, et la SelfieModal se rouvre.
      await onSaved?.(uri);
      onClose();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
      <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
      <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>

          {consentGiven === false ? (
            <>
              <Text style={s.modalTitle}>Reconnaissance faciale</Text>
              <Text style={[s.modalSub, { textAlign: 'left', lineHeight: 20 }]}>
                Pour t'envoyer automatiquement tes photos d'event, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées, stockées sur des serveurs européens (eu-west-1 Francfort).{'\n\n'}
                Ton consentement est valable <Text style={{ fontWeight: '700' }}>12 mois renouvelables</Text>. Tu recevras un rappel à J-30 et J-7 avant l'échéance. Sans renouvellement, ton selfie est automatiquement supprimé.{'\n\n'}
                Tu peux retirer ton consentement à tout moment depuis ton profil.
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
                  J'accepte le traitement biométrique de mon image (RGPD art. 9) pour la reconnaissance faciale sur les events Will, pendant 12 mois renouvelables.
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
              ? "Will reconnaîtra ton visage sur les photos des events Will. Image chiffrée, serveurs européens. Consentement valable 12 mois renouvelables."
              : "Ton selfie est utilisé pour la reconnaissance faciale sur tous les events Will. Chiffré, serveurs européens. Consentement valable 12 mois renouvelables."}
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

// Hook commun pour les bottom sheets auth : slide-in spring au visible
// + drag-to-dismiss avec PanResponder sur la handle (tap = close,
// drag > 120px OU velocite > 0.5 = close en anim, sinon snap back).
function useDismissibleSheet(visible, onClose) {
  const sheetTranslate = useRef(new Animated.Value(1000)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      sheetTranslate.setValue(1000);
      Animated.spring(sheetTranslate, {
        toValue: 0, useNativeDriver: true,
        friction: 11, tension: 80,
      }).start();
    }
  }, [visible]);

  const handlePanHandlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetTranslate.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        const tap = Math.abs(g.dy) < 5 && Math.abs(g.dx) < 5;
        if (tap) {
          onCloseRef.current?.();
          return;
        }
        const shouldClose = g.dy > 120 || g.vy > 0.5;
        if (shouldClose) {
          Animated.timing(sheetTranslate, {
            toValue: 1000, duration: 220, useNativeDriver: true,
          }).start(() => onCloseRef.current?.());
        } else {
          Animated.spring(sheetTranslate, {
            toValue: 0, useNativeDriver: true, friction: 11, tension: 80,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetTranslate, {
          toValue: 0, useNativeDriver: true, friction: 11, tension: 80,
        }).start();
      },
    })
  ).current.panHandlers;

  return { sheetTranslate, handlePanHandlers };
}

function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Sheet slide-in + drag-to-dismiss via hook commun.
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);
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

  // Tri ASC strict (decision user 2026-06-04, toutes les listes d'events).
  const upcoming = events
    .filter(e => isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          {/* Backdrop : iOS systemThinMaterialDark (givre frostal natif,
              plus leger qu'un Gaussian blur dense). Fade-in herite du
              animationType="fade" du Modal. */}
          <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
          <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
            <Animated.View style={{ transform: [{ translateY: sheetTranslate }] }}>
            <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
              <View {...handlePanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                <View style={s.modalHandle} />
              </View>
              <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                {role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}
              </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
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
                        autoFocus={false}
                        useNumpad
                        error={!!pinError}
                        onComplete={(full) => {
                          if (rateLimited) return;
                          doLogin(full);
                        }}
                      />
                      {pinError ? (
                        <Text style={{ color: C.error, fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: '500' }}>
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
                    backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14,
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
            ) : role === 'photographer' ? null : (
              // Pour le photographe, le PIN auto-submit via onComplete a 4
              // chiffres : le bouton Continuer est redondant. On le garde
              // uniquement pour l organisateur (email + mot de passe).
              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code || !password}
                style={{
                  backgroundColor: (code && password) ? C.pinkPill : '#e9e4f9',
                  paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
                }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: (code && password) ? '#fff' : C.textSoft, fontSize: 15, fontWeight: '700' }}>Continuer</Text>}
              </TouchableOpacity>
            )}
            </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}


// ---------- ROOT ----------
function ProfileMenuModal({ visible, onClose, selfieUri, onView, onRetake, onDelete, runnerSession, runnerApiFetch, onLogout, onUpdateProfile, onDeleteAccount, onDeleteFaceData, uploadState = 'idle', onRetryUpload }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  // Audit B12b — geo.api.gouv.fr KO/timeout/sans match -> fallback saisie manuelle.
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
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
      const r = await runnerApiFetch(`/runner/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setCityFetchFailed(false);
      return;
    }
    let cancelled = false;
    // Audit B12b — meme pattern que vitrine B12a : ctl.timedOut porte sur
    // le controller pour distinguer abort par timeout d abort par cleanup
    // useEffect, scope-local immune a la pollution si deux fetches en vol.
    const ctl = new AbortController();
    ctl.timedOut = false;
    const timeoutId = setTimeout(() => { ctl.timedOut = true; ctl.abort(); }, 3000);
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`, { signal: ctl.signal });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        setCityFetchFailed(cities.length === 0);
      } catch (e) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (e?.name === 'AbortError' && !ctl.timedOut) return; // cleanup useEffect
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
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
        {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
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
            ) : null}

            {/* Bloc Selfie */}
            {profile && (
              <View style={profileCardStyles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={onRetake}
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
                    <TouchableOpacity onPress={onRetake}>
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Ajouter</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ alignItems: 'flex-end' }}>
                      <View style={{ flexDirection: 'row', gap: 18 }}>
                        <TouchableOpacity onPress={onView}>
                          <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Voir</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onDelete}>
                          <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Supprimer</Text>
                        </TouchableOpacity>
                      </View>
                      {uploadState === 'failed' && (
                        // Audit B15 fix : Reessayer affiche EN PLUS de Voir/Supprimer
                        // (pas a la place) pour ne pas bloquer le user dans le cycle
                        // failed -> retry failed sans pouvoir reprendre un selfie propre.
                        <TouchableOpacity onPress={onRetryUpload} style={{ marginTop: 6 }}>
                          <Text style={{ color: C.error, fontWeight: '600', fontSize: 12 }}>
                            Échec envoi · Réessayer
                          </Text>
                        </TouchableOpacity>
                      )}
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
                {cityFetchFailed && !city && (
                  // Audit B12b — geo.api KO ou pas de match : saisie manuelle.
                  <View style={{ marginBottom: 10 }}>
                    <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 4 }}>
                      Recherche de villes indisponible. Saisis ta ville manuellement.
                    </Text>
                    <TextInput
                      placeholder="Ta ville"
                      placeholderTextColor={C.textSoft}
                      value={city}
                      onChangeText={setCity}
                      autoCapitalize="words"
                      style={authStyles.input}
                    />
                  </View>
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
                <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
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


function OrganizerProfileMenuModal({ visible, onClose, organizerSession, organizerApiFetch, onLogout, onUpdate, onDeleteAccount }) {
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
      const r = await organizerApiFetch(`/organizer/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
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
                  <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
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


// Haptics -> src/services/haptics.js (importe en haut du fichier)

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
  photosForSale = false, eventCode = null,
}) {
  const [busy, setBusy] = useState(false);
  const winWidth = Dimensions.get('window').width;
  const winHeight = Dimensions.get('window').height;

  // Index cible calcule synchroniquement depuis les props. Sert a initialiser
  // currentIndex ET la FlatList au mount avec la bonne position.
  const targetIndex = React.useMemo(() => {
    if (!photo || !photos) return 0;
    const i = photos.findIndex(p => p.id === photo.id);
    return i >= 0 ? i : 0;
  }, [photo, photos]);
  // Lazy init : currentIndex demarre directement sur targetIndex (pas 0).
  // Sinon le 1er render utilise photos[0] qui peut avoir un etat favori
  // different -> le coeur clignote en "favori" avant que useEffect re-sync.
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (!photo || !photos) return 0;
    const i = photos.findIndex(p => p.id === photo.id);
    return i >= 0 ? i : 0;
  });

  // Compteur de session bumpe a chaque ouverture (visible false->true). Sert
  // de key sur la FlatList pour forcer un remount et donc appliquer
  // initialScrollIndex={targetIndex} AU 1er paint de la nouvelle session.
  // Sans ca, la FlatList -- montee a vie au root App -- conserve son scroll
  // offset entre deux ouvertures et flashe l'ancienne photo le temps que
  // scrollToOffset rattrape.
  const prevVisibleRef = useRef(false);
  const sessionKeyRef = useRef(0);
  if (visible && !prevVisibleRef.current) {
    sessionKeyRef.current += 1;
    // Re-sync currentIndex sur targetIndex DURANT le render (pas en useEffect).
    // Sinon le 1er render apres reouverture lit photos[ancien currentIndex] et
    // affiche le fav state de la photo precedente le temps que useEffect rattrape.
    if (currentIndex !== targetIndex) setCurrentIndex(targetIndex);
  }
  prevVisibleRef.current = visible;

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
  // Aspect ratio reel par photo (width/height), mesure via ExpoImage onLoad.
  // Permet d adapter le wrapper a la photo (= radius visible sur la photo,
  // etoile fav anchored au coin photo et non au wrapper 3:4).
  const [aspectMap, setAspectMap] = useState({});
  const setPhotoAspect = useCallback((id, w, h) => {
    if (!id || !w || !h) return;
    setAspectMap((m) => (m[id] ? m : { ...m, [id]: w / h }));
  }, []);
  const effectiveHidden = (p) => {
    if (!p) return false;
    const ov = localHiddenMap[p.id];
    return ov === undefined ? p.hidden === true : ov;
  };

  // Watermark events payants : gate l opacite de la photo tant que le PNG
  // overlay n est pas paint, sinon le coureur peut screenshot la photo CLEAN
  // pendant le delai entre photo load (rapide, cache memoire) et watermark
  // load. L asset est bundle local (require) -> normalement instant ; on
  // garde une safety net 600ms si onLoad ne tire pas.
  const [wmReady, setWmReady] = useState(!photosForSale);
  useEffect(() => {
    if (!photosForSale || wmReady) return;
    const t = setTimeout(() => setWmReady(true), 600);
    return () => clearTimeout(t);
  }, [photosForSale, wmReady]);

  // Panier (stub AsyncStorage, MVP avant Stripe — mirror website event/index.html).
  // Cle par event : `will:cart:{eventCode}`, valeur = JSON array de photo.id
  // (qui vaut le R2 key cote mobile, cf line 1750/2738). Hook useCart partage
  // via cartChangeListeners (module scope) -> sync auto avec EventDetailScreen.
  const { cart, toggle: toggleCartFor } = useCart(photosForSale ? eventCode : null);

  // Layout cible (hauteurs fixes pour calcul de la zone photo)
  const HEADER_H = 56;          // titre + date
  const SLIDER_H = 0;           // slider supprime ; constante conservee pour les autres refs
  const BUTTON_AREA_H = 78;     // bouton + paddings (mode orga uniquement)
  // Mode runner : pas de zone reservee pour le CTA puisqu il chevauche le
  // bas de la photo. Just bottom safe-area + 32 (marge sous le CTA qui
  // depasse) pour matcher le viewer web mobile (.vstage bottom: env+32).
  const RUNNER_BOTTOM_RESERVE = 32;
  const photoMargin = 8;        // marge G/D autour de la photo principale (resserree)
  const targetX = photoMargin;
  const targetW = winWidth - photoMargin * 2;
  const effectiveBottomReserve = isOrga ? BUTTON_AREA_H : RUNNER_BOTTOM_RESERVE;
  // targetH ajuste au ratio 3:4 (portrait iPhone, standard des photos
  // d event). Container photo cale sur l aspect de l image -> plus de
  // letterboxing en haut/bas. Cap a maxCardH si l ideal depasse l espace
  // dispo (photos paysage ou ecran etroit).
  const PHOTO_ASPECT = 3 / 4;   // width / height = portrait iPhone
  const idealCardH = Math.round(targetW / PHOTO_ASPECT);
  const maxCardH = winHeight - topPad - HEADER_H - effectiveBottomReserve - bottomPad - 8;
  const targetH = Math.min(idealCardH, maxCardH);
  // Centre verticalement quand idealCardH < maxCardH (marge libre).
  const targetY = topPad + HEADER_H + Math.max(0, (maxCardH - targetH) / 2);

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

  // Easing worklet pour transitions hero. Quartic ease-out (1-pow(1-t,4))
  // -> demarrage plus doux, fin plus posee qu un cubic. 420ms en ouverture
  // pour laisser respirer la zoom-in ; close synchro a 380ms (cf.
  // animateOutAndClose). Worklet pour invocation UI thread Reanimated.
  const HERO_DURATION = 420;
  const HERO_EASING = (t) => {
    'worklet';
    return 1 - Math.pow(1 - t, 4);
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
  // 380ms (vs 280ms avant) + quartic easing -> sortie plus posee, moins
  // brusque, raccord avec l ouverture qui est elle a 420ms.
  const animateOutAndClose = () => {
    uiOpacity.value = withTiming(0, { duration: 220, easing: HERO_EASING });
    bgOpacity.value = withTiming(0, { duration: 340, easing: HERO_EASING });
    if (origin && Number.isFinite(origin.x)) {
      const originCx = origin.x + origin.w / 2;
      const originCy = origin.y + origin.h / 2;
      entryTx.value = withTiming(originCx - targetCardCx, { duration: 380, easing: HERO_EASING });
      entryTy.value = withTiming(originCy - targetCardCy, { duration: 380, easing: HERO_EASING });
      pradius.value = withTiming(10, { duration: 380, easing: HERO_EASING });
      entryScale.value = withTiming(origin.w / cardW, { duration: 380, easing: HERO_EASING }, (finished) => {
        if (finished) runOnJS(onClose)();
      });
    } else {
      setTimeout(onClose, 340);
    }
  };

  // À chaque ouverture du viewer : sync index, reset transforms, anim d'entree.
  // targetIndex est calcule depuis les props (utile aussi si on ouvre une autre
  // photo sans repasser par visible=false).
  useEffect(() => {
    if (!visible) return;
    setCurrentIndex(targetIndex);
    resetTransforms();
    setLocalHiddenMap({});
    animateIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetIndex]);

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

  // Slider supprime : sync = photoList uniquement. Sur changement externe
  // (open viewer / programmatic), on scroll-snap a currentIndex. Sur swipe
  // utilisateur sur la photo principale (sourceRef='photo'), on NE sync PAS
  // pour eviter qu un onMomentumScrollEnd stale re-write currentIndex.
  const sourceRef = useRef(null);
  useEffect(() => {
    if (!photos || currentIndex < 0 || currentIndex >= photos.length) return;
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source !== 'photo') {
      try { photoListRef.current?.scrollToOffset({ offset: currentIndex * cardW, animated: false }); }
      catch {}
    }
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

  // Progressive loading : precharge un voisinage de +/-3 photos pour que
  // les swipes Tinder ET les sauts via slider (plusieurs miniatures d un
  // coup) enchainent sans flash. Avant : seulement +/-1 -> tout saut de
  // plus de 1 cran via slider causait un decode jit + flicker visible.
  useEffect(() => {
    if (!photos) return;
    const urls = [];
    for (let d = -3; d <= 3; d++) {
      if (d === 0) continue;
      const p = photos[currentIndex + d];
      if (p?.uri) urls.push(p.uri);
    }
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
        {visible ? (
        <View style={{ flex: 1 }}>
          {/* Fond givre blanc (glassmorphism). BlurView pour flouter la
              galerie sous-jacente + voile blanc translucide par-dessus.
              bgStyle anime l opacite au mount / unmount. */}
          <ReAnimated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, bgStyle]}
          >
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFillObject} />
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(255,255,255,0.65)' }]} />
          </ReAnimated.View>

          {/* Header : titre event + date positionnes a 16px au-dessus du
              bord superieur de l image. Clamp avec topPad pour ne pas sortir
              de l ecran sur petits devices / grosses photos. */}
          <ReAnimated.View
            pointerEvents="none"
            style={[{
              position: 'absolute',
              top: Math.max(topPad, targetY - 16 - HEADER_H),
              left: 0, right: 0, height: HEADER_H,
              alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
            }, uiStyle]}
          >
            {eventTitle ? (
              <Text numberOfLines={1} style={{
                color: C.primary,
                fontFamily: 'AVEstiana',
                fontSize: 22,
                letterSpacing: -0.2,
                lineHeight: 24,
              }}>
                {eventTitle}
              </Text>
            ) : null}
            {eventDate ? (
              <Text style={{
                color: '#000',
                fontFamily: 'Montserrat',
                fontSize: 12,
                fontWeight: '500',
                marginTop: 4,
                textTransform: 'none',
              }}>{eventDate}</Text>
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
                  key={`viewer-list-${sessionKeyRef.current}`}
                  ref={photoListRef}
                  data={photos}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  initialScrollIndex={targetIndex}
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
                      sourceRef.current = 'photo';
                      setCurrentIndex(idx);
                    }
                  }}
                  renderItem={({ item }) => {
                    // Wrapper de la photo : aspect-ratio EXACT de la photo
                    // mesuree (via onLoad). Le wrapper se centre dans le
                    // card (cardW x cardH) et la photo le remplit pile
                    // -> radius 18 visible sur la photo, etoile fav (ci-
                    // dessous) anchored au coin haut-droit de la photo.
                    // Default PHOTO_ASPECT (3:4) avant chargement.
                    const aspect = aspectMap[item.id] || PHOTO_ASPECT;
                    return (
                      <View style={{
                        width: cardW, height: cardH,
                        paddingHorizontal: photoMargin,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ReAnimated.View style={[{
                          aspectRatio: aspect,
                          maxWidth: '100%', maxHeight: '100%',
                          overflow: 'hidden',
                          borderRadius: 18,
                          backgroundColor: 'transparent',
                        }, radiusStyle]}>
                          {item?.uri ? (
                            <ExpoImage
                              source={{ uri: item.uri }}
                              placeholder={{ uri: item.uri }}
                              style={[
                                { width: '100%', height: '100%' },
                                photosForSale && !wmReady ? { opacity: 0 } : null,
                              ]}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              priority="high"
                              transition={0}
                              recyclingKey={item.id}
                              onLoad={(e) => {
                                const w = e?.source?.width;
                                const h = e?.source?.height;
                                if (w && h) setPhotoAspect(item.id, w, h);
                              }}
                            />
                          ) : null}
                          {/* Watermark dissuasif sur events payants : overlay
                              client only, l image servie est propre. tintColor
                              re-colorize le PNG en blanc plein. Asset BUNDLE
                              local (require) -> rendu instant, evite la fenetre
                              screenshot. onLoad lifte le gate wmReady -> rend
                              la photo visible. */}
                          {photosForSale && item?.uri ? (
                            <ExpoImage
                              source={require('./assets/watermark-cover.png')}
                              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 }}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              pointerEvents="none"
                              transition={0}
                              tintColor="#fff"
                              onLoad={() => { if (!wmReady) setWmReady(true); }}
                            />
                          ) : null}
                          {/* Etoile fav DANS le wrapper photo : ancrage strict
                              au coin haut-droit, pas de drift au swipe entre
                              photos d aspects differents. uiStyle anime le
                              fade-in apres le shared-element. */}
                          {isRunner && item?.id ? (
                            <ReAnimated.View
                              pointerEvents="box-none"
                              style={[{ position: 'absolute', top: 12, right: 12 }, uiStyle]}
                            >
                              <ReAnimated.View style={heartStyle}>
                                <TouchableOpacity
                                  onPress={() => {
                                    heartScale.value = withTiming(0.85, { duration: 90 }, () => {
                                      heartScale.value = withTiming(1, { duration: 140 });
                                    });
                                    onTogglePhotoFavorite(item.id);
                                  }}
                                  hitSlop={12}
                                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
                                  accessibilityLabel={(photoFavoritesSet?.has(item.id)) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                                >
                                  <FavStar
                                    size={24}
                                    fill={photoFavoritesSet?.has(item.id) ? '#fff' : 'none'}
                                    stroke="#fff"
                                    strokeWidth={1.4}
                                    style={iconShadowWhiteStyle}
                                  />
                                </TouchableOpacity>
                              </ReAnimated.View>
                            </ReAnimated.View>
                          ) : null}
                        </ReAnimated.View>
                      </View>
                    );
                  }}
                />
              </ReAnimated.View>
            </GestureDetector>

            {/* Etoile favori : maintenant integree dans le renderItem
                (cf. wrapper photo ci-dessus). Pas de overlay externe. */}
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

          {/* Slider supprime 2026-06-02 : bug recurrent de retour stale sur
              la derniere photo slidee, malgre les tentatives de sync via
              sourceRef + sync synchrone. Navigation entre photos = uniquement
              swipe horizontal sur la grande photo (FlatList pagingEnabled
              native, sans aucun sync croise -> pas de race possible). */}

          {/* Bouton bas : Telecharger (coureur) OU Publier/Masquer (orga). */}
          {isOrga ? (
            <ReAnimated.View
              style={[{
                position: 'absolute', left: 0, right: 0, bottom: bottomPad,
                height: BUTTON_AREA_H, paddingHorizontal: 24,
                alignItems: 'center', justifyContent: 'center',
              }, uiStyle]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
                <TouchableOpacity
                  onPress={handleToggleVisibility}
                  disabled={busy}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, paddingVertical: 14, borderRadius: 999,
                    backgroundColor: C.pinkPill,
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
            </ReAnimated.View>
          ) : photosForSale ? (
            // Event payant : CTA "Ajouter au panier" remplace "Telecharger".
            // Toggle local AsyncStorage (cf cart hooks plus haut), pas de
            // backend. Couleur verte quand la photo est deja au panier ;
            // label affiche le total entre parentheses si non vide.
            (() => {
              const inCart = !!currentPhoto?.id && cart.includes(currentPhoto.id);
              const total = cart.length;
              const suffix = total > 0 ? ` (${total})` : '';
              return (
                <ReAnimated.View
                  style={[{
                    position: 'absolute', left: 0, right: 0,
                    top: targetY + cardH - 23,
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 30,
                  }, uiStyle]}
                  pointerEvents="box-none"
                >
                  <TouchableOpacity
                    onPress={() => { if (currentPhoto?.id) toggleCartFor(currentPhoto.id); }}
                    activeOpacity={0.85}
                    style={{
                      paddingVertical: 12, paddingHorizontal: 28, borderRadius: 999,
                      backgroundColor: inCart ? '#16A34A' : '#7B2FFF',
                      alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'row', gap: 8,
                      minWidth: 220,
                      shadowColor: inCart ? '#16A34A' : '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
                      elevation: 6,
                    }}
                    accessibilityLabel={inCart ? 'Retirer du panier' : 'Ajouter au panier'}
                  >
                    <Svg width={19} height={18} viewBox="0 0 18.96 17.61" fill="#fff">
                      <Path d="M9.49,9.19c-.38,0-.68.3-.68.68v3.38c0,.37.31.68.68.68s.68-.3.68-.68v-3.38c0-.37-.31-.68-.68-.68Z" />
                      <Path d="M12.94,9.23c-.37-.06-.73.18-.79.55l-.59,3.33c-.07.37.18.72.55.78.37.06.73-.18.79-.55l.59-3.33c.07-.37-.18-.72-.55-.78Z" />
                      <Path d="M6.04,9.23c-.37.06-.62.42-.55.78l.59,3.33c.07.37.42.61.79.55.37-.06.62-.42.55-.78l-.59-3.33c-.07-.37-.42-.61-.79-.55Z" />
                      <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
                    </Svg>
                    <Text style={{ color: '#fff', fontFamily: 'Montserrat', fontSize: 14, fontWeight: '600' }}>
                      {inCart ? `Dans le panier${suffix}` : `Ajouter au panier${suffix}`}
                    </Text>
                  </TouchableOpacity>
                </ReAnimated.View>
              );
            })()
          ) : (
            // Mode coureur : CTA Telecharger positionne par rapport au container
            // photo (top: targetY + cardH - 23 = pile sur le bord bas avec 50%
            // qui depasse). Mirror site .vcta translate(-50%, 50%).
            <ReAnimated.View
              style={[{
                position: 'absolute', left: 0, right: 0,
                top: targetY + cardH - 23,
                alignItems: 'center', justifyContent: 'center',
                zIndex: 30,
              }, uiStyle]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                onPress={download}
                disabled={busy}
                activeOpacity={0.85}
                style={{
                  paddingVertical: 12, paddingHorizontal: 28, borderRadius: 999,
                  backgroundColor: '#7B2FFF',
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 8,
                  opacity: busy ? 0.65 : 1, minWidth: 200,
                  shadowColor: '#7B2FFF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
                  elevation: 6,
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
                    <Text style={{ color: '#fff', fontFamily: 'Montserrat', fontSize: 14, fontWeight: '600' }}>Télécharger</Text>
                  </>
                )}
              </TouchableOpacity>
            </ReAnimated.View>
          )}
        </View>
        ) : null}
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
  if (score <= 1) return { score: 1, label: 'Faible', color: C.error };
  if (score === 2) return { score: 2, label: 'Moyen', color: C.warning };
  if (score <= 4) return { score: 3, label: 'Fort', color: C.success };
  return { score: 4, label: 'Très fort', color: '#059669' };
}

function AuthRunnerModal({ visible, onClose, onSuccess, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot'
  const [forgotEmailSent, setForgotEmailSent] = useState(false); // B4 : success state apres POST /runner/forgot-password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  // Audit B12b — geo.api.gouv.fr KO/timeout/sans match -> fallback saisie manuelle.
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);

  // Pré-remplit l'email avec la dernière valeur connue à chaque ouverture.
  // Et resynchronise le mode (login/register) sur l'intention d'ouverture.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setForgotEmailSent(false); // B4 : reset state success a chaque ouverture
    AsyncStorage.getItem('@will_last_email_runner').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible, initialMode]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setPostalCode(''); setCity(''); setCitySuggestions([]);
    setError(''); setBusy(false); setForgotEmailSent(false);
  };

  const pwdStrength = passwordStrength(password);

  // Quand le code postal change → fetch les villes
  useEffect(() => {
    if (mode !== 'register') return;
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      setCityFetchFailed(false);
      return;
    }
    let cancelled = false;
    // Audit B12b — meme pattern que B12a/ProfileMenuModal : ctl.timedOut.
    const ctl = new AbortController();
    ctl.timedOut = false;
    const timeoutId = setTimeout(() => { ctl.timedOut = true; ctl.abort(); }, 3000);
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`, { signal: ctl.signal });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        setCityFetchFailed(cities.length === 0);
        // Auto-sélectionne si 1 seule ville pour ce code postal
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch (e) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (e?.name === 'AbortError' && !ctl.timedOut) return;
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
  }, [postalCode, mode]);

  const submit = async () => {
    setError('');
    // B4 : mode forgot = POST /runner/forgot-password. Worker retourne toujours
    // ok=true (anti-enumeration), on affiche toujours le message de succes.
    if (mode === 'forgot') {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError('Email invalide');
        return;
      }
      setBusy(true);
      try {
        await fetch(`${API_URL}/runner/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        });
        setForgotEmailSent(true);
      } catch (e) {
        setError('Connexion impossible. Verifie ton reseau.');
      } finally {
        setBusy(false);
      }
      return;
    }
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          {/* Backdrop : BlurView leger iOS (meme pattern que LoginModal +
              AuthOrganizerModal). Fade-in herite de animationType="fade". */}
          <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
          <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
            <Animated.View style={{ transform: [{ translateY: sheetTranslate }] }}>
              <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
                <View {...handlePanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                  <View style={s.modalHandle} />
                </View>
                {mode === 'register' && (
                  <Text style={{ color: C.textSoft, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', marginTop: 0, marginBottom: 4 }}>
                    Étape 1 sur 2
                  </Text>
                )}
                <Text style={[s.welcome, { color: C.primary, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                  {mode === 'login' ? 'Connexion' : mode === 'forgot' ? 'Mot de passe oublié' : 'Inscription'}
                </Text>
                <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
                  {mode === 'login' ? 'Connecte-toi à ton compte'
                    : mode === 'forgot' ? "On t'envoie un lien par email pour le réinitialiser."
                    : 'Crée ton compte coureur'}
                </Text>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 0 }}
                  style={{ maxHeight: 460 }}
                >
                  {mode === 'register' && (
                    <>
                      <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={formSectionStyle.input} />
                      <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={formSectionStyle.input} />
                      <TextInput
                        placeholder="Code postal"
                        placeholderTextColor={C.textSoft}
                        value={postalCode}
                        onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                        keyboardType="number-pad"
                        maxLength={5}
                        style={formSectionStyle.input}
                      />
                      {citySuggestions.length > 0 && !city && (
                        <ScrollView
                          style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                          keyboardShouldPersistTaps="handled"
                          nestedScrollEnabled
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
                      {cityFetchFailed && !city && (
                        // Audit B12b — geo.api KO ou pas de match : saisie manuelle.
                        <View style={{ marginBottom: 10 }}>
                          <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 4 }}>
                            Recherche de villes indisponible. Saisis ta ville manuellement.
                          </Text>
                          <TextInput
                            placeholder="Ta ville"
                            placeholderTextColor={C.textSoft}
                            value={city}
                            onChangeText={setCity}
                            autoCapitalize="words"
                            style={formSectionStyle.input}
                          />
                        </View>
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
                    </>
                  )}
                  <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={formSectionStyle.input} />
                  {mode !== 'forgot' && (
                    <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={formSectionStyle.input} />
                  )}
                  {mode === 'login' && (
                    // B4 : lien vers mode 'forgot' sous le champ password.
                    <TouchableOpacity
                      onPress={() => { setMode('forgot'); setError(''); setForgotEmailSent(false); }}
                      style={{ alignSelf: 'flex-end', paddingVertical: 4, marginTop: -4, marginBottom: 4 }}
                    >
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
                    </TouchableOpacity>
                  )}
                  {mode === 'forgot' && forgotEmailSent && (
                    <Text style={{ color: '#166534', fontSize: 13, marginTop: 8, marginBottom: 4, lineHeight: 18 }}>
                      Si un compte existe avec cet email, un lien de réinitialisation t'a été envoyé. Vérifie ta boîte (et les spams). Le lien est valable 24h.
                    </Text>
                  )}
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
                </ScrollView>

                <TouchableOpacity onPress={submit} disabled={busy || (mode === 'forgot' && forgotEmailSent)} style={{ backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12, opacity: (busy || (mode === 'forgot' && forgotEmailSent)) ? 0.6 : 1 }}>
                  {busy
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                        {mode === 'login' ? 'Se connecter'
                          : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
                          : "S'inscrire"}
                      </Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    if (mode === 'forgot') { setMode('login'); }
                    else { setMode(mode === 'login' ? 'register' : 'login'); }
                    setError('');
                    setForgotEmailSent(false);
                  }}
                  style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}
                >
                  <Text style={{ color: C.textSoft, fontSize: 13 }}>
                    {mode === 'forgot' ? '← Retour à la connexion'
                      : mode === 'login' ? "Pas encore de compte ? S'inscrire"
                      : 'Déjà un compte ? Se connecter'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </View>
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
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          {/* Backdrop : iOS systemThinMaterialDark, fade-in herite du Modal. */}
          <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
          <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
            <Animated.View style={{ transform: [{ translateY: sheetTranslate }] }}>
            <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
              <View {...handlePanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                <View style={s.modalHandle} />
              </View>
              <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                {mode === 'login' ? 'Espace organisateur' : 'Créer un compte'}
              </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
              {mode === 'login' ? 'Connecte-toi à ton compte organisateur' : 'Crée ton compte pour gérer tes events'}
            </Text>

            {mode === 'register' && (
              <>
                <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={formSectionStyle.input} />
                <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={formSectionStyle.input} />
              </>
            )}
            <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={formSectionStyle.input} />
            <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={formSectionStyle.input} />

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

            <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: C.textSoft, fontSize: 13 }}>
                {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
              </Text>
            </TouchableOpacity>
            </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Détail événement (vue orga). Reproduit la card expanded du dashboard /orga :
// bandeau coloré + statut + actions + identifiants + facturation + lien delete.
// ─────────────────────────────────────────────────────────────────────────────
function OrganizerEventDetailScreen({ session, organizerApiFetch, event, onClose, onEdit, onOpenPhotos, onDeleted }) {
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
              const r = await organizerApiFetch(`/organizer/event/${event.code}`, {
                method: 'DELETE',
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
              <Text style={{ color: deleting ? C.textSoft : C.error, fontSize: 14, fontWeight: '500' }}>
                {deleting ? 'Suppression…' : 'Supprimer cet événement'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OrganizerEventPhotosScreen({ session, organizerApiFetch, event, onClose, onOpenPhoto }) {
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
      const r = await organizerApiFetch(`/organizer/event-photos/${event.code}`);
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
          race_distance_id: p.race_distance_id || null,
          km: p.km,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
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
    : photos.filter(p => {
        const k = (p && p.race_distance_id) ? String(p.race_distance_id) : (p && p.race ? String(p.race) : null);
        return k === raceFilter || !p.race;
      });

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
              const r = await organizerApiFetch(`/organizer/delete-photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
      const r = await organizerApiFetch(`/organizer/delete-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            const val = String(d.id || d.km);
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
                <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{raceTitle(d)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Text style={[s.sectionTitle, { marginVertical: 10 }]}>
        Photos {photos.length > 0 ? `(${filteredPhotos.length})` : ''}
        {hiddenCount > 0 && (
          <Text style={{ color: C.error, fontSize: 13, fontWeight: '600' }}>
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
      const r = await organizerApiFetch(`/organizer/photo-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
                backgroundColor: C.error,
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
                backgroundColor: C.error,
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

function OrganizerDashboardScreen({ session, organizerApiFetch, onLogout, onCreateEvent, onEditEvent, onOpenProfile, onOpenEventPhotos, onOpenEventDetail, onOpenOrgRole, refreshKey = 0 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null); // slug en cours de paiement

  const reload = async () => {
    setLoading(true);
    try {
      const r = await organizerApiFetch(`/organizer/my-events`);
      const data = await r.json();
      // Tri ASC strict (decision user 2026-06-04, applique a toutes les listes events).
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''))
        : [];
      setEvents(sorted);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [refreshKey]);

  const pay = async (slug) => {
    setPaying(slug);
    try {
      const r = await organizerApiFetch(`/organizer/pay-event/${slug}`, {
        method: 'POST',
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
              const r = await organizerApiFetch(`/organizer/event/${e.code}`, {
                method: 'DELETE',
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
    if (st === 'pending') return { label: 'En cours de validation', color: C.warning, bg: '#FEF3C7' };
    if (st === 'validated') return { label: 'En cours d\'activation', color: '#8B5CF6', bg: '#EDE9FE' };
    if (st === 'pending_payment') return { label: 'À régler', color: '#EC4899', bg: '#FCE7F3' };
    if (st === 'free') return { label: 'En ligne · gratuit', color: C.success, bg: '#D1FAE5' };
    if (st === 'paid') return { label: 'En ligne', color: C.success, bg: '#D1FAE5' };
    if (st === 'rejected') return { label: 'Refusé', color: C.error, bg: '#FEE2E2' };
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
            <Icon.GearOrg size={22} color={C.pinkPillFg} />
          </TouchableOpacity>
          <View style={s.orgToggleDivider} />
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole?.('photographer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.CamOrg size={24} color={C.pinkPillFg} />
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

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
      ) : events.length === 0 ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
            Tu n'as pas encore créé d'événement.{'\n'}Clique sur le bouton ci-dessous pour démarrer.
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
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.error }}
                  >
                    <Text style={{ color: C.error, fontSize: 13, fontWeight: '600' }}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}

      <TouchableOpacity
        onPress={onCreateEvent}
        style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 4 }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>+ Créer un événement</Text>
      </TouchableOpacity>
    </RefreshableScrollView>
  );
}

export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [tab, setTab] = useState('upcoming');
  const [bottomTab, setBottomTab] = useState('home');
  // Signal incremente a chaque tap "Accueil" pour declencher un scroll-to-top
  // dans le HomeScreen (utile quand on est deja sur l onglet).
  const [homeScrollSignal, setHomeScrollSignal] = useState(0);
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
  // Audit B15 — etat d upload selfie R2. Pas de pastille verte sans confirmation
  // serveur (PUT 2xx ou GET /runner/selfie exists=true).
  const [selfieUploadState, setSelfieUploadState] = useState('idle');
  // 'idle' | 'uploading' | 'ok' | 'failed'
  const selfieConfirmDoneRef = useRef(false);
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
  // Recherche par dossard : state lifte au root pour rendre la pill
  // au-dessus du degrade blanc du footer (zIndex 5 root-level). Tant que la
  // pill etait dans EventDetailScreen, elle restait coincee sous le degrade.
  // Le fetch debounced + le rendu de la pill sont plus bas (apres eventInPanel).
  const [bibQuery, setBibQuery] = useState('');
  const [bibResults, setBibResults] = useState(null);
  const [bibSearching, setBibSearching] = useState(false);
  const [bibKeyboardH, setBibKeyboardH] = useState(0);
  // EventDetailScreen photo count -> conditionne l affichage de la pill bib
  // (hide sur events sans photos). Reset a chaque change d event.
  const [eventPanelHasPhotos, setEventPanelHasPhotos] = useState(false);
  // Scroll state -> conditionne l affichage de la fleche back-to-top
  // (visible uniquement apres scroll > 50px). Reset a chaque change d event.
  const [eventPanelHasScrolled, setEventPanelHasScrolled] = useState(false);
  // Trigger scroll-to-top du EventDetailScreen depuis la pill bib (arrow).
  const [scrollToTopSignal, setScrollToTopSignal] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setBibKeyboardH(e.endCoordinates?.height || 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setBibKeyboardH(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const reloadEvents = useCallback(async () => {
    try {
      const data = await api.getEvents();
      if (Array.isArray(data) && data.length > 0) setEvents(data);
    } catch {
      // offline : on garde la liste cachée (préchargée au boot)
    }
  }, []);

  // Prefetch des cover images de tous les events de l accueil des qu on a
  // la liste : le switch entre les pills A venir / Passes / Favoris ne
  // declenche plus de chargement reseau (les images sont en cache disque
  // ExpoImage), donc plus de "saut" visuel quand une card s affiche.
  useEffect(() => {
    if (!events.length || !ExpoImage.prefetch) return;
    const urls = events.map(e => e.cover_image).filter(Boolean);
    if (urls.length) ExpoImage.prefetch(urls).catch(() => {});
  }, [events]);

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
    // Le .ttf a un PostScript = 'AVEstiana-Bold' (Subfamily Bold unique). On
    // registre sous DEUX cles : nom PostScript natif (que iOS reconnait sans
    // ambiguite) + alias 'AVEstiana' historique pour compat avec les styles
    // existants qui referencent ce nom-la.
    Font.loadAsync({
      'AVEstiana-Bold': require('./assets/fonts/AV_Estiana-VF.ttf'),
      AVEstiana: require('./assets/fonts/AV_Estiana-VF.ttf'),
      Montserrat: require('./assets/fonts/Montserrat-VF.ttf'),
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
        // Boot normal post-reset : le chargement de @will_follows est fait
        // par un useEffect dedie qui depend de runnerSession (favoris cachees
        // uniquement quand connecte). Rien a faire ici.
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
    // Migration one-shot : ancien cache photos global @will_photos_cache
    // (non scope par userId) -> on le supprime au boot. Les sessions
    // suivantes ecrivent dans @will_photos_cache_<userId>. Sans cleanup, le
    // cache global pouvait contenir les photos du dernier user logge et
    // hydrater un autre user au cold boot.
    AsyncStorage.removeItem('@will_photos_cache').catch(() => {});
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

  // Favoris photos perso. Source de verite = server (sync mobile<->web depuis
  // l ajout des endpoints /runner/photo-favorite[s]). AsyncStorage sert de
  // cache local pour affichage immediat avant le fetch reseau, et de fallback
  // offline. Sync flow :
  //  1. Hydrate depuis AsyncStorage (instant) -> UI reactive.
  //  2. GET /runner/photo-favorites -> merge union avec local (migration des
  //     favs pre-sync), push union au server, ecrit AsyncStorage final.
  useEffect(() => {
    if (!userId || !runnerSession) {
      setPhotoFavorites([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const cachedRaw = await AsyncStorage.getItem(`@will_photo_favorites_${userId}`).catch(() => null);
      let local = [];
      if (cachedRaw) { try { local = JSON.parse(cachedRaw); } catch {} }
      if (!cancelled) setPhotoFavorites(Array.isArray(local) ? local : []);
      try {
        const r = await runnerApiFetch('/runner/photo-favorites');
        if (cancelled) return;
        if (!r?.ok) return;
        const data = await r.json().catch(() => ({}));
        const remote = Array.isArray(data?.keys) ? data.keys : [];
        const merged = Array.from(new Set([...(Array.isArray(local) ? local : []), ...remote]));
        const localSet = new Set(local || []);
        const needsServerPush = merged.some(k => !remote.includes(k));
        setPhotoFavorites(merged);
        AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(merged)).catch(() => {});
        if (needsServerPush) {
          for (const k of merged) {
            if (!remote.includes(k)) {
              runnerApiFetch('/runner/photo-favorite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: k }),
              }).catch(() => {});
            }
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [userId, runnerSession, runnerApiFetch]);

  // Charge @will_follows_<userId> quand un runner est connecte. Scope par
  // userId pour survivre au logout/re-login du meme compte sans fuite
  // cross-compte. Migration auto au passage : si la cle scopee est vide
  // mais que l ancienne cle globale @will_follows existe encore (user qui
  // n a pas logout depuis le pre-scoping), on copie vers la cle scopee
  // puis on supprime la globale. Resultat : pas de favoris perdus pour
  // les comptes existants au moment du deploy.
  //
  // Refresh forcee des favs photo depuis le serveur. Appelable depuis :
  //  - useEffect au mount (initial sync)
  //  - AppState foreground (l user revient sur l app apres avoir fav sur le
  //    site)
  //  - PhotosScreen au passage isActive (l user ouvre l onglet Mes photos)
  // REPLACE le local par la version serveur (source de verite) pour ne pas
  // garder des favs supprimees sur le site (pattern follows).
  const refreshPhotoFavoritesFromServer = useCallback(async () => {
    if (!userId || !runnerSession) return;
    try {
      const r = await runnerApiFetch('/runner/photo-favorites');
      if (!r?.ok) return;
      const data = await r.json().catch(() => ({}));
      const remote = Array.isArray(data?.keys) ? data.keys : [];
      setPhotoFavorites(remote);
      AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(remote)).catch(() => {});
    } catch {}
  }, [userId, runnerSession, runnerApiFetch]);

  // AppState foreground -> refresh favs (l user revient apres avoir fav sur
  // le site, sync immediate sans attendre cold start).
  useEffect(() => {
    if (!userId || !runnerSession) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshPhotoFavoritesFromServer();
    });
    return () => sub.remove();
  }, [userId, runnerSession, refreshPhotoFavoritesFromServer]);

  // Sync app<->site (2026-06-09) : apres le load local, on appelle
  // GET /runner/follows et on REMPLACE le local par la version serveur
  // (source de verite). Sans ce remplacement, des follows revoquus cote
  // serveur (unfollow web ou face-data delete) resteraient remanents en
  // local.
  useEffect(() => {
    const uid = runnerSession?.profile?.userId;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      let raw = await AsyncStorage.getItem(`@will_follows_${uid}`).catch(() => null);
      if (!raw) {
        const legacy = await AsyncStorage.getItem('@will_follows').catch(() => null);
        if (legacy) {
          await AsyncStorage.setItem(`@will_follows_${uid}`, legacy).catch(() => {});
          await AsyncStorage.removeItem('@will_follows').catch(() => {});
          raw = legacy;
        }
      }
      let local = [];
      if (raw) {
        try { local = JSON.parse(raw); } catch {}
      }
      if (!Array.isArray(local)) local = [];
      if (!cancelled && local.length > 0) setFollows(local);
      // Fetch serveur = source de verite. Replace l etat local.
      try {
        const r = await runnerApiFetch('/runner/follows');
        if (cancelled) return;
        if (!r?.ok) return;
        const data = await r.json().catch(() => ({}));
        const remote = Array.isArray(data?.codes) ? data.codes : [];
        setFollows(remote);
        AsyncStorage.setItem(`@will_follows_${uid}`, JSON.stringify(remote)).catch(() => {});
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [runnerSession?.profile?.userId, runnerApiFetch]);

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
    // Audit B15 — Source de verite serveur pour selfieUploadState.
    // L effect ne depend QUE de [token] : le ref guard empeche le double-fetch
    // sans creer de cycle via les deps (set state ne re-declenche pas l effect).
    const token = runnerSession?.token;
    if (!token) {
      selfieConfirmDoneRef.current = false;   // reset au logout
      return;
    }
    if (selfieConfirmDoneRef.current) return;  // deja confirme cette session
    selfieConfirmDoneRef.current = true;

    // Snapshot de l etat local AU MOMENT du fire (immune aux changements).
    const hasLocalSelfie = !!selfieUri;
    if (hasLocalSelfie) setSelfieUploadState('uploading');

    let cancelled = false;
    // Audit B14 — migration via runnerApiFetch (token injecte). runnerApiFetch
    // est dans les deps, le ref guard selfieConfirmDoneRef empeche la boucle
    // meme si le wrapper change pour autre raison que token.
    runnerApiFetch(`/runner/selfie`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.exists && data?.uri) {
          if (!hasLocalSelfie) {
            setSelfieUri(data.uri);
            AsyncStorage.setItem('@will_selfie', data.uri).catch(() => {});
          }
          setSelfieUploadState('ok');
        } else if (hasLocalSelfie) {
          // Selfie local mais serveur dit non : upload R2 a foire OU TTL
          // R2 a purge l objet. Dans les 2 cas, UI propose retry.
          setSelfieUploadState('failed');
        }
        // Sinon (pas selfieUri local + serveur exists=false) : state reste 'idle'.
      })
      .catch(() => {
        if (cancelled) return;
        // GET echoue (reseau, etc.) : si selfieUri local on ne peut pas
        // confirmer -> failed.
        if (hasLocalSelfie) setSelfieUploadState('failed');
      });
    return () => { cancelled = true; };
  }, [runnerSession?.token, runnerApiFetch]);

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
    // Purge in-memory uniquement : les caches @will_follows_<uid> et
    // @will_photo_favorites_<uid> restent en storage, scopes par userId
    // (pas de fuite cross-compte). Au re-login du meme user, les useEffects
    // d hydratation relisent ces cles et restaurent l etat instantanement.
    setFollows([]);
    setPhotoFavorites([]);
    Secure.removeItem('@will_runner').catch(() => {});
    AsyncStorage.removeItem('@will_selfie').catch(() => {});
    // Caches scopes par userId NON vides au logout : @will_photos_cache_<uid>,
    // @will_follows_<uid>, @will_photo_favorites_<uid>. Pas de fuite cross-compte
    // (cle differente par user), hydratation immediate au re-login du meme compte.
    AsyncStorage.removeItem('@will_last_seen_burst_ts').catch(() => {});
    // Legacy global @will_follows : on supprime au cas ou il traine d une
    // version pre-scoping.
    AsyncStorage.removeItem('@will_follows').catch(() => {});
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

  // Audit B14 — Factor logoutPhotographer pour qu il puisse etre appele depuis
  // handlePhotographerAuthFailure (parite avec logoutRunner / logoutOrganizer).
  // Le rendu PhotographerScreen.onLogout l utilise aussi.
  const logoutPhotographer = useCallback(async () => {
    try { await AsyncStorage.multiRemove([UPLOAD_QUEUE_KEY, LAST_CAPTURE_KEY]); } catch {}
    try { const d = pendingDir(); if (d.exists) d.delete(); } catch {}
    setSession(null);
    setInPhotographerMode(false);
    Secure.removeItem('@will_photographer_session').catch(() => {});
  }, []);

  // Audit B14 — UN ref de garde-fou PAR session (Alert "session expiree" n est
  // affiche qu une fois pour les 401 paralleles d une meme session). Reset au
  // login isole par dep dans 3 useEffect : un flag partage serait reset par
  // n importe quel token valide, neutralisant le garde-fou (interference
  // croisee entre sessions coexistantes).
  const runnerAuthHandledRef = useRef(false);
  const organizerAuthHandledRef = useRef(false);
  const photographerAuthHandledRef = useRef(false);

  useEffect(() => {
    if (runnerSession?.token) runnerAuthHandledRef.current = false;
  }, [runnerSession?.token]);

  useEffect(() => {
    if (organizerSession?.token) organizerAuthHandledRef.current = false;
  }, [organizerSession?.token]);

  useEffect(() => {
    if (session?.token) photographerAuthHandledRef.current = false;
  }, [session?.token]);

  const handleRunnerAuthFailure = useCallback(() => {
    if (runnerAuthHandledRef.current) return;
    runnerAuthHandledRef.current = true;
    Alert.alert(
      'Session expirée',
      'Reconnecte-toi pour continuer.',
      [{ text: 'OK', onPress: () => logoutRunner() }]
    );
  }, [logoutRunner]);

  const handleOrganizerAuthFailure = useCallback(() => {
    if (organizerAuthHandledRef.current) return;
    organizerAuthHandledRef.current = true;
    Alert.alert(
      'Session expirée',
      'Reconnecte-toi pour continuer.',
      [{ text: 'OK', onPress: () => logoutOrganizer() }]
    );
  }, [logoutOrganizer]);

  const handlePhotographerAuthFailure = useCallback(() => {
    if (photographerAuthHandledRef.current) return;
    photographerAuthHandledRef.current = true;
    Alert.alert(
      'Session expirée',
      'Reconnecte-toi pour continuer.',
      [{ text: 'OK', onPress: () => logoutPhotographer() }]
    );
  }, [logoutPhotographer]);

  // Wrappers session : token injecte automatiquement via closure (pas de
  // redondance signature/headers). Le caller peut override Authorization
  // s il en a besoin (cas rare type refresh).
  const runnerApiFetch = useCallback((path, options = {}) => {
    const token = runnerSession?.token;
    const headers = {
      ...(options.headers || {}),
      ...(token && !options.headers?.Authorization ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiFetch(path, { ...options, headers }, { onAuthFailure: handleRunnerAuthFailure });
  }, [runnerSession?.token, handleRunnerAuthFailure]);

  // Cart sync : (1) garde la session runner exposee module-scope pour les
  // hooks useCart/useAllCarts via setCurrentRunnerSession, (2) au boot/login
  // resync local <-> backend. Strategy :
  //   - 1er sync pour ce userId (flag `will:cart:syncDone:{userId}` absent) :
  //     UNION local + backend, push, set flag. Migre le panier anonyme.
  //   - Syncs suivants : REPLACE local par backend (backend = source of truth).
  //     Sans ca une suppression cross-device est annulee a chaque sync car
  //     le local re-pousse l item supprime via union.
  useEffect(() => {
    setCurrentRunnerSession(runnerSession);
    if (!runnerSession?.token) return;
    const userId = runnerSession?.profile?.userId;
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const flagKey = `will:cart:syncDone:${userId}`;
        const flagVal = await AsyncStorage.getItem(flagKey).catch(() => null);
        const isFirstSync = !flagVal;
        const r = await runnerApiFetch('/runner/cart');
        if (!r || !r.ok || cancelled) return;
        const data = await r.json().catch(() => null);
        const backend = (data && data.carts && typeof data.carts === 'object') ? data.carts : {};
        const allKeys = await AsyncStorage.getAllKeys();
        const cartKeys = (allKeys || []).filter((k) => k.startsWith('will:cart:'));
        const localEntries = cartKeys.length > 0 ? await AsyncStorage.multiGet(cartKeys) : [];
        const localMap = {};
        for (const [k, v] of localEntries) {
          const code = k.substring('will:cart:'.length);
          try {
            const arr = JSON.parse(v || '[]');
            if (Array.isArray(arr) && arr.length > 0) localMap[code] = arr;
          } catch {}
        }
        const allCodes = new Set([...Object.keys(backend), ...Object.keys(localMap)]);
        let mutated = false;
        for (const code of allCodes) {
          const local = localMap[code] || [];
          const remote = backend[code] || [];
          if (isFirstSync) {
            // Migration : UNION + push si extras locaux
            const union = Array.from(new Set([...local, ...remote]));
            if (union.length !== local.length) {
              if (union.length === 0) {
                await AsyncStorage.removeItem(`will:cart:${code}`);
              } else {
                await AsyncStorage.setItem(`will:cart:${code}`, JSON.stringify(union));
              }
              mutated = true;
            }
            if (union.length > remote.length) {
              await runnerApiFetch(`/runner/cart/${encodeURIComponent(code)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: union }),
              }).catch(() => {});
            }
          } else {
            // REPLACE : backend gagne. Si remote = [] -> wipe local.
            const isDifferent = remote.length !== local.length || remote.some((k) => !local.includes(k));
            if (isDifferent) {
              if (remote.length === 0) {
                await AsyncStorage.removeItem(`will:cart:${code}`);
              } else {
                await AsyncStorage.setItem(`will:cart:${code}`, JSON.stringify(remote));
              }
              mutated = true;
            }
          }
        }
        if (isFirstSync) {
          await AsyncStorage.setItem(flagKey, '1').catch(() => {});
        }
        if (!cancelled && mutated) emitCartChange();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [runnerSession?.token, runnerSession?.profile?.userId, runnerApiFetch]);

  const organizerApiFetch = useCallback((path, options = {}) => {
    const token = organizerSession?.token;
    const headers = {
      ...(options.headers || {}),
      ...(token && !options.headers?.Authorization ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiFetch(path, { ...options, headers }, { onAuthFailure: handleOrganizerAuthFailure });
  }, [organizerSession?.token, handleOrganizerAuthFailure]);

  const photographerApiFetch = useCallback((path, options = {}) => {
    const token = session?.token;
    const headers = {
      ...(options.headers || {}),
      ...(token && !options.headers?.Authorization ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiFetch(path, { ...options, headers }, { onAuthFailure: handlePhotographerAuthFailure });
  }, [session?.token, handlePhotographerAuthFailure]);

  // RGPD chirurgical : supprime selfie + empreintes biometriques sur TOUS
  // les events suivis, sans toucher au compte. Le coureur peut redeposer
  // un selfie et re-suivre des events ensuite. Cf DELETE /runner/face-data.
  const deleteFaceData = useCallback(() => {
    if (!runnerSession?.token) return;
    Alert.alert(
      'Supprimer toutes mes données faciales ?',
      'Cela supprime ton selfie ET toutes les photos déjà identifiées de toi sur l\'app. Action définitive.\n\nDifférent du retrait d\'un event des favoris (qui garde les photos déjà identifiées). Ton compte reste actif, tu peux redéposer un selfie ensuite.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          const r = await api.deleteFaceData(runnerApiFetch);
          if (r?.success) {
            // Cleanup local : selfie, follows, follow_started timestamps
            setSelfieUri(null);
            setFollows([]);
            const uid = runnerSession?.profile?.userId;
            await AsyncStorage.removeItem('@will_selfie').catch(() => {});
            await AsyncStorage.removeItem('@will_follows').catch(() => {});
            // Cache photos scope par userId : on supprime celui du user courant.
            if (uid) await AsyncStorage.removeItem(`@will_photos_cache_${uid}`).catch(() => {});
            // Legacy global cache (au cas ou il traine encore) :
            await AsyncStorage.removeItem('@will_photos_cache').catch(() => {});
            await AsyncStorage.removeItem('@will_last_seen_burst_ts').catch(() => {});
            // Purge tous les @will_follow_started_* presents
            try {
              const allKeys = await AsyncStorage.getAllKeys();
              const startedKeys = allKeys.filter(k => k.startsWith('@will_follow_started_'));
              if (startedKeys.length > 0) await AsyncStorage.multiRemove(startedKeys);
            } catch {}
            setProfileMenu(false);
            Alert.alert('Données faciales supprimées', 'Ton consentement biométrique est retiré et ton selfie est supprimé de nos serveurs. Tu peux redéposer un selfie quand tu veux.');
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
            const r = await runnerApiFetch(`/runner/account`, { method: 'DELETE' });
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
            const r = await organizerApiFetch(`/organizer/account`, { method: 'DELETE' });
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
      const r = await runnerApiFetch(`/runner/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
      const r = await organizerApiFetch(`/organizer/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
    const uid = runnerSession?.profile?.userId;
    const followsKey = uid ? `@will_follows_${uid}` : '@will_follows';
    const isCurrentlyFollowing = follows.includes(eventCode);

    // Optimistic update : on met a jour l etat local IMMEDIATEMENT pour que
    // le coeur switche sans attendre la confirmation reseau (~500ms-2s a
    // cause de IndexFaces AWS). Si le serveur refuse, on rollback en cas
    // d echec non-rattrapable (autre que selfie_required).
    if (isCurrentlyFollowing) {
      // UNFOLLOW : optimistic remove
      setFollows(prev => {
        const next = prev.filter(c => c !== eventCode);
        AsyncStorage.setItem(followsKey, JSON.stringify(next)).catch(() => {});
        return next;
      });
      AsyncStorage.removeItem(`@will_follow_started_${eventCode}`).catch(() => {});
      const r = await api.unfollow(eventCode, runnerApiFetch);
      if (!r?.ok && r?.note !== 'already_unfollowed') {
        // Rollback
        setFollows(prev => {
          if (prev.includes(eventCode)) return prev;
          const next = [...prev, eventCode];
          AsyncStorage.setItem(followsKey, JSON.stringify(next)).catch(() => {});
          return next;
        });
        Alert.alert('Erreur', r?.error || 'Impossible de retirer le suivi. Reessaie.');
      }
      return;
    }

    // FOLLOW : optimistic add
    const wasEmpty = follows.length === 0;
    setFollows(prev => {
      if (prev.includes(eventCode)) return prev;
      const next = [...prev, eventCode];
      AsyncStorage.setItem(followsKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
    AsyncStorage.setItem(`@will_follow_started_${eventCode}`, String(Date.now())).catch(() => {});
    const r = await api.follow(eventCode, runnerApiFetch);
    if (r?.ok || r?.note === 'already_following') {
      // E2 — premier follow du coureur = bon moment pour demander la
      // permission notif. Sinon (deja des follows), on tente un register
      // silencieux au cas ou le token n a pas encore ete envoye.
      ensurePushRegistered(token, { ask: wasEmpty });
      return;
    }
    // Le reseau a refuse : il faut rollback dans tous les cas EXCEPTE le
    // selfie_required qui sera retente apres save selfie (pendingFollowRef).
    const rollbackFollow = () => {
      setFollows(prev => {
        const next = prev.filter(c => c !== eventCode);
        AsyncStorage.setItem(followsKey, JSON.stringify(next)).catch(() => {});
        return next;
      });
      AsyncStorage.removeItem(`@will_follow_started_${eventCode}`).catch(() => {});
    };
    // 400 "Selfie requis" → ouvre SelfieModal puis relance follow apres save
    if (r?.status === 400 && r?.error && r.error.toLowerCase().includes('selfie')) {
      rollbackFollow();
      pendingFollowRef.current = eventCode;
      setSelfieModal(true);
      return;
    }
    // 400 "Aucun visage detecte" → message dedie
    if (r?.status === 400 && r?.error && r.error.toLowerCase().includes('visage')) {
      rollbackFollow();
      Alert.alert('Selfie a refaire', r.error);
      return;
    }
    // Autre erreur
    rollbackFollow();
    Alert.alert('Erreur', r?.error || 'Impossible de suivre cet event. Reessaie.');
  }, [follows, runnerSession?.token, runnerSession?.profile?.userId, runnerApiFetch]);

  // Audit B14a followup — Wrapper STABLE pour toggleFollow, qui dispatche vers
  // la derniere version via useRef. Les closures stockees dans pendingActionRef
  // (cf requireAuth -> login -> setTimeout(action, 100)) capturent toggleFollow
  // au moment de leur creation, AVANT le login. Avec un wrapper stable, la
  // closure capture toggleFollowStable (ne change jamais) qui resout la latest
  // version au moment de l appel post-login. Sans ca, le pendingAction
  // invoquait l ancien toggleFollow ferme sur runnerSession=null et affichait
  // "Connexion requise" alors que l utilisateur venait de se loguer.
  const toggleFollowLatestRef = useRef(toggleFollow);
  toggleFollowLatestRef.current = toggleFollow;
  const toggleFollowStable = useCallback((code) => {
    return toggleFollowLatestRef.current?.(code);
  }, []);

  const photoFavoritesSet = useMemo(() => new Set(photoFavorites), [photoFavorites]);
  const togglePhotoFavorite = useCallback((photoId) => {
    // Garde-fou : seul un runner connecte peut likeer une photo. Le caller
    // doit deja wrapper avec requireAuth pour ouvrir le modal de login si non.
    if (!photoId || !userId || !runnerSession) return;
    let wasFav = false;
    setPhotoFavorites(prev => {
      wasFav = prev.includes(photoId);
      const next = wasFav ? prev.filter(k => k !== photoId) : [...prev, photoId];
      AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
    // Sync server (best-effort, rollback en cas d echec). Le state local est
    // deja a jour : l UI reagit immediatement. Si le server refuse, on
    // restaure l etat anterieur et on re-ecrit AsyncStorage.
    const method = wasFav ? 'DELETE' : 'POST';
    runnerApiFetch('/runner/photo-favorite', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: photoId }),
    }).then(r => {
      if (r && !r.ok) {
        setPhotoFavorites(prev => {
          const restored = wasFav ? [...prev, photoId] : prev.filter(k => k !== photoId);
          AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(restored)).catch(() => {});
          return restored;
        });
      }
    }).catch(() => {
      setPhotoFavorites(prev => {
        const restored = wasFav ? [...prev, photoId] : prev.filter(k => k !== photoId);
        AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(restored)).catch(() => {});
        return restored;
      });
    });
  }, [userId, runnerSession, runnerApiFetch]);

  // Audit B15 — Upload R2 traque via selfieUploadState. Appele par onSaved
  // (nouveau selfie) et par retrySelfieUpload (tap pastille rouge / bouton
  // SelfieBlock / lien ProfileMenu).
  const runSelfieUpload = useCallback(async (uri) => {
    if (!uri) return;
    // path correct = runnerSession.profile.userId (cf 6 autres occurrences).
    const userId = runnerSession?.profile?.userId;
    const token = runnerSession?.token;
    if (!userId || !token) return;
    setSelfieUploadState('uploading');
    try {
      // Audit B14a followup : token manuel (pas runnerApiFetch) pour ne pas
      // declencher auto-logout sur 401 PUT (cas edge signup, cf commentaire
      // uploadSelfieToR2).
      await uploadSelfieToR2(uri, userId, token);
      setSelfieUploadState('ok');
    } catch (e) {
      console.warn('selfie upload R2', e?.message || e);
      setSelfieUploadState('failed');
    }
  }, [runnerSession?.profile?.userId, runnerSession?.token]);

  const retrySelfieUpload = useCallback(() => {
    if (selfieUri) runSelfieUpload(selfieUri);
  }, [selfieUri, runSelfieUpload]);

  const deleteSelfie = useCallback(() => {
    Alert.alert('Supprimer ton selfie ?', 'Ton consentement biométrique sera retiré immédiatement et la reconnaissance s’arrêtera sur les nouvelles photos. Tu peux redéposer un selfie à tout moment.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        // 1. Supprime le selfie cote serveur en premier. Sinon le useEffect
        //    refetch (GET /runner/selfie) restaurerait la pastille verte
        //    instantanement apres le clear local.
        if (runnerSession?.token) {
          try {
            await runnerApiFetch(`/runner/selfie`, { method: 'DELETE' });
          } catch (e) { console.warn('delete selfie', e?.message); }
        }
        // 2. Clear local. RGPD : revoque aussi le consentement biometrique.
        await Promise.all([
          AsyncStorage.removeItem('@will_selfie'),
          Secure.removeItem(BIOMETRIC_CONSENT_KEY),
        ]);
        setSelfieUri(null);
        setSelfieUploadState('idle');   // audit B15 — reset etat upload
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

  // Badge agrege pour le pill Panier dans le header HomeScreen + Modal panier
  // ouvert au tap. Refresh auto via cartChangeListeners cross-component.
  const { total: cartGlobalTotal } = useAllCarts();
  const [panierModalVisible, setPanierModalVisible] = useState(false);
  const { sheetTranslate: panierSheetTranslate, handlePanHandlers: panierPanHandlers } = useDismissibleSheet(panierModalVisible, () => setPanierModalVisible(false));

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

  // Fetch debounced 400ms du /search-bib quand bibQuery a 1-5 chiffres.
  // Reset des resultats quand bibQuery devient vide ou quand on ferme l event.
  useEffect(() => {
    const q = bibQuery.trim();
    if (!eventInPanel?.code || !/^\d{1,5}$/.test(q)) {
      setBibResults(null);
      setBibSearching(false);
      return;
    }
    setBibSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/search-bib?eventCode=${encodeURIComponent(eventInPanel.code)}&bib=${encodeURIComponent(q)}`);
        const data = r.ok ? await r.json() : { photos: [] };
        const mapped = (data?.photos || []).map(p => ({
          id: p.key, key: p.key,
          uri: p.url, thumbUri: p.thumb_url || p.url,
          race: p.race, km: p.km,
          race_distance_id: p.race_distance_id || null,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
          confidence: p.confidence, uploaded: p.uploaded,
        }));
        setBibResults(mapped);
      } catch {
        setBibResults([]);
      } finally {
        setBibSearching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [bibQuery, eventInPanel?.code]);

  // Quand on ferme l event, vide la recherche pour repartir clean au prochain open.
  useEffect(() => {
    if (!eventInPanel) {
      setBibQuery('');
      setBibResults(null);
    }
    // Reset hasPhotos a chaque change d event : evite que la pill bib reste
    // visible pendant la transition d un event A (avec photos) vers B (sans).
    setEventPanelHasPhotos(false);
    // Reset hasScrolled : nouvelle vue commence en haut.
    setEventPanelHasScrolled(false);
  }, [eventInPanel?.code]);

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

  // Mode photographe = overlay absoluteFill SUR le SafeAreaView de l accueil
  // (toujours monté en dessous). Précédemment un early-return démontait tout
  // l accueil ; au logout/back le remount du SafeAreaView mesurait l inset
  // top iOS de facon asynchrone -> flash "trop haut" puis "redescend".
  const photographerOverlay = inPhotographerMode && (session?.role === 'photographer' || session?.role === 'organizer') ? (
    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }]}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
      <PhotographerScreen
        session={session}
        photographerApiFetch={photographerApiFetch}
        // Bouton retour : sort du mode sans effacer la session — le
        // photographe peut revenir avec un seul tap (pas de re-saisie mdp).
        onExit={() => setInPhotographerMode(false)}
        // Vraie déconnexion : efface la session SecureStore + queue locale.
        // Au prochain login (meme event ou autre), la galerie repart vide :
        // les photos uploadees restent consultables via le dashboard orga.
        // Audit B14 : factor en logoutPhotographer (reuse aussi pour
        // handlePhotographerAuthFailure).
        onLogout={logoutPhotographer}
      />
    </View>
  ) : null;

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
                    onOpenProfile={() => {
                      if (runnerSession) setProfileMenu(true);
                      else { setAuthInitialMode('login'); setAuthModalVisible(true); }
                    }}
                    onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...(opts || {}) })}
                    isFollowing={follows.includes(eventInPanel.code)}
                    onToggleFollow={() => requireAuth(() => toggleFollowStable(eventInPanel.code))}
                    runnerFirstName={runnerSession?.profile?.firstName}
                    bibQuery={bibQuery}
                    bibResults={bibResults}
                    bibSearching={bibSearching}
                    photoFavoritesSet={photoFavoritesSet}
                    isAuthed={!!runnerSession}
                    selfieUploadState={selfieUploadState}
                    onRetryUpload={retrySelfieUpload}
                    scrollToTopSignal={scrollToTopSignal}
                    onPhotosCountChange={(n, loading) => setEventPanelHasPhotos(!loading && n > 0)}
                    onScrolledChange={setEventPanelHasScrolled}
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
                  isAuthed={!!runnerSession}
                  onOpenAuthSignup={() => { setAuthInitialMode('register'); setAuthModalVisible(true); }}
                  onOpenAuthLogin={() => { setAuthInitialMode('login'); setAuthModalVisible(true); }}
                  selfieUri={selfieUri}
                  onDeleteSelfie={deleteSelfie}
                  onOpenProfile={() => {
                    if (runnerSession) setProfileMenu(true);
                    else { setAuthInitialMode('login'); setAuthModalVisible(true); }
                  }}
                  follows={follows}
                  onToggleFollow={(code) => requireAuth(() => toggleFollowStable(code))}
                  onRefresh={reloadEvents}
                  runnerFirstName={runnerSession?.profile?.firstName}
                  selfieSkipped={!!runnerSession && selfieSkipped && !selfieUri}
                  selfieUploadState={selfieUploadState}
                  onRetryUpload={retrySelfieUpload}
                  scrollToTopSignal={homeScrollSignal}
                  cartTotal={cartGlobalTotal}
                  onOpenPanier={() => setPanierModalVisible(true)}
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
                    runnerApiFetch={runnerApiFetch}
                    runnerUserId={runnerSession?.profile?.userId}
                    onFindEvent={() => setBottomTab('home')}
                    onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...(opts || {}) })}
                    photoFavoritesSet={photoFavoritesSet}
                    onTogglePhotoFavorite={togglePhotoFavorite}
                    onRefreshFavorites={refreshPhotoFavoritesFromServer}
                    isActive={bottomTab === 'photos'}
                    selfieSkipped={selfieSkipped && !selfieUri}
                    selfieUploadState={selfieUploadState}
                    onRetryUpload={retrySelfieUpload}
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
                    organizerApiFetch={organizerApiFetch}
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
          organizerApiFetch={organizerApiFetch}
          event={organizerEventPhotosTarget}
          onClose={() => setOrganizerEventPhotosTarget(null)}
          onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...opts })}
        />
      )}

      {organizerEventDetailTarget && bottomTab === 'events' && organizerSession && (
        <OrganizerEventDetailScreen
          session={organizerSession}
          organizerApiFetch={organizerApiFetch}
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
        <TouchableOpacity style={s.navBtn} onPress={() => {
          if (bottomTab === 'home') {
            setHomeScrollSignal((n) => n + 1);
          }
          setBottomTab('home'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null);
        }}>
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
                backgroundColor: C.error,
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
      </View>

      {/* Pill recherche par dossard — rendue APRES le bottom nav et le
          degrade blanc footer, donc naturellement au-dessus dans l ordre
          de rendu RN. Visible uniquement quand un EventDetailScreen est
          ouvert ET que l event a au moins une photo (sinon recherche
          dossard inutile). zIndex 20 + elevation 20 pour le z-order Android. */}
      {eventInPanel && eventPanelHasPhotos && (
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0, right: 0,
          bottom: bibKeyboardH > 0 ? bibKeyboardH + 48 : 108,
          alignItems: 'center',
          zIndex: 20,
          elevation: 20,
        }}
      >
        <View style={{
          position: 'relative',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}>
          {/* Arrow back-to-top : position absolute avec offset left negatif
              calcule (-48 = -40 width arrow - 8 gap) -> colle a 8px a gauche
              du row sans entrer dans son flow flex. La pill bib reste
              centree quelle que soit la presence de la fleche. Meme style
              que la pill bib (frosted blur 40x40 borderRadius 16). Visible
              apres scroll > 50px uniquement. */}
          {eventPanelHasScrolled && (
            <TouchableOpacity
              onPress={() => setScrollToTopSignal(s => s + 1)}
              activeOpacity={0.8}
              accessibilityLabel="Retour en haut de page"
              style={{
                position: 'absolute',
                left: -48,
                top: 0, bottom: 0,
                width: 40,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(255,255,255,0.9)',
                shadowColor: '#000',
                shadowOpacity: 0.10,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: 10,
              }}
            >
              <BlurView intensity={80} tint="light" style={{
                flex: 1, alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.35)',
              }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M12 19V5" />
                  <Path d="M5 12l7-7 7 7" />
                </Svg>
              </BlurView>
            </TouchableOpacity>
          )}
          <View style={{
            width: 200,
            borderRadius: 22,
            overflow: 'hidden',
            borderWidth: bibQuery.length > 0 ? 1.5 : StyleSheet.hairlineWidth,
            borderColor: bibQuery.length > 0 ? C.primary : 'rgba(255,255,255,0.9)',
            shadowColor: '#000',
            shadowOpacity: 0.10,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
            elevation: 10,
          }}>
            <BlurView intensity={80} tint="light" style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 6,
              paddingVertical: 6,
              gap: 8,
              backgroundColor: 'rgba(255,255,255,0.35)',
            }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: C.primary,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                  <Path d="M21 21l-4.35-4.35" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
                  <Path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" stroke="#fff" strokeWidth={1.7} />
                </Svg>
              </View>
              <TextInput
                value={bibQuery}
                onChangeText={(v) => setBibQuery(v.replace(/\D/g, '').slice(0, 5))}
                placeholder="Numéro de dossard"
                placeholderTextColor={`${C.primary}80`}
                keyboardType="number-pad"
                returnKeyType="default"
                maxLength={5}
                style={{ flex: 1, fontSize: 13.5, color: C.primary, fontWeight: '600', padding: 0, paddingVertical: 2 }}
              />
            </BlurView>
          </View>
          {bibQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => Keyboard.dismiss()}
              activeOpacity={0.85}
              style={{
                width: 48, height: 40, borderRadius: 20,
                backgroundColor: C.primary,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: C.primary, shadowOpacity: 0.25,
                shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
                elevation: 6,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'Montserrat' }}>Go</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      )}

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
        onSaved={async (uri) => {
          setSelfieUri(uri);
          // Selfie pris → on retire la pastille "selfie manquant" sur l'accueil.
          AsyncStorage.removeItem('@will_selfie_skipped').catch(() => {});
          setSelfieSkipped(false);
          setSignupSelfieStep(false);
          // Audit B14a followup — await la confirmation R2 avant de relancer
          // pendingFollow. Sans await, toggleFollow part avec un selfie pas
          // encore propage cote worker -> 400 selfie_required -> re-ouvre la
          // SelfieModal en boucle.
          await runSelfieUpload(uri);
          // Phase D : si un follow attendait le selfie, relance-le maintenant.
          const pendingEvent = pendingFollowRef.current;
          if (pendingEvent) {
            pendingFollowRef.current = null;
            // setTimeout pour laisser le modal se fermer proprement avant le toast eventuel
            setTimeout(() => { toggleFollowStable(pendingEvent); }, 200);
          }
        }}
        userId={userId}
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
        organizerApiFetch={organizerApiFetch}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <CreateEventModal
        visible={!!editEventTarget}
        onClose={() => setEditEventTarget(null)}
        organizerSession={organizerSession}
        organizerApiFetch={organizerApiFetch}
        editEvent={editEventTarget}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <ProfileMenuModal
        visible={profileMenu}
        onClose={() => setProfileMenu(false)}
        selfieUri={selfieUri}
        // Audit UI-04 : iOS modal stacking interdit d ouvrir un <Modal transparent>
        // au-dessus de ProfileMenuModal en train de se fermer (second invisible,
        // cf memory feedback_rn_modal_stacking.md). setTimeout 200ms aligne sur
        // le pattern L12756 (toggleFollow defere apres SelfieModal close).
        onView={() => {
          setProfileMenu(false);
          setTimeout(() => setSelfieViewer(true), 200);
        }}
        onRetake={() => {
          setProfileMenu(false);
          setTimeout(() => requireAuth(() => setSelfieModal(true)), 200);
        }}
        onDelete={() => {
          // Audit modal-stacking iOS : Alert.alert (dans deleteSelfie) ne saffiche
          // pas si ProfileMenuModal est encore en train de se fermer. Pattern
          // identique a onView et onRetake L13123-L13130.
          setProfileMenu(false);
          setTimeout(() => deleteSelfie(), 200);
        }}
        runnerSession={runnerSession}
        runnerApiFetch={runnerApiFetch}
        onLogout={logoutRunner}
        onUpdateProfile={updateRunnerProfile}
        onDeleteAccount={() => { setProfileMenu(false); deleteRunnerAccount(); }}
        onDeleteFaceData={() => { setProfileMenu(false); deleteFaceData(); }}
        uploadState={selfieUploadState}
        onRetryUpload={retrySelfieUpload}
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
        photosForSale={!!openedPhoto?.photosForSale}
        eventCode={openedPhoto?.eventCode || null}
        onClose={() => setOpenedPhoto(null)}
        photoFavoritesSet={photoFavoritesSet}
        onTogglePhotoFavorite={(id) => {
          if (runnerSession) {
            togglePhotoFavorite(id);
            return;
          }
          // Deconnecte : iOS empeche AuthRunnerModal de s afficher au dessus
          // d un PhotoViewerModal transparent deja monte (souci de stacking).
          // On referme le viewer puis on ouvre l auth modal. Apres login, on
          // re-ouvre le viewer sur la meme photo et on applique le favori.
          const snapshot = openedPhoto;
          setOpenedPhoto(null);
          setTimeout(() => {
            requireAuth(() => {
              if (snapshot) setOpenedPhoto(snapshot);
              togglePhotoFavorite(id);
            });
          }, 220);
        }}
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
        organizerApiFetch={organizerApiFetch}
        onLogout={logoutOrganizer}
        onUpdate={updateOrganizerProfile}
        onDeleteAccount={() => { setOrganizerProfileMenu(false); deleteOrganizerAccount(); }}
      />

    </SafeAreaView>

    {photographerOverlay}

    <Modal
      visible={panierModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setPanierModalVisible(false)}
    >
      {/* Bottom sheet pattern aligne sur AuthOrganizerModal (charte modal) :
          BlurView backdrop + Animated.View translateY drag-down via
          useDismissibleSheet, handle visuel en haut, tap backdrop pour fermer. */}
      <View style={{ flex: 1 }}>
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity
          activeOpacity={1}
          style={{ flex: 1, justifyContent: 'flex-end' }}
          onPress={() => setPanierModalVisible(false)}
        >
          <Animated.View style={{ transform: [{ translateY: panierSheetTranslate }] }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => {}}
              style={{
                backgroundColor: C.bg,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                height: SCREEN_W * (Platform.OS === 'ios' ? 1.7 : 1.6),
                maxHeight: '88%',
                overflow: 'hidden',
              }}
            >
              <View {...panierPanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                <View style={s.modalHandle} />
              </View>
              <PanierScreen
                allEvents={events}
                onOpenEvent={(ev) => { setPanierModalVisible(false); setOpenedEvent(ev); }}
                isActive={panierModalVisible}
                onClose={() => setPanierModalVisible(false)}
                embedded
              />
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </View>
    </Modal>

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
