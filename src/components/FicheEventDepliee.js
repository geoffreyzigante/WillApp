// Contenu de la carte d event depliee (Mes events) — meme organisation que la
// carte du site (dashboard/src/orga/pages/EventCard.js) :
//   1. bande de miniatures + « Voir les photos (N) »
//   2. liste a icones : Infos, Code PIN, Visibilite, Telechargement,
//      Galerie publique, Partager
//   3. « Supprimer cet evenement »
// Les lignes sont les memes que celles du site (fond gris de champ, filet de
// la charte, aucun contour).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking, Share, Modal, Image, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { C } from '../constants/colors';
import { T } from '../constants/tokens';
import { API_URL } from '../constants/api';

const NOIR = T.couleur.orga.accent;
// La liste de la fiche reprend celle du site telle qu elle est (blanc, filet
// #E4E4E7 autour et entre les lignes, rayon 14) : c est la reference.
const LIGNE = '#FFFFFF';
const FILET = '#E4E4E7';
const TUILE = T.couleur.champFond;
const DOUX = T.couleur.texteDoux;

// ── Icones de ligne (memes dessins que le site) ──────────────────────────
const ICONES = {
  infos: <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />,
  pin: <><Rect x="3" y="11" width="18" height="10" rx="2" /><Path d="M7 11V7a5 5 0 0110 0v4" /></>,
  visibilite: <><Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><Circle cx="12" cy="12" r="3" /></>,
  archive: <Path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />,
  galerie: <Path d="M14 4h6v6M20 4L10 14M20 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h5" />,
  partage: <><Circle cx="18" cy="5" r="3" /><Circle cx="6" cy="12" r="3" /><Circle cx="18" cy="19" r="3" /><Path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>,
};

export function Pastille({ type }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: TUILE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={NOIR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {ICONES[type]}
      </Svg>
    </View>
  );
}

// Un bloc de lignes : coins du premier et du dernier arrondis, filet de 1 pt.
export function ListeLignes({ children }) {
  const lignes = React.Children.toArray(children).filter(React.isValidElement);
  const n = lignes.length;
  return (
    <View style={{ backgroundColor: FILET, borderRadius: T.rayon.bloc, gap: 1, overflow: 'hidden', borderWidth: 1, borderColor: FILET }}>
      {lignes.map((l, i) => React.cloneElement(l, { key: l.key ?? i, dernier: i === n - 1 }))}
    </View>
  );
}

// Ligne : icone, titre + sous-titre, controle a droite (chevron, fleche, interrupteur…).
export function LigneIcone({ type, titre, sous, droite, onPress, enfants }) {
  const Conteneur = onPress ? TouchableOpacity : View;
  return (
    <Conteneur
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
      style={{ backgroundColor: LIGNE, paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 }}>
        <Pastille type={type} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 15, color: C.text }}>{titre}</Text>
          {sous ? <Text style={{ fontFamily: 'Montserrat', fontSize: 12.5, color: DOUX, marginTop: 1 }}>{sous}</Text> : null}
        </View>
        {droite}
      </View>
      {enfants ? <View style={{ marginTop: 12, marginLeft: 48 }}>{enfants}</View> : null}
    </Conteneur>
  );
}

const Chevron = () => <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 20, color: NOIR }}>›</Text>;
const FlecheExterne = () => <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 18, color: NOIR }}>↗</Text>;
export { Chevron, FlecheExterne };

// ── 1. Miniatures ────────────────────────────────────────────────────────
export function BandeMiniatures({ photos, total, chargement, onVoirTout }) {
  const apercu = useMemo(() => photos.filter(p => p && (p.thumb_url || p.url)).slice(0, 12), [photos]);
  return (
    <View style={{ marginBottom: 16 }}>
      {chargement ? (
        <View style={{ height: 64, justifyContent: 'center' }}><ActivityIndicator color={NOIR} /></View>
      ) : apercu.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }} style={{ marginBottom: 12 }}>
          {apercu.map((p) => {
            const hors = p.hors_public !== undefined ? !!p.hors_public : p.hidden === true;
            return (
              <TouchableOpacity key={p.key} onPress={onVoirTout} activeOpacity={0.8} accessibilityLabel="Voir les photos">
                <ExpoImage
                  source={{ uri: p.thumb_url || p.url }}
                  style={{ width: 64, height: 64, borderRadius: 10, opacity: hors ? 0.55 : 1, backgroundColor: LIGNE }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={150}
                />
                {hors ? (
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: C.error, borderWidth: 1.5, borderColor: '#fff' }} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}
      <TouchableOpacity
        onPress={onVoirTout}
        activeOpacity={0.85}
        style={{ marginHorizontal: 16, height: 52, borderRadius: 14, backgroundColor: NOIR, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>
          {total > 0 ? `Voir les photos (${total})` : 'Voir les photos'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 2. Telechargement : archive ZIP par photographe ─────────────────────
const ARCHIVE_MAX = 1000;

function libellePhotographe(pid) {
  const id = String(pid || '').toLowerCase();
  if (id === 'photographer' || id === 'participant' || id === 'photographe') return 'Photographe';
  if (id === 'organizer' || id === 'organisateur') return 'Organisateur';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id)) return 'Photographe';
  return String(pid || '').replace(/-/g, ' ');
}

// Meme regroupement que le site : cle R2 = {code}/{photographerId}/…
export function groupesPhotographes(photosData) {
  const arr = (photosData?.during_event || []).concat(photosData?.before_event || []);
  const m = new Map();
  for (const p of arr) {
    const pid = (p.key || '').split('/')[1];
    if (!pid || pid.startsWith('_')) continue;
    const nom = (p.photographer_name && p.photographer_name.trim()) || libellePhotographe(pid);
    if (!m.has(pid)) m.set(pid, { id: pid, name: nom, count: 0 });
    m.get(pid).count++;
  }
  const liste = Array.from(m.values()).sort((a, b) => b.count - a.count);
  const total = {};
  liste.forEach(x => { total[x.name] = (total[x.name] || 0) + 1; });
  const rang = {};
  return liste.map(x => (total[x.name] > 1 ? { ...x, name: `${x.name} ${(rang[x.name] = (rang[x.name] || 0) + 1)}` } : x));
}

function LigneArchive({ code, organizerApiFetch, photographerId, nom, nbPhotos }) {
  const nbParts = Math.max(1, Math.ceil(nbPhotos / ARCHIVE_MAX));
  const parts = Array.from({ length: nbParts }, (_, i) => (nbParts > 1 ? i + 1 : null));
  const [ids, setIds] = useState(() => parts.map(() => null));
  const [statuts, setStatuts] = useState(() => parts.map(() => null));
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const auto = useRef(false);

  // Sondage tant qu une partie est en cours (comme le site, toutes les 5 s).
  // Tolerance aux erreurs passageres : un sondage qui echoue (4G qui tousse,
  // 502) n enterre pas une archive en cours de generation. On garde le
  // dernier statut connu et on reessaie ; « Échec » n apparait qu apres
  // 3 echecs CONSECUTIFS sur la meme partie.
  useEffect(() => {
    if (ids.every(i => !i)) return undefined;
    let annule = false;
    let timer;
    const echecs = ids.map(() => 0);
    let derniers = ids.map(() => null);
    const tick = async () => {
      const res = await Promise.all(ids.map(async (id) => {
        if (!id) return null;
        try {
          const r = await fetch(`${API_URL}/archive/${encodeURIComponent(id)}/status`);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return { transitoire: true, error: d.error || 'Statut indisponible' };
          return d;
        } catch (e) { return { transitoire: true, error: 'Statut indisponible' }; }
      }));
      if (annule) return;
      const prochains = res.map((s, i) => {
        if (!s) return null;
        if (s.transitoire) {
          echecs[i] += 1;
          if (echecs[i] < 3) return derniers[i] || { status: 'pending' };
          return { status: 'error', error: s.error };
        }
        echecs[i] = 0;
        return s;
      });
      derniers = prochains;
      setStatuts(prochains);
      if (prochains.some(s => s && s.status === 'pending')) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => { annule = true; clearTimeout(timer); };
  }, [ids]);

  const prets = statuts.every(s => s && s.status === 'ready' && s.downloadUrl);
  const nbPrets = statuts.filter(s => s && s.status === 'ready').length;
  const enCours = envoi || statuts.some(s => s && s.status === 'pending');
  const echec = statuts.find(s => s && (s.status === 'failed' || s.status === 'error'));
  const poids = prets ? statuts.reduce((t, s) => t + (Number(s.sizeMB) || 0), 0) : 0;

  // Sur iOS, ouvrir l URL du ZIP laisse Safari le telecharger ; c est le
  // geste attendu (le site passe par un iframe cache).
  const telecharger = async () => {
    for (const s of statuts) {
      if (s?.downloadUrl) { try { await Linking.openURL(s.downloadUrl); } catch {} }
    }
  };

  useEffect(() => {
    if (prets && auto.current) { auto.current = false; telecharger(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prets]);

  const lancer = async () => {
    setEnvoi(true); setErreur('');
    auto.current = true;
    try {
      const next = [...ids];
      for (let i = 0; i < parts.length; i++) {
        if (statuts[i]?.status === 'ready') continue;
        const payload = photographerId ? { mode: 'photographer', photographerId } : { mode: 'photographer' };
        if (parts[i]) payload.part = parts[i];
        const r = await organizerApiFetch(`/organizer/event/${encodeURIComponent(code)}/archive-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Demande impossible');
        next[i] = d.requestId;
      }
      setStatuts(parts.map(() => null));
      setIds(next);
    } catch (e) {
      auto.current = false;
      setErreur(e.message || 'Demande impossible');
    } finally { setEnvoi(false); }
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: TUILE, borderRadius: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 14, color: C.text }}>{nom}</Text>
        <Text style={{ fontFamily: 'Montserrat', fontSize: 12, color: DOUX, marginTop: 2 }}>
          {nbPhotos} photo{nbPhotos > 1 ? 's' : ''}{nbParts > 1 ? ` · ${nbParts} ZIP` : ''}{poids ? ` · ${Math.round(poids)} Mo` : ''}
        </Text>
        {erreur ? <Text style={{ fontFamily: 'Montserrat', fontSize: 12, color: C.error, marginTop: 4 }}>{erreur}</Text> : null}
        {echec && !enCours ? <Text style={{ fontFamily: 'Montserrat', fontSize: 12, color: C.error, marginTop: 4 }}>Échec : {echec.error || 'raison inconnue'}</Text> : null}
      </View>
      <View style={{ flexShrink: 0 }}>
        {enCours ? (
          <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 13, color: NOIR }}>
            Génération…{nbParts > 1 ? ` (${nbPrets}/${nbParts})` : ''}
          </Text>
        ) : (
          <TouchableOpacity onPress={prets ? telecharger : lancer} activeOpacity={0.85} style={{ height: 40, paddingHorizontal: 16, borderRadius: 12, backgroundColor: NOIR, justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Télécharger</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export function LigneTelechargement({ code, organizerApiFetch, photosData }) {
  const groupes = useMemo(() => groupesPhotographes(photosData), [photosData]);
  // La somme des groupes, pas seulement during_event : les groupes (et le
  // ZIP « tous ») couvrent AUSSI before_event. Compter l un et archiver
  // l autre affichait un nombre faux et un decoupage en parts errone.
  const total = groupes.reduce((t, g) => t + g.count, 0);
  return (
    <LigneIcone
      type="archive"
      titre="Téléchargement"
      sous="Archive ZIP des photos optimisées. Lien valable 7 jours."
      enfants={groupes.length === 0 ? (
        <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: DOUX }}>Disponible dès les premières photos.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {groupes.map(g => (
            <LigneArchive key={g.id} code={code} organizerApiFetch={organizerApiFetch} photographerId={g.id} nom={g.name} nbPhotos={g.count} />
          ))}
          {groupes.length > 1 ? (
            <LigneArchive code={code} organizerApiFetch={organizerApiFetch} photographerId={null} nom="Tous les photographes" nbPhotos={total} />
          ) : null}
        </View>
      )}
    />
  );
}

// ── 3. Partager : lien + QR code (QR genere par le worker, comme le site) ─
export function FeuillePartage({ visible, code, onClose }) {
  const lien = `https://will-app.com/event/${code}`;
  const qr = `${API_URL}/qr?data=${encodeURIComponent(lien)}`;
  const partager = async () => { try { await Share.share({ message: lien }); } catch {} };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderRadius: 18, padding: 24, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'AVEstiana', fontSize: 22, color: C.text, marginBottom: 6 }}>Partager</Text>
          <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: DOUX, textAlign: 'center', marginBottom: 18 }}>
            Partage le lien public ou le QR code pour que les participants accèdent aux photos.
          </Text>
          <Image source={{ uri: qr }} style={{ width: 200, height: 200 }} resizeMode="contain" accessibilityLabel="QR code" />
          <Text selectable style={{ fontFamily: 'Montserrat-Medium', fontSize: 13, color: NOIR, marginTop: 14, marginBottom: 18 }}>{lien}</Text>
          <TouchableOpacity onPress={partager} activeOpacity={0.85} style={{ alignSelf: 'stretch', height: 48, borderRadius: 14, backgroundColor: NOIR, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Partager le lien</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={{ marginTop: 14 }}>
            <Text style={{ color: DOUX, fontSize: 14, fontFamily: 'Montserrat-Medium' }}>Fermer</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Droite de la ligne Code PIN : chiffres, crayon (modifier), copie (partager).
const Petite = ({ children }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={DOUX} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
);
export function DroitePin({ pin, onModifier, onCopier }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {pin ? <Text style={{ fontFamily: 'Courier', fontWeight: '700', fontSize: 20, letterSpacing: 3, color: NOIR }}>{pin}</Text> : <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 14, color: NOIR }}>Définir</Text>}
      <TouchableOpacity onPress={onModifier} hitSlop={10} accessibilityLabel="Modifier le code PIN">
        <Petite><Path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></Petite>
      </TouchableOpacity>
      {pin ? (
        <TouchableOpacity onPress={onCopier} hitSlop={10} accessibilityLabel="Partager le code PIN">
          <Petite><Rect x="9" y="9" width="11" height="11" rx="2" /><Path d="M5 15V6a2 2 0 012-2h9" /></Petite>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
