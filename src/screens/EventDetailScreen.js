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
// Premiere lettre en majuscule, le reste intact : « minimes filles » devient
// « Minimes filles » sans toucher a « 10 km Rando » ni aux sigles. La saisie
// de l organisateur n est pas normalisee, l affichage l est.
function majusculePremiere(t) {
  const v = String(t || '').trim();
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1);
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
    const nomDedie = entry && String(entry.label || '').trim();
    if (nomDedie) return raceTitle({ label: entry.label, label_only: entry.label_only, km });
    // Sans nom dedie, le type de l event tient lieu de nom (user 2026-10-26).
    // La regle valait deja pour la fiche des courses ; elle manquait ici, donc
    // les memes courses s affichaient « Cross-country 8 km » avant l event et
    // « 8 km » une fois les photos arrivees. Une seule regle pour les deux.
    return [displayEventType(event.event_type), km !== undefined && km !== null && km !== '' ? `${km} km` : '']
      .filter(Boolean).join(' ');
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
    // Le compte passe en SECONDE LIGNE et non plus colle au libelle (fusion
    // user 2026-10-26) : la rangee ne sert plus seulement a filtrer, elle
    // remplace la fiche des courses. « Toutes » en porte une aussi, sans quoi
    // elle ferait 34 pt a cote de voisines a 46.
    const nPhotos = (n) => `${n} photo${n > 1 ? 's' : ''}`;
    return [
      { key: 'all', label: 'Toutes', sous: nPhotos(photos.length) },
      ...uniqueRaces.map(r => {
        const n = photos.filter(p => photoRaceKey(p) === String(r)).length;
        return {
          key: String(r),
          label: majusculePremiere(raceTabLabel(String(r))),
          sous: nPhotos(n),
        };
      }),
    ];
  }, [photos, uniqueRaces, raceLabelById, event.distances]);

  // AVANT L EVENT : la meme rangee, en fiche. Il n y a aucune photo, donc
  // rien a filtrer, mais les courses existent deja et c est ce qu on vient
  // lire. Source : event.distances, et non les courses presentes dans les
  // photos — qui par definition n existent pas encore.
  const puceCoursesInfo = useMemo(() => {
    const evd = Array.isArray(event.distances) ? event.distances : [];
    // Le kilometrage monte dans le TITRE des que deux courses partagent un
    // libelle. Audit des galeries existantes (26/10) : les organisateurs
    // saisissent le plus souvent la categorie et non un nom — « Trail des
    // Violettes » a trois courses nommees « Trail », « Foulees de la Seine »
    // deux « Course ». Avec le kilometrage relegue en seconde ligne, les
    // titres devenaient indiscernables. Carrington, dont les quatre libelles
    // different, garde ses titres courts.
    const libelles = evd.map(d => String((d && d.label) || '').trim().toLowerCase()).filter(Boolean);
    const libelleDouble = libelles.some((l, i) => libelles.indexOf(l) !== i);
    return evd.map((d, i) => {
      const km = d && d.km !== undefined && d.km !== null && d.km !== '' ? `${d.km} km` : '';
      const hasLabel = !!(d && d.label && String(d.label).trim());
      const time = d && d.time && String(d.time).trim() ? String(d.time).trim() : '';
      // Un denivele de 0 n est pas une information : « Les Foulees Gourmandes »
      // affichait « 17:00 · 0 mD+ ». Les organisateurs laissent le champ a 0
      // quand le parcours est plat, ce qui va de soi sur une course sur route.
      const elevBrut = d && d.elevation !== undefined && d.elevation !== null ? String(d.elevation).trim() : '';
      const elev = elevBrut && Number(elevBrut) > 0 ? elevBrut : '';
      return {
        key: `info-${i}`,
        // Memes deux regles que dans le panneau qu elle remplace : majuscule
        // a la premiere lettre, et a defaut de nom dedie le type de l event
        // tient lieu de nom.
        label: majusculePremiere(
          hasLabel
            ? [String(d.label).trim(), libelleDouble ? km : ''].filter(Boolean).join(' ')
            : [displayEventType(event.event_type), km].filter(Boolean).join(' ')
        ),
        // Variante portant TOUJOURS le kilometrage, pour les rangees sans
        // seconde ligne qui ne peuvent pas le reléguer dessous.
        titreAvecKm: majusculePremiere(
          hasLabel
            ? [String(d.label).trim(), km].filter(Boolean).join(' ')
            : [displayEventType(event.event_type), km].filter(Boolean).join(' ')
        ),
        sous: [(hasLabel && !libelleDouble) ? km : '', time, elev ? `${elev} mD+` : '']
          .filter(Boolean).join('  ·  '),
      };
    });
  }, [event.distances, event.event_type]);

  // LA FICHE, une fois les photos arrivees. Trois cas et non deux : avant
  // l event la fiche annonce les horaires, apres elle dit de quelle course
  // sont les photos. Audit des galeries existantes (26/10) : quatre events
  // declarent plusieurs courses mais n ont de photos que sur une seule —
  // Vernon-Giverny 3 pour 1, Chateau Gaillard 4 pour 1, Bortis 2 pour 1,
  // Foulees Gourmandes 1 pour 1. La fiche des horaires y listait des courses
  // sans aucune photo, et des heures de depart pour une course courue il y a
  // des mois. Elle est donc construite ici sur les courses REELLEMENT en
  // photo, avec leur compte.
  const puceCoursesFicheApres = useMemo(() => {
    if (photos.length === 0) return [];
    // UNE SEULE COURSE DECLAREE. C est la condition pour attribuer toute la
    // galerie a cette course : s il y en a plusieurs, les photos sans
    // etiquette peuvent venir de n importe laquelle. Releve sur les donnees
    // reelles le 26/10 : « Trail du Chateau Gaillard » a 496 photos dont UNE
    // seule porte une course, pour quatre courses declarees — annoncer
    // « Trail 35 km, 496 photos » aurait ete faux. « Vernon-Giverny », 154
    // etiquetees sur 372 pour trois courses declarees, de meme.
    const declarees = Array.isArray(event.distances) ? event.distances.length : 0;
    if (declarees > 1) return [];
    // Le compte est celui de TOUTE la galerie, pas des photos portant la cle
    // de course. Cette fiche ne s affiche que lorsqu il y a moins de deux
    // courses a filtrer : les photos appartiennent donc toutes a celle-ci, y
    // compris celles que le photographe n a pas rattachees a une course.
    // Constate sur « Les Foulees Gourmandes » : la fiche annoncait 100 photos
    // — les seules portant la cle — pendant que la rangee des postes juste
    // dessous affichait « Tous 942 ». Deux comptes contradictoires a 40 pt
    // d ecart, dont le plus petit etait faux.
    const n = photos.length;
    const sous = `${n} photo${n > 1 ? 's' : ''}`;
    return uniqueRaces.map((r) => ({
      key: String(r),
      label: majusculePremiere(raceTabLabel(String(r))),
      sous,
    }));
  }, [photos, uniqueRaces, raceLabelById, event.distances]);

  // LES COURSES DECLAREES, sans compte. Cas d un event a plusieurs courses
  // dont les photos ne portent pas d etiquette exploitable : on ne peut rien
  // attribuer, donc on n affiche aucun chiffre. La rangee dit ce qui a eu
  // lieu, les postes filtrent ce qui est filtrable. Pas d horaire non plus :
  // la course est courue. Le kilometrage monte donc dans le titre, faute de
  // seconde ligne pour le porter.
  const puceCoursesDeclarees = useMemo(
    () => puceCoursesInfo.map(it => ({ key: it.key, label: it.titreAvecKm, sous: '' })),
    [puceCoursesInfo],
  );

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
                    {/* 11 et non 10 : plancher de lisibilite Apple. Le type
                        se reconnait plus qu il ne se lit, mais rien ne
                        justifiait de rester sous le seuil. */}
                    <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Montserrat-SemiBold' }}>
                      {displayEventType(event.event_type)}
                    </Text>
                  </View>
                </Text>
              ) : null}
            </Text>
            {(mapQuery || event.website) ? (
              <>
                <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 14, marginBottom: 12 }} />
                {/* LES DEUX ACTIONS, a la place du chevron « Infos pratiques »
                    (fusion user 2026-10-26). Le panneau qu il ouvrait n existe
                    plus : les courses sont passees dans la rangee de filtres,
                    qui les porte deja. Restent les deux sorties, et elles
                    tiennent sur la ligne qu occupait le chevron.

                    Alignees a GAUCHE comme tout le reste du hero, et non
                    centrees : les 84 pt de marge droite sont la reserve du
                    compte a rebours, et une rangee centree la mangeait — « J-16 »
                    arrivait a 4 pt du libelle (mesure en maquette).

                    « Site » et non « Site organisateur » : meme a gauche, les
                    deux libelles complets plus le filet ne laissaient pas la
                    place. Le globe porte le sens. */}
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {event.website ? (
                    <TouchableOpacity
                      onPress={openWebsite}
                      activeOpacity={0.6}
                      hitSlop={{ top: 8, bottom: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Ouvrir le site de l organisateur"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    >
                      <Icon.Site size={15} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Montserrat-Medium' }}>Site</Text>
                    </TouchableOpacity>
                  ) : null}
                  {(mapQuery && event.website) ? (
                    <View style={{ width: 1, height: 20, marginHorizontal: 22, backgroundColor: 'rgba(255,255,255,0.4)' }} />
                  ) : null}
                  {mapQuery ? (
                    <TouchableOpacity
                      onPress={() => {
                        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
                        Linking.openURL(url).catch(() => {});
                      }}
                      activeOpacity={0.6}
                      hitSlop={{ top: 8, bottom: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Itineraire vers ${mapQuery}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    >
                      <Icon.Itineraire size={15} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Montserrat-Medium' }}>Itinéraire</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            ) : null}
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


      {/* LA FICHE DES COURSES, juste sous la hero.
          Rendue ICI et non dans renderFiltres : cette derniere est l enfant
          d index 1 du ScrollView, qui vient APRES tout l en-tete — donc apres
          le message « pas encore de photos » et sa mascotte, qui vivent dans
          renderHeader. Les puces se retrouvaient en bas de page. En mode
          fiche elles appartiennent a l event, pas a la galerie ; en mode
          filtre elles appartiennent a la galerie et restent collantes.

          Condition : des que le niveau 1 filtrant ne s affichera PAS, pas
          seulement quand il n y a aucune photo. Un event a une seule course
          mais avec des photos tombait entre les deux — le mode fiche
          l excluait, et le niveau 1 n a rien a filtrer avec une seule course,
          si bien que ses horaires devenaient inatteignables alors qu ils
          vivaient avant dans le panneau depliable. Regression du commit
          precedent, signalee par Geoffrey. */}
      {(() => {
        if (erreurChargement || puceCourses.length >= 2) return null;
        // Avant l event : les horaires. Apres : la course des photos et leur
        // nombre. Jamais les horaires d une course deja courue.
        // Trois sources, pas deux. Avant l event : les horaires. Apres, si
        // l event ne declare qu une course : cette course et le compte de
        // toute la galerie. Apres, si plusieurs courses sont declarees mais
        // que les photos ne permettent pas de filtrer : les courses, sans
        // aucun chiffre — on ne sait pas laquelle a quoi.
        const fiche = photos.length === 0
          ? puceCoursesInfo
          : (puceCoursesFicheApres.length > 0 ? puceCoursesFicheApres : puceCoursesDeclarees);
        if (fiche.length === 0) return null;
        // Le compte tombe si la rangee des postes affiche deja le total.
        // « Les Foulees Gourmandes » montrait « Course 13 km / 942 photos »
        // et, 40 pt dessous, « Tous 942 » : le meme nombre deux fois. La
        // fiche n apporte alors que le nom de la course, et une seule ligne
        // suffit a le dire.
        //
        // Calcule ICI et non dans le memo : pucePostes est declare apres
        // puceCoursesFicheApres, et le lire la-haut serait exactement la
        // faute du fondPanneau de ce matin — un identifiant lu avant son
        // initialisation, sans erreur a l execution.
        const totalDejaAffiche = pucePostes.length > 1;
        const items = totalDejaAffiche ? fiche.map(it => ({ ...it, sous: '' })) : fiche;
        // Pas de marge propre : FiltresGalerie pose deja 8 de padding haut.
        // Les 10 d avant s y ajoutaient, soit 18 entre la hero et la premiere
        // puce — trop loin pour un bloc qui prolonge la hero.
        return (
          <View style={{ marginHorizontal: -20 }}>
            <FiltresGalerie courses={items} inerte />
          </View>
        );
      })()}

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
    // Pas de photos : la rangee passe en fiche des courses, inerte. C est le
    // seul etat ou elle a un sens sans filtrer, et c est aussi le moment ou
    // l on vient chercher les horaires. En cas d erreur de chargement on ne
    // montre rien : on ne sait pas s il y a des photos.
    // Sans photo il n y a rien a filtrer : la fiche des courses est rendue
    // plus haut, dans l en-tete, pour qu elle suive la hero.
    if (erreurChargement || photos.length === 0) return <View />;
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
