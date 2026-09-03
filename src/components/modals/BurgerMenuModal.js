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

import React, { useRef, useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Dimensions, Platform, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../Icon';
import { C } from '../../constants/colors';
import { VENTE_PHOTOS_OUVERTE } from '../../constants/api';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.88));

// Ligne de menu : icone dans une pastille violet pale, libelle, puis
// compteur ou chevron. Meme gabarit partout, c est ce qui manquait — le
// tiroir n etait qu une suite de textes alignes a gauche.
function MenuRow({ icon, label, badge, onPress, dernier, inactif }) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, !dernier && styles.menuRowSepare]}
      onPress={inactif ? undefined : onPress}
      disabled={!!inactif}
      activeOpacity={0.7}
    >
      {/* L opacite est portee par le contenu, pas par la ligne : sinon le
          filet du bas palit lui aussi et le rythme des separateurs casse. */}
      <View style={[styles.menuRowInner, inactif && styles.menuRowInnerInactif]}>
        <View style={styles.menuIcon}>{icon}</View>
        <Text style={styles.menuLabel}>{label}</Text>
        {inactif ? (
          <Text style={styles.menuSoon}>Bientôt</Text>
        ) : badge ? (
          <View style={styles.menuBadge}><Text style={styles.menuBadgeText}>{badge}</Text></View>
        ) : (
          <Text style={styles.menuChevron}>›</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Sous-entree d un espace : meme gabarit qu une ligne de menu, decalee
// sous le libelle du groupe (icone 26 + gap 14 = 40).
function SousRow({ label, onPress, dernier }) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, !dernier && styles.menuRowSepare]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuRowInner, { paddingLeft: 40 }]}>
        <Text style={styles.sousLabel}>{label}</Text>
        <Text style={styles.menuChevron}>›</Text>
      </View>
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
  onOpenOrganizerAccount,
  hasOrganizer = false,
  onOpenMyPhotos,
  onOpenPanier,
  onOpenOrgRole,
  onLogout,
  onOpenAuthLogin,
  onOpenAuthSignup,
  onViewSelfie,
  // Vrai quand un tiroir "compte" est pose par-dessus : les lignes du menu
  // s effacent alors doucement dessous au lieu d etre coupees net.
  contenuMasque = false,
  // Tiroirs qui se posent par-dessus le menu (voir App.js) : ils sont montes
  // ICI, dans la meme <Modal>, sinon iOS ne les affiche pas.
  children,
}) {
  // Moitie sortante de la transition : les lignes reculent de 16 px et
  // s effacent completement pendant que la carte compte arrive. Au retour
  // elles reviennent, decalees de 80 ms — le temps que la carte ait libere
  // la place.
  // Hauteur reelle du bandeau : les tiroirs "compte" se posent par-dessus
  // sans le redessiner, il leur faut donc la place exacte qu il occupe.
  const [heroH, setHeroH] = useState(0);

  const contenuOpacity = useRef(new Animated.Value(1)).current;
  const contenuX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Tiroir ferme : on repose les valeurs SANS animation. Sinon l animation
    // de retour est lancee au moment ou la vue est demontee, ne recoit plus
    // de frame, et l opacite reste bloquee a 0 — d ou le menu blanc a la
    // reouverture.
    if (!visible) {
      contenuOpacity.setValue(contenuMasque ? 0 : 1);
      contenuX.setValue(contenuMasque ? -16 : 0);
      return;
    }
    const courbe = contenuMasque ? Easing.bezier(0.4, 0, 0.6, 1) : Easing.bezier(0.22, 1, 0.36, 1);
    Animated.parallel([
      Animated.timing(contenuOpacity, {
        toValue: contenuMasque ? 0 : 1,
        duration: contenuMasque ? 200 : 280,
        delay: contenuMasque ? 0 : 80,
        easing: courbe,
        useNativeDriver: true,
      }),
      Animated.timing(contenuX, {
        toValue: contenuMasque ? -16 : 0,
        duration: contenuMasque ? 240 : 300,
        delay: contenuMasque ? 0 : 80,
        easing: courbe,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, contenuMasque, contenuOpacity, contenuX]);
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
  // ferme : il faut donc attendre un tour. Mais le tiroir disparait d un
  // coup (Modal demonte des visible=false), donc rien ne sert d attendre la
  // fin d une animation qui n est pas jouee : 240 ms creusaient un trou noir
  // entre le menu et sa destination. 120 ms suffisent au demontage.
  const fire = (cb) => () => {
    onClose && onClose();
    if (typeof cb !== 'function') return;
    // 300 ms et pas 120 : les destinations plein ecran (AuthOrganizerModal,
    // AuthRunnerModal, LoginModal) sont des <Modal presentationStyle=
    // "fullScreen">. iOS refuse de presenter un Modal pendant que celui du
    // menu se ferme encore (~220 ms d animation) : le contenu se posait
    // alors PAR-DESSUS le menu, sans fond (Audit UI-04, meme pattern que
    // les setTimeout 300 ms de App.js).
    setTimeout(cb, 300);
  };

  // Destinations qui se posent PAR-DESSUS le menu (les tiroirs "Mon compte")
  // : le menu doit rester ouvert dessous, sinon il n y a plus rien a
  // redecouvrir au retour.
  const empiler = (cb) => () => { if (typeof cb === 'function') cb(); };

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
                  colors={['#D67CF8', '#9E5BFF', '#7B2FFF']}
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.hero}
                  onLayout={(e) => setHeroH(e.nativeEvent.layout.height)}
                >
                  <TouchableOpacity
                    onPress={selfieUri ? fire(onViewSelfie) : empiler(onOpenAccount)}
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

                <Animated.View style={{ flex: 1, opacity: contenuOpacity, transform: [{ translateX: contenuX }] }}>
                <MenuRow
                  icon={<Icon.Photos size={19} color={C.primary} />}
                  label="Mes photos"
                  onPress={fire(onOpenMyPhotos)}
                />
                <MenuRow
                  icon={<Icon.User size={19} color={C.primary} />}
                  label="Mon compte"
                  onPress={empiler(onOpenAccount)}
                  dernier={!VENTE_PHOTOS_OUVERTE}
                />
                {VENTE_PHOTOS_OUVERTE ? (
                  <MenuRow
                    icon={
                      <Svg width={19} height={18} viewBox="0 0 18.96 17.61" fill={C.primary}>
                        <Path d="M17.25,5.29h-6.43s.01-.04.01-.06V1.35C10.83.6,10.23,0,9.48,0s-1.36.6-1.36,1.35v3.88s.01.04.01.06H1.7C.59,5.29-.22,6.33.05,7.39l2.14,8.95c.19.74.87,1.26,1.64,1.26h11.29c.77,0,1.45-.52,1.64-1.26l2.14-8.95c.28-1.06-.53-2.1-1.64-2.1ZM15.44,9.36l-1.02,4.67c-.11.44-.51.74-.97.74h-7.93c-.46,0-.85-.31-.97-.74l-1.02-4.67c-.16-.63.32-1.24.97-1.24h9.98c.65,0,1.13.61.97,1.24Z" />
                      </Svg>
                    }
                    label="Mon panier"
                    badge={cartTotal > 0 ? (cartTotal > 99 ? '99+' : String(cartTotal)) : null}
                    onPress={fire(onOpenPanier)}
                    dernier
                  />
                ) : null}

                <View style={styles.spacer} />
                <Text style={styles.secLabel}>Autres espaces</Text>
                {hasOrganizer ? (
                  <>
                    {/* Organisateur connecte : l espace devient un groupe,
                        avec ses deux destinations. "Mon compte organisateur"
                        pose au meme niveau que les espaces n etait pas
                        comprehensible (decision user 2026-08-31). */}
                    <View style={[styles.menuRow, styles.menuRowSepare]}>
                      <View style={styles.menuRowInner}>
                        <View style={styles.menuIcon}><Icon.GearOrg size={19} color={C.primary} /></View>
                        <Text style={styles.menuLabel}>Espace organisateur</Text>
                      </View>
                    </View>
                    <SousRow label="Mes events" onPress={fire(() => onOpenOrgRole && onOpenOrgRole('organizer'))} />
                    <SousRow label="Mon compte" onPress={empiler(onOpenOrganizerAccount)} />
                  </>
                ) : (
                  /* Sans espace organisateur, « Espace organisateur » ne
                     voulait rien dire et menait a un formulaire de connexion
                     pour quelqu un de deja connecte. On nomme ce que la
                     personne vient chercher : creer un event. L espace se
                     cree en chemin. */
                  <MenuRow
                    icon={<Icon.Fusee size={19} color={C.primary} />}
                    label="Lancer mon event"
                    onPress={fire(() => onOpenOrgRole && onOpenOrgRole('create'))}
                  />
                )}
                <MenuRow
                  icon={<Icon.CamOrg size={19} color={C.primary} />}
                  label="Espace photographe"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('photographer'))}
                  dernier
                />

                <View style={styles.rule} />
                <TouchableOpacity style={styles.link} onPress={fire(onLogout)}>
                  <Text style={styles.linkMutedText}>Se déconnecter</Text>
                </TouchableOpacity>
                </Animated.View>
              </>
            ) : (
              <>
                {/* Meme bandeau qu en connecte : il porte la promesse au lieu
                    d un logo pose sur du vide. */}
                <LinearGradient
                  colors={['#D67CF8', '#9E5BFF', '#7B2FFF']}
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.hero}
                  onLayout={(e) => setHeroH(e.nativeEvent.layout.height)}
                >
                  <View style={{ marginBottom: 16 }}>
                    <Icon.Logo width={62} color="#FFFFFF" />
                  </View>
                  {/* Meme accroche que le hero du site. */}
                  <Text style={styles.heroName}>Un selfie.{'\n'}Toutes tes photos.</Text>
                  <Text style={styles.heroStatus}>L'application photo des événements sportifs</Text>
                </LinearGradient>

                <Animated.View style={{ flex: 1, opacity: contenuOpacity, transform: [{ translateX: contenuX }] }}>
                <View style={styles.authSection}>
                  <TouchableOpacity style={styles.ctaPrimary} onPress={fire(onOpenAuthLogin)}>
                    <Text style={styles.ctaPrimaryText}>Connexion</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ctaSecondary} onPress={fire(onOpenAuthSignup)}>
                    <Text style={styles.ctaSecondaryText}>Inscription</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.secLabel, styles.secLabelApresCta]}>Autres espaces</Text>
                {hasOrganizer ? (
                  <>
                    {/* Organisateur connecte : l espace devient un groupe,
                        avec ses deux destinations. "Mon compte organisateur"
                        pose au meme niveau que les espaces n etait pas
                        comprehensible (decision user 2026-08-31). */}
                    <View style={[styles.menuRow, styles.menuRowSepare]}>
                      <View style={styles.menuRowInner}>
                        <View style={styles.menuIcon}><Icon.GearOrg size={19} color={C.primary} /></View>
                        <Text style={styles.menuLabel}>Espace organisateur</Text>
                      </View>
                    </View>
                    <SousRow label="Mes events" onPress={fire(() => onOpenOrgRole && onOpenOrgRole('organizer'))} />
                    <SousRow label="Mon compte" onPress={empiler(onOpenOrganizerAccount)} />
                  </>
                ) : (
                  /* Sans espace organisateur, « Espace organisateur » ne
                     voulait rien dire et menait a un formulaire de connexion
                     pour quelqu un de deja connecte. On nomme ce que la
                     personne vient chercher : creer un event. L espace se
                     cree en chemin. */
                  <MenuRow
                    icon={<Icon.Fusee size={19} color={C.primary} />}
                    label="Lancer mon event"
                    onPress={fire(() => onOpenOrgRole && onOpenOrgRole('create'))}
                  />
                )}
                <MenuRow
                  icon={<Icon.CamOrg size={19} color={C.primary} />}
                  label="Espace photographe"
                  onPress={fire(() => onOpenOrgRole && onOpenOrgRole('photographer'))}
                  dernier
                />
                </Animated.View>
              </>
            )}
          </ScrollView>
        </View>
      </Animated.View>

      {React.Children.map(children, (enfant) => (
        React.isValidElement(enfant) ? React.cloneElement(enfant, { heroOffset: heroH ? heroH + 6 : 0 }) : enfant
      ))}
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
    // Alignee sur l entete de "Mon compte" (paddingTop 46) : plus haut, la
    // croix tombait dans la barre d etat / l encoche.
    top: 46, right: 12,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 3,
  },
  link: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  linkMutedText: {
    color: '#6c5b8c',
    fontSize: 14,
    fontFamily: 'Montserrat-SemiBold',
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
  heroStatus: { fontFamily: 'Montserrat',
    fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 4, lineHeight: 17,
  },

  menuRow: {
    paddingVertical: 13,
  },
  menuRowInner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  menuRowInnerInactif: { opacity: 0.42 },
  // Filet entre deux lignes d un meme groupe, comme sur les maquettes.
  menuRowSepare: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26,10,62,0.07)',
  },
  // Icones nues : la pastille violette ajoutait un aplat par ligne, donc
  // cinq blocs de couleur pour cinq mots. La largeur fixe suffit a aligner.
  menuIcon: {
    width: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: 'Montserrat-SemiBold', color: '#1a0a3e' },
  sousLabel: { flex: 1, fontSize: 14.5, fontFamily: 'Montserrat-Medium', color: '#1a0a3e' },
  menuChevron: { fontFamily: 'Montserrat', fontSize: 18, color: 'rgba(26,10,62,0.35)' },
  menuBadge: {
    minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  menuBadgeText: { color: '#fff', fontSize: 12, fontFamily: 'Montserrat-SemiBold' },
  menuSoon: {
    fontSize: 11, fontFamily: 'Montserrat-SemiBold', letterSpacing: 0.6,
    textTransform: 'uppercase', color: 'rgba(26,10,62,0.4)',
  },

  secLabel: {
    fontSize: 11, fontFamily: 'Montserrat-SemiBold', letterSpacing: 1.1,
    textTransform: 'uppercase', color: 'rgba(26,10,62,0.4)',
    marginTop: 20, marginBottom: 2,
  },
  secLabelApresCta: { fontFamily: 'Montserrat', marginTop: 26 },
  spacer: { flex: 1, minHeight: 24 },
  rule: { height: 1, backgroundColor: 'rgba(26,10,62,0.08)', marginBottom: 4 },
  ctaPrimary: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  ctaPrimaryText: { color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' },
  ctaSecondary: {
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(123,47,255,0.08)',
    alignItems: 'center',
  },
  ctaSecondaryText: { color: C.primary, fontSize: 15, fontFamily: 'Montserrat-SemiBold' },
});
