import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions,
  StatusBar, SafeAreaView, Platform, KeyboardAvoidingView, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as Font from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

const API_URL = 'https://will-api.geoffreyzigante.workers.dev';
const R2_PUBLIC = 'https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev';
const { width: SCREEN_W } = Dimensions.get('window');

// ---------- DESIGN TOKENS ----------
const C = {
  bg: '#FFFFFF',
  primary: '#7B2FFF',
  primaryDark: '#5A1FCC',
  primaryLight: '#E8DEFF',
  text: '#0A0A0A',
  textSoft: '#6B6B7B',
  white: '#FFFFFF',
  pillBg: '#EFE7FF',
  pinkPill: '#F4A6FF',
  pinkPillText: '#FFFFFF',
  card: '#FFFFFF',
  shadow: 'rgba(123, 47, 255, 0.08)',
};

const TYPE_COLORS = {
  Trail: '#4A9E7A',
  'Course sur route': '#5B82C4',
  Cross: '#B05A4A',
  Hyrox: '#4A4A4A',
  Triathlon: '#4A8A9E',
  Velo: '#7A5AB0',
  Marche: '#9E8A4A',
  Autre: '#6A6A6A',
};

// ---------- ICONS (custom SVG) ----------
const Icon = {
  Bell: ({ size = 22, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (17.61/16.93)} viewBox="0 0 16.93 17.61" fill={color}>
      <Path d="M14.14,8.93l.02-1.68c.02-1.39-.31-2.76-1.09-3.91-.74-1.09-1.92-1.7-3.21-1.95C9.81.58,9.2,0,8.44,0c-.76,0-1.36.59-1.4,1.38-1.28.27-2.43.87-3.16,1.94-.76,1.11-1.11,2.44-1.1,3.78l.02,2.01c0,.75-.11,1.49-.44,2.15-.51,1.01-1.65,1.33-2.16,2.08-.21.31-.24.69-.09,1.05.1.24.41.56.78.57h4.93c.03,1.56,1.26,2.67,2.69,2.64,1.42-.03,2.56-1.16,2.59-2.63h5.02c.37-.01.66-.38.75-.62.13-.33.08-.76-.14-1.04-.9-1.16-2.63-1.08-2.59-4.38Z" />
    </Svg>
  ),
  User: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (17.61/18.96)} viewBox="0 0 18.96 17.61" fill={color}>
      <Path d="M10.16,0h-1.35C3.94,0,0,3.94,0,8.8s3.94,8.8,8.8,8.8h1.35c4.86,0,8.8-3.94,8.8-8.8S15.02,0,10.16,0ZM9.48,2.77c1.28,0,2.32,1.14,2.32,2.55s-1.04,2.55-2.32,2.55-2.32-1.14-2.32-2.55,1.04-2.55,2.32-2.55ZM9.48,14.33c-2.58,0-4.67-1.23-4.67-2.75s2.09-2.75,4.67-2.75,4.67,1.23,4.67,2.75-2.09,2.75-4.67,2.75Z" />
    </Svg>
  ),
  Search: ({ size = 18, color = '#FFFFFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 17.61 17.61" fill={color}>
      <Path d="M8.8,0C3.94,0,0,3.94,0,8.8s3.94,8.8,8.8,8.8,8.8-3.94,8.8-8.8S13.67,0,8.8,0ZM8.8,15.98c-3.96,0-7.18-3.21-7.18-7.18S4.84,1.63,8.8,1.63s7.18,3.21,7.18,7.18-3.21,7.18-7.18,7.18Z" />
      <Path d="M8.8,3.07c-3.17,0-5.73,2.57-5.73,5.73s2.57,5.73,5.73,5.73,5.73-2.57,5.73-5.73-2.57-5.73-5.73-5.73Z" />
    </Svg>
  ),
  Home: ({ size = 24, color = '#7B2FFF' }) => (
    <Svg width={size} height={size * (17.61/16.44)} viewBox="0 0 16.44 17.61" fill={color}>
      <Path d="M9.38.44c-.66-.59-1.66-.59-2.32,0L.58,6.23c-.37.33-.58.8-.58,1.3v8.34c0,.96.78,1.74,1.74,1.74h12.96c.96,0,1.74-.78,1.74-1.74V7.53c0-.5-.21-.97-.58-1.3L9.38.44ZM10.81,15.11c0,.62-.5,1.12-1.12,1.12h-2.95c-.62,0-1.12-.5-1.12-1.12v-4.21c0-.62.5-1.12,1.12-1.12h2.95c.62,0,1.12.5,1.12,1.12v4.21Z" />
    </Svg>
  ),
  Photos: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size} viewBox="0 0 17.61 17.61" fill={color}>
      <Path d="M16.21,0H1.4C.62,0,0,.62,0,1.4v14.82c0,.77.62,1.4,1.4,1.4h14.82c.77,0,1.4-.62,1.4-1.4V1.4c0-.77-.62-1.4-1.4-1.4ZM15.75,11.73c0,.77-.62,1.4-1.4,1.4h-1.01c-.43-2.28-2.29-4-4.53-4s-4.11,1.72-4.53,4h-1.01c-.77,0-1.4-.62-1.4-1.4V3.28c0-.77.62-1.4,1.4-1.4h11.09c.77,0,1.4.62,1.4,1.4v8.45Z" />
      <Path d="M8.8,2.52c-1.44,0-2.61,1.26-2.61,2.82s1.17,2.82,2.61,2.82,2.61-1.26,2.61-2.82-1.17-2.82-2.61-2.82Z" />
    </Svg>
  ),
  Calendar: ({ size = 22, color = '#7B2FFF' }) => (
    <Svg width={size} height={size * (17.61/18.58)} viewBox="0 0 18.58 17.61" fill={color}>
      <Path d="M17.11,2.19h-2.91v-1.15c0-.57-.47-1.04-1.04-1.04h0c-.57,0-1.04.47-1.04,1.04v1.15h-5.98v-1.15c0-.57-.47-1.04-1.04-1.04s-1.04.47-1.04,1.04v1.15H1.47c-.81,0-1.47.66-1.47,1.47v12.48c0,.81.66,1.47,1.47,1.47h15.64c.81,0,1.47-.66,1.47-1.47V3.66c0-.81-.66-1.47-1.47-1.47ZM16.52,13.77c0,.8-.65,1.44-1.44,1.44H3.5c-.8,0-1.44-.65-1.44-1.44v-6.07c0-.8.65-1.44,1.44-1.44h11.57c.8,0,1.44.65,1.44,1.44v6.07Z" />
      <Path d="M14.2,8.47H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,11.74H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
    </Svg>
  ),
  Heart: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (17.61/20.78)} viewBox="0 0 20.78 17.61" fill={color}>
      <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
    </Svg>
  ),
  Direct: ({ size = 22, color = '#7B2FFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 17.61 17.61" fill={color}>
      <Path d="M8.8,0C3.94,0,0,3.94,0,8.8s3.94,8.8,8.8,8.8,8.8-3.94,8.8-8.8S13.67,0,8.8,0ZM8.8,15.98c-3.96,0-7.18-3.21-7.18-7.18S4.84,1.63,8.8,1.63s7.18,3.21,7.18,7.18-3.21,7.18-7.18,7.18Z" />
      <Path d="M8.8,3.07c-3.17,0-5.73,2.57-5.73,5.73s2.57,5.73,5.73,5.73,5.73-2.57,5.73-5.73-2.57-5.73-5.73-5.73Z" />
    </Svg>
  ),
  Close: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="11" stroke={color} strokeWidth={1.5} />
      <Path d="m8 8 8 8M16 8l-8 8" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  Camera: ({ size = 60, color = '#FFFFFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Rect x="8" y="18" width="48" height="36" rx="6" stroke={color} strokeWidth={2} fill="none" />
      <Circle cx="32" cy="36" r="10" stroke={color} strokeWidth={2} fill="none" />
      <Rect x="24" y="12" width="16" height="8" rx="2" stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  ),
  Logo: ({ width = 80, color = '#5313B7' }) => (
    <Svg width={width} height={width * (66.36/127.33)} viewBox="0 0 127.33 66.36" fill={color}>
      <Path d="M80.01,20.33c-9.07,1.29-11.83-10.42-3.21-13.19,9.56-2.16,14.01,11.8,3.21,13.19Z" />
      <Path d="M103.25,65.19c-9.47-.6-9.54-35.03-10.66-43.66-.66-5.07-1.51-11.09.7-15.8,2.11-4.28,5.82-2.22,7.54,1.11,4.05,8.13,3.56,16.1,5.36,25.37,1.01,7.78,6.52,33.58-2.95,32.98Z" />
      <Path d="M112.92,37.52c-.69-7.04-1.66-13.5-2.64-20.04-.65-4.7-1.19-10.78.89-14.94,2.14-4.13,5.55-2.82,7.58,1.13,3.45,7.32,4.39,16.8,5.58,24.99.93,7.63,1.92,16.11,2.58,22.84.33,4.05,1.91,15.3-4.43,14.86s-8.49-21.49-9.57-28.83Z" />
      <Path d="M81.5,63.99c-9.82-.59-8.03-40.1-1.97-38.95,7.97,1.52,15.08,39.74,1.97,38.95Z" />
      <Path d="M2.68,9.21c9.2,1.81,11.16,28.79,20.62,31.64s1.71-26.61,13.11-24.42,9.84,27.02,18.65,27.02.09-22.85,9.46-21.01c5.56,1.1,5.97,40.86-4.93,40.1s-11.66-21.66-20.46-20.49-3.22,18.82-14.62,18.02S-7.36,7.24,2.68,9.21Z" />
    </Svg>
  ),
};

// ---------- HELPERS ----------
const formatDateLong = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const months = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const isUpcoming = (iso) => {
  if (!iso) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now() - 86400000;
};

const cityLabel = (location) => {
  if (!location) return '';
  // Si location contient déjà un (XX), on garde tel quel
  if (/\(\d{2}\)/.test(location)) return location;
  return location;
};

// ---------- API ----------
const api = {
  async getEvents() {
    const r = await fetch(`${API_URL}/public-events`);
    return r.ok ? r.json() : [];
  },
  async login(code, password, role, photographer_name) {
    const r = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, role, photographer_name }),
    });
    return r.ok ? r.json() : null;
  },
  async listPhotos(prefix, token) {
    const r = await fetch(`${API_URL}/list-photos/${prefix}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok ? r.json() : { photos: [] };
  },
};

// ---------- SCREENS ----------

function SelfieBlock({ selfieUri, onPress, onDelete }) {
  if (selfieUri) {
    return (
      <View style={s.selfieDoneBanner}>
        <View style={s.selfieCheckCircle}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="m5 12 5 5L20 7" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.selfieDoneTitle}>Selfie enregistré</Text>
          <Text style={s.selfieDoneSub}>Will t'envoie tes photos automatiquement</Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={10} style={s.selfieDelete}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M6 6l12 12M18 6l-12 12" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
      <LinearGradient colors={['#8B3FFF', '#5A1FCC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.selfieCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.selfieTitle}>Prendre{'\n'}un selfie</Text>
          <Text style={s.selfieSub}>Recevoir mes photos{'\n'}automatiquement</Text>
        </View>
        <View style={s.selfieAvatar}>
          <Icon.User size={48} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie }) {
  const filtered = events.filter(e => tab === 'upcoming' ? isUpcoming(e.event_date) : !isUpcoming(e.event_date));

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.iconBtn}>
            <Icon.Bell />
          </TouchableOpacity>
          <TouchableOpacity style={s.avatarBtn}>
            <Icon.User />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={s.orgPill} onPress={onOpenOrg}>
          <Text style={s.orgPillText}>Organisation</Text>
        </TouchableOpacity>
      </View>

      <View style={s.welcomeRow}>
        <Text style={s.welcome}>Bienvenue chez </Text>
        <Icon.Logo width={50} color={C.primary} />
      </View>

      <SelfieBlock selfieUri={selfieUri} onPress={onOpenSelfie} onDelete={onDeleteSelfie} />

      {/* Search button (style maquette : bouton plein) */}
      <TouchableOpacity style={s.searchBtn} activeOpacity={0.85} onPress={onOpenSearch}>
        <Icon.Search size={18} color="#FFFFFF" />
        <Text style={s.searchInputBtn}>Trouver mon événement</Text>
      </TouchableOpacity>

      {/* Tabs row */}
      <View style={s.tabsRow}>
        <Text style={s.sectionTitle}>Événements</Text>
        <View style={s.pillRow}>
          <TouchableOpacity onPress={() => setTab('upcoming')} style={[s.pill, tab === 'upcoming' && s.pillActive]}>
            <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>à venir</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('past')} style={[s.pill, tab === 'past' && s.pillActive]}>
            <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>passés</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Events list */}
      {filtered.length === 0 ? (
        <Text style={s.empty}>Aucun événement {tab === 'upcoming' ? 'à venir' : 'passé'}</Text>
      ) : (
        filtered.map((event) => (
          <EventCard
            key={event.code}
            event={event}
            onPress={() => onOpenEvent(event)}
          />
        ))
      )}
    </ScrollView>
  );
}

function EventCard({ event, onPress }) {
  const tint = TYPE_COLORS[event.event_type] || TYPE_COLORS.Autre;

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={s.eventCard}>
      {event.cover_image ? (
        <ExpoImage
          source={{ uri: event.cover_image }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : null}
      <LinearGradient
        colors={[tint, tint, `${tint}00`]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={s.eventCardCenter}>
        <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
        <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
        <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PhotosScreen({ onOpenSelfie, gallery, selfieUri, onDeleteSelfie }) {
  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.iconBtn}><Icon.Bell /></TouchableOpacity>
          <TouchableOpacity style={s.avatarBtn}><Icon.User /></TouchableOpacity>
        </View>
      </View>

      <Text style={s.pageTitleCenter}>Mes photos</Text>

      <SelfieBlock selfieUri={selfieUri} onPress={onOpenSelfie} onDelete={onDeleteSelfie} />

      <Text style={s.empty}>Pas encore de photos disponibles</Text>
    </ScrollView>
  );
}

function PhotoGrid({ photos = [] }) {
  // Grille 4 colonnes, placeholders si vide
  const items = photos.length > 0 ? photos : Array.from({ length: 16 }, (_, i) => ({ placeholder: true, id: `ph-${i}` }));
  return (
    <View style={s.grid}>
      {items.map((p, i) => (
        <View key={p.id || i} style={s.gridItem}>
          {p.placeholder ? (
            <View style={s.gridPlaceholder} />
          ) : (
            <ExpoImage source={{ uri: p.uri }} style={s.gridImg} contentFit="cover" />
          )}
        </View>
      ))}
    </View>
  );
}

function EventDetailScreen({ event, onClose, onOpenSelfie, selfieUri, onDeleteSelfie }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const tint = TYPE_COLORS[event.event_type] || TYPE_COLORS.Autre;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`${API_URL}/list-public/${event.code}`)
      .then(r => r.ok ? r.json() : { photos: [] })
      .then(data => {
        if (!mounted) return;
        const list = (data.photos || []).map(p => ({
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
        }));
        setPhotos(list);
      })
      .catch(() => setPhotos([]))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [event.code]);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.iconBtn}><Icon.Bell /></TouchableOpacity>
          <TouchableOpacity style={s.avatarBtn}><Icon.User /></TouchableOpacity>
        </View>
      </View>

      {/* Cover */}
      <View style={s.coverCard}>
        {event.cover_image ? (
          <ExpoImage source={{ uri: event.cover_image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : null}
        <LinearGradient
          colors={[`${tint}00`, `${tint}AA`, tint]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFillObject}
        />
        <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={10}>
          <Icon.Close />
        </TouchableOpacity>
        <View style={s.coverBottom}>
          <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
          <Text style={s.coverTitle} numberOfLines={2}>{event.name}</Text>
          <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
        </View>
      </View>

      {/* Selfie */}
      <SelfieBlock selfieUri={selfieUri} onPress={onOpenSelfie} onDelete={onDeleteSelfie} />

      {/* Galerie */}
      <Text style={[s.sectionTitle, { marginVertical: 14 }]}>Photos</Text>

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : photos.length === 0 ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>
        </View>
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </ScrollView>
  );
}

function PhotographerScreen({ session, onLogout }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef(null);

  const isCapturingRef = useRef(false);
  const lastFaceSeenAtRef = useRef(0);
  const isMountedRef = useRef(true);
  const isDetectionEnabledRef = useRef(false);
  const isTestModeRef = useRef(false);

  const [facesCount, setFacesCount] = useState(0);
  const [isShooting, setIsShooting] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [isDetectionEnabled, setIsDetectionEnabled] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [testPhotos, setTestPhotos] = useState([]);
  const [showTestPanel, setShowTestPanel] = useState(false);

  const badgePulse = useRef(new Animated.Value(1)).current;
  const badgeOpacity = useRef(new Animated.Value(1)).current;
  const testPanelY = useRef(new Animated.Value(900)).current;

  const faceDetectionOptions = useRef({
    performanceMode: 'fast',
    landmarkMode: 'none',
    contourMode: 'none',
    classificationMode: 'none',
    minFaceSize: 0.05,
    trackingEnabled: false,
  }).current;

  const { detectFaces } = useFaceDetector(faceDetectionOptions);

  const onFacesDetectedJS = useMemo(
    () => Worklets.createRunOnJS((count) => {
      setFacesCount(count);
      if (count > 0 && isDetectionEnabledRef.current) {
        lastFaceSeenAtRef.current = Date.now();
        if (!isCapturingRef.current) startCaptureLoop();
      }
    }),
    []
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (!hasPermission) requestPermission();
    return () => { isMountedRef.current = false; };
  }, [hasPermission]);

  useEffect(() => {
    if (isShooting) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(badgePulse, { toValue: 1.04, duration: 700, useNativeDriver: true }),
          Animated.timing(badgePulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      badgePulse.stopAnimation();
      Animated.timing(badgePulse, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [isShooting]);

  useEffect(() => {
    Animated.sequence([
      Animated.timing(badgeOpacity, { toValue: 0.5, duration: 120, useNativeDriver: true }),
      Animated.timing(badgeOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [facesCount > 0, isShooting, isDetectionEnabled]);

  useEffect(() => {
    Animated.spring(testPanelY, {
      toValue: showTestPanel ? 0 : 900,
      useNativeDriver: true,
      tension: 60,
      friction: 11,
    }).start();
  }, [showTestPanel]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    onFacesDetectedJS(faces.length);
  }, [detectFaces, onFacesDetectedJS]);

  const INTER_PHOTO_MS = 150;
  const NO_FACE_TIMEOUT_MS = 500;

  function startSession(testMode) {
    isDetectionEnabledRef.current = true;
    isTestModeRef.current = testMode;
    setIsDetectionEnabled(true);
    setIsTestMode(testMode);
  }

  function stopSession() {
    isDetectionEnabledRef.current = false;
    setIsDetectionEnabled(false);
    setIsTestMode(false);
    isTestModeRef.current = false;
    lastFaceSeenAtRef.current = 0;
  }

  async function startCaptureLoop() {
    if (isCapturingRef.current) return;
    if (!cameraRef.current || !isMountedRef.current) return;
    if (!isDetectionEnabledRef.current) return;

    isCapturingRef.current = true;
    setIsShooting(true);

    const burstTs = Date.now();
    let photoIndex = 0;
    const queue = [];

    while (isMountedRef.current && isDetectionEnabledRef.current) {
      const sinceLastFace = Date.now() - lastFaceSeenAtRef.current;
      if (sinceLastFace > NO_FACE_TIMEOUT_MS) break;

      try {
        const photo = await cameraRef.current.takePhoto({
          qualityPrioritization: 'speed',
          flash: 'off',
          enableShutterSound: false,
        });
        queue.push({ photo, index: photoIndex++, burstTs });

        if (isTestModeRef.current) {
          const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
          setTestPhotos(prev => [{ uri: fileUri, ts: Date.now() }, ...prev].slice(0, 30));
        }
      } catch (e) { console.warn('takePhoto', e); }

      await new Promise(r => setTimeout(r, INTER_PHOTO_MS));
    }

    isCapturingRef.current = false;
    setIsShooting(false);

    if (!isTestModeRef.current) {
      uploadQueue(queue).catch(e => console.warn('upload', e));
    }
  }

  async function uploadQueue(queue) {
    if (queue.length === 0) return;
    const d = new Date();
    const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;

    for (const { photo, index, burstTs } of queue) {
      const key = `${session.event.code}/${session.photographer_id}/${dateStr}/${timeStr}_${burstTs}_${index}.jpg`;
      try {
        const fileUri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
        const blob = await (await fetch(fileUri)).blob();
        const res = await fetch(`${API_URL}/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${session.token}` },
          body: blob,
        });
        if (res.ok && isMountedRef.current) setPhotoCount(c => c + 1);
      } catch (e) { console.warn('upload', key, e); }
    }
  }

  if (!hasPermission) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: C.text, textAlign: 'center', marginBottom: 16 }}>Permission caméra requise</Text>
        <TouchableOpacity style={s.btnPrimary} onPress={requestPermission}>
          <Text style={s.btnPrimaryText}>Autoriser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        <Text style={{ color: C.text, textAlign: 'center' }}>Caméra arrière indisponible</Text>
      </View>
    );
  }

  const badgeColor = !isDetectionEnabled
    ? 'rgba(255, 255, 255, 0.18)'
    : isShooting
      ? 'rgba(16, 185, 129, 0.92)'
      : facesCount > 0
        ? 'rgba(16, 185, 129, 0.72)'
        : 'rgba(255, 255, 255, 0.22)';

  const badgeText = !isDetectionEnabled
    ? session.event.name
    : isShooting
      ? `Capture · ${facesCount} visage${facesCount > 1 ? 's' : ''}`
      : facesCount > 0
        ? `${facesCount} visage${facesCount > 1 ? 's' : ''} détecté${facesCount > 1 ? 's' : ''}`
        : 'En attente';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <VisionCamera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        frameProcessor={isDetectionEnabled ? frameProcessor : undefined}
        pixelFormat="yuv"
        zoom={zoomLevel}
      />

      {/* Bouton Quitter (haut gauche) */}
      <TouchableOpacity
        onPress={onLogout}
        style={{
          position: 'absolute',
          top: 60,
          left: 16,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.4)',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '500' }}>Quitter</Text>
      </TouchableOpacity>

      {/* Badge état (haut centre) */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 60,
          left: 0,
          right: 0,
          alignItems: 'center',
          opacity: badgeOpacity,
          transform: [{ scale: badgePulse }],
        }}
        pointerEvents="none"
      >
        <View style={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: badgeColor,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
          maxWidth: '60%',
        }}>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13, letterSpacing: 0.3 }} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>
        {isTestMode && (
          <View style={{ marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(245, 158, 11, 0.9)' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 10, letterSpacing: 1 }}>TEST</Text>
          </View>
        )}
      </Animated.View>

      {/* Compteur (mode normal) ou Voir (mode test) — haut droite */}
      {isDetectionEnabled && !isTestMode && photoCount > 0 && (
        <View style={{
          position: 'absolute',
          top: 60,
          right: 16,
          backgroundColor: 'rgba(0,0,0,0.5)',
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
        }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{photoCount}</Text>
        </View>
      )}
      {isDetectionEnabled && isTestMode && (
        <TouchableOpacity
          onPress={() => setShowTestPanel(true)}
          style={{
            position: 'absolute',
            top: 60,
            right: 16,
            backgroundColor: 'rgba(245, 158, 11, 0.95)',
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
            Voir ({testPhotos.length})
          </Text>
        </TouchableOpacity>
      )}

      {/* Sélecteur zoom (toujours visible, bas centre au-dessus des contrôles) */}
      <View style={{
        position: 'absolute',
        bottom: 130,
        alignSelf: 'center',
        flexDirection: 'row',
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderRadius: 999,
        padding: 4,
      }}>
        {[1, 1.5, 2].map(z => (
          <TouchableOpacity
            key={z}
            onPress={() => setZoomLevel(z)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: zoomLevel === z ? 'rgba(255,255,255,0.95)' : 'transparent',
            }}
          >
            <Text style={{ color: zoomLevel === z ? '#000' : '#fff', fontWeight: '700', fontSize: 12 }}>
              {z}×
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Boutons bas */}
      <View style={{ position: 'absolute', bottom: 30, left: 24, right: 24 }}>
        {!isDetectionEnabled ? (
          // État idle : Tester / Démarrer côte à côte
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={() => startSession(true)}
              style={{
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.95)',
                paddingVertical: 18,
                borderRadius: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Tester</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => startSession(false)}
              style={{
                flex: 1,
                backgroundColor: C.primary,
                paddingVertical: 18,
                borderRadius: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Démarrer</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // État actif : Arrêter pleine largeur
          <TouchableOpacity
            onPress={stopSession}
            style={{
              backgroundColor: 'rgba(255,255,255,0.95)',
              paddingVertical: 18,
              borderRadius: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Arrêter</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Panneau test (slide-up plein écran) */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0, bottom: 0, left: 0, right: 0,
          backgroundColor: C.bg,
          transform: [{ translateY: testPanelY }],
        }}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
            <View>
              <Text style={{ color: C.text, fontSize: 20, fontWeight: '700' }}>Photos de test</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>{testPhotos.length} photo{testPhotos.length > 1 ? 's' : ''}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowTestPanel(false)} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
              <Text style={{ color: C.primary, fontSize: 15, fontWeight: '600' }}>Fermer</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {testPhotos.map((p, i) => (
                <Image
                  key={p.ts + '_' + i}
                  source={{ uri: p.uri }}
                  style={{ width: '32%', aspectRatio: 0.75, margin: '0.66%', borderRadius: 8, backgroundColor: '#EEE' }}
                />
              ))}
              {testPhotos.length === 0 && (
                <Text style={{ color: C.textSoft, textAlign: 'center', width: '100%', marginTop: 60 }}>
                  Aucune photo de test
                </Text>
              )}
            </View>
          </ScrollView>
          {testPhotos.length > 0 && (
            <TouchableOpacity
              onPress={() => setTestPhotos([])}
              style={{ marginHorizontal: 20, marginBottom: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: '#FEE', alignItems: 'center' }}
            >
              <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Effacer toutes les photos</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

function CreateEventModal({ visible, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [eventType, setEventType] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(''); setCode(''); setPassword('');
      setEventDate(''); setLocation(''); setEventType('');
      setWebsite(''); setContact('');
    }
  }, [visible]);

  const submit = async () => {
    if (!name || !code || !password) return Alert.alert('Champs requis', 'Nom, code et mot de passe.');
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/submit-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, code, password,
          contact,
          event_date: eventDate,
          location,
          event_type: eventType,
          website,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        Alert.alert('Erreur', data.error || 'Échec');
      } else {
        Alert.alert('Demande envoyée', 'Ton événement sera validé sous peu.');
        onCreated?.();
        onClose();
      }
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  const types = ['Trail', 'Course sur route', 'Cross', 'Hyrox', 'Triathlon', 'Velo', 'Marche', 'Autre'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: '90%' }]} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>Créer un événement</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              <TextInput placeholder="Nom de l'événement *" placeholderTextColor={C.textSoft} value={name} onChangeText={setName} style={s.input} />
              <TextInput placeholder="Code unique (ex: trail-2027) *" placeholderTextColor={C.textSoft} value={code} onChangeText={setCode} autoCapitalize="none" style={s.input} />
              <TextInput placeholder="Mot de passe photographe *" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} secureTextEntry style={s.input} />
              <TextInput placeholder="Date (YYYY-MM-DD)" placeholderTextColor={C.textSoft} value={eventDate} onChangeText={setEventDate} style={s.input} />
              <TextInput placeholder="Lieu (ex: Louviers (27))" placeholderTextColor={C.textSoft} value={location} onChangeText={setLocation} style={s.input} />
              <Text style={[s.modalSub, { textAlign: 'left', marginTop: 12, marginBottom: 6 }]}>Type d'épreuve</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {types.map(t => (
                  <TouchableOpacity key={t} onPress={() => setEventType(t)} style={[s.typePill, eventType === t && s.typePillActive]}>
                    <Text style={[s.typePillText, eventType === t && { color: '#fff' }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput placeholder="Site web" placeholderTextColor={C.textSoft} value={website} onChangeText={setWebsite} autoCapitalize="none" style={s.input} />
              <TextInput placeholder="Email de contact" placeholderTextColor={C.textSoft} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" style={s.input} />
            </ScrollView>
            <TouchableOpacity style={s.btnPrimary} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Soumettre</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.modalCancel} onPress={onClose}>
              <Text style={s.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OrganizationModal({ visible, onClose, onPickRole }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>Organisation</Text>
          <TouchableOpacity style={s.modalOption} onPress={() => onPickRole('organizer')}>
            <Text style={s.modalOptionText}>Espace organisateur</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.modalOption} onPress={() => onPickRole('photographer')}>
            <Text style={s.modalOptionText}>Espace photographe</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.modalOption} onPress={() => onPickRole('create')}>
            <Text style={s.modalOptionText}>Créer un événement</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.modalCancel} onPress={onClose}>
            <Text style={s.modalCancelText}>Annuler</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function SelfieModal({ visible, onClose, onSaved }) {
  const [uri, setUri] = useState(null);
  const [busy, setBusy] = useState(false);

  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission refusée');
    const r = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!r.canceled && r.assets?.[0]?.uri) setUri(r.assets[0].uri);
  };

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission refusée');
    const r = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!r.canceled && r.assets?.[0]?.uri) setUri(r.assets[0].uri);
  };

  const save = async () => {
    if (!uri) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem('@will_selfie', uri);
      onSaved?.(uri);
      onClose();
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { paddingBottom: 32 }]} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>Mon selfie</Text>
          <Text style={s.modalSub}>Une seule photo de toi suffit. On la garde sur ton téléphone uniquement.</Text>

          <View style={s.selfiePreviewWrap}>
            {uri ? (
              <ExpoImage source={{ uri }} style={s.selfiePreview} contentFit="cover" />
            ) : (
              <View style={[s.selfiePreview, { backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                <Icon.Camera size={64} color={C.primary} />
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={take}>
              <Text style={s.btnSecondaryText}>Prendre une photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={pick}>
              <Text style={s.btnSecondaryText}>Choisir</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.btnPrimary, !uri && { opacity: 0.4 }]} onPress={save} disabled={!uri || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Enregistrer mon selfie</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={s.modalCancel} onPress={onClose}>
            <Text style={s.modalCancelText}>Fermer</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setCode(''); setPassword(''); setName(''); }
  }, [visible]);

  const upcoming = events.filter(e => isUpcoming(e.event_date));

  const submit = async () => {
    if (!code) return Alert.alert('Événement requis', role === 'photographer' ? 'Choisis un événement.' : 'Entre le code.');
    if (!password) return Alert.alert('Mot de passe requis');
    if (role === 'photographer' && !name) return Alert.alert('Prénom requis');
    setBusy(true);
    const r = await api.login(code.trim(), password.trim(), role, name.trim());
    setBusy(false);
    if (!r?.token) return Alert.alert('Échec', 'Identifiants invalides.');
    onSuccess(r);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            <Text style={s.modalTitle}>{role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}</Text>

            {role === 'photographer' ? (
              <>
                <Text style={s.modalSub}>Choisis l'événement</Text>
                <ScrollView style={{ maxHeight: 220, marginBottom: 8 }}>
                  {upcoming.length === 0 && <Text style={s.empty}>Aucun événement à venir</Text>}
                  {upcoming.map(e => (
                    <TouchableOpacity
                      key={e.code}
                      style={[s.eventPick, code === e.code && s.eventPickActive]}
                      onPress={() => setCode(e.code)}
                    >
                      <Text style={[s.eventPickName, code === e.code && { color: '#fff' }]} numberOfLines={1}>{e.name}</Text>
                      <Text style={[s.eventPickDate, code === e.code && { color: 'rgba(255,255,255,0.85)' }]}>{formatDateLong(e.event_date)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TextInput
                  placeholder="Ton prénom"
                  placeholderTextColor={C.textSoft}
                  value={name}
                  onChangeText={setName}
                  style={s.input}
                />
              </>
            ) : (
              <TextInput
                placeholder="Code de l'événement"
                placeholderTextColor={C.textSoft}
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                style={s.input}
              />
            )}

            <TextInput
              placeholder="Mot de passe"
              placeholderTextColor={C.textSoft}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={s.input}
            />
            <TouchableOpacity style={s.btnPrimary} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Continuer</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.modalCancel} onPress={onClose}>
              <Text style={s.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SearchModal({ visible, events, onClose, onPick }) {
  const upcoming = events.filter(e => isUpcoming(e.event_date));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} hitSlop={20}>
            <View style={s.modalHandle} />
          </TouchableOpacity>
          <Text style={s.modalTitle}>Mon événement</Text>
          <ScrollView style={{ maxHeight: 400, marginTop: 8 }}>
            {upcoming.length === 0 && <Text style={s.empty}>Aucun événement à venir</Text>}
            {upcoming.map(e => (
              <TouchableOpacity key={e.code} style={s.eventPick} onPress={() => { onPick(e); onClose(); }}>
                <Text style={s.eventPickName}>{e.name}</Text>
                <Text style={s.eventPickDate}>{formatDateLong(e.event_date)} · {cityLabel(e.location)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ---------- ROOT ----------
export default function App() {
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [tab, setTab] = useState('upcoming');
  const [bottomTab, setBottomTab] = useState('home');
  const [events, setEvents] = useState([]);
  const [openedEvent, setOpenedEvent] = useState(null);
  const [orgModal, setOrgModal] = useState(false);
  const [selfieModal, setSelfieModal] = useState(false);
  const [searchModal, setSearchModal] = useState(false);
  const [createEventModal, setCreateEventModal] = useState(false);
  const [loginRole, setLoginRole] = useState(null);
  const [selfieUri, setSelfieUri] = useState(null);
  const [session, setSession] = useState(null);

  useEffect(() => {
    Font.loadAsync({
      AVEstiana: require('./assets/fonts/AV_Estiana-VF.ttf'),
    }).then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
  }, []);

  useEffect(() => {
    api.getEvents().then(data => setEvents(Array.isArray(data) ? data : []));
    AsyncStorage.getItem('@will_selfie').then(v => v && setSelfieUri(v));
  }, []);

  const deleteSelfie = useCallback(() => {
    Alert.alert('Supprimer le selfie ?', 'Tu pourras en reprendre un nouveau.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        await AsyncStorage.removeItem('@will_selfie');
        setSelfieUri(null);
      }},
    ]);
  }, []);

  const handlePickRole = (role) => {
    setOrgModal(false);
    if (role === 'create') {
      setCreateEventModal(true);
      return;
    }
    setLoginRole(role);
  };

  if (!fontsLoaded) {
    return <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={C.primary} /></View>;
  }

  // Mode photographe (full screen caméra)
  if (session?.role === 'photographer' || session?.role === 'organizer') {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <PhotographerScreen session={session} onLogout={() => setSession(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {bottomTab === 'home' && !openedEvent && (
        <HomeScreen
          events={events}
          onOpenEvent={setOpenedEvent}
          onOpenSelfie={() => setSelfieModal(true)}
          onOpenOrg={() => setOrgModal(true)}
          onOpenSearch={() => setSearchModal(true)}
          tab={tab}
          setTab={setTab}
          selfieUri={selfieUri}
          onDeleteSelfie={deleteSelfie}
        />
      )}

      {bottomTab === 'photos' && !openedEvent && (
        <PhotosScreen
          onOpenSelfie={() => setSelfieModal(true)}
          gallery={[]}
          selfieUri={selfieUri}
          onDeleteSelfie={deleteSelfie}
        />
      )}

      {openedEvent && (
        <EventDetailScreen
          event={openedEvent}
          onClose={() => setOpenedEvent(null)}
          onOpenSelfie={() => setSelfieModal(true)}
          selfieUri={selfieUri}
          onDeleteSelfie={deleteSelfie}
        />
      )}

      {/* Bottom Nav */}
      <View style={s.bottomNav}>
        <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('home'); setOpenedEvent(null); }}>
          <Icon.Home filled={bottomTab === 'home'} color={bottomTab === 'home' ? C.primary : C.text} />
          <Text style={[s.navLabel, bottomTab === 'home' && { color: C.primary, fontWeight: '700' }]}>Accueil</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('photos'); setOpenedEvent(null); }}>
          <Icon.Photos filled={bottomTab === 'photos'} color={bottomTab === 'photos' ? C.primary : C.text} />
          <Text style={[s.navLabel, bottomTab === 'photos' && { color: C.primary, fontWeight: '700' }]}>Photos</Text>
        </TouchableOpacity>
      </View>

      <SearchModal
        visible={searchModal}
        events={events}
        onClose={() => setSearchModal(false)}
        onPick={(e) => setOpenedEvent(e)}
      />

      <OrganizationModal
        visible={orgModal}
        onClose={() => setOrgModal(false)}
        onPickRole={handlePickRole}
      />

      <SelfieModal
        visible={selfieModal}
        onClose={() => setSelfieModal(false)}
        onSaved={setSelfieUri}
      />

      <LoginModal
        visible={!!loginRole}
        role={loginRole}
        events={events}
        onClose={() => setLoginRole(null)}
        onSuccess={(r) => {
          setLoginRole(null);
          setSession({ ...r, role: loginRole });
        }}
      />

      <CreateEventModal
        visible={createEventModal}
        onClose={() => setCreateEventModal(false)}
      />
    </SafeAreaView>
  );
}

// ---------- STYLES ----------
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  avatarBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center' },
  orgPill: { backgroundColor: C.pinkPill, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 22 },
  orgPillText: { color: C.pinkPillText, fontWeight: '600', fontSize: 14 },

  welcome: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 18, color: C.text, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 14 },
  welcomeAccent: { color: C.primary },

  selfieDoneBanner: { backgroundColor: C.white, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16, borderWidth: 1, borderColor: C.primaryLight },
  selfieCheckCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4A6FF', alignItems: 'center', justifyContent: 'center' },
  selfieDoneTitle: { fontWeight: '700', fontSize: 15, color: C.primary, fontFamily: 'AVEstiana', fontStyle: 'normal' },
  selfieDoneSub: { fontSize: 12, color: C.textSoft, marginTop: 2, lineHeight: 16 },
  selfieDelete: { padding: 6 },

  selfieCard: { borderRadius: 22, padding: 22, flexDirection: 'row', alignItems: 'center', minHeight: 150, marginBottom: 16 },
  selfieTitle: { color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal', lineHeight: 32 },
  selfieSub: { color: 'rgba(255,255,255,0.85)', marginTop: 10, fontSize: 13, lineHeight: 18 },
  selfieAvatar: { width: 88, height: 88, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  searchBtn: { backgroundColor: C.primary, borderRadius: 16, height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12, marginBottom: 22 },
  searchInputBtn: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },

  eventPick: { backgroundColor: C.white, borderRadius: 14, padding: 14, marginTop: 8 },
  eventPickActive: { backgroundColor: C.primary },
  eventPickName: { fontWeight: '700', fontSize: 15, color: C.text },
  eventPickDate: { fontSize: 12, color: C.textSoft, marginTop: 2 },

  tabsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text },
  pillRow: { flexDirection: 'row', backgroundColor: C.pillBg, borderRadius: 22, padding: 4, gap: 4 },
  pill: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 18 },
  pillActive: { backgroundColor: C.primary },
  pillText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: '#fff' },

  empty: { textAlign: 'center', color: C.textSoft, marginTop: 24, fontSize: 14 },

  eventCard: { height: 90, borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: '#222', justifyContent: 'center' },
  heartBtn: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  eventCardBottom: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  eventCardCenter: { paddingHorizontal: 16, zIndex: 2 },
  eventDate: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1, opacity: 0.9, marginBottom: 2 },
  eventName: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal' },
  eventLocation: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },

  pageTitleCenter: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 26, fontWeight: '700', color: C.primary, textAlign: 'center', marginVertical: 16 },
  galleryTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.primary, textAlign: 'center', marginTop: 18, marginBottom: 14 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: (SCREEN_W - 40 - 24) / 4, height: (SCREEN_W - 40 - 24) / 4, marginBottom: 8 },
  gridPlaceholder: { flex: 1, backgroundColor: C.primaryLight, borderRadius: 12 },
  gridImg: { flex: 1, borderRadius: 12 },

  coverCard: { height: 200, borderRadius: 22, overflow: 'hidden', marginTop: 4, marginBottom: 16, backgroundColor: '#222' },
  closeBtn: { position: 'absolute', top: 14, right: 14, zIndex: 5 },
  coverBottom: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  coverTitle: { color: '#fff', fontSize: 26, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal' },

  empRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 14 },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: C.white, flexDirection: 'row', justifyContent: 'center', gap: 60, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  navBtn: { alignItems: 'center', justifyContent: 'flex-start', gap: 4, minWidth: 80 },
  navLabel: { fontSize: 12, color: C.text, marginTop: 2 },
  badge: { position: 'absolute', top: -4, right: -8, backgroundColor: '#FF3B7F', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D0CCE3', alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  modalSub: { color: C.textSoft, textAlign: 'center', marginBottom: 18, fontSize: 13 },
  modalOption: { backgroundColor: C.white, padding: 18, borderRadius: 16, marginTop: 10 },
  modalOptionText: { fontWeight: '600', fontSize: 15, color: C.text },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 12 },
  modalCancelText: { color: C.textSoft, fontWeight: '600' },

  input: { backgroundColor: C.white, borderRadius: 14, padding: 16, marginTop: 10, fontSize: 15, color: C.text },
  btnPrimary: { backgroundColor: C.primary, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnSecondaryText: { color: C.primary, fontWeight: '600', fontSize: 14 },

  selfiePreviewWrap: { alignItems: 'center', marginVertical: 16 },
  selfiePreview: { width: 160, height: 160, borderRadius: 80 },

  camTopBar: { position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  camTitle: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, marginRight: 16 },
  camLogout: { color: '#fff', fontSize: 14, opacity: 0.8 },
  camBottomBar: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 8 },
  camCount: { color: '#fff', fontSize: 14, marginBottom: 4 },
  camShutter: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.25)', borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  camShutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  camHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },

  typePill: { backgroundColor: C.white, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  typePillActive: { backgroundColor: C.primary },
  typePillText: { fontSize: 12, color: C.text, fontWeight: '600' },
});
