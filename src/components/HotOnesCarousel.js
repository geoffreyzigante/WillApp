// Carrousel horizontal "Galerie ouverte" affiche les derniers events
// passes qui ont deja des photos publiques (has_photos = true cote worker).
// Sert a peupler l accueil pour les utilisateurs sans events suivis et a
// donner un signal "le produit tourne" : il y a deja de la galerie ouverte.
//
// Si aucun event ne match (compte frais + plateforme silencieuse), la
// section ne se rend pas du tout pour eviter un titre orphelin.

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colorForType, C } from '../constants/colors';
import { displayEventType, cityLabel, isUpcoming } from '../utils/format';

const CARD_W = 180;
const CARD_H = 220;
const COVER_H = 130;
const MAX_ITEMS = 10;

function HotCard({ event, onPress }) {
  const tint = colorForType(event.event_type);
  const typeLabel = displayEventType(event.event_type);
  const city = cityLabel(event.location);
  const dateLabel = formatRelativeEventDate(event.event_date_end || event.event_date);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      <View style={[styles.cover, { backgroundColor: tint }]}>
        {event.cover_image ? (
          <ExpoImage
            source={{ uri: event.cover_image }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
          />
        ) : null}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
          start={{ x: 0, y: 0.4 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        {typeLabel ? (
          <View style={[styles.typePill, { backgroundColor: tint }]}>
            <Text style={styles.typePillText} numberOfLines={1}>{typeLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={2}>{event.name || 'Sans nom'}</Text>
        <Text style={styles.subline} numberOfLines={1}>
          {[dateLabel, city].filter(Boolean).join(' • ')}
        </Text>
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
      <View style={styles.header}>
        <Text style={styles.title}>Galerie ouverte</Text>
        <Text style={styles.subtitle}>Photos déjà disponibles</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_W + 12}
        snapToAlignment="start"
      >
        {hotOnes.map(ev => (
          <HotCard key={ev.code} event={ev} onPress={() => onOpenEvent(ev)} />
        ))}
      </ScrollView>
    </View>
  );
}

function formatRelativeEventDate(iso) {
  if (!iso) return '';
  try {
    const ts = new Date(iso).getTime();
    if (isNaN(ts)) return '';
    const diffDays = Math.floor((Date.now() - ts) / (24 * 3600 * 1000));
    if (diffDays <= 0) return "aujourd'hui";
    if (diffDays === 1) return 'hier';
    if (diffDays < 7) return `il y a ${diffDays}j`;
    if (diffDays < 30) return `il y a ${Math.floor(diffDays / 7)} sem`;
    const d = new Date(ts);
    const MONTHS = ['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  } catch { return ''; }
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  header: { paddingHorizontal: 4, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 12, color: C.textSoft, marginTop: 2 },
  scrollContent: { paddingRight: 8, gap: 12 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#1A0A3E',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cover: { width: '100%', height: COVER_H, position: 'relative' },
  typePill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: '80%',
  },
  typePillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  meta: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    justifyContent: 'space-between',
  },
  name: { fontSize: 13, fontWeight: '600', color: C.text, lineHeight: 17 },
  subline: { fontSize: 11, color: C.textSoft },
});
