// Ecran galerie photos d'un event cote organisateur. Mode preview : voit
// TOUTES les photos (before + during event, masquees comprises avec opacite
// reduite + dot rouge). Les coureurs ne voient que les photos publiees
// apres l heure de leur course.
//
// Features :
// - Filtres par distance (pills horizontales)
// - Mode selection long-press + bouton "Supprimer (N)" en bas
// - Tap photo masquee -> bouton "Publier" en overlay (POST visibility)
// - PhotoViewer integre via callback onOpenPhoto avec optimistic override

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl, ScrollView,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { GridErrorBoundary } from '../components/GridErrorBoundary';
import { C, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { formatDateLong, cityLabel } from '../utils/format';
import { raceTitle, extractBurstTs, extractIdx } from '../utils/photo';

export function OrganizerEventPhotosScreen({ session, organizerApiFetch, event, onClose, onOpenPhoto }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [raceFilter, setRaceFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [busyKey, setBusyKey] = useState(null);
  const tint = colorForType(event.event_type);

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setVisibleCount(20);
    try {
      const r = await organizerApiFetch(`/organizer/event-photos/${event.code}`);
      const data = r.ok ? await r.json() : { before_event: [], during_event: [], hidden_count: 0 };
      const raw = [...(data.during_event || []), ...(data.before_event || [])];
      const list = raw
        .filter(p => p && typeof p.url === 'string' && p.url.length > 0
                       && typeof p.key === 'string' && p.key.length > 0)
        .map(p => ({
          uri: p.url,
          id: p.key,
          tint,
          race: p.race,
          race_distance_id: p.race_distance_id || null,
          km: p.km,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
          hidden: p.hidden === true,
        }));
      setHiddenCount(typeof data.hidden_count === 'number' ? data.hidden_count : 0);
      list.sort((a, b) => {
        const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
        if (dt !== 0) return dt;
        return extractIdx(b.id) - extractIdx(a.id);
      });
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
    : photos.filter(p => {
        const k = (p && p.race_distance_id) ? String(p.race_distance_id) : (p && p.race ? String(p.race) : null);
        return k === raceFilter || !p.race;
      });

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
      onOpenPhoto?.(photo, filteredPhotos, {
        allowDelete: true,
        onDelete: deleteFromViewer,
        onTogglePhotoVisibility: handleTogglePublish,
        eventTitle: event?.name,
        eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
      });
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
              const r = await organizerApiFetch(`/organizer/delete-photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
      const r = await organizerApiFetch(`/organizer/delete-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
        {event.cover_image ? (
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', overflow: 'hidden' }}>
            <ExpoImage source={{ uri: event.cover_image }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
            <LinearGradient
              colors={[tint, 'transparent']}
              locations={[0, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          </View>
        ) : null}
        <View style={s.eventCardCenter}>
          <Text style={s.eventDate}>{formatDateLong(event.event_date, event.event_date_end)}</Text>
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
            const val = String(d.id || d.km);
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
                <Text style={{ color: active ? '#fff' : C.text, fontSize: 13, fontWeight: '700' }}>{raceTitle(d)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <Text style={[s.sectionTitle, { marginVertical: 10 }]}>
        Photos {photos.length > 0 ? `(${filteredPhotos.length})` : ''}
        {hiddenCount > 0 && (
          <Text style={{ color: C.error, fontSize: 13, fontWeight: '600' }}>
            {'  · '}{hiddenCount} masquée{hiddenCount > 1 ? 's' : ''}
          </Text>
        )}
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

  async function handleTogglePublish(photoKey, currentlyHidden) {
    if (busyKey) return false;
    setBusyKey(photoKey);
    try {
      const r = await organizerApiFetch(`/organizer/photo-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: photoKey, visible: currentlyHidden }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data?.error || 'Modification impossible');
        return false;
      }
      await loadPhotos();
      return true;
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Modification impossible');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  const renderItem = ({ item: photo, index }) => {
    const isSelected = selectedKeys.has(photo.id);
    const isHidden = photo.hidden === true;
    const isBusy = busyKey === photo.id;
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
            style={[StyleSheet.absoluteFillObject, isHidden ? { opacity: 0.55 } : null]}
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
          {/* Point rouge en haut a gauche : photo masquee (face_count=0). */}
          {isHidden && !selectionMode && (
            <View
              accessibilityLabel="Photo masquée"
              style={{
                position: 'absolute', top: 6, left: 6,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: C.error,
                borderWidth: 2, borderColor: '#fff',
              }}
            />
          )}
          {/* Bouton "Publier" : clic explicite de l'orga pour basculer
              une photo masquee vers la galerie publique. Jamais automatique. */}
          {isHidden && !selectionMode && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                handleTogglePublish(photo.id, true);
              }}
              disabled={isBusy}
              hitSlop={6}
              style={{
                position: 'absolute', bottom: 4, right: 4,
                backgroundColor: isBusy ? 'rgba(0,0,0,0.4)' : C.primary,
                paddingHorizontal: 8, paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {isBusy ? '…' : 'Publier'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <GridErrorBoundary>
      <View style={{ flex: 1, backgroundColor: '#F5F3FF' }}>
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
                backgroundColor: C.error,
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
