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
// Melange deux couleurs hex et renvoie un hex opaque. Sert a connaitre la
// couleur REELLE d un fond pose en transparence : un degrade qui doit s y
// fondre ne peut pas reutiliser la couche translucide, il la doublerait.
// Premiere lettre en majuscule, le reste intact : « minimes filles » devient
// « Minimes filles » sans toucher a « 10 km Rando » ni aux sigles. La saisie
// de l organisateur n est pas normalisee, l affichage l est.
function majusculePremiere(t) {
  const v = String(t || '').trim();
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function melangerSurFond(fond, dessus, alpha) {
  const lire = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const f = lire(fond);
  const d = lire(dessus);
  if (!f || !d) return fond;
  const c = f.map((v, i) => Math.round(alpha * d[i] + (1 - alpha) * v));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

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
  // Adresse precise si l organisateur l a saisie, sinon la ville. Sert
  // desormais au seul lien « Itineraire » : le bandeau de carte a ete retire
  // (choix user 2026-10-26, variante B des maquettes). Il coutait 150 pt de
  // hauteur pour un apercu qu on quittait au premier tap, plus un geocodage
  // et six tuiles par ouverture d event. Le worker garde /geocode et
  // /map-tile : le site, lui, affiche une vraie carte Leaflet.
  const mapQuery = (event?.address || event?.location || '').trim();

  // Rangee de puces defilante : on ne devine pas le debordement, on le mesure.
  const [railW, setRailW] = useState(0);
  const [railContenuW, setRailContenuW] = useState(0);
  const [railX, setRailX] = useState(0);
  const deborde = railContenuW > railW + 1;
  const debordeGauche = deborde && railX > 2;
  const debordeDroite = deborde && railX < railContenuW - railW - 2;

  // Couleur de fondu : le panneau pose la teinte a 10 % PAR-DESSUS le fond de
  // page, donc sa couleur reelle est le melange des deux. Fondre vers la
  // teinte a 10 % y ajouterait une seconde couche et laisserait une bande
  // visiblement plus foncee que le fond — on verrait le rectangle au lieu de
  // voir la coupe. Calcule ici parce que la teinte change a chaque event.
  const fondPanneau = useMemo(() => melangerSurFond(C.fondApp, tint, 0.10), [tint]);

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
      {/* Header mirror Accueil, au logo pres : ici c est un retour (voir
          AppHeader). Le burger ouvre le drawer (mirror onOpenProfile). */}
      <View style={{ marginHorizontal: -20 }}>
        <AppHeader
          runnerFirstName={runnerFirstName || ''}
          selfieUri={selfieUri}
          selfieUploadState={selfieUploadState}
          onOpenProfile={onOpenProfile}
          onLogoPress={onLogoPress}
          onBack={onClose}
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
            {/* PUCES DE COURSE, rangee defilante (variante B6 des maquettes,
                user 2026-10-26). Remplace un tableau a quatre colonnes ou
                « Depart » et « Denivele » etaient reecrits a chaque ligne et
                chaque valeur tenait sur deux lignes : 60 pt par course. Ici
                56 pt, quel que soit le nombre de courses.
                Le libelle est en AVEstiana pour ne pas se confondre avec les
                puces de filtre, juste dessous, qui sont cliquables. */}
            {distances.length > 0 && (
              // Le rail deborde du padding du panneau : la puce est coupee au
              // bord du panneau et non 16 pt avant, sinon la coupe nette
              // arrive AVANT le fondu et c est elle qu on voit.
              <View style={{ position: 'relative', marginHorizontal: -16 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  onLayout={(e) => setRailW(Math.round(e.nativeEvent.layout.width))}
                  onContentSizeChange={(w) => setRailContenuW(Math.round(w))}
                  onScroll={(e) => setRailX(Math.round(e.nativeEvent.contentOffset.x))}
                  scrollEventThrottle={32}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
                >
                  {distances.map((dist, i) => {
                    const hasLabel = !!(dist && dist.label && String(dist.label).trim());
                    const km = dist && dist.km !== undefined && dist.km !== null && dist.km !== ''
                      ? `${dist.km} km` : '';
                    // Sans nom dedie, le type de l event tient lieu de nom :
                    // « Cross-country 2 km » plutot qu un « 2 km » orphelin
                    // (user 2026-10-26). Et la premiere lettre passe en
                    // majuscule quoi qu en dise la saisie de l organisateur.
                    const titre = majusculePremiere(
                      hasLabel
                        ? String(dist.label).trim()
                        : [displayEventType(event.event_type), km].filter(Boolean).join(' ')
                    );
                    const time = dist && dist.time && String(dist.time).trim() ? String(dist.time).trim() : '';
                    const elev = dist && dist.elevation && String(dist.elevation).trim() ? String(dist.elevation).trim() : '';
                    // Seconde ligne : km (si le libelle a pris la premiere),
                    // heure de depart, denivele — dans cet ordre, separes par
                    // des points medians. Les absents ne laissent pas de trou.
                    const sous = [hasLabel ? km : '', time, elev ? `${elev} mD+` : '']
                      .filter(Boolean).join('  ·  ');
                    return (
                      <View key={i} style={{
                        backgroundColor: 'rgba(255,255,255,0.75)',
                        borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
                      }}>
                        <Text style={{ fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 14, color: tint }}>
                          {titre}
                        </Text>
                        {sous ? (
                          <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 11, color: tint, opacity: 0.7, marginTop: 2 }}>
                            {sous}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </ScrollView>
                {/* FONDUS DE DEFILEMENT. Ils fondent vers le MELANGE du fond
                    de page et de la teinte a 10 %, pas vers la teinte a 10 % :
                    le panneau etant deja teinte par-dessus le fond, un
                    degrade vers cette meme teinte repeindrait une seconde
                    couche et laisserait une bande plus foncee que le fond.
                    Et ils n apparaissent que si le contenu deborde vraiment,
                    mesure au layout — pas « s il y a plus d une course » :
                    un libelle long deborde parfois seul, trois puces courtes
                    tiennent parfois a l aise. Un fondu devant du vide annonce
                    du contenu qui n existe pas. */}
                {debordeGauche ? (
                  <LinearGradient
                    colors={[fondPanneau, `${fondPanneau}DB`, `${fondPanneau}00`]}
                    locations={[0, 0.45, 1]}
                    start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                    pointerEvents="none"
                    style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 56 }}
                  />
                ) : null}
                {debordeDroite ? (
                  <LinearGradient
                    colors={[`${fondPanneau}00`, `${fondPanneau}DB`, fondPanneau]}
                    locations={[0, 0.55, 1]}
                    start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                    pointerEvents="none"
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 56 }}
                  />
                ) : null}
              </View>
            )}

            {/* LES DEUX ACTIONS (maquette user 2026-10-26). Ni pilule ni
                bouton a contour : une icone teintee, un libelle en encre,
                chaque action centree dans sa moitie, un filet vertical entre
                les deux. La couleur ne sert qu a designer l action, le texte
                reste lisible comme du texte.

                Pourquoi pas de bouton : la rangee est posee sur un panneau
                deja teinte, a 16 pt de ses coins bas en rayon 16 — un bouton
                plein y demanderait un rayon de 0 pour s emboiter, et deux
                boutons cote a cote pesaient plus lourd que les courses
                au-dessus d eux, qui sont le vrai contenu.

                Si une seule des deux existe, elle prend toute la largeur et
                le filet disparait : pas de separateur devant du vide. */}
            {(mapQuery || event.website) ? (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                marginTop: distances.length > 0 ? 14 : 0,
              }}>
                {event.website ? (
                  <TouchableOpacity
                    onPress={openWebsite}
                    activeOpacity={0.6}
                    hitSlop={{ top: 7, bottom: 7 }}
                    accessibilityRole="button"
                    accessibilityLabel="Ouvrir le site de l organisateur"
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8, paddingVertical: 10,
                    }}
                  >
                    <Icon.Site size={15} color={tint} />
                    <Text style={{ color: '#1A1426', fontSize: 13, fontFamily: 'Montserrat-Medium' }}>
                      Site organisateur
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {(mapQuery && event.website) ? (
                  // 1 pt plein et non StyleSheet.hairlineWidth : un tiers de
                  // point a 35 % d opacite ne se voyait pas, ce qui revient
                  // exactement a ne pas l avoir pose.
                  <View style={{ width: 1, height: 22, backgroundColor: `${tint}66` }} />
                ) : null}
                {mapQuery ? (
                  <TouchableOpacity
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
                      Linking.openURL(url).catch(() => {});
                    }}
                    activeOpacity={0.6}
                    hitSlop={{ top: 7, bottom: 7 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Itineraire vers ${mapQuery}`}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center',
                      justifyContent: 'center', gap: 8, paddingVertical: 10,
                    }}
                  >
                    <Icon.Itineraire size={15} color={tint} />
                    <Text style={{ color: '#1A1426', fontSize: 13, fontFamily: 'Montserrat-Medium' }}>
                      Itinéraire
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
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
