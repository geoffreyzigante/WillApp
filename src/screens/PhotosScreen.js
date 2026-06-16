// Ecran "Mes photos" du coureur. Aggrege /personal-gallery sur tous les
// events suivis (follows U knownEvents) + favoris cross-event.
//
// Cache local AsyncStorage scoped par userId (sans le scope : user B sur
// le meme device verrait les photos de A apres logout/login, RGPD).
//
// Filtres 3 onglets :
//   - Moi : photos matchees par face recognition (_isPersonalMatch=true)
//   - Mes favoris : photos likeees, cross-event
//   - Tous : merge des deux
//
// E4 : marqueur "derniere photo vue" par burstTs. Pull-to-refresh affiche
// "X nouvelles photos" / "Rien de nouveau" via toast cross-fade titre.
//
// Mode selection multi + download batch dans la pellicule iOS (MediaLibrary).

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, Animated, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { Paths, File } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { Icon } from '../components/Icon';
import { SelfieBlock } from '../components/SelfieBlock';
import { ConsentRenewBanner } from '../components/ConsentRenewBanner';
import { PhotosEmptyState } from '../components/PhotosEmptyState';
import { PhotoGrid } from '../components/PhotoGrid';
import { SpinningLoader, RefreshableScrollView } from '../components/loaders';
import { C, TYPE_COLORS, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { API_URL, R2_PUBLIC } from '../constants/api';
import { extractBurstTs, extractIdx, detectPhotoExtension } from '../utils/photo';
import { selfieDotColor } from '../utils/styleHelpers';
import { Haptics } from '../services/haptics';

export function PhotosScreen({ events = [], onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, follows, onFindEvent, runnerApiFetch, runnerUserId, onOpenPhoto, photoFavoritesSet, onTogglePhotoFavorite, onRefreshFavorites, selfieSkipped = false, isActive = true, selfieUploadState = 'idle', onRetryUpload }) {
  const photosCacheKey = runnerUserId ? `@will_photos_cache_${runnerUserId}` : '@will_photos_cache';
  const knownEventsCacheKey = runnerUserId ? `@will_known_events_${runnerUserId}` : null;
  const [knownEvents, setKnownEvents] = useState([]);
  const eventsToQuery = useMemo(() => {
    const set = new Set();
    for (const c of follows) set.add(c);
    for (const c of knownEvents) set.add(c);
    return [...set];
  }, [follows, knownEvents]);
  const hasFollows = eventsToQuery.length > 0;
  const [photos, setPhotos] = useState([]);
  const [anySearching, setAnySearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [downloading, setDownloading] = useState(false);
  const [viewFilter, setViewFilter] = useState('me');
  const VIEW_KEYS = ['me', 'favs', 'all'];
  const viewIdx = Math.max(0, VIEW_KEYS.indexOf(viewFilter));
  const [viewTabsContainerW, setViewTabsContainerW] = useState(0);
  const viewTabsSlideX = useRef(new Animated.Value(0)).current;
  const viewSlotW = viewTabsContainerW > 0 ? viewTabsContainerW / 3 : 0;
  useEffect(() => {
    if (viewSlotW <= 0) return;
    Animated.spring(viewTabsSlideX, {
      toValue: viewSlotW * viewIdx,
      useNativeDriver: true,
      tension: 110, friction: 14,
    }).start();
  }, [viewIdx, viewSlotW, viewTabsSlideX]);
  const visiblePhotos = useMemo(() => {
    if (viewFilter === 'favs') {
      return photoFavoritesSet ? photos.filter(p => photoFavoritesSet.has(p.id)) : [];
    }
    if (viewFilter === 'me') {
      return photos.filter(p => p._isPersonalMatch);
    }
    return photos;
  }, [photos, viewFilter, photoFavoritesSet]);
  const meCount = useMemo(() => photos.filter(p => p._isPersonalMatch).length, [photos]);
  const favCount = useMemo(() => (
    photoFavoritesSet ? photos.filter(p => photoFavoritesSet.has(p.id)).length : 0
  ), [photos, photoFavoritesSet]);

  const togglePhotoSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);
  useEffect(() => { if (!isActive) exitSelection(); }, [isActive, exitSelection]);

  useEffect(() => {
    if (isActive) onRefreshFavorites?.();
  }, [isActive, onRefreshFavorites]);

  // E4 -- marqueur "derniere photo vue" par burstTs (max global tous events).
  const lastSeenRef = useRef(0);
  const lastSeenLoadedRef = useRef(false);
  const baselineSetRef = useRef(false);
  const [toastPhase, setToastPhase] = useState('idle');
  const [refreshToast, setRefreshToast] = useState(null);
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem('@will_last_seen_burst_ts').then(v => {
      lastSeenRef.current = v ? parseInt(v, 10) : 0;
      lastSeenLoadedRef.current = true;
    }).catch(() => { lastSeenLoadedRef.current = true; });
    AsyncStorage.getItem(photosCacheKey).then(s => {
      if (!s) { setLoading(true); return; }
      try {
        const cached = JSON.parse(s);
        if (Array.isArray(cached) && cached.length > 0) {
          setPhotos(cached);
          setLoading(false);
        }
      } catch {}
    }).catch(() => {});
    if (knownEventsCacheKey) {
      AsyncStorage.getItem(knownEventsCacheKey).then(s => {
        if (!s) return;
        try {
          const cached = JSON.parse(s);
          if (Array.isArray(cached)) setKnownEvents(cached);
        } catch {}
      }).catch(() => {});
    }
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const eventTintMap = useMemo(() => {
    const map = {};
    for (const e of events) map[e.code] = colorForType(e.event_type);
    return map;
  }, [events]);

  const refreshKnownEvents = useCallback(async () => {
    if (!runnerApiFetch) return [];
    try {
      const r = await runnerApiFetch(`/runner/known-events`);
      if (!r.ok) return [];
      const data = await r.json();
      const list = Array.isArray(data?.events) ? data.events : [];
      setKnownEvents(list);
      if (knownEventsCacheKey) {
        AsyncStorage.setItem(knownEventsCacheKey, JSON.stringify(list)).catch(() => {});
      }
      return list;
    } catch { return []; }
  }, [runnerApiFetch, knownEventsCacheKey]);

  useEffect(() => { refreshKnownEvents(); }, [refreshKnownEvents]);

  const refreshAll = useCallback(async () => {
    const queryList = eventsToQuery;
    if (queryList.length === 0 || !runnerApiFetch) {
      // Si pas d events suivis mais des favs : aller chercher les events
      // depuis les favs pour ne pas afficher empty alors qu il y a des favs.
      const favEventCodes = new Set();
      if (photoFavoritesSet && photoFavoritesSet.size > 0) {
        photoFavoritesSet.forEach((key) => {
          const m = String(key || '').match(/^([^\/]+)\//);
          if (m) favEventCodes.add(m[1]);
        });
      }
      if (favEventCodes.size === 0) {
        setPhotos([]);
        setAnySearching(false);
        setLoading(false);
        return [];
      }
    }
    const started = {};
    for (const code of queryList) {
      const v = await AsyncStorage.getItem(`@will_follow_started_${code}`);
      started[code] = v ? parseInt(v, 10) : 0;
    }
    // Fetch en parallele :
    //  - /personal-gallery/{code} pour tous les events suivis (photos
    //    identifiees au selfie)
    //  - /runner/photo-favorites-full (UN SEUL appel) : tous les favs avec
    //    leurs URLs, meme si masques par face-gate/time-gate dans list-public.
    //    Indispensable pour afficher les favs qui pointent vers des photos
    //    non-visibles publiquement (l user les a fav, il y a droit).
    const [results, favFullResp] = await Promise.all([
      Promise.all(queryList.map(async (code) => {
        try {
          const r = await runnerApiFetch(`/personal-gallery/${encodeURIComponent(code)}`);
          if (!r.ok) return { code, photos: [], paid: false };
          const data = await r.json();
          return { code, photos: Array.isArray(data.photos) ? data.photos : [], paid: !!data.photos_for_sale };
        } catch { return { code, photos: [], paid: false }; }
      })),
      (async () => {
        try {
          const r = await runnerApiFetch('/runner/photo-favorites-full');
          if (!r.ok) return [];
          const d = await r.json();
          return Array.isArray(d?.photos) ? d.photos : [];
        } catch { return []; }
      })(),
    ]);
    const now = Date.now();
    const merged = [];
    const seenIds = new Set();
    let searching = false;
    for (const { code, photos: list, paid } of results) {
      const tint = eventTintMap[code] || TYPE_COLORS.autre;
      if (list.length === 0) {
        const startedTs = started[code];
        const elapsed = startedTs ? (now - startedTs) : Infinity;
        if (elapsed < 90000) searching = true;
        continue;
      }
      for (const p of list) {
        seenIds.add(p.key);
        merged.push({
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
          paid,
          eventCode: code,
          _isPersonalMatch: true,
        });
      }
    }
    // Ajoute les favs depuis /runner/photo-favorites-full (deduit eventCode
    // depuis le premier segment de la R2 key).
    for (const p of favFullResp) {
      if (!p?.key) continue;
      if (seenIds.has(p.key)) continue;
      seenIds.add(p.key);
      const m = String(p.key).match(/^([^\/]+)\//);
      const eventCode = m ? m[1] : '';
      const tint = eventTintMap[eventCode] || TYPE_COLORS.autre;
      merged.push({
        uri: p.url || `${R2_PUBLIC}/${p.key}`,
        thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
        id: p.key,
        tint,
        paid: false,
        eventCode,
        _isPersonalMatch: false,
      });
    }
    merged.sort((a, b) => {
      const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
      if (dt !== 0) return dt;
      return extractIdx(b.id) - extractIdx(a.id);
    });
    setPhotos(merged);
    setAnySearching(searching);
    setLoading(false);
    setVisibleCount(30);
    AsyncStorage.setItem(photosCacheKey, JSON.stringify(merged)).catch(() => {});
    // Prefetch tous les thumbnails (cap 250) pour garantir que le 3 onglets
    // (Moi / Favoris / Tous) sont 100% cached avant le 1er scroll. Memory-disk
    // policy : si la photo est deja cached, c est instant. Sinon download en
    // arriere-plan, non bloquant.
    if (typeof ExpoImage?.prefetch === 'function') {
      merged.slice(0, 250).forEach((p) => {
        if (p?.thumbUri) {
          ExpoImage.prefetch(p.thumbUri, 'memory-disk').catch(() => {});
        }
      });
    }
    return merged;
  }, [eventsToQuery, runnerApiFetch, eventTintMap, photosCacheKey, photoFavoritesSet]);

  const favExtraFetchedRef = useRef(new Set());
  useEffect(() => {
    if (!photoFavoritesSet || photoFavoritesSet.size === 0) return;
    const favEventCodes = new Set();
    photoFavoritesSet.forEach((key) => {
      const m = String(key || '').match(/^([^\/]+)\//);
      if (m) favEventCodes.add(m[1]);
    });
    // On fetch /list-public pour TOUS les events qui ont au moins un fav,
    // pas seulement les events non-suivis. /personal-gallery ne retourne que
    // les photos identifiees au selfie, donc un fav sur une photo "non-moi"
    // (ami, paysage) ne sera jamais dans personal-gallery -> il faut le
    // chopper via list-public.
    const missing = [...favEventCodes].filter((c) => !favExtraFetchedRef.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => favExtraFetchedRef.current.add(c));
    Promise.all(missing.map(async (code) => {
      try {
        const r = await fetch(`${API_URL}/list-public/${encodeURIComponent(code)}`);
        if (!r.ok) return { code, photos: [] };
        const d = await r.json();
        return { code, photos: Array.isArray(d.photos) ? d.photos : [] };
      } catch { return { code, photos: [] }; }
    })).then((results) => {
      setPhotos((current) => {
        const existingIds = new Set(current.map((p) => p.id));
        const extras = [];
        for (const { code, photos: list } of results) {
          const tint = eventTintMap[code] || TYPE_COLORS.autre;
          for (const p of list) {
            if (!photoFavoritesSet.has(p.key)) continue;
            if (existingIds.has(p.key)) continue;
            extras.push({
              uri: p.url || `${R2_PUBLIC}/${p.key}`,
              thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
              id: p.key,
              tint,
              paid: false,
              eventCode: code,
              _isPersonalMatch: false,
            });
          }
        }
        if (extras.length === 0) return current;
        const merged = [...current, ...extras];
        merged.sort((a, b) => {
          const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
          if (dt !== 0) return dt;
          return extractIdx(b.id) - extractIdx(a.id);
        });
        return merged;
      });
    });
  }, [photoFavoritesSet, eventsToQuery, eventTintMap]);

  useEffect(() => {
    if (baselineSetRef.current || !lastSeenLoadedRef.current || loading) return;
    if (photos.length === 0) return;
    baselineSetRef.current = true;
    let maxTs = 0;
    for (const p of photos) {
      const ts = extractBurstTs(p.id);
      if (ts > maxTs) maxTs = ts;
    }
    if (maxTs > lastSeenRef.current) {
      lastSeenRef.current = maxTs;
      AsyncStorage.setItem('@will_last_seen_burst_ts', String(maxTs)).catch(() => {});
    }
  }, [loading, photos]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!isActive || !anySearching) return;
    const timer = setInterval(refreshAll, 7000);
    return () => clearInterval(timer);
  }, [isActive, anySearching, refreshAll]);

  useEffect(() => {
    if (visibleCount >= photos.length) return;
    const t = setTimeout(() => setVisibleCount(v => Math.min(v + 30, photos.length)), 250);
    return () => clearTimeout(t);
  }, [visibleCount, photos.length]);

  const onPullRefresh = useCallback(async () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setRefreshing(true);
    setToastPhase('searching');
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    await Promise.all([
      refreshKnownEvents(),
      onRefreshFavorites?.(),
    ]);
    const merged = await refreshAll();
    setRefreshing(false);

    if (!lastSeenLoadedRef.current) {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => setToastPhase('idle'));
      return;
    }
    const prev = lastSeenRef.current;
    let maxTs = 0, newCount = 0;
    for (const p of merged) {
      const ts = extractBurstTs(p.id);
      if (ts > maxTs) maxTs = ts;
      if (ts > prev) newCount++;
    }
    if (maxTs > prev) {
      lastSeenRef.current = maxTs;
      AsyncStorage.setItem('@will_last_seen_burst_ts', String(maxTs)).catch(() => {});
    }
    const msg = newCount === 0
      ? 'Rien de nouveau pour toi'
      : newCount === 1
        ? 'Bonne nouvelle, 1 nouvelle photo de toi 📸'
        : `Bonne nouvelle, ${newCount} nouvelles photos de toi 📸`;
    setRefreshToast(msg);
    setToastPhase('result');
    toastTimerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start(() => {
        setToastPhase('idle');
        setRefreshToast(null);
      });
    }, 2000);
  }, [refreshAll, refreshKnownEvents, onRefreshFavorites, titleOpacity, toastOpacity]);

  const downloadSelected = useCallback(async () => {
    if (selectedIds.size === 0 || downloading) return;
    setDownloading(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert('Permission refusée', 'Autorise l\'accès aux photos pour sauvegarder dans la pellicule.');
        return;
      }
      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) {
        Alert.alert('Hors ligne', 'Pas de connexion internet — impossible de télécharger.');
        return;
      }
      let saved = 0, failed = 0;
      let i = 0;
      for (const id of selectedIds) {
        const photo = photos.find(p => p.id === id);
        if (!photo?.uri) { failed++; continue; }
        let staged = null;
        try {
          const ext = await detectPhotoExtension(photo.uri);
          const filename = `will_${Date.now()}_${i}.${ext}`;
          staged = new File(Paths.cache, filename);
          const downloaded = await File.downloadFileAsync(photo.uri, staged, { idempotent: true });
          const localUri = downloaded?.uri || staged.uri;
          await MediaLibrary.saveToLibraryAsync(localUri);
          saved++;
        } catch (e) {
          failed++;
          console.warn('[multi-download]', id, e?.message || e);
        } finally {
          try { if (staged?.exists) staged.delete(); } catch {}
          i++;
        }
      }
      const savedMsg = saved === 1 ? '1 photo' : `${saved} photos`;
      const failedSuffix = failed > 0 ? ` (${failed} échec${failed > 1 ? 's' : ''})` : '';
      Alert.alert(
        saved > 0 ? 'Enregistré' : 'Erreur',
        saved > 0
          ? `${savedMsg} dans ta pellicule${failedSuffix}.`
          : 'Aucune photo n a pu etre sauvegardee. Verifie ta connexion et reessaie.'
      );
      if (saved > 0) exitSelection();
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de télécharger les photos.');
    } finally {
      setDownloading(false);
    }
  }, [selectedIds, photos, downloading, exitSelection]);

  return (
    <RefreshableScrollView
      hideTopRefresh
      onRefresh={onPullRefresh}
      refreshing={refreshing}
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <TouchableOpacity
            hitSlop={10}
            onPress={onOpenProfile}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
          >
            {selfieUri ? (
              <Image
                source={{ uri: selfieUri }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#c9beed' }}
              />
            ) : (
              <Icon.User size={30} color="#c9beed" />
            )}
            {selfieUri && (
              <TouchableOpacity
                onPress={(e) => {
                  if (selfieUploadState === 'failed') { e.stopPropagation?.(); onRetryUpload?.(); }
                }}
                disabled={selfieUploadState !== 'failed'}
                activeOpacity={selfieUploadState === 'failed' ? 0.6 : 1}
                hitSlop={8}
                style={{
                  position: 'absolute', top: 0, right: 0,
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: selfieDotColor(selfieUploadState),
                  borderWidth: 2, borderColor: C.bg,
                }}
              />
            )}
          </TouchableOpacity>
        </View>
        {/* SLOT CENTRE : cross-fade titre <-> toast refresh. */}
        <View style={{ flex: 1, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', opacity: titleOpacity }}>
            <Text style={[s.welcome, { color: C.primary, fontSize: 17 }]}>Mes photos</Text>
          </Animated.View>
          {toastPhase !== 'idle' && (
            <Animated.View style={{
              position: 'absolute',
              opacity: toastOpacity,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}>
              {toastPhase === 'searching' && <SpinningLoader size={14} color="#c9beed" />}
              <Text style={{ color: '#c9beed', fontSize: 14, fontWeight: '500' }}>
                {toastPhase === 'searching' ? 'Recherche…' : (refreshToast || '')}
              </Text>
            </Animated.View>
          )}
        </View>
        <View style={{ width: 40, height: 40 }} />
      </View>

      <View style={{ height: 14 }} />
      <ConsentRenewBanner runnerApiFetch={runnerApiFetch} isAuthed={!!runnerUserId} />

      {!selfieUri && (
        <SelfieBlock selfieUri={null} onPress={onOpenSelfie} onDelete={onDeleteSelfie} missing={selfieSkipped} />
      )}

      {!hasFollows ? (
        <PhotosEmptyState selfieUri={selfieUri} onFindEvent={onFindEvent} />
      ) : loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <SpinningLoader size={26} color="#c9beed" />
          <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 10 }}>Chargement…</Text>
        </View>
      ) : photos.length === 0 && anySearching ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
          <SpinningLoader size={26} color="#7B2FFF" />
          <Text style={{ color: '#5E1AD6', fontSize: 13, marginTop: 12, textAlign: 'center', fontWeight: '600' }}>
            Will recherche tes photos…
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 17 }}>
            Cela peut prendre quelques secondes après l'upload du photographe.
          </Text>
        </View>
      ) : photos.length === 0 ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
          <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
            Aucune photo pour le moment.{'\n'}Reviens après la course !
          </Text>
        </View>
      ) : (
        <>
          {!selectionMode && (
            <View
              onLayout={(e) => setViewTabsContainerW(e.nativeEvent.layout.width - 8)}
              style={{
                flexDirection: 'row',
                backgroundColor: C.pillBg,
                borderRadius: 16,
                padding: 4,
                alignItems: 'center',
                position: 'relative',
                marginBottom: 10,
              }}
            >
              {viewSlotW > 0 && (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 4, top: 4, bottom: 4,
                    width: viewSlotW,
                    backgroundColor: C.primary,
                    borderRadius: 12,
                    transform: [{ translateX: viewTabsSlideX }],
                  }}
                />
              )}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('me'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'me' && s.pillTextActive]} numberOfLines={1}>Moi ({meCount})</Text>
              </TouchableOpacity>
              {viewFilter === 'all' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('favs'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'favs' && s.pillTextActive]} numberOfLines={1}>Mes favoris ({favCount})</Text>
              </TouchableOpacity>
              {viewFilter === 'me' && <View pointerEvents="none" style={{ width: 1, height: 18, backgroundColor: 'rgba(123,47,255,0.3)', zIndex: 2 }} />}
              <TouchableOpacity
                onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} setViewFilter('all'); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 2 }}
              >
                <Text style={[s.pillText, viewFilter === 'all' && s.pillTextActive]} numberOfLines={1}>Tous ({photos.length})</Text>
              </TouchableOpacity>
            </View>
          )}
          {photos.length > 1 && (
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              paddingHorizontal: 2, paddingTop: 4, marginBottom: 8,
            }}>
              {selectionMode ? (
                <>
                  <TouchableOpacity onPress={exitSelection} hitSlop={10} disabled={downloading}>
                    <Text style={{ color: C.textSoft, fontSize: 13, fontWeight: '500' }}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={downloadSelected}
                    hitSlop={10}
                    disabled={selectedIds.size === 0 || downloading}
                    style={{ opacity: (selectedIds.size === 0 || downloading) ? 0.35 : 1 }}
                  >
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '700' }}>
                      {downloading
                        ? 'Téléchargement…'
                        : `Télécharger${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
                  <Text style={{ color: '#c9beed', fontSize: 13, fontWeight: '500' }}>Sélectionner</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {visiblePhotos.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
                {viewFilter === 'favs'
                  ? 'Aucune photo en favoris pour le moment.'
                  : viewFilter === 'me'
                    ? 'Aucune photo de toi pour le moment.'
                    : 'Aucune photo.'}
              </Text>
            </View>
          ) : (
            <PhotoGrid
              photos={visiblePhotos.slice(0, visibleCount)}
              numColumns={Math.max(1, Math.min(visiblePhotos.length, 4))}
              onPress={(p, _i, _photos, origin) => onOpenPhoto?.(p, visiblePhotos, {
                origin,
                photosForSale: !!p?.paid,
                eventCode: p?.eventCode || null,
              })}
              photoFavoritesSet={photoFavoritesSet}
              onToggleFavorite={onTogglePhotoFavorite}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onTogglePhotoSelect={togglePhotoSelect}
            />
          )}
        </>
      )}
    </RefreshableScrollView>
  );
}
