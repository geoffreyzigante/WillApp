import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, ScrollView, Modal, FlatList,
  Dimensions, Share, StatusBar, Linking
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
const THUMB_SIZE = (SCREEN_W - 6) / 3;
const VIOLET = '#5313b7';
const BG = '#efece8';

const EVENT_TYPES = ['Trail', 'Course sur route', 'Cross', 'Hyrox', 'Triathlon', 'Velo', 'Marche', 'Autre'];

const TYPE_COLORS = {
  'Trail': '#4A9E7A',
  'Course sur route': '#5B82C4',
  'Cross': '#B05A4A',
  'Hyrox': '#4A4A4A',
  'Triathlon': '#4A8A9E',
  'Velo': '#7A5AB0',
  'Marche': '#9E8A4A',
  'Autre': '#6A6A6A',
};
const getColor = (type) => TYPE_COLORS[type] || '#222222';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30.48 14.84">
  <path d="M3.24,14.84L0,4.24h3.05l1.74,7.76h.42l1.8-7.76h3.69l1.8,7.76h.42l1.74-7.76h3.05l-3.24,10.6h-3.69l-1.72-7.76h-.42l-1.72,7.76h-3.69Z" fill="COLOR"/>
  <rect x="18.3" y="0" width="3.7" height="3.44" rx="1.72" ry="1.72" fill="COLOR"/>
  <rect x="18.67" y="4.24" width="2.97" height="10.6" fill="COLOR"/>
  <path d="M23.06,0h2.97v14.84h-2.97V0Z" fill="COLOR"/>
  <path d="M27.51,0h2.97v14.84h-2.97V0Z" fill="COLOR"/>
</svg>`;

const PROFILE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
</svg>`;

function WillLogo({ size = 22, color = '#1a1a1a' }) {
  return <SvgXml xml={LOGO_SVG.replace(/COLOR/g, color)} width={size * (30.48 / 14.84)} height={size} />;
}

// ─── Visionneuse ──────────────────────────────────────────────────────────────

function PhotoViewer({ photo, onClose }) {
  if (!photo) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <TouchableOpacity style={{ position: 'absolute', top: 60, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
          <Text style={{ color: '#fff', fontSize: 14 }}>✕</Text>
        </TouchableOpacity>
        <Image source={{ uri: `${R2_PUBLIC}/${photo}` }} style={{ flex: 1, width: '100%' }} contentFit="contain" cachePolicy="memory-disk" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 44, backgroundColor: 'rgba(0,0,0,0.9)' }}>
          <Text style={{ color: '#555', fontSize: 11, flex: 1, marginRight: 12 }} numberOfLines={1}>{photo.split('/').pop()}</Text>
          <TouchableOpacity style={{ backgroundColor: VIOLET, paddingHorizontal: 16, paddingVertical: 8 }} onPress={() => Share.share({ url: `${R2_PUBLIC}/${photo}` })}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Partager</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Galerie ──────────────────────────────────────────────────────────────────

function GalleryScreen({ session, onLogout }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [filter, setFilter] = useState('all');
  const [photographers, setPhotographers] = useState([]);

  const load = async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res = await fetch(`${WORKER_URL}/list-photos/${session.event.code}/`, { headers: { Authorization: `Bearer ${session.token}` } });
      const data = await res.json();
      const list = Array.isArray(data) ? data.reverse() : [];
      setPhotos(list);
      setPhotographers([...new Set(list.map(p => p.split('/')[1]))].filter(Boolean));
    } catch (e) {} finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const i = setInterval(() => load(true), 30000); return () => clearInterval(i); }, []);

  const filtered = filter === 'all' ? photos : photos.filter(p => p.split('/')[1] === filter);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#e0ddd8' }}>
        <View>
          <Text style={{ fontSize: 16, fontFamily: 'AVEstiana', color: '#1a1a1a' }}>{session.event.name}</Text>
          <Text style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{filtered.length} photos</Text>
        </View>
        <TouchableOpacity onPress={onLogout} style={{ paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: '#e0ddd8', backgroundColor: '#fff' }}>
          <Text style={{ color: '#666', fontSize: 12 }}>← Retour</Text>
        </TouchableOpacity>
      </View>
      {photographers.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 40 }} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
          {['all', ...photographers].map(p => (
            <TouchableOpacity key={p} style={[{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0ddd8', marginRight: 6 }, filter === p && { backgroundColor: VIOLET, borderColor: VIOLET }]} onPress={() => setFilter(p)}>
              <Text style={[{ color: '#aaa', fontSize: 12, fontWeight: '600' }, filter === p && { color: '#fff' }]}>{p === 'all' ? 'Tous' : p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={VIOLET} /></View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#aaa', fontSize: 14 }}>Aucune photo pour le moment</Text>
        </View>
      ) : (
        <FlatList data={filtered} numColumns={3} keyExtractor={item => item}
          contentContainerStyle={{ gap: 2, padding: 2 }}
          onRefresh={() => load(true)} refreshing={refreshing} showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: THUMB_SIZE, height: THUMB_SIZE, margin: 1 }} onPress={() => setSelectedPhoto(item)} activeOpacity={0.9}>
              <Image source={{ uri: `${R2_PUBLIC}/${item}` }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" />
            </TouchableOpacity>
          )} />
      )}
      <PhotoViewer photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
    </View>
  );
}

// ─── Détail événement ─────────────────────────────────────────────────────────

function EventDetailScreen({ event, onBack }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [filter, setFilter] = useState('all');
  const [photographers, setPhotographers] = useState([]);
  const color = getColor(event.event_type);

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
      <View style={{ width: '100%', height: 260, position: 'relative' }}>
        {event.cover_image ? (
          <Image source={{ uri: event.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
        )}
        <LinearGradient colors={['transparent', color + 'EE']} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
        <TouchableOpacity style={{ position: 'absolute', top: 64, left: 20, backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 12, paddingVertical: 6 }} onPress={onBack}>
          <Text style={{ color: '#fff', fontSize: 13 }}>← Retour</Text>
        </TouchableOpacity>
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 2 }}>
              {event.event_date ? new Date(event.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : 'DATE A VENIR'}
            </Text>
            {event.event_type && <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ fontSize: 9, fontWeight: '700', color: '#fff', letterSpacing: 1 }}>{event.event_type}</Text></View>}
          </View>
          <Text style={{ fontSize: 24, fontFamily: 'AVEstiana', fontStyle: 'normal', color: '#fff', marginBottom: 3 }}>{event.name}</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{event.location || ''}</Text>
        </View>
      </View>
      {event.website && <TouchableOpacity style={{ borderBottomWidth: 1, borderColor: '#e0ddd8', paddingHorizontal: 20, paddingVertical: 12 }} onPress={() => Linking.openURL(event.website)}><Text style={{ color: VIOLET, fontSize: 13, fontWeight: '600' }}>Site de l'epreuve →</Text></TouchableOpacity>}
      {photographers.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 40, marginVertical: 2 }} contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center' }}>
          {['all', ...photographers].map(p => (
            <TouchableOpacity key={p} style={[{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0ddd8', marginRight: 6 }, filter === p && { backgroundColor: VIOLET, borderColor: VIOLET }]} onPress={() => setFilter(p)}>
              <Text style={[{ color: '#aaa', fontSize: 12, fontWeight: '600' }, filter === p && { color: '#fff' }]}>{p === 'all' ? 'Tous' : p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={VIOLET} /></View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#aaa', fontSize: 14 }}>Aucune photo pour le moment</Text></View>
      ) : (
        <FlatList data={filtered} numColumns={3} keyExtractor={item => item}
          contentContainerStyle={{ gap: 2, padding: 2 }} showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity style={{ width: THUMB_SIZE, height: THUMB_SIZE, margin: 1 }} onPress={() => setSelectedPhoto(item)} activeOpacity={0.9}>
              <Image source={{ uri: `${R2_PUBLIC}/${item}` }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" />
            </TouchableOpacity>
          )} />
      )}
      <PhotoViewer photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
    </View>
  );
}

// ─── Card événement ───────────────────────────────────────────────────────────

function EventCard({ event, onPress }) {
  const color = getColor(event.event_type);
  return (
    <TouchableOpacity style={{ marginHorizontal: 20, marginBottom: 10, height: 170, overflow: 'hidden' }} onPress={() => onPress(event)} activeOpacity={0.92}>
      {event.cover_image ? (
        <Image source={{ uri: event.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#c8c4be' }]} />
      )}
      <LinearGradient colors={['transparent', color + 'DD', color + 'FF']} locations={[0.25, 0.65, 1]} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 2, fontStyle: 'normal' }}>
            {event.event_date ? new Date(event.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase() : 'DATE A VENIR'}
          </Text>
          {event.event_type && <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 1, marginLeft: 6, fontStyle: 'normal' }}>· {event.event_type}</Text>}
        </View>
        <Text style={{ fontSize: 18, fontFamily: 'AVEstiana', fontStyle: 'normal', color: '#fff', marginBottom: 2 }} numberOfLines={1}>{event.name}</Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>{event.location || event.code}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Page Profil Organisateur ─────────────────────────────────────────────────

function OrgProfileScreen({ session, onClose, onLogout }) {
  const [name, setName] = useState(session.event?.name || '');
  const [eventDate, setEventDate] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [eventType, setEventType] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [photoCount, setPhotoCount] = useState(0);
  const [photographerCount, setPhotographerCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${WORKER_URL}/auth/event/${session.event.code}`)
      .then(r => r.json())
      .then(data => {
        if (data.name) setName(data.name);
        if (data.event_date) setEventDate(data.event_date);
        if (data.location) setLocation(data.location);
        if (data.website) setWebsite(data.website);
        if (data.event_type) setEventType(data.event_type);
        if (data.cover_image) setCoverPreview(data.cover_image);
      })
      .catch(() => {});

    fetch(`${WORKER_URL}/list-photos/${session.event.code}/`, { headers: { Authorization: `Bearer ${session.token}` } })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPhotoCount(data.length);
          setPhotographerCount([...new Set(data.map(p => p.split('/')[1]))].filter(Boolean).length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const eventRes = await fetch(`${WORKER_URL}/_auth/${session.event.code}/event.json`, { headers: { Authorization: 'Bearer will' } });
      const eventData = await eventRes.json();
      eventData.name = name;
      eventData.event_date = eventDate;
      eventData.location = location;
      eventData.website = website;
      eventData.event_type = eventType;
      await fetch(`${WORKER_URL}/_auth/${session.event.code}/event.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer will' },
        body: JSON.stringify(eventData)
      });
      setSuccess('Modifications sauvegardees !');
    } catch (e) { setError('Erreur lors de la sauvegarde'); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar barStyle="dark-content" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 64, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e0ddd8' }}>
          <Text style={{ fontSize: 18, fontFamily: 'AVEstiana', fontStyle: 'normal', color: '#1a1a1a' }}>Mon evenement</Text>
          <TouchableOpacity onPress={onClose} style={{ width: 30, height: 30, backgroundColor: '#e0ddd8', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#666', fontSize: 13 }}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
          {/* Stats */}
          {!loading && (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
              {[{ label: 'Photos', value: photoCount }, { label: 'Photographes', value: photographerCount }].map(stat => (
                <View key={stat.label} style={{ flex: 1, backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: '#e0ddd8', alignItems: 'center' }}>
                  <Text style={{ fontSize: 28, fontWeight: '900', color: '#1a1a1a' }}>{stat.value}</Text>
                  <Text style={{ fontSize: 10, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Cover */}
          {coverPreview ? (
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#888', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Photo de couverture</Text>
              <Image source={{ uri: coverPreview }} style={{ width: '100%', height: 150 }} contentFit="cover" cachePolicy="memory-disk" />
            </View>
          ) : null}

          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Nom</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 12 }} value={name} onChangeText={setName} />

          <Text style={{ color: '#888', fontSize: 10, marginBottom: 6, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
            {EVENT_TYPES.map(t => (
              <TouchableOpacity key={t} style={[{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0ddd8', marginRight: 6 }, eventType === t && { backgroundColor: getColor(t), borderColor: getColor(t) }]} onPress={() => setEventType(t === eventType ? '' : t)}>
                <Text style={[{ color: '#888', fontSize: 12, fontWeight: '600' }, eventType === t && { color: '#fff' }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Date (AAAA-MM-JJ)</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 12 }} value={eventDate} onChangeText={setEventDate} placeholder="2026-03-29" placeholderTextColor="#bbb" />

          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Lieu</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 12 }} value={location} onChangeText={setLocation} placeholder="Gerardmer (88), France" placeholderTextColor="#bbb" />

          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Site web</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 20 }} value={website} onChangeText={setWebsite} placeholder="https://..." placeholderTextColor="#bbb" autoCapitalize="none" />

          {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</Text> : null}
          {success ? <Text style={{ color: '#10b981', fontSize: 12, marginBottom: 8 }}>{success}</Text> : null}

          <TouchableOpacity style={[{ backgroundColor: '#000', padding: 15, alignItems: 'center' }, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>Sauvegarder</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={{ padding: 15, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#e0ddd8' }} onPress={onLogout}>
            <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '600' }}>Se deconnecter</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Modal Organisation ───────────────────────────────────────────────────────

function OrgLoginView({ onBack, onLogin }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('now');

  useEffect(() => {
    fetch(WORKER_URL + '/public-events')
      .then(r => r.json())
      .then(data => {
        const now = new Date();
        const filtered = Array.isArray(data) ? data.filter(e => {
          if (!e.event_date) return true;
          return (new Date(e.event_date) - now) > -7 * 24 * 60 * 60 * 1000;
        }) : [];
        setEvents(filtered);
      })
      .catch(() => setError('Impossible de charger les evenements'))
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const nowEvents = events.filter(e => { if (!e.event_date) return false; const diff = (new Date(e.event_date) - now) / (1000 * 60 * 60 * 24); return diff >= -1 && diff <= 1; });
  const futureEvents = events.filter(e => { if (!e.event_date) return false; return (new Date(e.event_date) - now) / (1000 * 60 * 60 * 24) > 1; });
  const noDateEvents = events.filter(e => !e.event_date);
  const getTabEvents = () => { if (activeTab === 'now') return nowEvents; if (activeTab === 'future') return futureEvents; return noDateEvents; };

  const login = async () => {
    if (!selectedEvent || !password || !name) { setError('Tous les champs sont requis'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(WORKER_URL + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: selectedEvent.code, password, role: 'organizer', photographer_name: name.trim() }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Mot de passe incorrect'); return; }
      onLogin(data);
    } catch (e) { setError('Impossible de contacter le serveur'); }
    finally { setSubmitting(false); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 20 }}>
        <Text style={{ color: '#000', fontSize: 14 }}>← Retour</Text>
      </TouchableOpacity>

      <Text style={{ color: '#888', fontSize: 10, marginBottom: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Choisis ton evenement</Text>

      <View style={{ flexDirection: 'row', marginBottom: 12, borderBottomWidth: 1, borderColor: '#e0ddd8' }}>
        {[{ id: 'now', label: 'En ce moment', count: nowEvents.length }, { id: 'future', label: 'A venir', count: futureEvents.length }, { id: 'nodate', label: 'Sans date', count: noDateEvents.length }]
          .filter(t => t.count > 0)
          .map(t => (
            <TouchableOpacity key={t.id} onPress={() => setActiveTab(t.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 2, borderColor: activeTab === t.id ? '#000' : 'transparent', marginBottom: -1 }}>
              <Text style={{ fontSize: 12, fontWeight: activeTab === t.id ? '700' : '400', color: activeTab === t.id ? '#1a1a1a' : '#aaa' }}>{t.label} ({t.count})</Text>
            </TouchableOpacity>
          ))}
      </View>

      {loading ? <ActivityIndicator color={VIOLET} style={{ marginVertical: 20 }} /> : getTabEvents().length === 0 ? (
        <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginVertical: 20 }}>Aucun evenement</Text>
      ) : (
        <View style={{ gap: 8, marginBottom: 20 }}>
          {getTabEvents().map(e => (
            <TouchableOpacity key={e.code}
              style={{ padding: 14, borderWidth: 1, borderColor: selectedEvent?.code === e.code ? '#000' : '#e0ddd8', backgroundColor: selectedEvent?.code === e.code ? '#1a1a1a' : BG, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              onPress={() => { setSelectedEvent(e); setError(''); }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: selectedEvent?.code === e.code ? '#fff' : '#1a1a1a' }}>{e.name}</Text>
                {e.event_date && <Text style={{ fontSize: 11, color: selectedEvent?.code === e.code ? 'rgba(255,255,255,0.6)' : '#aaa', marginTop: 2 }}>
                  {new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>}
              </View>
              {selectedEvent?.code === e.code && <Text style={{ color: '#fff', fontSize: 16 }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selectedEvent && (
        <>
          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Mot de passe</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 12 }} value={password} onChangeText={setPassword} placeholder="Mot de passe photographes" placeholderTextColor="#bbb" secureTextEntry />
          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Ton nom</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8' }} value={name} onChangeText={setName} placeholder="ex: Geoffrey" placeholderTextColor="#bbb" autoCorrect={false} />
        </>
      )}

      {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

      {selectedEvent && (
        <TouchableOpacity style={[{ backgroundColor: '#000', padding: 15, alignItems: 'center', marginTop: 16 }, submitting && { opacity: 0.6 }]} onPress={login} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>Rejoindre {selectedEvent.name}</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function OrganizerLoginView({ onBack, onLogin }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(WORKER_URL + '/public-events')
      .then(r => r.json())
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setError('Impossible de charger les evenements'))
      .finally(() => setLoading(false));
  }, []);

  const login = async () => {
    if (!selectedEvent || !password) { setError('Tous les champs sont requis'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(WORKER_URL + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: selectedEvent.code, password, role: 'organizer', photographer_name: 'organisateur' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Mot de passe incorrect'); return; }
      onLogin({ ...data, _isOrg: true });
    } catch (e) { setError('Impossible de contacter le serveur'); }
    finally { setSubmitting(false); }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity onPress={onBack} style={{ marginBottom: 20 }}>
        <Text style={{ color: '#000', fontSize: 14 }}>← Retour</Text>
      </TouchableOpacity>
      <Text style={{ color: '#888', fontSize: 10, marginBottom: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Ton evenement</Text>
      {loading ? <ActivityIndicator color={VIOLET} style={{ marginVertical: 20 }} /> : (
        <View style={{ gap: 8, marginBottom: 20 }}>
          {events.map(e => (
            <TouchableOpacity key={e.code}
              style={{ padding: 14, borderWidth: 1, borderColor: selectedEvent?.code === e.code ? '#000' : '#e0ddd8', backgroundColor: selectedEvent?.code === e.code ? '#1a1a1a' : BG, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              onPress={() => { setSelectedEvent(e); setError(''); }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: selectedEvent?.code === e.code ? '#fff' : '#1a1a1a' }}>{e.name}</Text>
                {e.event_date && <Text style={{ fontSize: 11, color: selectedEvent?.code === e.code ? 'rgba(255,255,255,0.6)' : '#aaa', marginTop: 2 }}>
                  {new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>}
              </View>
              {selectedEvent?.code === e.code && <Text style={{ color: '#fff', fontSize: 16 }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {selectedEvent && (
        <>
          <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Mot de passe organisateur</Text>
          <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8', marginBottom: 12 }}
            value={password} onChangeText={setPassword} placeholder="Mot de passe organisateur" placeholderTextColor="#bbb" secureTextEntry />
        </>
      )}
      {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</Text> : null}
      {selectedEvent && (
        <TouchableOpacity style={[{ backgroundColor: '#000', padding: 15, alignItems: 'center', marginTop: 16 }, submitting && { opacity: 0.6 }]} onPress={login} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>Acceder a mon espace</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function OrgModal({ visible, onClose, onLogin }) {
  const [view, setView] = useState('menu');
  const reset = () => { setView('menu'); };
  const close = () => { reset(); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ backgroundColor: '#fff', padding: 24, paddingBottom: 48, maxHeight: '90%' }}>
            <View style={{ width: 36, height: 3, backgroundColor: '#e0ddd8', alignSelf: 'center', marginBottom: 20 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <Text style={{ fontSize: 20, fontFamily: 'AVEstiana', fontStyle: 'normal', color: '#1a1a1a' }}>Organisation</Text>
              <TouchableOpacity onPress={close} style={{ width: 30, height: 30, backgroundColor: '#f0ede8', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#888', fontSize: 13 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {view === 'menu' && (
              <View style={{ gap: 10 }}>
                {[
                  { title: 'Espace organisateur', desc: 'Gere ton evenement et ses parametres', action: () => setView('org') },
                  { title: 'Espace organisateur', desc: 'Gere ton evenement et ses parametres', action: () => setView('org') },
                  { title: 'Rejoindre comme photographe', desc: 'Connecte-toi pour prendre des photos', action: () => setView('login') },
                  { title: 'Creer un evenement', desc: 'Soumettre un nouvel evenement Will', action: () => { close(); onLogin({ role: 'create_event' }); } },
                ].map((item, i) => (
                  <TouchableOpacity key={i} style={{ backgroundColor: BG, padding: 16, borderWidth: 1, borderColor: '#e0ddd8', flexDirection: 'row', alignItems: 'center' }} onPress={item.action}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#1a1a1a', fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{item.title}</Text>
                      <Text style={{ color: '#aaa', fontSize: 12 }}>{item.desc}</Text>
                    </View>
                    <Text style={{ color: VIOLET, fontSize: 16 }}>→</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {view === 'login' && <OrgLoginView onBack={() => { setView('menu'); }} onLogin={(data) => { close(); onLogin(data); }} />}
            {view === 'org' && <OrganizerLoginView onBack={() => { setView('menu'); }} onLogin={(data) => { close(); onLogin(data); }} />}
            {view === 'org' && <OrganizerLoginView onBack={() => { setView('menu'); }} onLogin={(data) => { close(); onLogin(data); }} />}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Création d'événement ─────────────────────────────────────────────────────

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

  const genCode = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const submit = async () => {
    if (!name || !password || !location) { setError('Nom, lieu et mot de passe requis'); return; }
    setLoading(true); setError(''); setSuccess('');
    const code = genCode(name);
    try {
      const res = await fetch(WORKER_URL + '/auth/submit-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code, password, contact, date, location, website, event_type: eventType }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur'); return; }
      setSuccess('Demande envoyee !\nCode : ' + code);
    } catch (e) { setError('Impossible de contacter le serveur'); }
    finally { setLoading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 64, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: '#e0ddd8' }}>
        <TouchableOpacity onPress={onBack}><Text style={{ color: VIOLET, fontSize: 14 }}>← Retour</Text></TouchableOpacity>
        <Text style={{ fontSize: 16, fontFamily: 'AVEstiana', fontStyle: 'normal', color: '#1a1a1a' }}>Creer un evenement</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }}>
        <Text style={{ color: '#888', fontSize: 10, marginTop: 0, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Nom *</Text>
        <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8' }} value={name} onChangeText={setName} placeholder="Trail des Vosges 2026" placeholderTextColor="#bbb" />

        <Text style={{ color: '#888', fontSize: 10, marginTop: 12, marginBottom: 6, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
          {EVENT_TYPES.map(t => (
            <TouchableOpacity key={t} style={[{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0ddd8', marginRight: 6 }, eventType === t && { backgroundColor: getColor(t), borderColor: getColor(t) }]} onPress={() => setEventType(t === eventType ? '' : t)}>
              <Text style={[{ color: '#888', fontSize: 12, fontWeight: '600' }, eventType === t && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {[
          { label: 'Date', value: date, set: setDate, placeholder: '2026-03-29' },
          { label: 'Lieu *', value: location, set: setLocation, placeholder: 'Gerardmer (88), France' },
          { label: 'Site web', value: website, set: setWebsite, placeholder: 'https://...' },
        ].map((f, i) => (
          <View key={i}>
            <Text style={{ color: '#888', fontSize: 10, marginTop: 12, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>{f.label}</Text>
            <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8' }} value={f.value} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor="#bbb" autoCapitalize="none" />
          </View>
        ))}

        <View style={{ height: 1, backgroundColor: '#e0ddd8', marginVertical: 20 }} />
        <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Mot de passe photographes *</Text>
        <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8' }} value={password} onChangeText={setPassword} placeholder="Mot de passe secret" placeholderTextColor="#bbb" secureTextEntry />

        <View style={{ height: 1, backgroundColor: '#e0ddd8', marginVertical: 20 }} />
        <Text style={{ color: '#888', fontSize: 10, marginBottom: 4, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Email de contact</Text>
        <TextInput style={{ backgroundColor: '#fff', color: '#1a1a1a', padding: 13, fontSize: 14, borderWidth: 1, borderColor: '#e0ddd8' }} value={contact} onChangeText={setContact} placeholder="ton@email.com" placeholderTextColor="#bbb" autoCapitalize="none" keyboardType="email-address" />

        {name.length > 0 && <View style={{ backgroundColor: '#fff', padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#e0ddd8' }}><Text style={{ fontSize: 10, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Code genere</Text><Text style={{ fontSize: 15, fontWeight: '700', color: VIOLET }}>{genCode(name)}</Text></View>}

        {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{error}</Text> : null}
        {success ? <Text style={{ color: '#10b981', fontSize: 12, marginTop: 8 }}>{success}</Text> : null}

        <TouchableOpacity style={[{ backgroundColor: VIOLET, padding: 15, alignItems: 'center', marginTop: 24 }, loading && { opacity: 0.6 }]} onPress={submit} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>Soumettre la demande</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Écran d'accueil ──────────────────────────────────────────────────────────

function HomeScreen({ onLogin, orgSession, onOrgLogout }) {
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOrg, setShowOrg] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    fetch(WORKER_URL + '/public-events')
      .then(r => r.json())
      .then(data => { setAllEvents(data); setEvents(data); })
      .catch(() => setError('Impossible de charger les evenements'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!search.trim()) { setEvents(allEvents); return; }
    const q = search.toLowerCase();
    setEvents(allEvents.filter(e => e.name.toLowerCase().includes(q) || e.code.includes(q)));
  }, [search, allEvents]);

  const now = new Date();
  const getDate = (e) => e.event_date ? new Date(e.event_date) : null;
  const sorted = [...events].sort((a, b) => { const da = getDate(a), db = getDate(b); if (!da && !db) return 0; if (!da) return 1; if (!db) return -1; return db - da; });
  const past = sorted.filter(e => { const d = getDate(e); return d && d <= now; });
  const future = sorted.filter(e => { const d = getDate(e); return d && d > now; }).reverse();

  if (detailEvent) return <EventDetailScreen event={detailEvent} onBack={() => setDetailEvent(null)} />;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 64, paddingBottom: 20 }}>
        <WillLogo size={20} color="#1a1a1a" />
        <TouchableOpacity
          style={{ width: 34, height: 34, backgroundColor: orgSession ? VIOLET : '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}
          onPress={() => orgSession ? setShowProfile(true) : setShowOrg(true)}>
          <SvgXml xml={PROFILE_ICON} width={18} height={18} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <TextInput style={{ backgroundColor: '#fff', padding: 13, fontSize: 14, color: '#1a1a1a', borderWidth: 1, borderColor: '#e0ddd8' }} value={search} onChangeText={setSearch} placeholder="Trouver mon evenement" placeholderTextColor="#aaa" autoCorrect={false} clearButtonMode="while-editing" />
        </View>

        {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginHorizontal: 20, marginBottom: 8 }}>{error}</Text> : null}

        {loading ? (
          <View style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={VIOLET} /></View>
        ) : (
          <>
            {past.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#999', marginBottom: 10, paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 3 }}>Derniers events</Text>
                {past.map(e => <EventCard key={e.code} event={e} onPress={setDetailEvent} />)}
              </View>
            )}
            {future.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#999', marginBottom: 10, paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 3 }}>A venir</Text>
                {future.map(e => <EventCard key={e.code} event={e} onPress={setDetailEvent} />)}
              </View>
            )}
            {events.length === 0 && <View style={{ padding: 60, alignItems: 'center' }}><Text style={{ color: '#aaa', fontSize: 14 }}>Aucun evenement disponible</Text></View>}
          </>
        )}
      </ScrollView>

      {/* Bouton bas */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, overflow: 'hidden' }}>
        <LinearGradient colors={['#111111', '#000000']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: '100%' }}>
          {orgSession ? (
            <TouchableOpacity style={{ paddingVertical: 20, paddingBottom: 38, alignItems: 'center' }} onPress={() => onLogin({ ...orgSession, _goCamera: true })} activeOpacity={0.88}>
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 2 }}>Prendre des photos →</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={{ paddingVertical: 20, paddingBottom: 38, alignItems: 'center' }} onPress={() => setShowOrg(true)} activeOpacity={0.88}>
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 2 }}>Organisation →</Text>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>

      <OrgModal visible={showOrg} onClose={() => setShowOrg(false)} onLogin={onLogin} />

      {showProfile && orgSession && (
        <OrgProfileScreen
          session={orgSession}
          onClose={() => setShowProfile(false)}
          onLogout={() => { setShowProfile(false); onOrgLogout && onOrgLogout(); }}
        />
      )}
    </View>
  );
}

// ─── Photographe ─────────────────────────────────────────────────────────────

function OrganizerScreen({ session, onLogout }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('idle');
  const [photoCount, setPhotoCount] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [debugText, setDebugText] = useState('Pret');

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
        fetch(photo.uri).then(r => r.blob()).then(blob => fetch(`${WORKER_URL}/${key}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'Authorization': `Bearer ${session.token}` }, body: blob }));
        await new Promise(r => setTimeout(r, 150));
      } catch (e) {}
    }
    shootingRef.current = false; setStatus(personPresentRef.current ? 'person' : 'idle');
  };

  useEffect(() => () => stopDetection(), []);

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  if (!permission.granted) return (
    <View style={{ flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center', gap: 24, padding: 32 }}>
      <WillLogo size={24} color="#1a1a1a" />
      <TouchableOpacity style={{ backgroundColor: VIOLET, padding: 15, width: '100%', alignItems: 'center' }} onPress={requestPermission}>
        <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>Autoriser la camera</Text>
      </TouchableOpacity>
    </View>
  );

  const sc = { idle: '#94a3b8', person: '#f59e0b', shooting: '#4ade80' }[status] || '#94a3b8';
  const sl = { idle: detecting ? 'En surveillance' : 'Arrete', person: 'Mouvement !', shooting: 'Rafale...' }[status];

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={{ flex: 1, width: '100%' }} facing="back" ref={cameraRef}>
        <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: 60 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20 }}>
            <View>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{session.event.name}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>{session.photographer_id}</Text>
            </View>
            <TouchableOpacity onPress={onLogout} style={{ backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>← Quitter</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {status === 'shooting' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 10 }}>
                <View style={{ width: 7, height: 7, backgroundColor: '#ef4444', borderRadius: 3.5 }} />
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 3 }}>REC</Text>
              </View>
            )}
          </View>
          <View style={{ gap: 6, alignItems: 'center', padding: 24, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: sc }}>
              <View style={{ width: 6, height: 6, backgroundColor: sc }} />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{sl}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginLeft: 8 }}>{debugText}</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900', marginVertical: 4 }}>{photoCount}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: -8, marginBottom: 6, letterSpacing: 2, textTransform: 'uppercase' }}>photos</Text>
            <TouchableOpacity style={[{ paddingVertical: 15, width: '100%', alignItems: 'center' }, detecting ? { backgroundColor: '#ef4444' } : { backgroundColor: VIOLET }]} onPress={detecting ? stopDetection : startDetection}>
              <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'AVEstiana', fontStyle: 'normal', letterSpacing: 1 }}>{detecting ? 'Arreter' : 'Demarrer'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ backgroundColor: 'rgba(255,255,255,0.07)', paddingVertical: 10, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }} onPress={() => startBurst()}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>Declencher manuellement</Text>
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
  const [fontsLoaded] = useFonts({ 'AVEstiana': require('./assets/fonts/AV_Estiana-VF.ttf') });

  const handleLogin = (s) => {
    if (s.role === 'create_event') { setSession(s); return; }
    if (s.role === 'participant') { setSession(s); return; }
    if (s.role === 'organizer') {
      if (s._goCamera) { setSession(s); return; }
      setOrgSession(s); return;
    }
    setSession(s);
  };

  if (!session && !orgSession) return <HomeScreen onLogin={handleLogin} orgSession={null} onOrgLogout={() => setOrgSession(null)} />;
  if (session?.role === 'create_event') return <CreateEventScreen onBack={() => setSession(null)} />;
  if (session?.role === 'participant') return <GalleryScreen session={session} onLogout={() => setSession(null)} />;
  if (session?.role === 'organizer' || session?._goCamera) return <OrganizerScreen session={session || orgSession} onLogout={() => setSession(null)} />;
  if (orgSession) return <HomeScreen onLogin={handleLogin} orgSession={orgSession} onOrgLogout={() => setOrgSession(null)} />;
  return <HomeScreen onLogin={handleLogin} orgSession={null} onOrgLogout={() => setOrgSession(null)} />;
}

