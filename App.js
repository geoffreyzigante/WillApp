import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  Image, Modal, Alert, ActivityIndicator, FlatList, Dimensions,
  StatusBar, SafeAreaView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as Font from 'expo-font';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

const API_URL = 'https://will-api.geoffreyzigante.workers.dev';
const R2_PUBLIC = 'https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev';
const { width: SCREEN_W } = Dimensions.get('window');

// ---------- DESIGN TOKENS ----------
const C = {
  bg: '#F5F3FF',
  primary: '#7B2FFF',
  primaryDark: '#5A1FCC',
  primaryLight: '#E8DEFF',
  text: '#0A0A0A',
  textSoft: '#6B6B7B',
  white: '#FFFFFF',
  pillBg: '#EFE7FF',
  pinkPill: '#FFD9F0',
  pinkPillText: '#C2185B',
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

// ---------- ICONS ----------
const Icon = {
  Bell: ({ size = 22, color = '#0A0A0A' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2a6 6 0 0 0-6 6v3.5L4 14h16l-2-2.5V8a6 6 0 0 0-6-6Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M10 18a2 2 0 0 0 4 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  User: ({ size = 22, color = '#FFFFFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" fill={color} />
      <Path d="M4 21c0-4 4-7 8-7s8 3 8 7" fill={color} />
    </Svg>
  ),
  Search: ({ size = 18, color = '#7B2FFF' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={2} />
      <Path d="m20 20-3.5-3.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  ),
  Heart: ({ size = 22, color = '#FFFFFF', filled = false }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'}>
      <Path d="M12 21s-7-4.5-9.5-9C.8 8.6 3 5 6.5 5 8.7 5 10.5 6.2 12 8c1.5-1.8 3.3-3 5.5-3 3.5 0 5.7 3.6 4 7-2.5 4.5-9.5 9-9.5 9Z" stroke={color} strokeWidth={2} strokeLinejoin="round" fill={filled ? color : 'none'} />
    </Svg>
  ),
  Home: ({ size = 24, color = '#7B2FFF', filled = false }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9Z" stroke={color} strokeWidth={2} strokeLinejoin="round" fill={filled ? color : 'none'} />
    </Svg>
  ),
  Photos: ({ size = 24, color = '#0A0A0A', filled = false }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth={2} fill={filled ? color : 'none'} />
      <Circle cx="8.5" cy="10" r="1.5" fill={filled ? '#fff' : color} />
      <Path d="m4 17 5-5 4 4 3-3 4 4" stroke={filled ? '#fff' : color} strokeWidth={2} strokeLinejoin="round" fill="none" />
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

function HomeScreen({ events, onOpenEvent, onOpenSelfie, onOpenOrg, tab, setTab, onOpenSearch }) {
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

      <Text style={s.welcome}>
        Bienvenue chez<Text style={s.welcomeAccent}>will</Text>
      </Text>

      {/* Selfie Block */}
      <TouchableOpacity activeOpacity={0.9} onPress={onOpenSelfie}>
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
        colors={[`${tint}00`, `${tint}CC`, tint]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={s.eventCardBottom}>
        <Text style={s.eventDate}>{formatDateLong(event.event_date)}</Text>
        <Text style={s.eventName} numberOfLines={2}>{event.name}</Text>
        <Text style={s.eventLocation}>{cityLabel(event.location)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PhotosScreen({ onOpenSelfie, gallery }) {
  return (
    <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.iconBtn}><Icon.Bell /></TouchableOpacity>
          <TouchableOpacity style={s.avatarBtn}><Icon.User /></TouchableOpacity>
        </View>
      </View>

      <Text style={s.pageTitleCenter}>Mes photos</Text>

      <TouchableOpacity activeOpacity={0.9} onPress={onOpenSelfie}>
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

      <Text style={s.galleryTitle}>Ma galerie</Text>
      <PhotoGrid photos={gallery} />
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

function EventDetailScreen({ event, onClose, onOpenSelfie }) {
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
      <TouchableOpacity activeOpacity={0.9} onPress={onOpenSelfie}>
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

      {/* Galerie */}
      <Text style={[s.sectionTitle, { marginVertical: 14 }]}>Photos</Text>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} />
      ) : (
        <PhotoGrid photos={photos} />
      )}
    </ScrollView>
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
      const dest = `${FileSystem.documentDirectory}selfie.jpg`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      await AsyncStorage.setItem('@will_selfie', dest);
      onSaved?.(dest);
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
  const [loginRole, setLoginRole] = useState(null);
  const [selfieUri, setSelfieUri] = useState(null);

  useEffect(() => {
    Font.loadAsync({
      AVEstiana: require('./assets/fonts/AV_Estiana-VF.ttf'),
    }).then(() => setFontsLoaded(true)).catch(() => setFontsLoaded(true));
  }, []);

  useEffect(() => {
    api.getEvents().then(data => setEvents(Array.isArray(data) ? data : []));
    AsyncStorage.getItem('@will_selfie').then(v => v && setSelfieUri(v));
  }, []);

  const handlePickRole = (role) => {
    setOrgModal(false);
    if (role === 'create') {
      Alert.alert('Bientôt', 'La création publique d\'événement arrive bientôt.');
      return;
    }
    setLoginRole(role);
  };

  if (!fontsLoaded) {
    return <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator color={C.primary} /></View>;
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
        />
      )}

      {bottomTab === 'photos' && !openedEvent && (
        <PhotosScreen
          onOpenSelfie={() => setSelfieModal(true)}
          gallery={[]}
        />
      )}

      {openedEvent && (
        <EventDetailScreen
          event={openedEvent}
          onClose={() => setOpenedEvent(null)}
          onOpenSelfie={() => setSelfieModal(true)}
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
          Alert.alert('Connecté', `Bienvenue ${loginRole === 'organizer' ? 'organisateur' : 'photographe'}`);
        }}
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

  welcome: { fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 30, color: C.text, marginTop: 14, marginBottom: 14, fontWeight: '700' },
  welcomeAccent: { color: C.primary },

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

  eventCard: { height: 140, borderRadius: 20, overflow: 'hidden', marginBottom: 14, backgroundColor: '#222' },
  heartBtn: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  eventCardBottom: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  eventDate: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1, opacity: 0.9, marginBottom: 4 },
  eventName: { color: '#fff', fontSize: 22, fontWeight: '700', fontFamily: 'AVEstiana', fontStyle: 'normal' },
  eventLocation: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },

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

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: C.white, flexDirection: 'row', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 4 },
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
});
