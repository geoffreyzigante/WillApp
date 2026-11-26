// EditEventSheet — « Modifier mon event », espace orga de l app.
// -----------------------------------------------------------------------
// Refonte du 26/11, jumelle de WILL/dashboard/src/orga/components/
// EventFullForm.js (maquette validee : WILL/maquettes/infos-event.html,
// ecran 3). Remplace la feuille « Reglages iOS » ou chaque ligne ouvrait une
// sous-modale avec son bouton Enregistrer.
//
// Quatre blocs : L'event · Epreuves · Contact · Page de l'event. Une ligne
// par info : libelle a gauche, champ editable a droite. Pas de bouton :
// chaque info s enregistre quand on quitte son champ (PUT partiel, le worker
// n ecrit que les cles envoyees), ou tout de suite pour les selecteurs.
// Les envois passent en file : deux champs quittes coup sur coup ne se
// croisent pas.
//
// Ce qui n est plus ici, et vit dans la fiche (OrganizerEventDetailScreen) :
// code PIN photographe, visibilite, facturation, suppression.
//
// Clavier (cf WILL/CLAUDE.md) : inset natif sur le ScrollView pour iOS, le
// KeyboardAvoidingView ne travaille que sur Android, ou l on recale en plus
// le champ actif (meme geste que montrerChampActif d AuthRunnerModal).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Platform,
  KeyboardAvoidingView, Keyboard, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { C } from '../../constants/colors';
import { API_URL } from '../../constants/api';
import { lh } from '../../constants/typo';
import { EVENT_TYPES, displayEventType, formatDateForForm, isoJourLocal } from '../../utils/format';
import { REQUIRED_FIELDS } from '../../utils/eventCompletion';
import { CalendarRangeModal } from './CalendarRangeModal';
import { CropImageModal } from './CropImageModal';
import {
  V, Bloc, Ligne, LigneEpreuve, Champ, ChampBouton, TitreSection, Pied, AjouterEpreuve,
} from '../formLignes';

// ── Lecture / ecriture, memes regles que le web ─────────────────────────
// "Louviers (27400)" -> { ville, cp }
function decouperLieu(loc) {
  const m = String(loc || '').match(/^(.+?)\s*\((\d{5})\)\s*$/);
  if (m) return { ville: m[1].trim(), cp: m[2] };
  return { ville: String(loc || '').trim(), cp: '' };
}
function normaliserUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}
// « 9h30 » (anciennes saisies de l app) ou « 09:30 » -> « 09:30 ».
function heureHHMM(v) {
  const m = String(v || '').match(/^(\d{1,2})[h:](\d{2})?/);
  return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : '';
}
// « 450m D+ » ou « 450 » -> « 450 ».
function metres(v) {
  const n = parseInt(String(v || ''), 10);
  return n > 0 ? String(n) : '';
}
// "2026-12-05" -> Date a minuit LOCAL (new Date(iso) lirait de l UTC).
function dateLocale(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

let compteurCle = 0;
const nouvelleCle = () => `n${++compteurCle}`;

function coursesDepuisEvent(ev) {
  const src = Array.isArray(ev?.distances) ? ev.distances : [];
  return src.map(d => (typeof d === 'object' && d ? {
    _k: nouvelleCle(),
    // id (UUID course) preserve : sans lui le worker en regenere un a chaque
    // edition, et le race_distance_id des photos deja uploadees ne pointe
    // plus sur rien.
    id: typeof d.id === 'string' ? d.id : undefined,
    // Majuscule initiale, comme partout ailleurs (« trail » -> « Trail »).
    label: d.label ? d.label.charAt(0).toUpperCase() + d.label.slice(1) : '',
    label_only: d.label_only === true,
    km: String(d.km || ''),
    time: heureHHMM(d.time),
    elevation: metres(d.elevation),
  } : { _k: nouvelleCle(), label: '', label_only: false, km: String(d), time: '', elevation: '' }))
    // Dans l ordre des departs, comme le programme d une course. Le tri ne
    // se fait qu a l ouverture : une ligne ne saute pas pendant la saisie.
    // Sans heure, l epreuve garde sa place apres les autres (tri stable).
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

function distancesPourEnvoi(courses) {
  return courses
    .filter(c => String(c.km).trim() || (c.label_only && c.label.trim()))
    .map(c => {
      const out = {
        label: (c.label || '').trim().slice(0, 40),
        label_only: !!c.label_only,
        km: String(c.km || '').trim(),
        time: c.time || '',
        elevation: String(c.elevation || '').trim(),
      };
      if (c.id) out.id = c.id;
      return out;
    });
}

// Les 6 infos de validation que cet ecran peut completer : celles du worker
// (CHAMPS_EVENT_REQUIS), moins l email administratif qui vit dans le compte.
const REQUIS = REQUIRED_FIELDS.filter(f => f.id !== 'contact_admin');

// ── Selecteurs (rendus DANS la feuille : sur iOS, une Modal ne se presente
//    au-dessus d une autre que si elle en est l enfant) ─────────────────
function FeuilleBas({ visible, onClose, titre, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
          <Text style={{ color: C.text, fontSize: 16, fontFamily: 'Montserrat-SemiBold', textAlign: 'center', marginBottom: 12 }}>{titre}</Text>
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Meme selecteur heures / minutes (pas de 5) que celui des distances de la
// creation. Rend « HH:MM », ou « » avec Effacer.
function PickerHeure({ visible, valeur, titre, onClose, onChoix }) {
  const [h, setH] = useState(-1);
  const [m, setM] = useState(-1);
  useEffect(() => {
    if (!visible) return;
    const r = String(valeur || '').match(/^(\d{1,2}):(\d{2})$/);
    setH(r ? parseInt(r[1], 10) : -1);
    setM(r ? parseInt(r[2], 10) : -1);
  }, [visible, valeur]);
  const pastille = (actif) => ({ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: actif ? C.orga : 'transparent', marginBottom: 2 });
  const chiffre = (actif) => ({ color: actif ? '#fff' : C.text, fontFamily: 'Montserrat-SemiBold', fontSize: 16 });
  const valider = () => {
    if (h < 0 && m < 0) { onClose(); return; }
    const hh = String(h < 0 ? 9 : h).padStart(2, '0');
    const mm = String(m < 0 ? 0 : m).padStart(2, '0');
    onChoix(`${hh}:${mm}`);
  };
  return (
    <FeuilleBas visible={visible} onClose={onClose} titre={titre}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>Heures</Text>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 24 }).map((_, i) => (
              <TouchableOpacity key={i} onPress={() => setH(i)} style={pastille(h === i)}>
                <Text style={chiffre(h === i)}>{i}h</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>Minutes</Text>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 12 }).map((_, i) => {
              const min = i * 5;
              return (
                <TouchableOpacity key={min} onPress={() => setM(min)} style={pastille(m === min)}>
                  <Text style={chiffre(m === min)}>{String(min).padStart(2, '0')}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, marginHorizontal: 20 }}>
        <TouchableOpacity onPress={() => onChoix('')} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: C.orgaClair, alignItems: 'center' }}>
          <Text style={{ color: C.orga, fontFamily: 'Montserrat-SemiBold' }}>Effacer</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={valider} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: C.orga, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold' }}>OK</Text>
        </TouchableOpacity>
      </View>
    </FeuilleBas>
  );
}

function PickerType({ visible, valeur, onClose, onChoix }) {
  return (
    <FeuilleBas visible={visible} onClose={onClose} titre="Type d'event">
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {EVENT_TYPES.map((t) => {
          const actif = valeur === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => onChoix(t)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, backgroundColor: actif ? C.orgaClair : 'transparent' }}
            >
              <Text style={{ flex: 1, fontFamily: 'Montserrat-Medium', fontSize: 16, color: actif ? C.orga : C.text }}>{displayEventType(t)}</Text>
              {actif ? <Text style={{ color: C.orga, fontFamily: 'Montserrat-SemiBold', fontSize: 18 }}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </FeuilleBas>
  );
}

// ── La feuille ──────────────────────────────────────────────────────────
// Montee par l appelant tant que `event` existe. Elle se ferme elle-meme
// (slide de sortie), puis previent l appelant via onClose : on ne demonte
// jamais une Modal iOS en cours de presentation.
export function EditEventSheet({ event, organizerApiFetch, organizerSession, onClose, onSaved }) {
  const ev = useMemo(() => event || {}, [event]);
  const me = organizerSession?.profile;
  const lieu = decouperLieu(ev.location);

  const [ouvert, setOuvert] = useState(true);
  const [nom, setNom] = useState(ev.name || '');
  const [cp, setCp] = useState(lieu.cp);
  const [ville, setVille] = useState(lieu.ville);
  const [villes, setVilles] = useState([]);
  const [dateDebut, setDateDebut] = useState(ev.event_date || '');
  const [dateFin, setDateFin] = useState(ev.event_date_end && ev.event_date_end !== ev.event_date ? ev.event_date_end : '');
  const [heure, setHeure] = useState(heureHHMM(ev.start_time));
  const [type, setType] = useState(ev.event_type || '');
  const [participants, setParticipants] = useState(ev.estimated_participants != null ? String(ev.estimated_participants) : '');
  const [courses, setCourses] = useState(() => coursesDepuisEvent(ev));
  const [adresse, setAdresse] = useState(ev.address || '');
  const [site, setSite] = useState((ev.website || '').replace(/^https?:\/\//i, ''));
  const [tel, setTel] = useState(ev.phone || '');
  const [email, setEmail] = useState(ev.contact || '');
  const [description, setDescription] = useState(ev.message || '');
  const [cover, setCover] = useState(ev.cover_image || '');
  const [coverBusy, setCoverBusy] = useState(false);
  const [cropAsset, setCropAsset] = useState(null);

  const [picker, setPicker] = useState(null); // 'type' | 'date' | 'heure' | { course: i }

  // Etat affiche en haut : '' | 'encours' | 'ok' | message d erreur.
  const [etat, setEtat] = useState('');
  const aEnregistre = useRef(false);
  const fileEnvoi = useRef(Promise.resolve());
  // Derniere valeur envoyee, cle par cle : un champ quitte sans changement
  // n envoie rien, et un echec rend la cle a nouveau « a envoyer ».
  const sauve = useRef({
    name: ev.name || '',
    location: ev.location || '',
    estimated_participants: ev.estimated_participants ?? null,
    contact: ev.contact || '',
    phone: ev.phone || '',
    website: ev.website || '',
    message: ev.message || '',
    address: ev.address || '',
    distances: JSON.stringify(distancesPourEnvoi(coursesDepuisEvent(ev))),
  });

  const enregistrer = useCallback((patch) => {
    if (!ev.code) return fileEnvoi.current;
    const avant = {};
    Object.keys(patch).forEach((k) => {
      avant[k] = sauve.current[k];
      sauve.current[k] = k === 'distances' ? JSON.stringify(patch[k]) : patch[k];
    });
    setEtat('encours');
    fileEnvoi.current = fileEnvoi.current.then(async () => {
      try {
        const r = await organizerApiFetch(`/organizer/event/${ev.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Enregistrement impossible');
        aEnregistre.current = true;
        setEtat('ok');
      } catch (e) {
        Object.assign(sauve.current, avant);
        setEtat(e?.message || 'Enregistrement impossible');
      }
    });
    return fileEnvoi.current;
  }, [ev.code, organizerApiFetch]);

  // ── Validation de chaque champ texte (au blur, et a la fermeture) ──────
  const valider = {
    name: () => { const v = nom.trim(); if (v && v !== sauve.current.name) enregistrer({ name: v }); },
    location: () => {
      const v = ville.trim();
      if (!v || !/^\d{5}$/.test(cp)) return;
      const loc = `${v} (${cp})`;
      if (loc !== sauve.current.location) enregistrer({ location: loc });
    },
    estimated_participants: () => {
      const n = participants ? Number(participants) : null;
      if (n !== sauve.current.estimated_participants) enregistrer({ estimated_participants: n });
    },
    contact: () => { const v = email.trim(); if (v !== sauve.current.contact) enregistrer({ contact: v }); },
    phone: () => { const v = tel.trim(); if (v !== sauve.current.phone) enregistrer({ phone: v }); },
    website: () => { const v = normaliserUrl(site); if (v !== sauve.current.website) enregistrer({ website: v }); },
    message: () => { const v = description.trim(); if (v !== sauve.current.message) enregistrer({ message: v }); },
    address: () => { const v = adresse.trim(); if (v !== sauve.current.address) enregistrer({ address: v }); },
    distances: (liste = courses) => {
      const d = distancesPourEnvoi(liste);
      if (JSON.stringify(d) !== sauve.current.distances) enregistrer({ distances: d });
    },
  };

  const fermeeRef = useRef(false);
  const prevenirFermeture = useCallback(() => {
    if (fermeeRef.current) return;
    fermeeRef.current = true;
    onClose?.();
    // Une feuille fermee d un geste (glisser vers le bas) peut laisser un
    // envoi en vol : on rafraichit la liste une fois la file videe.
    fileEnvoi.current.then(() => { if (aEnregistre.current) onSaved?.(); });
  }, [onClose, onSaved]);

  const fermer = async () => {
    // Le champ en cours de saisie n a pas encore ete quitte : on l envoie.
    Object.values(valider).forEach(f => f());
    Keyboard.dismiss();
    await fileEnvoi.current;
    setOuvert(false);
    // iOS previent par onDismiss, une fois la feuille sortie de l ecran.
    // Ailleurs (et si onDismiss ne venait pas), on attend la fin du slide.
    setTimeout(prevenirFermeture, Platform.OS === 'ios' ? 700 : 300);
  };

  // ── Code postal -> communes via /villes ───────────────────────────────
  useEffect(() => {
    if (!/^\d{5}$/.test(cp)) { setVilles([]); return undefined; }
    let annule = false;
    const ctl = new AbortController();
    const minuterie = setTimeout(() => ctl.abort(), 3000);
    fetch(`${API_URL}/villes?cp=${cp}`, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : { villes: [] }))
      .then((d) => {
        if (annule) return;
        const noms = (d?.villes || []).map(c => c.nom).sort((a, b) => a.localeCompare(b));
        setVilles(noms);
        if (noms.length === 1 && noms[0] !== ville) {
          setVille(noms[0]);
          const loc = `${noms[0]} (${cp})`;
          if (loc !== sauve.current.location) enregistrer({ location: loc });
        }
      })
      .catch(() => { if (!annule) setVilles([]); })
      .finally(() => clearTimeout(minuterie));
    return () => { annule = true; ctl.abort(); clearTimeout(minuterie); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cp]);

  // ── Android : amener le champ actif au-dessus du clavier ──────────────
  const defilementRef = useRef(null);
  const [clavierOuvert, setClavierOuvert] = useState(false);
  const montrerChampActif = () => {
    if (Platform.OS !== 'android') return;
    setTimeout(() => {
      try {
        const champ = TextInput.State.currentlyFocusedInput();
        const zone = defilementRef.current;
        if (!champ || !zone || typeof champ.measureLayout !== 'function') return;
        const contenu = typeof zone.getInnerViewRef === 'function' ? zone.getInnerViewRef() : zone;
        champ.measureLayout(contenu, (_x, y) => {
          zone.scrollTo({ y: Math.max(0, y - 120), animated: true });
        }, () => {});
      } catch {}
    }, 120);
  };
  useEffect(() => {
    const ouvre = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const ferme = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(ouvre, () => { setClavierOuvert(true); montrerChampActif(); });
    const b = Keyboard.addListener(ferme, () => setClavierOuvert(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // ── Les 6 infos de validation, lues sur la saisie en cours ─────────────
  const evVirtuel = useMemo(() => ({
    ...ev,
    event_date: dateDebut,
    estimated_participants: participants ? Number(participants) : null,
    distances: distancesPourEnvoi(courses),
    message: description,
    cover_image: cover,
    contact: email, phone: tel, website: site,
  }), [ev, dateDebut, participants, courses, description, cover, email, tel, site]);
  const manquants = useMemo(
    () => new Set(REQUIS.filter(f => !f.check(evVirtuel, me)).map(f => f.id)),
    [evVirtuel, me],
  );
  const nbRequis = REQUIS.length;
  const nbManquants = manquants.size;
  const contactManque = manquants.has('contact_public');

  // ── Couverture : meme parcours que l ancienne feuille (galerie, cadrage
  //    2:1 dans CropImageModal, PUT /organizer/cover/:code) ──────────────
  const choisirCover = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Accès aux photos refusé', 'Active l\'accès à tes photos dans les réglages.', [{ text: 'Plus tard', style: 'cancel' }, { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings() }]);
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });
      if (r.canceled || !r.assets?.[0]?.uri) return;
      setCropAsset(r.assets[0]);
    } catch (e) {
      Alert.alert('Erreur', e.message || 'Impossible de sélectionner l\'image');
    }
  };
  const envoyerCover = async (cropped) => {
    setCropAsset(null);
    if (!ev.code || !cropped?.uri) return;
    setCoverBusy(true);
    setEtat('encours');
    // Meme file que les champs : la couverture ne double pas un PUT en cours.
    fileEnvoi.current = fileEnvoi.current.then(async () => {
      try {
        const res = await fetch(cropped.uri);
        const blob = await res.blob();
        const up = await organizerApiFetch(`/organizer/cover/${ev.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        const data = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(data.error || 'Envoi impossible');
        setCover(data.cover_image || cover);
        aEnregistre.current = true;
        setEtat('ok');
      } catch (e) {
        setEtat(e?.message || 'Envoi impossible');
      } finally {
        setCoverBusy(false);
      }
    });
  };

  // ── Epreuves ──────────────────────────────────────────────────────────
  const majCourse = (i, champ, valeur) =>
    setCourses(l => l.map((c, idx) => (idx === i ? { ...c, [champ]: valeur } : c)));
  const retirerCourse = (i) => {
    const suivantes = courses.filter((_, idx) => idx !== i);
    setCourses(suivantes);
    valider.distances(suivantes);
  };
  const ajouterCourse = () =>
    setCourses(l => [...l, { _k: nouvelleCle(), label: '', label_only: false, km: '', time: '', elevation: '' }]);

  const etatTexte = etat === 'encours' ? 'Enregistrement…' : etat === 'ok' ? 'Enregistré' : etat;
  const etatErreur = !!etat && etat !== 'encours' && etat !== 'ok';
  // Bas de casse, comme le site (« Mer. 11 novembre 2026 ») : les capitales
  // de formatDateForForm conviennent aux cartes, pas a un champ.
  const dateAffichee = (() => {
    if (!dateDebut) return '';
    const t = formatDateForForm(dateDebut, dateFin || null).toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();
  const courseHeure = picker && typeof picker === 'object' ? picker.course : null;

  return (
    <Modal
      visible={ouvert}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={fermer}
      onDismiss={prevenirFermeture}
    >
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff' }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        {/* Entete B (validee le 26/11) : pas de bandeau. Retour rond, titre
            noir et rappel de l event modifie, comme Reglages d Apple. Meme
            entete que l espace orga (evf-entete). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 18, paddingBottom: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#E4E4E7' }}>
          <TouchableOpacity
            onPress={fermer}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#E4E4E7', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 20, lineHeight: lh(20, 24, 'Montserrat'), color: V.texte, marginTop: -2 }}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ fontFamily: 'AVEstiana', fontSize: 22, lineHeight: lh(22, 26, 'AVEstiana'), color: V.texte }}>
              Modifier mon event
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: 'Montserrat', fontSize: 12.5, lineHeight: lh(12.5, 16, 'Montserrat'), color: V.libelle }}>
              {[nom.trim() || ev.name, dateAffichee].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={2}
            style={{ maxWidth: 96, fontFamily: 'Montserrat', fontSize: 12, lineHeight: lh(12, 15, 'Montserrat'), color: etatErreur ? C.error : V.libelle, textAlign: 'right' }}
          >
            {etatTexte}
          </Text>
        </View>

        <ScrollView
          ref={defilementRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          // Passage d un champ a l autre clavier deja ouvert : pas de nouvel
          // evenement clavier, on recale au toucher.
          onTouchEnd={() => { if (clavierOuvert) montrerChampActif(); }}
        >
          {/* Couverture */}
          <TouchableOpacity
            onPress={choisirCover}
            disabled={coverBusy}
            activeOpacity={0.85}
            style={{ height: 160, borderRadius: 18, overflow: 'hidden', backgroundColor: V.ligne, alignItems: 'center', justifyContent: 'center' }}
          >
            {cover ? (
              <ExpoImage source={{ uri: cover }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
            ) : (
              <Text style={{ fontFamily: 'Montserrat', fontSize: 14, color: manquants.has('cover_image') ? C.error : V.libelle }}>
                Ajoute une photo de couverture
              </Text>
            )}
            <View style={{ position: 'absolute', right: 10, bottom: 10, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {coverBusy ? <ActivityIndicator size="small" color={C.orga} /> : null}
              <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 13, color: C.orga }}>
                {coverBusy ? 'Envoi…' : cover ? 'Changer la photo' : 'Choisir une photo'}
              </Text>
            </View>
          </TouchableOpacity>
          {manquants.has('cover_image') ? <Pied erreur>La photo de couverture est demandée pour la validation.</Pied> : null}

          {/* L'event */}
          <TitreSection>L'event</TitreSection>
          <Bloc>
            <Ligne seule>
              <Champ
                value={nom}
                onChangeText={setNom}
                onBlur={valider.name}
                placeholder="Nom de l'event"
                accessibilityLabel="Nom de l'event"
                autoCapitalize="sentences"
                returnKeyType="done"
                aGauche
                style={{ height: 44, fontSize: 16, fontFamily: 'Montserrat-SemiBold' }}
              />
            </Ligne>
            <Ligne libelle="Type">
              <ChampBouton valeur={type ? displayEventType(type) : ''} placeholder="Choisir" icone="liste" onPress={() => { Keyboard.dismiss(); setPicker('type'); }} />
            </Ligne>
            <Ligne libelle="Date" manque={manquants.has('event_date')}>
              <ChampBouton
                valeur={dateAffichee}
                placeholder={manquants.has('event_date') ? 'À renseigner' : 'À venir'}
                manque={manquants.has('event_date')}
                icone="calendrier"
                onPress={() => { Keyboard.dismiss(); setPicker('date'); }}
              />
            </Ligne>
            <Ligne libelle="Départ">
              <ChampBouton valeur={heure} placeholder="Facultatif" onPress={() => { Keyboard.dismiss(); setPicker('heure'); }} />
            </Ligne>
            <Ligne libelle="Lieu">
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Champ
                  value={cp}
                  onChangeText={(v) => setCp(v.replace(/\D/g, '').slice(0, 5))}
                  onBlur={valider.location}
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholder="27400"
                  accessibilityLabel="Code postal"
                  style={{ minWidth: 56, paddingRight: 2 }}
                />
                <Champ
                  value={ville}
                  onChangeText={setVille}
                  onBlur={valider.location}
                  placeholder="Ville"
                  accessibilityLabel="Ville"
                  autoCapitalize="words"
                  style={{ minWidth: 52, flexShrink: 1, paddingLeft: 2 }}
                />
              </View>
            </Ligne>
            {/* Les communes ne s affichent que s il faut choisir : une ville deja
                valide (Louviers pour 27400) n affiche plus les 30 communes. */}
            {villes.length > 1 && !villes.includes(ville) ? (
              <Ligne libelle=" ">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 8 }}>
                  {villes.map((v) => {
                    const actif = v === ville;
                    return (
                      <TouchableOpacity
                        key={v}
                        onPress={() => {
                          setVille(v);
                          const loc = `${v} (${cp})`;
                          if (loc !== sauve.current.location) enregistrer({ location: loc });
                        }}
                        style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: actif ? C.orga : '#fff', borderWidth: 1, borderColor: actif ? C.orga : V.bord }}
                      >
                        <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 13, color: actif ? '#fff' : V.texte }}>{v}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Ligne>
            ) : null}
            <Ligne libelle="Participants" manque={manquants.has('estimated_participants')}>
              <Champ
                value={participants}
                onChangeText={(v) => setParticipants(v.replace(/\D/g, '').slice(0, 6))}
                onBlur={valider.estimated_participants}
                keyboardType="number-pad"
                placeholder={manquants.has('estimated_participants') ? 'À renseigner' : '500'}
                manque={manquants.has('estimated_participants')}
              />
            </Ligne>
          </Bloc>

          {/* Epreuves */}
          <TitreSection>Épreuves</TitreSection>
          <Bloc>
            {courses.map((c, i) => (
              <LigneEpreuve
                key={c._k}
                label={c.label}
                km={c.km}
                time={c.time}
                elevation={c.elevation}
                placeholderNom={type ? displayEventType(type) : 'Nom'}
                onLabel={(v) => majCourse(i, 'label', v.slice(0, 40))}
                onKm={(v) => majCourse(i, 'km', v.replace(',', '.').replace(/[^\d.]/g, ''))}
                onElevation={(v) => majCourse(i, 'elevation', v.replace(/\D/g, '').slice(0, 5))}
                onHeure={() => { Keyboard.dismiss(); setPicker({ course: i }); }}
                onRetirer={() => retirerCourse(i)}
                onBlur={() => valider.distances()}
              />
            ))}
            <AjouterEpreuve onPress={ajouterCourse} />
          </Bloc>
          {manquants.has('distances') ? <Pied erreur>Ajoute au moins une épreuve avec sa distance.</Pied> : null}

          {/* Contact */}
          <TitreSection>Contact</TitreSection>
          <Bloc>
            <Ligne libelle="Email">
              <Champ
                value={email}
                onChangeText={setEmail}
                onBlur={valider.contact}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="contact@monevent.fr"
              />
            </Ligne>
            <Ligne libelle="Téléphone">
              <Champ
                value={tel}
                onChangeText={setTel}
                onBlur={valider.phone}
                keyboardType="phone-pad"
                placeholder="Facultatif"
              />
            </Ligne>
            <Ligne libelle="Site web">
              <Champ
                value={site}
                onChangeText={setSite}
                onBlur={valider.website}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Facultatif"
              />
            </Ligne>
          </Bloc>
          <Pied erreur={contactManque}>
            {contactManque ? "Renseigne au moins un des trois : il s'affiche sur la page de l'event." : "Affichés sur la page de l'event."}
          </Pied>

          {/* Page de l'event */}
          <TitreSection>Page de l'event</TitreSection>
          <Bloc>
            <Ligne seule>
              <Champ
                value={description}
                onChangeText={setDescription}
                onBlur={valider.message}
                multiline
                maxLength={2000}
                placeholder={manquants.has('message') ? 'Description · à renseigner' : "Parcours, ambiance, ce qu'il faut savoir avant de venir"}
                manque={manquants.has('message')}
                accessibilityLabel="Description"
                autoCapitalize="sentences"
              />
            </Ligne>
            <Ligne libelle="Adresse">
              <Champ
                value={adresse}
                onChangeText={setAdresse}
                onBlur={valider.address}
                placeholder="Facultatif"
                autoCapitalize="sentences"
              />
            </Ligne>
          </Bloc>
          <Pied>L'adresse place la carte sur la page de l'event.</Pied>

          {ev.is_draft === true ? (
            <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: V.libelle, textAlign: 'center', marginTop: 24 }}>
              {nbManquants === 0
                ? 'Prêt à envoyer en validation'
                : `${nbRequis - nbManquants} sur ${nbRequis} pour l'envoyer en validation`}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Selecteurs : enfants de la feuille pour se presenter au-dessus. */}
      <PickerType
        visible={picker === 'type'}
        valeur={type}
        onClose={() => setPicker(null)}
        onChoix={(t) => {
          setPicker(null);
          if (t !== type) { setType(t); enregistrer({ event_type: t }); }
        }}
      />
      <PickerHeure
        visible={picker === 'heure'}
        titre="Heure de départ"
        valeur={heure}
        onClose={() => setPicker(null)}
        onChoix={(v) => {
          setPicker(null);
          if (v !== heure) { setHeure(v); enregistrer({ start_time: v }); }
        }}
      />
      <PickerHeure
        visible={courseHeure !== null}
        titre="Départ de l'épreuve"
        valeur={courseHeure !== null ? courses[courseHeure]?.time : ''}
        onClose={() => setPicker(null)}
        onChoix={(v) => {
          const i = courseHeure;
          setPicker(null);
          const suivantes = courses.map((c, idx) => (idx === i ? { ...c, time: v } : c));
          setCourses(suivantes);
          valider.distances(suivantes);
        }}
      />
      {/* « Date à venir » rend (null, null) : on efface les deux dates. */}
      <CalendarRangeModal
        visible={picker === 'date'}
        onClose={() => setPicker(null)}
        initialStart={dateLocale(dateDebut)}
        initialEnd={dateLocale(dateFin)}
        minDate={null}
        allowTbd
        onConfirm={(debut, fin) => {
          const d = isoJourLocal(debut);
          const f = isoJourLocal(fin);
          setDateDebut(d);
          setDateFin(f && f !== d ? f : '');
          enregistrer({ event_date: d, event_date_end: f && f !== d ? f : '' });
        }}
      />
      <CropImageModal
        visible={!!cropAsset}
        asset={cropAsset}
        onCancel={() => setCropAsset(null)}
        onConfirm={envoyerCover}
      />
    </Modal>
  );
}

export default EditEventSheet;
