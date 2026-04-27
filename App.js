import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, ScrollView, Modal, FlatList,
  Dimensions, Share, StatusBar, Linking, SafeAreaView
} from 'react-native';
import { Image } from 'expo-image';
import { SvgXml } from 'react-native-svg';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';

const WORKER_URL = "https://will-api.geoffreyzigante.workers.dev";
const R2_PUBLIC = "https://pub-f9a5894e66a44f8cbb34582302930449.r2.dev";
const COOLDOWN_MS = 2000;
const DETECTION_INTERVAL = 100;
const { width: SCREEN_W } = Dimensions.get('window');
const VIOLET = '#7B2FFF';
const VIOLET_LIGHT = '#EDE5FF';
const BG = '#F5F3FF';
const WHITE = '#FFFFFF';
const DARK = '#1A1A2E';
const GRAY = '#9B8EC4';

const EVENT_TYPES = ['Trail', 'Course sur route', 'Cross', 'Hyrox', 'Triathlon', 'Velo', 'Marche', 'Autre'];
const TYPE_COLORS = {
  'Trail': '#4A9E7A', 'Course sur route': '#5B82C4', 'Cross': '#B05A4A',
  'Hyrox': '#4A4A4A', 'Triathlon': '#4A8A9E', 'Velo': '#7A5AB0',
  'Marche': '#9E8A4A', 'Autre': '#6A6A6A',
};
const getColor = (type) => TYPE_COLORS[type] || '#5B2FFF';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.48 14.84">
  <path d="M3.24,14.84L0,4.24h3.05l1.74,7.76h.42l1.8-7.76h3.69l1.8,7.76h.42l1.74-7.76h3.05l-3.24,10.6h-3.69l-1.72-7.76h-.42l-1.72,7.76h-3.69Z" fill="COLOR"/>
  <rect x="18.3" y="0" width="3.7" height="3.44" rx="1.72" ry="1.72" fill="COLOR"/>
  <rect x="18.67" y="4.24" width="2.97" height="10.6" fill="COLOR"/>
  <path d="M23.06,0h2.97v14.84h-2.97V0Z" fill="COLOR"/>
  <path d="M27.51,0h2.97v14.84h-2.97V0Z" fill="COLOR"/>
</svg>`;

function WillLogo({ size = 22, color = DARK }) {
  return <SvgXml xml={LOGO_SVG.replace(/COLOR/g, color)} width={size * (30.48 / 14.84)} height={size} />;
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────

function BottomNav({ activeTab, onTabChange, photoCount = 0 }) {
  return (
    <View style={s.bottomNav}>
      <TouchableOpacity style={s.navItem} onPress={() => onTabChange('home')}>
        <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${activeTab === 'home' ? VIOLET : '#C4B8E8'}"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`} width={24} height={24} />
        <Text style={[s.navLabel, activeTab === 'home' && s.navLabelActive]}>Accueil</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.navItem} onPress={() => onTabChange('photos')}>
        <View>
          <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${activeTab === 'photos' ? VIOLET : '#C4B8E8'}"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`} width={24} height={24} />
          {photoCount > 0 && (
            <View style={s.navBadge}>
              <Text style={s.navBadgeText}>{photoCount > 9 ? '9+' : photoCount}</Text>
            </View>
          )}
        </View>
        <Text style={[s.navLabel, activeTab === 'photos' && s.navLabelActive]}>Photos</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Selfie Block ─────────────────────────────────────────────────────────────

function SelfieBlock({ onPress }) {
  return (
    <TouchableOpacity style={s.selfieBlock} onPress={onPress} activeOpacity={0.9}>
      <LinearGradient colors={[VIOLET, '#5B2FCC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.selfieGradient}>
        <View style={s.selfieContent}>
          <View style={s.selfieText}>
            <Text style={s.selfieTitle}>Prendre{'\n'}un selfie</Text>
            <Text style={s.selfieDesc}>Recevoir mes photos{'\n'}automatiquement</Text>
          </View>
          <LinearGradient colors={['#EDE5FF', '#D4C5FF']} style={s.selfieAvatar}>
            <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${VIOLET}" opacity="0.4"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`} width={48} height={48} />
          </LinearGradient>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({ event, onPress, onFavorite, isFavorite }) {
  const color = getColor(event.event_type);
  return (
    <TouchableOpacity style={s.eventCard} onPress={() => onPress(event)} activeOpacity={0.92}>
      {event.cover_image ? (
        <Image source={{ uri: event.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#c8c4be' }]} />
      )}
      <LinearGradient colors={['transparent', color + 'DD', color]} locations={[0.3, 0.7, 1]} style={StyleSheet.absoluteFill} />
      <TouchableOpacity style={s.favoriteBtn} onPress={() => onFavorite && onFavorite(event.code)}>
        <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${isFavorite ? '#FF6B6B' : 'white'}" opacity="${isFavorite ? 1 : 0.7}"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`} width={18} height={18} />
      </TouchableOpacity>
      <View style={s.eventCardContent}>
        <Text style={s.eventCardDate}>{event.event_date ? new Date(event.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : 'DATE A VENIR'}</Text>
        <Text style={s.eventCardName} numberOfLines={1}>{event.name}</Text>
        <Text style={s.eventCardLoc} numberOfLines={1}>{event.location || event.code}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Home Tab ─────────────────────────────────────────────────────────────────

function HomeTab({ onEventPress, onOrgPress, onProfilePress, orgSession, favorites, onFavorite }) {
  const [events, setEvents] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('future');

  useEffect(() => {
    fetch(WORKER_URL + '/public-events')
      .then(r => r.json())
      .then(data => { setAllEvents(data); setEvents(data); })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const future = events.filter(e => !e.event_date || new Date(e.event_date) >= now).sort((a, b) => (a.event_date || '') < (b.event_date || '') ? -1 : 1);
  const past = events.filter(e => e.event_date && new Date(e.event_date) < now).sort((a, b) => a.event_date < b.event_date ? 1 : -1);
  const displayed = tab === 'future' ? future : past;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={s.homeHeader}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={s.bellBtn}>
            <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${DARK}"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`} width={22} height={22} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.profileBtn, orgSession && { backgroundColor: VIOLET }]} onPress={orgSession ? onProfilePress : onOrgPress}>
            <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${WHITE}"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`} width={20} height={20} />
          </TouchableOpacity>
        </View>
        {orgSession ? (
          <TouchableOpacity style={s.orgPill} onPress={onOrgPress}>
            <Text style={s.orgPillText}>Organisation</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={s.welcomeRow}>
        <Text style={s.welcomeText}>Bienvenue chez </Text>
        <WillLogo size={18} color={VIOLET} />
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
        <SelfieBlock onPress={() => {}} />
      </View>

      <TouchableOpacity style={s.searchBtn}>
        <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${GRAY}"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`} width={18} height={18} />
        <Text style={s.searchBtnText}>Trouver mon événement</Text>
      </TouchableOpacity>

      <View style={s.tabsRow}>
        <Text style={s.tabsLabel}>Événements</Text>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tabBtn, tab === 'future' && s.tabBtnActive]} onPress={() => setTab('future')}>
            <Text style={[s.tabBtnText, tab === 'future' && s.tabBtnTextActive]}>à venir</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tabBtn, tab === 'past' && s.tabBtnActive]} onPress={() => setTab('past')}>
            <Text style={[s.tabBtnText, tab === 'past' && s.tabBtnTextActive]}>passés</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={VIOLET} /></View>
      ) : (
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {displayed.map(e => (
            <EventCard key={e.code} event={e} onPress={onEventPress} onFavorite={onFavorite} isFavorite={favorites.includes(e.code)} />
          ))}
          {displayed.length === 0 && <Text style={{ color: GRAY, textAlign: 'center', padding: 20 }}>Aucun événement</Text>}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Photos Tab ───────────────────────────────────────────────────────────────

function PhotosTab() {
  const THUMB = (SCREEN_W - 64) / 4;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
        <TouchableOpacity style={s.bellBtn}>
          <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${DARK}"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`} width={22} height={22} />
        </TouchableOpacity>
        <TouchableOpacity style={[s.profileBtn, { backgroundColor: DARK }]}>
          <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${WHITE}"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`} width={20} height={20} />
        </TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
        <SelfieBlock onPress={() => {}} />
      </View>
      <Text style={s.sectionTitle}>Mes photos</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 8, marginBottom: 24 }}>
        {[...Array(3)].map((_, i) => (
          <View key={i} style={{ width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: VIOLET_LIGHT, alignItems: 'center', justifyContent: 'center' }}>
            <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${VIOLET}" opacity="0.3"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`} width={20} height={20} />
          </View>
        ))}
      </View>
      <Text style={s.sectionTitle}>Ma galerie</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, gap: 8 }}>
        {[...Array(9)].map((_, i) => (
          <View key={i} style={{ width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: VIOLET_LIGHT, alignItems: 'center', justifyContent: 'center' }}>
            {(i === 3 || i === 7) && <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${VIOLET}" opacity="0.3"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`} width={20} height={20} />}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Event Detail ─────────────────────────────────────────────────────────────

function EventDetailScreen({ event, onBack, onTabChange }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [filter, setFilter] = useState('all');
  const [photographers, setPhotographers] = useState([]);
  const color = getColor(event.event_type);
  const THUMB = (SCREEN_W - 6) / 3;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(WORKER_URL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: event.code, password: 'public', role: 'participant' }) });
        const session = await res.json();
        if (!res.ok) { setLoading(false); return; }
        const pr = await fetch(`${WORKER_URL}/list-photos/${event.code}/`, { headers: { Authorization: `Bearer ${session.token}` } });
        const data = await pr.json();
        const list = Array.isArray(data) ? data.reverse() : [];
        setPhotos(list);
        setPhotographers([...new Set(list.map(p => p.split('/')[1]))].filter(Boolean));
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  const filtered = filter === 'all' ? photos : photos.filter(p => p.split('/')[1] === filter);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="light-content" />
      <View style={{ height: 280, position: 'relative' }}>
        {event.cover_image ? <Image source={{ uri: event.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />}
        <LinearGradient colors={['transparent', color + 'EE']} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={s.detailBack} onPress={onBack}>
          <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`} width={20} height={20} />
        </TouchableOpacity>
        <TouchableOpacity style={s.detailClose} onPress={onBack}>
          <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" opacity="0.7"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`} width={20} height={20} />
        </TouchableOpacity>
        <View style={s.detailInfo}>
          <Text style={s.detailDate}>{event.event_date ? new Date(event.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : 'DATE A VENIR'}</Text>
          <Text style={s.detailName}>{event.name}</Text>
          <Text style={s.detailLoc}>{event.location || ''}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, marginTop: 16, marginBottom: 16 }}>
        <SelfieBlock onPress={() => {}} />
      </View>

      {photographers.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={[s.sectionTitle, { marginBottom: 8 }]}>Emplacement</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            {['all', ...photographers].map(p => (
              <TouchableOpacity key={p} style={[s.kmChip, filter === p && s.kmChipActive]} onPress={() => setFilter(p)}>
                <Text style={[s.kmChipText, filter === p && s.kmChipTextActive]}>{p === 'all' ? 'Tous' : p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={VIOLET} /></View>
      ) : (
        <FlatList
          data={filtered}
          numColumns={3}
          keyExtractor={item => item}
          contentContainerStyle={{ gap: 2, padding: 2, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: THUMB, height: THUMB, margin: 1 }} onPress={() => setSelectedPhoto(item)} activeOpacity={0.9}>
              <Image source={{ uri: `${R2_PUBLIC}/${item}` }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" />
              <TouchableOpacity style={{ position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.3)', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" opacity="0.7"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`} width={14} height={14} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      <BottomNav activeTab="home" onTabChange={onTabChange} />

      {selectedPhoto && (
        <Modal visible animationType="fade" onRequestClose={() => setSelectedPhoto(null)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <TouchableOpacity style={{ position: 'absolute', top: 60, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 }} onPress={() => setSelectedPhoto(null)}>
              <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
            <Image source={{ uri: `${R2_PUBLIC}/${selectedPhoto}` }} style={{ flex: 1, width: '100%' }} contentFit="contain" />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 44, backgroundColor: 'rgba(0,0,0,0.9)' }}>
              <Text style={{ color: '#555', fontSize: 11, flex: 1, marginRight: 12 }} numberOfLines={1}>{selectedPhoto.split('/').pop()}</Text>
              <TouchableOpacity style={{ backgroundColor: VIOLET, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 }} onPress={() => Share.share({ url: `${R2_PUBLIC}/${selectedPhoto}` })}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Partager</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Org Login ────────────────────────────────────────────────────────────────

function OrgLoginView({ onBack, onLogin }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('now');

  useEffect(() => {
    fetch(WORKER_URL + '/public-events').then(r => r.json())
      .then(data => { const now = new Date(); setEvents((data || []).filter(e => !e.event_date || (new Date(e.event_date) - now) > -7 * 86400000)); })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const nowEvts = events.filter(e => { if (!e.event_date) return false; const d = (new Date(e.event_date) - now) / 86400000; return d >= -1 && d <= 1; });
  const futureEvts = events.filter(e => e.event_date && (new Date(e.event_date) - now) / 86400000 > 1);
  const noDateEvts = events.filter(e => !e.event_date);
  const tabEvts = tab === 'now' ? nowEvts : tab === 'future' ? futureEvts : noDateEvts;

  const login = async () => {
    if (!selected || !password) { setError('Champs requis'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(WORKER_URL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: selected.code, password, role: 'organizer', photographer_name: 'organisateur' }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Mot de passe incorrect'); return; }
      onLogin({ ...data, _isOrg: true });
    } catch (e) { setError('Erreur'); } finally { setSubmitting(false); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: VIOLET, fontSize: 14, fontWeight: '600' }}>← Retour</Text>
      </TouchableOpacity>
      <Text style={s.modalSectionLabel}>Ton événement</Text>
      <View style={s.chipRow}>
        {[{ id: 'now', label: 'En ce moment', count: nowEvts.length }, { id: 'future', label: 'À venir', count: futureEvts.length }, { id: 'nodate', label: 'Sans date', count: noDateEvts.length }].filter(t => t.count > 0).map(t => (
          <TouchableOpacity key={t.id} style={[s.tabChip, tab === t.id && s.tabChipActive]} onPress={() => setTab(t.id)}>
            <Text style={[s.tabChipText, tab === t.id && s.tabChipTextActive]}>{t.label} ({t.count})</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator color={VIOLET} style={{ marginVertical: 20 }} /> : (
        <View style={{ gap: 8, marginBottom: 20 }}>
          {tabEvts.map(e => (
            <TouchableOpacity key={e.code} style={[s.eventPickerItem, selected?.code === e.code && s.eventPickerItemActive]} onPress={() => { setSelected(e); setError(''); }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.eventPickerName, selected?.code === e.code && { color: WHITE }]}>{e.name}</Text>
                {e.event_date && <Text style={[s.eventPickerDate, selected?.code === e.code && { color: 'rgba(255,255,255,0.6)' }]}>{new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>}
              </View>
              {selected?.code === e.code && <Text style={{ color: WHITE }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {selected && (
        <>
          <Text style={s.modalSectionLabel}>Mot de passe organisateur</Text>
          <TextInput style={s.modalInput} value={password} onChangeText={setPassword} placeholder="Mot de passe" placeholderTextColor={GRAY} secureTextEntry />
        </>
      )}
      {error ? <Text style={s.errText}>{error}</Text> : null}
      {selected && (
        <TouchableOpacity style={[s.primaryBtn, submitting && { opacity: 0.6 }]} onPress={login} disabled={submitting}>
          {submitting ? <ActivityIndicator color={WHITE} /> : <Text style={s.primaryBtnText}>Accéder à mon espace</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── Photographer Login ───────────────────────────────────────────────────────

function PhotographerLoginView({ onBack, onLogin }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('now');

  useEffect(() => {
    fetch(WORKER_URL + '/public-events').then(r => r.json())
      .then(data => { const now = new Date(); setEvents((data || []).filter(e => !e.event_date || (new Date(e.event_date) - now) > -7 * 86400000)); })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const nowEvts = events.filter(e => { if (!e.event_date) return false; const d = (new Date(e.event_date) - now) / 86400000; return d >= -1 && d <= 1; });
  const futureEvts = events.filter(e => e.event_date && (new Date(e.event_date) - now) / 86400000 > 1);
  const noDateEvts = events.filter(e => !e.event_date);
  const tabEvts = tab === 'now' ? nowEvts : tab === 'future' ? futureEvts : noDateEvts;

  const login = async () => {
    if (!selected || !password || !name) { setError('Champs requis'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(WORKER_URL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: selected.code, password, role: 'organizer', photographer_name: name.trim() }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Mot de passe incorrect'); return; }
      onLogin(data);
    } catch (e) { setError('Erreur'); } finally { setSubmitting(false); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 20 }}>
        <Text style={{ color: VIOLET, fontSize: 14, fontWeight: '600' }}>← Retour</Text>
      </TouchableOpacity>
      <Text style={s.modalSectionLabel}>Ton événement</Text>
      <View style={s.chipRow}>
        {[{ id: 'now', label: 'En ce moment', count: nowEvts.length }, { id: 'future', label: 'À venir', count: futureEvts.length }, { id: 'nodate', label: 'Sans date', count: noDateEvts.length }].filter(t => t.count > 0).map(t => (
          <TouchableOpacity key={t.id} style={[s.tabChip, tab === t.id && s.tabChipActive]} onPress={() => setTab(t.id)}>
            <Text style={[s.tabChipText, tab === t.id && s.tabChipTextActive]}>{t.label} ({t.count})</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ gap: 8, marginBottom: 20 }}>
        {tabEvts.map(e => (
          <TouchableOpacity key={e.code} style={[s.eventPickerItem, selected?.code === e.code && s.eventPickerItemActive]} onPress={() => { setSelected(e); setError(''); }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.eventPickerName, selected?.code === e.code && { color: WHITE }]}>{e.name}</Text>
              {e.event_date && <Text style={[s.eventPickerDate, selected?.code === e.code && { color: 'rgba(255,255,255,0.6)' }]}>{new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>}
            </View>
            {selected?.code === e.code && <Text style={{ color: WHITE }}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
      {selected && (
        <>
          <Text style={s.modalSectionLabel}>Mot de passe</Text>
          <TextInput style={s.modalInput} value={password} onChangeText={setPassword} placeholder="Mot de passe photographes" placeholderTextColor={GRAY} secureTextEntry />
          <Text style={s.modalSectionLabel}>Ton nom</Text>
          <TextInput style={s.modalInput} value={name} onChangeText={setName} placeholder="ex: Geoffrey" placeholderTextColor={GRAY} autoCorrect={false} />
        </>
      )}
      {error ? <Text style={s.errText}>{error}</Text> : null}
      {selected && (
        <TouchableOpacity style={[s.primaryBtn, submitting && { opacity: 0.6 }]} onPress={login} disabled={submitting}>
          {submitting ? <ActivityIndicator color={WHITE} /> : <Text style={s.primaryBtnText}>Rejoindre {selected.name}</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ─── Org Modal ────────────────────────────────────────────────────────────────

function OrgModal({ visible, onClose, onLogin }) {
  const [view, setView] = useState('menu');
  const close = () => { setView('menu'); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Organisation</Text>
              <TouchableOpacity onPress={close} style={s.modalCloseBtn}><Text style={{ color: GRAY, fontSize: 16 }}>✕</Text></TouchableOpacity>
            </View>
            {view === 'menu' && (
              <View style={{ gap: 12 }}>
                {[
                  { title: 'Espace organisateur', desc: 'Gérer mon événement', icon: '⚙️', action: () => setView('org') },
                  { title: 'Rejoindre comme photographe', desc: 'Prendre des photos', icon: '📷', action: () => setView('photo') },
                  { title: 'Créer un événement', desc: 'Soumettre un événement', icon: '➕', action: () => { close(); onLogin({ role: 'create_event' }); } },
                ].map((item, i) => (
                  <TouchableOpacity key={i} style={s.menuItem} onPress={item.action}>
                    <Text style={{ fontSize: 24, marginRight: 14 }}>{item.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.menuItemTitle}>{item.title}</Text>
                      <Text style={s.menuItemDesc}>{item.desc}</Text>
                    </View>
                    <SvgXml xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${VIOLET}"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`} width={20} height={20} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {view === 'org' && <OrgLoginView onBack={() => setView('menu')} onLogin={(d) => { close(); onLogin(d); }} />}
            {view === 'photo' && <PhotographerLoginView onBack={() => setView('menu')} onLogin={(d) => { close(); onLogin(d); }} />}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Org Profile ──────────────────────────────────────────────────────────────

function OrgProfileScreen({ session, onClose, onLogout }) {
  const [name, setName] = useState(session.event?.name || '');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [eventType, setEventType] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [photoCount, setPhotoCount] = useState(0);
  const [photographerCount, setPhotographerCount] = useState(0);

  useEffect(() => {
    fetch(`${WORKER_URL}/auth/event/${session.event.code}`).then(r => r.json()).then(d => {
      if (d.name) setName(d.name); if (d.event_date) setEventDate(d.event_date);
      if (d.location) setLocation(d.location); if (d.website) setWebsite(d.website);
      if (d.event_type) setEventType(d.event_type); if (d.cover_image) setCoverPreview(d.cover_image);
    }).catch(() => {});
    fetch(`${WORKER_URL}/list-photos/${session.event.code}/`, { headers: { Authorization: `Bearer ${session.token}` } }).then(r => r.json()).then(d => {
      if (Array.isArray(d)) { setPhotoCount(d.length); setPhotographerCount([...new Set(d.map(p => p.split('/')[1]))].filter(Boolean).length); }
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const r = await fetch(`${WORKER_URL}/_auth/${session.event.code}/event.json`, { headers: { Authorization: 'Bearer will' } });
      const d = await r.json();
      Object.assign(d, { name, event_date: eventDate, location, website, event_type: eventType });
      await fetch(`${WORKER_URL}/_auth/${session.event.code}/event.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer will' }, body: JSON.stringify(d) });
      setSuccess('Sauvegardé !');
    } catch (e) { setError('Erreur'); } finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Mon événement</Text>
            <TouchableOpacity onPress={onClose} style={s.modalCloseBtn}><Text style={{ color: GRAY, fontSize: 16 }}>✕</Text></TouchableOpacity>
          </View>
        </SafeAreaView>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
            {[{ label: 'Photos', value: photoCount }, { label: 'Photographes', value: photographerCount }].map(stat => (
              <View key={stat.label} style={s.statCard}>
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
          {coverPreview ? <Image source={{ uri: coverPreview }} style={{ width: '100%', height: 150, borderRadius: 16, marginBottom: 20 }} contentFit="cover" /> : null}
          {[
            { label: 'Nom', value: name, set: setName },
            { label: 'Date (AAAA-MM-JJ)', value: eventDate, set: setEventDate, placeholder: '2026-03-29' },
            { label: 'Lieu', value: location, set: setLocation, placeholder: 'Gerardmer (88)' },
            { label: 'Site web', value: website, set: setWebsite, placeholder: 'https://...' },
          ].map((f, i) => (
            <View key={i} style={{ marginBottom: 14 }}>
              <Text style={s.fieldLabel}>{f.label}</Text>
              <TextInput style={s.fieldInput} value={f.value} onChangeText={f.set} placeholder={f.placeholder || ''} placeholderTextColor={GRAY} autoCapitalize="none" />
            </View>
          ))}
          <Text style={s.fieldLabel}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {EVENT_TYPES.map(t => (
              <TouchableOpacity key={t} style={[s.typeChip, eventType === t && { backgroundColor: getColor(t), borderColor: getColor(t) }]} onPress={() => setEventType(t === eventType ? '' : t)}>
                <Text style={[s.typeChipText, eventType === t && { color: WHITE }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {error ? <Text style={s.errText}>{error}</Text> : null}
          {success ? <Text style={{ color: '#10b981', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{success}</Text> : null}
          <TouchableOpacity style={[s.primaryBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={WHITE} /> : <Text style={s.primaryBtnText}>Sauvegarder</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
            <Text style={s.logoutBtnText}>Se déconnecter</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Create Event ─────────────────────────────────────────────────────────────

function CreateEventScreen({ onBack }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [eventType, setEventType] = useState('');
  const [password, setPassword] = useState('');
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const genCode = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const submit = async () => {
    if (!name || !password || !location) { setError('Nom, lieu et mot de passe requis'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const res = await fetch(WORKER_URL + '/auth/submit-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code: genCode(name), password, contact, date, location, website, event_type: eventType }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      setSuccess('Demande envoyée ! Code : ' + genCode(name));
    } catch (e) { setError('Erreur'); } finally { setLoading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView>
        <View style={[s.modalHeader, { marginTop: 20 }]}>
          <TouchableOpacity onPress={onBack}><Text style={{ color: VIOLET, fontSize: 14, fontWeight: '600' }}>← Retour</Text></TouchableOpacity>
          <Text style={s.modalTitle}>Créer un événement</Text>
          <View style={{ width: 60 }} />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {[
          { label: 'Nom *', value: name, set: setName, placeholder: 'Trail des Vosges 2026' },
          { label: 'Date (AAAA-MM-JJ)', value: date, set: setDate, placeholder: '2026-03-29' },
          { label: 'Lieu *', value: location, set: setLocation, placeholder: 'Gerardmer (88)' },
          { label: 'Site web', value: website, set: setWebsite, placeholder: 'https://...' },
          { label: 'Mot de passe *', value: password, set: setPassword, placeholder: '••••••', secure: true },
          { label: 'Email', value: contact, set: setContact, placeholder: 'ton@email.com' },
        ].map((f, i) => (
          <View key={i} style={{ marginBottom: 14 }}>
            <Text style={s.fieldLabel}>{f.label}</Text>
            <TextInput style={s.fieldInput} value={f.value} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor={GRAY} secureTextEntry={f.secure} autoCapitalize="none" />
          </View>
        ))}
        <Text style={s.fieldLabel}>Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
          {EVENT_TYPES.map(t => (
            <TouchableOpacity key={t} style={[s.typeChip, eventType === t && { backgroundColor: getColor(t), borderColor: getColor(t) }]} onPress={() => setEventType(t === eventType ? '' : t)}>
              <Text style={[s.typeChipText, eventType === t && { color: WHITE }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {name.length > 0 && <View style={s.codePreview}><Text style={s.codePreviewLabel}>Code généré</Text><Text style={s.codePreviewValue}>{genCode(name)}</Text></View>}
        {error ? <Text style={s.errText}>{error}</Text> : null}
        {success ? <Text style={{ color: '#10b981', fontSize: 13, marginBottom: 8 }}>{success}</Text> : null}
        <TouchableOpacity style={[s.primaryBtn, loading && { opacity: 0.6 }]} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color={WHITE} /> : <Text style={s.primaryBtnText}>Soumettre la demande</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Photographe ─────────────────────────────────────────────────────────────

function OrganizerScreen({ session, onLogout }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('idle');
  const [photoCount, setPhotoCount] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [debugText, setDebugText] = useState('Prêt');
  const cameraRef = useRef(null);
  const shootingRef = useRef(false);
  const lastBurstRef = useRef(0);
  const personGoneTimerRef = useRef(null);
  const detectionIntervalRef = useRef(null);
  const lastFrameSizeRef = useRef(0);
  const frameCountRef = useRef(0);
  const personPresentRef = useRef(false);

  const onPersonStatus = useCallback((detected) => {
    if (detected) {
      personPresentRef.current = true; setStatus('person');
      if (personGoneTimerRef.current) { clearTimeout(personGoneTimerRef.current); personGoneTimerRef.current = null; }
      const now = Date.now();
      if (!shootingRef.current && now - lastBurstRef.current > COOLDOWN_MS) { lastBurstRef.current = now; startBurst(); }
    } else {
      if (!personGoneTimerRef.current && personPresentRef.current) {
        personGoneTimerRef.current = setTimeout(() => { personPresentRef.current = false; setStatus('idle'); personGoneTimerRef.current = null; }, 800);
      }
    }
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (!cameraRef.current || shootingRef.current) return;
    try {
      const frame = await cameraRef.current.takePictureAsync({ quality: 0.02, base64: true, skipProcessing: true, exif: false });
      frameCountRef.current += 1;
      const size = frame.base64?.length || 0;
      const ratio = lastFrameSizeRef.current > 0 ? Math.abs(size - lastFrameSizeRef.current) / lastFrameSizeRef.current : 0;
      lastFrameSizeRef.current = size;
      setDebugText(`${frameCountRef.current} — ${Math.round(ratio * 100)}%`);
      onPersonStatus(ratio > 0.03);
    } catch (e) {}
  }, [onPersonStatus]);

  const startDetection = useCallback(() => {
    if (detectionIntervalRef.current) return;
    lastFrameSizeRef.current = 0; frameCountRef.current = 0; setDetecting(true);
    detectionIntervalRef.current = setInterval(analyzeFrame, DETECTION_INTERVAL);
  }, [analyzeFrame]);

  const stopDetection = useCallback(() => {
    if (detectionIntervalRef.current) { clearInterval(detectionIntervalRef.current); detectionIntervalRef.current = null; }
    setDetecting(false); personPresentRef.current = false; setStatus('idle');
  }, []);

  const startBurst = async () => {
    if (!cameraRef.current || shootingRef.current) return;
    shootingRef.current = true; setStatus('shooting');
    const ts = Date.now(), now = new Date();
    const hms = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    for (let i = 0; i < 8; i++) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.92 });
        setPhotoCount(c => c + 1);
        const key = `${session.event.code}/${session.photographer_id}/${date}/${hms}_${ts}_${String(i).padStart(3, '0')}.jpg`;
        fetch(photo.uri).then(r => r.blob()).then(blob => fetch(`${WORKER_URL}/${key}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${session.token}` }, body: blob }));
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {}
    }
    shootingRef.current = false; setStatus(personPresentRef.current ? 'person' : 'idle');
  };

  useEffect(() => () => stopDetection(), []);

  if (!permission?.granted) return (
    <View style={{ flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center', gap: 24, padding: 32 }}>
      <WillLogo size={24} />
      <TouchableOpacity style={s.primaryBtn} onPress={requestPermission}>
        <Text style={s.primaryBtnText}>Autoriser la caméra</Text>
      </TouchableOpacity>
    </View>
  );

  const sc = { idle: '#94a3b8', person: '#f59e0b', shooting: '#4ade80' }[status] || '#94a3b8';
  const sl = { idle: detecting ? 'En surveillance' : 'Arrêté', person: 'Mouvement !', shooting: 'Rafale...' }[status];

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1 }} facing="back" ref={cameraRef}>
        <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 }}>
            <View>
              <Text style={{ color: WHITE, fontSize: 13, fontWeight: '700' }}>{session.event.name}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>{session.photographer_id}</Text>
            </View>
            <TouchableOpacity onPress={onLogout} style={{ backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>← Quitter</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {status === 'shooting' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 }}>
                <View style={{ width: 7, height: 7, backgroundColor: '#ef4444', borderRadius: 4 }} />
                <Text style={{ color: WHITE, fontSize: 13, fontWeight: '800', letterSpacing: 3 }}>REC</Text>
              </View>
            )}
          </View>
          <View style={{ gap: 8, alignItems: 'center', padding: 24, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: sc }}>
              <View style={{ width: 6, height: 6, backgroundColor: sc, borderRadius: 3 }} />
              <Text style={{ color: WHITE, fontSize: 12, fontWeight: '600' }}>{sl}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginLeft: 8 }}>{debugText}</Text>
            </View>
            <Text style={{ color: WHITE, fontSize: 40, fontWeight: '900', marginVertical: 4 }}>{photoCount}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginBottom: 8, letterSpacing: 2, textTransform: 'uppercase' }}>photos</Text>
            <TouchableOpacity style={[{ paddingVertical: 16, width: '100%', alignItems: 'center', borderRadius: 16 }, detecting ? { backgroundColor: '#ef4444' } : { backgroundColor: VIOLET }]} onPress={detecting ? stopDetection : startDetection}>
              <Text style={{ color: WHITE, fontSize: 16, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>{detecting ? 'Arrêter' : 'Démarrer'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: 'rgba(255,255,255,0.07)', paddingVertical: 12, width: '100%', alignItems: 'center', borderRadius: 16 }} onPress={() => startBurst()}>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Déclencher manuellement</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(null);
  const [orgSession, setOrgSession] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [detailEvent, setDetailEvent] = useState(null);
  const [showOrg, setShowOrg] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [fontsLoaded] = useFonts({ 'AVEstiana': require('./assets/fonts/AV_Estiana-VF.ttf') });

  const handleLogin = (s) => {
    if (s.role === 'create_event') { setSession(s); return; }
    if (s.role === 'participant') { setSession(s); return; }
    if (s.role === 'organizer') {
      if (s._isOrg) { setOrgSession(s); return; }
      setSession(s); return;
    }
    setSession(s);
  };

  const toggleFavorite = (code) => setFavorites(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);

  if (session?.role === 'create_event') return <CreateEventScreen onBack={() => setSession(null)} />;
  if (session?.role === 'organizer') return <OrganizerScreen session={session} onLogout={() => setSession(null)} />;

  if (detailEvent) return (
    <EventDetailScreen event={detailEvent} onBack={() => setDetailEvent(null)} onTabChange={(tab) => { setDetailEvent(null); setActiveTab(tab); }} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {activeTab === 'home' && (
            <HomeTab onEventPress={setDetailEvent} onOrgPress={() => setShowOrg(true)} onProfilePress={() => setShowProfile(true)} orgSession={orgSession} favorites={favorites} onFavorite={toggleFavorite} />
          )}
          {activeTab === 'photos' && <PhotosTab />}
        </View>
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} photoCount={favorites.length} />
      </SafeAreaView>
      <OrgModal visible={showOrg} onClose={() => setShowOrg(false)} onLogin={handleLogin} />
      {showProfile && orgSession && (
        <OrgProfileScreen session={orgSession} onClose={() => setShowProfile(false)} onLogout={() => { setShowProfile(false); setOrgSession(null); }} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  bottomNav: { flexDirection: 'row', backgroundColor: WHITE, borderTopWidth: 1, borderTopColor: '#EDE5FF', paddingBottom: Platform.OS === 'ios' ? 0 : 8, paddingTop: 8 },
  navItem: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  navLabel: { fontSize: 11, color: '#C4B8E8', fontWeight: '500' },
  navLabelActive: { color: VIOLET, fontWeight: '700' },
  navBadge: { position: 'absolute', top: -4, right: -8, backgroundColor: VIOLET, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navBadgeText: { color: WHITE, fontSize: 9, fontWeight: '700' },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  bellBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center', shadowColor: VIOLET, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  profileBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: DARK, alignItems: 'center', justifyContent: 'center' },
  orgPill: { backgroundColor: VIOLET_LIGHT, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  orgPillText: { color: VIOLET, fontSize: 13, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  welcomeText: { fontSize: 18, fontFamily: 'AVEstiana', fontStyle: 'normal', color: DARK },
  selfieBlock: { borderRadius: 20, overflow: 'hidden' },
  selfieGradient: { padding: 20 },
  selfieContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selfieText: { flex: 1 },
  selfieTitle: { fontSize: 22, fontFamily: 'AVEstiana', fontStyle: 'normal', color: WHITE, marginBottom: 6 },
  selfieDesc: { fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 18 },
  selfieAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 16 },
  searchBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: WHITE, marginHorizontal: 20, marginBottom: 20, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, shadowColor: VIOLET, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  searchBtnText: { fontSize: 14, color: GRAY },
  tabsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12 },
  tabsLabel: { fontSize: 16, fontFamily: 'AVEstiana', fontStyle: 'normal', color: DARK },
  tabs: { flexDirection: 'row', backgroundColor: VIOLET_LIGHT, borderRadius: 20, padding: 3 },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 17 },
  tabBtnActive: { backgroundColor: VIOLET },
  tabBtnText: { fontSize: 12, fontWeight: '600', color: GRAY },
  tabBtnTextActive: { color: WHITE },
  eventCard: { height: 110, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  favoriteBtn: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.3)', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  eventCardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  eventCardDate: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.5, marginBottom: 2 },
  eventCardName: { fontSize: 16, fontFamily: 'AVEstiana', fontStyle: 'normal', color: WHITE, marginBottom: 1 },
  eventCardLoc: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },
  sectionTitle: { fontSize: 16, fontFamily: 'AVEstiana', fontStyle: 'normal', color: DARK, paddingHorizontal: 20, marginBottom: 12 },
  detailBack: { position: 'absolute', top: 56, left: 20, backgroundColor: 'rgba(0,0,0,0.3)', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  detailClose: { position: 'absolute', top: 56, right: 20, backgroundColor: 'rgba(0,0,0,0.3)', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  detailInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 },
  detailDate: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 2, marginBottom: 4 },
  detailName: { fontSize: 26, fontFamily: 'AVEstiana', fontStyle: 'normal', color: WHITE, marginBottom: 4 },
  detailLoc: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  kmChip: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: WHITE, borderRadius: 20, borderWidth: 1.5, borderColor: VIOLET_LIGHT },
  kmChipActive: { backgroundColor: VIOLET, borderColor: VIOLET },
  kmChipText: { fontSize: 12, fontWeight: '700', color: VIOLET },
  kmChipTextActive: { color: WHITE },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: WHITE, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, backgroundColor: '#E5E0FF', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 24 },
  modalTitle: { fontSize: 22, fontFamily: 'AVEstiana', fontStyle: 'normal', color: DARK },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: VIOLET_LIGHT, alignItems: 'center', justifyContent: 'center' },
  modalSectionLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 },
  modalInput: { backgroundColor: BG, color: DARK, padding: 14, fontSize: 14, borderRadius: 12, borderWidth: 1.5, borderColor: VIOLET_LIGHT, marginBottom: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: BG, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: VIOLET_LIGHT },
  menuItemTitle: { fontSize: 15, fontWeight: '700', color: DARK, marginBottom: 2 },
  menuItemDesc: { fontSize: 12, color: GRAY },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  tabChip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: VIOLET_LIGHT, borderRadius: 20 },
  tabChipActive: { backgroundColor: VIOLET },
  tabChipText: { fontSize: 12, fontWeight: '600', color: VIOLET },
  tabChipTextActive: { color: WHITE },
  eventPickerItem: { padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: VIOLET_LIGHT, backgroundColor: BG, flexDirection: 'row', alignItems: 'center' },
  eventPickerItemActive: { backgroundColor: VIOLET, borderColor: VIOLET },
  eventPickerName: { fontSize: 14, fontWeight: '700', color: DARK, marginBottom: 2 },
  eventPickerDate: { fontSize: 11, color: GRAY },
  statCard: { flex: 1, backgroundColor: WHITE, padding: 16, borderRadius: 16, alignItems: 'center', shadowColor: VIOLET, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  statValue: { fontSize: 28, fontWeight: '900', color: DARK },
  statLabel: { fontSize: 10, color: GRAY, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: GRAY, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  fieldInput: { backgroundColor: WHITE, color: DARK, padding: 14, fontSize: 14, borderRadius: 12, borderWidth: 1.5, borderColor: VIOLET_LIGHT, marginBottom: 4 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: WHITE, borderRadius: 20, borderWidth: 1.5, borderColor: VIOLET_LIGHT, marginRight: 8 },
  typeChipText: { fontSize: 12, fontWeight: '600', color: GRAY },
  codePreview: { backgroundColor: VIOLET_LIGHT, padding: 14, borderRadius: 12, marginBottom: 16 },
  codePreviewLabel: { fontSize: 10, color: GRAY, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  codePreviewValue: { fontSize: 15, fontWeight: '700', color: VIOLET },
  primaryBtn: { backgroundColor: VIOLET, padding: 16, alignItems: 'center', borderRadius: 16, marginTop: 8 },
  primaryBtnText: { color: WHITE, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
  logoutBtn: { padding: 16, alignItems: 'center', marginTop: 8, borderRadius: 16, borderWidth: 1.5, borderColor: '#FECACA' },
  logoutBtnText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
  errText: { color: '#EF4444', fontSize: 12, marginBottom: 8, textAlign: 'center' },
});
