// Carrousel "Hot ones" : events passes avec photos publiques, dans un ordre
// tire au sort a chaque ouverture (la carte d invitation, elle, reste en tete)
// (has_photos = true cote worker). Design hero iOS : cover full-bleed avec
// rotation auto-play d une photo random toutes les 3.5s, overlay sombre,
// nom + ville · type en bas. Brand WILL : titre AVEstiana sans fontWeight.
//
// Coût réseau : 1 fetch /list-public/{code} par card affichée (max 10),
// limité aux 5 premières photos après shuffle pour borner la mémoire.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GrainViolet } from './GrainViolet';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colorForType, C } from '../constants/colors';
import { displayEventType, cityLabel, isUpcoming } from '../utils/format';
import { API_URL } from '../constants/api';
import { lh } from '../constants/typo';

const HOT_ICON_PATH = "M14.23,5.38c-.29-.35-.86-.2-.98.24-.24.82-.66,1.59-1.17,2.27.05-2.98-1.33-5.74-3.52-7.69-.41-.36-1.08-.2-1.25.31-.67,2.03-2.48,3.44-3.77,5.12-5.63,6.25,3.31,16.13,9.78,10.23,2.86-2.53,3.36-7.53.91-10.47ZM8.91,15.24c-3.91,0-2.43-5.24-.45-6.9.21-.18.52-.16.69.06,1.39,1.72,3.67,6.85-.24,6.85Z";

const CARD_W = 220;
const CARD_H = 300;
const MAX_ITEMS = 10;
const PHOTOS_PER_CARD = 5;
const ROTATE_INTERVAL_MS = 3500;

function HotCard({ event, onPress, isActive }) {
  const tint = colorForType(event.event_type);
  const typeLabel = displayEventType(event.event_type);
  const city = cityLabel(event.location);
  const subline = [city, typeLabel].filter(Boolean).join(' · ');

  const [photos, setPhotos] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Pill "Hot" anime opacity (mirror site: transition 800ms ease).
  const pillOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pillOpacity, {
      toValue: isActive ? 1 : 0,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, [isActive, pillOpacity]);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/list-public/${event.code}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!alive || !data) return;
        const ps = (data.photos || []).slice();
        // Shuffle Fisher-Yates pour rotation aleatoire
        for (let i = ps.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ps[i], ps[j]] = [ps[j], ps[i]];
        }
        setPhotos(ps.slice(0, PHOTOS_PER_CARD));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [event.code]);

  useEffect(() => {
    if (photos.length <= 1) return;
    const id = setInterval(() => {
      setCurrentIdx(i => (i + 1) % photos.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [photos.length]);

  const currentPhoto = photos[currentIdx];
  const coverUri = currentPhoto?.thumb_md_url || currentPhoto?.thumb_url || event.cover_image;

  return (
    <TouchableOpacity activeOpacity={0.88} onPress={onPress} style={styles.card}>
      <View style={[styles.cover, { backgroundColor: tint }]}>
        {coverUri ? (
          <ExpoImage
            source={{ uri: coverUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={1800}
            cachePolicy="memory-disk"
          />
        ) : null}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']}
          locations={[0.45, 0.65, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <Animated.View style={[styles.hotPill, { opacity: pillOpacity }]} pointerEvents="none">
          <Svg width={11} height={11} viewBox="0 0 17.61 17.61">
            <Path d={HOT_ICON_PATH} fill="#fff" />
          </Svg>
          <Text style={styles.hotPillText}>{event.featured_new ? 'New' : 'Hot'}</Text>
        </Animated.View>
        <View style={styles.overlay}>
          <Text style={styles.name} numberOfLines={2}>{event.name || 'Sans nom'}</Text>
          {subline ? (
            <Text style={styles.subline} numberOfLines={1}>{subline}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// Carte "Bienvenue sur Will" : premiere carte du carrousel pour le
// visiteur non connecte (mockup user 2026-08-31). Meme gabarit que les
// HotCard ; elle tourne dans la boucle infinie comme les autres.
// Carte d'accueil visiteur (plus de mascotte depuis 2026-11-23).
function WelcomeCard({ onSignup, onLogin }) {
  return (
    <View style={styles.card}>
      {/* Fidele a la maquette (2026-08-31) : violet plein de la charte,
          pas d ornement, "S’inscrire" souligne d un filet. */}
      {/* Ancre sur LE violet de l app (#7B2FFF — logo, boutons, onglets)
          pour que la carte soit exactement dans le meme violet que le
          reste de l accueil, avec un fondu vers la lavande du bandeau. */}
      {/* Regle de charte : le clair en HAUT A DROITE, le violet profond
          en bas a gauche. */}
      {/* Maquette user 2026-09-01 : halo rose confine au coin haut droit
          (#DB90FD), violet #7234F5 dominant ; titre et lien secondaire en
          rose charte pinkPill (#F4A6FF, pipe sur la maquette) ; icone photo
          blanche en tete ; chevrons sur les deux actions. */}
      <GrainViolet fleur={{ taille: 170, droite: -62, haut: -72 }} style={{ flex: 1, padding: 18, paddingTop: Platform.OS === 'android' ? 16 : 24, justifyContent: 'flex-start' }}>
        {Platform.OS === 'android' ? (
          // Android : lineHeight sous la hauteur naturelle de la police coupe la
          // derniere ligne (voir lh()). Pour resserrer l interligne comme sur
          // iOS, une Text par ligne, chacune a sa hauteur naturelle, rapprochees
          // par une marge negative.
          <View>
            {['Un selfie.', 'Toutes tes', 'photos.'].map((ligne, i) => (
              <Text key={ligne} style={{ color: '#fff', fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 24, lineHeight: lh(24, 25), marginTop: i === 0 ? 0 : -6 }}>
                {ligne}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={{ color: '#fff', fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 24, lineHeight: lh(24, 25) }}>
            Un selfie.{'\n'}Toutes tes photos.
          </Text>
        )}
        <Text style={{ color: '#fff', fontFamily: 'Montserrat-Medium', fontSize: 14, lineHeight: 19, marginTop: Platform.OS === 'android' ? 8 : 12 }}>
          Un compte, un selfie : retrouve tes photos après chaque event.
        </Text>
        {/* Double CTA (user 2026-11-23) : deux moities roses egales, texte violet,
            colles en bas de la carte. Plus de mascotte. */}
        <View style={{ position: 'absolute', left: 18, right: 18, bottom: 18, flexDirection: 'row' }}>
          {[['S’inscrire', onSignup], ['Connexion', onLogin]].map(([label, onPress]) => (
            <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.85} style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: C.pinkPill, alignItems: 'center', justifyContent: 'center' }}>
              <Text numberOfLines={1} style={{ color: C.primary, fontFamily: 'Montserrat-Medium', fontSize: 15 }}>{label}</Text>
            </TouchableOpacity>
          ))}
          {/* Filet blanc entre les deux moities (maquette user). */}
          <View pointerEvents="none" style={{ position: 'absolute', left: '50%', marginLeft: -1, top: 11, bottom: 11, width: 2, borderRadius: 1, backgroundColor: '#fff' }} />
        </View>
      </GrainViolet>
    </View>
  );
}

export function HotOnesCarousel({ events, onOpenEvent, isAuthed = true, onSignup, onLogin }) {
  // featured_new (admin) + events passes avec photos. dedup pour eviter qu un
  // featured_new past apparaisse 2x.
  const newOnes = (events || []).filter(e => e?.featured_new === true);
  const newCodes = new Set(newOnes.map(e => e.code));
  const past = (events || [])
    .filter(e => e && !newCodes.has(e.code) && e.has_photos && !isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (b.event_date_end || b.event_date || '').localeCompare(a.event_date_end || a.event_date || ''));
  const candidats = [...newOnes, ...past].slice(0, MAX_ITEMS);

  // Ordre aleatoire (user 2026-10-25) : le carousel etait trie par date, donc
  // le meme event ouvrait la page pendant des semaines et les suivants
  // n etaient jamais vus. Tire au sort une fois par liste, pas a chaque
  // rendu — sinon les cartes sauteraient a chaque rotation de photo.
  const cles = candidats.map(e => e.code).join(',');
  const hotOnes = useMemo(() => {
    const liste = [...candidats];
    for (let i = liste.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [liste[i], liste[j]] = [liste[j], liste[i]];
    }
    return liste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles]);

  // La carte d invitation reste en tete, hors tirage : c est le seul endroit
  // ou un visiteur non connecte apprend a quoi sert Will.
  const items = (!isAuthed && onSignup)
    ? [{ __welcome: true, code: '__welcome' }, ...hotOnes]
    : hotOnes;

  // Track la carte au centre du viewport pour n'afficher la pastille "Hot"
  // que sur celle-ci (mirror site mobile : pastille active uniquement).
  const [activeIdx, setActiveIdx] = useState(0);
  // Vrai infinity slide : cards dupliquees 4x. Init au debut du 2e set.
  // Reset transparent dans onMomentumScrollEnd quand le user atteint
  // le 4e set ou revient au 1er.
  const duplicated = [...items, ...items, ...items, ...items];
  const scrollRef = useRef(null);
  const initRef = useRef(false);
  const itemW = CARD_W + 14;
  const loopWidth = items.length * itemW;
  useEffect(() => {
    if (initRef.current || items.length === 0) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: loopWidth, animated: false });
      initRef.current = true;
    }, 50);
    return () => clearTimeout(t);
  }, [items.length, loopWidth]);

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={itemW}
        snapToAlignment="start"
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          // Reset quand le user atteint le 4e set (= x >= 3 * loopWidth)
          // ou revient au 1er (x <= loopWidth * 0.5). Saut de 2 sets
          // pour rester confortablement au centre.
          if (x >= 3 * loopWidth) {
            scrollRef.current?.scrollTo({ x: x - 2 * loopWidth, animated: false });
          } else if (x <= loopWidth * 0.5) {
            scrollRef.current?.scrollTo({ x: x + 2 * loopWidth, animated: false });
          }
        }}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / itemW) % items.length;
          if (idx !== activeIdx) setActiveIdx(idx);
        }}
        scrollEventThrottle={32}
      >
        {duplicated.map((ev, i) => (
          ev.__welcome ? (
            <WelcomeCard key={`welcome-${i}`} onSignup={onSignup} onLogin={onLogin} />
          ) : (
            <HotCard
              key={`${ev.code}-${i}`}
              event={ev}
              onPress={() => onOpenEvent(ev)}
              isActive={i % items.length === activeIdx}
            />
          )
        ))}
      </ScrollView>
      {/* Fade-out a droite (mirror site .hot-section::after) : suggere
          qu'il y a plus de cards a scroller. */}
      <LinearGradient
        colors={['rgba(245,243,255,0)', 'rgba(245,243,255,0.95)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        pointerEvents="none"
        style={styles.edgeFade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // marginHorizontal: -20 annule le paddingHorizontal du parent (s.scroll)
  // -> le carousel devient full-bleed comme sur le site (.hot-section .container
  // { padding: 0 }). La 1ere carte est positionnee a 20px du bord physique
  // grace au paddingLeft du scrollContent (= align avec le contenu hors carousel).
  section: { marginTop: 8, marginBottom: 18, marginHorizontal: -20, position: 'relative' },
  // Mirror site .hot-scroll : padding-left 20 (1ere carte alignee avec
  // le contenu en dessous, pas collee au bord), gap 14, padding-right
  // pour que la derniere carte puisse se snapper a gauche.
  scrollContent: { paddingLeft: 20, paddingRight: 14, gap: 14 },
  edgeFade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 60,
  },
  hotPill: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: C.primary,
    zIndex: 2,
  },
  hotPillText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Montserrat-Bold',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#f4f1ff',
  },
  cover: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingTop: 24,
  },
  name: {
    color: '#fff',
    fontSize: 18,
    fontFamily: 'AVEstiana',
    lineHeight: lh(18, 21),
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subline: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    
    fontFamily: 'Montserrat',
    marginTop: 6,
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
