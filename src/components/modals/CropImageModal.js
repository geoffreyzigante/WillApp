// Modal de cadrage d'image au ratio 2:1 (cover event).
// Gestures pan + pinch combines via Gesture.Simultaneous + Reanimated 3.
// Bounds : scale min 1, max 4 ; pan clampe sur les bords de l image scaled.
// Le crop est calcule en coordonnees source et execute via expo-image-manipulator.

import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, SafeAreaView, Dimensions, Alert } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import ReAnimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { C } from '../../constants/colors';

export function CropImageModal({ visible, asset, onCancel, onConfirm }) {
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
            <TouchableOpacity onPress={onCancel} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(123,47,255,0.3)', alignItems: 'center' }}>
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
