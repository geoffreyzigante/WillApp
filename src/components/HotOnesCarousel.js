// Carrousel "Hot ones" : derniers events passes avec photos publiques
// (has_photos = true cote worker). Design hero iOS : cover full-bleed avec
// rotation auto-play d une photo random toutes les 3.5s, overlay sombre,
// nom + ville · type en bas. Brand WILL : titre AVEstiana sans fontWeight.
//
// Coût réseau : 1 fetch /list-public/{code} par card affichée (max 10),
// limité aux 5 premières photos après shuffle pour borner la mémoire.

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated } from 'react-native';
import Svg, { Path, Ellipse } from 'react-native-svg';
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
// Mascotte Will qui se prend en selfie (SVG fourni par le user,
// 2026-09-01). ViewBox d origine 929x606.
function MascotteSelfie({ width = 200 }) {
  const h = width * (606.46 / 929.05);
  return (
    <Svg width={width} height={h} viewBox="0 0 929.05 606.46">
      <Path fill="#f4a6ff" d="M840.86,467.69c1.79-.74,3.61-1.37,5.39-2.19,68-31.27,100.65-105.48,72.93-165.76-23.88-51.92-84.75-76.46-144.63-62.32.74-1.8,1.58-3.52,2.26-5.36,25.97-70.19-3.42-145.76-65.64-168.78-53.6-19.83-114,5.86-146.33,58.2-.74-1.79-1.37-3.61-2.19-5.39-31.27-68-105.48-100.65-165.76-72.93-51.92,23.87-76.46,84.75-62.32,144.63-1.8-.74-3.52-1.58-5.36-2.26-70.19-25.97-145.76,3.42-168.78,65.64-19.83,53.6,5.86,114,58.2,146.33-1.79.75-3.61,1.37-5.39,2.19-68,31.27-100.65,105.48-72.93,165.76,7.63,16.6,19.06,30.38,33.01,41.01h728.2c14.89-51.63-10.76-107.95-60.65-138.78Z" />
      <Ellipse fill="#fff" cx="395.38" cy="328.7" rx="74.72" ry="103.43" />
      <Ellipse fill="#fff" cx="632.18" cy="328.7" rx="74.72" ry="103.43" />
      <Path fill="#000" d="M614.59,483.99c-23.66,7.76-48.26,12.38-73.11,13.71-27.59,1.46-55.14-1.09-81.99-7.62-8.88-2.14-17.84,3.29-20,12.18-2.16,8.89,3.29,17.84,12.18,20,24.51,5.96,49.56,8.96,74.7,8.96,5.63,0,11.27-.15,16.89-.45,27.76-1.49,55.23-6.64,81.66-15.31,8.69-2.85,13.43-12.21,10.57-20.9-2.85-8.69-12.22-13.42-20.9-10.57Z" />
      <Path fill="#000" d="M397.9,309.4c3.65-2.05,7.99-3.62,12.64-3.76-4.14-19.04-17.15-32.96-32.59-32.96-18.77,0-33.98,20.54-33.98,45.87s15.21,45.87,33.98,45.87c15.55,0,28.63-14.11,32.67-33.35-4.68-.12-9.05-1.7-12.72-3.77-7-3.93-7-13.98,0-17.91Z" />
      <Path fill="#000" d="M634.7,309.4c3.65-2.05,7.99-3.62,12.64-3.76-4.14-19.04-17.15-32.96-32.59-32.96-18.77,0-33.98,20.54-33.98,45.87s15.22,45.87,33.98,45.87c15.55,0,28.63-14.11,32.67-33.35-4.68-.12-9.05-1.7-12.72-3.77-7-3.93-7-13.98,0-17.91Z" />
      <Path fill="#000" d="M242.89,513.46c-18.78-1.66-66.74-9.88-106.32-50.18-29.41-29.94-40.97-64.22-45.52-87.1h39.38c9.15,0,16.56-7.42,16.56-16.56v-192.91c0-9.15-7.42-16.56-16.56-16.56H16.56c-9.15,0-16.56,7.42-16.56,16.56v192.91c0,9.15,7.42,16.56,16.56,16.56h40.83c4.52,27.03,17.62,71.69,55.54,110.3,47.3,48.16,104.6,57.97,127.04,59.96.49.04.99.07,1.48.07,8.49,0,15.71-6.49,16.48-15.11.81-9.11-5.92-17.15-15.04-17.95Z" />
      <Path fill="#000" d="M119.47,132.07c.23,0,.47,0,.7-.01,9.14-.38,16.24-8.1,15.86-17.24l-.92-22c-.38-9.14-8.09-16.12-17.24-15.86-9.14.38-16.24,8.1-15.86,17.24l.92,22c.38,8.91,7.71,15.87,16.54,15.87Z" />
      <Path fill="#000" d="M172.8,159.53c3.53,0,7.09-1.13,10.11-3.45l25.76-19.88c7.24-5.59,8.58-15.99,3-23.23-5.59-7.24-15.98-8.57-23.23-3l-25.76,19.88c-7.24,5.59-8.58,15.99-3,23.23,3.26,4.23,8.17,6.44,13.12,6.44Z" />
      <Path fill="#000" d="M202.48,186.15l-21.5-4.53c-8.95-1.87-17.73,3.84-19.62,12.79-1.88,8.95,3.84,17.73,12.79,19.62l21.5,4.53c1.15.24,2.3.36,3.43.36,7.66,0,14.54-5.35,16.19-13.15,1.88-8.95-3.84-17.73-12.79-19.62Z" />
      <Path fill="#000" d="M925.41,241.81c-1.18-32.04-11.62-63.87-30.46-93.78,4.31-5.62,7.72-11.76,10.06-18.37,7.63-21.54,2.14-40.85-1.8-50.46-3.38-8.22-12.61-12.21-20.91-9.23,0-14.26-.14-31.82-.41-53.62-.11-9.08-7.5-16.36-16.55-16.36-.07,0-.14,0-.21,0-9.14.11-16.47,7.62-16.35,16.76.24,19.96.33,41.17.21,59.04l-30.2-58.13c-4.22-8.11-14.21-11.28-22.33-7.06-8.12,4.22-11.28,14.21-7.06,22.33l31.4,60.44c-3,.02-6.03.86-8.75,2.59-7.72,4.91-9.99,15.15-5.08,22.86,5.79,9.09,13.77,16.74,23.1,22.12,7.8,4.5,16.56,7.4,25.53,8.49,17.99,23.33,35.33,55.43,36.73,93.58,1.16,31.26-8.95,55.53-24.51,88.99-29.72,63.91-63.84,128.31-101.43,191.41-4.68,7.86-2.1,18.02,5.75,22.7,2.65,1.58,5.58,2.33,8.46,2.33,5.64,0,11.14-2.88,14.24-8.09,38.16-64.06,72.82-129.46,103.01-194.4,17.05-36.66,29-65.59,27.58-104.17Z" />
    </Svg>
  );
}

function WelcomeCard({ onSignup, onLogin }) {
  return (
    <View style={styles.card}>
      {/* Fidele a la maquette (2026-08-31) : violet plein de la charte,
          pas d ornement, "Créer mon compte" souligne d un filet. */}
      {/* Ancre sur LE violet de l app (#7B2FFF — logo, boutons, onglets)
          pour que la carte soit exactement dans le meme violet que le
          reste de l accueil, avec un fondu vers la lavande du bandeau. */}
      {/* Regle de charte : le clair en HAUT A DROITE, le violet profond
          en bas a gauche. */}
      {/* Maquette user 2026-09-01 : halo rose confine au coin haut droit
          (#DB90FD), violet #7234F5 dominant ; titre et lien secondaire en
          rose charte pinkPill (#F4A6FF, pipe sur la maquette) ; icone photo
          blanche en tete ; chevrons sur les deux actions. */}
      <LinearGradient
        colors={['#DB90FD', '#9A55F8', '#7234F5']}
        locations={[0, 0.2, 0.5]}
        start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }}
        style={{ flex: 1, padding: 18, paddingTop: 24, justifyContent: 'flex-start' }}
      >
        <Text style={{ color: C.pinkPill, fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 24, lineHeight: lh(24, 25) }}>
          Un selfie.{'\n'}Toutes tes photos.
        </Text>
        <Text style={{ color: '#fff', fontFamily: 'Montserrat-Medium', fontSize: 12, lineHeight: 17, marginTop: 12 }}>
          Crée ton compte, prends ton selfie et retrouve tes photos après chaque event.
        </Text>
        {/* Maquette 2026-09-01 : les deux actions sur UNE ligne, separees
            d un filet vertical — Inscription blanc gras, Connexion rose
            regular, sans chevrons. */}
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={onSignup} hitSlop={10}>
            <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 15 }}>Inscription</Text>
          </TouchableOpacity>
          <View style={{ width: 1, height: 15, backgroundColor: 'rgba(255,255,255,0.45)' }} />
          <TouchableOpacity onPress={onLogin} hitSlop={10}>
            <Text style={{ color: C.pinkPill, fontFamily: 'Montserrat', fontSize: 15 }}>Connexion</Text>
          </TouchableOpacity>
        </View>
        {/* Mascotte collee au bas de la carte, bord a bord. */}
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' }}>
          <MascotteSelfie width={138} />
        </View>
      </LinearGradient>
    </View>
  );
}

export function HotOnesCarousel({ events, onOpenEvent, isAuthed = true, onSignup, onLogin }) {
  // featured_new (admin) -> en tete du carousel, suivi des events passes
  // avec photos. dedup pour eviter qu un featured_new past apparaisse 2x.
  const newOnes = (events || []).filter(e => e?.featured_new === true);
  const newCodes = new Set(newOnes.map(e => e.code));
  const past = (events || [])
    .filter(e => e && !newCodes.has(e.code) && e.has_photos && !isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (b.event_date_end || b.event_date || '').localeCompare(a.event_date_end || a.event_date || ''));
  const hotOnes = [...newOnes, ...past].slice(0, MAX_ITEMS);
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
    backgroundColor: '#7B2FFF',
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
