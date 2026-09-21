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
  View, Text, TouchableOpacity, Image, Animated, Alert, Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { Paths, File } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { Icon } from '../components/Icon';
import { SelfieBlock } from '../components/SelfieBlock';
import { ConsentRenewBanner } from '../components/ConsentRenewBanner';
import { VerifyEmailBanner } from '../components/VerifyEmailBanner';
import { PhotoGrid } from '../components/PhotoGrid';
import { EtatVideWill } from '../components/EtatVideWill';
import { SpinningLoader, RefreshableScrollView } from '../components/loaders';
import { C, TYPE_COLORS, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { extractBurstTs, extractIdx, detectPhotoExtension } from '../utils/photo';
import { graverMention } from '../services/graverMention';
import { formatDateLong } from '../utils/format';
import { API_URL } from '../constants/api';
import { selfieDotColor } from '../utils/styleHelpers';
import { Haptics } from '../services/haptics';

// Audit coureur 3 -- delai maximal sur le parcours coureur. Aucun appel ne
// pouvait echouer autrement qu en restant suspendu : sur un reseau qui
// accepte la connexion sans jamais repondre (hotspot de salle, 3G de fin de
// course), l ecran tournait indefiniment.
const DELAI_MAX_MS = 15000;
// Audit coureur 3 -- fraicheur : la route des events connus renvoie desormais
// TOUS les events publics actifs, et on lancait un /personal-gallery PAR
// event, en parallele, a chaque montage. Chacun declenche un scan R2 cote
// serveur. On ne relance donc plus tout si les donnees datent de moins de
// deux minutes ; le tirer-pour-rafraichir force, lui, toujours.
const FRAICHEUR_MS = 120000;

export function PhotosScreen({ events = [], runnerFirstName = '', onOpenSelfie, selfieUri, onDeleteSelfie, onOpenProfile, follows, onFindEvent, runnerApiFetch, runnerUserId, onOpenPhoto, photoFavoritesSet, onTogglePhotoFavorite, onRefreshFavorites, selfieSkipped = false, isActive = true, selfieUploadState = 'idle', onRetryUpload, headerH = 0, onNonVuesChange, refreshSignal = 0 }) {
  const scrollRef = useRef(null);
  const [showBackTop, setShowBackTop] = useState(false);
  const backTopOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(backTopOpacity, {
      toValue: showBackTop ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [showBackTop, backTopOpacity]);
  const chargerPlusRef = useRef(null);
  const onScrollWatch = useCallback((e) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    setShowBackTop(contentOffset.y > 400);
    const reste = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (reste < 900) chargerPlusRef.current?.();
  }, []);
  const photosCacheKey = runnerUserId ? `@will_photos_cache_${runnerUserId}` : '@will_photos_cache';
  const knownEventsCacheKey = runnerUserId ? `@will_known_events_${runnerUserId}` : null;
  const [knownEvents, setKnownEvents] = useState([]);
  const eventsToQuery = useMemo(() => {
    const set = new Set();
    for (const c of follows) set.add(c);
    for (const c of knownEvents) set.add(c);
    return [...set];
  }, [follows, knownEvents]);
  // Audit coureur 3 -- refreshAll dependait du TABLEAU : une nouvelle
  // identite a chaque rendu de follows/knownEvents relancait un appel de
  // galerie par event. Il depend maintenant de la cle textuelle, et lit la
  // liste par reference.
  const eventsKey = eventsToQuery.join(',');
  const eventsToQueryRef = useRef(eventsToQuery);
  eventsToQueryRef.current = eventsToQuery;
  const hasFollows = eventsToQuery.length > 0;
  const [photos, setPhotos] = useState([]);
  const [anySearching, setAnySearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);

  // Audit coureur 3 -- un echec de chargement etait avale en liste vide.
  // 'timeout' = le serveur n a pas repondu dans les 15 s ; 'reseau' = aucune
  // des requetes n est partie.
  const [erreurChargement, setErreurChargement] = useState(null);
  const derniereMajRef = useRef(0);
  const photosRef = useRef([]);
  const controleurRef = useRef(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [downloading, setDownloading] = useState(false);
  // Audit coureur 15 -- progression / annulation / reprise des echecs.
  const [dlAvancement, setDlAvancement] = useState(null); // { fait, total }
  const [dlEchecs, setDlEchecs] = useState([]);
  const dlAnnuleRef = useRef(false);
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
  const vignettes = useMemo(
    () => visiblePhotos.slice(0, visibleCount).map(p => (
      p.thumbUri && p.thumbUri !== p.uri ? { ...p, uri: p.thumbUri } : p
    )),
    [visiblePhotos, visibleCount],
  );
  // Regroupement par course (2026-08-31) : la grille unique melangeait les
  // events. Sections dans l ordre d apparition — les photos sont deja triees
  // du plus recent au plus ancien, la course la plus recente vient donc en
  // tete. Compteur calcule sur TOUTES les photos visibles du filtre (pas la
  // tranche paginee) ; badge "nouvelles" = photos de moi posterieures au
  // seuil fige au chargement.
  // Seuil des badges "nouvelles" par course : fige a chaque refreshAll AVANT
  // que l affichage de l onglet ne fasse avancer lastSeenRef — sinon le
  // badge disparaitrait a l instant meme ou il devient visible. Infinity au
  // depart : pas de badge sur le cache local avant le premier vrai fetch.
  // DECLARE AVANT le useMemo qui la lit : declaree apres, la constante
  // n existait pas encore quand le memo s executait au rendu -> crash au
  // demarrage des qu il y avait des photos (2026-08-31).
  const seuilNouvellesRef = useRef(Infinity);

  const sections = useMemo(() => {
    const parCode = new Map();
    for (const p of vignettes) {
      const c = p.eventCode || '?';
      let sct = parCode.get(c);
      if (!sct) { sct = { code: c, tint: p.tint || null, photos: [] }; parCode.set(c, sct); }
      if (!sct.tint && p.tint) sct.tint = p.tint;
      sct.photos.push(p);
    }
    const totaux = new Map();
    const nouvelles = new Map();
    for (const p of visiblePhotos) {
      const c = p.eventCode || '?';
      totaux.set(c, (totaux.get(c) || 0) + 1);
      if (p._isPersonalMatch && extractBurstTs(p.id) > seuilNouvellesRef.current) {
        nouvelles.set(c, (nouvelles.get(c) || 0) + 1);
      }
    }
    return [...parCode.values()].map((sct) => ({
      ...sct,
      total: totaux.get(sct.code) || sct.photos.length,
      nouvelles: nouvelles.get(sct.code) || 0,
    }));
  }, [vignettes, visiblePhotos]);

  useEffect(() => { photosRef.current = photos; }, [photos]);

  const meCount = useMemo(() => photos.filter(p => p._isPersonalMatch).length, [photos]);
  const favCount = useMemo(() => (
    photoFavoritesSet ? photos.filter(p => photoFavoritesSet.has(p.id)).length : 0
  ), [photos, photoFavoritesSet]);

  // Audit coureur 3 -- un signal d abandon arme a 15 s. Chaque appel du
  // parcours coureur en recoit un : sans lui, un serveur qui accepte la
  // connexion sans repondre laissait l ecran tourner sans fin.
  const signalAvecDelai = useCallback(() => {
    try {
      const ctrl = new AbortController();
      setTimeout(() => { try { ctrl.abort(); } catch {} }, DELAI_MAX_MS);
      return ctrl.signal;
    } catch { return undefined; }
  }, []);

  const togglePhotoSelect = useCallback((id) => {
    setDlEchecs([]);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setDlEchecs([]);
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

  // Events dont l app ne connait ni le nom ni le type : "Mes photos" agrege
  // des courses qui ne sont pas dans la liste publique en memoire (passees,
  // non listees, accessibles par code). Sans ca, la visionneuse s ouvrait
  // sans titre. Resolus une fois chacun, gardes en memoire.
  const [evResolus, setEvResolus] = useState({});
  const evDemandesRef = useRef(new Set());
  const resoudreEvent = useCallback(async (code) => {
    if (!code || evDemandesRef.current.has(code)) return;
    evDemandesRef.current.add(code);
    try {
      const r = await fetch(`${API_URL}/public-events/${encodeURIComponent(code)}`);
      if (!r.ok) return;
      const d = await r.json();
      setEvResolus((prev) => ({ ...prev, [code]: d }));
    } catch {}
  }, []);

  const refreshKnownEvents = useCallback(async () => {
    if (!runnerApiFetch) return [];
    try {
      const r = await runnerApiFetch(`/runner/known-events`, { signal: signalAvecDelai() });
      if (!r.ok) return [];
      const data = await r.json();
      const list = Array.isArray(data?.events) ? data.events : [];
      // Identite conservee si la liste n a pas bouge : sinon eventsToQuery
      // changeait a chaque tirer-pour-rafraichir et declenchait un SECOND
      // tour complet d appels de galerie, tous les events compris.
      setKnownEvents((prev) => (
        prev.length === list.length && prev.every((c, i) => c === list[i]) ? prev : list
      ));
      if (knownEventsCacheKey) {
        AsyncStorage.setItem(knownEventsCacheKey, JSON.stringify(list)).catch(() => {});
      }
      return list;
    } catch { return []; }
  }, [runnerApiFetch, knownEventsCacheKey]);

  useEffect(() => { refreshKnownEvents(); }, [refreshKnownEvents]);

  // photoFavoritesSet et eventTintMap changent d identite a chaque
  // rafraichissement des favoris ou des events. En dependance de refreshAll,
  // ils relancaient TOUTES les requetes de galerie a chaque fois. On les lit
  // par reference : la valeur reste a jour, l identite de refreshAll non.
  const favorisRef = useRef(photoFavoritesSet);
  useEffect(() => { favorisRef.current = photoFavoritesSet; }, [photoFavoritesSet]);
  const tintRef = useRef(eventTintMap);
  useEffect(() => { tintRef.current = eventTintMap; }, [eventTintMap]);

  const refreshAll = useCallback(async (options = {}) => {
    const force = options.force === true;
    const queryList = eventsToQueryRef.current;
    // Audit coureur 3 -- garde de fraicheur : un remontage (retour de
    // l onglet, arrivee des events connus, changement de favoris) relancait
    // un /personal-gallery par event, donc autant de scans R2. Si on a deja
    // des photos de moins de deux minutes, on ne redemande rien.
    if (!force && photosRef.current.length > 0
        && Date.now() - derniereMajRef.current < FRAICHEUR_MS) {
      setLoading(false);
      return photosRef.current;
    }
    if (queryList.length === 0 || !runnerApiFetch) {
      // Si pas d events suivis mais des favs : aller chercher les events
      // depuis les favs pour ne pas afficher empty alors qu il y a des favs.
      const favEventCodes = new Set();
      const favoris = favorisRef.current;
      if (favoris && favoris.size > 0) {
        favoris.forEach((key) => {
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
    // Une seule lecture pour tous les events : la boucle await faisait un
    // aller-retour AsyncStorage par event suivi, en serie, avant meme la
    // premiere requete reseau.
    const started = {};
    if (queryList.length > 0) {
      const paires = await AsyncStorage.multiGet(
        queryList.map((code) => `@will_follow_started_${code}`),
      ).catch(() => []);
      for (const [cle, valeur] of paires || []) {
        const code = String(cle).replace('@will_follow_started_', '');
        started[code] = valeur ? parseInt(valeur, 10) : 0;
      }
    }
    // Fetch en parallele :
    //  - /personal-gallery/{code} pour tous les events suivis (photos
    //    identifiees au selfie)
    //  - /runner/photo-favorites-full (UN SEUL appel) : tous les favs avec
    //    leurs URLs, meme si masques par face-gate/time-gate dans list-public.
    //    Indispensable pour afficher les favs qui pointent vers des photos
    //    non-visibles publiquement (l user les a fav, il y a droit).
    // Un seul controleur pour toute la passe : le delai maximal vaut pour
    // l ensemble, pas pour chaque requete prise isolement.
    let controleur = null;
    let minuteur = null;
    try {
      controleur = new AbortController();
      minuteur = setTimeout(() => { try { controleur.abort(); } catch {} }, DELAI_MAX_MS);
    } catch {}
    controleurRef.current = controleur;
    const signal = controleur ? controleur.signal : undefined;
    let echecs = 0;
    const [results, favFullResp] = await Promise.all([
      Promise.all(queryList.map(async (code) => {
        try {
          const r = await runnerApiFetch(`/personal-gallery/${encodeURIComponent(code)}`, { signal });
          if (!r.ok) return { code, photos: [], paid: false, echec: true };
          const data = await r.json();
          return {
            code,
            photos: Array.isArray(data.photos) ? data.photos : [],
            paid: !!data.photos_for_sale,
            // Titre / date / type renvoyes par le worker : "Mes photos"
            // agrege des events qui ne sont pas forcement dans la liste
            // publique chargee par l app.
            ev: {
              name: data.event_name || null,
              date: data.event_date || null,
              dateEnd: data.event_date_end || null,
              type: data.event_type || null,
            },
          };
        } catch (e) { echecs += 1; return { code, photos: [], paid: false, ev: null, echec: true }; }
      })),
      (async () => {
        try {
          const r = await runnerApiFetch('/runner/photo-favorites-full', { signal });
          if (!r.ok) return [];
          const d = await r.json();
          return Array.isArray(d?.photos) ? d.photos : [];
        } catch { return []; }
      })(),
    ]);
    if (minuteur) clearTimeout(minuteur);
    // Delai depasse, ou aucune requete n a abouti : on NE remplace PAS les
    // photos deja affichees par une liste vide (c est ce qui produisait le
    // faux « pas encore de photos »). On affiche un bandeau reessayable.
    if (controleur && controleur.signal.aborted) {
      setLoading(false);
      setErreurChargement('timeout');
      return photosRef.current;
    }
    if (queryList.length > 0 && echecs >= queryList.length) {
      setLoading(false);
      setErreurChargement('reseau');
      return photosRef.current;
    }
    setErreurChargement(null);
    const now = Date.now();
    const merged = [];
    const seenIds = new Set();
    let searching = false;
    for (const { code, photos: list, paid, ev } of results) {
      const tint = ev?.type ? colorForType(ev.type) : (tintRef.current[code] || TYPE_COLORS.autre);
      if (list.length === 0) {
        const startedTs = started[code];
        const elapsed = startedTs ? (now - startedTs) : Infinity;
        if (elapsed < 90000) searching = true;
        continue;
      }
      for (const p of list) {
        seenIds.add(p.key);
        merged.push({
          uri: p.url || '',
          thumbUri: p.thumb_url || p.url || '',
          thumbMdUri: p.thumb_md_url || p.thumb_url || p.url || '',
          photographer: p.photographer || null,
          takenAt: p.taken_at || p.uploaded || null,
          id: p.key,
          tint,
          paid,
          eventCode: code,
          eventName: ev?.name || null,
          eventDate: ev?.date || null,
          eventDateEnd: ev?.dateEnd || null,
          eventType: ev?.type || null,
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
      const tint = tintRef.current[eventCode] || TYPE_COLORS.autre;
      merged.push({
        uri: p.url || '',
        thumbUri: p.thumb_url || p.url || '',
        thumbMdUri: p.thumb_md_url || p.thumb_url || p.url || '',
        photographer: p.photographer || null,
        takenAt: p.taken_at || p.uploaded || null,
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
    seuilNouvellesRef.current = lastSeenRef.current;
    derniereMajRef.current = Date.now();
    photosRef.current = merged;
    setPhotos(merged);
    setAnySearching(searching);
    setLoading(false);
    setVisibleCount(30);
    AsyncStorage.setItem(photosCacheKey, JSON.stringify(merged)).catch(() => {});
    // Prefetch tous les thumbnails (cap 250) pour garantir que le 3 onglets
    // (Moi / Favoris / Tous) sont 100% cached avant le 1er scroll. Memory-disk
    // policy : si la photo est deja cached, c est instant. Sinon download en
    // arriere-plan, non bloquant.
    // Prechauffage limite au premier ecran : lancer 250 telechargements d un
    // coup saturait le reseau au moment precis ou l utilisateur attend ses
    // premieres vignettes. Le reste se charge naturellement au defilement,
    // avec le cache disque d ExpoImage.
    if (typeof ExpoImage?.prefetch === 'function') {
      const aPrechauffer = merged.slice(0, 36).map(p => p?.thumbUri).filter(Boolean);
      ExpoImage.prefetch(aPrechauffer, 'memory-disk').catch(() => {});
    }
    return merged;
  }, [eventsKey, runnerApiFetch, photosCacheKey]);

  // Libere le controleur en cours si l ecran disparait.
  useEffect(() => () => { try { controleurRef.current?.abort(); } catch {} }, []);

  // Supprime : on telechargeait la galerie publique COMPLETE de chaque event
  // ayant au moins un favori, pour n en garder que les quelques photos
  // favorites. /runner/photo-favorites-full les renvoie deja toutes, avec
  // leurs URLs, sans filtre de visibilite — c est exactement ce qu il
  // fallait, et c est un seul appel pour tous les events.

  // Photos de moi arrivees depuis la derniere visite de cet onglet. C est
  // cette valeur qui alimente la pastille de l onglet et celle de l icone
  // de l app.
  //
  // Avant, un effet remontait "derniere photo vue" au maximum des le
  // chargement : tout etait donc marque comme vu avant meme que l ecran
  // soit regarde, et le compteur valait toujours zero. On ne marque plus
  // comme vu qu au moment ou l onglet est REELLEMENT affiche.
  const [nonVues, setNonVues] = useState(0);
  useEffect(() => {
    if (!lastSeenLoadedRef.current || loading) return;
    if (isActive) {
      let maxTs = 0;
      for (const p of photos) {
        const ts = extractBurstTs(p.id);
        if (ts > maxTs) maxTs = ts;
      }
      if (maxTs > lastSeenRef.current) {
        lastSeenRef.current = maxTs;
        AsyncStorage.setItem('@will_last_seen_burst_ts', String(maxTs)).catch(() => {});
      }
      setNonVues(0);
      return;
    }
    let n = 0;
    for (const p of photos) {
      if (!p._isPersonalMatch) continue;
      if (extractBurstTs(p.id) > lastSeenRef.current) n++;
    }
    setNonVues(n);
  }, [loading, photos, isActive]);

  useEffect(() => { onNonVuesChange?.(nonVues); }, [nonVues, onNonVuesChange]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Une notification « nouvelles photos » passe outre la garde de fraicheur :
  // c est le serveur qui vient de dire qu il y a du neuf.
  const premierSignalRef = useRef(true);
  useEffect(() => {
    if (premierSignalRef.current) { premierSignalRef.current = false; return; }
    refreshAll({ force: true });
  }, [refreshSignal]);

  // Resolution anticipee : au chargement des photos, on va chercher les
  // events dont on n a ni le nom (worker ancien) ni la fiche publique, pour
  // que l entete soit deja prete a la premiere ouverture.
  useEffect(() => {
    if (photos.length === 0) return;
    const manquants = new Set();
    for (const p of photos) {
      if (!p.eventCode || p.eventName) continue;
      if (events.some((e) => e.code === p.eventCode)) continue;
      manquants.add(p.eventCode);
    }
    manquants.forEach((code) => resoudreEvent(code));
  }, [photos, events, resoudreEvent]);

  // Indexation en cours : on reinterroge, mais de moins en moins souvent
  // (12 s, 18 s, 24 s...) et pas au-dela de ~3 minutes. Toutes les 7 s sans
  // fin, c etait un refetch complet de tous les events suivis.
  useEffect(() => {
    if (!isActive || !anySearching) return;
    let annule = false;
    let essais = 0;
    let minuteur;
    const planifier = () => {
      if (annule || essais >= 12) return;
      const delai = Math.min(12000 + essais * 6000, 40000);
      minuteur = setTimeout(async () => {
        essais += 1;
        await refreshAll({ force: true });
        planifier();
      }, delai);
    };
    planifier();
    return () => { annule = true; clearTimeout(minuteur); };
  }, [isActive, anySearching, refreshAll]);

  // Avant : +30 cases toutes les 250 ms jusqu a la derniere photo, que
  // l utilisateur descende ou non — 400 photos = 400 images montees en tache
  // de fond des l ouverture de l onglet. Desormais on n ajoute que lorsqu il
  // approche du bas.
  const chargerPlus = useCallback(() => {
    setVisibleCount((v) => (v >= visiblePhotos.length ? v : Math.min(v + 30, visiblePhotos.length)));
  }, [visiblePhotos.length]);

  // Retour a 30 cases quand on change d onglet : sinon on repart avec le
  // compteur du filtre precedent.
  useEffect(() => { setVisibleCount(30); }, [viewFilter]);
  useEffect(() => { chargerPlusRef.current = chargerPlus; }, [chargerPlus]);

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
    const merged = await refreshAll({ force: true });
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

  // Audit coureur 15 -- la boucle etait serie, muette et sans sortie : 40
  // photos, aucun compteur, aucun moyen d arreter, et un « 12 echecs » final
  // qui obligeait a tout reselectionner. `idsVoulus` permet la reprise des
  // seuls echecs.
  const downloadSelected = useCallback(async (idsVoulus) => {
    const liste = Array.isArray(idsVoulus) ? idsVoulus : [...selectedIds];
    if (liste.length === 0 || downloading) return;
    dlAnnuleRef.current = false;
    setDlEchecs([]);
    setDlAvancement({ fait: 0, total: liste.length });
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
      const echecs = [];
      let annule = false;
      for (const id of liste) {
        if (dlAnnuleRef.current) { annule = true; break; }
        setDlAvancement({ fait: i, total: liste.length });
        const photo = photos.find(p => p.id === id);
        if (!photo?.uri) { failed++; echecs.push(id); i++; continue; }
        let staged = null;
        try {
          const ext = await detectPhotoExtension(photo.uri);
          const filename = `will_${Date.now()}_${i}.${ext}`;
          staged = new File(Paths.cache, filename);
          const downloaded = await File.downloadFileAsync(photo.uri, staged, { idempotent: true });
          let localUri = downloaded?.uri || staged.uri;
          // Mention gravee dans le fichier, comme dans la visionneuse.
          const grave = ext === 'dng' ? null : await graverMention(localUri);
          if (grave) localUri = grave;
          await MediaLibrary.saveToLibraryAsync(localUri);
          if (grave) { try { const f = new File(grave); if (f.exists) f.delete(); } catch {} }
          saved++;
        } catch (e) {
          failed++;
          echecs.push(id);
          console.warn('[multi-download]', id, e?.message || e);
        } finally {
          try { if (staged?.exists) staged.delete(); } catch {}
          i++;
          setDlAvancement({ fait: i, total: liste.length });
        }
      }
      setDlEchecs(echecs);
      const savedMsg = saved === 1 ? '1 photo' : `${saved} photos`;
      const failedSuffix = failed > 0 ? ` (${failed} échec${failed > 1 ? 's' : ''})` : '';
      if (annule) {
        Alert.alert(
          'Téléchargement arrêté',
          saved > 0
            ? `${savedMsg} déjà enregistrée${saved > 1 ? 's' : ''} dans ta pellicule. Les autres n'ont pas été téléchargées.`
            : "Aucune photo n'a été enregistrée.",
        );
        return;
      }
      Alert.alert(
        saved > 0 ? 'Enregistré' : 'Erreur',
        saved > 0
          ? `${savedMsg} dans ta pellicule${failedSuffix}.`
          : "Aucune photo n'a pu être enregistrée. Vérifie ta connexion et réessaie.",
      );
      // On ne sort du mode selection que si TOUT est passe : sinon le bouton
      // « Reessayer les N echecs » n aurait plus rien sur quoi s appuyer.
      if (saved > 0 && echecs.length === 0) exitSelection();
    } catch (e) {
      Alert.alert('Erreur', e?.message || 'Impossible de télécharger les photos.');
    } finally {
      dlAnnuleRef.current = false;
      setDlAvancement(null);
      setDownloading(false);
    }
  }, [selectedIds, photos, downloading, exitSelection]);

  // Barre de filtres Moi / Mes favoris / Tous. Extraite du bloc « il y a
  // des photos » : elle doit rester visible quand un filtre — ou l onglet
  // entier — ne renvoie rien, sinon on ne peut plus en sortir.
  // Etat vide de l onglet, decline selon le filtre actif. Un seul endroit :
  // le cas « aucune photo du tout » et le cas « ce filtre ne renvoie rien »
  // doivent montrer la meme chose quand on est sur le meme onglet.
  // Audit coureur 12 -- l etat vide ne proposait rien a faire et ne disait
  // pas quand les photos arrivent. La prop onFindEvent existait depuis le
  // debut sans jamais etre utilisee ; elle sert enfin de sortie.
  const etatVide = (
    <EtatVideWill
      variante={viewFilter === 'favs' ? 'favoris' : 'photos'}
      titre={viewFilter === 'favs'
        ? 'Pas encore\nde favoris'
        : viewFilter === 'me'
          ? 'Pas encore\nde photos de toi'
          : 'Pas encore\nde photos'}
      sousTexte={viewFilter === 'favs'
        ? 'Ajoute tes photos favorites,\nde toi ou de tes amis'
        : "Les photos arrivent quand les photographes les envoient :\nsouvent dans les heures qui suivent la course,\nparfois le lendemain."}
      actionLabel={viewFilter === 'favs' ? null : 'Trouver un event'}
      onAction={viewFilter === 'favs' ? null : onFindEvent}
    />
  );

  const barreFiltres = selectionMode ? null : (
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
          <Text style={[s.pillText, viewFilter === 'favs' && s.pillTextActive]} numberOfLines={1}>Favoris ({favCount})</Text>
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
  );

  return (
    <View style={{ flex: 1 }}>
    <RefreshableScrollView
      ref={scrollRef}
      hideTopRefresh
      onRefresh={onPullRefresh}
      onScroll={onScrollWatch}
      refreshing={refreshing}
      style={s.scroll}
      contentContainerStyle={{ paddingTop: headerH, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header retire : rendu une seule fois dans App.js (AppHeader.js)
          au-dessus du tab container -> persistant au switch de tab. */}

      {/* Toast pull-to-refresh : ligne dediee sous le header. */}
      {toastPhase !== 'idle' && (
        <Animated.View style={{
          opacity: toastOpacity,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 20,
          marginTop: 4,
        }}>
          {toastPhase === 'searching' && <SpinningLoader size={14} color="#c9beed" />}
          <Text style={{ color: '#c9beed', fontSize: 14, fontFamily: 'Montserrat-Medium' }}>
            {toastPhase === 'searching' ? 'Recherche…' : (refreshToast || '')}
          </Text>
        </Animated.View>
      )}

      <View style={{ height: 14 }} />
      <ConsentRenewBanner runnerApiFetch={runnerApiFetch} isAuthed={!!runnerUserId} />
      <VerifyEmailBanner runnerApiFetch={runnerApiFetch} isAuthed={!!runnerUserId} />

      {/* Audit coureur 1 -- selfieUri etait code en dur a null : la variante
          « Envoi du selfie echoue » du composant, avec son bouton
          « Reessayer l envoi », n avait aucun moyen de s afficher. On monte
          desormais le bloc aussi quand l envoi a echoue, avec le vrai
          selfie : l echec est visible en tete de l onglet ou le coureur
          attend ses photos, et il y reste tant que l envoi n a pas abouti. */}
      {(!selfieUri || selfieUploadState === 'failed') && (
        <SelfieBlock
          selfieUri={selfieUploadState === 'failed' ? selfieUri : null}
          onPress={onOpenSelfie}
          onDelete={onDeleteSelfie}
          missing={selfieSkipped}
          uploadState={selfieUploadState}
          onRetryUpload={onRetryUpload}
        />
      )}

      {/* Audit coureur 3 -- delai depasse ou reseau absent : on le dit, et on
          garde les photos deja affichees plutot que de les remplacer par un
          etat vide mensonger. */}
      {erreurChargement ? (
        <View style={{
          marginHorizontal: 14, marginBottom: 10, borderRadius: 12, padding: 14,
          backgroundColor: '#FEE4E2', borderWidth: 1, borderColor: '#FDA29B',
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'Montserrat-Bold', color: '#7A1F1F', fontSize: 13 }}>
              {erreurChargement === 'timeout' ? 'Chargement trop long' : 'Impossible de charger tes photos'}
            </Text>
            <Text style={{ fontFamily: 'Montserrat', color: '#7A1F1F', fontSize: 12, marginTop: 2, lineHeight: 16 }}>
              {erreurChargement === 'timeout'
                ? "Le serveur n'a pas répondu en 15 secondes."
                : 'Vérifie ta connexion.'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => { setErreurChargement(null); setLoading(photos.length === 0); refreshAll({ force: true }); }}
            style={{ backgroundColor: '#C82424', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 }}
            activeOpacity={0.85}
          >
            <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 13 }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Plus de page « Suis un event pour recevoir tes photos » : Will
          reconnait le visage sur TOUS les events, suivre un event ne
          conditionne que la notification. Un compte sans event connu tombe
          donc sur le meme etat vide sobre que les autres.
          Audit coureur 4 -- « aucun suivi » etait teste AVANT « en cours de
          chargement », alors que follows et knownEvents sont hydrates de
          facon asynchrone : au demarrage, un coureur avec 200 photos lisait
          « Pas encore de photos ». Les deux branches sont inversees. */}
      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <SpinningLoader size={26} color="#c9beed" />
          <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 12, marginTop: 10 }}>Chargement…</Text>
        </View>
      ) : (!hasFollows && photos.length === 0) ? (
        // Et pas seulement « aucun suivi » : le cache local peut deja porter
        // des photos alors que la liste des events connus n est pas encore
        // revenue. Sans ce garde-fou, l inversion des branches deplacait
        // simplement le faux etat vide d un cas a l autre.
        <EtatVideWill
          variante="photos"
          titre={'Pas encore\nde photos'}
          sousTexte={"Les photos arrivent quand les photographes les envoient :\nsouvent dans les heures qui suivent la course,\nparfois le lendemain."}
          actionLabel="Trouver un event"
          onAction={onFindEvent}
        />
      ) : photos.length === 0 && anySearching ? (
        <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 24 }}>
          <SpinningLoader size={26} color="#7B2FFF" />
          <Text style={{ color: '#5E1AD6', fontSize: 13, marginTop: 12, textAlign: 'center', fontFamily: 'Montserrat-SemiBold' }}>
            Will recherche tes photos…
          </Text>
          <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 12, marginTop: 4, textAlign: 'center', lineHeight: 17 }}>
            Cela peut prendre quelques secondes après l'upload du photographe.
          </Text>
        </View>
      ) : photos.length === 0 ? (
        <>
          {barreFiltres}
          {etatVide}
        </>
      ) : (
        <>
          {barreFiltres}
          {photos.length > 1 && (
            <View style={{
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              paddingHorizontal: 2, paddingTop: 4, marginBottom: 8,
            }}>
              {selectionMode ? (
                <>
                  {/* Pendant le telechargement, « Annuler » arrete la boucle
                      au lieu d etre grise : c est la seule sortie quand on a
                      selectionne 40 photos par erreur. */}
                  <TouchableOpacity
                    onPress={() => { if (downloading) { dlAnnuleRef.current = true; } else { exitSelection(); } }}
                    hitSlop={10}
                  >
                    <Text style={{ color: downloading ? '#C82424' : C.textSoft, fontSize: 13, fontFamily: downloading ? 'Montserrat-SemiBold' : 'Montserrat-Medium' }}>
                      {downloading ? 'Arrêter' : 'Annuler'}
                    </Text>
                  </TouchableOpacity>
                  {downloading ? (
                    <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>
                      {`${dlAvancement?.fait ?? 0} / ${dlAvancement?.total ?? selectedIds.size}`}
                    </Text>
                  ) : dlEchecs.length > 0 ? (
                    <TouchableOpacity onPress={() => downloadSelected(dlEchecs)} hitSlop={10}>
                      <Text style={{ color: '#C82424', fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>
                        {`Réessayer ${dlEchecs.length} échec${dlEchecs.length > 1 ? 's' : ''}`}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={() => downloadSelected()}
                      hitSlop={10}
                      disabled={selectedIds.size === 0}
                      style={{ opacity: selectedIds.size === 0 ? 0.35 : 1 }}
                    >
                      <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>
                        {`Télécharger${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
                  <Text style={{ color: '#c9beed', fontSize: 13, fontFamily: 'Montserrat-Medium' }}>Sélectionner</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {visiblePhotos.length === 0 ? (
            /* Meme habillage que les autres etats vides de l onglet : un
               filtre sans resultat n est pas un cas a part. `reserve` tient
               compte de la barre de filtres au-dessus. */
            etatVide
          ) : (
            /* Une section par course : en-tete aux couleurs du type
               (filet, nom, date, compteur, badge nouvelles) puis la grille
               de la course. vignettes : la grille affiche p.uri, donc on
               lui passe la miniature et non l originale. */
            sections.map((sct) => {
              const p0 = sct.photos[0];
              const evSct = events.find((e) => e.code === sct.code) || evResolus[sct.code] || null;
              const nomSct = p0?.eventName || evSct?.name || sct.code;
              const dateSct = p0?.eventDate || evSct?.event_date || null;
              const dateFinSct = p0?.eventDateEnd || evSct?.event_date_end || null;
              const teinte = sct.tint || C.primary;
              return (
                <View key={sct.code} style={{ marginBottom: 16 }}>
                  {/* En-tete minimal : le nom de la course, AVEstiana, a la
                      couleur du type. Trait retire (decision user 2026-08-31). */}
                  <View style={{ marginBottom: 8, marginTop: 2, paddingHorizontal: 2 }}>
                    <Text style={{ fontSize: 19, fontFamily: 'AVEstiana', fontStyle: 'normal', color: teinte }} numberOfLines={1}>{nomSct}</Text>
                  </View>
                  <PhotoGrid
                    photos={sct.photos}
                    numColumns={Math.max(1, Math.min(sct.photos.length, 4))}
                    onPress={(pv, _i, _photos, origin) => {
                      // pv porte l URL de la vignette : on rouvre la
                      // visionneuse sur la photo d origine, pleine
                      // resolution — et sur la liste COMPLETE du filtre,
                      // pour que le balayage traverse les courses.
                      const p = visiblePhotos.find((x) => x.id === pv?.id) || pv;
                      const ev = events.find((e) => e.code === p?.eventCode)
                        || evResolus[p?.eventCode]
                        || null;
                      const nom = p?.eventName || ev?.name || null;
                      const dateBrute = p?.eventDate || ev?.event_date || null;
                      const dateFin = p?.eventDateEnd || ev?.event_date_end || null;
                      const type = p?.eventType || ev?.event_type || null;
                      if (!nom && p?.eventCode) resoudreEvent(p.eventCode);
                      onOpenPhoto?.(p, visiblePhotos, {
                        origin,
                        photosForSale: !!p?.paid,
                        eventCode: p?.eventCode || null,
                        eventTitle: nom,
                        eventDate: dateBrute ? formatDateLong(dateBrute, dateFin) : null,
                        eventType: type,
                      });
                    }}
                    photoFavoritesSet={photoFavoritesSet}
                    onToggleFavorite={onTogglePhotoFavorite}
                    selectionMode={selectionMode}
                    selectedIds={selectedIds}
                    onTogglePhotoSelect={togglePhotoSelect}
                  />
                </View>
              );
            })
          )}
        </>
      )}
    </RefreshableScrollView>
    {/* Bouton "Remonter en haut" : mirror site .bib-back-to-top (40x40,
        borderRadius 16, glass blur, centre horizontal). */}
    <Animated.View
      pointerEvents={showBackTop ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 0, right: 0,
        bottom: 100,
        alignItems: 'center',
        opacity: backTopOpacity,
      }}
    >
      <TouchableOpacity
        onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
        activeOpacity={0.85}
        style={{
          width: 40, height: 40,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 0.5,
          borderColor: 'rgba(255,255,255,0.9)',
          shadowColor: '#000',
          shadowOpacity: 0.10,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 14,
          elevation: 6,
          backgroundColor: 'rgba(255,255,255,0.6)',
        }}
        accessibilityLabel="Remonter en haut"
      >
        <BlurView intensity={50} tint="light" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M6 15l6-6 6 6" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </BlurView>
      </TouchableOpacity>
    </Animated.View>
    </View>
  );
}
