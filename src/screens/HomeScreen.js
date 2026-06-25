// Ecran d'accueil coureur : header (avatar + bienvenue + pills orga/photo
// + panier badge), carte selfie (si pas encore pris), tabs A venir / Passes /
// Favoris avec indicateur slide anime, barre de recherche toggable, liste
// EventCard ou empty state pedagogique (deconnecte + tab favoris).

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Animated, Keyboard } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Icon } from '../components/Icon';
import { SelfieIllustration } from '../components/SelfieIllustration';
import { EventCard } from '../components/EventCard';
import { HotOnesCarousel } from '../components/HotOnesCarousel';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { isUpcoming } from '../utils/format';

export function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, follows, onToggleFollow, onRefresh, runnerFirstName, selfieSkipped = false, isAuthed = false, onOpenAuthSignup, onOpenAuthLogin, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, cartTotal = 0, onOpenPanier, headerH = 0 }) {
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
  const [showBackTop, setShowBackTop] = useState(false);
  const backTopOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(backTopOpacity, {
      toValue: showBackTop ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [showBackTop, backTopOpacity]);
  const onScrollWatch = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowBackTop(y > 400);
  }, []);

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
    <View style={{ flex: 1 }}>
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} onScroll={onScrollWatch} style={s.scroll} contentContainerStyle={{ paddingTop: headerH, paddingBottom: 120 }} showsVerticalScrollIndicator={false} topOffset={headerH}>
      {/* Header retire : il est maintenant rendu UNE FOIS dans App.js
          (AppHeader.js) au-dessus du tab container -> aucun re-mount au
          switch Accueil <-> Photos. */}

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
          <>
            {filtered.map((event) => (
              <EventCard
                key={event.code}
                event={event}
                onPress={() => onOpenEvent(event)}
                isFollowing={follows.includes(event.code)}
                onToggleFollow={() => onToggleFollow(event.code)}
                style={{ marginBottom: 8 }}
              />
            ))}
            {/* Padding placeholder cards (mirror vitrine PAD_TO=5).
                Sur app on padde a 4 cards visibles. 1ere placeholder en
                tab "upcoming" = CTA "Lancer mon event". */}
            {tab === 'upcoming' && filtered.length < 4 && (() => {
              const missing = 4 - filtered.length;
              return Array.from({ length: missing }).map((_, i) => {
                const isCta = i === 0;
                return isCta ? (
                  <TouchableOpacity
                    key={`cta-${i}`}
                    activeOpacity={0.85}
                    onPress={() => onOpenOrgRole && onOpenOrgRole('orga')}
                    style={{
                      backgroundColor: '#EDE7FF',
                      borderRadius: 16,
                      paddingVertical: 22,
                      paddingHorizontal: 22,
                      marginBottom: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{
                      color: '#C9B6FF',
                      fontFamily: 'AVEstiana',
                      fontSize: 16,
                      textAlign: 'center',
                      marginBottom: 12,
                      lineHeight: 19,
                    }}>
                      Tu veux utiliser Will{'\n'}sur ton prochain event ?
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={{
                        color: '#7B2FFF',
                        fontFamily: 'Montserrat',
                        fontSize: 13,
                        fontWeight: '700',
                      }}>
                        Lancer mon event
                      </Text>
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Path d="m9 18 6-6-6-6" stroke="#7B2FFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View
                    key={`ph-${i}`}
                    pointerEvents="none"
                    style={{
                      height: 108,
                      backgroundColor: '#EDE7FF',
                      borderRadius: 16,
                      marginBottom: 8,
                      opacity: 0.6,
                    }}
                  />
                );
              });
            })()}
          </>
        )}
      </Animated.View>
    </RefreshableScrollView>
    {/* Bouton "Remonter en haut" : mirror site .bib-back-to-top. */}
    <Animated.View
      pointerEvents={showBackTop ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: 100,
        alignItems: 'center',
        opacity: backTopOpacity,
      }}
    >
      <TouchableOpacity
        onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        activeOpacity={0.85}
        style={{
          width: 40, height: 40,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: 'rgba(255,255,255,0.9)',
          shadowColor: '#000',
          shadowOpacity: 0.10,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 14,
          elevation: 6,
          backgroundColor: 'rgba(255,255,255,0.6)',
        }}
        accessibilityLabel="Remonter en haut"
      >
        <BlurView intensity={50} tint="light" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M6 15l6-6 6 6" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </BlurView>
      </TouchableOpacity>
    </Animated.View>
    </View>
  );
}
