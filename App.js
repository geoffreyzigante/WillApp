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

// Frame processor helpers detectHumans / readExposure -> src/screens/PhotographerScreen.js
// (regroupes avec le seul consumer).

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
import { EventDetailScreen } from './src/screens/EventDetailScreen';
import { PhotoViewerModal } from './src/components/modals/PhotoViewerModal';
import { CreateEventModal } from './src/components/modals/CreateEventModal';
import { PhotographerScreen } from './src/screens/PhotographerScreen';
// Sentry desactive en OTA panic safe : a re-activer apres install du nouveau
// build EAS contenant le module natif @sentry/react-native (build pending).
const initSentry = () => {};
const wrapRootComponent = (C) => C;
const captureError = (e) => console.error('[err]', e?.message || e);
initSentry();
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



function AppRoot() {
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

// Wrap App avec Sentry.wrap : capture les crashes JS du tree React
// + tracker performance (currently off). Si Sentry DSN absent, wrapper
// no-op silencieux (cf src/services/sentry.js).
const App = wrapRootComponent(AppRoot);
export default App;

// ---------- STYLES ----------
