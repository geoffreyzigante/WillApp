// Modal camera selfie : viewport caméra custom avec masque rond circulaire.
// Camera avant en VisionCamera : grand angle natif explicite + viewport
// dimensionne au ratio 4:3 du capteur pour eviter le crop/zoom apparent
// cause par le cover-fill sur ecran 9:19.5.
// Le cercle est purement visuel (overlay SVG), il ne crope pas la preview ;
// l image sauvee est l image native non rognee (le crop carre final reste
// a faire au save cote upload).
//
// Audit B13 : meme pattern que PhotographerScreen pour gerer le cas
// permission deja denied de facon permanente cote iOS.

import React, { useState, useRef, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Dimensions, Animated, Platform, StyleSheet, Alert, Linking } from 'react-native';
import { Camera as VisionCamera, useCameraPermission, useCameraDevice } from 'react-native-vision-camera';
import Svg, { Defs, Mask, Rect, Ellipse, Path } from 'react-native-svg';
import { s } from '../../constants/styles';

export function SelfieCameraModal({ visible, onClose, onCaptured }) {
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front', {
    physicalDevices: ['wide-angle-camera'],
  });
  const [busy, setBusy] = useState(false);
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
  // Ovale decale legerement vers le haut pour laisser respirer la zone
  // capture/croix en bas (qui occupe ~bottomInset + 80 + 16 = 154px).
  const cy = winH / 2 - 40;
  // Approximation safe-area bas : home indicator iOS ~34, +24 demandes.
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

        {/* Voile semi-transparent plein ecran avec trou ovale au centre. */}
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

        {/* Bouton capture centre, style iOS Camera : blanc plein, sans bordure. */}
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

        {/* Croix fermer en bas droite, au meme niveau vertical que le bouton capture. */}
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
