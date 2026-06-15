// Photo viewer plein ecran avec shared-element transition depuis la thumb.
//
// Refonte v2.4 :
// - FlatList horizontal pagingEnabled pour swipe horizontal natif
// - Pan vertical = close (translateY > 100 ou velocity > 800)
// - Pinch zoom + double-tap zoom (1 <-> 2.5x)
// - Reanimated 3 transform-only (translateX/Y + scale) pour la hero anim
//   GPU-accelerated (vs left/top/width/height re-layout cher)
//
// 3 modes UI bas :
//   - Orga : bouton Publier/Masquer (optimistic update local)
//   - Runner photo payante : Ajouter au panier (toggle AsyncStorage via useCart)
//   - Runner photo gratuite : Telecharger (MediaLibrary)
//
// Watermark events payants : gate l'opacite de la photo tant que le PNG
// overlay n'est pas paint pour eviter le screenshot CLEAN entre photo load
// et watermark load.

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, FlatList, Dimensions, Platform,
  StatusBar, AppState, Alert, ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import * as MediaLibrary from 'expo-media-library';
import { Paths, File } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import Svg, { Path } from 'react-native-svg';
import {
  Gesture, GestureDetector, GestureHandlerRootView,
} from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS,
} from 'react-native-reanimated';
import { FavStar } from '../FavStar';
import { C } from '../../constants/colors';
import { detectPhotoExtension } from '../../utils/photo';
import { useCart } from '../../hooks/useCart';

// Flag fonctionnalite Supprimer dans la visionneuse. Refonte 2026-05 : la
// suppression est en stand-by, on cable plus tard avec une confirmation
// adaptee. Garde le code mort pour activer en un flip.
const ENABLE_VIEWER_DELETE = false;

export function PhotoViewerModal({
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

  const targetIndex = useMemo(() => {
    if (!photo || !photos) return 0;
    const i = photos.findIndex(p => p.id === photo.id);
    return i >= 0 ? i : 0;
  }, [photo, photos]);
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (!photo || !photos) return 0;
    const i = photos.findIndex(p => p.id === photo.id);
    return i >= 0 ? i : 0;
  });

  const prevVisibleRef = useRef(false);
  const sessionKeyRef = useRef(0);
  if (visible && !prevVisibleRef.current) {
    sessionKeyRef.current += 1;
    if (currentIndex !== targetIndex) setCurrentIndex(targetIndex);
  }
  prevVisibleRef.current = visible;

  const topPad = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 0);
  const bottomPad = Platform.OS === 'ios' ? 34 : 16;

  const isOrga = !!onTogglePhotoVisibility;
  const isRunner = !!onTogglePhotoFavorite && !isOrga;

  const [localHiddenMap, setLocalHiddenMap] = useState({});
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

  const [wmReady, setWmReady] = useState(!photosForSale);
  useEffect(() => {
    if (!photosForSale || wmReady) return;
    const t = setTimeout(() => setWmReady(true), 600);
    return () => clearTimeout(t);
  }, [photosForSale, wmReady]);

  const { cart, toggle: toggleCartFor } = useCart(photosForSale ? eventCode : null);

  const HEADER_H = 56;
  const BUTTON_AREA_H = 78;
  const RUNNER_BOTTOM_RESERVE = 32;
  const photoMargin = 8;
  const targetW = winWidth - photoMargin * 2;
  const effectiveBottomReserve = isOrga ? BUTTON_AREA_H : RUNNER_BOTTOM_RESERVE;
  const PHOTO_ASPECT = 3 / 4;
  const idealCardH = Math.round(targetW / PHOTO_ASPECT);
  const maxCardH = winHeight - topPad - HEADER_H - effectiveBottomReserve - bottomPad - 8;
  const targetH = Math.min(idealCardH, maxCardH);
  const targetY = topPad + HEADER_H + Math.max(0, (maxCardH - targetH) / 2);

  const entryTx = useSharedValue(0);
  const entryTy = useSharedValue(0);
  const entryScale = useSharedValue(1);
  const pradius = useSharedValue(18);
  const bgOpacity = useSharedValue(0);
  const uiOpacity = useSharedValue(0);

  const HERO_DURATION = 420;
  const HERO_EASING = (t) => {
    'worklet';
    return 1 - Math.pow(1 - t, 4);
  };

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const zoomTranslateX = useSharedValue(0);
  const savedZoomTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

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

  const cardW = winWidth;
  const cardH = targetH;
  const targetCardCx = winWidth / 2;
  const targetCardCy = targetY + targetH / 2;

  const animateIn = () => {
    if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) && origin.w > 0 && origin.h > 0) {
      const originCx = origin.x + origin.w / 2;
      const originCy = origin.y + origin.h / 2;
      entryTx.value = originCx - targetCardCx;
      entryTy.value = originCy - targetCardCy;
      entryScale.value = origin.w / cardW;
      pradius.value = 10;
      entryTx.value = withTiming(0, { duration: HERO_DURATION, easing: HERO_EASING });
      entryTy.value = withTiming(0, { duration: HERO_DURATION, easing: HERO_EASING });
      entryScale.value = withTiming(1, { duration: HERO_DURATION, easing: HERO_EASING });
      pradius.value = withTiming(18, { duration: HERO_DURATION, easing: HERO_EASING });
    } else {
      entryTx.value = 0; entryTy.value = 0; entryScale.value = 1;
      pradius.value = 18;
    }
    bgOpacity.value = withTiming(1, { duration: 220, easing: HERO_EASING });
    uiOpacity.value = withTiming(1, { duration: HERO_DURATION + 40, easing: HERO_EASING });
  };

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

  useEffect(() => {
    if (!visible) return;
    setCurrentIndex(targetIndex);
    resetTransforms();
    setLocalHiddenMap({});
    animateIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetIndex]);

  const handleToggleVisibility = async () => {
    if (!onTogglePhotoVisibility || !currentPhoto?.id || busy) return;
    const wasHidden = effectiveHidden(currentPhoto);
    setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: !wasHidden }));
    setBusy(true);
    try {
      const ok = await onTogglePhotoVisibility(currentPhoto.id, wasHidden);
      if (ok === false) {
        setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: wasHidden }));
      }
    } catch {
      setLocalHiddenMap(prev => ({ ...prev, [currentPhoto.id]: wasHidden }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    zoomTranslateX.value = 0;
    savedZoomTranslateX.value = 0;
    translateY.value = 0;
    savedTranslateY.value = 0;
  }, [currentIndex]);

  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

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

  const composed = Gesture.Simultaneous(pinchGesture, panGesture, doubleTapGesture);

  const currentPhoto = photos?.[currentIndex] || photo;

  const download = async () => {
    if (!currentPhoto?.uri || busy) return;
    setBusy(true);
    let staged = null;
    try {
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

  const entryStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: entryTx.value },
      { translateY: entryTy.value },
      { scale: entryScale.value },
    ],
  }));
  const radiusStyle = useAnimatedStyle(() => ({ borderRadius: pradius.value }));
  const bgStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
  const uiStyle = useAnimatedStyle(() => ({ opacity: uiOpacity.value }));

  const iconShadowWhiteStyle = Platform.OS === 'ios'
    ? { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }
    : null;

  const vertStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const photoListRef = useRef(null);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={animateOutAndClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {visible ? (
        <View style={{ flex: 1 }}>
          {/* Fond givre blanc (glassmorphism). */}
          <ReAnimated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, bgStyle]}
          >
            <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFillObject} />
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(255,255,255,0.65)' }]} />
          </ReAnimated.View>

          {/* Header : titre event + date */}
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

          {/* Photo principale */}
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
                          {/* Watermark events payants : overlay client only. */}
                          {photosForSale && item?.uri ? (
                            <ExpoImage
                              source={require('../../../assets/watermark-cover.png')}
                              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 }}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              pointerEvents="none"
                              transition={0}
                              tintColor="#fff"
                              onLoad={() => { if (!wmReady) setWmReady(true); }}
                            />
                          ) : null}
                          {/* Etoile fav DANS le wrapper photo */}
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
          </ReAnimated.View>

          {/* X haut-droite */}
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

          {/* Bouton bas : Telecharger (coureur) OU Publier/Masquer (orga) OU Ajouter au panier (payant). */}
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
