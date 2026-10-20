// Ecran detail event coureur : hero + CTA Favoris + Infos pratiques inline +
// filtres course/poste en puces (FiltresGalerie), grid bento (1 big 2x2 + 11 small alternance
// gauche/droite par chunk de 12), pagination, recherche dossard.
//
// Wrappe dans GridErrorBoundary : si une URL malformee ou un render thrown
// dans une cellule crash, fallback avec retry au lieu de tout planter.

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, ScrollView, RefreshControl, Modal,
  LayoutAnimation, ActivityIndicator, StyleSheet, Linking, Animated, Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { GridErrorBoundary } from '../components/GridErrorBoundary';
import { EtatVidePhotos } from '../components/EtatVidePhotos';
import { Icon } from '../components/Icon';
import { SkeletonCell } from '../components/SkeletonCell';
import { FavStar } from '../components/FavStar';
import { PhotoCell } from '../components/PhotoGrid';
import { FiltresGalerie } from '../components/FiltresGalerie';
import { AppHeader } from '../components/AppHeader';
import { C, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { API_URL } from '../constants/api';
import { formatDateLong, formatDateLongMinuscule, cityLabel, displayEventType, isUpcoming } from '../utils/format';
import { raceTitle, extractBurstTs, extractIdx } from '../utils/photo';
import { selfieDotColor } from '../utils/styleHelpers';
import { Haptics } from '../services/haptics';
import { lh } from '../constants/typo';

const { width: SCREEN_W } = Dimensions.get('window');

export function EventDetailScreen(props) {
  return (
    <GridErrorBoundary>
      <EventDetailScreenInner {...props} />
    </GridErrorBoundary>
  );
}

// sortDesc et favOnly viennent d App.js : leurs deux boutons vivent
// desormais dans la pill de recherche par dossard, qui est rendue la-bas,
// par-dessus la barre d onglets. L ecran lit l etat, il ne le detient plus.
function EventDetailScreenInner({ event, onClose, onLogoPress, onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, onOpenPhoto, isFollowing, onToggleFollow, runnerFirstName, bibQuery = '', bibResults = null, bibSearching = false, photoFavoritesSet = null, isAuthed = false, selfieUploadState = 'idle', onRetryUpload, scrollToTopSignal = 0, onPhotosCountChange, onScrolledChange, sortDesc = true, favOnly = false }) {
  const isFav = (id) => isAuthed && !!photoFavoritesSet?.has(id);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeRaceFilter, setActiveRaceFilter] = useState('all');
  const [activeKmFilter, setActiveKmFilter] = useState('all');
  // Infos pratiques : ouvertes automatiquement quand on detecte qu il
  // n y a pas de photos (event upcoming ou tout simplement vide).
  // Si l user clique sur le toggle ensuite, son choix est respecte
  // (userToggledRef = true bloque tout auto-update ulterieur).
  // Ouverture immediate (pas apres le fetch photos) quand on sait deja qu il
  // n y aura rien a montrer : event a venir, ou has_photos=false renvoye par
  // /public-events. Evite le flip ferme -> ouvert au montage.
  const [infoSheetOpen, setInfoSheetOpen] = useState(
    () => isUpcoming(event?.event_date, event?.event_date_end) || event?.has_photos === false
  );
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (userToggledRef.current) return;
    if (!loading && photos.length === 0) {
      setInfoSheetOpen(true);
    }
  }, [loading, photos.length]);
  // Mini-carte : 1 tile CartoDB Positron (sans cle, sans install RN) centree
  // sur lat/lng (issu de BAN). Marker brand violet pose en overlay au pixel
  // exact, calcule depuis la position fractionnaire dans la tile.
  // Adresse precise si l organisateur l a saisie, sinon la ville
  // (ex "Les Andelys (27700)") : mieux vaut une carte au niveau commune
  // que pas de carte du tout. Le code postal sort des parentheses, la BAN
  // ne les digere pas.
  const mapQuery = (event?.address || event?.location || '').trim();
  const mapPrecise = !!event?.address;
  const [mapInfo, setMapInfo] = useState(null);
  const [mapW, setMapW] = useState(0);
  useEffect(() => {
    if (!mapQuery) { setMapInfo(null); return; }
    let cancelled = false;
    // La BAN ne digere pas les parentheses. Un code postal (5 chiffres) aide
    // la recherche, on le garde sans parentheses ; un numero de departement
    // (2 ou 3 chiffres, « Gaillon (27) ») n est pas une adresse et faisait
    // echouer le geocodage -- donc carte vide. On le retire.
    const q = mapQuery
      .replace(/\s*\((\d{5})\)\s*/, ' $1')
      .replace(/\s*\(\s*\d{2,3}\s*\)\s*/, ' ')
      .trim();
    const zoom = mapPrecise ? 15 : 12;
    const cacheKey = `will:geo:${zoom}:${q}`;

    // Mosaique 2x2 centree sur le point : une seule tile "cover" recadre le
    // carre dans un bandeau 2.4:1 et decale le marker (le % s appliquait au
    // container, pas a l image). Avec 4 tiles on positionne le bloc pour que
    // le point tombe pile au centre, sans jamais laisser de vide.
    const composer = ({ lat, lng }) => {
      const n = Math.pow(2, zoom);
      const xExact = (lng + 180) / 360 * n;
      const latRad = lat * Math.PI / 180;
      const yExact = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
      // Coin haut-gauche du bloc 2x2 : le point reste entre 0.5 et 1.5 tile
      // dans le bloc -> marge >= 1/2 tile de chaque cote.
      const x0 = Math.floor(xExact - 0.5);
      const y0 = Math.floor(yExact - 0.5);
      const bloc = {
        // ?v=2 : purge de cache. Les tuiles blanches « API KEY REQUIRED »
        // servies pendant la panne CARTO ont ete mises en cache 30 jours,
        // a l edge Cloudflare comme sur les telephones, avec un en-tete
        // immutable. Sans changer l URL, les coureurs auraient garde une
        // carte blanche jusqu a fin novembre. Le worker ignore la query, le
        // cache non : c est tout ce qu il faut. A incrementer a chaque fois
        // qu une tuile deja servie doit etre refaite.
        tiles: [
          [`${API_URL}/map-tile/${zoom}/${x0}/${y0}?v=2`, `${API_URL}/map-tile/${zoom}/${x0 + 1}/${y0}?v=2`],
          [`${API_URL}/map-tile/${zoom}/${x0}/${y0 + 1}?v=2`, `${API_URL}/map-tile/${zoom}/${x0 + 1}/${y0 + 1}?v=2`],
        ],
        // Position du point dans le bloc, en tiles (0-2).
        pointX: xExact - x0,
        pointY: yExact - y0,
      };
      // Telechargement lance des que les coords sont connues, sans attendre
      // le layout : les 4 tuiles sont deja en cache disque quand le bloc
      // se monte, et le restent pour les prochaines ouvertures.
      ExpoImage.prefetch(bloc.tiles.flat(), { cachePolicy: 'memory-disk' }).catch(() => {});
      return bloc;
    };

    (async () => {
      // Cache local : le geocodage d une adresse ne bouge pas, inutile de
      // repayer un aller-retour reseau a chaque ouverture de l event.
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached && !cancelled) setMapInfo(composer(JSON.parse(cached)));
        if (cached) return;
      } catch {}
      try {
        const r = await fetch(`${API_URL}/geocode?q=${encodeURIComponent(q)}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!d || !d.found) return;
        const coords = { lat: d.lat, lng: d.lng };
        AsyncStorage.setItem(cacheKey, JSON.stringify(coords)).catch(() => {});
        if (!cancelled) setMapInfo(composer(coords));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [mapQuery, mapPrecise]);

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
  // Audit coureur 5 -- loadPhotos avalait TOUTE erreur en liste vide, et la
  // liste vide s affichait « Reviens le jour de l event ». Une panne reseau
  // sur une course deja courue racontait donc au coureur que sa course
  // n avait pas encore eu lieu. Troisieme etat, distinct des deux autres.
  const [erreurChargement, setErreurChargement] = useState(false);
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
    // Apres l event, plus de compte a rebours : "J+44" ne repond a aucune
    // question que se pose un coureur venu chercher ses photos (regle user
    // 2026-10-20). Trois etats seulement : J-X, GO !, rien.
    return null;
  })();

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    setErreurChargement(false);
    // Audit coureur 3 -- delai maximal : sans lui, un reseau qui accepte la
    // connexion sans repondre laissait la fiche event en chargement sans fin.
    let ctrl = null; let minuteur = null;
    try {
      ctrl = new AbortController();
      minuteur = setTimeout(() => { try { ctrl.abort(); } catch {} }, 15000);
    } catch {}
    try {
      const r = await fetch(`${API_URL}/list-public/${event.code}`, ctrl ? { signal: ctrl.signal } : undefined);
      if (!r.ok) {
        setErreurChargement(true);
        return;
      }
      const data = await r.json();
      const list = (data.photos || []).map(p => {
        const parts = (p.key || '').split('/');
        const photographerId = parts.length >= 2 ? parts[1] : null;
        return {
          uri: p.url || '',
          thumbUri: p.thumb_url || p.url || '',
          thumbMdUri: p.thumb_md_url || p.thumb_url || p.url || '',
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
    } catch (e) {
      // On NE vide PAS la liste : si des photos etaient deja affichees, les
      // remplacer par un etat vide serait un second mensonge.
      setErreurChargement(true);
    } finally {
      if (minuteur) clearTimeout(minuteur);
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

  // Les postes presents dans une liste de photos, tries le long du parcours.
  const kmsDesPhotos = (liste) => {
    const kms = liste
      .map(p => p.km)
      .filter(k => k !== null && k !== undefined && k !== '');
    return Array.from(new Set(kms.map(String))).sort((a, b) => {
      const na = a === 'arrivee' ? 0.5 : Number(a);
      const nb = b === 'arrivee' ? 0.5 : Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b), 'fr');
    });
  };

  const libellePoste = (k) => (k === '0' ? 'Départ' : k === 'arrivee' ? 'Arrivée' : `km ${k}`);

  const puceCourses = useMemo(() => {
    if (uniqueRaces.length <= 1) return [];
    return [
      { key: 'all', label: 'Toutes', count: photos.length },
      ...uniqueRaces.map(r => ({
        key: String(r),
        label: raceTabLabel(String(r)),
        count: photos.filter(p => photoRaceKey(p) === String(r)).length,
      })),
    ];
  }, [photos, uniqueRaces, raceLabelById, event.distances]);

  // Les postes d une course, et d une seule (decision user 2026-10-20) : sur
  // « Toutes », aucun poste n est propose. Un km n a pas le meme sens d une
  // course a l autre — le km 7 du 10 km et le km 7 du trail ne sont pas au
  // meme endroit du parcours — donc les melanger ne filtrerait rien de
  // comprehensible. Le site le fait, l app non : c est l app qui a raison.
  //
  // Exception : un event dont les photos n ont aucune course assignee, ou
  // n en a qu une. Il n y a alors qu un seul parcours possible, donc aucune
  // ambiguite : les postes sont la seule rangee, au niveau 1.
  const pucePostes = useMemo(() => {
    const courseUnique = uniqueRaces.length <= 1;
    if (!courseUnique && activeRaceFilter === 'all') return [];
    const base = courseUnique
      ? photos
      : photos.filter(p => photoRaceKey(p) === activeRaceFilter);
    const kms = kmsDesPhotos(base);
    if (kms.length <= 1) return [];
    return [
      { key: 'all', label: 'Tous', count: base.length },
      ...kms.map(k => ({
        key: k,
        label: libellePoste(k),
        count: base.filter(p => String(p.km) === k).length,
      })),
    ];
  }, [photos, activeRaceFilter, uniqueRaces]);

  // Sans cette remise a zero, un poste choisi puis un retour sur « Toutes »
  // laissait la galerie filtree par un poste dont la rangee avait disparu :
  // des photos manquantes, et plus aucun moyen de comprendre pourquoi.
  useEffect(() => {
    if (pucePostes.length === 0 && activeKmFilter !== 'all') setActiveKmFilter('all');
  }, [pucePostes.length, activeKmFilter]);

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
    let list = activeRaceFilter === 'all'
      ? photos
      : photos.filter(p => photoRaceKey(p) === activeRaceFilter);
    // Le poste se filtre meme sans course selectionnee : quand l event n a
    // qu une course, elle n est jamais "choisie" mais ses postes sont bien
    // le filtre affiche (rangee de niveau 1).
    if (activeKmFilter !== 'all') {
      list = list.filter(p => String(p.km) === activeKmFilter);
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
            {/* Trois lignes sont devenues deux (user 2026-10-20) : le lieu
                suit la date, le type suit le nom. La hero perd la hauteur
                d une ligne sans rien perdre de son contenu. */}
            <Text style={s.eventDate} numberOfLines={1}>
              {formatDateLongMinuscule(event.event_date, event.event_date_end)}
              {cityLabel(event.location) ? `  ·  ${cityLabel(event.location)}` : ''}
            </Text>
            {/* La pastille est imbriquee DANS le titre, pas posee a cote :
                en rangee flex, un titre sur deux lignes la repoussait au
                centre vertical du bloc. Ici elle suit le dernier mot, et
                passe a la ligne avec lui. React Native autorise une View
                dans un Text ; le decalage vertical la pose sur la ligne de
                base plutot que sur le haut des capitales. */}
            <Text
              style={[s.eventName, { fontSize: 22, lineHeight: 27 }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {event.name}
              {event.event_type ? (
                <Text>
                  {'  '}
                  <View style={{
                    backgroundColor: 'rgba(255,255,255,0.22)',
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                    transform: [{ translateY: 2 }],
                  }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'Montserrat-SemiBold' }}>
                      {displayEventType(event.event_type)}
                    </Text>
                  </View>
                </Text>
              ) : null}
            </Text>
            <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, marginBottom: 12 }} />
            <TouchableOpacity
              onPress={() => {
                userToggledRef.current = true;
                setInfoSheetOpen(v => !v);
              }}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <Path
                  d={infoSheetOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                  stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                />
              </Svg>
              <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>Infos pratiques</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Icone seule sur la hero : pas de pastille noire, pas de libelle —
            c est la regle posee pour les actions superposees a une image
            (user 2026-10-20). Elle annule la contre-mesure de l audit
            coureur 14, qui avait ajoute le libelle ici parce que le coeur
            n expliquait pas qu il declenchait les notifications ; l etat
            suivi/non suivi reste porte par le remplissage, et le retrait
            passe toujours par la modale de confirmation.
            L ombre portee n est pas un fond : elle garde le blanc lisible
            quand la photo d event est claire (contraste, regle 8). */}
        {onToggleFollow && (
          <TouchableOpacity
            onPress={() => { if (isFollowing) setShowUnfollowConfirm(true); else onToggleFollow(); }}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel={isFollowing ? 'Ne plus suivre cet event' : 'Suivre cet event pour être notifié'}
            style={{ position: 'absolute', top: 10, right: 14, zIndex: 10 }}
          >
            <Svg width={24} height={21} viewBox="-1 -1.5 22.78 20.61"
              fill={isFollowing ? '#fff' : 'none'} stroke="#fff" strokeWidth={1.8}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.3,
                shadowRadius: 3,
              }}>
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
                {distances.map((d, i) => {
                  // Mirror du pattern vitrine event/index.html : layout
                  // grid 4 colonnes (label | km | Depart | Denivele), avec
                  // mot-cle (Depart/Denivele) et valeur sur 2 lignes.
                  // La col label prend 1.5fr, les 3 autres 1fr.
                  const hasLabel = !!(d && d.label && String(d.label).trim());
                  const km = d && d.km !== undefined && d.km !== null && d.km !== ''
                    ? `${d.km} km` : '';
                  const labelText = hasLabel ? String(d.label).trim() : km;
                  const kmSecondary = hasLabel ? km : '';
                  const time = d && d.time && String(d.time).trim() ? String(d.time).trim() : '';
                  const elev = d && d.elevation && String(d.elevation).trim() ? String(d.elevation).trim() : '';
                  return (
                    <View key={i} style={{
                      paddingVertical: 12,
                      borderBottomWidth: i === distances.length - 1 ? 0 : StyleSheet.hairlineWidth,
                      borderBottomColor: `${tint}40`,
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                    }}>
                      {/* Col 1.5 : label de course en gras tint. Wrap autorise. */}
                      <View style={{ flex: 1.5, paddingRight: 8 }}>
                        <Text style={{ color: tint, fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>
                          {labelText}
                        </Text>
                      </View>
                      {/* Col 1 : km secondaire en petit, meme tint. */}
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        {kmSecondary ? (
                          <Text style={{ color: tint, fontSize: 12, opacity: 0.85, fontFamily: 'Montserrat-Medium' }}>
                            {kmSecondary}
                          </Text>
                        ) : null}
                      </View>
                      {/* Col 1 : Depart key/value sur 2 lignes. */}
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        {time ? (
                          <>
                            <Text style={{ color: tint, fontSize: 12, opacity: 0.85, fontFamily: 'Montserrat-Medium' }}>Départ</Text>
                            <Text style={{ color: tint, fontSize: 12, opacity: 0.85, fontFamily: 'Montserrat-Medium' }}>{time}</Text>
                          </>
                        ) : null}
                      </View>
                      {/* Col 1 : Denivele key/value sur 2 lignes. */}
                      <View style={{ flex: 1 }}>
                        {elev ? (
                          <>
                            <Text style={{ color: tint, fontSize: 12, opacity: 0.85, fontFamily: 'Montserrat-Medium' }}>Dénivelé</Text>
                            <Text style={{ color: tint, fontSize: 12, opacity: 0.85, fontFamily: 'Montserrat-Medium' }}>{elev} mD+</Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {mapQuery ? (
              <View style={{
                marginTop: distances.length > 0 ? 14 : 4,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: `${tint}14`,
                alignSelf: 'stretch',
              }}>
                {/* Le bandeau n existe que si on a un point a montrer. Sans
                    ce garde-fou, un geocodage sans resultat laissait un
                    rectangle 2.4:1 vide sous « Infos pratiques » — la carte
                    vide. L adresse et l itineraire, eux, restent : ils ne
                    dependent pas du geocodage. */}
                {mapInfo ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={`Ouvrir ${mapQuery} dans Plans`}
                  onPress={() => {
                    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
                    Linking.openURL(url).catch(() => {});
                  }}
                  style={{ width: '100%', aspectRatio: 2.4, position: 'relative', overflow: 'hidden' }}
                  onLayout={e => setMapW(Math.round(e.nativeEvent.layout.width))}
                >
                  {mapInfo && mapW > 0 ? (
                    <>
                      {/* Bloc 2x2 de tiles, decale pour que le point tombe au
                          centre du bandeau. S = largeur du container : la
                          marge d 1/2 tile autour du point garantit qu il n y a
                          jamais de vide sur les bords. */}
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          width: mapW * 2,
                          height: mapW * 2,
                          left: mapW / 2 - mapInfo.pointX * mapW,
                          top: mapW / 2 / 2.4 - mapInfo.pointY * mapW,
                        }}
                      >
                        {mapInfo.tiles.map((row, ri) => (
                          <View key={ri} style={{ flexDirection: 'row' }}>
                            {row.map((uri, ci) => (
                              <ExpoImage
                                key={ci}
                                source={{ uri }}
                                style={{ width: mapW, height: mapW }}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                transition={120}
                              />
                            ))}
                          </View>
                        ))}
                      </View>
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          left: '50%', top: '50%',
                          width: 28, height: 28,
                          marginLeft: -14, marginTop: -14,
                          backgroundColor: '#7B2FFF',
                          borderRadius: 14,
                          borderWidth: 3, borderColor: '#fff',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.3,
                          shadowRadius: 4,
                          elevation: 4,
                        }}
                      />
                    </>
                  ) : null}
                  {/* Attribution : CARTO l exige sur chaque carte au titre de
                      son offre gratuite, OpenStreetMap au titre de l ODbL.
                      Posee sur la tuile, en petit, comme le fait Leaflet. */}
                  <View style={{
                    position: 'absolute', right: 0, bottom: 0,
                    backgroundColor: 'rgba(255,255,255,0.72)',
                    paddingHorizontal: 5, paddingVertical: 1,
                    borderTopLeftRadius: 8,
                  }}>
                    <Text style={{ fontFamily: 'Montserrat', fontSize: 8, color: C.textSoft }}>
                      © CARTO © OpenStreetMap
                    </Text>
                  </View>
                </TouchableOpacity>
                ) : null}
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 10, paddingHorizontal: 14,
                  gap: 12,
                }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: tint, fontSize: 13, flex: 1, fontFamily: 'Montserrat-Medium' }}
                  >
                    {mapQuery}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
                      Linking.openURL(url).catch(() => {});
                    }}
                    activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    <Text style={{ color: tint, fontSize: 13, fontFamily: 'Montserrat-Bold' }}>
                      Itinéraire
                    </Text>
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M5 12h14M13 6l6 6-6 6" stroke={tint} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {event.website ? (
              <TouchableOpacity
                onPress={openWebsite}
                activeOpacity={0.85}
                style={{
                  backgroundColor: tint,
                  paddingVertical: 11, paddingHorizontal: 20,
                  borderRadius: 999,
                  flexDirection: 'row', alignItems: 'center',
                  gap: 8,
                  marginTop: (distances.length > 0 || mapQuery) ? 14 : 4,
                  alignSelf: 'flex-start',
                  shadowColor: tint,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.22,
                  shadowRadius: 14,
                  elevation: 3,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-Bold' }}>
                  Site organisateur
                </Text>
                <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                  <Path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
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

      {erreurChargement && photos.length === 0 && !loading ? (
        <View style={{ paddingVertical: 34, paddingHorizontal: 24, alignItems: 'center' }}>
          <Text style={{ color: '#C9B6FF', fontSize: 18, lineHeight: lh(18, 22), fontFamily: 'AVEstiana-Bold', textAlign: 'center' }}>
            Impossible de charger les photos
          </Text>
          <Text style={{ color: C.text, fontSize: 12, fontFamily: 'Montserrat-Medium', textAlign: 'center', marginTop: 6, lineHeight: 17 }}>
            {upcoming
              ? "Vérifie ta connexion. Cette course n'a pas encore eu lieu : il est normal qu'il n'y ait pas encore de photos."
              : 'Vérifie ta connexion : les photos de cette course existent peut-être déjà.'}
          </Text>
          <TouchableOpacity
            onPress={loadPhotos}
            activeOpacity={0.85}
            style={{ marginTop: 14, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 999, backgroundColor: C.primary }}
          >
            <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 14 }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : upcoming && photos.length === 0 && !loading ? (
        <EtatVidePhotos />
      ) : null}
    </View>
  );

  // Rendu a part, et non dans renderHeader : c est l enfant d index 1 du
  // ScrollView, celui que stickyHeaderIndices colle en haut. Il doit donc
  // exister a chaque rendu, meme vide, sinon l index designe autre chose.
  const renderFiltres = () => {
    if (photos.length === 0 || erreurChargement || (upcoming && photos.length === 0)) {
      return <View />;
    }
    return (
      <View style={{ marginHorizontal: -20 }}>
        <FiltresGalerie
          courses={puceCourses}
          postes={pucePostes}
          courseActive={activeRaceFilter}
          posteActif={activeKmFilter}
          onCourse={(key) => {
            LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
            setActiveRaceFilter(key);
            setActiveKmFilter('all');
          }}
          onPoste={(key) => {
            LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
            setActiveKmFilter(key);
          }}
        />
      </View>
    );
  };

  const showEmptyMessage = upcoming && photos.length === 0 && !loading;

  const renderListEmpty = () => {
    if (showEmptyMessage) return null;
    // Le bandeau d erreur est deja rendu en tete : pas deux fois.
    if (erreurChargement) return null;
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
    // Une course deja courue qui n a recu aucune photo ne doit pas lire
    // « Reviens le jour de l event » : ce jour est passe.
    return <EtatVidePhotos sousTexte="Aucun photographe n'a encore envoyé de photo pour cette course." />;
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
            eventType: event?.event_type || null,
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
            eventType: event?.event_type || null,
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
          <Text style={{ color: C.text, fontSize: 14, fontFamily: 'Montserrat-SemiBold', textAlign: 'center', marginBottom: 6 }}>
            Aucune photo trouvée pour le dossard {bibQuery.trim()}
          </Text>
          <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 12, textAlign: 'center', lineHeight: 17 }}>
            Scrolle la galerie pour chercher manuellement.
          </Text>
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: GRID_PADDING_H }}>
        <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 12, marginTop: 8, marginBottom: 10 }}>
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
        /* La barre de filtres (enfant 1) reste en haut pendant le
           defilement : changer de course ne demande plus de remonter
           toute la galerie. */
        stickyHeaderIndices={[1]}
      >
        {renderHeader()}
        {renderFiltres()}
        {bibQuery.trim().length > 0
          ? renderBibResults()
          : favOnly && visiblePhotos.length === 0 && !loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 14, textAlign: 'center' }}>
                Aucune photo en favoris pour cet event.
              </Text>
            </View>
          ) : ((loading || upcoming || photos.length === 0) && visiblePhotos.length === 0 ? renderListEmpty() : renderChunks())}
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
              fontSize: 17, fontFamily: 'Montserrat-Bold', color: '#1A1426',
              marginBottom: 10, textAlign: 'center',
            }}>
              Ne plus suivre cet event ?
            </Text>
            <Text style={{ fontFamily: 'Montserrat',
              fontSize: 14, color: C.text, lineHeight: 20,
              marginBottom: 10, textAlign: 'center',
            }}>
              Tu ne recevras plus de notifs pour les nouvelles photos de cet event. Les photos déjà identifiées restent dans ta galerie.
            </Text>
            <Text style={{ fontFamily: 'Montserrat',
              fontSize: 11, color: C.textSoft, lineHeight: 15,
              marginBottom: 20, textAlign: 'center',
            }}>
              Ta reconnaissance faciale n'est pas affectée — Will continue de te reconnaître sur les autres events. Pour l'arrêter partout, utilise « Effacer mon empreinte faciale » dans ton profil.
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
                <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Annuler</Text>
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
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Retirer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
