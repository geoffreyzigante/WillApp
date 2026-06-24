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
  BIOMETRIC_CONSENT_KEY,
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
import { PanierScreen } from './src/screens/PanierScreen';
import { OrganizerEventDetailScreen } from './src/screens/OrganizerEventDetailScreen';
import { OrganizerEventPhotosScreen } from './src/screens/OrganizerEventPhotosScreen';
import { OrganizerDashboardScreen } from './src/screens/OrganizerDashboardScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PhotosScreen } from './src/screens/PhotosScreen';
import { AppHeader } from './src/components/AppHeader';
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { PhotoViewerModal } from './src/components/modals/PhotoViewerModal';
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
import { SelfieCameraModal } from './src/components/modals/SelfieCameraModal';
import { SelfieModal } from './src/components/modals/SelfieModal';
import { LoginModal } from './src/components/modals/LoginModal';
import { ProfileMenuModal } from './src/components/modals/ProfileMenuModal';
import { BurgerMenuModal } from './src/components/modals/BurgerMenuModal';
import { OrganizerProfileMenuModal } from './src/components/modals/OrganizerProfileMenuModal';
import { AuthRunnerModal } from './src/components/modals/AuthRunnerModal';
import { AuthOrganizerModal } from './src/components/modals/AuthOrganizerModal';
import { passwordStrength } from './src/utils/passwordStrength';
import { useDismissibleSheet } from './src/hooks/useDismissibleSheet';
import { useCart } from './src/hooks/useCart';
import { useAllCarts } from './src/hooks/useAllCarts';
import { s } from './src/constants/styles';
import { formSectionStyle, authStyles, profileCardStyles } from './src/constants/formStyles';

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


// État vide pédagogique : 3 étapes + CTA "Trouver un event".


// Icone "favori photo" = etoile (Favoris_3.svg). Distingue les favoris de
// PHOTOS (etoile) des favoris d EVENTS (coeur) pour eviter la confusion
// visuelle entre les deux types de favoris.


// Roulette horizontale infinie (style picker iOS). Le filtre actif est
// au centre, derriere un cadre accent. Items dupliques N fois pour
// simuler l infini : on demarre au milieu de la copie centrale. La
// couleur du texte est interpolee EN LIVE sur le UI thread via



// ─── PanierScreen : onglet Panier global (agrege cross-event) ────────
// Liste toutes les cles `will:cart:*` via useAllCarts, groupe par event
// (avec metadata depuis allEvents = /public-events), affiche un footer
// total + bouton Commander disable (Stripe a venir).

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
  // Timestamp ms de la derniere frame analysee. Lu par captureBurstLoop pour
  // detecter une stagnation Vision (>250ms = frame processor fige par Deep
  // Fusion ou suspension AVCapture). Si stale, on stoppe le burst plutot que
  // de tirer sur un faceInZoneRef qui n'a pas pu repasser a false.
  const lastFrameAtRef = useRef(0);
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
      lastFrameAtRef.current = Date.now();
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

        // Watchdog frame staleness : si Vision n'a pas dispatch de frame
        // depuis >250 ms, faceInZoneRef est stale -- on a pu sortir de zone
        // pendant Deep Fusion / suspension AVCapture sans que le ref repasse
        // a false. Stoppe le burst pour eviter une rafale parasite.
        if (Date.now() - lastFrameAtRef.current > 250) {
          console.warn(`[burst] frame stale ${Date.now() - lastFrameAtRef.current}ms — pause burst`);
          break;
        }

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


// formSectionStyle -> src/constants/formStyles.js

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


// BIOMETRIC_CONSENT_KEY -> src/services/secureStore.js

// Sous-modal : viewport caméra custom avec masque rond circulaire.
// Caméra avant en Vision Camera : grand angle natif explicite + viewport
// dimensionné au ratio 4:3 du capteur pour éviter le crop/zoom apparent
// causé par le cover-fill sur écran 9:19.5. Le cercle est purement visuel
// (overlay SVG), il ne crope pas la preview ; l'image sauvée est l'image

// Modale d'information au 1er boot post-Phase D RGPD. Affichee une seule
// fois si l'utilisateur avait des favoris (vidés a ce moment). Pour la
// re-tester en dev : depuis la console React Native, appeler
//   await global.__resetPhaseD()
// (re-supprime le flag + recharge l'app via DevSettings.reload).


// useDismissibleSheet -> src/hooks/useDismissibleSheet.js



// ---------- ROOT ----------



// profileCardStyles -> src/constants/formStyles.js


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


// ─────────────────────────────────────────────────────────────────────────────
// Détail événement (vue orga). Reproduit la card expanded du dashboard /orga :
// bandeau coloré + statut + actions + identifiants + facturation + lien delete.
// ─────────────────────────────────────────────────────────────────────────────



export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [tab, setTab] = useState('upcoming');
  const [bottomTab, setBottomTab] = useState('home');
  // Hauteur du AppHeader floating (mesuree onLayout). Utilisee comme paddingTop
  // des ScrollView des screens pour que le contenu commence sous le header
  // et puisse passer dessous au scroll -> effet glass/blur visible.
  const [headerH, setHeaderH] = useState(60);
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
  const [burgerMenu, setBurgerMenu] = useState(false);
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
      // Erreur "visage trop petit" : on clear le selfie local pour que
      // l user soit invite a refaire un selfie + Alert avec message clair.
      if (e?.code === 'face_too_small') {
        setSelfieUri(null);
        AsyncStorage.removeItem('@will_selfie').catch(() => {});
        Alert.alert('Visage trop petit', e.userMessage || 'Approche-toi de la caméra pour remplir l\'ovale.');
      }
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
        <View style={{ width: SCREEN_W, height: '100%', backgroundColor: '#F5F3FF' }}>
          <SafeAreaView style={{ flex: 1 }}>
            {eventInPanel && (
              <GestureDetector gesture={navPan}>
                <View style={{ flex: 1 }}>
                  <EventDetailScreen
                    event={eventInPanel}
                    onClose={() => setOpenedEvent(null)}
                    onLogoPress={() => {
                      setOpenedEvent(null);
                      setBottomTab('home');
                    }}
                    onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                    selfieUri={selfieUri}
                    onDeleteSelfie={deleteSelfie}
                    onOpenProfile={() => {
                      if (runnerSession) setBurgerMenu(true);
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
        {/* Header partage : floating en absolute par-dessus le contenu pour
            que le scroll passe dessous -> effet glass/blur iOS classique. */}
        <View
          onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 }}
        >
          <AppHeader
            runnerFirstName={runnerSession?.profile?.firstName || ''}
            selfieUri={selfieUri}
            selfieUploadState={selfieUploadState}
            onOpenProfile={() => setBurgerMenu(true)}
            onLogoPress={() => {
              if (bottomTab === 'home') setHomeScrollSignal((n) => n + 1);
              setBottomTab('home');
              setOpenedEvent(null);
              setOrganizerEventPhotosTarget(null);
            }}
          />
        </View>
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
                  headerH={headerH}
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
                  onOpenProfile={() => setBurgerMenu(true)}
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
                    headerH={headerH}
                    events={events}
                    runnerFirstName={runnerSession?.profile?.firstName || ''}
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

      <BurgerMenuModal
        visible={burgerMenu}
        onClose={() => setBurgerMenu(false)}
        isAuthed={!!runnerSession}
        runnerFirstName={runnerSession?.profile?.firstName || ''}
        selfieUri={selfieUri}
        selfieUploadState={selfieUploadState}
        cartTotal={cartGlobalTotal}
        onOpenAccount={() => setProfileMenu(true)}
        onOpenMyPhotos={() => setBottomTab('photos')}
        onOpenPanier={() => setPanierModalVisible(true)}
        onOpenOrgRole={handlePickRole}
        onLogout={logoutRunner}
        onDeleteFaceData={deleteFaceData}
        onDeleteAccount={deleteRunnerAccount}
        onOpenAuthLogin={() => { setAuthInitialMode('login'); setAuthModalVisible(true); }}
        onOpenAuthSignup={() => { setAuthInitialMode('register'); setAuthModalVisible(true); }}
        onViewSelfie={() => setSelfieViewer(true)}
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
