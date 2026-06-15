// Side-drawer burger menu : mirror EXACT du burger site web
// (~/WILL/website/assets/will-home-nav.css .burger-drawer*).
//
// Slide depuis la droite (translateX 100% -> 0), width 340px max (88% screen),
// background blanc rgba(255,255,255,0.82) + BlurView intense pour glassmorphism,
// padding 22/20/28, gap 12 entre sections. Close X en haut-droit.
// Header : logo Will 38px OU greeting "Hello {prenom}" AVEstiana 26px violet-700.
//
// Actions cablees par callbacks props -> handlers existants App.js.
// Toutes les actions ferment le drawer + setTimeout 200ms avant l action
// suivante (modal stacking iOS, cf feedback_rn_modal_stacking).

import React, { useRef, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.88));

export function BurgerMenuModal({
  visible,
  onClose,
  isAuthed = false,
  runnerFirstName = '',
  selfieUri = null,
  selfieUploadState = 'idle',
  cartTotal = 0,
  onOpenAccount,
  onOpenMyPhotos,
  onOpenPanier,
  onOpenOrgRole,
  onLogout,
  onDeleteFaceData,
  onDeleteAccount,
  onOpenAuthLogin,
  onOpenAuthSignup,
}) {
  const selfieOk = !!selfieUri && selfieUploadState !== 'failed' && selfieUploadState !== 'uploading';

  const slideX = useRef(new Animated.Value(DRAWER_W)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: visible ? 0 : DRAWER_W,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: visible ? 1 : 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideX, backdropOpacity]);

  // Prefetch du selfie des qu il est connu (au mount ou au changement de
  // selfieUri). Quand l user ouvre le drawer, l image est deja warm en cache
  // disk -> rendu instant au lieu du fetch reseau perceptible.
  useEffect(() => {
    if (selfieUri) {
      ExpoImage.prefetch(selfieUri, 'memory-disk').catch(() => {});
    }
  }, [selfieUri]);

  const fire = (cb) => () => {
    onClose && onClose();
    if (typeof cb !== 'function') return;
    setTimeout(cb, 220);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15,7,35,0.45)' }]} />
          )}
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[styles.drawer, { transform: [{ translateX: slideX }] }]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={48} tint="light" style={StyleSheet.absoluteFillObject} />
        ) : null}
        <View style={styles.drawerInner}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path d="M6 6l12 12M18 6L6 18" stroke="#1a0a3e" strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              {isAuthed && runnerFirstName ? (
                <Text style={styles.greeting} numberOfLines={1}>
                  Hello {runnerFirstName}
                </Text>
              ) : (
                <Icon.Logo width={62} color={C.primary} />
              )}
            </View>

            {isAuthed ? (
              <View style={styles.profileRow}>
                <View style={{ flex: 1 }}>
                  <TouchableOpacity style={styles.profileAction} onPress={fire(onOpenAccount)}>
                    <Text style={styles.profileActionText}>Mon compte</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.profileAction} onPress={fire(onOpenMyPhotos)}>
                    <Text style={styles.profileActionText}>Mes photos</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.profileThumbWrap}>
                  <View style={styles.profileThumb}>
                    {selfieUri ? (
                      <ExpoImage
                        source={{ uri: selfieUri }}
                        style={styles.profileSelfie}
                        contentFit="cover"
                        transition={0}
                        cachePolicy="memory-disk"
                        priority="high"
                      />
                    ) : (
                      <Svg width={22} height={20} viewBox="0 0 18.96 17.61" fill="#1a0a3e">
                        <Path d="M10.16,0h-1.35C3.94,0,0,3.94,0,8.8s3.94,8.8,8.8,8.8h1.35c4.86,0,8.8-3.94,8.8-8.8S15.02,0,10.16,0ZM9.48,2.77c1.28,0,2.32,1.14,2.32,2.55s-1.04,2.55-2.32,2.55-2.32-1.14-2.32-2.55,1.04-2.55,2.32-2.55ZM9.48,14.33c-2.58,0-4.67-1.23-4.67-2.75s2.09-2.75,4.67-2.75,4.67,1.23,4.67,2.75-2.09,2.75-4.67,2.75Z" />
                      </Svg>
                    )}
                  </View>
                  <View style={[styles.profileDot, { backgroundColor: selfieOk ? '#10B981' : '#ef4444' }]} />
                </View>
              </View>
            ) : null}

            {isAuthed && cartTotal > 0 ? (
              <TouchableOpacity style={styles.cartRow} onPress={fire(onOpenPanier)}>
                <Text style={styles.cartLabel}>Mon panier</Text>
                <Text style={styles.cartCount}>{cartTotal > 99 ? '99+' : cartTotal}</Text>
                <Svg width={18} height={17} viewBox="0 0 18.96 17.61" fill="#1a0a3e">
                  <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
                </Svg>
              </TouchableOpacity>
            ) : null}

            <View style={styles.nav}>
              <TouchableOpacity style={styles.link} onPress={fire(() => onOpenOrgRole && onOpenOrgRole('organizer'))}>
                <Text style={styles.linkRoseText}>Espace organisateur</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.link} onPress={fire(() => onOpenOrgRole && onOpenOrgRole('photographer'))}>
                <Text style={styles.linkRoseText}>Espace photographe</Text>
              </TouchableOpacity>
            </View>

            {isAuthed ? (
              <View style={styles.actionsSection}>
                <TouchableOpacity style={styles.link} onPress={fire(onLogout)}>
                  <Text style={styles.linkMutedText}>Se déconnecter</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.link} onPress={fire(onDeleteFaceData)}>
                  <Text style={styles.linkDangerText}>Supprimer mes données faciales</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.link} onPress={fire(onDeleteAccount)}>
                  <Text style={styles.linkDangerText}>Supprimer mon compte</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.authSection}>
                <TouchableOpacity style={styles.ctaPrimary} onPress={fire(onOpenAuthLogin)}>
                  <Text style={styles.ctaPrimaryText}>Se connecter</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ctaSecondary} onPress={fire(onOpenAuthSignup)}>
                  <Text style={styles.ctaSecondaryText}>S'inscrire</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: DRAWER_W,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.82)' : '#fff',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.4)',
    shadowColor: 'rgba(15,7,35,0.6)',
    shadowOpacity: 0.45,
    shadowOffset: { width: -8, height: 0 },
    shadowRadius: 32,
    overflow: 'hidden',
  },
  drawerInner: {
    flex: 1,
    paddingTop: 44,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  scroll: { paddingTop: 4, gap: 12, paddingBottom: 28 },
  closeBtn: {
    position: 'absolute',
    top: 14, right: 14,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 4,
    paddingBottom: 8,
  },
  greeting: {
    fontFamily: 'AVEstiana',
    fontSize: 26,
    color: C.primary,
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: 'rgba(123,47,255,0.12)',
    borderBottomColor: 'rgba(123,47,255,0.12)',
    marginVertical: 4,
  },
  profileAction: {
    paddingVertical: 6,
  },
  profileActionText: {
    color: '#1a0a3e',
    fontSize: 14,
    fontWeight: '600',
  },
  profileThumbWrap: {
    width: 48, height: 48,
    position: 'relative',
  },
  profileThumb: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(123,47,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  profileSelfie: {
    width: '100%',
    height: '100%',
  },
  profileDot: {
    position: 'absolute',
    top: -2, right: -2,
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: '#fff',
    zIndex: 2,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(123,47,255,0.12)',
  },
  cartLabel: {
    flex: 1,
    color: '#1a0a3e',
    fontSize: 14,
    fontWeight: '500',
  },
  cartCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: C.primary,
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    overflow: 'hidden',
  },
  nav: {
    paddingVertical: 8,
    gap: 2,
  },
  link: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  linkRoseText: {
    color: '#D67CF8',
    fontSize: 14,
    fontWeight: '500',
  },
  actionsSection: {
    gap: 2,
    paddingTop: 4,
  },
  linkMutedText: {
    color: '#6c5b8c',
    fontSize: 14,
    fontWeight: '600',
  },
  linkDangerText: {
    color: '#6c5b8c',
    fontSize: 13,
    fontWeight: '400',
  },
  authSection: { gap: 10, paddingTop: 6 },
  ctaPrimary: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  ctaPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ctaSecondary: {
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(123,47,255,0.08)',
    alignItems: 'center',
  },
  ctaSecondaryText: { color: C.primary, fontSize: 15, fontWeight: '700' },
});
