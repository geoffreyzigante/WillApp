// Carrousel "Hot ones" : derniers events passes avec photos publiques
// (has_photos = true cote worker). Design hero iOS : cover full-bleed avec
// rotation auto-play d une photo random toutes les 3.5s, overlay sombre,
// nom + ville · type en bas. Brand WILL : titre AVEstiana sans fontWeight.
//
// Coût réseau : 1 fetch /list-public/{code} par card affichée (max 10),
// limité aux 5 premières photos après shuffle pour borner la mémoire.

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colorForType, C } from '../constants/colors';
import { displayEventType, cityLabel, isUpcoming } from '../utils/format';
import { API_URL } from '../constants/api';

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

export function HotOnesCarousel({ events, onOpenEvent }) {
  // featured_new (admin) -> en tete du carousel, suivi des events passes
  // avec photos. dedup pour eviter qu un featured_new past apparaisse 2x.
  const newOnes = (events || []).filter(e => e?.featured_new === true);
  const newCodes = new Set(newOnes.map(e => e.code));
  const past = (events || [])
    .filter(e => e && !newCodes.has(e.code) && e.has_photos && !isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (b.event_date_end || b.event_date || '').localeCompare(a.event_date_end || a.event_date || ''));
  const hotOnes = [...newOnes, ...past].slice(0, MAX_ITEMS);

  // Track la carte au centre du viewport pour n'afficher la pastille "Hot"
  // que sur celle-ci (mirror site mobile : pastille active uniquement).
  const [activeIdx, setActiveIdx] = useState(0);
  // Infinity slide manuel : cards dupliquees 2x. Init scrollLeft au
  // milieu (debut du 2e set) -> user a 1 set de marge dans chaque
  // direction. Reset transparent UNIQUEMENT a la fin du momentum
  // (onMomentumScrollEnd) pour ne pas casser l inertie iOS pendant le
  // fling.
  const duplicated = [...hotOnes, ...hotOnes];
  const scrollRef = useRef(null);
  const initRef = useRef(false);
  const itemW = CARD_W + 14;
  const loopWidth = hotOnes.length * itemW;
  useEffect(() => {
    if (initRef.current || hotOnes.length === 0) return;
    // Init au centre apres mount (laisse le ScrollView mesurer son content).
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: loopWidth, animated: false });
      initRef.current = true;
    }, 50);
    return () => clearTimeout(t);
  }, [hotOnes.length, loopWidth]);

  if (hotOnes.length === 0) return null;

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
          // Reset seulement aux extremes (>95% / <5%) une fois le momentum
          // termine, pour rester invisible pour l user.
          const max = loopWidth * 2;
          if (x >= max * 0.95) {
            scrollRef.current?.scrollTo({ x: x - loopWidth, animated: false });
          } else if (x <= max * 0.05) {
            scrollRef.current?.scrollTo({ x: x + loopWidth, animated: false });
          }
        }}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / itemW) % hotOnes.length;
          if (idx !== activeIdx) setActiveIdx(idx);
        }}
        scrollEventThrottle={32}
      >
        {duplicated.map((ev, i) => (
          <HotCard
            key={`${ev.code}-${i}`}
            event={ev}
            onPress={() => onOpenEvent(ev)}
            isActive={i % hotOnes.length === activeIdx}
          />
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
    fontWeight: '800',
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
    lineHeight: 21,
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subline: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Montserrat',
    marginTop: 6,
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
