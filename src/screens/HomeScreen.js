// Ecran d'accueil coureur : header (avatar + bienvenue + pills orga/photo
// + panier badge), carte selfie (si pas encore pris), tabs A venir / Passes /
// Favoris avec indicateur slide anime, barre de recherche toggable, liste
// EventCard ou empty state pedagogique (deconnecte + tab favoris).

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, Animated, Keyboard } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '../components/Icon';
import { SelfieIllustration } from '../components/SelfieIllustration';
import { EventCard } from '../components/EventCard';
import { HotOnesCarousel } from '../components/HotOnesCarousel';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { isUpcoming } from '../utils/format';

export function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, follows, onToggleFollow, onRefresh, runnerFirstName, selfieSkipped = false, isAuthed = false, onOpenAuthSignup, onOpenAuthLogin, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, cartTotal = 0, onOpenPanier }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Indicateur violet qui glisse entre les 3 pills. Mesure une fois la largeur
  // du conteneur (- padding), divise par 3 = largeur d un slot. Spring sur
  // translateX synchronise avec le state tab.
  const TAB_KEYS = ['upcoming', 'past', 'follows'];
  const tabIdx = Math.max(0, TAB_KEYS.indexOf(tab));
  const [tabsContainerW, setTabsContainerW] = useState(0);
  const tabsSlideX = useRef(new Animated.Value(0)).current;
  const slotW = tabsContainerW > 0 ? tabsContainerW / 3 : 0;
  useEffect(() => {
    if (slotW <= 0) return;
    Animated.spring(tabsSlideX, {
      toValue: slotW * tabIdx,
      useNativeDriver: true,
      tension: 110, friction: 14,
    }).start();
  }, [tabIdx, slotW, tabsSlideX]);

  // Transition du CONTENU sous les pills : fade + slide horizontal directionnel
  // (entree par la droite si on va vers un tab "plus loin", par la gauche
  // sinon). Donne un sentiment de "page qui glisse" en sync avec l indicateur.
  const lastTabIdxRef = useRef(tabIdx);
  const contentFade = useRef(new Animated.Value(1)).current;
  const contentSlideX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (lastTabIdxRef.current === tabIdx) return;
    const direction = tabIdx > lastTabIdxRef.current ? 1 : -1;
    lastTabIdxRef.current = tabIdx;
    contentFade.setValue(0);
    contentSlideX.setValue(direction * 20);
    Animated.parallel([
      Animated.timing(contentFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(contentSlideX, { toValue: 0, useNativeDriver: true, tension: 50, friction: 12 }),
    ]).start();
  }, [tabIdx, contentFade, contentSlideX]);
  const tabFiltered = events.filter(e => {
    if (tab === 'upcoming') return isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'past') return !isUpcoming(e.event_date, e.event_date_end);
    if (tab === 'follows') return follows.includes(e.code);
    return true;
  });
  const q = searchQuery.trim().toLowerCase();
  const filtered = (q
    ? tabFiltered.filter(e => (e.name || '').toLowerCase().includes(q))
    : tabFiltered
  ).slice().sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
  const scrollRef = useRef(null);

  // Quand le clavier se ferme : remonter le scroll en haut
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  // Tap sur l onglet Accueil quand deja sur Accueil = scroll-to-top.
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [scrollToTopSignal]);

  return (
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      {/* Header mobile-site : [Logo gauche] ←→ [Hello\nPrenom (right)] [Burger]
          Toutes les actions (profil, espaces orga/photo, panier, deconnexion) sont
          derriere le burger qui ouvre ProfileMenuModal (onOpenProfile). */}
      <View style={s.headerRow}>
        <TouchableOpacity onPress={onOpenProfile} activeOpacity={0.7} hitSlop={8}>
          <Icon.Logo width={72} color={C.primary} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          {runnerFirstName ? (
            <TouchableOpacity onPress={onOpenProfile} activeOpacity={0.7} hitSlop={6} style={{ alignItems: 'flex-end', flexShrink: 1 }}>
              <Text style={[s.welcome, { color: '#c9beed', fontSize: 15, lineHeight: 17 }]} numberOfLines={1}>Hello</Text>
              <Text style={[s.welcome, { color: '#c9beed', fontSize: 17, lineHeight: 19 }]} numberOfLines={1}>{runnerFirstName}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={onOpenProfile}
            activeOpacity={0.7}
            hitSlop={8}
            style={{
              width: 36, height: 36, borderRadius: 12,
              backgroundColor: 'transparent',
              alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}
            accessibilityLabel="Menu"
          >
            <Svg width={18} height={14} viewBox="0 0 18 14" fill="none">
              <Path d="M1 1h16M1 7h16M1 13h16" stroke={C.primary} strokeWidth={2} strokeLinecap="round" />
            </Svg>
            {/* Pastille verte selfie OK : visible si runner connecte + selfie uploaded
                sans erreur (cf logique selfieDotColor / site .will-has-selfie). */}
            {runnerFirstName && selfieUri && selfieUploadState !== 'failed' && selfieUploadState !== 'uploading' ? (
              <View style={{
                position: 'absolute',
                top: 3, right: 3,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: '#10B981',
                borderWidth: 2, borderColor: '#fff',
              }} />
            ) : null}
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ height: 18 }} />

      {/* Carrousel "Galerie ouverte" : derniers events passes avec photos. */}
      <HotOnesCarousel events={events} onOpenEvent={onOpenEvent} />

      {/* Row tabs + bouton loupe a droite */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <View
          onLayout={(e) => setTabsContainerW(e.nativeEvent.layout.width - 8)}
          style={{
            flex: 1,
            flexDirection: 'row',
            backgroundColor: C.pillBg,
            borderRadius: 16,
            padding: 4,
            alignItems: 'center',
            position: 'relative',
          }}
        >
          {slotW > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 4, top: 4, bottom: 4,
                width: slotW,
                backgroundColor: C.primary,
                borderRadius: 12,
                transform: [{ translateX: tabsSlideX }],
              }}
            />
          )}
          <TouchableOpacity onPress={() => setTab('upcoming')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>À venir</Text>
          </TouchableOpacity>
          {tab === 'follows' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
          <TouchableOpacity onPress={() => setTab('past')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>Passés</Text>
          </TouchableOpacity>
          {tab === 'upcoming' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
          <TouchableOpacity onPress={() => setTab('follows')} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'follows' && s.pillTextActive]}>Favoris</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (searchOpen) { setSearchQuery(''); Keyboard.dismiss(); }
            setSearchOpen(o => !o);
          }}
          activeOpacity={0.85}
          style={{
            width: 40, height: 40, borderRadius: 16,
            backgroundColor: searchOpen ? C.primary : C.pillBg,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M21 21l-4.35-4.35" stroke={searchOpen ? '#fff' : C.primary} strokeWidth={1.8} strokeLinecap="round" />
            <Path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" stroke={searchOpen ? '#fff' : C.primary} strokeWidth={1.7} />
          </Svg>
        </TouchableOpacity>
      </View>

      {/* Barre de recherche : visible UNIQUEMENT quand searchOpen. */}
      {searchOpen && (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#fff',
          borderRadius: 16,
          borderWidth: 1.5,
          borderColor: '#E5E0FF',
          paddingHorizontal: 14,
          paddingVertical: 4,
          gap: 8,
          marginBottom: 8,
        }}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Rechercher un event"
            placeholderTextColor="#c9beed"
            style={{ flex: 1, fontSize: 14, color: C.primary, fontWeight: '400', paddingVertical: 8 }}
            returnKeyType="search"
            autoFocus
          />
          <TouchableOpacity
            onPress={() => { setSearchQuery(''); setSearchOpen(false); Keyboard.dismiss(); }}
            hitSlop={10}
            style={{ paddingHorizontal: 6 }}
          >
            <Text style={{ color: C.textSoft, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Events list / etat vide. Cas special : Favoris en deconnecte
          -> empty state pedagogique 3 etapes (compte / selfie / favori). */}
      <Animated.View style={{ opacity: contentFade, transform: [{ translateX: contentSlideX }] }}>
        {tab === 'follows' && !isAuthed ? (
          <View style={{ paddingVertical: 24, paddingHorizontal: 8, alignItems: 'center' }}>
            <SelfieIllustration size={84} />
            <Text style={{
              fontSize: 22, fontFamily: 'AVEstiana', color: C.text,
              textAlign: 'center', marginTop: 16, marginBottom: 8, lineHeight: 26,
            }}>
              Tes photos avant même{'\n'}la ligne d'arrivée
            </Text>
            <Text style={{
              fontSize: 13, color: C.textSoft, textAlign: 'center',
              lineHeight: 18, marginBottom: 22, paddingHorizontal: 8,
            }}>
              Ajoute tes events en favoris pour les suivre. Un selfie suffit pour être reconnu sur toutes les photos publiées (valable 12 mois renouvelables).
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10, marginBottom: 22 }}>
              {[
                { n: 1, t: 'Crée ton compte et prends ton selfie' },
                { n: 2, t: 'Ajoute tes events en favoris pour les suivre' },
                { n: 3, t: "Profite, Will s'occupe du reste" },
              ].map(({ n, t }) => (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FAF7FF', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{n}</Text>
                  </View>
                  <Text style={{ color: C.text, fontSize: 13, fontWeight: '500' }}>{t}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              onPress={onOpenAuthSignup}
              activeOpacity={0.88}
              style={{
                backgroundColor: C.primary,
                paddingVertical: 14, paddingHorizontal: 32,
                borderRadius: 14, alignSelf: 'stretch', alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Créer mon compte</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onOpenAuthLogin} style={{ marginTop: 12, paddingVertical: 6 }} activeOpacity={0.7}>
              <Text style={{ color: C.primary, fontSize: 13, fontWeight: '500' }}>J'ai déjà un compte</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <View style={{ marginBottom: 12, opacity: 0.4 }}>
              <Icon.Calendar size={36} color={C.textSoft} />
            </View>
            <Text style={{ color: C.textSoft, fontSize: 14 }}>
              {tab === 'follows' ? 'Aucun event en favoris' : tab === 'upcoming' ? 'Aucun événement à venir' : 'Aucun événement passé'}
            </Text>
          </View>
        ) : (
          filtered.map((event) => (
            <EventCard
              key={event.code}
              event={event}
              onPress={() => onOpenEvent(event)}
              isFollowing={follows.includes(event.code)}
              onToggleFollow={() => onToggleFollow(event.code)}
              style={{ marginBottom: 8 }}
            />
          ))
        )}
      </Animated.View>
    </RefreshableScrollView>
  );
}
