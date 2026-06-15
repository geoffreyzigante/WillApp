// Carrousel "Hot ones" : derniers events passes avec photos publiques
// (has_photos = true cote worker). Design hero iOS : cover full-bleed avec
// rotation auto-play d une photo random toutes les 3.5s, overlay sombre,
// nom + ville · type en bas. Brand WILL : titre AVEstiana sans fontWeight.
//
// Coût réseau : 1 fetch /list-public/{code} par card affichée (max 10),
// limité aux 5 premières photos après shuffle pour borner la mémoire.

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
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

function HotCard({ event, onPress }) {
  const tint = colorForType(event.event_type);
  const typeLabel = displayEventType(event.event_type);
  const city = cityLabel(event.location);
  const subline = [city, typeLabel].filter(Boolean).join(' · ');

  const [photos, setPhotos] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);

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
            transition={500}
            cachePolicy="memory-disk"
          />
        ) : null}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.75)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.hotPill}>
          <Svg width={11} height={11} viewBox="0 0 17.61 17.61">
            <Path d={HOT_ICON_PATH} fill="#fff" />
          </Svg>
          <Text style={styles.hotPillText}>Hot</Text>
        </View>
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
  const hotOnes = (events || [])
    .filter(e => e && e.has_photos && !isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (b.event_date_end || b.event_date || '').localeCompare(a.event_date_end || a.event_date || ''))
    .slice(0, MAX_ITEMS);

  if (hotOnes.length === 0) return null;

  return (
    <View style={styles.section}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_W + 14}
        snapToAlignment="start"
      >
        {hotOnes.map(ev => (
          <HotCard key={ev.code} event={ev} onPress={() => onOpenEvent(ev)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 6, marginBottom: 18 },
  scrollContent: { paddingRight: 14, gap: 14 },
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
    backgroundColor: '#fff',
    shadowColor: '#1A0A3E',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    elevation: 4,
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
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
