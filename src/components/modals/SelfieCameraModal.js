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
import Svg, { Defs, Mask, Rect, Ellipse, Path } from 'react-native-svg';
import { detectHumans } from '../../services/frameProcessors';
import { s } from '../../constants/styles';

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

// Calage 2026-09-01, mesures relevees sur iPhone : un visage qui remplit
// exactement l ovale donne taille = 0.47 et dist = 0.00. La fenetre est
// centree sur cette valeur ; au-dela de 0.60 la tete deborde de l ovale, en
// dessous de 0.36 elle y flotte.
const TAILLE_MIN = 0.36;
const TAILLE_MAX = 0.60;
const DIST_MAX = 0.13;

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

// Bandeau de mesure a l ecran (n / taille / dist / yaw / roll). Seuils cales,
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
  const OVAL_W = 260;
  const OVAL_H = 340;
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
  const cy = Math.max(OVAL_H / 2 + topInset + 40, (bandeY - BOMBE) / 2 + 20);

  // Perimetre de l ovale (Ramanujan) : sert au remplissage progressif du
  // contour pendant le compte a rebours de la capture automatique.
  const perimetre = useMemo(() => {
    const a = OVAL_W / 2;
    const b = OVAL_H / 2;
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  }, []);

  const [etat, setEtat] = useState('rien');
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

  const shoot = useCallback(async () => {
    if (!cameraRef.current || busy) return;
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
  }, [busy, flash]);

  const shootRef = useRef(shoot);
  useEffect(() => { shootRef.current = shoot; }, [shoot]);

  // Analyse -> etat. Appelee ~6 fois par seconde depuis le worklet ; on ne
  // re-rend que sur changement reel d etat.
  const onAnalyseJS = useMemo(
    () => Worklets.createRunOnJS((n, taille, dist, pose, yaw, roll) => {
      let e;
      if (n === 0) e = 'rien';
      else if (n > 1) e = 'plusieurs';
      else if (taille < TAILLE_MIN) e = 'loin';
      else if (taille > TAILLE_MAX) e = 'pres';
      else if (dist > DIST_MAX) e = 'decentre';
      else if (pose === 1 && (yaw > YAW_MAX || roll > ROLL_MAX)) e = 'profil';
      else e = 'ok';
      if (etatRef.current !== e) {
        etatRef.current = e;
        setEtat(e);
      }
      if (DEBUG_GUIDAGE) {
        const txt =
          'n=' + n + '  taille=' + taille.toFixed(2) + '  dist=' + dist.toFixed(2) +
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
    let taille = 0;
    let dist = 1;
    let pose = 0;
    let yaw = 0;
    let roll = 0;
    for (let i = 0; i < n; i++) {
      const f = faces[i];
      const t = f.w > f.h ? f.w : f.h;
      if (t > taille) {
        taille = t;
        const dx = f.cx - 0.5;
        const dy = f.cy - 0.5;
        dist = Math.sqrt(dx * dx + dy * dy);
        // Champs absents sur les builds anterieurs : pose reste a 0 et le
        // critere d orientation est simplement ignore.
        pose = f.pose === 1 ? 1 : 0;
        yaw = f.yaw < 0 ? -f.yaw : (f.yaw || 0);
        // Ecart a la verticale : 0 et 180 valent tous deux "droit".
        const r0 = f.roll < 0 ? -f.roll : (f.roll || 0);
        roll = r0 > 90 ? 180 - r0 : r0;
      }
    }
    onAnalyseJS(n, taille, dist, pose, yaw, roll);
  }, [onAnalyseJS, analyseActiveSV, skipSV]);

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
            sur son visage. */}
        <Animated.Text
          pointerEvents="none"
          style={{
            position: 'absolute', top: topInset, left: 24, right: 24,
            textAlign: 'center', color: 'rgba(255,255,255,0.8)',
            fontSize: 12, fontFamily: 'Montserrat-Medium', letterSpacing: 0.2,
            opacity: opaciteGuidage,
          }}
        >
          Chiffré · serveurs européens · 12 mois
        </Animated.Text>

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
            style={{
              width: PASTILLE, height: PASTILLE, borderRadius: PASTILLE / 2,
              backgroundColor: ROSE,
              opacity: busy || !hasPermission || !device ? 0.5 : 1,
            }}
          />
        </Animated.View>

        <Animated.Text
          pointerEvents="none"
          style={{
            position: 'absolute', bottom: bottomInset + 74, left: 24, right: 24,
            textAlign: 'center', color: '#fff',
            fontSize: 17, fontFamily: 'Montserrat-SemiBold',
            opacity: opaciteGuidage,
          }}
        >
          {MESSAGES[etat] || MESSAGES.rien}
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
