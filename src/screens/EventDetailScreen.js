// Ecran detail event coureur : hero + CTA Favoris + Infos pratiques inline +
// filtres race/km (RaceDropdown), grid bento (1 big 2x2 + 11 small alternance
// gauche/droite par chunk de 12), pagination, recherche dossard.
//
// Wrappe dans GridErrorBoundary : si une URL malformee ou un render thrown
// dans une cellule crash, fallback avec retry au lieu de tout planter.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, ScrollView, RefreshControl, Modal,
  LayoutAnimation, ActivityIndicator, StyleSheet, Linking, Animated, Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { GridErrorBoundary } from '../components/GridErrorBoundary';
import { Icon } from '../components/Icon';
import { SkeletonCell } from '../components/SkeletonCell';
import { FavStar } from '../components/FavStar';
import { PhotoCell } from '../components/PhotoGrid';
import { RaceDropdown } from '../components/wheels';
import { AppHeader } from '../components/AppHeader';
import { C, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { API_URL, R2_PUBLIC } from '../constants/api';
import { formatDateLong, cityLabel, displayEventType, isUpcoming } from '../utils/format';
import { raceTitle, extractBurstTs, extractIdx } from '../utils/photo';
import { selfieDotColor } from '../utils/styleHelpers';
import { Haptics } from '../services/haptics';

const { width: SCREEN_W } = Dimensions.get('window');

export function EventDetailScreen(props) {
  return (
    <GridErrorBoundary>
      <EventDetailScreenInner {...props} />
    </GridErrorBoundary>
  );
}

function EventDetailScreenInner({ event, onClose, onLogoPress, onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, onOpenPhoto, isFollowing, onToggleFollow, runnerFirstName, bibQuery = '', bibResults = null, bibSearching = false, photoFavoritesSet = null, isAuthed = false, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, onPhotosCountChange, onScrolledChange }) {
  const isFav = (id) => isAuthed && !!photoFavoritesSet?.has(id);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeRaceFilter, setActiveRaceFilter] = useState('all');
  const [activeKmFilter, setActiveKmFilter] = useState('all');
  const [sortDesc, setSortDesc] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const raceTabLayoutsRef = useRef({});
  const kmTabLayoutsRef = useRef({});
  const raceIndicatorX = useRef(new Animated.Value(0)).current;
  const raceIndicatorW = useRef(new Animated.Value(0)).current;
  const kmIndicatorX = useRef(new Animated.Value(0)).current;
  const kmIndicatorW = useRef(new Animated.Value(0)).current;
  const raceIndicatorInitRef = useRef(false);
  const kmIndicatorInitRef = useRef(false);
  const kmRowAnim = useRef(new Animated.Value(0)).current;
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);
  const tint = colorForType(event.event_type);
  const upcoming = isUpcoming(event.event_date, event.event_date_end);

  const countdown = (() => {
    if (!event.event_date) return null;
    const start = new Date(event.event_date);
    if (isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    const end = event.event_date_end ? new Date(event.event_date_end) : new Date(event.event_date);
    if (isNaN(end.getTime())) end.setTime(start.getTime());
    end.setHours(0, 0, 0, 0);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (t < start) return `J-${Math.round((start - t) / 86400000)}`;
    if (t <= end) return 'GO !';
    return `J+${Math.round((t - end) / 86400000)}`;
  })();

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/list-public/${event.code}`);
      const data = r.ok ? await r.json() : { photos: [] };
      const list = (data.photos || []).map(p => {
        const parts = (p.key || '').split('/');
        const photographerId = parts.length >= 2 ? parts[1] : null;
        return {
          uri: p.url || `${R2_PUBLIC}/${p.key}`,
          thumbUri: p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          thumbMdUri: p.thumb_md_url || p.thumb_url || p.url || `${R2_PUBLIC}/${p.key}`,
          id: p.key,
          tint,
          race: p.race,
          race_distance_id: p.race_distance_id || null,
          km: p.km,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
          photographer: photographerId,
        };
      });
      list.sort((a, b) => {
        const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
        if (dt !== 0) return dt;
        return extractIdx(b.id) - extractIdx(a.id);
      });
      setPhotos(list);
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

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    await loadPhotos();
    setRefreshing(false);
  }, [loadPhotos]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [activeRaceFilter, activeKmFilter]);

  useEffect(() => {
    setActiveKmFilter('all');
    kmIndicatorInitRef.current = false;
    kmTabLayoutsRef.current = {};
  }, [activeRaceFilter]);

  const photoRaceKey = (p) => (p && p.race_distance_id) ? String(p.race_distance_id) : (p && p.race ? String(p.race) : null);

  const uniqueRaces = (() => {
    const keys = Array.from(new Set(photos.map(photoRaceKey).filter(Boolean)));
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    const kmOf = (k) => {
      const d = evDistances.find(x => x && (x.id === k || String(x.km) === String(k)));
      return d ? Number(d.km) : Number(k);
    };
    return keys.sort((a, b) => kmOf(a) - kmOf(b));
  })();

  const raceLabelById = useMemo(() => {
    const m = {};
    for (const p of photos) {
      const key = photoRaceKey(p);
      if (key && p.race_label && !m[key]) {
        m[key] = { label: p.race_label, label_only: p.race_label_only === true };
      }
    }
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    for (const d of evDistances) {
      if (!d) continue;
      const entry = { label: d.label, label_only: d.label_only === true };
      if (d.id && !m[d.id] && d.label) m[d.id] = entry;
      const k = String(d.km);
      if (!m[k] && d.label) m[k] = entry;
    }
    return m;
  }, [photos, event.distances]);
  const raceTabLabel = (raceKey) => {
    const entry = raceLabelById[raceKey];
    const evDistances = Array.isArray(event.distances) ? event.distances : [];
    const d = evDistances.find(x => x && (x.id === raceKey || String(x.km) === String(raceKey)));
    const km = d ? d.km : raceKey;
    if (entry) return raceTitle({ label: entry.label, label_only: entry.label_only, km });
    return `${km} km`;
  };

  const kmsForActiveRace = (() => {
    if (activeRaceFilter === 'all') return [];
    const kms = photos
      .filter(p => photoRaceKey(p) === activeRaceFilter)
      .map(p => p.km)
      .filter(k => k !== null && k !== undefined && k !== '');
    return Array.from(new Set(kms.map(String))).sort((a, b) => {
      const na = a === 'arrivee' ? 0.5 : Number(a);
      const nb = b === 'arrivee' ? 0.5 : Number(b);
      return na - nb;
    });
  })();

  useEffect(() => {
    const l = raceTabLayoutsRef.current[activeRaceFilter];
    if (!l) return;
    Animated.parallel([
      Animated.spring(raceIndicatorX, { toValue: l.x, useNativeDriver: false, friction: 10, tension: 80 }),
      Animated.spring(raceIndicatorW, { toValue: l.width, useNativeDriver: false, friction: 10, tension: 80 }),
    ]).start();
  }, [activeRaceFilter]);

  useEffect(() => {
    const visible = activeRaceFilter !== 'all' && kmsForActiveRace.length > 1;
    Animated.spring(kmRowAnim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      friction: 11, tension: 80,
    }).start();
    if (!visible) return;
    const l = kmTabLayoutsRef.current[activeKmFilter];
    if (!l) return;
    Animated.parallel([
      Animated.spring(kmIndicatorX, { toValue: l.x, useNativeDriver: false, friction: 10, tension: 80 }),
      Animated.spring(kmIndicatorW, { toValue: l.width, useNativeDriver: false, friction: 10, tension: 80 }),
    ]).start();
  }, [activeKmFilter, activeRaceFilter, kmsForActiveRace.length]);

  const filteredPhotos = (() => {
    let list;
    if (activeRaceFilter === 'all') {
      list = photos;
    } else {
      list = photos.filter(p => photoRaceKey(p) === activeRaceFilter);
      if (activeKmFilter !== 'all') {
        list = list.filter(p => String(p.km) === activeKmFilter);
      }
    }
    if (favOnly && isAuthed && photoFavoritesSet) {
      list = list.filter(p => photoFavoritesSet.has(p.id));
    }
    return sortDesc ? list : [...list].reverse();
  })();

  const distances = Array.isArray(event.distances) ? event.distances : [];

  const openWebsite = () => {
    if (!event.website) return;
    const url = event.website.startsWith('http') ? event.website : `https://${event.website}`;
    Linking.openURL(url).catch(() => {});
  };

  const NUM_COLS = 3;
  const GRID_PADDING_H = 0;
  const GRID_GAP = 6;
  const SCROLL_PADDING_H = 20;
  const cellSize = (SCREEN_W - SCROLL_PADDING_H * 2 - GRID_PADDING_H * 2 - GRID_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const visiblePhotos = filteredPhotos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPhotos.length;

  const renderHeader = () => (
    <View style={{ gap: 8, paddingBottom: 8 }}>
      {/* Header mirror Accueil : Logo gauche + Hello + burger droite.
          Le burger ouvre le drawer (mirror onOpenProfile = setBurgerMenu). */}
      <View style={{ marginHorizontal: -20 }}>
        <AppHeader
          runnerFirstName={runnerFirstName || ''}
          selfieUri={selfieUri}
          selfieUploadState={selfieUploadState}
          onOpenProfile={onOpenProfile}
          onLogoPress={onLogoPress}
        />
      </View>

      <View style={{ position: 'relative', zIndex: 1 }}>
        <View style={[s.eventCard, { marginBottom: 0, height: undefined }]}>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: tint }]} />
          {event.cover_image ? (
            <ExpoImage
              source={{ uri: event.cover_image }}
              style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', right: 0 }}
              contentFit="cover"
            />
          ) : null}
          {event.cover_image ? (
            <LinearGradient
              colors={[tint, tint + '1A']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              locations={[0.5, 1]}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
          ) : null}
          <View style={[s.eventCardCenter, { paddingRight: 84, paddingVertical: 16 }]}>
            <Text style={s.eventDate} numberOfLines={1}>
              {formatDateLong(event.event_date, event.event_date_end)}
            </Text>
            <Text style={[s.eventName, { fontSize: 22, lineHeight: 27 }]} numberOfLines={2} ellipsizeMode="tail">{event.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'nowrap' }}>
              {cityLabel(event.location) ? (
                <Text style={[s.eventLocation, { marginTop: 0, flexShrink: 1 }]} numberOfLines={1}>
                  {cityLabel(event.location)}
                </Text>
              ) : null}
              {event.event_type ? (
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{displayEventType(event.event_type)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, marginBottom: 12 }} />
            <TouchableOpacity
              onPress={() => setInfoSheetOpen(v => !v)}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d={infoSheetOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                  stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                />
              </Svg>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Montserrat' }}>Infos pratiques</Text>
            </TouchableOpacity>
          </View>
        </View>

        {onToggleFollow && (
          <TouchableOpacity
            onPress={onToggleFollow}
            hitSlop={10}
            style={{
              position: 'absolute', top: 6, right: 6,
              width: 40, height: 40,
              alignItems: 'center', justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <Svg width={22} height={20} viewBox="-1 -1.5 22.78 20.61"
              fill={isFollowing ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}>
              <Path d="M15.11,0c-1.97,0-3.7,1.01-4.72,2.53-1.02-1.53-2.75-2.53-4.72-2.53C2.54,0,0,2.54,0,5.67c0,3.56,4.8,8.32,7.88,11,1.44,1.26,3.58,1.26,5.02,0,3.07-2.68,7.88-7.44,7.88-11,0-3.13-2.54-5.67-5.67-5.67Z" />
            </Svg>
          </TouchableOpacity>
        )}

        {countdown ? (
          <View style={{ position: 'absolute', bottom: 14, right: 16 }}>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontStyle: 'italic', letterSpacing: -0.8 }}>
              {countdown}
            </Text>
          </View>
        ) : null}
      </View>

      {infoSheetOpen && (
        <View style={{ marginTop: -24, position: 'relative' }}>
          <View style={{
            backgroundColor: `${tint}1A`,
            borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
            paddingTop: 16 + 16, paddingBottom: 16, paddingHorizontal: 16,
          }}>
            {distances.length > 0 && (
              <View>
                {distances.map((d, i) => (
                  <View key={i} style={{
                    paddingVertical: 12,
                    borderBottomWidth: i === distances.length - 1 ? 0 : StyleSheet.hairlineWidth,
                    borderBottomColor: `${tint}40`,
                  }}>
                    <View style={{ marginBottom: 4 }}>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: tint, fontSize: 15, fontWeight: '700' }}>
                        {raceTitle(d)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                        Départ {d.time || '—'}
                      </Text>
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                        Dénivelé {d.elevation || '—'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {event.website ? (
              <TouchableOpacity
                onPress={openWebsite}
                activeOpacity={0.6}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  marginTop: distances.length > 0 ? 14 : 4,
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: tint, fontSize: 13, fontWeight: '600', fontFamily: 'Montserrat' }}>
                  Site organisateur
                </Text>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12h14M13 6l6 6-6 6" stroke={tint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>
            ) : null}
          </View>
          <LinearGradient
            colors={[`${tint}40`, `${tint}00`]}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0, right: 0,
              top: 0, height: 36,
            }}
          />
        </View>
      )}

      {upcoming && photos.length === 0 && !loading ? (
        <View style={{
          paddingVertical: 16, paddingHorizontal: 16,
          backgroundColor: `${tint}1A`, borderRadius: 16,
        }}>
          <View style={{ alignItems: 'center' }}>
            <Icon.PhotoCam size={28} color={tint} />
            <Text style={{ color: tint, fontSize: 14, fontWeight: '700', marginTop: 8, textAlign: 'center' }}>
              Photos disponibles le jour J
            </Text>
            <Text style={{ color: tint, fontSize: 11, marginTop: 2, opacity: 0.75, textAlign: 'center' }}>
              Reviens le jour de l'événement pour les voir
            </Text>
          </View>

          {distances.length > 0 && (
            <View style={{
              height: 1,
              backgroundColor: '#fff',
              marginTop: 14,
              marginHorizontal: -16,
            }} />
          )}

          {distances.length > 0 && (
            <View style={{ marginTop: 14 }}>
              {distances.map((d, i) => (
                <View key={i} style={{
                  paddingVertical: 12,
                  borderBottomWidth: i === distances.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  borderBottomColor: `${tint}40`,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 4 }}>
                    <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: tint, fontSize: 15, fontWeight: '700', flex: 1 }}>
                      {d.label || `${d.km} km`}
                    </Text>
                    {d.label ? (
                      <Text style={{ color: tint, fontSize: 12, opacity: 0.7, marginLeft: 8 }}>{d.km} km</Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                      Départ {d.time || '—'}
                    </Text>
                    <Text style={{ color: tint, fontSize: 12, opacity: 0.85 }}>
                      Dénivelé {d.elevation || '—'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <>
          {photos.length > 0 && (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {/* Filtres race + km : seulement si l'event a plusieurs distances. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, flexShrink: 1, minWidth: 0 }}>
                  {uniqueRaces.length > 1 && (
                    <RaceDropdown
                      items={[{ key: 'all', label: 'Toutes les photos' }, ...uniqueRaces.map(r => ({ key: String(r), label: raceTabLabel(String(r)) }))]}
                      activeKey={activeRaceFilter}
                      onChange={(key) => {
                        LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
                        setActiveRaceFilter(key);
                        if (key === 'all') setActiveKmFilter('all');
                      }}
                      accent={C.primary}
                      bg="#EDE4FF"
                    />
                  )}
                  {uniqueRaces.length > 1 && activeRaceFilter !== 'all' && kmsForActiveRace.length > 1 && (
                    <RaceDropdown
                      items={[{ key: 'all', label: 'km' }, ...kmsForActiveRace.map(k => ({
                        key: k,
                        label: k === '0' ? 'Départ' : k === 'arrivee' ? 'Arrivée' : `km ${k}`,
                      }))]}
                      activeKey={activeKmFilter}
                      onChange={setActiveKmFilter}
                      accent={C.primary}
                      bg="#EDE4FF"
                      compact
                    />
                  )}
                </View>
                {/* Tri chronologique + favoris : toujours visibles des qu'il y
                    a au moins une photo (independamment du nombre de distances). */}
                <TouchableOpacity
                  onPress={() => {
                    try { Haptics?.selectionAsync?.(); } catch {}
                    setSortDesc(v => !v);
                  }}
                  hitSlop={10}
                  activeOpacity={0.7}
                  accessibilityLabel={sortDesc ? 'Trier du plus ancien au plus recent' : 'Trier du plus recent au plus ancien'}
                  style={{
                    width: 30, height: 30, borderRadius: 15,
                    backgroundColor: '#EDE4FF',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path d="M7 4v16M3 16l4 4 4-4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    <Path d="M17 20V4M13 8l4-4 4 4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>
                {isAuthed && (
                  <TouchableOpacity
                    onPress={() => {
                      try { Haptics?.selectionAsync?.(); } catch {}
                      setFavOnly(v => !v);
                    }}
                    hitSlop={10}
                    activeOpacity={0.7}
                    accessibilityLabel={favOnly ? 'Afficher toutes les photos' : 'Afficher uniquement les favoris'}
                    style={{
                      width: 30, height: 30, borderRadius: 15,
                      backgroundColor: favOnly ? C.primary : '#EDE4FF',
                      alignItems: 'center', justifyContent: 'center',
                      marginLeft: 6,
                    }}
                  >
                    <FavStar
                      size={14}
                      fill={favOnly ? '#fff' : C.primary}
                      stroke={favOnly ? '#fff' : C.primary}
                      strokeWidth={1.8}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );

  const showEmptyMessage = upcoming && photos.length === 0 && !loading;

  const renderListEmpty = () => {
    if (showEmptyMessage) return null;
    if (upcoming) return null;
    if (loading) {
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GRID_PADDING_H, gap: GRID_GAP }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonCell key={`sk-${i}`} size={cellSize} />
          ))}
        </View>
      );
    }
    return (
      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
        <Text style={{ color: C.textSoft }}>Aucune photo pour le moment</Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!hasMore || showEmptyMessage) return null;
    return (
      <View style={{ paddingVertical: 16, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={C.primary} />
      </View>
    );
  };

  // Grid bento : chunks de 12 photos, chaque chunk rend big 2x2 + 11 small.
  // Position du big alterne entre gauche (chunks pairs) et droite (impairs).
  const bigSize = 2 * cellSize + GRID_GAP;
  const photoChunks = (() => {
    const chunks = [];
    for (let i = 0; i < visiblePhotos.length; i += 12) {
      chunks.push(visiblePhotos.slice(i, i + 12));
    }
    return chunks;
  })();

  const renderPhotoSized = (photo, width, height, key) => {
    if (!photo) return <View key={key} style={{ width, height }} />;
    const sourceUri = key === 'big'
      ? (photo.thumbMdUri || photo.thumbUri || photo.uri)
      : (photo.thumbUri || photo.uri);
    return (
      <View key={key} style={{ width, height }}>
        <PhotoCell
          photo={{ ...photo, uri: sourceUri }}
          size={{ width, height }}
          favIndicator={isFav(photo.id)}
          onPress={(origin) => onOpenPhoto?.(photo, filteredPhotos, {
            origin,
            eventTitle: event?.name,
            eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
            photosForSale: !!event?.photos_for_sale,
            eventCode: event?.code,
          })}
        />
      </View>
    );
  };

  const renderBibPhotoSized = (photo, width, height, key) => {
    if (!photo) return null;
    return (
      <View key={key} style={{ width, height }}>
        <PhotoCell
          photo={{ ...photo, uri: photo.thumbUri || photo.uri }}
          size={{ width, height }}
          favIndicator={isFav(photo.id)}
          onPress={(origin) => onOpenPhoto?.(photo, bibResults, {
            origin,
            eventTitle: event?.name,
            eventDate: event?.event_date ? formatDateLong(event.event_date, event.event_date_end) : null,
            photosForSale: !!event?.photos_for_sale,
            eventCode: event?.code,
          })}
        />
      </View>
    );
  };
  const renderBibResults = () => {
    if (bibSearching) {
      return (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      );
    }
    if (!bibResults || bibResults.length === 0) {
      return (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' }}>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
            Aucune photo trouvée pour le dossard {bibQuery.trim()}
          </Text>
          <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', lineHeight: 17 }}>
            Scrolle la galerie pour chercher manuellement.
          </Text>
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: GRID_PADDING_H }}>
        <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 8, marginBottom: 10 }}>
          {bibResults.length} photo{bibResults.length > 1 ? 's' : ''} trouvée{bibResults.length > 1 ? 's' : ''} pour le dossard {bibQuery.trim()}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {bibResults.map((p, i) => renderBibPhotoSized(p, cellSize, cellSize, `bib-${i}`))}
        </View>
      </View>
    );
  };

  const renderChunks = () => {
    if (showEmptyMessage || photoChunks.length === 0) return null;
    return (
      <View style={{ paddingHorizontal: GRID_PADDING_H }}>
        {photoChunks.map((chunk, idx) => {
          const bigLeft = idx % 2 === 0;
          return (
            <View key={idx} style={{ marginBottom: GRID_GAP }}>
              <View style={{ flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP }}>
                {bigLeft ? (
                  <>
                    {renderPhotoSized(chunk[0], bigSize, bigSize, 'big')}
                    <View style={{ gap: GRID_GAP, justifyContent: 'space-between' }}>
                      {renderPhotoSized(chunk[1], cellSize, cellSize, 's1')}
                      {renderPhotoSized(chunk[2], cellSize, cellSize, 's2')}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ gap: GRID_GAP, justifyContent: 'space-between' }}>
                      {renderPhotoSized(chunk[1], cellSize, cellSize, 's1')}
                      {renderPhotoSized(chunk[2], cellSize, cellSize, 's2')}
                    </View>
                    {renderPhotoSized(chunk[0], bigSize, bigSize, 'big')}
                  </>
                )}
              </View>
              {[
                [chunk[3], chunk[4], chunk[5]],
                [chunk[6], chunk[7], chunk[8]],
                [chunk[9], chunk[10], chunk[11]],
              ].map((row, ri) => (
                (row[0] || row[1] || row[2]) ? (
                  <View
                    key={`row${ri}`}
                    style={{
                      flexDirection: 'row',
                      gap: GRID_GAP,
                      marginBottom: ri < 2 ? GRID_GAP : 0,
                    }}
                  >
                    {renderPhotoSized(row[0], cellSize, cellSize, `r${ri}-0`)}
                    {renderPhotoSized(row[1], cellSize, cellSize, `r${ri}-1`)}
                    {renderPhotoSized(row[2], cellSize, cellSize, `r${ri}-2`)}
                  </View>
                ) : null
              ))}
            </View>
          );
        })}
      </View>
    );
  };

  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollToTopSignal > 0) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [scrollToTopSignal]);
  useEffect(() => {
    if (onPhotosCountChange) onPhotosCountChange(photos.length, loading);
  }, [photos.length, loading, onPhotosCountChange]);
  const hasScrolledRef = useRef(false);

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: 180 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const scrolled = contentOffset.y > 50;
          if (scrolled !== hasScrolledRef.current) {
            hasScrolledRef.current = scrolled;
            onScrolledChange?.(scrolled);
          }
          if (!hasMore) return;
          const distFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
          if (distFromBottom < 600) {
            setVisibleCount(c => Math.min(c + PAGE_SIZE, filteredPhotos.length));
          }
        }}
        scrollEventThrottle={250}
        showsVerticalScrollIndicator={false}
      >
        {renderHeader()}
        {bibQuery.trim().length > 0
          ? renderBibResults()
          : favOnly && visiblePhotos.length === 0 && !loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
                Aucune photo en favoris pour cet event.
              </Text>
            </View>
          ) : ((loading || upcoming) && visiblePhotos.length === 0 ? renderListEmpty() : renderChunks())}
        {bibQuery.trim().length === 0 && renderFooter()}
      </ScrollView>

      {/* Confirm modal "Ne plus suivre" (Phase D3). */}
      <Modal
        visible={showUnfollowConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnfollowConfirm(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(26,20,38,0.5)',
          justifyContent: 'center', padding: 24,
        }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 22 }}>
            <Text style={{
              fontSize: 17, fontWeight: '800', color: '#1A1426',
              marginBottom: 10, textAlign: 'center',
            }}>
              Retirer cet event des favoris ?
            </Text>
            <Text style={{
              fontSize: 14, color: C.text, lineHeight: 20,
              marginBottom: 10, textAlign: 'center',
            }}>
              Tu ne recevras plus de notifs pour les nouvelles photos de cet event. Les photos déjà identifiées restent dans ta galerie.
            </Text>
            <Text style={{
              fontSize: 11, color: C.textSoft, lineHeight: 15,
              marginBottom: 20, textAlign: 'center',
            }}>
              Ta reconnaissance faciale globale n'est pas affectée — tu restes reconnaissable sur les autres events Will que tu suis. Pour la retirer, utilise « Supprimer mon selfie » dans ton profil.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setShowUnfollowConfirm(false)}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 999,
                  borderWidth: 1.5, borderColor: '#E4E0EC',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 14, fontWeight: '600' }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowUnfollowConfirm(false); onToggleFollow(); }}
                style={{
                  flex: 1, paddingVertical: 13, borderRadius: 999,
                  backgroundColor: C.primary,
                  alignItems: 'center',
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Retirer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
