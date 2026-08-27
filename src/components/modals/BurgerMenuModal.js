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
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Dimensions, Platform, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.88));

// Ligne de menu : icone dans une pastille violet pale, libelle, puis
// compteur ou chevron. Meme gabarit partout, c est ce qui manquait — le
// tiroir n etait qu une suite de textes alignes a gauche.
function MenuRow({ icon, label, badge, onPress }) {
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.menuIcon}>{icon}</View>
      <Text style={styles.menuLabel}>{label}</Text>
      {badge ? (
        <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{badge}</Text></View>
      ) : (
        <Text style={styles.menuChevron}>›</Text>
      )}
    </TouchableOpacity>
  );
}

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
  onOpenAuthLogin,
  onOpenAuthSignup,
  onViewSelfie,
}) {
  const selfieOk = !!selfieUri && selfieUploadState !== 'failed' && selfieUploadState !== 'uploading';

  const slideX = useRef(new Animated.Value(DRAWER_W)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: visible ? 0 : DRAWER_W,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: visible ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
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

  // iOS interdit d ouvrir un <Modal transparent> pendant qu un autre se
  // ferme : il faut donc attendre. Le relais est cale juste apres la fin de
  // l animation (220 ms), pas avant — sinon la destination arrive au milieu
  // du glissement et saute.
  const fire = (cb) => () => {
    onClose && onClose();
    if (typeof cb !== 'function') return;
    setTimeout(cb, 240);
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
              <Path d="M6 6l12 12M18 6L6 18" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {isAuthed ? (
              <>
                {/* Bandeau de marque : il porte l identite et remplit le haut
                    du tiroir, qui etait vide aux deux tiers. L avatar y vit
                    desormais — avant il flottait a droite de deux lignes de
                    texte sans appartenir a l une ni a l autre. */}
                <LinearGradient
                  colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.hero}
                >
                  <TouchableOpacity
                    onPress={selfieUri ? fire(onViewSelfie) : fire(onOpenAccount)}
                    activeOpacity={0.85}
                    style={styles.heroAvatarWrap}
                  >
                    <View style={styles.heroAvatar}>
                      {selfieUri ? (
                        <ExpoImage
                          source={{ uri: selfieUri }}
                          style={styles.heroSelfie}
                          contentFit="cover"
                          transition={0}
                          cachePolicy="memory-disk"
                          priority="high"
                        />
                      ) : (
                        <Icon.User size={26} color="#FFFFFF" />
                      )}
                    </View>
                    <View style={[styles.heroDot, { backgroundColor: selfieOk ? '#34D399' : '#ef4444' }]} />
                  </TouchableOpacity>
                  <Text style={styles.heroName} numberOfLines={1}>
                    Salut {runnerFirstName || 'toi'}
                  </Text>
                  <Text style={styles.heroStatus} numberOfLines={2}>
                    {selfieOk
                      ? 'Selfie enregistré — on te reconnaît sur les photos'
                      : 'Ajoute ton selfie pour recevoir tes photos'}
                  </Text>
                </LinearGradient>

                <MenuRow
                  icon={<Icon.Photos size={19} color={C.primary} />}
                  label="Mes photos"
                  onPress={fire(onOpenMyPhotos)}
                />
                <MenuRow
                  icon={
                    <Svg width={19} height={18} viewBox="0 0 18.96 17.61" fill={C.primary}>
                      <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
                    </Svg>
                  }
                  label="Mon panier"
                  badge={cartTotal > 0 ? (cartTotal > 99 ? '99+' : String(cartTotal)) : null}
                  onPress={fire(onOpenPanier)}
                />
                <MenuRow
                  icon={<Icon.User size={19} color={C.primary} />}
                  label="Mon compte"
                  onPress={fire(onOpenAccount)}
                />

                <Text style={styles.secLabel}>Autres espaces</Text>
                <MenuRow
                  icon={<Icon.GearOrg size={19} color={C.primary} />}
                  label="Espace organisateur"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('organizer'))}
                />
                <MenuRow
                  icon={<Icon.CamOrg size={19} color={C.primary} />}
                  label="Espace photographe"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('photographer'))}
                />

                <View style={styles.spacer} />
                <View style={styles.rule} />
                <TouchableOpacity style={styles.link} onPress={fire(onLogout)}>
                  <Text style={styles.linkMutedText}>Se déconnecter</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Meme bandeau qu en connecte : il porte la promesse au lieu
                    d un logo pose sur du vide. */}
                <LinearGradient
                  colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.hero}
                >
                  <View style={{ marginBottom: 16 }}>
                    <Icon.Logo width={62} color="#FFFFFF" />
                  </View>
                  {/* Meme accroche que le hero du site. */}
                  <Text style={styles.heroName}>Un selfie.{'\n'}Toutes tes photos.</Text>
                  <Text style={styles.heroStatus}>L'application photo des événements sportifs</Text>
                </LinearGradient>

                <View style={styles.authSection}>
                  <TouchableOpacity style={styles.ctaPrimary} onPress={fire(onOpenAuthLogin)}>
                    <Text style={styles.ctaPrimaryText}>Se connecter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ctaSecondary} onPress={fire(onOpenAuthSignup)}>
                    <Text style={styles.ctaSecondaryText}>S'inscrire</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.secLabel, styles.secLabelApresCta]}>Autres espaces</Text>
                <MenuRow
                  icon={<Icon.GearOrg size={19} color={C.primary} />}
                  label="Espace organisateur"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('organizer'))}
                />
                <MenuRow
                  icon={<Icon.CamOrg size={19} color={C.primary} />}
                  label="Espace photographe"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('photographer'))}
                />
              </>
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
    shadowColor: 'rgba(15,7,35,0.6)',
    shadowOpacity: 0.45,
    shadowOffset: { width: -8, height: 0 },
    shadowRadius: 32,
    // Android n applique pas les shadow* : elevation est son equivalent.
    elevation: 32,
    overflow: 'hidden',
  },
  drawerInner: {
    flex: 1,
    paddingBottom: 28,
  },
  scroll: { paddingTop: 48, paddingHorizontal: 20, paddingBottom: 28, flexGrow: 1 },
  closeBtn: {
    position: 'absolute',
    top: 14, right: 14,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  link: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  linkMutedText: {
    color: '#6c5b8c',
    fontSize: 14,
    fontWeight: '600',
  },
  authSection: { gap: 10, paddingTop: 16 },

  // ── Direction C : bandeau de marque ──────────────────────────────
  // Deborde le padding du tiroir (20 lateral, 44 haut) pour toucher les
  // bords, d ou les marges negatives.
  hero: {
    marginHorizontal: -20,
    marginTop: -48,
    paddingTop: 92,
    paddingHorizontal: 20,
    paddingBottom: 22,
    marginBottom: 6,
  },
  heroAvatarWrap: { width: 58, height: 58, marginBottom: 12 },
  heroAvatar: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  heroSelfie: { width: '100%', height: '100%' },
  heroDot: {
    position: 'absolute', right: 0, bottom: 0,
    width: 15, height: 15, borderRadius: 8,
    borderWidth: 2.5, borderColor: '#8B5CF6',
  },
  heroName: {
    fontFamily: 'AVEstiana',
    fontSize: 24, color: '#FFFFFF', lineHeight: 27,
  },
  heroStatus: {
    fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 4, lineHeight: 17,
  },

  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12,
  },
  // Icones nues : la pastille violette ajoutait un aplat par ligne, donc
  // cinq blocs de couleur pour cinq mots. La largeur fixe suffit a aligner.
  menuIcon: {
    width: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a0a3e' },
  menuChevron: { fontSize: 18, color: 'rgba(26,10,62,0.35)' },
  menuBadge: {
    minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  menuBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  secLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    textTransform: 'uppercase', color: 'rgba(26,10,62,0.4)',
    marginTop: 20, marginBottom: 2,
  },
  secLabelApresCta: { marginTop: 26 },
  spacer: { flex: 1, minHeight: 24 },
  rule: { height: 1, backgroundColor: 'rgba(26,10,62,0.08)', marginBottom: 4 },
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
