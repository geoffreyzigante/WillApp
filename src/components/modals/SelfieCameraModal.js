// Modal camera selfie : viewport camera custom avec masque ovale.
//
// Camera avant en VisionCamera. Le selfie sert de reference biometrique :
// sa qualite conditionne le taux de reconnaissance le jour de l event. D ou
// le guidage actif (2026-09-01) :
//
//   1. Detection de visage en direct (meme plugin natif que la capture
//      course, cf. src/services/frameProcessors.js), ~6 analyses/s.
//   2. Un seul message d aide a la fois, dans une bande arrondie en bas de
//      l ecran : trop loin, trop pres, decentre, plusieurs visages, de trois
//      quarts.
//   3. Declenchement automatique quand le cadrage est bon et stable : le
//      contour de l ovale se remplit en 2 s puis la photo part seule. Le
//      declencheur rose reste pose sur la bande : il devance l auto, et
//      reste le seul chemin sur un telephone ou la detection ne mordrait pas.
//   4. Revue avant validation, en vert : la photo dans le meme ovale,
//      "Reprendre" ou "Garder". L image enregistree reste l image complete
//      (Rekognition travaille mieux sur le cadre entier qu un crop serre) —
//      l ovale est un guide de cadrage, pas un rognage.
//
// Charte des deux etats (maquettes user 2026-09-01) : voile clair teinte +
// bande basse bombee, violette pendant le guidage, verte a la revue.
//
// Audit B13 : meme pattern que PhotographerScreen pour gerer le cas
// permission deja denied de facon permanente cote iOS.

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, Dimensions, Animated, Platform, StyleSheet, Alert, Linking } from 'react-native';
import { Camera as VisionCamera, useCameraPermission, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Svg, { Defs, Mask, Rect, Ellipse, Path, Polygon } from 'react-native-svg';
import { detectHumans } from '../../services/frameProcessors';
import { s } from '../../constants/styles';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// Criteres de cadrage, exprimes PAR RAPPORT A L OVALE et non en fraction du
// buffer camera (refonte 2026-10-25, cf. commentaire « un seul referentiel »
// plus bas). 1.0 = la boite de visage remplit exactement la cible.
//
// La cible n est pas l ovale entier : Vision ne cadre que du sourcil au
// menton et de joue a joue, ni cheveux ni haut du front. Un visage qui
// remplit l ovale a l oeil donne donc une boite d environ 80 % de sa largeur
// et 75 % de sa hauteur. Ces deux fractions sont anatomiques, pas materielles :
// elles valent sur tous les telephones.
const CIBLE_PART_W = 0.80;
const CIBLE_PART_H = 0.75;
// Tolerance autour de la cible. Large volontairement : trop pres degrade moins
// la reconnaissance que trop loin, et un etau serre bloquerait l inscription.
const REMPLISSAGE_MIN = 0.86;
const REMPLISSAGE_MAX = 1.22;
// Ecart de centrage tolere, en fraction de la hauteur de l ovale.
const ECART_MAX = 0.18;

// Angles de pose toleres, en degres.
//
// Le buffer de la camera avant arrive retourne : un visage parfaitement droit
// mesure roll = 180 et non 0 (releve terrain). On ramene donc le roll a son
// ecart a la verticale avant de le comparer au seuil. Le yaw, lui, est direct
// (5 deg sur un visage de face).
const YAW_MAX = 18;
const ROLL_MAX = 16;

// Marge avant declenchement : le temps de se stabiliser, pas de se figer.
const DELAI_AUTO = 2000;
// Diametre du declencheur rose pose sur le sommet de la bande.
const PASTILLE = 96;

// Bandeau de mesure a l ecran (n / rempl / ecart / yaw / roll). Seuils cales,
// on le laisse a false ; le repasser a true pour un nouveau calage terrain.
const DEBUG_GUIDAGE = false;

const VIOLET = '#7B2FFF';
const ROSE = '#f4a6ff';
const VERT = '#5FC177';
// Voile : violet fonce tres leger — assez pour poser le hors-cadre en
// retrait, assez transparent pour qu on continue a se voir autour de l ovale.
// A la revue, meme densite, teintee du vert de l etat.
const VOILE_GUIDAGE = 'rgba(38,20,72,0.34)';
const VOILE_REVUE = 'rgba(16,54,32,0.34)';
// Duree du fondu entre guidage et revue.
const DUREE_BASCULE = 320;

const MESSAGES = {
  rien: 'Place ton visage dans l’ovale',
  plusieurs: 'Un seul visage dans le cadre',
  loin: 'Approche-toi un peu',
  pres: 'Recule un peu',
  decentre: 'Centre ton visage dans l’ovale',
  profil: 'Regarde bien l’objectif',
  ok: 'Ne bouge plus…',
};

// Icônes mentions RGPD (mêmes tracés que le site, viewBox 0 0 16.97 15.73).
function IcoCadena({ size = 14, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16.97 15.73">
      <Path fill={color} d="M15.46,4.18h-2.36v-1.25c0-1.62-1.34-2.93-2.99-2.93h-3.26c-1.65,0-2.99,1.31-2.99,2.93v1.25H1.5C.67,4.18,0,4.84,0,5.66v8.6C0,15.07.67,15.73,1.5,15.73h13.96c.83,0,1.5-.66,1.5-1.47V5.66c0-.81-.67-1.47-1.5-1.47ZM5.98,2.99c0-.61.47-1.11,1.06-1.11h2.89c.58,0,1.06.5,1.06,1.11v1.19h-5v-1.19ZM15.08,11.79c0,1.14-.68,2.06-1.52,2.06H3.4c-.84,0-1.52-.92-1.52-2.06v-3.66c0-1.14.68-2.06,1.52-2.06h10.17c.84,0,1.52.92,1.52,2.06v3.66Z" />
      <Path fill={color} d="M9.85,11.67l-.39-1.3c-.09-.29,0-.6.2-.83.21-.26.34-.59.34-.95,0-.84-.68-1.51-1.51-1.51h0c-.84,0-1.51.68-1.51,1.51,0,.36.13.69.34.95.19.24.28.54.2.83l-.39,1.3c-.16.55.25,1.11.83,1.11h1.07c.58,0,.99-.55.83-1.11Z" />
    </Svg>
  );
}
function IcoServeur({ size = 14, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16.97 15.73">
      <Ellipse fill={color} cx="8.48" cy="7.86" rx="8.48" ry="7.86" />
      <Ellipse fill="rgba(0,0,0,0.45)" cx="8.48" cy="7.86" rx="6.6" ry="6.12" />
      <Ellipse fill={color} cx="8.48" cy="7.86" rx="4.75" ry="7.86" />
      <Ellipse fill="rgba(0,0,0,0.45)" cx="8.48" cy="7.86" rx="2.81" ry="6.12" />
      <Ellipse fill={color} cx="8.48" cy="7.86" rx="0.92" ry="7.86" />
      <Rect fill={color} x="0.48" y="6.92" width="16.02" height="1.88" />
    </Svg>
  );
}
function IcoDuree({ size = 14, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16.97 15.73">
      <Ellipse fill={color} cx="8.48" cy="7.86" rx="8.48" ry="7.86" />
      <Ellipse fill="rgba(0,0,0,0.45)" cx="8.48" cy="7.86" rx="6.6" ry="6.12" />
      <Polygon fill="rgba(0,0,0,0.45)" points="6.61 3.1 6.91 9.32 8.48 10.58 13.4 10.58 14.01 7.23 12.59 4.23 9.32 2.43 6.61 3.1" />
      <Path fill={color} d="M9.42,7.78V3.1h-1.88v4.67h0c0,1.04.84,1.88,1.88,1.88h3.06v-1.88h-3.06Z" />
    </Svg>
  );
}

const MENTIONS_SELFIE = [
  { Ico: IcoCadena, label: 'Chiffré' },
  { Ico: IcoServeur, label: 'Serveurs européens' },
  { Ico: IcoDuree, label: '12 mois' },
];

// Mentions RGPD qui défilent une par une (fade in/out) avec leur icône,
// posées juste au-dessus de l ovale. Même comportement que le site.
function MentionsRotator({ topOffset, opacity }) {
  const [idx, setIdx] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let vivant = true;
    const id = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        if (!vivant) return;
        setIdx((i) => (i + 1) % MENTIONS_SELFIE.length);
        Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 2000);
    return () => { vivant = false; clearInterval(id); };
  }, [fade]);
  const { Ico, label } = MENTIONS_SELFIE[idx];
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: topOffset, left: 24, right: 24,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        opacity: Animated.multiply(opacity, fade),
      }}
    >
      <Ico size={14} color="rgba(255,255,255,0.9)" />
      <Text style={{ marginLeft: 6, color: 'rgba(255,255,255,0.9)', fontSize: 12, fontFamily: 'Montserrat-Medium', letterSpacing: 0.2 }}>
        {label}
      </Text>
    </Animated.View>
  );
}

export function SelfieCameraModal({ visible, onClose, onCaptured }) {
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  // U-I05 : pas de contrainte physicalDevices. Sur Android, imposer
  // 'wide-angle-camera' fait retourner undefined selon le modele (Samsung,
  // OnePlus…) et bloque le selfie sur ecran noir. iOS a toujours au moins un
  // wide-angle en caméra frontale, la contrainte etait redondante.
  const device = useCameraDevice('front');
  const [busy, setBusy] = useState(false);
  const [hasRequestedCameraPermission, setHasRequestedCameraPermission] = useState(false);
  const cameraPermissionDenied = hasRequestedCameraPermission && !hasPermission;
  const requestCameraPermission = async () => {
    setHasRequestedCameraPermission(true);
    await requestPermission();
  };
  // Meme precaution que l espace photographe : on ne monte pas la camera
  // dans la milliseconde ou iOS referme sa feuille d autorisation, sinon la
  // session se configure pendant la bascule du systeme et l app tombe. Le
  // delai ne s applique qu a la toute premiere autorisation.
  const [cameraPrete, setCameraPrete] = useState(false);
  useEffect(() => {
    if (!hasPermission) { setCameraPrete(false); return; }
    if (!hasRequestedCameraPermission) { setCameraPrete(true); return; }
    const t = setTimeout(() => setCameraPrete(true), 600);
    return () => clearTimeout(t);
  }, [hasPermission, hasRequestedCameraPermission]);

  useEffect(() => {
    if (visible && !hasPermission) {
      setHasRequestedCameraPermission(true);
      requestPermission();
    }
  }, [visible, hasPermission]);

  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  // OVALE : voir plus bas, il depend de la bande basse.
  const cx = winW / 2;
  // Approximation safe-area bas : home indicator iOS ~34, +24 demandes.
  const bottomInset = Platform.OS === 'ios' ? 58 : 32;
  const topInset = Platform.OS === 'ios' ? 58 : 28;

  // Bande basse bombee : bord superieur en arc, sommet au centre. L ovale se
  // cale au-dessus d elle plutot qu au centre geometrique de l ecran.
  const BANDE_H = 210;
  const BOMBE = 34;
  const bandeY = winH - BANDE_H;
  const bandePath = `M0,${winH} L0,${bandeY} Q${winW / 2},${bandeY - BOMBE * 2} ${winW},${bandeY} L${winW},${winH} Z`;
  // L ovale est centre sur l ECRAN, pas sur l espace libre au-dessus de la
  // bande (correction 2026-10-25).
  //
  // Le critere de centrage compare le centre du visage au centre de l image
  // (0,5 ; 0,5) et tolere 0,13 d ecart. Tant que l ovale etait cale au-dessus
  // de la bande, son centre tombait vers 0,38 de la hauteur : un visage juge
  // « bien centre » par le code apparaissait donc 12 % plus bas que l ovale,
  // menton dessous. Le guide disait une chose, la regle en mesurait une
  // autre — et c est la regle qui declenchait.
  //
  // Le clamp garde l ovale au-dessus de la bande sur les petits ecrans ; sur
  // un iPhone courant il ne s applique pas.
  // L ovale suit l ecran sur SES DEUX axes.
  //
  // En dur a 260 x 340 pt il occupait 81 % de la largeur d un iPhone SE et
  // 59 % de celle d un Pro Max : meme guide, deux cadrages demandes. Mais la
  // largeur seule ne suffit pas — calcule : sur SE (320 x 568) un ovale de
  // 275 pt de haut deborde de 17 pt sur la bande basse, le menton du guide
  // passant sous le bouton. La hauteur disponible entre la safe area et l arc
  // de la bande est donc la seconde borne.
  const dispoH = (bandeY - BOMBE - 12) - (topInset + 8);
  const hParLargeur = Math.max(210, Math.min(300, winW * 0.62)) * (340 / 260);
  const OVAL_H = Math.round(Math.max(200, Math.min(hParLargeur, dispoH)));
  const OVAL_W = Math.round(OVAL_H * (260 / 340));

  const cyIdeal = winH / 2;
  const cyMax = bandeY - BOMBE - OVAL_H / 2 - 12;
  const cyMin = OVAL_H / 2 + topInset + 8;
  const cy = Math.max(cyMin, Math.min(cyIdeal, cyMax));

  // Decalage entre le centre de l ovale et celui de l image. Le « cover »
  // centre le recadrage, donc le centre de l image tombe au centre de l ecran :
  // tout ecart de l ovale a ce centre doit etre retranche de la mesure, sinon
  // la regle demande un cadrage que le guide ne montre pas. Calcule : sur un
  // iPhone SE 2/3 (375 x 667) la bande de 210 pt force l ovale 74 pt au-dessus
  // du centre, soit plus que la tolerance — un visage pose dans l ovale aurait
  // ete refuse en boucle.
  const decalageOval = cy - winH / 2;

  // Perimetre de l ovale (Ramanujan) : sert au remplissage progressif du
  // contour pendant le compte a rebours de la capture automatique.
  const perimetre = useMemo(() => {
    const a = OVAL_W / 2;
    const b = OVAL_H / 2;
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  }, [OVAL_W, OVAL_H]);

  const [etat, setEtat] = useState('rien');
  // Message affiche, distinct de l etat mesure : il ne suit qu apres
  // stabilisation (user 2026-10-25). A 6 Hz, un visage qui oscille autour
  // d un seuil faisait clignoter les consignes — illisible, et anxiogene
  // sur un ecran ou l on se regarde. L etat brut, lui, continue de piloter
  // le declencheur et l anneau : seule la phrase attend.
  const [messageEtat, setMessageEtat] = useState('rien');
  const messageOpacite = useRef(new Animated.Value(1)).current;
  const [mesure, setMesure] = useState('');
  const [apercu, setApercu] = useState(null);
  const etatRef = useRef('rien');
  const mesureRef = useRef('');

  const anneau = useRef(new Animated.Value(0)).current;      // 0 -> 1
  const flash = useRef(new Animated.Value(0)).current;
  const captureScale = useRef(new Animated.Value(1)).current;
  const minuterie = useRef(null);

  const onCapturePressIn = () => {
    Animated.spring(captureScale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onCapturePressOut = () => {
    Animated.spring(captureScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  // Le declencheur refuse tant que le cadrage n est pas bon (user
  // 2026-10-25). Le guidage existait deja — six etats, six messages — mais le
  // bouton rose, lui, ne le consultait pas : on pouvait photographier un
  // visage coupe pendant que la bande affichait « Recule un peu ». Un selfie
  // mal cadre, c est une reference biometrique mediocre pour toute la saison.
  //
  // Refuser sans rien dire serait pire : l appui rate secoue le message et
  // declenche un retour haptique d avertissement, pour qu on regarde la
  // consigne plutot que le bouton.
  const secousse = useRef(new Animated.Value(0)).current;
  const refuserCapture = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    secousse.setValue(0);
    Animated.sequence([
      Animated.timing(secousse, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(secousse, { toValue: -1, duration: 120, useNativeDriver: true }),
      Animated.timing(secousse, { toValue: 0.6, duration: 100, useNativeDriver: true }),
      Animated.timing(secousse, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();
  }, [secousse]);

  const shoot = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    if (etatRef.current !== 'ok') { refuserCapture(); return; }
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      const path = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      // Revue avant validation : rien n est transmis tant que l utilisateur
      // n a pas dit "Garder".
      setApercu(path);
    } catch (e) {
      Alert.alert('Erreur', e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, flash, refuserCapture]);

  const shootRef = useRef(shoot);
  useEffect(() => { shootRef.current = shoot; }, [shoot]);

  // Analyse -> etat. Appelee ~6 fois par seconde depuis le worklet ; on ne
  // re-rend que sur changement reel d etat.
  const onAnalyseJS = useMemo(
    () => Worklets.createRunOnJS((n, remplissage, ecart, pose, yaw, roll) => {
      let e;
      if (n === 0) e = 'rien';
      else if (n > 1) e = 'plusieurs';
      else if (remplissage < REMPLISSAGE_MIN) e = 'loin';
      else if (remplissage > REMPLISSAGE_MAX) e = 'pres';
      else if (ecart > ECART_MAX) e = 'decentre';
      else if (pose === 1 && (yaw > YAW_MAX || roll > ROLL_MAX)) e = 'profil';
      else e = 'ok';
      if (etatRef.current !== e) {
        etatRef.current = e;
        setEtat(e);
      }
      if (DEBUG_GUIDAGE) {
        const txt =
          'n=' + n + '  rempl=' + remplissage.toFixed(2) + '  ecart=' + ecart.toFixed(2) +
          (pose === 1 ? '  yaw=' + Math.round(yaw) + '  roll=' + Math.round(roll) : '  (pose absente)');
        mesureRef.current = txt;
        setMesure(txt);
      }
    }),
    [],
  );

  const analyseActiveSV = useMemo(() => Worklets.createSharedValue(false), []);
  const skipSV = useMemo(() => Worklets.createSharedValue(0), []);

  useEffect(() => {
    analyseActiveSV.value = !!(visible && cameraPrete && hasPermission && !apercu);
  }, [visible, cameraPrete, hasPermission, apercu, analyseActiveSV]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (!analyseActiveSV.value) return;
    // ~30 fps en entree, une analyse sur cinq : 6 Hz suffisent pour un
    // guidage fluide et laissent le CPU tranquille.
    skipSV.value = (skipSV.value + 1) % 5;
    if (skipSV.value !== 0) return;
    const res = detectHumans(frame, { zoneWidthPercent: 1, axis: 'midX', humans: false });
    const faces = res && res.faces ? res.faces : [];
    const n = faces.length;

    // UN SEUL REFERENTIEL : le point ecran.
    //
    // Les coordonnees de Vision sont des fractions du buffer camera. Les
    // comparer a des seuils fixes supposait un buffer et un ecran donnes :
    // sur un autre telephone, le meme seuil ne decrit plus le meme cadrage.
    // Deux variables changent d un appareil a l autre — le format du buffer
    // (16:9 ou 4:3, le facteur entre les deux atteint 1,33) et la taille de
    // l ecran, puisque l apercu est en « cover » — et elles se composent.
    // On ramene donc la boite de visage en points d ecran, pour la comparer a
    // l ovale lui-meme. Le guide et la regle ne peuvent plus diverger.
    //
    // Cover : l apercu couvre l ecran, le grand axe du buffer tient la hauteur.
    //
    // On ne compare jamais frame.width a une constante : selon la version de
    // VisionCamera le buffer est annonce brut (1920 x 1080) ou deja redresse
    // (1080 x 1920). Les deux axes sont donc designes par leur taille — long
    // et court — et chaque fraction est multipliee par le sien. Releve terrain
    // 2026-10-25 : f.w est la fraction du grand axe (0,243 pour un visage de
    // 198 pt de haut) et f.h celle du petit (0,343 pour 157 pt de large) ; les
    // deux retombent au point pres sur la capture, ce qui fixe l appariement.
    const bufLong = frame.width > frame.height ? frame.width : frame.height;
    const bufCourt = frame.width > frame.height ? frame.height : frame.width;
    const ech = Math.max(winW / bufCourt, winH / bufLong);

    let remplissage = 0;
    let ecart = 1;
    let pose = 0;
    let yaw = 0;
    let roll = 0;
    for (let i = 0; i < n; i++) {
      const f = faces[i];
      // Les deux cotes de la boite, en points d ecran ; le plus grand est la
      // hauteur, un visage etant plus haut que large.
      const c1 = f.w * bufLong * ech;
      const c2 = f.h * bufCourt * ech;
      const hPt = c1 > c2 ? c1 : c2;
      const wPt = c1 > c2 ? c2 : c1;
      // Part de la cible atteinte, sur l axe le plus contraignant.
      const rW = wPt / (OVAL_W * CIBLE_PART_W);
      const rH = hPt / (OVAL_H * CIBLE_PART_H);
      const r = rW > rH ? rW : rH;
      if (r > remplissage) {
        remplissage = r;
        // Ecart a l OVALE, pas au centre de l image. L axe vertical est celui
        // dont l extension mesuree est la plus grande — un visage est plus
        // haut que large — donc aucune hypothese materielle ici non plus.
        const vertEstLong = c1 > c2;
        const dBrut = vertEstLong
          ? (f.cx - 0.5) * bufLong * ech
          : (f.cy - 0.5) * bufCourt * ech;
        const dH = vertEstLong
          ? (f.cy - 0.5) * bufCourt * ech
          : (f.cx - 0.5) * bufLong * ech;
        // Le sens de l axe vertical depend de l orientation du capteur et n a
        // pas ete releve sur appareil. On retient donc la plus petite des deux
        // lectures : sous l une comme sous l autre convention, un visage pose
        // dans l ovale lit zero. Le seul faux positif possible est un visage
        // place au double du decalage de l autre cote, c est-a-dire derriere
        // la bande basse, la ou personne ne se cadre. A reduire a une branche
        // des que la convention sera relevee sur appareil.
        const dv1 = dBrut - decalageOval;
        const dv2 = -dBrut - decalageOval;
        const dV = Math.abs(dv1) < Math.abs(dv2) ? dv1 : dv2;
        ecart = Math.sqrt(dH * dH + dV * dV) / OVAL_H;
        // Champs absents sur les builds anterieurs : pose reste a 0 et le
        // critere d orientation est simplement ignore.
        pose = f.pose === 1 ? 1 : 0;
        yaw = f.yaw < 0 ? -f.yaw : (f.yaw || 0);
        // Ecart a la verticale : 0 et 180 valent tous deux "droit".
        const r0 = f.roll < 0 ? -f.roll : (f.roll || 0);
        roll = r0 > 90 ? 180 - r0 : r0;
      }
    }
    onAnalyseJS(n, remplissage, ecart, pose, yaw, roll);
  }, [onAnalyseJS, analyseActiveSV, skipSV, winW, winH, OVAL_W, OVAL_H, decalageOval]);

  // Stabilisation de la consigne : 450 ms sans changement d etat avant de
  // remplacer la phrase, et un fondu plutot qu une coupe.
  useEffect(() => {
    if (etat === messageEtat) return;
    const t = setTimeout(() => {
      Animated.timing(messageOpacite, { toValue: 0, duration: 110, useNativeDriver: true })
        .start(({ finished }) => {
          if (!finished) return;
          setMessageEtat(etat);
          Animated.timing(messageOpacite, { toValue: 1, duration: 170, useNativeDriver: true }).start();
        });
    }, 450);
    return () => clearTimeout(t);
  }, [etat, messageEtat, messageOpacite]);

  // Declenchement automatique : le cadrage doit rester bon pendant tout le
  // remplissage de l anneau. Le moindre ecart annule et remet a zero.
  useEffect(() => {
    const pret = etat === 'ok' && !busy && !apercu && visible;
    if (!pret) {
      if (minuterie.current) { clearTimeout(minuterie.current); minuterie.current = null; }
      anneau.stopAnimation();
      Animated.timing(anneau, { toValue: 0, duration: 160, useNativeDriver: false }).start();
      return;
    }
    Animated.timing(anneau, { toValue: 1, duration: DELAI_AUTO, useNativeDriver: false }).start();
    minuterie.current = setTimeout(() => { shootRef.current?.(); }, DELAI_AUTO);
    return () => {
      if (minuterie.current) { clearTimeout(minuterie.current); minuterie.current = null; }
    };
  }, [etat, busy, apercu, visible, anneau]);

  // Fermeture / reouverture : on repart d un etat propre.
  useEffect(() => {
    if (!visible) {
      setApercu(null);
      setEtat('rien');
      setMessageEtat('rien');
      messageOpacite.setValue(1);
      etatRef.current = 'rien';
      anneau.setValue(0);
    }
  }, [visible, anneau]);

  const dashoffset = anneau.interpolate({ inputRange: [0, 1], outputRange: [perimetre, 0] });

  // Bascule guidage <-> revue : les deux habillages sont montes en meme temps
  // et se croisent en opacite. Un simple changement de couleur "claquait" ;
  // le fondu rend la validation nettement plus douce.
  const bascule = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(bascule, {
      toValue: apercu ? 1 : 0,
      duration: DUREE_BASCULE,
      useNativeDriver: true,
    }).start();
  }, [apercu, bascule]);
  const opaciteGuidage = bascule.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {apercu ? (
          <ExpoImage source={{ uri: apercu }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : hasPermission && cameraPrete && device ? (
          <VisionCamera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={visible}
            photo={true}
            zoom={device.minZoom}
            resizeMode="cover"
            frameProcessor={frameProcessor}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#1A1426' }}>
            <Text style={{ fontFamily: 'Montserrat', color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 16 }}>
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

        {/* Habillage revue (vert), pose dessous : c est lui qu on decouvre
            quand l habillage de guidage s efface. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <Mask id="selfieMaskRevue">
                <Rect width="100%" height="100%" fill="white" />
                <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} fill="black" />
              </Mask>
            </Defs>
            <Rect width="100%" height="100%" fill={VOILE_REVUE} mask="url(#selfieMaskRevue)" />
            <Path d={bandePath} fill={VERT} />
          </Svg>
        </View>

        {/* Habillage guidage (violet), en fondu par-dessus. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opaciteGuidage }]} pointerEvents="none">
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <Mask id="selfieMaskGuidage">
                <Rect width="100%" height="100%" fill="white" />
                <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} fill="black" />
              </Mask>
            </Defs>
            <Rect width="100%" height="100%" fill={VOILE_GUIDAGE} mask="url(#selfieMaskGuidage)" />
            <Path d={bandePath} fill={VIOLET} />
          </Svg>
        </Animated.View>

        {/* Aucun contour permanent autour de l ovale : le seul trace est le
            remplissage rose du compte a rebours. */}
        {!apercu && (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <AnimatedEllipse
              cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2}
              stroke={ROSE}
              strokeWidth={5}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${perimetre}, ${perimetre}`}
              strokeDashoffset={dashoffset}
            />
          </Svg>
        )}

        {/* Rappel RGPD la ou il compte : au moment ou on pointe une camera
            sur son visage. Les trois mentions defilent une par une, posees
            juste au-dessus de l ovale. */}
        <MentionsRotator topOffset={cy - OVAL_H / 2 - 30} opacity={opaciteGuidage} />

        {/* Contenu de la bande : message pendant le guidage, choix a la revue.
            Les deux sont montes en permanence et se croisent en opacite. */}
        <Animated.View
          pointerEvents={apercu ? 'auto' : 'none'}
          style={{
            position: 'absolute', bottom: bottomInset + 70, left: 24, right: 24,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
            opacity: bascule,
          }}
        >
          <TouchableOpacity
            onPress={() => { setApercu(null); setEtat('rien'); etatRef.current = 'rien'; }}
              activeOpacity={0.85}
              style={{
                flex: 1, height: 50, borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.28)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Reprendre</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { const u = apercu; setApercu(null); onCaptured?.(u); }}
              activeOpacity={0.9}
              style={{
                flex: 1, height: 50, borderRadius: 12,
                backgroundColor: VIOLET,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Garder</Text>
            </TouchableOpacity>
        </Animated.View>

        {/* Declencheur manuel : pastille rose posee a cheval sur le sommet de
            la bande. La capture auto ne fait que devancer le geste — sur un
            telephone ou la detection ne mordrait pas, il reste le seul
            chemin. */}
        <Animated.View
          pointerEvents={apercu ? 'none' : 'auto'}
          style={{
            position: 'absolute',
            top: bandeY - BOMBE - PASTILLE / 2 + 6,
            left: cx - PASTILLE / 2,
            opacity: opaciteGuidage,
            transform: [{ scale: captureScale }],
          }}
        >
          <TouchableOpacity
            onPress={shoot}
            onPressIn={onCapturePressIn}
            onPressOut={onCapturePressOut}
            disabled={busy || !hasPermission || !device}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Prendre le selfie"
            accessibilityHint={etat === 'ok' ? undefined : MESSAGES[etat] || MESSAGES.rien}
            accessibilityState={{ disabled: etat !== 'ok' }}
            style={{
              width: PASTILLE, height: PASTILLE, borderRadius: PASTILLE / 2,
              backgroundColor: ROSE,
              // Pas pret : la pastille s eteint sans disparaitre, pour rester
              // une cible identifiable plutot qu un fantome.
              opacity: busy || !hasPermission || !device ? 0.5 : (etat === 'ok' ? 1 : 0.42),
              borderWidth: etat === 'ok' ? 0 : 2,
              borderColor: 'rgba(255,255,255,0.65)',
            }}
          />
        </Animated.View>

        <Animated.Text
          pointerEvents="none"
          style={{
            position: 'absolute', bottom: bottomInset + 74, left: 24, right: 24,
            textAlign: 'center', color: '#fff',
            fontSize: 17, fontFamily: 'Montserrat-SemiBold',
            opacity: Animated.multiply(opaciteGuidage, messageOpacite),
            transform: [{
              translateX: secousse.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] }),
            }],
          }}
        >
          {MESSAGES[messageEtat] || MESSAGES.rien}
        </Animated.Text>

        {/* Fermeture, dans la bande, sous le contenu. */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={12}
          style={{
            position: 'absolute',
            bottom: bottomInset - 12,
            left: 0, right: 0,
            alignItems: 'center',
          }}
        >
          <View style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: 'rgba(255,255,255,0.25)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
            </Svg>
          </View>
        </TouchableOpacity>

        {DEBUG_GUIDAGE && !apercu ? (
          <Text style={{
            position: 'absolute', top: topInset + 26, left: 12, right: 12,
            textAlign: 'center', color: '#3b3446', fontSize: 11,
            fontFamily: 'Montserrat',
          }}>
            {mesure || 'mesure…'}
          </Text>
        ) : null}

        {/* Flash de capture. */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]}
        />
      </View>
    </Modal>
  );
}
