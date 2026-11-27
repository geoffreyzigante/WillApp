// Ecran galerie photos d'un event cote organisateur. Mode preview : voit
// TOUTES les photos (before + during event). Celles qui manquent a la
// galerie publique ont une opacite reduite + dot rouge : la raison vient du
// worker (`hors_public`, meme regle que /list-public, time-gate compris).
//
// Features :
// - Filtres par distance (pills horizontales)
// - Mode selection long-press + barre « Masquer / Publier / Supprimer (N) » en bas
// - Tap photo masquee -> bouton "Publier" en overlay (POST visibility)
// - PhotoViewer integre via callback onOpenPhoto avec optimistic override

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, RefreshControl, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { GridErrorBoundary } from '../components/GridErrorBoundary';
import { C, colorForType } from '../constants/colors';
import { s } from '../constants/styles';
import { formatDateLong, cityLabel } from '../utils/format';
import { raceTitle, extractBurstTs, extractIdx } from '../utils/photo';
import { BoutonRetour } from '../components/BoutonRetour';
import { T } from '../constants/tokens';

// Absente de la galerie publique, et pourquoi (null = presente). Repli sur
// `hidden` tant qu un worker plus ancien n envoie pas `hors_public`.
function raisonHors(p) {
  if (p.hors_public !== undefined) return p.hors_public || null;
  return p.hidden === true ? 'masquee' : null;
}
// Memes mots que la galerie de l espace orga (GalerieEvent.js, FLAG_HORS).
const LIBELLE_HORS = {
  masquee: 'Masquée',
  sans_visage: 'Masquée · aucun visage',
  avant_depart: 'Masquée · avant le départ',
  passage: 'Masquée · hors de l\'heure de passage',
};
// Photo envoyee recemment et pas encore analysee (comme le site : fenetre de 6 h).
// Une photo ancienne jamais analysee est un reliquat : le serveur la tient pour
// visible. Sans le champ (serveur plus ancien), on ne dit rien.
const FENETRE_TRAITEMENT = 6 * 3600 * 1000;
function statutDe(p) {
  if (p.horsPublic) return 'masquee';
  if (p.processed === false && p.uploaded) {
    const t = new Date(p.uploaded).getTime();
    if (t && Date.now() - t < FENETRE_TRAITEMENT) return 'proc';
  }
  return 'ok';
}
// Lance `fn` sur chaque element, `n` a la fois (le serveur masque une photo par appel).
async function enLots(liste, n, fn) {
  let i = 0;
  const travailleur = async () => { while (i < liste.length) { const k = i++; await fn(liste[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, travailleur));
}

export function OrganizerEventPhotosScreen({ session, organizerApiFetch, event, onClose, onOpenPhoto }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [raceFilter, setRaceFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [lotEnCours, setLotEnCours] = useState(false);
  const [statutFiltre, setStatutFiltre] = useState('all');
  const [busyKey, setBusyKey] = useState(null);
  // Erreur de chargement : distincte de « aucune photo » (audit du 25/11).
  const [erreur, setErreur] = useState(false);
  const tint = colorForType(event.event_type);

  // silencieux : rechargement apres un geste (publier) sans vider la grille
  // ni la remonter en haut.
  const loadPhotos = useCallback(async ({ silencieux = false } = {}) => {
    if (!silencieux) {
      setLoading(true);
      setVisibleCount(20);
    }
    setErreur(false);
    try {
      const r = await organizerApiFetch(`/organizer/event-photos/${event.code}`);
      if (!r.ok) {
        // 401 : organizerApiFetch deconnecte deja. Le reste est une erreur.
        if (r.status !== 401) setErreur(true);
        return;
      }
      const data = await r.json();
      const raw = [...(data.during_event || []), ...(data.before_event || [])];
      const list = raw
        .filter(p => p && typeof p.url === 'string' && p.url.length > 0
                       && typeof p.key === 'string' && p.key.length > 0)
        .map(p => ({
          uri: p.url,
          // La grille (vignettes 1/3 d ecran) charge la derivee, pas le
          // plein format : 60 photos en pleine resolution saturaient memoire
          // et reseau. `uri` reste le plein format pour le viewer.
          thumb: p.thumb_md_url || p.thumb_url || p.url,
          id: p.key,
          tint,
          race: p.race,
          race_distance_id: p.race_distance_id || null,
          km: p.km,
          race_label: p.race_label || null,
          race_label_only: p.race_label_only === true,
          hidden: p.hidden === true,
          horsPublic: raisonHors(p),
          uploaded: p.uploaded || null,
          processed: typeof p.processed_quality === 'boolean' ? p.processed_quality : undefined,
        }));
      list.sort((a, b) => {
        const dt = extractBurstTs(b.id) - extractBurstTs(a.id);
        if (dt !== 0) return dt;
        return extractIdx(b.id) - extractIdx(a.id);
      });
      // Plus de plafond a 500 : le compteur doit dire le vrai total, et
      // l affichage est deja progressif (visibleCount).
      setPhotos(list);
    } catch (e) {
      console.warn('loadPhotos failed:', e?.message || e);
      setErreur(true);
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

  const distances = Array.isArray(event.distances) ? event.distances : [];

  // Meme regle que le site (photoRaceKey / photosDeLaSelection dans
  // website/event/index.html) : une photo sans course appartient a la course
  // unique s il n y en a qu une, a aucune sinon. Avant le 25/11, elle
  // apparaissait dans CHAQUE course.
  const cleCourseUnique = distances.length === 1 && distances[0]
    ? (distances[0].id ? String(distances[0].id) : (distances[0].km != null && String(distances[0].km).trim() !== '' ? String(distances[0].km) : null))
    : null;
  const cleCourse = (p) => {
    if (p && p.race_distance_id) return String(p.race_distance_id);
    if (p && p.race != null && String(p.race).trim() !== '') return String(p.race);
    return cleCourseUnique;
  };
  const parCourse = raceFilter === 'all'
    ? photos
    : photos.filter(p => cleCourse(p) === raceFilter);
  // Les compteurs « masquées » et « en traitement » suivent la course choisie,
  // comme le total (et comme la galerie de l espace orga).
  const hiddenCount = parCourse.filter(p => statutDe(p) === 'masquee').length;
  const procCount = parCourse.filter(p => statutDe(p) === 'proc').length;
  const filteredPhotos = statutFiltre === 'all'
    ? parCourse
    : parCourse.filter(p => statutDe(p) === statutFiltre);

  // Changer de filtre (course ou statut) vide la selection : des photos
  // selectionnees mais sorties de l affichage restaient comptees dans
  // « Masquer / Publier / Supprimer (N) » — on agissait sur de l invisible.
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [raceFilter, statutFiltre]);

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
        eventDateIso: event?.event_date || null,
        eventDateFinIso: event?.event_date_end || null,
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
                // Le serveur dit combien ont REELLEMENT ete supprimees :
                // filtrer localement en bloc affichait une grille fausse
                // quand une partie du lot avait echoue. On recharge
                // (silencieux : pas de remontee en haut) et on previent si
                // le compte ne tombe pas juste.
                const data = await r.json().catch(() => ({}));
                const demandees = selectedKeys.size;
                exitSelection();
                await loadPhotos({ silencieux: true });
                if (typeof data.deleted === 'number' && data.deleted < demandees) {
                  Alert.alert(
                    'Suppression partielle',
                    `${data.deleted} photo${data.deleted > 1 ? 's' : ''} supprimée${data.deleted > 1 ? 's' : ''} sur ${demandees}.`,
                  );
                }
              } else {
                const data = await r.json().catch(() => ({}));
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

  // Masquer / Publier en lot : le serveur traite une photo par appel, on en
  // lance quelques-uns a la fois. « Publier » leve le masquage, pas le
  // time-gate : une photo d avant le depart est ignoree.
  const aMasquer = photos.filter(p => selectedKeys.has(p.id) && !p.hidden && p.horsPublic !== 'avant_depart' && statutDe(p) !== 'masquee');
  const aPublier = photos.filter(p => selectedKeys.has(p.id) && p.hidden === true && p.horsPublic !== 'avant_depart');
  const changerVisibilite = async (liste, visible) => {
    if (!liste.length || lotEnCours) return;
    setLotEnCours(true);
    let echecs = 0;
    try {
      // Concurrence 1 : le worker fait un read-modify-write SANS verrou sur
      // la liste de visibilite. Quatre POST en parallele s ecrasaient
      // mutuellement (dernier ecrivain gagne, les autres modifications
      // perdues). Sequentiel = plus lent, mais chaque photo compte.
      await enLots(liste, 1, async (p) => {
        try {
          const r = await organizerApiFetch(`/organizer/photo-visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: p.id, visible }),
          });
          if (!r.ok) echecs++;
        } catch { echecs++; }
      });
      await loadPhotos({ silencieux: true });
      exitSelection();
      if (echecs > 0) {
        Alert.alert('Erreur', `${liste.length - echecs} modifiée${liste.length - echecs > 1 ? 's' : ''}, ${echecs} en erreur.`);
      }
    } finally {
      setLotEnCours(false);
    }
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
        <View style={[s.headerLeft, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <BoutonRetour onPress={onClose} libelle="Fermer" />
          <Text style={[s.welcome, { color: C.orga, fontSize: 18 }]}>
            {selectionMode ? `${selectedKeys.size} sélectionnée${selectedKeys.size > 1 ? 's' : ''}` : "Photos de l'event"}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {!selectionMode && photos.length > 0 ? (
            <TouchableOpacity onPress={() => setSelectionMode(true)} hitSlop={10}>
              <Text style={{ color: C.orga, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Sélectionner</Text>
            </TouchableOpacity>
          ) : selectionMode ? (
            <TouchableOpacity onPress={exitSelection} hitSlop={10}>
              <Text style={{ color: C.textSoft, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Annuler</Text>
            </TouchableOpacity>
          ) : null}
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
        <Text style={{ fontFamily: 'Montserrat', color: '#92400E', fontSize: 12, flex: 1 }}>
          Mode aperçu : tu vois toutes les photos, y compris celles que la galerie publique n'affiche pas (prises avant le départ, sans visage, ou masquées).
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => Linking.openURL(`https://will-app.com/event/${event.code}`).catch(() => {})}
        hitSlop={8}
        style={{ alignSelf: 'flex-start', marginBottom: 12 }}
      >
        <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 13, color: C.orga }}>Voir comme un coureur ↗</Text>
      </TouchableOpacity>

      {/* Puces inactives en blanc, active en noir orga (26/11). Ni lavande ni
          C.orgaClair : sur C.fondApp, la couleur de la page, une puce pale ne se
          lit pas comme un bouton (constate le 25/11). */}
      {distances.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, marginBottom: 8 }}
        >
          <TouchableOpacity
            onPress={() => setRaceFilter('all')}
            style={{
              paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
              backgroundColor: raceFilter === 'all' ? C.orga : T.couleur.champFond,
            }}
          >
            <Text style={{ color: raceFilter === 'all' ? '#fff' : C.orga, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>Toutes</Text>
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
                  backgroundColor: active ? C.orga : T.couleur.champFond,
                }}
              >
                <Text style={{ color: active ? '#fff' : C.orga, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>{raceTitle(d)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Toutes / Masquées / En traitement : meme filtre que la galerie de l
          espace orga. Affiche seulement s il y a de quoi filtrer. */}
      {(hiddenCount > 0 || procCount > 0 || statutFiltre !== 'all') && (
        <View style={{ flexDirection: 'row', backgroundColor: T.couleur.champFond, borderRadius: 12, padding: 3, marginBottom: 6 }}>
          {[
            { k: 'all', l: 'Toutes' },
            { k: 'masquee', l: `${hiddenCount} masquée${hiddenCount > 1 ? 's' : ''}` },
            { k: 'proc', l: `${procCount} en traitement` },
          ].map(({ k, l }) => {
            const actif = statutFiltre === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setStatutFiltre(k)}
                accessibilityState={{ selected: actif }}
                style={{ flex: k === 'proc' ? 1.5 : 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', backgroundColor: actif ? C.orga : 'transparent' }}
              >
                <Text numberOfLines={1} style={{ color: actif ? '#fff' : C.orga, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={[s.sectionTitle, { marginVertical: 10 }]}>
        Photos {photos.length > 0 ? `(${filteredPhotos.length})` : ''}
      </Text>
    </>
  );

  const ListEmpty = (
    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
      {loading
        ? <ActivityIndicator color={C.orga} />
        : erreur
          ? (
            <TouchableOpacity onPress={() => loadPhotos()} style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, textAlign: 'center' }}>Impossible de charger les photos.</Text>
              <Text style={{ fontFamily: 'Montserrat-SemiBold', color: C.orga, marginTop: 8 }}>Réessayer</Text>
            </TouchableOpacity>
          )
          : <Text style={{ fontFamily: 'Montserrat', color: C.textSoft }}>{statutFiltre === 'masquee' ? 'Aucune photo masquée' : statutFiltre === 'proc' ? 'Aucune photo en traitement' : 'Aucune photo pour le moment'}</Text>}
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
      await loadPhotos({ silencieux: true });
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
    const horsPublic = photo.horsPublic || null;
    // « Publier » leve le masquage et le filtre visage, pas le time-gate :
    // inutile de le proposer sur une photo d avant le depart.
    const peutPublier = isHidden && horsPublic !== 'avant_depart';
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
            source={{ uri: photo.thumb || photo.uri }}
            style={[StyleSheet.absoluteFillObject, horsPublic ? { opacity: 0.55 } : null]}
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
              backgroundColor: isSelected ? C.orga : 'rgba(0,0,0,0.4)',
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
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(26, 20, 38, 0.25)' }]} />
          )}
          {/* Point orange : envoyee recemment, pas encore analysee. */}
          {!horsPublic && !selectionMode && statutDe(photo) === 'proc' && (
            <View
              accessibilityLabel="En traitement"
              style={{
                position: 'absolute', top: 6, left: 6,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: '#F2A60C',
                borderWidth: 2, borderColor: '#fff',
              }}
            />
          )}
          {/* Point rouge en haut a gauche : absente de la galerie publique. */}
          {horsPublic && !selectionMode && (
            <View
              accessibilityLabel={LIBELLE_HORS[horsPublic] || 'Masquée'}
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
          {peutPublier && !selectionMode && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                handleTogglePublish(photo.id, true);
              }}
              disabled={isBusy}
              hitSlop={6}
              style={{
                position: 'absolute', bottom: 4, right: 4,
                backgroundColor: isBusy ? 'rgba(0,0,0,0.4)' : C.orga,
                paddingHorizontal: 8, paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'Montserrat-SemiBold' }}>
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
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <FlatList
          data={loading ? [] : filteredPhotos.slice(0, visibleCount)}
          numColumns={3}
          keyExtractor={(item, index) => item.id || `p-${index}`}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={C.orga} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
        />

        {selectionMode && selectedKeys.size > 0 && (
          <View style={{ position: 'absolute', bottom: 100, left: 16, right: 16, flexDirection: 'row', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 12, shadowOffset: { width: 0, height: 6 } }}>
            {[
              { k: 'masquer', l: 'Masquer', n: aMasquer.length, f: () => changerVisibilite(aMasquer, false) },
              { k: 'publier', l: 'Publier', n: aPublier.length, f: () => changerVisibilite(aPublier, true) },
            ].map(({ k, l, n, f }) => (
              <TouchableOpacity
                key={k}
                onPress={f}
                disabled={n === 0 || lotEnCours || deleting}
                style={{ flex: 1, backgroundColor: C.orga, paddingVertical: 15, borderRadius: 14, alignItems: 'center', opacity: n === 0 || lotEnCours || deleting ? 0.35 : 1 }}
              >
                {lotEnCours ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>{l} ({n})</Text>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={deleteSelected}
              disabled={deleting || lotEnCours}
              style={{ flex: 1, backgroundColor: C.error, paddingVertical: 15, borderRadius: 14, alignItems: 'center', opacity: deleting || lotEnCours ? 0.6 : 1 }}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Supprimer ({selectedKeys.size})</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </GridErrorBoundary>
  );
}
