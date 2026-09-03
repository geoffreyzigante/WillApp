// Ecran d'accueil coureur : header (avatar + bienvenue + pills orga/photo
// + panier badge), carte selfie (si pas encore pris), tabs A venir / Passes /
// Favoris avec indicateur slide anime, barre de recherche toggable, liste
// EventCard ou empty state pedagogique (deconnecte + tab favoris).

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Animated, Keyboard, Pressable, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Icon } from '../components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { EtatVideWill } from '../components/EtatVideWill';
import { Haptics } from '../services/haptics';
import { IlluPasDePhotos } from '../components/IlluPasDePhotos';
import { EventCard } from '../components/EventCard';
import { HotOnesCarousel } from '../components/HotOnesCarousel';
import { RefreshableScrollView } from '../components/loaders';
import { C } from '../constants/colors';
import { s } from '../constants/styles';
import { isUpcoming } from '../utils/format';
import { API_URL } from '../constants/api';

export function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, follows, onToggleFollow, onRefresh, runnerFirstName, selfieSkipped = false, isAuthed = false, onOpenAuthSignup, onOpenAuthLogin, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, cartTotal = 0, onOpenPanier, headerH = 0 }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Event resolu par code exact via /public-events/{code}. Couvre les events
  // non listes (listed:false) qui ne sortent JAMAIS de /public-events : sans
  // ce chemin, un event prive est inatteignable depuis l'app coureur.
  // Meme motif que LoginModal (debounce 250 ms + guard cleanup).
  const [searchExtra, setSearchExtra] = useState(null);
  // Champ "Code event" : chemin DIRECT, independant de la liste et de la
  // recherche textuelle. C'est le pendant exact de la barre composee du site
  // (index.html #events-code-form) et de celle de LoginModal. La recherche
  // textuelle resout deja les codes, mais sans affordance visible : un
  // coureur a qui l'orga a donne un code cherche un champ "code", pas une
  // loupe.
  const [codeInput, setCodeInput] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  const openByCode = useCallback(() => {
    const raw = codeInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw || codeLoading) return;
    setCodeError('');
    setCodeLoading(true);
    // Meme endpoint que la page /event/{code} du site : il ignore `listed`,
    // seul active=true est requis, donc il atteint les events masques.
    fetch(`${API_URL}/public-events/${encodeURIComponent(raw)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ev) => {
        if (ev && ev.code) {
          setCodeInput('');
          setSearchOpen(false);
          Keyboard.dismiss();
          onOpenEvent(ev);
        } else {
          setCodeError('Aucun événement actif avec ce code.');
        }
      })
      .catch(() => setCodeError('Connexion impossible. Vérifie ton réseau.'))
      .finally(() => setCodeLoading(false));
  }, [codeInput, codeLoading, onOpenEvent]);
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
  // Normalise pour comparaison accent/casse-insensitive (cf. LoginModal).
  const normalize = (v) => (v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = normalize(searchQuery.trim());
  const filtered = (q
    ? (() => {
        const base = tabFiltered.filter(e =>
          normalize(e.name).includes(q)
          || normalize(e.location).includes(q)
          || normalize(e.code).includes(q)
        );
        // searchExtra bypasse le filtre d'onglet (a venir / passes / favoris) :
        // saisir un code exact est une intention explicite, elle prime sur
        // l'onglet courant. Unshift = toujours en tete de liste.
        if (searchExtra && searchExtra.code && !base.some(e => e.code === searchExtra.code)) {
          base.unshift(searchExtra);
        }
        return base;
      })()
    : tabFiltered
  ).slice().sort((a, b) => {
    const da = a.event_date || '';
    const db = b.event_date || '';
    // Event sans date ("Date a venir") : toujours en fin de liste. Le tri
    // lexicographique seul les remonterait en tete ('' < toute date), donc
    // devant les events reellement programmes. Meme regle que la vitrine.
    if (!da !== !db) return da ? -1 : 1;
    if (!da && !db) return (a.name || '').localeCompare(b.name || '');
    // Passes : du plus recent au plus ancien. Favoris (melange a venir +
    // passes) : les a venir d'abord (le plus proche en tete), puis les
    // passes (le plus recent en tete) — meme regle que /public-events.
    if (tab === 'past') return db.localeCompare(da);
    if (tab === 'follows') {
      const aUp = isUpcoming(a.event_date, a.event_date_end);
      const bUp = isUpcoming(b.event_date, b.event_date_end);
      if (aUp !== bUp) return aUp ? -1 : 1;
      return aUp ? da.localeCompare(db) : db.localeCompare(da);
    }
    return da.localeCompare(db);
  });
  // Resolution on-demand du code exact. Ne tire que si la saisie ressemble
  // a un slug et qu'aucun event deja charge ne porte ce code.
  useEffect(() => {
    const raw = searchQuery.trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw || !/^[a-z0-9-]+$/.test(raw)) { setSearchExtra(null); return; }
    if (events.some(e => e.code === raw)) { setSearchExtra(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`${API_URL}/public-events/${encodeURIComponent(raw)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(ev => { if (!cancelled) setSearchExtra(ev && ev.code ? ev : null); })
        .catch(() => { if (!cancelled) setSearchExtra(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery, events]);

  const scrollRef = useRef(null);
  const searchBarRef = useRef(null);
  const searchOpenRef = useRef(false);
  const scrollYRef = useRef(0);

  // scrollTop : remonter en haut a la fermeture. Vrai pour une fermeture
  // DELIBEREE (loupe, croix) — l utilisateur en a fini, on retrouve l etat
  // d origine. Faux quand la fermeture est le sous-produit d un autre geste
  // (tap dans la liste, scroll) : le rappeler en haut en plein mouvement
  // serait brutal et lui ferait perdre sa position.
  const closeSearch = useCallback(({ scrollTop = false } = {}) => {
    setSearchQuery('');
    setCodeInput('');
    setCodeError('');
    setSearchOpen(false);
    Keyboard.dismiss();
    if (scrollTop) {
      // Le listener keyboardDidHide est inhibe tant que la recherche est
      // ouverte : on remonte explicitement.
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, []);
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
    scrollYRef.current = y;
    setShowBackTop(y > 400);
  }, []);

  useEffect(() => { searchOpenRef.current = searchOpen; }, [searchOpen]);

  // Clavier ouvert alors que la recherche est deployee : on ne remonte QUE
  // de ce qui est reellement masque. Un scroll jusqu en haut ferait passer
  // les onglets sous le header — l utilisateur perd ses reperes pour un
  // probleme qui ne concerne que le bas de la barre.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      if (!searchOpenRef.current || !searchBarRef.current) return;
      const kbTop = e?.endCoordinates?.screenY;
      if (!kbTop) return;
      searchBarRef.current.measureInWindow((x, y, w, h) => {
        // 16 px d air sous la barre pour ne pas la coller au clavier.
        const cache = (y + h + 16) - kbTop;
        if (cache <= 0) return;   // deja entierement visible : on ne bouge pas
        scrollRef.current?.scrollTo({ y: scrollYRef.current + cache, animated: true });
      });
    });
    return () => sub.remove();
  }, []);

  // Quand le clavier se ferme : remonter le scroll en haut.
  // SAUF si la recherche est ouverte — sinon fermer le clavier (tap hors
  // champ) ferait redescendre la barre hors ecran alors qu elle est encore
  // en cours d utilisation. Lecture par ref : la closure est figee (deps []).
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (searchOpenRef.current) return;
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
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} onScroll={onScrollWatch} onScrollBeginDrag={() => { if (searchOpen) closeSearch(); }} keyboardShouldPersistTaps="handled" style={s.scroll} contentContainerStyle={{ paddingTop: headerH, paddingBottom: 120 }} showsVerticalScrollIndicator={false} topOffset={headerH}>
      {/* Header retire : il est maintenant rendu UNE FOIS dans App.js
          (AppHeader.js) au-dessus du tab container -> aucun re-mount au
          switch Accueil <-> Photos. */}

      {/* Carrousel "Galerie ouverte" : derniers events passes avec photos. */}
      <HotOnesCarousel
        events={events}
        onOpenEvent={onOpenEvent}
        isAuthed={isAuthed}
        onSignup={onOpenAuthSignup}
        onLogin={onOpenAuthLogin}
      />

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
          <TouchableOpacity onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setTab('upcoming'); }} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>À venir</Text>
          </TouchableOpacity>
          {tab === 'follows' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
          <TouchableOpacity onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setTab('past'); }} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>Passés</Text>
          </TouchableOpacity>
          {tab === 'upcoming' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
          <TouchableOpacity onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setTab('follows'); }} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}>
            <Text style={[s.pillText, tab === 'follows' && s.pillTextActive]}>Suivis</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => {
            if (searchOpen) closeSearch({ scrollTop: true });
            else setSearchOpen(true);
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
      {/* Barre composee, calquee sur celle du site : recherche libre en haut,
          saisie du code event en bas. Les deux chemins coexistent parce qu'ils
          repondent a deux intentions differentes — explorer, ou rejoindre un
          event precis dont on a recu le code. */}
      {searchOpen && (
        <View
          ref={searchBarRef}
          style={{
            backgroundColor: '#fff',
            borderRadius: 16,
            borderWidth: 1.5,
            borderColor: '#E5E0FF',
            marginBottom: 8,
            overflow: 'hidden',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Rechercher un event"
              placeholderTextColor="#c9beed"
              style={{ flex: 1, fontSize: 14, color: C.primary, fontFamily: 'Montserrat', paddingVertical: 11 }}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <TouchableOpacity
              onPress={() => closeSearch({ scrollTop: true })}
              hitSlop={10}
              style={{ paddingHorizontal: 6 }}
            >
              <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              value={codeInput}
              onChangeText={(v) => { setCodeInput(v); if (codeError) setCodeError(''); }}
              placeholder="Code event"
              placeholderTextColor="#c9beed"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={openByCode}
              style={{ fontFamily: 'Montserrat', flex: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: C.primary }}
            />
            <TouchableOpacity
              activeOpacity={0.85}
              disabled={!codeInput.trim() || codeLoading}
              onPress={openByCode}
              style={{ paddingHorizontal: 16, paddingVertical: 11, justifyContent: 'center' }}
            >
              <Text style={{
                color: codeInput.trim() ? C.primary : '#A89CB8',
                fontSize: 14, fontFamily: 'Montserrat-SemiBold',
              }}>
                {codeLoading ? '…' : 'Ouvrir'}
              </Text>
            </TouchableOpacity>
          </View>
          {!!codeError && (
            <Text style={{ fontFamily: 'Montserrat', paddingHorizontal: 14, paddingBottom: 10, fontSize: 12, color: '#D6455B' }}>
              {codeError}
            </Text>
          )}
        </View>
      )}

      {/* Events list / etat vide. Cas special : Favoris en deconnecte
          -> empty state pedagogique 3 etapes (compte / selfie / favori). */}
      <Animated.View style={{ opacity: contentFade, transform: [{ translateX: contentSlideX }] }}>
        {/* Recherche ouverte : un tap n importe ou dans la liste la referme.
            Le voile est AU-DESSUS des cards et consomme le tap — sinon on
            ouvrirait un event en voulant juste fermer la recherche. */}
        {searchOpen && (
          <Pressable
            onPress={() => closeSearch()}
            style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]}
            accessibilityLabel="Fermer la recherche"
          />
        )}
        {filtered.length === 0 ? (
          tab === 'follows' ? (
            <EtatVideWill
              variante="suivis"
              titre={'Pas encore\nde suivis'}
              sousTexte={"Ajoute tes events à suivre"}
            />
          ) : (
          <View style={{
            paddingVertical: 40,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14,
          }}>
            <IlluPasDePhotos height={72} />
            <View style={{ alignItems: 'flex-start', gap: 3, flexShrink: 1 }}>
              <Text style={{
                color: '#C9B6FF', fontSize: 18,
                fontFamily: 'AVEstiana-Bold', letterSpacing: -0.2,
              }}>
                {tab === 'upcoming' ? 'Aucun événement à venir' : 'Aucun événement passé'}
              </Text>
            </View>
          </View>
          )
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
                    onPress={() => onOpenOrgRole && onOpenOrgRole('create')}
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
