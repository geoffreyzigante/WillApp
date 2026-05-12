import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions, RefreshControl,
  StatusBar, SafeAreaView, Platform, KeyboardAvoidingView, Animated, Easing, Keyboard, Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as Font from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
  useCameraFormat,
} from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import ReAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Svg, { Path, Circle, Ellipse, Defs, Mask, Rect } from 'react-native-svg';
import DateTimePicker from '@react-native-community/datetimepicker';
import NetInfo from '@react-native-community/netinfo';
import { Paths, File, Directory } from 'expo-file-system';

const API_URL = 'https://will-api.geoffreyzigante.workers.dev';
const R2_PUBLIC = 'https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev';
const { width: SCREEN_W } = Dimensions.get('window');

// ─── SecureStore : stockage chiffre des sessions/consentement (M-S08) ─────
// Cles a migrer d AsyncStorage → SecureStore : sessions runner/organizer/
// photographer + consentement biometrique. SecureStore n accepte que
// [A-Za-z0-9._-] : on normalise les cles "@will_*" en "will_*".
const SECURE_KEYS = [
  '@will_runner',
  '@will_organizer',
  '@will_photographer_session',
  '@will_biometric_consent_v1',
];
const toSecureKey = (k) => k.replace(/^@/, 'will_');
const Secure = {
  getItem: (k) => SecureStore.getItemAsync(toSecureKey(k)),
  setItem: (k, v) => SecureStore.setItemAsync(toSecureKey(k), v),
  removeItem: (k) => SecureStore.deleteItemAsync(toSecureKey(k)),
};

// Migration one-shot au demarrage : pour chaque cle sensible, si elle existe
// dans AsyncStorage, on la copie vers SecureStore puis on l efface. Idempotent
// (skip si AsyncStorage vide ou SecureStore deja peuple).
async function migrateSensitiveKeysToSecureStore() {
  for (const k of SECURE_KEYS) {
    try {
      const v = await AsyncStorage.getItem(k);
      if (v === null) continue;
      const existing = await SecureStore.getItemAsync(toSecureKey(k));
      if (existing === null) await SecureStore.setItemAsync(toSecureKey(k), v);
      await AsyncStorage.removeItem(k);
    } catch (e) {
      console.warn('[migrate-secure]', k, e?.message || e);
    }
  }
}

// Mode photographe offline-first : queue persistante d'uploads
// + photos stockées hors-cache pour survivre au kill / nettoyage iOS.
const UPLOAD_QUEUE_KEY = '@will_upload_queue';
const PENDING_DIR_NAME = 'will_pending';
const MAX_RETRIES_DEFAULT = 5;
const STORAGE_WARN_BYTES = 5 * 1024 * 1024 * 1024; // 5 Go

function pendingDir() {
  return new Directory(Paths.document, PENDING_DIR_NAME);
}

function ensurePendingDir() {
  try {
    const d = pendingDir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    return d;
  } catch (e) {
    console.warn('ensurePendingDir', e?.message);
    return null;
  }
}

async function loadUploadQueue() {
  try {
    const raw = await AsyncStorage.getItem(UPLOAD_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function saveUploadQueue(arr) {
  try {
    await AsyncStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(arr));
  } catch (e) { console.warn('saveUploadQueue', e?.message); }
}

function pendingDirSizeBytes() {
  try {
    const d = pendingDir();
    if (!d.exists) return 0;
    let total = 0;
    for (const node of d.list()) {
      if (node instanceof File) total += node.size || 0;
    }
    return total;
  } catch { return 0; }
}

function generateItemId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

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
  pinkPillBg: '#FDECFF',
  pinkPillActive: '#E673FF',
  card: '#FFFFFF',
  shadow: 'rgba(123, 47, 255, 0.08)',
};

const TYPE_COLORS = {
  Trail: '#4A9E7A',
  'Course sur route': '#5B82C4',
  Cross: '#B05A4A',
  Triathlon: '#4A8A9E',
  Velo: '#7A5AB0',
  Marche: '#9E8A4A',
  Autre: '#6A6A6A',
};

// Label affiché pour event_type ; la valeur stockée reste sans accent ("Velo").
const displayEventType = (t) => (t === 'Velo' ? 'Vélo' : t);

// ---------- ICONS (custom SVG) ----------
const Icon = {
  User: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size * (18.96/17.61)} height={size} viewBox="0 0 18.96 17.61" fill={color}>
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
  Events: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (17.61/17.65)} viewBox="0 0 17.65 17.61" fill={color}>
      <Path d="M17.64,7.63c0-.16-.28-.3-.42-.31l-2.1-.22c-.13-.55-.31-1.02-.58-1.48l1.34-1.71c.12-.15.14-.35,0-.49l-1.6-1.6c-.11-.11-.31-.13-.46-.1l-1.87,1.32c-.48-.23-.95-.42-1.48-.59l-.23-2.18C10.23.12,10.06,0,9.93,0h-2.22C7.58,0,7.42.12,7.4.25l-.23,2.18c-.53.17-1,.36-1.48.59l-1.87-1.32c-.15-.03-.35,0-.46.1l-1.6,1.6c-.14.14-.12.35,0,.49l1.34,1.71c-.27.46-.45.93-.58,1.48l-2.1.22c-.13.01-.41.15-.42.31v2.41c0,.13.11.3.24.31l2.18.23c.17.52.35.98.59,1.48l-1.38,1.78c-.14.18.05.45.17.57l1.52,1.52c.11.11.3.12.43.04l1.76-1.38c.47.28.95.44,1.48.59l.22,2.16c0,.15.12.29.28.29h1.29s1.29,0,1.29,0c.16,0,.29-.13.28-.29l.22-2.16c.54-.15,1.02-.3,1.48-.59l1.76,1.38c.13.08.32.08.43-.04l1.52-1.52c.12-.12.31-.39.17-.57l-1.38-1.78c.24-.5.43-.96.59-1.48l2.18-.23c.13-.01.25-.18.25-.31v-2.41ZM7.92,11.67c-1.56-.44-2.53-1.83-2.37-3.23.22-1.4,1.52-2.48,3.14-2.49,1.81-.02,3.38,1.3,3.43,2.99,0,.13-.02.26-.03.38-.02.13-.03.25-.07.38-.5,1.62-2.36,2.47-4.1,1.98Z" />
    </Svg>
  ),
  PhotoCam: ({ size = 24, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (15.67/18.58)} viewBox="0 0 18.58 15.67" fill={color}>
      <Path d="M17.11,2.19h-2.91v-1.15C14.2.47,13.73,0,13.16,0H5.1C4.53,0,4.07.47,4.07,1.04v1.15H1.47C.66,2.19,0,2.85,0,3.66v10.54C0,15.01.66,15.67,1.47,15.67h15.64c.81,0,1.47-.66,1.47-1.47V3.66c0-.81-.66-1.47-1.47-1.47ZM4.06,5.65c-.32-.31-.36-.81-.08-1.12.02-.02.05-.04.07-.06.03-.02.05-.04.08-.05.37-.2.84-.02,1.06.37.19.35.12.76-.15.98-.28.21-.7.17-.98-.11ZM11.07,12.71c-1.89,1.05-4.12.66-5.3-.82-1.12-1.53-.9-3.78.61-5.33,1.69-1.73,4.42-1.97,6.07-.42.13.12.23.26.33.39.1.14.21.27.29.42,1.06,2,.1,4.57-2.01,5.75Z" />
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
  Logo: ({ width = 80, color = '#5313B7' }) => (
    <Svg width={width} height={width * (66.36/127.33)} viewBox="0 0 127.33 66.36" fill={color}>
      <Path d="M80.01,20.33c-9.07,1.29-11.83-10.42-3.21-13.19,9.56-2.16,14.01,11.8,3.21,13.19Z" />
      <Path d="M103.25,65.19c-9.47-.6-9.54-35.03-10.66-43.66-.66-5.07-1.51-11.09.7-15.8,2.11-4.28,5.82-2.22,7.54,1.11,4.05,8.13,3.56,16.1,5.36,25.37,1.01,7.78,6.52,33.58-2.95,32.98Z" />
      <Path d="M112.92,37.52c-.69-7.04-1.66-13.5-2.64-20.04-.65-4.7-1.19-10.78.89-14.94,2.14-4.13,5.55-2.82,7.58,1.13,3.45,7.32,4.39,16.8,5.58,24.99.93,7.63,1.92,16.11,2.58,22.84.33,4.05,1.91,15.3-4.43,14.86s-8.49-21.49-9.57-28.83Z" />
      <Path d="M81.5,63.99c-9.82-.59-8.03-40.1-1.97-38.95,7.97,1.52,15.08,39.74,1.97,38.95Z" />
      <Path d="M2.68,9.21c9.2,1.81,11.16,28.79,20.62,31.64s1.71-26.61,13.11-24.42,9.84,27.02,18.65,27.02.09-22.85,9.46-21.01c5.56,1.1,5.97,40.86-4.93,40.1s-11.66-21.66-20.46-20.49-3.22,18.82-14.62,18.02S-7.36,7.24,2.68,9.21Z" />
    </Svg>
  ),
  // Engrenage (pill organisation - côté gauche)
  GearOrg: ({ size = 20, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (15.42/15.46)} viewBox="0 0 15.46 15.42" fill={color}>
      <Path d="M15.45,6.68c0-.14-.25-.26-.36-.27l-1.84-.19c-.12-.48-.27-.89-.51-1.3l1.18-1.5c.1-.13.12-.31,0-.43l-1.4-1.4c-.09-.09-.27-.11-.4-.09l-1.63,1.16c-.42-.2-.83-.37-1.3-.52l-.2-1.91c-.01-.11-.16-.22-.27-.22h-1.94c-.11,0-.26.11-.27.22l-.2,1.91c-.47.15-.88.32-1.3.52l-1.63-1.16c-.13-.02-.3,0-.4.09l-1.4,1.4c-.12.12-.11.3,0,.43l1.18,1.5c-.24.4-.39.82-.51,1.3l-1.84.19c-.12.01-.36.13-.36.27v2.11c0,.11.1.26.21.27l1.91.2c.15.46.31.86.52,1.29l-1.21,1.56c-.12.16.04.39.15.5l1.33,1.33c.1.1.27.1.38.03l1.55-1.21c.41.25.83.39,1.3.51l.2,1.89c0,.13.1.25.25.25h1.13s1.13,0,1.13,0c.14,0,.25-.12.25-.25l.2-1.89c.47-.13.89-.26,1.3-.51l1.55,1.21c.11.07.28.07.38-.03l1.33-1.33c.11-.11.27-.34.15-.5l-1.21-1.56c.21-.44.37-.84.52-1.29l1.91-.2c.11-.01.22-.16.22-.27v-2.11ZM6.94,10.22c-1.36-.39-2.22-1.6-2.08-2.83.19-1.22,1.33-2.17,2.75-2.18,1.58-.02,2.96,1.14,3.01,2.62,0,.12-.01.22-.03.34-.02.11-.03.22-.06.33-.44,1.42-2.07,2.16-3.59,1.73Z" />
    </Svg>
  ),
  // Caméra (pill organisation - côté droit, photographe)
  CamOrg: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size * (15.42/18.29)} viewBox="0 0 18.29 15.42" fill={color}>
      <Path d="M16.84,2.15h-2.86v-1.13c0-.56-.46-1.02-1.02-1.02h-7.93c-.56,0-1.02.46-1.02,1.02v1.13H1.45c-.8,0-1.45.65-1.45,1.45v10.37c0,.8.65,1.45,1.45,1.45h15.39c.8,0,1.45-.65,1.45-1.45V3.6c0-.8-.65-1.45-1.45-1.45ZM4,5.56c-.31-.31-.36-.8-.08-1.1.02-.02.05-.04.07-.06.02-.02.05-.04.08-.05.36-.19.83-.02,1.04.36.19.34.12.75-.15.96-.28.2-.69.16-.97-.11ZM10.89,12.51c-1.86,1.04-4.06.65-5.21-.8-1.1-1.5-.89-3.72.6-5.24,1.67-1.7,4.35-1.94,5.98-.41.13.12.22.25.33.39.1.14.2.26.28.42,1.04,1.97.1,4.5-1.98,5.66Z" />
    </Svg>
  ),
  // Liste (Mes events - bottom nav)
  ListEvents: ({ size = 22, color = '#0A0A0A' }) => (
    <Svg width={size} height={size * (15.42/18.58)} viewBox="0 0 18.58 15.42" fill={color}>
      <Path d="M17.11,0H1.47C.66,0,0,.66,0,1.47v12.48c0,.81.66,1.47,1.47,1.47h15.64c.81,0,1.47-.66,1.47-1.47V1.47c0-.81-.66-1.47-1.47-1.47ZM16.52,11.81c0,.8-.65,1.44-1.44,1.44H3.5c-.8,0-1.44-.65-1.44-1.44V3.61c0-.8.65-1.44,1.44-1.44h11.58c.8,0,1.44.65,1.44,1.44v8.19Z" />
      <Path d="M14.2,7.03H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,3.88H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
      <Path d="M14.2,10.19H4.38c-.37,0-.68.3-.68.68s.3.68.68.68h9.81c.37,0,.68-.3.68-.68s-.3-.68-.68-.68Z" />
    </Svg>
  ),
  // Œil ouvert : affiche le mot de passe
  Eye: ({ size = 20, color = '#9CA3AF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
    </Svg>
  ),
  // Œil barré : masque le mot de passe
  EyeOff: ({ size = 20, color = '#9CA3AF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 2l20 20" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ),
};

// Champ mot de passe avec icône œil pour afficher/masquer
function PasswordInput({ value, onChangeText, placeholder, style, autoFocus, autoCapitalize = 'none', placeholderTextColor }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ position: 'relative', justifyContent: 'center' }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        secureTextEntry={!visible}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        style={[style, { paddingRight: 44 }]}
      />
      <TouchableOpacity
        onPress={() => setVisible(v => !v)}
        hitSlop={10}
        style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}
      >
        {visible ? <Icon.EyeOff size={20} color="#9CA3AF" /> : <Icon.Eye size={20} color="#9CA3AF" />}
      </TouchableOpacity>
    </View>
  );
}

// ---------- LOADING / PULL-TO-REFRESH ----------
const LoadingIcon = ({ size = 26, color = '#c9beed' }) => (
  <Svg width={size} height={size} viewBox="0 0 57.49 57.49">
    <Path
      fill={color}
      d="M51.14,31.27c.13-.05.26-.1.39-.16,4.9-2.25,7.25-7.59,5.25-11.93-1.72-3.74-6.1-5.5-10.41-4.49.05-.13.11-.25.16-.39,1.87-5.05-.25-10.49-4.73-12.15-3.86-1.43-8.21.42-10.53,4.19-.05-.13-.1-.26-.16-.39C28.86,1.07,23.52-1.28,19.18.71c-3.74,1.72-5.5,6.1-4.49,10.41-.13-.05-.25-.11-.39-.16-5.05-1.87-10.49.25-12.15,4.73-1.43,3.86.42,8.21,4.19,10.53-.13.05-.26.1-.39.16-4.9,2.25-7.25,7.59-5.25,11.93,1.72,3.74,6.1,5.5,10.41,4.49-.05.13-.11.25-.16.39-1.87,5.05.25,10.49,4.73,12.15,3.86,1.43,8.21-.42,10.53-4.19.05.13.1.26.16.39,2.25,4.9,7.59,7.25,11.93,5.25,3.74-1.72,5.5-6.1,4.49-10.41.13.05.25.11.39.16,5.05,1.87,10.49-.25,12.15-4.73,1.43-3.86-.42-8.21-4.19-10.53ZM36.36,39.02c-5.03,3.73-12.52,2.15-16.72-3.53-4.2-5.68-3.53-13.3,1.5-17.02s12.52-2.15,16.72,3.53c4.2,5.68,3.53,13.3-1.5,17.02Z"
    />
  </Svg>
);

const SpinningLoader = ({ size = 24, color = '#c9beed' }) => {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [rotation]);
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <LoadingIcon size={size} color={color} />
    </Animated.View>
  );
};

const PULL_THRESHOLD = 70;

const RefreshableScrollView = React.forwardRef(({ onRefresh, hideTopRefresh, children, ...props }, ref) => {
  const [refreshing, setRefreshing] = useState(false);
  const scrollPosRef = useRef(0);
  const refreshingRef = useRef(false);
  const rotation = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(15)).current;

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  useEffect(() => {
    if (refreshing) {
      Animated.spring(translateYAnim, {
        toValue: 40, useNativeDriver: true, tension: 90, friction: 12,
      }).start();
      Animated.timing(opacityAnim, {
        toValue: 1, duration: 120, useNativeDriver: true,
      }).start();
      rotation.setValue(0);
      const anim = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.linear,
        })
      );
      anim.start();
      return () => anim.stop();
    }
    Animated.timing(opacityAnim, {
      toValue: 0, duration: 320, useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) translateYAnim.setValue(15);
    });
  }, [refreshing, rotation, opacityAnim, translateYAnim]);

  const onScroll = (e) => {
    scrollPosRef.current = e.nativeEvent.contentOffset.y;
  };

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.resolve(onRefresh?.());
    } finally {
      setRefreshing(false);
    }
  };

  const panGesture = Gesture.Pan()
    .activeOffsetY(8)
    .runOnJS(true)
    .onUpdate((e) => {
      if (scrollPosRef.current <= 0 && !refreshingRef.current && e.translationY > 0) {
        const dist = Math.min(e.translationY * 0.55, 140);
        const progress = Math.min(1, dist / PULL_THRESHOLD);
        translateYAnim.setValue(Math.max(15, dist * 0.5));
        rotation.setValue(progress);
        opacityAnim.setValue(progress);
      }
    })
    .onEnd((e) => {
      if (refreshingRef.current) return;
      if (e.translationY * 0.55 >= PULL_THRESHOLD && scrollPosRef.current <= 0) {
        triggerRefresh();
      } else {
        Animated.parallel([
          Animated.timing(translateYAnim, { toValue: 15, duration: 220, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(rotation, { toValue: 0, duration: 220, useNativeDriver: true }),
        ]).start();
      }
    });

  const composed = Gesture.Simultaneous(panGesture, Gesture.Native());

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ flex: 1 }}>
      {!hideTopRefresh && (
        <Animated.View pointerEvents="none" style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          alignItems: 'center', zIndex: 1000,
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        }}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <LoadingIcon size={26} color="#c9beed" />
          </Animated.View>
        </Animated.View>
      )}
      <GestureDetector gesture={composed}>
        <ScrollView
          ref={ref}
          {...props}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {children}
        </ScrollView>
      </GestureDetector>
    </View>
  );
});

// ErrorBoundary générique pour les écrans à liste (galerie photos perso /
// orga / event). Évite qu'une URL malformée ou un render thrown dans une
// cellule fasse planter tout l'écran. Affiche un fallback avec retry.
class GridErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.warn('GridErrorBoundary caught:', error?.message || error, info?.componentStack);
  }
  reset = () => this.setState({ hasError: false, error: null });
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <Text style={{ color: '#1a1a1a', fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
            Impossible d'afficher cette page
          </Text>
          <Text style={{ color: '#888', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
            {this.state.error?.message || 'Erreur de rendu inattendue.'}
          </Text>
          <TouchableOpacity onPress={this.reset} style={{ backgroundColor: '#7B2FFF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ---------- HELPERS ----------
const formatDateLong = (iso) => {
  if (!iso) return 'DATE À VENIR';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'DATE À VENIR';
  const months = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const isUpcoming = (iso) => {
  if (!iso) return true;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now() - 86400000;
};

// Extrait le burstTs (timestamp unix ms) depuis le filename d'une photo
// Format: {event}/{photographer}/{date}/{time}_{burstTs}_{idx}.jpg
const extractBurstTs = (key) => {
  if (!key) return 0;
  const filename = key.split('/').pop().replace('.jpg', '');
  const parts = filename.split('_');
  if (parts.length < 3) return 0;
  const ts = parseInt(parts[parts.length - 2], 10);
  return isNaN(ts) ? 0 : ts;
};

const cityLabel = (location) => {
  if (!location) return '';
  // "Louviers (27400)" → "Louviers (27)"
  return String(location).replace(/\((\d{2})\d{3}\)/, '($1)');
};

// Détecte l'extension d'une photo depuis l'URL (puis HEAD si absent).
// MediaLibrary.saveToLibraryAsync exige un fichier local nommé avec une
// extension valide, sinon échoue avec "Could not get the file's extension".
async function detectPhotoExtension(url) {
  const fromUrl = String(url || '').match(/\.(jpe?g|png|heic|heif|dng|webp)(\?|#|$)/i);
  if (fromUrl) {
    const e = fromUrl[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
  }
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('heic') || ct.includes('heif')) return 'heic';
    if (ct.includes('png')) return 'png';
    if (ct.includes('x-adobe-dng') || ct.includes('dng')) return 'dng';
    if (ct.includes('webp')) return 'webp';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  } catch {}
  return 'jpg';
}

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
};

// ---------- SCREENS ----------

function SelfieBlock({ selfieUri, onPress, onDelete }) {
  if (selfieUri) {
    return (
      <View style={s.selfieDoneBanner}>
        <ExpoImage
          source={{ uri: selfieUri }}
          style={{ width: 44, height: 44, borderRadius: 999 }}
          contentFit="cover"
        />
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
          <Text style={s.selfieTitle}>Un selfie suffit</Text>
          <Text style={s.selfieSub}>Pour recevoir tes photos{'\n'}de tous les événements Will</Text>
        </View>
        <View style={s.selfieAvatar}>
          <Icon.User size={40} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, onOpenOrgRole, tab, setTab, onOpenSearch, selfieUri, onDeleteSelfie, onOpenProfile, favorites, onToggleFavorite, onRefresh }) {
  const [searchQuery, setSearchQuery] = useState('');
  const tabFiltered = events.filter(e => {
    if (tab === 'upcoming') return isUpcoming(e.event_date);
    if (tab === 'past') return !isUpcoming(e.event_date);
    if (tab === 'favorites') return favorites.includes(e.code);
    return true;
  });
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? tabFiltered.filter(e => (e.name || '').toLowerCase().includes(q))
    : tabFiltered;
  const scrollRef = useRef(null);

  // Quand le clavier se ferme : remonter le scroll en haut
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  return (
    <RefreshableScrollView ref={scrollRef} onRefresh={onRefresh} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      {/* Header : avatar + "Bienvenue sur Will" + pills orga/photographe */}
      <View style={s.headerRow}>
        <View style={[s.headerLeft, { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 }]}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: '#10B981',
                borderWidth: 2,
                borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
            <Text style={[s.welcome, { color: '#c9beed', fontSize: 17 }]} numberOfLines={1}>Bienvenue sur </Text>
            <Icon.Logo width={36} color="#c9beed" />
          </View>
        </View>
        <View style={s.orgToggle}>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole('organizer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.GearOrg size={22} color={C.pinkPillActive} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.orgToggleBtn}
            onPress={() => onOpenOrgRole('photographer')}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Icon.CamOrg size={24} color={C.pinkPillActive} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Carte selfie : uniquement si pas encore pris */}
      {!selfieUri && (
        <SelfieBlock selfieUri={null} onPress={onOpenSelfie} onDelete={onDeleteSelfie} />
      )}

      {/* Champ recherche : filtre la liste juste en dessous */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#E5E0FF',
        paddingHorizontal: 16,
        paddingVertical: 4,
        marginBottom: 14,
      }}>
        <Icon.Search size={18} color={C.primary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un événement..."
          placeholderTextColor={C.textSoft}
          style={{ flex: 1, marginLeft: 10, fontSize: 14, color: C.text, paddingVertical: 8 }}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10} style={{ paddingHorizontal: 6 }}>
            <Text style={{ color: C.textSoft, fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs row : À venir / Passés / Favoris (pleine largeur) */}
      <View style={{
        flexDirection: 'row',
        backgroundColor: C.pillBg,
        borderRadius: 16,
        padding: 4,
        marginBottom: 14,
      }}>
        <TouchableOpacity onPress={() => setTab('upcoming')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'upcoming' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'upcoming' && s.pillTextActive]}>À venir</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('past')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'past' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'past' && s.pillTextActive]}>Passés</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('favorites')} style={[s.pill, { flex: 1, alignItems: 'center' }, tab === 'favorites' && s.pillActive]}>
          <Text style={[s.pillText, tab === 'favorites' && s.pillTextActive]}>Favoris</Text>
        </TouchableOpacity>
      </View>

      {/* Events list / état vide */}
      {filtered.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <View style={{ marginBottom: 12, opacity: 0.4 }}>
            <Icon.Calendar size={36} color={C.textSoft} />
          </View>
          <Text style={{ color: C.textSoft, fontSize: 14 }}>
            {tab === 'favorites' ? 'Aucun favori' : tab === 'upcoming' ? 'Aucun événement à venir' : 'Aucun événement passé'}
          </Text>
        </View>
      ) : (
        filtered.map((event) => (
          <EventCard
            key={event.code}
            event={event}
            onPress={() => onOpenEvent(event)}
            isFavorite={favorites.includes(event.code)}
            onToggleFavorite={() => onToggleFavorite(event.code)}
          />
        ))
      )}
    </RefreshableScrollView>
  );
}

function EventCard({ event, onPress, isFavorite, onToggleFavorite }) {
  const tint = TYPE_COLORS[event.event_type] || TYPE_COLORS.Autre;

  return (
    <View style={s.eventCard}>
      {/* Image en couverture pleine largeur */}
      {event.cover_image ? (
        <ExpoImage
          source={{ uri: event.cover_image }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      ) : null}
      {/* Dégradé horizontal : tint solide à gauche (texte) → transparent à droite (image visible) */}
      <LinearGradient
        colors={[tint, tint, 'transparent']}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Zone tactile principale (ouvre l'événement) */}
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={StyleSheet.absoluteFillObject} />
      {/* Texte par-dessus la zone tactile (pointerEvents none pour que le tap passe au TouchableOpacity en dessous) */}
      <View style={s.eventCardCenter} pointerEvents="none">
        <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
        <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
        <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
      </View>
      {/* Bouton favori (sa propre zone tactile, au-dessus de tout) */}
      {onToggleFavorite && (
        <TouchableOpacity
          onPress={onToggleFavorite}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61" fill={isFavorite ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
            <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
          </Svg>
        </TouchableOpacity>
      )}
    </View>
  );
}

function PhotosScreen({ events = [], onOpenSelfie, gallery, selfieUri, onDeleteSelfie, onOpenProfile, favorites, userId, onOpenPhoto, runnerToken, photoFavoritesSet, onTogglePhotoFavorite }) {
  const hasFavorites = favorites && favorites.length > 0;
  const [photos, setPhotos] = useState([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [loading, setLoading] = useState(false);

  // Map event_code → couleur
  const eventTintMap = {};
  for (const e of events) {
    eventTintMap[e.code] = TYPE_COLORS[e.event_type] || TYPE_COLORS.Autre;
  }

  const loadPhotos = useCallback(async () => {
    // user_id deduit du Bearer cote worker → besoin du runnerToken
    if (!hasFavorites || !selfieUri || !userId || !runnerToken) {
      setPhotos([]);
      return;
    }
    setLoading(true);
    setVisibleCount(20);
    const all = [];
    for (const code of favorites) {
      const tint = eventTintMap[code] || TYPE_COLORS.Autre;
      try {
        const r = await fetch(`${API_URL}/personal-gallery/${encodeURIComponent(code)}`, {
          headers: { Authorization: `Bearer ${runnerToken}` },
        });
        if (r.ok) {
          const data = await r.json();
          for (const p of (data.photos || [])) {
            all.push({ uri: p.url, id: p.key, tint });
          }
        }
      } catch (e) { console.warn('fetch perso', code, e); }
    }
    all.sort((a, b) => extractBurstTs(b.id) - extractBurstTs(a.id));
    setPhotos(all);
    setLoading(false);
  }, [favorites, selfieUri, userId, runnerToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadPhotos();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadPhotos]);

  // Affichage progressif
  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const timer = setTimeout(() => {
      setVisibleCount(v => Math.min(v + 20, photos.length));
    }, 300);
    return () => clearTimeout(timer);
  }, [visibleCount, photos.length]);

  return (
    <RefreshableScrollView hideTopRefresh onRefresh={loadPhotos} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
<TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: '#10B981',
                borderWidth: 2,
                borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.pageTitleCenter}>Mes photos</Text>

      {/* Carte ajout selfie : uniquement si pas encore de selfie */}
      {!selfieUri && (
        <SelfieBlock selfieUri={null} onPress={onOpenSelfie} onDelete={onDeleteSelfie} />
      )}

      {!hasFavorites ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
          <View style={{ marginBottom: 14, opacity: 0.4 }}>
            <Svg width={40} height={34} viewBox="0 0 20.78 17.61" fill={C.textSoft}>
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </View>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Ajoute tes courses en favoris{'\n'}pour recevoir tes photos
          </Text>
        </View>
      ) : !selfieUri ? (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: C.textSoft, fontSize: 13, textAlign: 'center' }}>
            Prends un selfie pour qu'on te reconnaisse{'\n'}sur les photos.
          </Text>
        </View>
      ) : loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <SpinningLoader size={26} color="#c9beed" />
          <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 10 }}>Recherche en cours…</Text>
        </View>
      ) : photos.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Aucune photo trouvée pour le moment.{'\n'}Reviens après l'événement !
          </Text>
        </View>
      ) : (
        <PhotoGrid
          photos={photos.slice(0, visibleCount)}
          onPress={(p) => onOpenPhoto?.(p, photos)}
          photoFavoritesSet={photoFavoritesSet}
          onToggleFavorite={onTogglePhotoFavorite}
        />
      )}
    </RefreshableScrollView>
  );
}

function PhotoGrid({ photos = [], onPress, photoFavoritesSet, onToggleFavorite }) {
  // Si pas de photos : grille de placeholders
  if (photos.length === 0) {
    return (
      <View style={s.grid}>
        {Array.from({ length: 16 }, (_, i) => (
          <View key={`ph-${i}`} style={s.gridItem}>
            <View style={s.gridPlaceholder} />
          </View>
        ))}
      </View>
    );
  }

  const showHearts = !!onToggleFavorite && !!photoFavoritesSet;

  return (
    <View style={s.grid}>
      {photos.map((p, i) => {
        const fav = showHearts && photoFavoritesSet.has(p.id);
        return (
          <TouchableOpacity
            key={p.id || `p-${i}`}
            style={s.gridItem}
            activeOpacity={0.85}
            onPress={() => onPress?.(p, i, photos)}
          >
            <ExpoImage
              source={{ uri: p.uri }}
              style={s.gridImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              priority="low"
              transition={100}
              recyclingKey={p.id}
            />
            {showHearts && (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); onToggleFavorite(p.id); }}
                hitSlop={12}
                style={{ position: 'absolute', top: 6, right: 6 }}
              >
                <Svg width={20} height={18} viewBox="-1 -1.5 22.78 20.61"
                  fill={fav ? '#fff' : 'none'}
                  stroke="#fff" strokeWidth={1.6}>
                  <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
                </Svg>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function EventDetailScreen({ event, onClose, onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, onOpenPhoto, isFavorite, onToggleFavorite }) {
  const [photos, setPhotos] = useState([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | composite key
  const tint = TYPE_COLORS[event.event_type] || TYPE_COLORS.Autre;
  const upcoming = isUpcoming(event.event_date);

  // Compte à rebours
  const daysUntil = (() => {
    if (!event.event_date) return null;
    const d = new Date(event.event_date);
    if (isNaN(d.getTime())) return null;
    const diffMs = d.getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / 86400000);
    return diffDays;
  })();

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setVisibleCount(20);
    try {
      const r = await fetch(`${API_URL}/list-public/${event.code}`);
      const data = r.ok ? await r.json() : { photos: [] };
      const list = (data.photos || []).map(p => {
        const parts = (p.key || '').split('/');
        const photographerId = parts.length >= 2 ? parts[1] : null;
        return {
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
          race: p.race,
          km: p.km,
          photographer: photographerId,
        };
      });
      list.sort((a, b) => extractBurstTs(b.id) - extractBurstTs(a.id));
      setPhotos(list.slice(0, 200));
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [event.code, tint]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadPhotos();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, [loadPhotos]);

  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const timer = setTimeout(() => {
      setVisibleCount(v => Math.min(v + 20, photos.length));
    }, 300);
    return () => clearTimeout(timer);
  }, [visibleCount, photos.length]);

  // Liste des courses et photographes uniques (depuis les photos reçues)
  const uniqueRaces = Array.from(new Set(photos.map(p => p.race).filter(Boolean)));
  const uniquePhotographers = Array.from(new Set(photos.map(p => p.photographer).filter(Boolean)));
  const photographerIndex = (id) => uniquePhotographers.indexOf(id) + 1; // 1-based

  // Construction des onglets selon le nombre de courses x photographes
  const nRaces = uniqueRaces.length;
  const nPhotographers = uniquePhotographers.length;

  const tabs = (() => {
    if (nRaces <= 1 && nPhotographers <= 1) return []; // pas d'onglets
    if (nRaces <= 1 && nPhotographers > 1) {
      // 1 course / N photographes : "Toutes" + "{km} km｜km{i}"
      const kmLabel = uniqueRaces[0] ? `${uniqueRaces[0]} km` : 'Course';
      return [
        { key: 'all', label: 'Toutes' },
        ...uniquePhotographers.map((ph, i) => ({
          key: `ph:${ph}`,
          label: `${kmLabel}｜km${i + 1}`,
        })),
      ];
    }
    if (nRaces > 1 && nPhotographers <= 1) {
      // N courses / 1 photographe : "{km} km"
      return uniqueRaces.map(km => ({
        key: `race:${km}`,
        label: `${km} km`,
      }));
    }
    // N courses / N photographes : "Toutes" + combinaisons "{km} km｜km{i}"
    const combos = [];
    for (const km of uniqueRaces) {
      for (const ph of uniquePhotographers) {
        combos.push({
          key: `combo:${km}:${ph}`,
          label: `${km} km｜km${photographerIndex(ph)}`,
        });
      }
    }
    return [{ key: 'all', label: 'Toutes' }, ...combos];
  })();

  const filteredPhotos = (() => {
    if (activeFilter === 'all') return photos;
    if (activeFilter.startsWith('race:')) {
      const km = activeFilter.slice(5);
      return photos.filter(p => String(p.race) === String(km));
    }
    if (activeFilter.startsWith('ph:')) {
      const ph = activeFilter.slice(3);
      return photos.filter(p => p.photographer === ph);
    }
    if (activeFilter.startsWith('combo:')) {
      const [, km, ph] = activeFilter.split(':');
      return photos.filter(p => String(p.race) === String(km) && p.photographer === ph);
    }
    return photos;
  })();

  const distances = Array.isArray(event.distances) ? event.distances : [];

  const openWebsite = () => {
    if (!event.website) return;
    const url = event.website.startsWith('http') ? event.website : `https://${event.website}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <RefreshableScrollView onRefresh={loadPhotos} style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity hitSlop={10} style={{ position: 'relative' }} onPress={onOpenProfile}>
            <Icon.User size={30} color="#c9beed" />
            {selfieUri && (
              <View style={{
                position: 'absolute', top: -2, right: -2, width: 10, height: 10,
                borderRadius: 5, backgroundColor: '#10B981', borderWidth: 2, borderColor: C.bg,
              }} />
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>

      <View style={{ position: 'relative', marginTop: 12, marginBottom: 8 }}>
        <View style={s.eventCard}>
          {event.cover_image ? (
            <ExpoImage source={{ uri: event.cover_image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          ) : null}
          <LinearGradient
            colors={[tint, tint, 'transparent']}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={s.eventCardCenter}>
            <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
              {event.event_type ? (
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
                }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{displayEventType(event.event_type)}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
          </View>
        </View>

        {/* Favori en haut à droite */}
        {onToggleFavorite && (
          <TouchableOpacity
            onPress={onToggleFavorite}
            hitSlop={10}
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 40, height: 40,
              alignItems: 'center', justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61"
              fill={isFavorite ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </TouchableOpacity>
        )}

        {/* Compte à rebours en bas à droite (uniquement à venir) */}
        {upcoming && daysUntil !== null && daysUntil >= 0 && (
          <View style={{ position: 'absolute', bottom: 22, right: 18, alignItems: 'flex-end' }}>
            <Text style={[s.welcome, { color: '#fff', fontSize: 26, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 }]}>
              {daysUntil === 0 ? (photos.length > 0 ? "Go !" : "Aujourd'hui") : `J-${daysUntil}`}
            </Text>
          </View>
        )}
      </View>

      {/* Courses : un seul bloc avec header de labels + lignes de valeurs */}
      {distances.length > 0 && photos.length === 0 && (
        <View style={{
          marginBottom: 16, marginTop: -6,
          backgroundColor: `${tint}1A`,
          borderRadius: 12,
          paddingVertical: 12, paddingHorizontal: 16,
        }}>
          {/* Header labels */}
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DISTANCE</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DÉPART</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: tint, fontSize: 9, fontWeight: '500', letterSpacing: 0.4 }}>DÉNIVELÉ</Text>
            </View>
          </View>
          {/* Lignes de valeurs */}
          {distances.map((d, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: `${tint}33`,
              }}
            >
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{d.km} km</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                  {upcoming && d.time ? d.time : '—'}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
                  {upcoming && d.elevation ? d.elevation : '—'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Site web (infos pratiques) */}
      {event.website ? (
        <View style={{ marginBottom: 16 }}>
          <Text style={[s.sectionTitle, { marginBottom: 10 }]}>Infos pratiques</Text>
          <TouchableOpacity
            onPress={openWebsite}
            style={{
              backgroundColor: '#faf9ff', borderRadius: 14, padding: 14,
              flexDirection: 'row', alignItems: 'center',
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 10, backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center', marginRight: 12,
            }}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth={1.8} />
                <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="#fff" strokeWidth={1.5} />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 14, fontWeight: '600' }}>Site web</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                {event.website}
              </Text>
            </View>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Galerie ou message à venir */}
      {upcoming && photos.length === 0 ? (
        <View style={{ paddingVertical: 30, alignItems: 'center', backgroundColor: `${tint}1A`, borderRadius: 16, marginTop: 4 }}>
          <Icon.PhotoCam size={40} color={tint} />
          <Text style={{ color: tint, fontSize: 14, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
            Photos disponibles le jour J
          </Text>
          <Text style={{ color: tint, fontSize: 12, marginTop: 4, textAlign: 'center', opacity: 0.75 }}>
            Reviens le jour de l'événement pour voir tes photos
          </Text>
        </View>
      ) : (
        <>
          {/* Onglets de filtre (course / photographe / combiné) */}
          {tabs.length > 0 && photos.length > 0 && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 4 }}
              style={{ marginVertical: 8 }}
            >
              {tabs.map((t) => {
                const active = activeFilter === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => setActiveFilter(t.key)}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                      backgroundColor: active ? C.primary : '#f5f3ff',
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <Text style={[s.sectionTitle, { marginVertical: 14 }]}>Photos</Text>
          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : filteredPhotos.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>
            </View>
          ) : (
            <PhotoGrid photos={filteredPhotos.slice(0, visibleCount)} onPress={(p) => onOpenPhoto?.(p, filteredPhotos)} />
          )}
        </>
      )}
    </RefreshableScrollView>
  );
}

function PhotographerScreen({ session, onLogout }) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Configuration globale (chargée au mount, défauts si offline / nouveau schéma 6 sections)
  const [eventConfig, setEventConfig] = useState({
    capture: {
      burstCount: 8,
      interBurstMs: 150,
      cooldownSec: 5,
      quality: "ultrahd",   // standard / hd / ultrahd / proraw
      format: "jpeg",       // jpeg / heic / dng
    },
    faceDetection: {
      confidenceThreshold: 0.7,
      minFaceSizePercent: 5,
      maxFaceSizePercent: 80,
      triggerZoneWidthPercent: 33,
      triggerZonePosition: "center", // left / center / right
      minFacesToTrigger: 1,
    },
    rekognition: { similarityThreshold: 80, maxMatchesPerPhoto: 5, collectionTtlDays: 14 },
    imageProcessing: { generateThumbnail: true, generatePreview: true, thumbnailWidthPx: 400, previewWidthPx: 1200, previewQuality: 80 },
    upload: { mode: "immediate", batchSize: 10, maxRetries: 5, compressBeforeUpload: false },
    debug: { verboseLogs: false, skipRekognition: false, saveUnmatchedFrames: false },
  });

  useEffect(() => {
    fetch(`${API_URL}/config`)
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) setEventConfig(prev => ({ ...prev, ...cfg })); })
      .catch(() => {});
  }, []);

  // Photo HQ d'abord (résolution capteur max), preview en basse résolution
  // pour garder le frame processor MLKit fluide.
  const format = useCameraFormat(device, [
    { photoResolution: 'max' },
    { photoAspectRatio: 4 / 3 },
    { videoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);
  const cameraRef = useRef(null);

  const photoHdrEnabled = !!format?.supportsPhotoHdr;
  const videoStabilizationMode = useMemo(() => {
    const modes = format?.videoStabilizationModes || [];
    if (modes.includes('cinematic-extended')) return 'cinematic-extended';
    if (modes.includes('cinematic')) return 'cinematic';
    if (modes.includes('standard')) return 'standard';
    return 'off';
  }, [format]);
  const proRawEnabled = !!device?.supportsRawCapture && !!format?.supportsPhotoHdr;

  // Map capture.quality → photoQualityBalance Vision Camera
  const photoQualityBalance = (() => {
    const q = eventConfig.capture?.quality;
    if (q === 'standard') return 'speed';
    if (q === 'hd') return 'balanced';
    return 'quality'; // ultrahd, proraw, défaut
  })();

  const isCapturingRef = useRef(false);
  const lastFaceSeenAtRef = useRef(0);
  const isMountedRef = useRef(true);
  const isDetectionEnabledRef = useRef(false);
  // Flag d'arrêt : un tap sur Go pendant la rafale le passe à true ; la boucle
  // dans startBurst le lit à chaque itération et break.
  const abortBurstRef = useRef(false);
  // Mirror du facesInZoneCount lu via ref (pas via state) au moment du tap Go.
  // Évite tout problème de closure stale entre le worklet runOnJS et onPress.
  const facesInZoneCountRef = useRef(0);

  const [facesCount, setFacesCount] = useState(0);
  const [facesInZoneCount, setFacesInZoneCount] = useState(0);
  const [isShooting, setIsShooting] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [isDetectionEnabled, setIsDetectionEnabled] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showSessionModal, setShowSessionModal] = useState(false);

  // Caméra ancrée juste sous le header (au lieu de absoluteFill + letterbox 4:3
  // qui laissait un grand vide noir entre le header et l'image visible sur les
  // grands écrans). La preview est dimensionnée explicitement en 4:3.
  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  const previewH = Math.min(winH, winW * (4 / 3));
  const CAMERA_TOP = 148;

  // Course + km posté
  const [selectedRace, setSelectedRace] = useState(null); // null = "Toutes les courses"
  const [selectedKm, setSelectedKm] = useState(0);
  const [racePickerOpen, setRacePickerOpen] = useState(false);
  const [kmPickerOpen, setKmPickerOpen] = useState(false);
  const distances = Array.isArray(session?.event?.distances) ? session.event.distances : [];
  const hasDistances = distances.length > 0;
  const maxKm = hasDistances
    ? Math.max(...distances.map(d => parseFloat(d.km) || 0).filter(n => n > 0), 50)
    : 50;
  const kmCeiling = selectedRace
    ? Math.ceil(parseFloat(selectedRace.km) || maxKm)
    : Math.ceil(maxKm);

  const badgePulse = useRef(new Animated.Value(1)).current;
  const badgeOpacity = useRef(new Animated.Value(1)).current;
  const edgePulse = useRef(new Animated.Value(0.6)).current;

  // Flash blanc full-screen au début d'une rafale + animations de l'UI.
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const captureScale = useRef(new Animated.Value(1)).current;
  const photoCountScale = useRef(new Animated.Value(1)).current;
  const headerSlideY = useRef(new Animated.Value(-120)).current;
  const footerSlideY = useRef(new Animated.Value(300)).current;

  // MLKit ne supporte pas confidenceThreshold (face *detection*); on garde
  // minFaceSize comme pré-filtre côté natif et on filtre maxFaceSize côté JS.
  const minFaceSizeMlkit = (eventConfig.faceDetection?.minFaceSizePercent ?? 5) / 100;
  const faceDetectionOptions = useMemo(() => ({
    performanceMode: 'fast',
    landmarkMode: 'none',
    contourMode: 'none',
    classificationMode: 'none',
    minFaceSize: minFaceSizeMlkit,
    trackingEnabled: true,
  }), [minFaceSizeMlkit]);

  const { detectFaces } = useFaceDetector(faceDetectionOptions);

  // Cooldown temporel par face id : on ne re-burst pas le même visage
  // tant que cooldownSec n'est pas écoulé.
  const lastBurstByFaceRef = useRef(new Map());

  const onFacesDetectedJS = useMemo(
    () => Worklets.createRunOnJS((facesData) => {
      setFacesCount(facesData.length);
      if (!isDetectionEnabledRef.current) {
        setFacesInZoneCount(0);
        facesInZoneCountRef.current = 0;
        return;
      }
      const cooldownMs = (eventConfig.capture?.cooldownSec ?? 5) * 1000;
      const minFaces = eventConfig.faceDetection?.minFacesToTrigger ?? 1;
      const maxSize = (eventConfig.faceDetection?.maxFaceSizePercent ?? 80) / 100;
      const now = Date.now();

      // Filtre les visages dans la zone, en éliminant ceux trop gros (trop près)
      const validInZone = facesData.filter(f =>
        f.inZone && (f.sizeFraction == null || f.sizeFraction <= maxSize)
      );
      setFacesInZoneCount(validInZone.length);
      facesInZoneCountRef.current = validInZone.length;

      if (validInZone.length < minFaces) return;
      if (isCapturingRef.current) return;

      // Au moins un visage doit avoir son cooldown écoulé pour déclencher
      const eligible = validInZone.some(f => {
        const last = lastBurstByFaceRef.current.get(f.id) || 0;
        return now - last > cooldownMs;
      });
      if (!eligible) return;

      // Stamp tous les visages de la zone (même cooldown qu'un seul nouveau)
      for (const f of validInZone) lastBurstByFaceRef.current.set(f.id, now);
      // GC simple: purge des entries vieilles de > 2× cooldown pour ne pas grossir
      for (const [id, t] of lastBurstByFaceRef.current) {
        if (now - t > cooldownMs * 2) lastBurstByFaceRef.current.delete(id);
      }
      startBurst();
    }),
    [
      eventConfig.capture?.cooldownSec,
      eventConfig.faceDetection?.minFacesToTrigger,
      eventConfig.faceDetection?.maxFaceSizePercent,
    ]
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

  // Zone de déclenchement : bande verticale, position gauche / centre / droite.
  const zonePct = (eventConfig.faceDetection?.triggerZoneWidthPercent ?? 33) / 100;
  const zonePosition = eventConfig.faceDetection?.triggerZonePosition || 'center';
  // Fraction VERTICALE de la preview où la détection est valide. Doit rester
  // synchro avec la hauteur du cadre de visée visuel ci-dessous (qui utilise
  // height: previewH * TRIGGER_VPCT, top: CAMERA_TOP + previewH * (1 - TRIGGER_VPCT) / 2).
  const TRIGGER_VPCT = 0.8;

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    const fW = frame.width;
    const fH = frame.height;
    // MLKit retourne les bounds dans le repère du capteur landscape natif.
    // En orientation portrait + landscape-right : axe Y du frame = axe horizontal écran
    // (gauche écran = grand Y, droite écran = petit Y) ; axe X du frame = axe vertical écran.
    const bandWidth = fH * zonePct;
    let testMin = 0, testMax = 0;
    if (zonePosition === 'left') {
      testMin = fH - bandWidth; testMax = fH;
    } else if (zonePosition === 'right') {
      testMin = 0; testMax = bandWidth;
    } else {
      testMin = fH / 2 - bandWidth / 2;
      testMax = fH / 2 + bandWidth / 2;
    }
    // Bande VERTICALE écran = axe X du frame. On exige que le visage soit dans
    // les TRIGGER_VPCT centrés (= dans le cadre de visée visuel).
    const vMargin = fW * (1 - TRIGGER_VPCT) / 2;
    const vMin = vMargin;
    const vMax = fW - vMargin;

    const facesData = faces.map(f => {
      const bounds = f.bounds || f.frame || {};
      const cx = (bounds.x || 0) + (bounds.width || 0) / 2;
      const cy = (bounds.y || 0) + (bounds.height || 0) / 2;
      const sizeFraction = Math.max(
        (bounds.width || 0) / fW,
        (bounds.height || 0) / fH,
      );
      const inside = (cy >= testMin && cy <= testMax) && (cx >= vMin && cx <= vMax);
      return {
        id: f.trackingId != null ? String(f.trackingId) : `${Math.round(cx)}_${Math.round(cy)}`,
        inZone: inside,
        sizeFraction,
      };
    });
    onFacesDetectedJS(facesData);
  }, [detectFaces, onFacesDetectedJS, zonePct, zonePosition, TRIGGER_VPCT]);

  const NO_FACE_TIMEOUT_MS = 500;
  const INTER_PHOTO_MS = 100; // ~5 photos/sec, optimum vitesse/utilité

  // === Mode offline-first : queue persistante ===
  // - Photos copiées dans Paths.document/will_pending/ (survit au kill app)
  // - Métadonnées dans AsyncStorage UPLOAD_QUEUE_KEY (single global queue)
  // - Upload gated par NetInfo (pas de tentative si offline)
  // - status: 'pending' | 'uploading' | 'failed' (max retries atteint)
  const [queueStats, setQueueStats] = useState({ total: 0, pending: 0, uploading: 0, failed: 0 });
  const [isOnline, setIsOnline] = useState(true);
  const queueRef = useRef([]);
  const drainingRef = useRef(false);

  function recomputeStats(arr) {
    const stats = { total: arr.length, pending: 0, uploading: 0, failed: 0 };
    for (const it of arr) {
      if (it.status === 'failed') stats.failed++;
      else if (it.status === 'uploading') stats.uploading++;
      else stats.pending++;
    }
    return stats;
  }

  async function commitQueue(arr) {
    queueRef.current = arr;
    await saveUploadQueue(arr);
    if (isMountedRef.current) {
      setQueueStats(recomputeStats(arr));
    }
  }

  // Charge la queue au démarrage du screen + reconcile fichiers manquants
  // + reset des items 'uploading' (interrompus par crash/kill)
  useEffect(() => {
    let alive = true;
    (async () => {
      ensurePendingDir();
      const arr = await loadUploadQueue();
      const cleaned = [];
      for (const it of arr) {
        // file:// → strip
        const fileExists = (() => {
          try { return new File(it.localUri).exists; } catch { return false; }
        })();
        if (!fileExists) continue; // drop silencieusement
        // recovery: tout 'uploading' redevient 'pending'
        if (it.status === 'uploading') cleaned.push({ ...it, status: 'pending' });
        else cleaned.push(it);
      }
      if (!alive) return;
      await commitQueue(cleaned);
      drainQueue();
    })();
    return () => { alive = false; };
  }, []);

  // NetInfo: relance le drain au retour du réseau, met à jour l'indicateur
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (isMountedRef.current) setIsOnline(online);
      if (online) drainQueue();
    });
    return () => unsub();
  }, []);

  // Heartbeat 30s : filet de sécurité au cas où NetInfo manquerait un évènement
  useEffect(() => {
    const t = setInterval(() => drainQueue(), 30000);
    return () => clearInterval(t);
  }, []);

  // Enqueue: copie le fichier capturé vers le dossier persistant et ajoute à la queue
  async function enqueueBurstItems(rawItems) {
    if (rawItems.length === 0) return;
    ensurePendingDir();
    const dir = pendingDir();
    const newQueueItems = [];
    for (const r of rawItems) {
      try {
        const ext = r.isRaw ? 'dng' : 'jpg';
        const id = generateItemId();
        const dest = new File(dir, `${id}.${ext}`);
        const src = new File(r.tempPath.startsWith('file://') ? r.tempPath : `file://${r.tempPath}`);
        try { src.copy(dest); }
        catch (e) {
          // Si copy échoue (ex. fichier source déjà déplacé), on essaie move pour éviter de perdre la photo
          try { src.move(dest); } catch { console.warn('copy/move failed', e?.message); continue; }
        }
        newQueueItems.push({
          id,
          localUri: dest.uri,
          eventCode: session?.event?.code || 'unknown',
          photographerName: session?.photographer_name || session?.photographer_id || 'unknown',
          burstTs: r.burstTs,
          idx: r.idx,
          createdAt: Date.now(),
          retries: 0,
          status: 'pending',
          // métadonnées pour upload
          key: r.key,
          isRaw: !!r.isRaw,
          race: r.race,
          km: r.km,
        });
      } catch (e) { console.warn('enqueueBurstItems', e?.message); }
    }
    const next = [...queueRef.current, ...newQueueItems];
    await commitQueue(next);

    // Alerte de stockage
    const sizeBytes = pendingDirSizeBytes();
    if (sizeBytes > STORAGE_WARN_BYTES) {
      Alert.alert(
        'Stockage local plein',
        `Plus de 5 Go de photos en attente d'upload (${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)} Go). Connecte-toi à un wifi pour libérer de l'espace.`,
      );
    }

    drainQueue();
  }

  async function drainQueue() {
    if (drainingRef.current) return;
    if (!session?.token) return;

    // Gate réseau : on lit l'état NetInfo en synchrone via fetch sync (mais c'est async).
    // On utilise isOnline pour éviter un await coûteux. Si offline, on quitte direct.
    const state = await NetInfo.fetch().catch(() => null);
    const online = state ? (!!state.isConnected && state.isInternetReachable !== false) : isOnline;
    if (!online) return;

    drainingRef.current = true;
    try {
      const arr = [...queueRef.current];
      const uploadable = arr
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => it.status === 'pending' || it.status === 'failed');
      if (uploadable.length === 0) { drainingRef.current = false; return; }

      const verbose = !!eventConfig.debug?.verboseLogs;
      const maxRetries = eventConfig.upload?.maxRetries ?? MAX_RETRIES_DEFAULT;
      const uploadMode = eventConfig.upload?.mode || 'immediate';
      const batchSize = eventConfig.upload?.batchSize ?? 10;
      // mode 'wifi' : si Cellular, on défère
      if (uploadMode === 'wifi' && state?.type && state.type !== 'wifi') {
        if (verbose) console.log('[upload] mode=wifi, type=', state.type, '— on attend');
        drainingRef.current = false;
        return;
      }
      if (uploadMode === 'batch' && uploadable.length < batchSize) {
        if (verbose) console.log(`[upload] mode=batch, ${uploadable.length}/${batchSize} pending`);
        drainingRef.current = false;
        return;
      }

      if (verbose) console.log(`[upload] drain ${uploadable.length} items (online=${online})`);

      const CONCURRENCY = 4;
      let cursor = 0;
      // mark all as uploading upfront so UI reflète
      for (const { i } of uploadable) arr[i] = { ...arr[i], status: 'uploading' };
      await commitQueue(arr);

      async function worker() {
        while (cursor < uploadable.length) {
          const { i } = uploadable[cursor++];
          const item = arr[i];
          if (!item) continue;
          // sanity: file still there?
          let fileExists = false;
          try { fileExists = new File(item.localUri).exists; } catch {}
          if (!fileExists) {
            if (verbose) console.warn('[upload] file missing, drop', item.id);
            arr[i] = null;
            continue;
          }
          try {
            const blob = await (await fetch(item.localUri)).blob();
            const headers = {
              'Content-Type': item.isRaw ? 'image/x-adobe-dng' : 'image/jpeg',
              Authorization: `Bearer ${session.token}`,
            };
            if (item.race) headers['X-Will-Race'] = String(item.race);
            if (item.km) headers['X-Will-Km'] = String(item.km);
            const res = await fetch(`${API_URL}/${item.key}`, { method: 'PUT', headers, body: blob });
            if (res.ok) {
              // succès → delete fichier local + drop item
              try { new File(item.localUri).delete(); } catch {}
              arr[i] = null;
              if (isMountedRef.current) setPhotoCount(c => c + 1);
            } else {
              const retries = (item.retries || 0) + 1;
              if (verbose) console.warn(`[upload] HTTP ${res.status} ${item.id} retries=${retries}`);
              arr[i] = {
                ...item,
                retries,
                status: retries >= maxRetries ? 'failed' : 'pending',
              };
            }
          } catch (e) {
            const retries = (item.retries || 0) + 1;
            if (verbose) console.warn(`[upload] err ${item.id}`, e?.message);
            arr[i] = {
              ...item,
              retries,
              status: retries >= maxRetries ? 'failed' : 'pending',
            };
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }).map(() => worker()));
      const cleaned = arr.filter(Boolean);
      await commitQueue(cleaned);
    } catch (e) {
      console.warn('drainQueue', e?.message);
    } finally {
      drainingRef.current = false;
    }
  }

  async function retryAllFailed() {
    const next = queueRef.current.map(it =>
      it.status === 'failed' ? { ...it, retries: 0, status: 'pending' } : it,
    );
    await commitQueue(next);
    drainQueue();
  }

  function startSession() {
    isDetectionEnabledRef.current = true;
    setIsDetectionEnabled(true);
  }

  function stopSession() {
    isDetectionEnabledRef.current = false;
    setIsDetectionEnabled(false);
    lastFaceSeenAtRef.current = 0;
  }

  // Détection activée par défaut dès l'ouverture de l'écran photographe — la
  // capture button et le frame processor déclenchent tous les deux startBurst().
  // Slide-in du header/footer au mount.
  useEffect(() => {
    startSession();
    Animated.parallel([
      Animated.timing(headerSlideY, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(footerSlideY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feedback visuel au lancement d'une rafale.
  function triggerBurstFeedback() {
    // Flash blanc 120ms
    flashOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 0.55, duration: 40, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start();
    // 3. Pop scale sur le compteur "N photos" : 1 → 1.3 → 1
    Animated.sequence([
      Animated.timing(photoCountScale, { toValue: 1.3, duration: 140, useNativeDriver: true }),
      Animated.spring(photoCountScale, { toValue: 1, tension: 180, friction: 7, useNativeDriver: true }),
    ]).start();
  }

  // Capture manuelle déclenchée par le bouton GO.
  // - Pendant la rafale : tap = Stop (lève abortBurstRef).
  // - Sinon : ne déclenche que si un visage est dans la zone (lecture via ref
  //   pour éviter le closure stale du useState entre worklet runOnJS et onPress).
  //   Si pas de visage : scale "tap registered" silencieux, pas de rafale.
  //   L'indicateur "AUCUN VISAGE" dans le header dit pourquoi.
  function onCapturePress() {
    if (isCapturingRef.current) {
      abortBurstRef.current = true;
      return;
    }
    Animated.sequence([
      Animated.timing(captureScale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.spring(captureScale, { toValue: 1, tension: 180, friction: 7, useNativeDriver: true }),
    ]).start();
    if (facesInZoneCountRef.current === 0) return;
    startBurst();
  }

  async function startBurst() {
    if (isCapturingRef.current) return;
    if (!cameraRef.current || !isMountedRef.current) return;
    if (!isDetectionEnabledRef.current) return;

    isCapturingRef.current = true;
    abortBurstRef.current = false;
    setIsShooting(true);

    const burstTs = Date.now();
    const queue = [];
    const BURST_COUNT = eventConfig.capture?.burstCount ?? 8;
    const INTER_BURST_MS = eventConfig.capture?.interBurstMs ?? 150;

    // Feedback dès le départ — flash + vibration + pop sur le compteur
    triggerBurstFeedback();

    // Capture HQ découplée du frame processor: chaque takePhoto utilise
    // la pleine résolution du capteur. Pas de throttle iOS-side, on laisse
    // AVFoundation enchaîner tant qu'il peut. ProRAW si dispo + demandé,
    // sinon HEIC HQ (photoQualityBalance + photoHdr réglés sur le composant Camera).
    const wantsRaw =
      eventConfig.capture?.format === 'dng' ||
      eventConfig.capture?.quality === 'proraw';
    const takePhotoOpts = {
      flash: 'off',
      enableShutterSound: false,
      enableAutoRedEyeReduction: false,
    };
    if (wantsRaw && proRawEnabled) {
      takePhotoOpts.enableRawCapture = true;
    }

    for (let i = 0; i < BURST_COUNT; i++) {
      if (!isMountedRef.current || !isDetectionEnabledRef.current) break;
      if (abortBurstRef.current) break;
      try {
        const photo = await cameraRef.current.takePhoto(takePhotoOpts);
        queue.push({ photo, index: i, burstTs });
      } catch (e) { console.warn('takePhoto', e); }
      if (i < BURST_COUNT - 1) {
        await new Promise(r => setTimeout(r, INTER_BURST_MS));
      }
    }

    isCapturingRef.current = false;
    setIsShooting(false);

    if (queue.length > 0) {
      const d = new Date();
      const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      const timeStr = `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
      const rawItems = queue.map(({ photo, index, burstTs: ts }) => {
        const ext = photo.isRawPhoto ? 'dng' : 'jpg';
        return {
          key: `${session.event.code}/${session.photographer_id}/${dateStr}/${timeStr}_${ts}_${index}.${ext}`,
          tempPath: photo.path,
          isRaw: !!photo.isRawPhoto,
          burstTs: ts,
          idx: index,
          race: selectedRace ? String(selectedRace.km) : null,
          km: selectedKm ? String(selectedKm) : null,
        };
      });
      // copie persistante + enqueue (non bloquant) — drain au prochain online
      enqueueBurstItems(rawItems);
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
    ? 'En attente'
    : isShooting
      ? `Capture · ${facesCount} visage${facesCount > 1 ? 's' : ''}`
      : facesCount > 0
        ? `${facesCount} visage${facesCount > 1 ? 's' : ''} détecté${facesCount > 1 ? 's' : ''}`
        : 'Prêt';

  // Label statut affiché dans le header flottant.
  // PRÊT = visage présent DANS la zone (entre les 2 lignes) — tap Go va déclencher.
  // AUCUN VISAGE = rien à capturer — tap Go sera rejeté.
  const statusInfo = isShooting
    ? { label: 'Capture', dot: '#EF4444', bg: 'rgba(239,68,68,0.2)', text: '#EF4444' }
    : !isOnline
      ? { label: 'Hors ligne', dot: '#F59E0B', bg: 'rgba(245,158,11,0.2)', text: '#F59E0B' }
      : facesInZoneCount > 0
        ? { label: 'Prêt', dot: '#22C55E', bg: 'rgba(34,197,94,0.2)', text: '#22C55E' }
        : { label: 'Aucun visage', dot: '#F59E0B', bg: 'rgba(245,158,11,0.2)', text: '#F59E0B' };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Caméra — resizeMode 'contain' (letterbox naturel), bandes noires explicites par-dessus.
          La détection (frame processor) reste en coordonnées sensor : performance Rekognition inchangée. */}
      <VisionCamera
        ref={cameraRef}
        style={{
          position: 'absolute',
          top: CAMERA_TOP,
          left: 0, right: 0,
          height: previewH,
        }}
        device={device}
        format={format}
        isActive={true}
        photo={true}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        zoom={zoomLevel}
        resizeMode="contain"
        photoQualityBalance={photoQualityBalance}
        photoHdr={photoHdrEnabled}
        videoStabilizationMode={videoStabilizationMode}
        enableLocation={false}
      />

      {/* ─── CADRAGE DÉTECTION : lignes verticales subtiles (0.35) + 4 coins en L.
          Bande verticale = TRIGGER_VPCT de la preview centrée. Le worklet
          MLKit applique strictement la même contrainte (cf. vMin/vMax dans
          le frame processor), donc visuel et logique sont alignés. ─── */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: CAMERA_TOP + previewH * (1 - TRIGGER_VPCT) / 2,
          left: 0, right: 0,
          height: previewH * TRIGGER_VPCT,
          flexDirection: 'row',
          justifyContent:
            zonePosition === 'left' ? 'flex-start' :
            zonePosition === 'right' ? 'flex-end' : 'center',
        }}
      >
        <View style={{ width: `${zonePct * 100}%`, height: '100%' }}>
          {(() => {
            const inZone = facesInZoneCount > 0;
            const lineColor = inZone ? 'rgba(16, 185, 129, 0.85)' : 'rgba(255, 255, 255, 0.35)';
            const cornerColor = inZone ? '#10B981' : '#FFFFFF';
            return (
              <>
                {/* Lignes verticales subtiles */}
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, backgroundColor: lineColor }} />
                <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 1, backgroundColor: lineColor }} />
                {/* 4 coins en L (24px, border 3px) */}
                <View style={{ position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderTopWidth: 3, borderLeftWidth: 3, borderColor: cornerColor, borderTopLeftRadius: 4 }} />
                <View style={{ position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderTopWidth: 3, borderRightWidth: 3, borderColor: cornerColor, borderTopRightRadius: 4 }} />
                <View style={{ position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: cornerColor, borderBottomLeftRadius: 4 }} />
                <View style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderBottomWidth: 3, borderRightWidth: 3, borderColor: cornerColor, borderBottomRightRadius: 4 }} />
              </>
            );
          })()}
        </View>
      </View>

      {/* ─── FLASH RAFALE (full-screen, blanc, 120ms) ─── */}
      <Animated.View
        pointerEvents="none"
        style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: '#fff',
          opacity: flashOpacity,
        }}
      />

      {/* ─── TOP AREA (style iOS Camera : dark gradient + floating row, pas de boîte) ─── */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 56, paddingBottom: 8, paddingHorizontal: 20,
          transform: [{ translateY: headerSlideY }],
          zIndex: 10,
        }}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        {/* Row 1 : retour | titre+date centré | spacer */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={onLogout}
            hitSlop={10}
            style={{
              paddingHorizontal: 14, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.15)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M19 12H5M12 19l-7-7 7-7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
            <Text
              style={{
                color: '#fff', fontSize: 16, fontWeight: '700',
                textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
              }}
              numberOfLines={1}
            >
              {session?.event?.name || 'Événement'}
            </Text>
            {session?.event?.event_date ? (
              <Text
                style={{
                  color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1,
                  textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4,
                }}
                numberOfLines={1}
              >
                {formatDateLong(session.event.event_date)}
              </Text>
            ) : null}
          </View>

          {/* Spacer pour équilibrer la pill retour à gauche */}
          <View style={{ width: 46, height: 36 }} />
        </View>

        {/* Row 2 : pill statut + pill compteur photo, centrés sous le titre */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Animated.View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              backgroundColor: statusInfo.bg,
              transform: [{ scale: badgePulse }],
            }}
          >
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusInfo.dot }} />
            <Text style={{
              color: statusInfo.text,
              fontSize: 11, fontWeight: '800', letterSpacing: 0.4,
            }}>{statusInfo.label.toUpperCase()}</Text>
          </Animated.View>

          <TouchableOpacity
            onPress={() => setShowSessionModal(true)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.1)',
            }}
          >
            {!isOnline ? (
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path d="M3 3l18 18M7 8a5 5 0 0 1 9-1.5M19 14a4 4 0 0 0-2-7.5M9 17h7a3 3 0 0 0 .5-6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
              </Svg>
            ) : (
              <Icon.PhotoCam size={14} color="#fff" />
            )}
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
              {(photoCount + queueStats.total) > 0 ? (photoCount + queueStats.total) : '—'}
            </Text>
            {queueStats.failed > 0 && (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444', marginLeft: 2 }} />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ─── BOTTOM AREA (style iOS Camera : dark gradient + zoom + chips uppercase + shutter row) ─── */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingTop: 60, paddingBottom: 36, paddingHorizontal: 20,
          transform: [{ translateY: footerSlideY }],
          zIndex: 10,
        }}
      >
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* 1. Chips course en pills (bg sombre / actif rose, cohérent avec le zoom) */}
        {hasDistances && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 8, minWidth: '100%', justifyContent: 'center', alignItems: 'center' }}
            style={{ marginBottom: 18, maxHeight: 36 }}
          >
            {[null, ...distances].map((d, i) => {
              const active = (d === null && !selectedRace) ||
                (d && selectedRace && parseFloat(selectedRace.km) === parseFloat(d.km));
              const label = d === null ? 'TOUTES' : `${d.km} KM`;
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setSelectedRace(d);
                    if (d && selectedKm > Math.ceil(parseFloat(d.km) || 0)) setSelectedKm(0);
                  }}
                  hitSlop={4}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: active ? C.pinkPillActive : 'rgba(0,0,0,0.5)',
                  }}
                >
                  <Text style={{
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: '800',
                    letterSpacing: 0.8,
                  }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* 2. Shutter row : [zoom] [Go!] [km] */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Zoom pill — container unique, options côte à côte */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 999, padding: 4,
            height: 40, width: 90,
          }}>
            {[1, 1.5].map(z => {
              const active = zoomLevel === z;
              return (
                <TouchableOpacity
                  key={z}
                  onPress={() => setZoomLevel(z)}
                  style={{
                    flex: 1, height: '100%',
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: active ? C.pinkPillActive : 'transparent',
                    borderRadius: 999,
                  }}
                >
                  <Text style={{
                    color: '#fff',
                    fontWeight: '800',
                    fontSize: 12,
                  }}>
                    {z === 1 ? '1×' : '1,5×'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Shutter — bouton Go!/Stop pill centré. Tap pendant rafale = Stop. */}
          <Animated.View style={{ transform: [{ scale: captureScale }] }}>
            <TouchableOpacity
              onPress={onCapturePress}
              activeOpacity={0.9}
              style={{
                width: 140, height: 60, borderRadius: 999,
                backgroundColor: isShooting ? C.primary : C.pinkPillActive,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Text style={{
                color: '#fff',
                fontSize: 22,
                fontStyle: 'italic',
                fontWeight: '800',
                fontFamily: 'AVEstiana',
                letterSpacing: 1,
              }}>{isShooting ? 'Stop' : 'Go!'}</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Km pill — à droite du bouton Go */}
          <TouchableOpacity
            onPress={() => { setKmPickerOpen(true); setRacePickerOpen(false); }}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, height: 30, borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.1)',
            }}
          >
            <Text style={{
              color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '800',
              letterSpacing: 0.5,
            }}>KM</Text>
            <Text style={{
              color: selectedKm > 0 ? '#fff' : 'rgba(255,255,255,0.45)',
              fontSize: 14, fontWeight: '800',
            }}>
              {selectedKm > 0 ? selectedKm : '—'}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Sélecteur de course (modal bottom sheet) */}
      <Modal visible={racePickerOpen} transparent animationType="slide" onRequestClose={() => setRacePickerOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setRacePickerOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 12, textAlign: 'center' }}>Course couverte</Text>
            <TouchableOpacity
              onPress={() => { setSelectedRace(null); setRacePickerOpen(false); }}
              style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: !selectedRace ? C.primary : '#f5f3ff', marginBottom: 8, alignItems: 'center' }}
            >
              <Text style={{ color: !selectedRace ? '#fff' : C.text, fontSize: 15, fontWeight: '600' }}>Toutes les courses</Text>
            </TouchableOpacity>
            {distances.map((d, i) => {
              const active = selectedRace && parseFloat(selectedRace.km) === parseFloat(d.km);
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setSelectedRace(d);
                    if (selectedKm > Math.ceil(parseFloat(d.km) || 0)) setSelectedKm(0);
                    setRacePickerOpen(false);
                  }}
                  style={{ paddingVertical: 14, borderRadius: 12, backgroundColor: active ? C.primary : '#f5f3ff', marginBottom: 8, alignItems: 'center' }}
                >
                  <Text style={{ color: active ? '#fff' : C.text, fontSize: 15, fontWeight: '600' }}>{d.km} km</Text>
                </TouchableOpacity>
              );
            })}
            {!hasDistances && (
              <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                L'organisateur n'a pas encore défini de distances pour cet événement.
              </Text>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Sélecteur de km (roulette simple) */}
      <Modal visible={kmPickerOpen} transparent animationType="slide" onRequestClose={() => setKmPickerOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setKmPickerOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 4, textAlign: 'center' }}>Km où tu es posté</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>
              0 à {kmCeiling} km
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
              style={{ maxHeight: 60 }}
            >
              {Array.from({ length: kmCeiling + 1 }).map((_, k) => {
                const active = selectedKm === k;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => { setSelectedKm(k); setKmPickerOpen(false); }}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 10,
                      borderRadius: 12,
                      backgroundColor: active ? C.primary : '#f5f3ff',
                      minWidth: 56,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '700', fontSize: 15 }}>{k}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <SessionPhotosModal
        visible={showSessionModal}
        onClose={() => setShowSessionModal(false)}
        queueItems={queueRef.current}
        uploadedCount={photoCount}
        stats={queueStats}
        onRetryAll={retryAllFailed}
      />
    </View>
  );
}

function SessionPhotosModal({ visible, onClose, queueItems, uploadedCount, stats, onRetryAll }) {
  // Réfresh à chaque ouverture : queueRef.current peut muter sans déclencher de re-render
  const items = visible ? (queueItems || []) : [];
  // Tri : plus récents en premier
  const sorted = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const COLS = 3;
  const GUTTER = 4;
  const screenW = Dimensions.get('window').width;
  const cell = Math.floor((screenW - 32 - GUTTER * (COLS - 1)) / COLS);

  const totalSession = uploadedCount + (stats?.total || 0);
  const inFlight = (stats?.pending || 0) + (stats?.uploading || 0);
  const failed = stats?.failed || 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
        {/* Header */}
        <View style={{
          paddingTop: 56, paddingBottom: 12, paddingHorizontal: 16,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
        }}>
          <View>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
              Photos de cette session
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 }}>
              {totalSession} prise{totalSession > 1 ? 's' : ''} depuis ta connexion
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        {/* Grille thumbnails */}
        {sorted.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', textAlign: 'center', fontSize: 13 }}>
              Aucune photo en attente locale.{'\n'}
              {uploadedCount > 0
                ? `${uploadedCount} photo${uploadedCount > 1 ? 's ont' : ' a'} déjà été upload${uploadedCount > 1 ? 'ées' : 'ée'} (le fichier local est supprimé après l'envoi).`
                : 'Lance la détection avec GO ! pour capturer des coureurs.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(it) => it.id}
            numColumns={COLS}
            contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
            columnWrapperStyle={{ gap: GUTTER, marginBottom: GUTTER }}
            renderItem={({ item }) => {
              const failedItem = item.status === 'failed';
              const uploading = item.status === 'uploading';
              return (
                <View style={{ width: cell, height: cell, borderRadius: 8, overflow: 'hidden', backgroundColor: '#222' }}>
                  <Image
                    source={{ uri: item.localUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  {(failedItem || uploading) && (
                    <View style={{
                      position: 'absolute', top: 4, right: 4,
                      paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                      backgroundColor: failedItem ? 'rgba(239,68,68,0.92)' : 'rgba(245,158,11,0.92)',
                    }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                        {failedItem ? 'ÉCHEC' : 'UPLOAD'}
                      </Text>
                    </View>
                  )}
                  {item.isRaw && (
                    <View style={{
                      position: 'absolute', bottom: 4, left: 4,
                      paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
                      backgroundColor: 'rgba(0,0,0,0.65)',
                    }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>RAW</Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        )}

        {/* Footer stats */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28,
          backgroundColor: 'rgba(0,0,0,0.95)',
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <View style={{ flexDirection: 'row', gap: 14, flex: 1, flexWrap: 'wrap' }}>
            <SessionStat label="Total" value={totalSession} color="#fff" />
            <SessionStat label="Uploadées" value={uploadedCount} color="#22C55E" />
            <SessionStat label="En attente" value={inFlight} color="#F59E0B" />
            <SessionStat label="Échouées" value={failed} color="#EF4444" />
          </View>
          {failed > 0 && (
            <TouchableOpacity
              onPress={onRetryAll}
              style={{
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                backgroundColor: 'rgba(255,255,255,0.95)',
              }}
            >
              <Text style={{ color: '#000', fontSize: 12, fontWeight: '700' }}>Réessayer</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SessionStat({ label, value, color }) {
  return (
    <View>
      <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

const formSectionStyle = StyleSheet.create({
  heading: { fontSize: 13, fontWeight: '700', color: C.textSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  input: { backgroundColor: '#faf9ff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, marginBottom: 8 },
});

function CreateEventModal({ visible, onClose, onCreated, organizerSession, editEvent }) {
  const isEdit = !!editEvent;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [eventDate, setEventDate] = useState(null); // Date object | null
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [eventType, setEventType] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [distances, setDistances] = useState([]); // [{km, time, elevation}]
  const [timePickerIdx, setTimePickerIdx] = useState(null);
  const [elevPickerIdx, setElevPickerIdx] = useState(null);
  const [kmPickerIdx, setKmPickerIdx] = useState(null);
  const [coverImage, setCoverImage] = useState(null); // URL distante après upload
  const [pendingCoverLocal, setPendingCoverLocal] = useState(null); // URI locale pendant la création (pas encore d'event)
  const [coverBusy, setCoverBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sheetW, setSheetW] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const [userEditedCode, setUserEditedCode] = useState(false);
  const [showErr, setShowErr] = useState({ 1: false, 2: false, 3: false });

  const parseLocation = (loc = '') => {
    // Format attendu: "Louviers (27400)" ou "Louviers (27)"
    const m = String(loc).match(/^(.+?)\s*\((\d{2,5})\)\s*$/);
    if (m) {
      const city = m[1].trim();
      const code = m[2];
      // Si c'est un code de département (2 chiffres), on n'a pas le code postal complet
      if (code.length === 5) return { city, postalCode: code };
      return { city, postalCode: '' };
    }
    return { city: loc, postalCode: '' };
  };

  useEffect(() => {
    if (visible) {
      setStep(1);
      setAdvancedOpen(false);
      setShowErr({ 1: false, 2: false, 3: false });
      slideX.setValue(0);
      setUserEditedCode(false);
      if (isEdit) {
        setName(editEvent.name || '');
        setCode(editEvent.code || '');
        setPassword('');
        setEventDate(editEvent.event_date ? new Date(editEvent.event_date) : null);
        const { city: cy, postalCode: pc } = parseLocation(editEvent.location || '');
        setPostalCode(pc); setCity(cy); setCitySuggestions([]);
        setEventType(editEvent.event_type || '');
        setWebsite(editEvent.website || '');
        setContact(editEvent.contact || editEvent.org_name || '');
        setPhone(editEvent.phone || '');
        setDistances(Array.isArray(editEvent.distances) ? editEvent.distances.map(d => ({
          km: String(d.km || ''), time: d.time || '', elevation: d.elevation || '',
        })) : []);
        setCoverImage(editEvent.cover_image || null);
        setPendingCoverLocal(null);
      } else {
        setName(''); setCode(''); setPassword('');
        setEventDate(null); setPostalCode(''); setCity(''); setCitySuggestions([]);
        setEventType('');
        setWebsite(''); setContact(''); setPhone(''); setDistances([]);
        setCoverImage(null); setPendingCoverLocal(null);
      }
    }
  }, [visible, isEdit]);

  // Slug auto-généré depuis le nom (création seulement, tant que l'utilisateur ne l'a pas modifié manuellement)
  useEffect(() => {
    if (isEdit || userEditedCode) return;
    const slug = (name || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    setCode(slug);
  }, [name, isEdit, userEditedCode]);

  // Suggestions de villes selon code postal
  useEffect(() => {
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode]);

  const addDistance = () => setDistances(d => [...d, { km: '', time: '', elevation: '' }]);
  const updateDistance = (idx, field, value) => {
    setDistances(d => d.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };
  const removeDistance = (idx) => setDistances(d => d.filter((_, i) => i !== idx));

  // Sélection + upload de l'image de couverture
  const pickAndUploadCover = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Autorisation refusée', 'Active l\'accès à tes photos dans les réglages.');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [16, 9],
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      const localUri = r.assets[0].uri;
      // Si on est en édition, on uploade tout de suite (l'event existe)
      if (isEdit && editEvent?.code) {
        setCoverBusy(true);
        try {
          const res = await fetch(localUri);
          const blob = await res.blob();
          const up = await fetch(`${API_URL}/organizer/cover/${editEvent.code}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'image/jpeg',
              Authorization: `Bearer ${organizerSession.token}`,
            },
            body: blob,
          });
          const data = await up.json();
          if (up.ok) setCoverImage(data.cover_image);
          else Alert.alert('Erreur', data.error || 'Échec de l\'upload');
        } finally { setCoverBusy(false); }
      } else {
        // En création, on garde l'URI locale jusqu'à la soumission
        setPendingCoverLocal(localUri);
      }
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Impossible de sélectionner l\'image');
    }
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contact || '').trim());
  const locationOk = /^\d{5}$/.test(postalCode) && !!city?.trim();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const dateOk = !!eventDate && eventDate >= todayMidnight;
  const distancesOk = distances.length > 0 && distances.every(d => parseFloat(d.km) > 0);
  const step1Ok = !!name?.trim() && !!eventType && dateOk;
  const step2Ok = locationOk && distancesOk;
  const step3Ok = emailOk && (isEdit || (!!code?.trim() && !!password));
  const canSubmit = step1Ok && step2Ok && step3Ok && !busy;

  const goStep = (n) => {
    if (n < 1 || n > 3 || !sheetW) { setStep(n); return; }
    setStep(n);
    Animated.timing(slideX, {
      toValue: -(n - 1) * sheetW,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };
  const tryNext = () => {
    if (step === 1) { if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); return; } goStep(2); return; }
    if (step === 2) { if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); return; } goStep(3); return; }
  };
  const trySubmit = () => {
    if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); goStep(1); return; }
    if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); goStep(2); return; }
    if (!step3Ok) { setShowErr(e => ({ ...e, 3: true })); return; }
    submit();
  };
  const errStyle = { color: '#DC2626', fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const url = isEdit ? `/organizer/event/${editEvent.code}` : `/auth/submit-event`;
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        name,
        contact,
        phone: phone.trim(),
        event_date: eventDate ? eventDate.toISOString().slice(0, 10) : '',
        location: city ? `${city} (${postalCode})` : '',
        event_type: eventType,
        website,
        distances: distances
          .filter(d => d.km)
          .map(d => ({
            km: parseFloat(d.km) || 0,
            time: d.time || '',
            elevation: d.elevation || '',
          })),
      };
      if (!isEdit) {
        payload.code = code;
        payload.password = password;
      }
      const r = await fetch(`${API_URL}${url}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        Alert.alert('Erreur', data.error || 'Échec');
      } else {
        // Si création + cover en attente, on l'uploade maintenant
        if (!isEdit && pendingCoverLocal) {
          try {
            const slug = code.toLowerCase().replace(/\s+/g, '-');
            const res = await fetch(pendingCoverLocal);
            const blob = await res.blob();
            const up = await fetch(`${API_URL}/organizer/cover/${slug}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                Authorization: `Bearer ${organizerSession.token}`,
              },
              body: blob,
            });
            if (!up.ok) {
              const txt = await up.text();
              console.warn('cover upload failed', up.status, txt);
            }
          } catch (e) {
            console.warn('cover upload error', e?.message || e);
          }
        }
        Alert.alert(isEdit ? 'Modifications enregistrées' : 'Demande envoyée', isEdit ? '' : 'Ton événement sera validé sous peu.');
        onCreated?.();
        onClose();
      }
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  const types = ['Trail', 'Course sur route', 'Cross', 'Triathlon', 'Velo', 'Marche', 'Autre'];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: '90%' }]} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            {/* Header : titre + étape */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>{isEdit ? 'Modifier l\'événement' : 'Créer un événement'}</Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Étape {step} sur 3</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Barre de progression */}
            <View style={{ height: 4, backgroundColor: '#e9e4f9', borderRadius: 2, marginBottom: 14 }}>
              <View style={{ height: 4, width: `${(step / 3) * 100}%`, backgroundColor: C.primary, borderRadius: 2 }} />
            </View>

            {/* Wizard slide */}
            <View
              style={{ overflow: 'hidden' }}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w && w !== sheetW) {
                  setSheetW(w);
                  slideX.setValue(-(step - 1) * w);
                }
              }}
            >
              <Animated.View style={{ flexDirection: 'row', width: sheetW * 3, transform: [{ translateX: slideX }] }}>

                {/* ===== STEP 1 : Identité ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Image de couverture</Text>
                    <TouchableOpacity
                      onPress={pickAndUploadCover}
                      disabled={coverBusy}
                      style={{
                        height: 140, borderRadius: 12, backgroundColor: '#faf9ff', marginBottom: 8,
                        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
                        borderWidth: (coverImage || pendingCoverLocal) ? 0 : 1, borderStyle: 'dashed', borderColor: '#d9d4ec',
                      }}
                    >
                      {coverBusy ? (
                        <ActivityIndicator color={C.primary} />
                      ) : (coverImage || pendingCoverLocal) ? (
                        <ExpoImage source={{ uri: pendingCoverLocal || coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      ) : (
                        <>
                          <Text style={{ color: C.textSoft, fontSize: 14, marginBottom: 4 }}>+ Ajouter une image</Text>
                          <Text style={{ color: C.textSoft, fontSize: 11 }}>Format paysage 16:9 recommandé</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {(coverImage || pendingCoverLocal) && !coverBusy && (
                      <TouchableOpacity onPress={pickAndUploadCover} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: 8 }}>
                        <Text style={{ color: C.primary, fontSize: 12, fontWeight: '600' }}>Changer l'image</Text>
                      </TouchableOpacity>
                    )}

                    <Text style={formSectionStyle.heading}>Nom de l'événement *</Text>
                    <TextInput placeholder="Ex : Trail des Violettes" placeholderTextColor={C.textSoft} value={name} onChangeText={setName} style={formSectionStyle.input} />
                    {showErr[1] && !name?.trim() && <Text style={errStyle}>Champ requis</Text>}

                    <Text style={formSectionStyle.heading}>Type d'épreuve *</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {types.map(t => (
                        <TouchableOpacity key={t} onPress={() => setEventType(t)} style={[s.typePill, eventType === t && s.typePillActive]}>
                          <Text style={[s.typePillText, eventType === t && { color: '#fff' }]}>{displayEventType(t)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {showErr[1] && !eventType && <Text style={errStyle}>Sélectionne un type</Text>}

                    <Text style={formSectionStyle.heading}>Date de l'événement *</Text>
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(true)}
                      style={[formSectionStyle.input, { justifyContent: 'center' }]}
                    >
                      <Text style={{ color: eventDate ? C.text : C.textSoft, fontSize: 15 }}>
                        {eventDate ? eventDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : 'Date de l\'événement'}
                      </Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={eventDate || new Date()}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        minimumDate={new Date()}
                        onChange={(_e, selected) => {
                          if (Platform.OS === 'android') setShowDatePicker(false);
                          if (selected) setEventDate(selected);
                        }}
                        locale="fr-FR"
                      />
                    )}
                    {Platform.OS === 'ios' && showDatePicker && (
                      <TouchableOpacity onPress={() => setShowDatePicker(false)} style={{ alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 6 }}>
                        <Text style={{ color: C.primary, fontWeight: '600' }}>OK</Text>
                      </TouchableOpacity>
                    )}
                    {showErr[1] && !dateOk && <Text style={errStyle}>Date requise (pas dans le passé)</Text>}
                  </ScrollView>
                </View>

                {/* ===== STEP 2 : Lieu + Courses ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Lieu</Text>
                    <TextInput
                      placeholder="Code postal *"
                      placeholderTextColor={C.textSoft}
                      value={postalCode}
                      onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                      keyboardType="number-pad"
                      maxLength={5}
                      style={formSectionStyle.input}
                    />
                    {showErr[2] && !/^\d{5}$/.test(postalCode) && <Text style={errStyle}>5 chiffres requis</Text>}
                    {citySuggestions.length > 0 && !city && (
                      <ScrollView
                        style={{ maxHeight: 140, marginBottom: 8, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                        keyboardShouldPersistTaps="handled"
                      >
                        {citySuggestions.map((c) => (
                          <TouchableOpacity
                            key={c}
                            onPress={() => { setCity(c); setCitySuggestions([]); }}
                            style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                          >
                            <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                    {city ? (
                      <TouchableOpacity
                        onPress={() => setCity('')}
                        style={[formSectionStyle.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                      >
                        <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                        <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                      </TouchableOpacity>
                    ) : null}
                    {showErr[2] && !city?.trim() && <Text style={errStyle}>Ville requise</Text>}

                    <Text style={formSectionStyle.heading}>Courses *</Text>
                    {distances.map((d, idx) => (
                      <View key={idx} style={{ backgroundColor: '#faf9ff', borderRadius: 12, padding: 10, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DISTANCE</Text>
                            <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.km ? C.text : C.textSoft, fontSize: 15 }}>{d.km ? `${d.km} km` : '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉPART</Text>
                            <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.time ? C.text : C.textSoft, fontSize: 15 }}>{d.time || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1.2 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉNIVELÉ</Text>
                            <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.elevation ? C.text : C.textSoft, fontSize: 15 }}>{d.elevation || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                          <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={addDistance}
                      style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 12, backgroundColor: '#f5f3ff', marginBottom: 8 }}
                    >
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>+ Ajouter une course</Text>
                    </TouchableOpacity>
                    {showErr[2] && distances.length === 0 && <Text style={errStyle}>Au moins 1 course requise</Text>}
                    {showErr[2] && distances.length > 0 && !distances.every(d => parseFloat(d.km) > 0) && (
                      <Text style={errStyle}>Distance &gt; 0 requise pour chaque course</Text>
                    )}
                  </ScrollView>
                </View>

                {/* ===== STEP 3 : Contact + Avancé ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Contact</Text>
                    <TextInput placeholder="Site web (optionnel)" placeholderTextColor={C.textSoft} value={website} onChangeText={setWebsite} autoCapitalize="none" style={formSectionStyle.input} />
                    <TextInput placeholder="Email de contact *" placeholderTextColor={C.textSoft} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    {showErr[3] && !emailOk && <Text style={errStyle}>Email invalide</Text>}
                    <TextInput placeholder="Téléphone de contact (optionnel)" placeholderTextColor={C.textSoft} value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={formSectionStyle.input} />


                    {!isEdit && (
                      <>
                        <TouchableOpacity onPress={() => setAdvancedOpen(o => !o)} style={{ marginTop: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ color: C.primary, fontWeight: '700', fontSize: 13 }}>{advancedOpen ? '−' : '+'} Avancé</Text>
                          <Text style={{ color: C.textSoft, fontSize: 11, marginLeft: 8 }}>Code et mot de passe photographe</Text>
                        </TouchableOpacity>
                        {advancedOpen && (
                          <View>
                            <TextInput
                              placeholder="Code unique (ex : trail-2027) *"
                              placeholderTextColor={C.textSoft}
                              value={code}
                              onChangeText={(v) => { setCode(v); setUserEditedCode(true); }}
                              autoCapitalize="none"
                              style={formSectionStyle.input}
                            />
                            <Text style={{ color: C.textSoft, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 }}>
                              Auto-généré depuis le nom · modifiable
                            </Text>
                            {showErr[3] && !code?.trim() && <Text style={errStyle}>Code requis</Text>}
                            <TextInput
                              placeholder="Mot de passe photographe *"
                              placeholderTextColor={C.textSoft}
                              value={password}
                              onChangeText={setPassword}
                              secureTextEntry
                              style={formSectionStyle.input}
                            />
                            {showErr[3] && !password && <Text style={errStyle}>Mot de passe requis</Text>}
                          </View>
                        )}
                        {!advancedOpen && showErr[3] && (!code?.trim() || !password) && (
                          <Text style={errStyle}>Ouvre la section Avancé pour compléter code + mot de passe</Text>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>

              </Animated.View>
            </View>

            {/* Bottom nav : Précédent / Suivant ou Enregistrer */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {step > 1 && (
                <TouchableOpacity
                  onPress={() => goStep(step - 1)}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                >
                  <Text style={{ color: C.primary, fontSize: 15, fontWeight: '700' }}>Précédent</Text>
                </TouchableOpacity>
              )}
              {step < 3 ? (
                <TouchableOpacity
                  onPress={tryNext}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Suivant</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={trySubmit}
                  disabled={busy}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{isEdit ? 'Enregistrer' : 'Soumettre'}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>

      {/* Picker Heure */}
      <Modal visible={timePickerIdx !== null} transparent animationType="slide" onRequestClose={() => setTimePickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setTimePickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Heure de départ</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>HEURES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/^(\d{1,2})h(\d{2})?/);
                    const curH = m ? parseInt(m[1], 10) : -1;
                    const active = curH === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/h(\d{2})/);
                          const min = m2 ? m2[1] : '00';
                          updateDistance(timePickerIdx, 'time', `${h}h${min}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{h}h</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>MINUTES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const min = i * 5;
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/h(\d{2})/);
                    const curM = m ? parseInt(m[1], 10) : -1;
                    const active = curM === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/^(\d{1,2})h/);
                          const h = m2 ? m2[1] : '9';
                          updateDistance(timePickerIdx, 'time', `${h}h${String(min).padStart(2, '0')}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{String(min).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity onPress={() => setTimePickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Dénivelé */}
      <Modal visible={elevPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setElevPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setElevPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Dénivelé positif</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>Par incréments de 10 m</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 301 }).map((_, i) => {
                const m = i * 10;
                const cur = distances[elevPickerIdx]?.elevation || '';
                const curM = parseInt((cur.match(/(\d+)/) || [])[1], 10);
                const active = curM === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => {
                      updateDistance(elevPickerIdx, 'elevation', `${m}m D+`);
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{m} m</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setElevPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Distance (km) */}
      <Modal visible={kmPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setKmPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKmPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Distance</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>De 1 à 200 km</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const km = i + 1;
                const cur = distances[kmPickerIdx]?.km || '';
                const curKm = parseFloat(cur);
                const active = curKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    onPress={() => {
                      updateDistance(kmPickerIdx, 'km', String(km));
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setKmPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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

          <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4 }]}>
            Organisation
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 20 }}>
            Choisis ton espace
          </Text>

          {/* Carte Espace organisateur */}
          <TouchableOpacity
            onPress={() => onPickRole('organizer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.pinkPill,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.Events color="#fff" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace organisateur</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Crée et gère tes événements</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>

          {/* Carte Espace photographe */}
          <TouchableOpacity
            onPress={() => onPickRole('photographer')}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#faf9ff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: C.primary,
              alignItems: 'center', justifyContent: 'center',
              marginRight: 14,
            }}>
              <Icon.PhotoCam size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>Espace photographe</Text>
              <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Capture les coureurs en direct</Text>
            </View>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="m9 6 6 6-6 6" stroke={C.textSoft} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const BIOMETRIC_CONSENT_KEY = '@will_biometric_consent_v1';

// Sous-modal : viewport caméra custom avec masque rond circulaire.
// Caméra avant en Vision Camera : grand angle natif explicite + viewport
// dimensionné au ratio 4:3 du capteur pour éviter le crop/zoom apparent
// causé par le cover-fill sur écran 9:19.5. Le cercle est purement visuel
// (overlay SVG), il ne crope pas la preview ; l'image sauvée est l'image
// native non rognée (le crop carré final reste à faire au save côté upload).
function SelfieCameraModal({ visible, onClose, onCaptured }) {
  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front', {
    physicalDevices: ['wide-angle-camera'],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !hasPermission) {
      requestPermission();
    }
  }, [visible, hasPermission]);

  const winW = Dimensions.get('window').width;
  const winH = Dimensions.get('window').height;
  const previewH = winW * (4 / 3);
  const previewTop = Math.max(0, (winH - previewH) / 2 - 40);
  const OVAL_W = 260;
  const OVAL_H = 340;
  const cx = winW / 2;
  const cy = previewTop + previewH / 2;
  // Approximation safe-area bas : home indicator iOS ~34, +24 demandés.
  const bottomInset = Platform.OS === 'ios' ? 58 : 32;

  const captureScale = useRef(new Animated.Value(1)).current;
  const onCapturePressIn = () => {
    Animated.spring(captureScale, { toValue: 0.92, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onCapturePressOut = () => {
    Animated.spring(captureScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const shoot = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: 'off',
        enableShutterSound: true,
      });
      const path = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      onCaptured?.(path);
    } catch (e) {
      Alert.alert('Erreur', e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {hasPermission && device ? (
          <VisionCamera
            ref={cameraRef}
            style={{
              position: 'absolute',
              top: previewTop,
              left: 0, right: 0,
              height: previewH,
            }}
            device={device}
            isActive={visible}
            photo={true}
            zoom={device.minZoom}
            resizeMode="cover"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={{ color: '#fff', fontSize: 15, textAlign: 'center', marginBottom: 16 }}>
              {!device
                ? "Aucune caméra avant disponible sur cet appareil."
                : "Will a besoin d'accéder à la caméra pour prendre ton selfie."}
            </Text>
            {!hasPermission && (
              <TouchableOpacity onPress={requestPermission} style={s.btnPrimary}>
                <Text style={s.btnPrimaryText}>Autoriser</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Voile semi-transparent plein écran avec trou ovale au centre.
            Pas de bordure : la forme est définie par le contraste entre la
            zone visible et le voile. */}
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Mask id="selfieMask">
              <Rect width="100%" height="100%" fill="white" />
              <Ellipse cx={cx} cy={cy} rx={OVAL_W / 2} ry={OVAL_H / 2} fill="black" />
            </Mask>
          </Defs>
          <Rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#selfieMask)" />
        </Svg>

        <Text style={{
          position: 'absolute',
          top: cy + OVAL_H / 2 + 24,
          left: 0, right: 0, textAlign: 'center',
          color: '#fff', fontSize: 14, fontWeight: '600',
          textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4,
        }}>
          Place ton visage dans l'ovale
        </Text>

        {/* Bouton capture centré, style iOS Camera : blanc plein, sans bordure. */}
        <View style={{
          position: 'absolute',
          bottom: bottomInset,
          left: 0, right: 0,
          alignItems: 'center',
        }}>
          <Animated.View style={{ transform: [{ scale: captureScale }] }}>
            <TouchableOpacity
              onPress={shoot}
              onPressIn={onCapturePressIn}
              onPressOut={onCapturePressOut}
              disabled={busy || !hasPermission || !device}
              activeOpacity={1}
              style={{
                width: 80, height: 80, borderRadius: 999,
                backgroundColor: '#fff',
                opacity: busy || !hasPermission || !device ? 0.4 : 1,
              }}
            />
          </Animated.View>
        </View>

        {/* Croix fermer en bas droite, au même niveau vertical que le bouton capture. */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={10}
          style={{
            position: 'absolute',
            bottom: bottomInset + 16,
            right: 24,
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: 'rgba(255,255,255,0.15)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function SelfieModal({ visible, onClose, onSaved, userId, runnerToken }) {
  const [uri, setUri] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Consentement biométrique RGPD art. 9 : on demande explicitement la 1ère fois
  // et on persiste la date d'acceptation (révocable via suppression du selfie).
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(null); // null = en cours de chargement, true/false sinon

  useEffect(() => {
    if (!visible) return;
    Secure.getItem(BIOMETRIC_CONSENT_KEY).then(v => {
      setConsentGiven(!!v);
      setConsentChecked(false);
    });
  }, [visible]);

  const acceptConsent = async () => {
    if (!consentChecked) return;
    await Secure.setItem(BIOMETRIC_CONSENT_KEY, new Date().toISOString());
    setConsentGiven(true);
  };

  const take = () => {
    setCameraOpen(true);
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
      // 1. Sauvegarde locale (réactivité immédiate)
      await AsyncStorage.setItem('@will_selfie', uri);
      onSaved?.(uri);

      // 2. Upload sur R2 pour la reconnaissance faciale (en background, non bloquant)
      // Auth runner obligatoire : le worker exige Bearer + match userId === token.userId
      if (userId && runnerToken) {
        (async () => {
          try {
            const blob = await (await fetch(uri)).blob();
            await fetch(`${API_URL}/selfie/${userId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                Authorization: `Bearer ${runnerToken}`,
              },
              body: blob,
            });
          } catch (e) {
            console.warn('selfie upload R2', e);
          }
        })();
      }

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

          {consentGiven === false ? (
            <>
              <Text style={s.modalTitle}>Reconnaissance faciale</Text>
              <Text style={[s.modalSub, { textAlign: 'left', lineHeight: 20 }]}>
                Pour t'envoyer automatiquement tes photos d'événement, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées, stockées sur des serveurs européens, et supprimées 30 jours après ton dernier événement.{'\n\n'}
                Tu peux retirer ton consentement à tout moment en supprimant ton selfie depuis l'app.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL('https://will-app.com/privacy').catch(() => {})}
                style={{ marginBottom: 16, alignSelf: 'flex-start' }}
                hitSlop={10}
              >
                <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
                  Lire la Politique de confidentialité
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setConsentChecked(c => !c)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 }}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                  borderColor: consentChecked ? C.primary : '#bbb',
                  backgroundColor: consentChecked ? C.primary : 'transparent',
                  marginRight: 10, marginTop: 2, alignItems: 'center', justifyContent: 'center',
                }}>
                  {consentChecked ? (
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path d="m5 12 5 5L20 7" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  ) : null}
                </View>
                <Text style={{ flex: 1, color: C.text, fontSize: 14, lineHeight: 19 }}>
                  J'accepte le traitement biométrique de mon image (RGPD art. 9).
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, !consentChecked && { opacity: 0.4 }]}
                onPress={acceptConsent}
                disabled={!consentChecked}
              >
                <Text style={s.btnPrimaryText}>Continuer</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
          <Text style={s.modalTitle}>Mon selfie</Text>
          <Text style={s.modalSub}>Ton selfie est utilisé pour la reconnaissance faciale. Il est chiffré, stocké sur des serveurs européens, et supprimé automatiquement 30 jours après ton dernier événement.</Text>

          <View style={s.selfiePreviewWrap}>
            {uri ? (
              <ExpoImage source={{ uri }} style={s.selfiePreview} contentFit="cover" />
            ) : (
              <View style={[s.selfiePreview, { backgroundColor: C.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                <Icon.User size={80} color={C.primary} />
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
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>

      <SelfieCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(capturedUri) => {
          setUri(capturedUri);
          setCameraOpen(false);
        }}
      />
    </Modal>
  );
}

function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Reset flow (organisateur uniquement) : 'login' → 'reset-request' → 'reset-verify'
  const [resetMode, setResetMode] = useState('login');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode(''); setPassword('');
      setResetMode('login'); setResetCode(''); setResetNewPassword('');
    }
  }, [visible]);

  const upcoming = events.filter(e => isUpcoming(e.event_date));

  const submit = async () => {
    if (!code) return Alert.alert('Événement requis', role === 'photographer' ? 'Choisis un événement.' : 'Entre le code.');
    if (!password) return Alert.alert('Mot de passe requis');
    setBusy(true);
    const r = await api.login(code.trim(), password.trim(), role, 'photographer');
    setBusy(false);
    if (!r?.token) return Alert.alert('Échec', 'Identifiants invalides.');
    onSuccess(r);
  };

  const requestReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!slug) return Alert.alert('Code requis', 'Saisis le code de ton événement avant de demander un reset.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/request-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data.error || 'Impossible d\'envoyer le code.');
        return;
      }
      setResetMode('reset-verify');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  const verifyReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!resetCode.trim()) return Alert.alert('Code requis', 'Saisis le code reçu par email.');
    if (!resetNewPassword || resetNewPassword.length < 4) return Alert.alert('Mot de passe trop court', '4 caractères minimum.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/verify-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug, reset_code: resetCode.trim(), new_password: resetNewPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Échec', data.error || 'Code invalide.');
        return;
      }
      // Mdp réinitialisé : on prépare l'auto-fill et on reviens à login
      setPassword(resetNewPassword);
      setResetMode('login');
      setResetCode(''); setResetNewPassword('');
      Alert.alert('Mot de passe réinitialisé', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            <Text style={[s.welcome, { color: role === 'photographer' ? C.pinkPill : C.primary, fontSize: 22, marginBottom: 4, marginTop: 4 }]}>
              {role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}
            </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18 }}>
              {role === 'photographer' ? 'Sélectionne ton événement et entre ton mot de passe' : 'Connecte-toi à ton événement'}
            </Text>

            {role === 'photographer' ? (
              <>
                <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Événement</Text>
                <ScrollView style={{ maxHeight: 260, marginBottom: 12 }}>
                  {upcoming.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: C.textSoft, fontSize: 13 }}>Aucun événement à venir</Text>
                    </View>
                  )}
                  {(code ? upcoming.filter(e => e.code === code) : upcoming).map(e => {
                    const active = code === e.code;
                    return (
                      <TouchableOpacity
                        key={e.code}
                        onPress={() => setCode(active ? '' : e.code)}
                        activeOpacity={0.85}
                        style={{
                          backgroundColor: active ? C.pinkPill : '#faf9ff',
                          borderRadius: 12,
                          padding: 14,
                          marginBottom: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: active ? '#fff' : C.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{e.name}</Text>
                          <Text style={{ color: active ? 'rgba(255,255,255,0.85)' : C.textSoft, fontSize: 11, marginTop: 2 }}>
                            {formatDateLong(e.event_date)}{e.location ? ` · ${cityLabel(e.location)}` : ''}
                          </Text>
                        </View>
                        {active && (
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                              <Path d="M5 12l5 5L20 7" stroke={C.pinkPill} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                            </Svg>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {code ? (
                  <>
                    <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Mot de passe</Text>
                    <TextInput
                      placeholder="Mot de passe photographe"
                      placeholderTextColor={C.textSoft}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoFocus
                      style={formSectionStyle.input}
                    />
                  </>
                ) : null}
              </>
            ) : resetMode !== 'login' ? (
              <>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
                  {resetMode === 'reset-request' ? 'Réinitialiser ton mot de passe' : 'Vérifier le code reçu'}
                </Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 14 }}>
                  {resetMode === 'reset-request'
                    ? `Un code à 6 chiffres sera envoyé à l'email enregistré pour cet événement.`
                    : `Code envoyé à l'email de l'organisateur. Valable 15 minutes.`}
                </Text>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  editable={resetMode === 'reset-request'}
                  style={[formSectionStyle.input, resetMode !== 'reset-request' && { opacity: 0.6 }]}
                />
                {resetMode === 'reset-verify' && (
                  <>
                    <TextInput
                      placeholder="Code reçu (6 chiffres)"
                      placeholderTextColor={C.textSoft}
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      style={formSectionStyle.input}
                    />
                    <TextInput
                      placeholder="Nouveau mot de passe"
                      placeholderTextColor={C.textSoft}
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                      secureTextEntry
                      style={formSectionStyle.input}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  style={formSectionStyle.input}
                />
                <TextInput
                  placeholder="Mot de passe"
                  placeholderTextColor={C.textSoft}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={formSectionStyle.input}
                />
                <TouchableOpacity
                  onPress={() => setResetMode('reset-request')}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginTop: -4, marginBottom: 4 }}
                >
                  <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
                </TouchableOpacity>
              </>
            )}

            {resetMode !== 'login' ? (
              <>
                <TouchableOpacity
                  onPress={resetMode === 'reset-request' ? requestReset : verifyReset}
                  disabled={resetBusy || (resetMode === 'reset-request' ? !code : (!resetCode || !resetNewPassword))}
                  style={{
                    backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14,
                    alignItems: 'center', marginTop: 8,
                    opacity: resetBusy ? 0.7 : 1,
                  }}
                >
                  {resetBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      {resetMode === 'reset-request' ? 'M\'envoyer un code' : 'Réinitialiser le mot de passe'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setResetMode('login'); setResetCode(''); setResetNewPassword(''); }}
                  hitSlop={6}
                  style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}
                >
                  <Text style={{ color: C.textSoft, fontSize: 13 }}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code || !password}
                style={{
                  backgroundColor: (code && password) ? C.primary : '#e9e4f9',
                  paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
                }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: (code && password) ? '#fff' : C.textSoft, fontSize: 15, fontWeight: '700' }}>Continuer</Text>}
              </TouchableOpacity>
            )}
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
function ProfileMenuModal({ visible, onClose, selfieUri, onView, onRetake, onDelete, runnerSession, onLogout, onLogin, onUpdateProfile, onDeleteAccount }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const profile = runnerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await fetch(`${API_URL}/runner/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runnerSession.token}` },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setCurrentPwd(''); setNewPwd(''); setPwdConfirm('');
      setChangingPwd(false);
      Alert.alert('Mot de passe modifié', 'Ton nouveau mot de passe est actif.');
    } catch (e) {
      setPwdError('Erreur réseau');
    } finally {
      setPwdBusy(false);
    }
  };

  // Parse "27400 Louviers" → postalCode "27400", city "Louviers"
  const parseDept = (str = '') => {
    const m = String(str).match(/^(\d{5})\s+(.+)$/);
    return m ? { postalCode: m[1], city: m[2] } : { postalCode: '', city: str };
  };

  // Pré-remplit les champs en mode édition
  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
      const { postalCode: pc, city: cy } = parseDept(profile.department);
      setPostalCode(pc);
      setCity(cy);
    }
  }, [editing, profile]);

  // Suggestions ville
  useEffect(() => {
    if (!editing) return;
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setCitySuggestions((data || []).map(c => c.nom));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdateProfile?.({
        firstName,
        lastName,
        department: `${postalCode} ${city}`.trim(),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* En-tête */}
            {profile ? (
              <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                Hello {profile.firstName}
              </Text>
            ) : (
              <View style={{ alignItems: 'center', marginVertical: 12 }}>
                <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>
                  Connecte-toi pour retrouver tes photos sur tous tes appareils
                </Text>
                <TouchableOpacity
                  style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 }}
                  onPress={() => { onClose(); onLogin?.(); }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Se connecter / S'inscrire</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bloc Selfie */}
            {profile && (
              <View style={profileCardStyles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => { onClose(); onRetake(); }}
                    style={{ width: 56, height: 56 }}
                    hitSlop={6}
                  >
                    {selfieUri ? (
                      <ExpoImage
                        source={{ uri: selfieUri }}
                        style={{ width: 56, height: 56, borderRadius: 999 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{
                        width: 56, height: 56, borderRadius: 999,
                        backgroundColor: C.primaryLight,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon.User size={28} color={C.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                  <Text style={profileCardStyles.label}>Selfie</Text>
                  <View style={{ flex: 1 }} />
                  {!selfieUri ? (
                    <TouchableOpacity onPress={() => { onClose(); onRetake(); }}>
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Ajouter</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 18 }}>
                      <TouchableOpacity onPress={onView}>
                        <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Voir</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { onClose(); onDelete(); }}>
                        <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Supprimer</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Bloc Infos */}
            {profile && !editing && (
              <View style={profileCardStyles.card}>
                <InfoRow label="Prénom" value={profile.firstName} />
                <InfoRow label="Nom" value={profile.lastName} />
                <InfoRow label="Email" value={profile.email} />
                <InfoRow label="Ville" value={profile.department} last />
                <TouchableOpacity
                  onPress={() => setEditing(true)}
                  style={{ marginTop: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bloc Édition */}
            {profile && editing && (
              <View style={profileCardStyles.card}>
                <TextInput
                  placeholder="Prénom" placeholderTextColor={C.textSoft}
                  value={firstName} onChangeText={setFirstName}
                  style={authStyles.input}
                />
                <TextInput
                  placeholder="Nom" placeholderTextColor={C.textSoft}
                  value={lastName} onChangeText={setLastName}
                  style={authStyles.input}
                />
                <TextInput
                  placeholder="Code postal" placeholderTextColor={C.textSoft}
                  value={postalCode}
                  onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                  keyboardType="number-pad" maxLength={5}
                  style={authStyles.input}
                />
                {citySuggestions.length > 0 && !city && (
                  <ScrollView
                    style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                    keyboardShouldPersistTaps="handled"
                  >
                    {citySuggestions.map((c) => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => { setCity(c); setCitySuggestions([]); }}
                        style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                      >
                        <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                {city ? (
                  <TouchableOpacity
                    onPress={() => setCity('')}
                    style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                  >
                    <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                    <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setEditing(false)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                  >
                    <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={save} disabled={busy}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: busy ? 0.6 : 1 }}
                  >
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Enregistrer</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {profile && !editing && !changingPwd && (
              <TouchableOpacity onPress={() => setChangingPwd(true)} style={{ alignItems: 'center', marginTop: 6, paddingVertical: 10 }}>
                <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
              </TouchableOpacity>
            )}

            {profile && changingPwd && (
              <View style={profileCardStyles.card}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                  Changer mon mot de passe
                </Text>
                <PasswordInput
                  placeholder="Mot de passe actuel" placeholderTextColor={C.textSoft}
                  value={currentPwd} onChangeText={setCurrentPwd}
                  style={authStyles.input}
                />
                <PasswordInput
                  placeholder="Nouveau mot de passe (10 car. min)" placeholderTextColor={C.textSoft}
                  value={newPwd} onChangeText={setNewPwd}
                  style={authStyles.input}
                />
                <PasswordInput
                  placeholder="Confirmer le nouveau" placeholderTextColor={C.textSoft}
                  value={pwdConfirm} onChangeText={setPwdConfirm}
                  style={authStyles.input}
                />
                {pwdError ? <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 4 }}>{pwdError}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => { setChangingPwd(false); setCurrentPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                  >
                    <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={submitPwd} disabled={pwdBusy}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: pwdBusy ? 0.6 : 1 }}
                  >
                    {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Modifier</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {profile && (
              <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
                <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
              </TouchableOpacity>
            )}

            {profile && onDeleteAccount && (
              <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                  Supprimer mon compte
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: '#f0eaff',
    }}>
      <Text style={{ color: C.textSoft, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'right' }} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

function OrganizerProfileMenuModal({ visible, onClose, organizerSession, onLogout, onUpdate, onDeleteAccount }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const profile = organizerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await fetch(`${API_URL}/organizer/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${organizerSession.token}` },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      const data = await r.json();
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setOldPwd(''); setNewPwd(''); setPwdConfirm('');
      setChangingPwd(false);
      Alert.alert('Mot de passe modifié', 'Ton nouveau mot de passe est actif.');
    } catch (e) {
      setPwdError('Erreur réseau');
    } finally {
      setPwdBusy(false);
    }
  };

  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
    }
  }, [editing, profile]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdate?.({ firstName, lastName });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {profile && (
                <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                  Hello {profile.firstName}
                </Text>
              )}

              {profile && !editing && (
                <View style={profileCardStyles.card}>
                  <InfoRow label="Prénom" value={profile.firstName} />
                  <InfoRow label="Nom" value={profile.lastName} />
                  <InfoRow label="Email" value={profile.email} last />
                  <TouchableOpacity onPress={() => setEditing(true)} style={{ marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                  </TouchableOpacity>
                </View>
              )}

              {profile && editing && (
                <View style={profileCardStyles.card}>
                  <TextInput
                    placeholder="Prénom" placeholderTextColor={C.textSoft}
                    value={firstName} onChangeText={setFirstName}
                    style={authStyles.input}
                  />
                  <TextInput
                    placeholder="Nom" placeholderTextColor={C.textSoft}
                    value={lastName} onChangeText={setLastName}
                    style={authStyles.input}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => setEditing(false)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={save} disabled={busy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: busy ? 0.6 : 1 }}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Enregistrer</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && !editing && !changingPwd && (
                <TouchableOpacity onPress={() => setChangingPwd(true)} style={{ alignItems: 'center', marginTop: 6, paddingVertical: 10 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
                </TouchableOpacity>
              )}

              {profile && changingPwd && (
                <View style={profileCardStyles.card}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                    Changer mon mot de passe
                  </Text>
                  <PasswordInput
                    placeholder="Ancien mot de passe" placeholderTextColor={C.textSoft}
                    value={oldPwd} onChangeText={setOldPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Nouveau mot de passe (10 car. min)" placeholderTextColor={C.textSoft}
                    value={newPwd} onChangeText={setNewPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Confirmer le nouveau" placeholderTextColor={C.textSoft}
                    value={pwdConfirm} onChangeText={setPwdConfirm}
                    style={authStyles.input}
                  />
                  {pwdError ? <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 4 }}>{pwdError}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => { setChangingPwd(false); setOldPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitPwd} disabled={pwdBusy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: pwdBusy ? 0.6 : 1 }}
                    >
                      {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Modifier</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && (
                <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
                  <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
                </TouchableOpacity>
              )}

              {profile && onDeleteAccount && (
                <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                  <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                    Supprimer mon compte
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const profileCardStyles = StyleSheet.create({
  card: { backgroundColor: '#faf9ff', borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { color: C.text, fontSize: 16, fontWeight: '600' },
});

function SelfieViewerModal({ visible, uri, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' }}>
        <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 60, right: 20, padding: 10 }} hitSlop={20}>
          <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
            <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
        {uri ? (
          <ExpoImage source={{ uri }} style={{ width: '85%', aspectRatio: 1, borderRadius: 999 }} contentFit="cover" />
        ) : null}
      </View>
    </Modal>
  );
}

function PhotoViewerModal({ visible, photo, photos, onClose, allowDelete, onDelete, photoFavoritesSet, onTogglePhotoFavorite }) {
  const [busy, setBusy] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const winWidth = Dimensions.get('window').width;
  const winHeight = Dimensions.get('window').height;

  // Animations partagées
  const translateX = useSharedValue(0);  // déplacement horizontal du rail
  const translateY = useSharedValue(0);  // déplacement vertical (close swipe)
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const savedTranslateY = useSharedValue(0);
  const zoomTranslateX = useSharedValue(0); // pour pan en mode zoom uniquement
  const savedZoomTranslateX = useSharedValue(0);
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));

  const resetTransforms = () => {
    translateX.value = 0;
    translateY.value = 0;
    scale.value = 1;
    savedScale.value = 1;
    savedTranslateY.value = 0;
    zoomTranslateX.value = 0;
    savedZoomTranslateX.value = 0;
  };

  // À chaque ouverture du viewer, on synchronise l'index et reset
  useEffect(() => {
    if (!visible) return;
    if (photo && photos) {
      const i = photos.findIndex(p => p.id === photo.id);
      if (i >= 0) setCurrentIndex(i);
    }
    resetTransforms();
  }, [visible]);

  // Reset uniquement zoom au changement d'index (pas translateX qui est géré par l'anim)
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    zoomTranslateX.value = 0;
    savedZoomTranslateX.value = 0;
    translateY.value = 0;
    savedTranslateY.value = 0;
  }, [currentIndex]);

  // Refs pour callbacks stables
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const goToNext = () => {
    const i = currentIndexRef.current + 1;
    if (photos && i < photos.length) {
      setCurrentIndex(i);
      // Repositionne le rail instantanément (sans transition) pour que la nouvelle "current" soit centrée
      translateX.value = 0;
    } else {
      // Pas de suivante : retour
      translateX.value = withTiming(0, { duration: 200 });
    }
  };
  const goToPrev = () => {
    const i = currentIndexRef.current - 1;
    if (i >= 0) {
      setCurrentIndex(i);
      translateX.value = 0;
    } else {
      translateX.value = withTiming(0, { duration: 200 });
    }
  };

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Zoom actif : pan déplace l'image (sur les axes X et Y)
        zoomTranslateX.value = savedZoomTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else {
        // Mode normal : swipe horizontal du rail OU swipe vertical pour fermer
        if (Math.abs(e.translationY) > Math.abs(e.translationX)) {
          translateY.value = e.translationY;
          translateX.value = 0;
        } else {
          translateX.value = e.translationX;
          translateY.value = 0;
        }
      }
    })
    .onEnd((e) => {
      if (scale.value > 1) {
        savedZoomTranslateX.value = zoomTranslateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      const dx = e.translationX;
      const dy = e.translationY;
      // Swipe vertical (fermeture) : amplitude > 100px
      if (Math.abs(dy) > 100 && Math.abs(dy) > Math.abs(dx)) {
        runOnJS(onClose)();
        translateY.value = withTiming(0, { duration: 200 });
        return;
      }
      // Swipe horizontal : changer photo (animation continue jusqu'à ±winWidth)
      if (Math.abs(dx) > 80) {
        const direction = dx < 0 ? -1 : 1;
        const targetX = direction * winWidth;
        translateX.value = withTiming(targetX, { duration: 220 }, (finished) => {
          if (finished) {
            if (direction < 0) {
              runOnJS(goToNext)();
            } else {
              runOnJS(goToPrev)();
            }
          }
        });
        return;
      }
      // Swipe pas assez ample : retour à 0
      translateX.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(0, { duration: 200 });
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, savedScale.value * e.scale);
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withTiming(1);
        zoomTranslateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedZoomTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  // Style du rail entier (3 photos): bouge en X selon swipe, en Y selon close
  const railStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  // Style de la photo current (pour zoom + pan en mode zoom)
  const currentImgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: zoomTranslateX.value },
      { scale: scale.value },
    ],
  }));

  const currentPhoto = photos?.[currentIndex] || photo;
  const prevPhoto = photos?.[currentIndex - 1];
  const nextPhoto = photos?.[currentIndex + 1];

  const download = async () => {
    if (!currentPhoto?.uri || busy) return;
    setBusy(true);
    let staged = null;
    try {
      // Permission iOS : write-only suffit pour ajouter à la pellicule (moins invasif).
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert('Permission refusée', 'Autorise l\'accès aux photos pour sauvegarder dans la pellicule.');
        return;
      }

      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) {
        Alert.alert('Hors ligne', 'Pas de connexion internet — impossible de télécharger la photo.');
        return;
      }

      const url = currentPhoto.uri;
      const ext = await detectPhotoExtension(url);
      const filename = `will_${Date.now()}.${ext}`;
      staged = new File(Paths.cache, filename);
      const downloaded = await File.downloadFileAsync(url, staged, { idempotent: true });
      const localUri = downloaded?.uri || staged.uri;

      try {
        await MediaLibrary.saveToLibraryAsync(localUri);
        Alert.alert('Photo sauvegardée', 'Disponible dans ta pellicule Photos.');
      } catch (saveErr) {
        // ProRAW (.dng) : la pellicule peut refuser sur certains iOS.
        if (ext === 'dng') {
          Alert.alert(
            'Format DNG non supporté',
            'La pellicule iOS n\'accepte pas ce fichier RAW. Demande au photographe une version JPEG.'
          );
        } else {
          throw saveErr;
        }
      }
    } catch (e) {
      const msg = e?.message || '';
      const friendly =
        /Network|network|ENOTFOUND|ECONN|timeout|UnableToDownload/i.test(msg)
          ? 'Échec du téléchargement — vérifie ta connexion et réessaie.'
          : (msg || 'Impossible de sauvegarder');
      Alert.alert('Erreur', friendly);
    } finally {
      try { if (staged?.exists) staged.delete(); } catch {}
      setBusy(false);
    }
  };

  const deleteCurrent = () => {
    if (!currentPhoto?.id) return;
    Alert.alert(
      'Supprimer cette photo ?',
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            onDelete?.([currentPhoto.id]);
            if (photos && photos.length > 1) {
              if (currentIndex >= photos.length - 1) {
                setCurrentIndex(currentIndex - 1);
              }
            } else {
              onClose();
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#000', overflow: 'hidden' }}>
          <TouchableOpacity onPress={onClose} style={{ position: 'absolute', top: 60, right: 20, padding: 10, zIndex: 10 }} hitSlop={20}>
            <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>

          {onTogglePhotoFavorite && currentPhoto?.id && (() => {
            const fav = photoFavoritesSet?.has(currentPhoto.id);
            return (
              <ReAnimated.View style={[{ position: 'absolute', top: 60, right: 80, zIndex: 10 }, heartStyle]}>
                <TouchableOpacity
                  onPress={() => {
                    heartScale.value = withTiming(0.85, { duration: 90 }, () => {
                      heartScale.value = withTiming(1, { duration: 140 });
                    });
                    onTogglePhotoFavorite(currentPhoto.id);
                  }}
                  hitSlop={12}
                  style={{
                    width: 44, height: 44,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Svg width={26} height={23} viewBox="-1 -1.5 22.78 20.61"
                    fill={fav ? '#fff' : 'none'}
                    stroke="#fff" strokeWidth={1.6}>
                    <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
                  </Svg>
                </TouchableOpacity>
              </ReAnimated.View>
            );
          })()}

          {photos && photos.length > 1 && (
            <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', zIndex: 10 }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                  {currentIndex + 1} / {photos.length}
                </Text>
              </View>
            </View>
          )}

          <GestureDetector gesture={composed}>
            <ReAnimated.View style={[{ flex: 1, flexDirection: 'row' }, railStyle]}>
              {/* Précédente : positionnée à gauche du rail */}
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: -winWidth, width: winWidth, alignItems: 'center', justifyContent: 'center' }}>
                {prevPhoto?.uri ? (
                  <ExpoImage source={{ uri: prevPhoto.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                ) : null}
              </View>
              {/* Actuelle */}
              <ReAnimated.View style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: winWidth, alignItems: 'center', justifyContent: 'center' }, currentImgStyle]}>
                {currentPhoto?.uri ? (
                  <ExpoImage source={{ uri: currentPhoto.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                ) : null}
              </ReAnimated.View>
              {/* Suivante : positionnée à droite du rail */}
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: winWidth, width: winWidth, alignItems: 'center', justifyContent: 'center' }}>
                {nextPhoto?.uri ? (
                  <ExpoImage source={{ uri: nextPhoto.uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                ) : null}
              </View>
            </ReAnimated.View>
          </GestureDetector>

          <View style={{ position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 10 }}>
            {allowDelete && (
              <TouchableOpacity
                onPress={deleteCurrent}
                style={{
                  backgroundColor: 'rgba(220, 38, 38, 0.95)',
                  paddingVertical: 16,
                  paddingHorizontal: 18,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={download}
              disabled={busy}
              style={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                opacity: busy ? 0.6 : 1,
                flex: 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" stroke="#000" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={{ color: '#000', fontSize: 15, fontWeight: '700' }}>Télécharger</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function passwordStrength(pwd) {
  if (!pwd) return { score: 0, label: '', color: C.textSoft };
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  // 0-1: faible, 2: moyen, 3-4: fort, 5: très fort
  if (score <= 1) return { score: 1, label: 'Faible', color: '#EF4444' };
  if (score === 2) return { score: 2, label: 'Moyen', color: '#F59E0B' };
  if (score <= 4) return { score: 3, label: 'Fort', color: '#10B981' };
  return { score: 4, label: 'Très fort', color: '#059669' };
}

function AuthRunnerModal({ visible, onClose, onSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pré-remplit l'email avec la dernière valeur connue à chaque ouverture.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem('@will_last_email_runner').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setPostalCode(''); setCity(''); setCitySuggestions([]);
    setError(''); setBusy(false);
  };

  const pwdStrength = passwordStrength(password);

  // Quand le code postal change → fetch les villes
  useEffect(() => {
    if (mode !== 'register') return;
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        // Auto-sélectionne si 1 seule ville pour ce code postal
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [postalCode, mode]);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, firstName, lastName, department: `${postalCode} ${city}`.trim() };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
        >
          <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>

          {mode === 'register' && (
            <>
              <TextInput
                placeholder="Prénom"
                placeholderTextColor={C.textSoft}
                value={firstName}
                onChangeText={setFirstName}
                style={authStyles.input}
              />
              <TextInput
                placeholder="Nom"
                placeholderTextColor={C.textSoft}
                value={lastName}
                onChangeText={setLastName}
                style={authStyles.input}
              />
              <TextInput
                placeholder="Code postal"
                placeholderTextColor={C.textSoft}
                value={postalCode}
                onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                keyboardType="number-pad"
                maxLength={5}
                style={authStyles.input}
              />
              {citySuggestions.length > 0 && !city && (
                <ScrollView
                  style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                  keyboardShouldPersistTaps="handled"
                >
                  {citySuggestions.map((c) => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => { setCity(c); setCitySuggestions([]); }}
                      style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                    >
                      <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {city ? (
                <TouchableOpacity
                  onPress={() => setCity('')}
                  style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                >
                  <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                  <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
          <TextInput
            placeholder="Email"
            placeholderTextColor={C.textSoft}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={authStyles.input}
          />
          <PasswordInput
            placeholder="Mot de passe"
            placeholderTextColor={C.textSoft}
            value={password}
            onChangeText={setPassword}
            style={authStyles.input}
          />
          {mode === 'register' && password ? (
            <View style={{ marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                {[1, 2, 3, 4].map((i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9',
                    }}
                  />
                ))}
              </View>
              <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>
                {pwdStrength.label}
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4, marginBottom: 8 }}>{error}</Text>
          ) : null}

          <TouchableOpacity
            onPress={submit}
            disabled={busy}
            style={{
              backgroundColor: C.primary,
              paddingVertical: 14,
              borderRadius: 14,
              alignItems: 'center',
              marginTop: 12,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                {mode === 'login' ? 'Se connecter' : "S'inscrire"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Text style={{ color: C.textSoft, fontSize: 13 }}>
              {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
            </Text>
          </TouchableOpacity>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const authStyles = StyleSheet.create({
  input: {
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    marginBottom: 10,
  },
});

function AuthOrganizerModal({ visible, onClose, onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pré-remplit l'email avec la dernière valeur connue à chaque ouverture.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem('@will_last_email_organizer').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setError(''); setBusy(false);
  };

  const pwdStrength = passwordStrength(password);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const url = mode === 'login' ? '/organizer/login' : '/organizer/register';
      const body = mode === 'login' ? { email, password } : { email, password, firstName, lastName };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>
                {mode === 'login' ? 'Espace organisateur' : 'Créer un compte organisateur'}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                  <Path d="m8 8 8 8M16 8l-8 8" stroke={C.text} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            {mode === 'register' && (
              <>
                <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={authStyles.input} />
                <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={authStyles.input} />
              </>
            )}
            <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={authStyles.input} />
            <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={authStyles.input} />

            {mode === 'register' && password ? (
              <View style={{ marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>{pwdStrength.label}</Text>
              </View>
            ) : null}

            {error ? <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4, marginBottom: 8 }}>{error}</Text> : null}

            <TouchableOpacity onPress={submit} disabled={busy} style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: C.textSoft, fontSize: 13 }}>
                {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function OrganizerEventPhotosScreen({ session, event, onClose, onOpenPhoto }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [raceFilter, setRaceFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const tint = TYPE_COLORS[event.event_type] || TYPE_COLORS.Autre;

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setVisibleCount(20);
    try {
      const r = await fetch(`${API_URL}/organizer/event-photos/${event.code}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = r.ok ? await r.json() : { photos: [] };
      // Filtre défensif : on jette les entrées qui n'ont pas une url+key string
      // valides. Une seule entrée bancale peut faire crasher ExpoImage au render
      // et entraîner tout l'écran (la map ci-dessous propage l'objet tel quel).
      const list = (data.photos || [])
        .filter(p => p && typeof p.url === 'string' && p.url.length > 0
                       && typeof p.key === 'string' && p.key.length > 0)
        .map(p => ({
          uri: p.url,
          id: p.key,
          tint,
          race: p.race,
          km: p.km,
        }));
      list.sort((a, b) => extractBurstTs(b.id) - extractBurstTs(a.id));
      setPhotos(list.slice(0, 500));
    } catch (e) {
      console.warn('loadPhotos failed:', e?.message || e);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [event.code, session.token, tint]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadPhotos(); } finally { setRefreshing(false); }
  }, [loadPhotos]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadPhotos();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, [loadPhotos]);

  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const t = setTimeout(() => setVisibleCount(v => Math.min(v + 20, photos.length)), 300);
    return () => clearTimeout(t);
  }, [visibleCount, photos.length]);

  const filteredPhotos = raceFilter === 'all'
    ? photos
    : photos.filter(p => p.race === raceFilter || !p.race);

  const distances = Array.isArray(event.distances) ? event.distances : [];

  const toggleSelect = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePhotoPress = (photo) => {
    if (selectionMode) {
      toggleSelect(photo.id);
    } else {
      onOpenPhoto?.(photo, filteredPhotos, { allowDelete: true, onDelete: deleteFromViewer });
    }
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  };

  const deleteSelected = async () => {
    if (selectedKeys.size === 0) return;
    Alert.alert(
      `Supprimer ${selectedKeys.size} photo${selectedKeys.size > 1 ? 's' : ''} ?`,
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const r = await fetch(`${API_URL}/organizer/delete-photos`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({ keys: Array.from(selectedKeys) }),
              });
              if (r.ok) {
                const keysToRemove = selectedKeys;
                setPhotos(prev => prev.filter(p => !keysToRemove.has(p.id)));
                exitSelection();
              } else {
                const data = await r.json();
                Alert.alert('Erreur', data.error || 'Échec de la suppression');
              }
            } catch (e) {
              Alert.alert('Erreur', e.message || 'Erreur réseau');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const deleteFromViewer = async (keys) => {
    if (!keys || keys.length === 0) return;
    try {
      const r = await fetch(`${API_URL}/organizer/delete-photos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ keys }),
      });
      if (r.ok) {
        const keysSet = new Set(keys);
        setPhotos(prev => prev.filter(p => !keysSet.has(p.id)));
      }
    } catch {}
  };

  const ListHeader = (
    <>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={[s.welcome, { color: C.primary, fontSize: 18 }]}>
            {selectionMode ? `${selectedKeys.size} sélectionnée${selectedKeys.size > 1 ? 's' : ''}` : "Photos de l'event"}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {!selectionMode && photos.length > 0 ? (
            <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
              <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Sélectionner</Text>
            </TouchableOpacity>
          ) : selectionMode ? (
            <TouchableOpacity onPress={exitSelection} hitSlop={10}>
              <Text style={{ color: C.textSoft, fontSize: 14, fontWeight: '600' }}>Annuler</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Path d="m8 8 8 8M16 8l-8 8" stroke={C.textSoft} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[s.eventCard, { marginTop: 12, marginBottom: 14 }]}>
        {event.cover_image ? (
          <ExpoImage source={{ uri: event.cover_image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
        ) : null}
        <LinearGradient
          colors={[tint, tint, 'transparent']}
          locations={[0, 0.45, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={s.eventCardCenter}>
          <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
          <Text style={s.eventName} numberOfLines={1}>{event.name}</Text>
          <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
        </View>
      </View>

      <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={{ marginRight: 10 }}>
          <Circle cx="12" cy="12" r="9" stroke="#92400E" strokeWidth={1.8} />
          <Path d="M12 8v5M12 16h.01" stroke="#92400E" strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
        <Text style={{ color: '#92400E', fontSize: 12, flex: 1 }}>
          Mode preview : tu vois toutes les photos, même celles prises avant le départ.{'\n'}Les coureurs ne voient que les photos après l'heure de leur course.
        </Text>
      </View>

      {distances.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 8 }}
        >
          <TouchableOpacity
            onPress={() => setRaceFilter('all')}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
              backgroundColor: raceFilter === 'all' ? C.primary : '#f5f3ff',
            }}
          >
            <Text style={{ color: raceFilter === 'all' ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>Toutes</Text>
          </TouchableOpacity>
          {distances.map((d, i) => {
            const val = String(d.km);
            const active = raceFilter === val;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setRaceFilter(val)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
                  backgroundColor: active ? C.primary : '#f5f3ff',
                }}
              >
                <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{d.km} km</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Text style={[s.sectionTitle, { marginVertical: 10 }]}>
        Photos {photos.length > 0 ? `(${filteredPhotos.length})` : ''}
      </Text>
    </>
  );

  const ListEmpty = (
    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
      {loading
        ? <ActivityIndicator color={C.primary} />
        : <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>}
    </View>
  );

  // Cellule grille — extraite en fonction pour clarté et keyExtractor stable.
  const renderItem = ({ item: photo, index }) => {
    const isSelected = selectedKeys.has(photo.id);
    return (
      <TouchableOpacity
        onPress={() => handlePhotoPress(photo)}
        onLongPress={() => {
          if (!selectionMode) setSelectionMode(true);
          toggleSelect(photo.id);
        }}
        activeOpacity={0.85}
        style={{ width: '33.333%', aspectRatio: 1, padding: 2 }}
      >
        <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#eee' }}>
          <ExpoImage
            source={{ uri: photo.uri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            cachePolicy="memory-disk"
            priority="low"
            transition={100}
            recyclingKey={photo.id}
          />
          {selectionMode && (
            <View style={{
              position: 'absolute', top: 6, right: 6,
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: isSelected ? C.primary : 'rgba(0,0,0,0.4)',
              borderWidth: 2, borderColor: '#fff',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {isSelected && (
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="m4 12 6 6L20 6" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              )}
            </View>
          )}
          {isSelected && (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(124, 58, 237, 0.25)' }]} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // FlatList virtualisée comme root scroller (au lieu de RefreshableScrollView
  // qui mountait tout en arbre). Réduit drastiquement le pic mémoire sur
  // les events à 100+ photos.
  return (
    <GridErrorBoundary>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <FlatList
          data={loading ? [] : filteredPhotos.slice(0, visibleCount)}
          numColumns={3}
          keyExtractor={(item, index) => item.id || `p-${index}`}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={C.primary} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
        />

        {selectionMode && selectedKeys.size > 0 && (
          <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
            <TouchableOpacity
              onPress={deleteSelected}
              disabled={deleting}
              style={{
                backgroundColor: '#DC2626',
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                opacity: deleting ? 0.6 : 1,
                shadowColor: '#000',
                shadowOpacity: 0.3,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
              }}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                    <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                    Supprimer ({selectedKeys.size})
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GridErrorBoundary>
  );
}

function OrganizerDashboardScreen({ session, onLogout, onCreateEvent, onEditEvent, onOpenProfile, onOpenEventPhotos, refreshKey = 0 }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(null); // slug en cours de paiement

  const reload = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/organizer/my-events`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await r.json();
      setEvents(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, [refreshKey]);

  const pay = async (slug) => {
    setPaying(slug);
    try {
      const r = await fetch(`${API_URL}/organizer/pay-event/${slug}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (r.ok) {
        Alert.alert('Paiement réussi', 'Ton événement est maintenant en ligne !');
        reload();
      } else {
        const data = await r.json();
        Alert.alert('Erreur', data.error || 'Échec du paiement');
      }
    } finally { setPaying(null); }
  };

  const deleteEvent = (e) => {
    Alert.alert(
      'Supprimer cet événement ?',
      `"${e.name}" sera définitivement supprimé, ainsi que toutes ses photos. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await fetch(`${API_URL}/organizer/event/${e.code}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${session.token}` },
              });
              if (r.ok) reload();
              else {
                const data = await r.json();
                Alert.alert('Erreur', data.error || 'Échec de la suppression');
              }
            } catch (err) {
              Alert.alert('Erreur', err.message);
            }
          },
        },
      ]
    );
  };

  // Valeurs alignées avec le worker (status renvoyé par /organizer/my-events) :
  //   pending           → soumission en cours de validation admin
  //   validated         → admin a validé, en attente de décision billing (transitoire)
  //   pending_payment   → admin a fixé un montant, en attente du règlement orga
  //   free              → activé en mode gratuit, en ligne
  //   paid              → réglé, en ligne
  //   rejected          → refusé par admin
  const statusInfo = (st) => {
    if (st === 'pending') return { label: 'En cours de validation', color: '#F59E0B', bg: '#FEF3C7' };
    if (st === 'validated') return { label: 'En cours d\'activation', color: '#8B5CF6', bg: '#EDE9FE' };
    if (st === 'pending_payment') return { label: 'À régler', color: '#EC4899', bg: '#FCE7F3' };
    if (st === 'free') return { label: 'En ligne · gratuit', color: '#10B981', bg: '#D1FAE5' };
    if (st === 'paid') return { label: 'En ligne', color: '#10B981', bg: '#D1FAE5' };
    if (st === 'rejected') return { label: 'Refusé', color: '#DC2626', bg: '#FEE2E2' };
    return { label: st, color: C.textSoft, bg: '#f5f3ff' };
  };

  return (
    <RefreshableScrollView onRefresh={reload} style={s.scroll} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* Header avec icône profil + Hello */}
      <View style={[s.headerRow, { paddingVertical: 12 }]}>
        <TouchableOpacity onPress={onOpenProfile} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon.User color="#c9beed" />
          <Text style={[s.welcome, { color: '#c9beed', fontSize: 22 }]}>
            Hello {session?.profile?.firstName}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.pageTitleCenter, { textAlign: 'left' }]}>Mes events</Text>

      <TouchableOpacity
        onPress={onCreateEvent}
        style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 18 }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>+ Créer un événement</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
      ) : events.length === 0 ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
            Tu n'as pas encore créé d'événement.{'\n'}Clique sur le bouton ci-dessus pour démarrer.
          </Text>
        </View>
      ) : (
        events.map((e, i) => {
          const info = statusInfo(e.status);
          return (
            <View key={i} style={{ marginBottom: 14 }}>
              {/* Carte event style accueil + badge statut en haut à droite */}
              <View style={{ position: 'relative' }}>
                <EventCard event={e} onPress={() => onOpenEventPhotos?.(e)} />
                <View style={{
                  position: 'absolute',
                  top: 10, right: 10,
                  backgroundColor: info.bg,
                  paddingHorizontal: 10, paddingVertical: 5,
                  borderRadius: 8,
                  zIndex: 10,
                }}>
                  <Text style={{ color: info.color, fontSize: 11, fontWeight: '700' }}>{info.label}</Text>
                </View>
              </View>

              {/* Bloc actions sous la carte */}
              <View style={{ backgroundColor: '#faf9ff', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, marginTop: -10, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12 }}>
                {e.status === 'pending_payment' && (
                  <TouchableOpacity
                    onPress={() => pay(e.code)}
                    disabled={paying === e.code}
                    style={{ backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10, alignItems: 'center', marginBottom: 8, opacity: paying === e.code ? 0.6 : 1 }}
                  >
                    {paying === e.code ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Mettre en ligne</Text>
                    )}
                  </TouchableOpacity>
                )}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => onEditEvent?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: C.primary, borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Modifier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onOpenEventPhotos?.(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.primary }}
                  >
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Photos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => deleteEvent(e)}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#DC2626' }}
                  >
                    <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600' }}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}
    </RefreshableScrollView>
  );
}

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
  const [editEventTarget, setEditEventTarget] = useState(null);
  const [orgRefreshKey, setOrgRefreshKey] = useState(0);
  const [loginRole, setLoginRole] = useState(null);
  const [selfieUri, setSelfieUri] = useState(null);
  const [session, setSession] = useState(null);
  const [profileMenu, setProfileMenu] = useState(false);
  const [selfieViewer, setSelfieViewer] = useState(false);
  const [openedPhoto, setOpenedPhoto] = useState(null); // { photo, photos, allowDelete, onDelete }
  const [favorites, setFavorites] = useState([]);
  const [photoFavorites, setPhotoFavorites] = useState([]); // array d'IDs photo (keys R2)
  const [userId, setUserId] = useState(null);
  const [runnerSession, setRunnerSession] = useState(null); // { token, profile }
  const [organizerSession, setOrganizerSession] = useState(null); // { token, profile }
  const [organizerAuthVisible, setOrganizerAuthVisible] = useState(false);
  const [organizerProfileMenu, setOrganizerProfileMenu] = useState(false);
  const [organizerEventPhotosTarget, setOrganizerEventPhotosTarget] = useState(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const pendingActionRef = useRef(null); // action à exécuter après login

  const reloadEvents = useCallback(async () => {
    const data = await api.getEvents();
    setEvents(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    Font.loadAsync({
      AVEstiana: require('./assets/fonts/AV_Estiana-VF.ttf'),
    }).then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
  }, []);

  useEffect(() => {
    reloadEvents();
    AsyncStorage.getItem('@will_selfie').then(v => v && setSelfieUri(v));
    AsyncStorage.getItem('@will_favorites').then(v => {
      if (v) {
        try { setFavorites(JSON.parse(v)); } catch { setFavorites([]); }
      }
    });
    // user_id unique généré au premier lancement
    AsyncStorage.getItem('@will_user_id').then(v => {
      if (v) {
        setUserId(v);
      } else {
        // Génère un ID aléatoire (Math.random + timestamp, suffisant pour identifier un device)
        const id = Date.now().toString(36) +
          Math.random().toString(36).substring(2, 10) +
          Math.random().toString(36).substring(2, 10);
        AsyncStorage.setItem('@will_user_id', id);
        setUserId(id);
      }
    });
    // Sessions sensibles : migration AsyncStorage → SecureStore puis lecture.
    (async () => {
      await migrateSensitiveKeysToSecureStore();
      Secure.getItem('@will_runner').then(v => {
        if (v) try { setRunnerSession(JSON.parse(v)); } catch {}
      });
      Secure.getItem('@will_organizer').then(v => {
        if (v) try { setOrganizerSession(JSON.parse(v)); } catch {}
      });
      Secure.getItem('@will_photographer_session').then(v => {
        if (v) try { setSession(JSON.parse(v)); } catch {}
      });
    })();
  }, []);

  // Quand un compte runner est connecté, on aligne userId sur runner.userId
  // pour que selfie + galerie perso utilisent le même identifiant
  useEffect(() => {
    if (runnerSession?.profile?.userId) {
      setUserId(runnerSession.profile.userId);
      AsyncStorage.setItem('@will_user_id', runnerSession.profile.userId).catch(() => {});
    }
  }, [runnerSession?.profile?.userId]);

  // Favoris photos perso (locaux par device, scopés par userId).
  // Rechargés quand userId change (ex: login runner → userId aligne sur runner.userId).
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(`@will_photo_favorites_${userId}`).then(v => {
      if (v) {
        try { setPhotoFavorites(JSON.parse(v)); } catch { setPhotoFavorites([]); }
      } else {
        setPhotoFavorites([]);
      }
    });
  }, [userId]);

  const handleAuthSuccess = useCallback((session) => {
    setRunnerSession(session);
    Secure.setItem('@will_runner', JSON.stringify(session)).catch(() => {});
    setAuthModalVisible(false);
    // Exécute l'action en attente (ex: ouvrir selfie modal après login)
    if (pendingActionRef.current) {
      const a = pendingActionRef.current;
      pendingActionRef.current = null;
      setTimeout(() => a(), 100);
    }
  }, []);

  const requireAuth = useCallback((action) => {
    if (runnerSession) {
      action();
    } else {
      pendingActionRef.current = action;
      setAuthModalVisible(true);
    }
  }, [runnerSession]);

  const logoutRunner = useCallback(() => {
    const lastEmail = runnerSession?.profile?.email;
    if (lastEmail) AsyncStorage.setItem('@will_last_email_runner', lastEmail).catch(() => {});
    setRunnerSession(null);
    Secure.removeItem('@will_runner').catch(() => {});
  }, [runnerSession]);

  const handleOrganizerAuthSuccess = useCallback((session) => {
    setOrganizerSession(session);
    Secure.setItem('@will_organizer', JSON.stringify(session)).catch(() => {});
    setOrganizerAuthVisible(false);
    setBottomTab('events');
  }, []);

  const logoutOrganizer = useCallback(() => {
    const lastEmail = organizerSession?.profile?.email;
    if (lastEmail) AsyncStorage.setItem('@will_last_email_organizer', lastEmail).catch(() => {});
    setOrganizerSession(null);
    Secure.removeItem('@will_organizer').catch(() => {});
    setBottomTab('home');
  }, [organizerSession]);

  // RGPD : suppression définitive du compte coureur (App Store Guideline 5.1.1(v))
  const deleteRunnerAccount = useCallback(() => {
    if (!runnerSession?.token) return;
    Alert.alert(
      'Supprimer mon compte ?',
      'Cette action est définitive. Ton selfie, ton profil coureur et toutes tes données associées seront supprimés. Tes photos d\'événements ne te seront plus envoyées.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          try {
            const r = await fetch(`${API_URL}/runner/account`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${runnerSession.token}` },
            });
            if (!r.ok) {
              const data = await r.json().catch(() => ({}));
              Alert.alert('Erreur', data.error || 'Impossible de supprimer le compte. Réessaie plus tard.');
              return;
            }
            await Promise.all([
              Secure.removeItem('@will_runner'),
              Secure.removeItem(BIOMETRIC_CONSENT_KEY),
              AsyncStorage.removeItem('@will_selfie'),
            ]);
            setRunnerSession(null);
            setSelfieUri(null);
            Alert.alert('Compte supprimé', 'Toutes tes données ont été supprimées.');
          } catch (e) {
            Alert.alert('Erreur réseau', 'Vérifie ta connexion et réessaie.');
          }
        }},
      ]
    );
  }, [runnerSession]);

  // RGPD : suppression définitive du compte organisateur + tous ses events
  const deleteOrganizerAccount = useCallback(() => {
    if (!organizerSession?.token) return;
    Alert.alert(
      'Supprimer mon compte organisateur ?',
      'Cette action est définitive. Ton profil organisateur et TOUS tes événements (photos, métadonnées, données biométriques associées) seront supprimés. Aucun retour en arrière possible.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: async () => {
          try {
            const r = await fetch(`${API_URL}/organizer/account`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${organizerSession.token}` },
            });
            if (!r.ok) {
              const data = await r.json().catch(() => ({}));
              Alert.alert('Erreur', data.error || 'Impossible de supprimer le compte. Réessaie plus tard.');
              return;
            }
            await Secure.removeItem('@will_organizer');
            setOrganizerSession(null);
            setBottomTab('home');
            Alert.alert('Compte supprimé', 'Toutes tes données et événements ont été supprimés.');
          } catch (e) {
            Alert.alert('Erreur réseau', 'Vérifie ta connexion et réessaie.');
          }
        }},
      ]
    );
  }, [organizerSession]);

  const updateRunnerProfile = useCallback(async (changes) => {
    if (!runnerSession?.token) return;
    try {
      const r = await fetch(`${API_URL}/runner/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${runnerSession.token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await r.json();
      if (r.ok && data.profile) {
        const next = { ...runnerSession, profile: data.profile };
        setRunnerSession(next);
        Secure.setItem('@will_runner', JSON.stringify(next)).catch(() => {});
      } else {
        Alert.alert('Erreur', data.error || 'Impossible de modifier les infos');
      }
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Erreur réseau');
    }
  }, [runnerSession]);

  const updateOrganizerProfile = useCallback(async (changes) => {
    if (!organizerSession?.token) return;
    try {
      const r = await fetch(`${API_URL}/organizer/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${organizerSession.token}`,
        },
        body: JSON.stringify(changes),
      });
      const data = await r.json();
      if (r.ok && data.profile) {
        const next = { ...organizerSession, profile: data.profile };
        setOrganizerSession(next);
        Secure.setItem('@will_organizer', JSON.stringify(next)).catch(() => {});
      } else {
        Alert.alert('Erreur', data.error || 'Impossible de modifier les infos');
      }
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Erreur réseau');
    }
  }, [organizerSession]);

  const toggleFavorite = useCallback((eventCode) => {
    setFavorites(prev => {
      const next = prev.includes(eventCode)
        ? prev.filter(c => c !== eventCode)
        : [...prev, eventCode];
      AsyncStorage.setItem('@will_favorites', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const photoFavoritesSet = useMemo(() => new Set(photoFavorites), [photoFavorites]);
  const togglePhotoFavorite = useCallback((photoId) => {
    if (!photoId || !userId) return;
    setPhotoFavorites(prev => {
      const next = prev.includes(photoId)
        ? prev.filter(k => k !== photoId)
        : [...prev, photoId];
      AsyncStorage.setItem(`@will_photo_favorites_${userId}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [userId]);

  const deleteSelfie = useCallback(() => {
    Alert.alert('Supprimer le selfie ?', 'Tu pourras en reprendre un nouveau.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        // RGPD : supprimer le selfie révoque aussi le consentement biométrique
        await Promise.all([
          AsyncStorage.removeItem('@will_selfie'),
          Secure.removeItem(BIOMETRIC_CONSENT_KEY),
        ]);
        setSelfieUri(null);
      }},
    ]);
  }, []);

  const handlePickRole = (role) => {
    setOrgModal(false);
    if (role === 'organizer') {
      if (organizerSession) {
        setBottomTab('events');
      } else {
        setOrganizerAuthVisible(true);
      }
      return;
    }
    if (role === 'create') {
      setCreateEventModal(true);
      return;
    }
    // photographer
    setLoginRole(role);
  };

  const tabs = useMemo(() => {
    const t = ['home', 'photos'];
    if (organizerSession) t.push('events');
    return t;
  }, [organizerSession]);

  const tabsTranslateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const idx = tabs.indexOf(bottomTab);
    if (idx === -1) return;
    Animated.spring(tabsTranslateX, {
      toValue: -idx * SCREEN_W,
      useNativeDriver: true,
      tension: 90, friction: 13,
    }).start();
  }, [bottomTab, tabs]);

  const swipeNav = useMemo(() => {
    const idx = tabs.indexOf(bottomTab);
    return Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-15, 15])
      .runOnJS(true)
      .onUpdate((e) => {
        if (idx === -1) return;
        let val = -idx * SCREEN_W + e.translationX;
        const minX = -(tabs.length - 1) * SCREEN_W;
        if (val > 0) val = val * 0.3;
        if (val < minX) val = minX + (val - minX) * 0.3;
        tabsTranslateX.setValue(val);
      })
      .onEnd((e) => {
        if (idx === -1) return;
        const threshold = SCREEN_W * 0.22;
        let nextIdx = idx;
        if ((e.translationX < -threshold || e.velocityX < -800) && idx < tabs.length - 1) {
          nextIdx = idx + 1;
        } else if ((e.translationX > threshold || e.velocityX > 800) && idx > 0) {
          nextIdx = idx - 1;
        }
        const target = tabs[nextIdx];
        if (target === bottomTab) {
          Animated.spring(tabsTranslateX, {
            toValue: -idx * SCREEN_W, useNativeDriver: true, tension: 90, friction: 13,
          }).start();
          return;
        }
        if (target === 'photos' && !runnerSession) {
          Animated.spring(tabsTranslateX, {
            toValue: -idx * SCREEN_W, useNativeDriver: true, tension: 90, friction: 13,
          }).start();
          requireAuth(() => { setBottomTab('photos'); setOpenedEvent(null); });
          return;
        }
        setBottomTab(target);
        setOpenedEvent(null);
        if (target !== 'events') setOrganizerEventPhotosTarget(null);
      });
  }, [tabs, bottomTab, runnerSession, requireAuth]);

  if (!fontsLoaded) {
    return <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={C.primary} /></View>;
  }

  // Mode photographe (full screen caméra)
  if (session?.role === 'photographer' || session?.role === 'organizer') {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
          <PhotographerScreen session={session} onLogout={() => {
            setSession(null);
            Secure.removeItem('@will_photographer_session').catch(() => {});
          }} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      {!openedEvent && !organizerEventPhotosTarget && (
        <GestureDetector gesture={swipeNav}>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View style={{
              flex: 1,
              flexDirection: 'row',
              width: SCREEN_W * tabs.length,
              transform: [{ translateX: tabsTranslateX }],
            }}>
              <View style={{ width: SCREEN_W }}>
                <HomeScreen
                  events={events}
                  onOpenEvent={setOpenedEvent}
                  onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                  onOpenOrg={() => setOrgModal(true)}
                  onOpenOrgRole={handlePickRole}
                  onOpenSearch={() => setSearchModal(true)}
                  tab={tab}
                  setTab={setTab}
                  selfieUri={selfieUri}
                  onDeleteSelfie={deleteSelfie}
                  onOpenProfile={() => setProfileMenu(true)}
                  favorites={favorites}
                  onToggleFavorite={(code) => requireAuth(() => toggleFavorite(code))}
                  onRefresh={reloadEvents}
                />
              </View>
              <View style={{ width: SCREEN_W }}>
                <PhotosScreen
                  events={events}
                  onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
                  gallery={[]}
                  selfieUri={selfieUri}
                  onDeleteSelfie={deleteSelfie}
                  onOpenProfile={() => setProfileMenu(true)}
                  favorites={favorites}
                  userId={userId}
                  runnerToken={runnerSession?.token}
                  onOpenPhoto={(photo, list) => setOpenedPhoto({ photo, photos: list })}
                  photoFavoritesSet={photoFavoritesSet}
                  onTogglePhotoFavorite={togglePhotoFavorite}
                />
              </View>
              {organizerSession && (
                <View style={{ width: SCREEN_W }}>
                  <OrganizerDashboardScreen
                    session={organizerSession}
                    onLogout={logoutOrganizer}
                    onCreateEvent={() => setCreateEventModal(true)}
                    onEditEvent={(e) => setEditEventTarget(e)}
                    onOpenProfile={() => setOrganizerProfileMenu(true)}
                    onOpenEventPhotos={(e) => setOrganizerEventPhotosTarget(e)}
                    refreshKey={orgRefreshKey}
                  />
                </View>
              )}
            </Animated.View>
          </View>
        </GestureDetector>
      )}

      {openedEvent && (
        <EventDetailScreen
          event={openedEvent}
          onClose={() => setOpenedEvent(null)}
          onOpenSelfie={() => requireAuth(() => setSelfieModal(true))}
          selfieUri={selfieUri}
          onDeleteSelfie={deleteSelfie}
          onOpenProfile={() => setProfileMenu(true)}
          onOpenPhoto={(photo, list) => setOpenedPhoto({ photo, photos: list })}
          isFavorite={favorites.includes(openedEvent.code)}
          onToggleFavorite={() => requireAuth(() => toggleFavorite(openedEvent.code))}
        />
      )}

      {organizerEventPhotosTarget && bottomTab === 'events' && organizerSession && (
        <OrganizerEventPhotosScreen
          session={organizerSession}
          event={organizerEventPhotosTarget}
          onClose={() => setOrganizerEventPhotosTarget(null)}
          onOpenPhoto={(photo, list, opts) => setOpenedPhoto({ photo, photos: list, ...opts })}
        />
      )}

      {/* Bottom Nav */}
      <View style={s.bottomNav}>
        <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('home'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); }}>
          <View style={s.navIconWrap}>
            <Icon.Home size={22} filled={bottomTab === 'home'} color={bottomTab === 'home' ? C.primary : C.text} />
          </View>
          <Text style={[s.navLabel, bottomTab === 'home' && { color: C.primary, fontWeight: '700' }]}>Accueil</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navBtn} onPress={() => requireAuth(() => { setBottomTab('photos'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); })}>
          <View style={s.navIconWrap}>
            <Icon.Photos size={22} filled={bottomTab === 'photos'} color={bottomTab === 'photos' ? C.primary : C.text} />
          </View>
          <Text style={[s.navLabel, bottomTab === 'photos' && { color: C.primary, fontWeight: '700' }]}>Photos</Text>
        </TouchableOpacity>
        {organizerSession && (
          <TouchableOpacity style={s.navBtn} onPress={() => { setBottomTab('events'); setOpenedEvent(null); setOrganizerEventPhotosTarget(null); }}>
            <View style={s.navIconWrap}>
              <Icon.ListEvents size={26} color={bottomTab === 'events' ? C.pinkPill : C.text} />
            </View>
            <Text style={[s.navLabel, bottomTab === 'events' && { color: C.pinkPill, fontWeight: '700' }]}>Mes events</Text>
          </TouchableOpacity>
        )}
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
        userId={userId}
        runnerToken={runnerSession?.token}
      />

      <LoginModal
        visible={!!loginRole}
        role={loginRole}
        events={events}
        onClose={() => setLoginRole(null)}
        onSuccess={(r) => {
          setLoginRole(null);
          const next = { ...r, role: loginRole };
          setSession(next);
          // Persistance pour accès hors ligne (sessions photographe / organizer event)
          Secure.setItem('@will_photographer_session', JSON.stringify(next)).catch(() => {});
        }}
      />

      <CreateEventModal
        visible={createEventModal}
        onClose={() => setCreateEventModal(false)}
        organizerSession={organizerSession}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <CreateEventModal
        visible={!!editEventTarget}
        onClose={() => setEditEventTarget(null)}
        organizerSession={organizerSession}
        editEvent={editEventTarget}
        onCreated={() => setOrgRefreshKey(k => k + 1)}
      />

      <ProfileMenuModal
        visible={profileMenu}
        onClose={() => setProfileMenu(false)}
        selfieUri={selfieUri}
        onView={() => { setProfileMenu(false); setSelfieViewer(true); }}
        onRetake={() => requireAuth(() => setSelfieModal(true))}
        onDelete={deleteSelfie}
        runnerSession={runnerSession}
        onLogout={logoutRunner}
        onLogin={() => setAuthModalVisible(true)}
        onUpdateProfile={updateRunnerProfile}
        onDeleteAccount={() => { setProfileMenu(false); deleteRunnerAccount(); }}
      />

      <SelfieViewerModal
        visible={selfieViewer}
        uri={selfieUri}
        onClose={() => { setSelfieViewer(false); setProfileMenu(true); }}
      />

      <PhotoViewerModal
        visible={!!openedPhoto}
        photo={openedPhoto?.photo}
        photos={openedPhoto?.photos}
        allowDelete={openedPhoto?.allowDelete}
        onDelete={openedPhoto?.onDelete}
        onClose={() => setOpenedPhoto(null)}
        photoFavoritesSet={photoFavoritesSet}
        onTogglePhotoFavorite={togglePhotoFavorite}
      />

      <AuthRunnerModal
        visible={authModalVisible}
        onClose={() => setAuthModalVisible(false)}
        onSuccess={handleAuthSuccess}
      />

      <AuthOrganizerModal
        visible={organizerAuthVisible}
        onClose={() => setOrganizerAuthVisible(false)}
        onSuccess={handleOrganizerAuthSuccess}
      />

      <OrganizerProfileMenuModal
        visible={organizerProfileMenu}
        onClose={() => setOrganizerProfileMenu(false)}
        organizerSession={organizerSession}
        onLogout={logoutOrganizer}
        onUpdate={updateOrganizerProfile}
        onDeleteAccount={() => { setOrganizerProfileMenu(false); deleteOrganizerAccount(); }}
      />
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ---------- STYLES ----------
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orgToggle: {
    flexDirection: 'row',
    backgroundColor: C.pinkPillBg,
    borderRadius: 999,
    padding: 4,
    alignItems: 'center',
    gap: 4,
  },
  orgToggleBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },

  welcome: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 18, color: C.text, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, marginBottom: 18 },

  selfieDoneBanner: { backgroundColor: C.white, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16, borderWidth: 1, borderColor: C.primaryLight },
  selfieCheckCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4A6FF', alignItems: 'center', justifyContent: 'center' },
  selfieDoneTitle: { fontWeight: '700', fontSize: 15, color: C.primary, fontFamily: 'AVEstiana', fontStyle: 'normal' },
  selfieDoneSub: { fontSize: 12, color: C.textSoft, marginTop: 2, lineHeight: 16 },
  selfieDelete: { padding: 6 },

  selfieCard: { borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', minHeight: 110, marginBottom: 14 },
  selfieTitle: { color: '#fff', fontSize: 24, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal', lineHeight: 28 },
  selfieSub: { color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: 12.5, lineHeight: 17 },
  selfieAvatar: { width: 68, height: 68, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  eventPick: { backgroundColor: C.white, borderRadius: 14, padding: 14, marginTop: 8 },
  eventPickName: { fontWeight: '700', fontSize: 15, color: C.text },
  eventPickDate: { fontSize: 12, color: C.textSoft, marginTop: 2 },

  sectionTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text },
  pill: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 18 },
  pillActive: { backgroundColor: C.primary },
  pillText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  pillTextActive: { color: '#fff' },

  empty: { textAlign: 'center', color: C.textSoft, marginTop: 24, fontSize: 14 },

  eventCard: { height: 90, borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: '#222', justifyContent: 'center' },
  eventCardCenter: { paddingHorizontal: 16, zIndex: 2 },
  eventDate: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 1, opacity: 0.9, marginBottom: 2 },
  eventName: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal' },
  eventLocation: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },

  pageTitleCenter: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 26, fontWeight: '700', color: C.primary, textAlign: 'center', marginVertical: 16 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: (SCREEN_W - 40 - 24) / 4, height: (SCREEN_W - 40 - 24) / 4, marginBottom: 8 },
  gridPlaceholder: { flex: 1, backgroundColor: C.primaryLight, borderRadius: 12 },
  gridImg: { flex: 1, borderRadius: 12 },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: C.white, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  navBtn: { alignItems: 'center', justifyContent: 'flex-start', gap: 4, minWidth: 80 },
  navIconWrap: { height: 26, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 12, color: C.text, marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D0CCE3', alignSelf: 'center', marginBottom: 18 },
  modalTitle: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 22, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  modalSub: { color: C.textSoft, textAlign: 'center', marginBottom: 18, fontSize: 13 },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 12 },
  modalCancelText: { color: C.textSoft, fontWeight: '600' },

  btnPrimary: { backgroundColor: C.primary, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 16 },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: { backgroundColor: C.white, padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnSecondaryText: { color: C.primary, fontWeight: '600', fontSize: 14 },

  selfiePreviewWrap: { alignItems: 'center', marginVertical: 16 },
  selfiePreview: { width: 160, height: 160, borderRadius: 80 },

  typePill: { backgroundColor: C.white, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6 },
  typePillActive: { backgroundColor: C.primary },
  typePillText: { fontSize: 12, color: C.text, fontWeight: '600' },
});
