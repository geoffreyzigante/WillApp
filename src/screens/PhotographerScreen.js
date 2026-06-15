// Ecran photographe : capture pipeline complete avec frame processor Apple
// Vision, queue d upload offline-first persistante, integration BackgroundUploader
// natif iOS (Background URLSession), ThermalMonitor + Battery monitoring.
//
// Frame processor : detectHumans + readExposure sont des worklets natifs
// VisionCamera (initialises au module load). MUST rester dans CE fichier
// car leur scope est lie a la lifecycle du screen + babel-preset-expo
// compile les `'worklet'` directives par fichier.
//
// Pipeline capture decouple (refactor mai 2026) :
//   capture (takePhoto) -> raw/{id}.heic + sidecar JSON -> queue pending
//   processQueue worker (single-flight) -> burn EXIF natif -> processed/
//   drainQueue worker (3 parallels) -> PUT R2 via BackgroundUploader
//
// Sprint perf juin 2026 (A1+A2+B1+B2) :
//   - useKeepAwake : ecran allume tant que session ouverte
//   - Cadence Vision dynamique (10 fps actif / 5 fps idle apres 30s)
//   - Battery auto-pause < 10% si pas en charge
//   - BackgroundUploader = upload continue app minimisee (HTTP/3, streaming)
//   - ThermalMonitor = CONCURRENCY adaptatif (3/2/1 selon nominal/serious/critical)

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions,
  StatusBar, SafeAreaView, Platform, Animated, Easing, Linking,
  AppState, Share, NativeModules,
} from 'react-native';
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  useCameraFormat,
  VisionCameraProxy,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolateColor,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Paths, File, Directory } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import * as Battery from 'expo-battery';
import { BlurView } from 'expo-blur';
import Svg, { Path, Rect } from 'react-native-svg';
import { Icon } from '../components/Icon';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { API_URL } from '../constants/api';
import {
  UPLOAD_QUEUE_KEY,
  LAST_CAPTURE_KEY,
  MAX_RETRIES_DEFAULT,
  STORAGE_WARN_BYTES,
  DISK_LOW_BYTES,
  QUEUE_WARN_THRESHOLD,
  MAX_QUEUE_SIZE,
  retryDelayMs,
} from '../constants/queue';
import { formatShutter, formatEV, formatTimeAgo } from '../utils/format';
import { generateItemId } from '../utils/photo';
import {
  pendingDir,
  rawDir,
  processedDir,
  ensurePendingDir,
  writeSidecar,
  readSidecar,
  deleteSidecar,
  loadUploadQueue,
  saveUploadQueue,
  pendingDirSizeBytes,
  pendingDirSizeBytesCached,
} from '../services/storage';
import {
  BackgroundUploaderModule,
  hasBackgroundUploader,
  pendingBgUploads,
} from '../services/backgroundUploader';
import {
  getCurrentThermalState,
  concurrencyForThermal,
} from '../services/thermalMonitor';

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
const exposureReaderPlugin = VisionCameraProxy.initFrameProcessorPlugin('readExposure', {});
function readExposure(frame, options) {
  'worklet';
  if (exposureReaderPlugin == null) {
    throw new Error('readExposure plugin not loaded — rebuild required');
  }
  return options
    ? exposureReaderPlugin.call(frame, options)
    : exposureReaderPlugin.call(frame);
}

export
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
