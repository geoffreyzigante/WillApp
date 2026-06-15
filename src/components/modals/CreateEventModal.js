// Modal de creation / edition d'event organisateur.
//
// 2 modes :
//   - CREATION : wizard 4 steps avec slide animation entre les pages
//     1. Identite (nom, code, ville, dates)
//     2. Distances + courses + horaires + denivele
//     3. Photographe(s) PIN + cover image
//     4. Recap + soumission
//   - EDITION : style iOS Settings drill-down avec sub-modales par section
//     (whitelist PUT partiel cote worker)
//
// Gere : geo.api.gouv.fr (fallback B12b), upload R2 cover + crop 2:1
// (CropImageModal), CalendarRangeModal pour les dates, OverlayWheel pour
// pickers km/heure/denivele.

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView, Animated,
  Alert, Platform, Keyboard, KeyboardAvoidingView, ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { C, colorForType } from '../../constants/colors';
import { s } from '../../constants/styles';
import { formSectionStyle, authStyles } from '../../constants/formStyles';
import { formatDateForForm } from '../../utils/format';
import { raceTitle } from '../../utils/photo';
import { generateRandomPin, isValidPin } from '../../utils/pin';
import { modeChipStyleApp, modeChipTextStyleApp } from '../../utils/styleHelpers';
import { PasswordInput } from '../PasswordInput';
import { PinInputRow } from '../PinInputRow';
import { OverlayWheel } from '../OverlayWheel';
import { CalendarRangeModal } from './CalendarRangeModal';
import { CropImageModal } from './CropImageModal';
import { SubModalInputText } from './SubModalInputText';

export function CreateEventModal({ visible, onClose, onCreated, organizerSession, organizerApiFetch, editEvent }) {
  const isEdit = !!editEvent;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [eventDate, setEventDate] = useState(null); // Date object | null
  const [eventDateEnd, setEventDateEnd] = useState(null); // Date object | null (null ⇒ event 1 jour)
  const [showCalendar, setShowCalendar] = useState(false);
  const [startTime, setStartTime] = useState(''); // "HH:MM"
  const [photographerPwd, setPhotographerPwd] = useState('');
  const [revealPwd, setRevealPwd] = useState(false);
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  // Audit B12b / UI-10 — geo.api.gouv.fr KO/timeout/sans match -> fallback saisie manuelle.
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
  const [eventType, setEventType] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  // UI-12 : contact administratif separe du contact public. Pre-rempli avec
  // l email de login orga (pattern existant) mais editable independamment.
  const [contactAdmin, setContactAdmin] = useState('');
  const [phone, setPhone] = useState('');
  // distances : [{ label, label_only, km, time, elevation }].
  // Mode Type (label_only=false) : label = event_type, affichage final
  // `${label} ${km} km`. Mode Nom (label_only=true) : label libre,
  // affichage = label seul (sans km).
  const [distances, setDistances] = useState([]);
  const [timePickerIdx, setTimePickerIdx] = useState(null);
  const [elevPickerIdx, setElevPickerIdx] = useState(null);
  const [kmPickerIdx, setKmPickerIdx] = useState(null);
  const [coverImage, setCoverImage] = useState(null); // URL distante après upload
  const [pendingCoverLocal, setPendingCoverLocal] = useState(null); // URI locale pendant la création (pas encore d'event)
  const [coverBusy, setCoverBusy] = useState(false);
  const [cropAsset, setCropAsset] = useState(null); // asset {uri,width,height} → ouvre CropImageModal
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [sheetW, setSheetW] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const [userEditedCode, setUserEditedCode] = useState(false);
  const [showErr, setShowErr] = useState({ 1: false, 2: false, 3: false, 4: false });
  // Mode edition style "iOS Settings drill-down" : la home liste les sections,
  // tap sur une row ouvre une sous-modale dediee avec save par section
  // (PUT partiel via la whitelist worker).
  const [editingField, setEditingField] = useState(null);
  const [partialBusy, setPartialBusy] = useState(false);
  // Hauteur du clavier pour ajuster les sub-modales d'edition (Lieu, Distances)
  // ou KeyboardAvoidingView n'est pas fiable sur iOS avec une Modal RN.
  const [editKbHeight, setEditKbHeight] = useState(0);
  useEffect(() => {
    if (!isEdit || !editingField) { setEditKbHeight(0); return; }
    const showName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideName = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sh = Keyboard.addListener(showName, e => setEditKbHeight(e?.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideName, () => setEditKbHeight(0));
    return () => { sh.remove(); hd.remove(); };
  }, [isEdit, editingField]);

  const parseLocation = (loc = '') => {
    // Format attendu: "Louviers (27400)" ou "Louviers (27)"
    const m = String(loc).match(/^(.+?)\s*\((\d{2,5})\)\s*$/);
    if (m) {
      const city = m[1].trim();
      const code = m[2];
      // Si c'est un code de département (2 chiffres), on n'a pas le code postal complet
      if (code.length === 5) return { city, postalCode: code };
      return { city, postalCode: '' };
    }
    return { city: loc, postalCode: '' };
  };

  useEffect(() => {
    if (visible) {
      setStep(1);
      setShowErr({ 1: false, 2: false, 3: false, 4: false });
      slideX.setValue(0);
      setUserEditedCode(false);
      setEditingField(null);
      if (isEdit) {
        setName(editEvent.name || '');
        setCode(editEvent.code || '');
        setPassword('');
        setEventDate(editEvent.event_date ? new Date(editEvent.event_date) : null);
        setEventDateEnd(editEvent.event_date_end ? new Date(editEvent.event_date_end) : null);
        setStartTime(editEvent.start_time || '');
        setPhotographerPwd(editEvent.photographer_password || '');
        setRevealPwd(false);
        const { city: cy, postalCode: pc } = parseLocation(editEvent.location || '');
        setPostalCode(pc); setCity(cy); setCitySuggestions([]);
        setEventType(editEvent.event_type || '');
        setWebsite(editEvent.website || '');
        // Fallback en cascade : contact (email saisi à la creation) -> email orga -> ''.
        // organizerSession est structuré { token, profile } — l'email est sous profile.
        setContact(editEvent.contact || organizerSession?.profile?.email || '');
        setContactAdmin(editEvent.contact_admin || editEvent.organizer_email || organizerSession?.profile?.email || '');
        setPhone(editEvent.phone || '');
        setDistances(Array.isArray(editEvent.distances) ? editEvent.distances.map(d => ({
          label: d.label || '',
          label_only: d.label_only === true,
          km: String(d.km || ''), time: d.time || '', elevation: d.elevation || '',
        })) : []);
        setCoverImage(editEvent.cover_image || null);
        setPendingCoverLocal(null);
      } else {
        setName(''); setCode(''); setPassword('');
        setEventDate(null); setEventDateEnd(null);
        setStartTime(''); setPhotographerPwd(''); setRevealPwd(false);
        setPostalCode(''); setCity(''); setCitySuggestions([]);
        setEventType('');
        // Pré-rempli avec l'email du compte orga connecté (éditable). La session
        // est structurée { token, profile } — l'email est sous profile.email. Si
        // la session arrive de manière asynchrone après l'ouverture du modal, un
        // second useEffect ci-dessous (deps [visible, isEdit, organizerSession])
        // re-tire l'email tant que l'utilisateur n'a rien saisi.
        setWebsite(''); setContact(organizerSession?.profile?.email || ''); setContactAdmin(organizerSession?.profile?.email || ''); setPhone(''); setDistances([]);
        setCoverImage(null); setPendingCoverLocal(null);
      }
    }
  }, [visible, isEdit]);

  // Fallback : si organizerSession arrive APRES l'ouverture du modal (race au
  // boot, restore AsyncStorage asynchrone), on retire l'email pré-rempli tant
  // que le user n'a rien saisi. Ne touche pas au champ en mode édition.
  useEffect(() => {
    if (!visible || isEdit) return;
    const email = organizerSession?.profile?.email;
    if (email && !contact) setContact(email);
    if (email && !contactAdmin) setContactAdmin(email);
    // contact est volontairement hors deps : on ne veut pas écraser une saisie
    // user. Le check `&& !contact` dans le corps de l'effet suffit.
  }, [visible, isEdit, organizerSession]);

  // Slug auto-généré depuis le nom (création seulement, tant que l'utilisateur ne l'a pas modifié manuellement)
  useEffect(() => {
    if (isEdit || userEditedCode) return;
    const slug = (name || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    setCode(slug);
  }, [name, isEdit, userEditedCode]);

  // Suggestions de villes selon code postal (pattern B12b - UI-10)
  useEffect(() => {
    if (!/^\d{5}$/.test(postalCode)) {
      setCitySuggestions([]);
      setCityFetchFailed(false);
      return;
    }
    let cancelled = false;
    const ctl = new AbortController();
    ctl.timedOut = false;
    const timeoutId = setTimeout(() => { ctl.timedOut = true; ctl.abort(); }, 3000);
    (async () => {
      try {
        const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${postalCode}&fields=nom&format=json`, { signal: ctl.signal });
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (cancelled) return;
        const cities = (data || []).map(c => c.nom);
        setCitySuggestions(cities);
        setCityFetchFailed(cities.length === 0);
        if (cities.length === 1 && !city) setCity(cities[0]);
      } catch (e) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (e?.name === 'AbortError' && !ctl.timedOut) return; // cleanup useEffect, pas vraie erreur
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
  }, [postalCode]);

  const addDistance = () => setDistances(d => [...d, { label: eventType || '', label_only: false, km: '', time: '', elevation: '' }]);
  const setDistanceMode = (idx, labelOnly) => {
    setDistances(d => d.map((it, i) => {
      if (i !== idx) return it;
      let nextLabel = it.label;
      if (!labelOnly && !nextLabel) nextLabel = eventType || '';
      if (labelOnly && nextLabel === eventType) nextLabel = '';
      return { ...it, label_only: labelOnly, label: nextLabel };
    }));
  };
  const updateDistance = (idx, field, value) => {
    setDistances(d => d.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };
  const removeDistance = (idx) => setDistances(d => d.filter((_, i) => i !== idx));

  // Sélection de l'image. iOS ignore aspect dans son cropper natif sur les
  // ratios non-standards, donc on ouvre notre CropImageModal pour que
  // l'utilisateur cadre lui-même en 2:1 (image moitié droite des cards 4:1).
  const pickAndUploadCover = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Autorisation refusée', 'Active l\'accès à tes photos dans les réglages.');
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

  // Validé depuis la CropImageModal → upload (édition) ou stockage local (création).
  const handleCropConfirm = async (cropped) => {
    setCropAsset(null);
    const localUri = cropped.uri;
    if (isEdit && editEvent?.code) {
      setCoverBusy(true);
      try {
        const res = await fetch(localUri);
        const blob = await res.blob();
        const up = await organizerApiFetch(`/organizer/cover/${editEvent.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
        const data = await up.json();
        if (up.ok) setCoverImage(data.cover_image);
        else Alert.alert('Erreur', data.error || 'Échec de l\'upload');
      } catch (e) {
        Alert.alert('Erreur', e.message || 'Échec de l\'upload');
      } finally { setCoverBusy(false); }
    } else {
      setPendingCoverLocal(localUri);
    }
  };

  const emailPublicFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contact || '').trim());
  const emailAdminFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((contactAdmin || '').trim());
  // UI-12 v2 (decision user 2026-06-04) : contact public = au moins UNE des
  // 3 infos (email valide, telephone non vide, site web non vide). Aucune
  // n est individuellement obligatoire.
  const hasPublicContact = (contact?.trim() && emailPublicFormat) || !!phone?.trim() || !!website?.trim();
  // emailOk : utilise dans l affichage erreur en bas du form (le seul cas
  // ou on affiche "Email invalide" est si le user a tape un email public
  // mal forme — un email vide est OK puisqu il y a tel/web possible).
  const emailOk = !contact?.trim() || emailPublicFormat;
  const locationOk = /^\d{5}$/.test(postalCode) && !!city?.trim();
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const dateOk = !!eventDate && eventDate >= todayMidnight;
  // Distances optionnelles : un event peut être créé sans aucune course (event
  // type "course non chronométrée", marche libre, etc.). Si l'orga ajoute des
  // courses, chacune doit avoir un km > 0 pour rester cohérente.
  const distancesOk = distances.length === 0 || distances.every(d => parseFloat(d.km) > 0);
  const step1Ok = !!name?.trim() && !!eventType && dateOk;
  const step2Ok = locationOk && distancesOk;
  // Step 3 : contact admin valide ET au moins un contact public (email valide,
  // telephone, ou site web). + code event en creation.
  const step3Ok = emailAdminFormat && emailOk && hasPublicContact && (isEdit || !!code?.trim());
  // Step 4 (PIN photographe) : 4 chiffres exactement, obligatoire en creation.
  // En edition, le PIN s'edite via le drill-down — etape inexistante dans le wizard.
  const step4Ok = isEdit || isValidPin(password);
  // Step 5 (cover) est toujours valide — la cover est optionnelle, le bouton
  // "Ajouter plus tard" passe directement à la soumission sans upload.
  const step5Ok = true;
  const canSubmit = step1Ok && step2Ok && step3Ok && step4Ok && step5Ok && !busy;

  const TOTAL_STEPS = isEdit ? 4 : 5;
  const goStep = (n) => {
    if (n < 1 || n > TOTAL_STEPS || !sheetW) { setStep(n); return; }
    setStep(n);
    Animated.timing(slideX, {
      toValue: -(n - 1) * sheetW,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };
  const tryNext = () => {
    if (step === 1) { if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); return; } goStep(2); return; }
    if (step === 2) { if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); return; } goStep(3); return; }
    if (step === 3) { if (!step3Ok) { setShowErr(e => ({ ...e, 3: true })); return; } goStep(4); return; }
    if (step === 4) { if (!step4Ok) { setShowErr(e => ({ ...e, 4: true })); return; } goStep(5); return; }
  };
  const trySubmit = () => {
    if (!step1Ok) { setShowErr(e => ({ ...e, 1: true })); goStep(1); return; }
    if (!step2Ok) { setShowErr(e => ({ ...e, 2: true })); goStep(2); return; }
    if (!step3Ok) { setShowErr(e => ({ ...e, 3: true })); goStep(3); return; }
    if (!step4Ok) { setShowErr(e => ({ ...e, 4: true })); goStep(4); return; }
    submit();
  };
  const errStyle = { color: C.error, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const url = isEdit ? `/organizer/event/${editEvent.code}` : `/auth/submit-event`;
      const method = isEdit ? 'PUT' : 'POST';
      const payload = {
        name,
        contact,
        contact_admin: contactAdmin.trim().toLowerCase(), // UI-12
        phone: phone.trim(),
        event_date: eventDate ? eventDate.toISOString().slice(0, 10) : '',
        event_date_end: eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : '',
        location: city ? `${city} (${postalCode})` : '',
        event_type: eventType,
        website,
        distances: distances
          .filter(d => d.km)
          .map(d => ({
            label: (d.label || '').trim().slice(0, 40),
            label_only: !!d.label_only,
            km: parseFloat(d.km) || 0,
            time: d.time || '',
            elevation: d.elevation || '',
          })),
      };
      if (!isEdit) {
        payload.code = code;
        payload.password = password;
      }
      // Audit B14b — O2 : /auth/submit-event peut etre appele sans organizerSession
      // (cf handlePickRole role='create'). apiFetch direct sans onAuthFailure,
      // Bearer conditionnel. Le 401 propage comme erreur HTTP normale.
      const r = await apiFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        Alert.alert('Erreur', data.error || 'Échec');
      } else {
        // Si création + cover en attente, on l'uploade maintenant — strictement
        // séquentiel (POST submit-event terminé avant PUT cover) pour éviter
        // les 404 "event introuvable".
        let coverFailed = false;
        if (!isEdit && pendingCoverLocal) {
          const slug = code.toLowerCase().replace(/\s+/g, '-');
          console.log('[create-event] starting cover upload', { slug, uri: pendingCoverLocal });
          try {
            const res = await fetch(pendingCoverLocal);
            const blob = await res.blob();
            console.log('[create-event] cover blob ready', { size: blob?.size, type: blob?.type });
            // Audit B14b — O3 : post-submit cover upload. Si le submit etait
            // anonyme (cf O2), organizerSession peut etre null. apiFetch direct
            // + Bearer conditionnel.
            const up = await apiFetch(`/organizer/cover/${slug}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'image/jpeg',
                ...(organizerSession?.token ? { Authorization: `Bearer ${organizerSession.token}` } : {}),
              },
              body: blob,
            });
            console.log('[create-event] cover upload result', up.status);
            if (!up.ok) {
              const txt = await up.text();
              console.warn('[create-event] cover upload failed', up.status, txt);
              coverFailed = true;
            }
          } catch (e) {
            console.warn('[create-event] cover upload error', e?.message || e);
            coverFailed = true;
          }
        }
        const successTitle = isEdit ? 'Modifications enregistrées' : 'Demande envoyée';
        const successMsg = isEdit ? '' : 'Ton événement sera validé sous peu.';
        if (coverFailed) {
          Alert.alert(
            successTitle,
            (successMsg ? successMsg + '\n\n' : '') +
              "L'image de couverture n'a pas pu être envoyée. Tu pourras la recharger depuis l'édition de l'événement."
          );
        } else {
          Alert.alert(successTitle, successMsg);
        }
        onCreated?.();
        onClose();
      }
    } catch (e) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBusy(false);
    }
  };

  const types = ['Trail', 'Course sur route', 'Cross', 'Triathlon', 'Velo', 'Marche', 'Autre'];

  // ───────────────── PICKERS COMMUNS (heure/denivele/km/crop/date) ─────────────────
  // Extraits en helper pour etre reutilises par le wizard (creation) et le
  // mode Settings (edition). Reference le scope local (state + setters).
  // Pickers Km/Heure/Denivele — rendus DANS la sub-modal Distances (mode
  // edition) ou DANS le Modal principal (mode creation/wizard) pour que les
  // pickers se presentent au-dessus de la modal parente sur iOS.
  const renderDistancePickers = () => (
    <>
      {/* Picker Heure */}
      <Modal visible={timePickerIdx !== null} transparent animationType="slide" onRequestClose={() => setTimePickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setTimePickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Heure de départ</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>HEURES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/^(\d{1,2})h(\d{2})?/);
                    const curH = m ? parseInt(m[1], 10) : -1;
                    const active = curH === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => {
                          const cur2 = distances[timePickerIdx]?.time || '';
                          const m2 = cur2.match(/h(\d{2})/);
                          const min = m2 ? m2[1] : '00';
                          updateDistance(timePickerIdx, 'time', `${h}h${min}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{h}h</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>MINUTES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const min = i * 5;
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/h(\d{2})/);
                    const curM = m ? parseInt(m[1], 10) : -1;
                    const active = curM === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => {
                          const cur2 = distances[timePickerIdx]?.time || '';
                          const m2 = cur2.match(/^(\d{1,2})h/);
                          const h = m2 ? m2[1] : '9';
                          updateDistance(timePickerIdx, 'time', `${h}h${String(min).padStart(2, '0')}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{String(min).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity onPress={() => setTimePickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Dénivelé */}
      <Modal visible={elevPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setElevPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setElevPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Dénivelé positif</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>Par incréments de 10 m</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 301 }).map((_, i) => {
                const m = i * 10;
                const cur = distances[elevPickerIdx]?.elevation || '';
                const curM = parseInt((cur.match(/(\d+)/) || [])[1], 10);
                const active = curM === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => updateDistance(elevPickerIdx, 'elevation', `${m}m D+`)}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{m} m</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setElevPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Distance (km) */}
      <Modal visible={kmPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setKmPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKmPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Distance</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>De 1 à 200 km</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const km = i + 1;
                const cur = distances[kmPickerIdx]?.km || '';
                const curKm = parseFloat(cur);
                const active = curKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    onPress={() => updateDistance(kmPickerIdx, 'km', String(km))}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setKmPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );

  // CropImageModal rendu separement (utilise par la cover de la home + le
  // wizard de creation). Pas besoin d'etre dans une sub-modal precise.
  const renderCropModal = () => (
    <CropImageModal
      visible={!!cropAsset}
      asset={cropAsset}
      onCancel={() => setCropAsset(null)}
      onConfirm={handleCropConfirm}
    />
  );

  // ───────────────── MODE EDITION : iOS Settings drill-down ─────────────────
  // Home page liste les sections (rows avec icone + valeur courante). Tap sur
  // une row ouvre une sous-modale dediee qui save uniquement le champ modifie
  // via PUT /organizer/event/:slug (whitelist worker existante).
  if (isEdit) {
    const sectionHeaderStyle = {
      color: 'rgba(123,47,255,0.3)', fontSize: 13, fontWeight: '700',
      letterSpacing: 0.6, textTransform: 'uppercase',
      marginBottom: 8, marginLeft: 32, marginTop: 24,
    };
    const sectionCardStyle = {
      backgroundColor: '#fff', borderRadius: 14,
      marginHorizontal: 16, overflow: 'hidden',
    };
    const rowStyle = {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14, minHeight: 48,
    };
    const rowSeparatorStyle = {
      height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(123,47,255,0.3)', marginLeft: 16,
    };
    const subModalHeader = {
      paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(123,47,255,0.3)',
      backgroundColor: '#fff',
    };
    const saveBtnStyle = {
      marginHorizontal: 16, marginBottom: 28,
      paddingVertical: 14, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center',
    };

    // Previews valeurs courantes pour la home
    const previewDate = eventDate
      ? formatDateForForm(
          eventDate.toISOString().slice(0, 10),
          eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : null,
        )
      : 'Non définie';
    const previewLocation = city
      ? (postalCode ? `${city} (${postalCode})` : city)
      : (editEvent?.location || 'Non défini');
    const previewDistances = distances.length === 0
      ? 'Aucune'
      : distances.map(d => d.km ? raceTitle(d) : '?').join(', ');

    // PUT partiel : met a jour uniquement les champs presents dans `patch`.
    const savePartial = async (patch) => {
      if (!editEvent?.code) return false;
      setPartialBusy(true);
      try {
        const r = await organizerApiFetch(`/organizer/event/${editEvent.code}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          Alert.alert('Erreur', data.error || 'Échec de la modification');
          return false;
        }
        onCreated?.();
        return true;
      } catch (e) {
        Alert.alert('Erreur', e.message || 'Erreur réseau');
        return false;
      } finally {
        setPartialBusy(false);
      }
    };

    const SettingsRow = ({ label, value, onPress }) => {
      return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={rowStyle}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '600', flex: 1 }}>{label}</Text>
          <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 14, marginRight: 8, maxWidth: 140 }} numberOfLines={1}>
            {value || '—'}
          </Text>
          <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 18, fontWeight: '300' }}>›</Text>
        </TouchableOpacity>
      );
    };

    return (
      <>
        <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="formSheet">
          <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
            {/* Header */}
            <View style={{
              paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: '#F2F2F7',
            }}>
              <View style={{ width: 32 }} />
              <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>
                Modifier l'événement
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 32, alignItems: 'flex-end' }}>
                <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
              {/* Cover 4:1 cliquable (ouvre le cropper via pickAndUploadCover) */}
              <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={pickAndUploadCover}
                  disabled={coverBusy}
                  activeOpacity={0.85}
                  style={{
                    aspectRatio: 4, borderRadius: 14, overflow: 'hidden',
                    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
                    borderWidth: (coverImage || pendingCoverLocal) ? 0 : 1,
                    borderStyle: 'dashed', borderColor: '#d9d4ec',
                  }}
                >
                  {coverBusy ? (
                    <ActivityIndicator color={C.primary} />
                  ) : (coverImage || pendingCoverLocal) ? (
                    <ExpoImage source={{ uri: pendingCoverLocal || coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  ) : (
                    <Text style={{ color: C.textSoft, fontSize: 13 }}>+ Ajouter une image de couverture</Text>
                  )}
                </TouchableOpacity>
                {(coverImage || pendingCoverLocal) && !coverBusy && (
                  <TouchableOpacity onPress={pickAndUploadCover} style={{ marginTop: 6 }}>
                    <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600', textAlign: 'right' }}>
                      Changer l'image
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ───── GÉNÉRAL ───── */}
              <Text style={sectionHeaderStyle}>GÉNÉRAL</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Nom" value={name} onPress={() => setEditingField('name')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Type d'épreuve" value={eventType ? displayEventType(eventType) : ''} onPress={() => setEditingField('type')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Date" value={previewDate} onPress={() => setEditingField('date')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Heure de départ" value={startTime || ''} onPress={() => setEditingField('start_time')} />
              </View>

              {/* ───── LIEU & CONTACT ───── */}
              <Text style={sectionHeaderStyle}>LIEU & CONTACT</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Lieu" value={previewLocation} onPress={() => setEditingField('location')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Téléphone" value={phone} onPress={() => setEditingField('phone')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Email contact" value={contact} onPress={() => setEditingField('email')} />
                <View style={rowSeparatorStyle} />
                <SettingsRow label="Site web" value={website} onPress={() => setEditingField('website')} />
              </View>

              {/* ───── DISTANCES ───── */}
              <Text style={sectionHeaderStyle}>DISTANCES</Text>
              <View style={sectionCardStyle}>
                <SettingsRow label="Distances proposées" value={previewDistances} onPress={() => setEditingField('distances')} />
              </View>

              {/* ───── CODE PIN PHOTOGRAPHE ───── */}
              {isEdit && (
                <>
                  <Text style={sectionHeaderStyle}>CODE PIN PHOTOGRAPHE</Text>
                  <Text style={{ paddingHorizontal: 28, marginBottom: 6, fontSize: 12, color: C.textSoft }}>
                    À transmettre à tes photographes le jour J
                  </Text>
                  <View style={sectionCardStyle}>
                    <View style={[rowStyle, { paddingVertical: 18, justifyContent: 'center' }]}>
                      <PinDisplay pin={photographerPwd} masked={!revealPwd} />
                    </View>
                    <View style={rowSeparatorStyle} />
                    <View style={[rowStyle, { gap: 0 }]}>
                      <TouchableOpacity onPress={() => setRevealPwd(v => !v)} disabled={!isValidPin(photographerPwd)} style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: isValidPin(photographerPwd) ? 1 : 0.4 }}>
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>{revealPwd ? 'Masquer' : 'Afficher'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={async () => {
                          if (!isValidPin(photographerPwd)) return;
                          // Pas de Clipboard natif (expo-clipboard pas installé) — on
                          // passe par Share qui propose Copier dans la share-sheet iOS.
                          try { await Share.share({ message: photographerPwd }); } catch {}
                        }}
                        disabled={!isValidPin(photographerPwd)}
                        style={{ flex: 1, alignItems: 'center', paddingVertical: 4, opacity: isValidPin(photographerPwd) ? 1 : 0.4 }}
                      >
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Copier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingField('photographer_password')} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>{isValidPin(photographerPwd) ? 'Modifier' : 'Définir'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* ───── FACTURATION ───── */}
                  <Text style={sectionHeaderStyle}>FACTURATION</Text>
                  <View style={sectionCardStyle}>
                    <View style={rowStyle}>
                      <Text style={{ color: C.text, fontSize: 16, fontWeight: '500', flex: 1 }}>
                        Offre partenaire gratuite
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
          {renderCropModal()}

          {/* ─── Sub-modal: Nom ─── */}
          <SubModalInputText
            visible={editingField === 'name'}
            title="Nom de l'événement"
            value={name}
            onChangeText={setName}
            placeholder="Ex : Trail des Violettes"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              if (!name?.trim()) { Alert.alert('Nom requis'); return; }
              const ok = await savePartial({ name: name.trim() });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Type d'épreuve (save immediat sur tap) ─── */}
          <Modal visible={editingField === 'type'} animationType="slide" onRequestClose={() => setEditingField(null)} presentationStyle="formSheet">
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={subModalHeader}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Type d'épreuve</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
                <View style={sectionCardStyle}>
                  {types.map((t, idx) => {
                    const active = eventType === t;
                    return (
                      <React.Fragment key={t}>
                        <TouchableOpacity
                          onPress={async () => {
                            setEventType(t);
                            const ok = await savePartial({ event_type: t });
                            if (ok) setEditingField(null);
                          }}
                          disabled={partialBusy}
                          style={[rowStyle, { paddingVertical: 16 }]}
                        >
                          <Text style={{ color: active ? C.primary : C.text, fontSize: 16, fontWeight: '500', flex: 1 }}>
                            {displayEventType(t)}
                          </Text>
                          {active && (
                            <Text style={{ color: C.primary, fontSize: 18, fontWeight: '700' }}>✓</Text>
                          )}
                        </TouchableOpacity>
                        {idx < types.length - 1 && <View style={rowSeparatorStyle} />}
                      </React.Fragment>
                    );
                  })}
                </View>
                {partialBusy && <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />}
              </ScrollView>
            </View>
          </Modal>

          {/* ─── Sub-modal: Date (plage start + end) ─── */}
          {/* Réutilise le CalendarRangeModal de la création : tap 2x le même jour
              pour un event 1 jour, sinon plage. Sauvegarde directe via savePartial
              à la confirmation (PUT { event_date, event_date_end }). */}
          <CalendarRangeModal
            visible={editingField === 'date'}
            onClose={() => setEditingField(null)}
            initialStart={eventDate}
            initialEnd={eventDateEnd}
            minDate={null}
            onConfirm={async (start, end) => {
              setEventDate(start);
              setEventDateEnd(end);
              const startStr = start ? start.toISOString().slice(0, 10) : '';
              const endStr = end ? end.toISOString().slice(0, 10) : '';
              if (!startStr) { Alert.alert('Date requise'); return; }
              await savePartial({ event_date: startStr, event_date_end: endStr });
            }}
          />

          {/* ─── Sub-modal: Heure de départ (time picker) ─── */}
          <Modal visible={editingField === 'start_time'} animationType="slide" onRequestClose={() => setEditingField(null)} presentationStyle="formSheet">
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={subModalHeader}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Heure de départ</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingTop: 16 }}>
                <DateTimePicker
                  value={(() => {
                    const m = String(startTime || '').match(/^(\d{1,2}):(\d{2})$/);
                    const d = new Date();
                    if (m) { d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0); }
                    else { d.setHours(8, 0, 0, 0); }
                    return d;
                  })()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, selected) => {
                    if (!selected) return;
                    const hh = String(selected.getHours()).padStart(2, '0');
                    const mm = String(selected.getMinutes()).padStart(2, '0');
                    setStartTime(`${hh}:${mm}`);
                  }}
                  locale="fr-FR"
                  is24Hour
                  style={{ width: 320 }}
                />
              </View>
              <TouchableOpacity
                onPress={async () => {
                  if (!/^\d{1,2}:\d{2}$/.test(startTime)) { Alert.alert('Format invalide', 'Heure attendue HH:MM'); return; }
                  const ok = await savePartial({ start_time: startTime });
                  if (ok) setEditingField(null);
                }}
                disabled={partialBusy}
                style={[saveBtnStyle, { opacity: partialBusy ? 0.6 : 1 }]}
              >
                {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </Modal>

          {/* ─── Sub-modal: Code PIN photographe (4 chiffres) ─── */}
          <Modal visible={editingField === 'photographer_password'} animationType="slide" transparent onRequestClose={() => setEditingField(null)}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <TouchableOpacity activeOpacity={1} onPress={() => setEditingField(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }}>
                <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderRadius: 18, padding: 24 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 4 }}>Code PIN photographe</Text>
                  <Text style={{ fontSize: 13, color: C.textSoft, marginBottom: 22, lineHeight: 18 }}>
                    4 chiffres à transmettre à tes photographes le jour J.
                  </Text>
                  <PinInputRow
                    value={photographerPwd}
                    onChange={setPhotographerPwd}
                    autoFocus
                  />
                  <TouchableOpacity
                    onPress={() => setPhotographerPwd(generateRandomPin())}
                    style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8 }}
                  >
                    <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Générer aléatoirement</Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
                    <TouchableOpacity
                      onPress={() => setEditingField(null)}
                      style={{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.primary, fontSize: 14, fontWeight: '700' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        if (!isValidPin(photographerPwd)) { Alert.alert('Code PIN', 'Le code PIN doit être composé de 4 chiffres.'); return; }
                        const ok = await savePartial({ photographer_password: photographerPwd });
                        if (ok) { setEditingField(null); setRevealPwd(false); }
                      }}
                      disabled={!isValidPin(photographerPwd) || partialBusy}
                      style={{
                        flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
                        backgroundColor: isValidPin(photographerPwd) ? C.primary : '#e9e4f9',
                        opacity: partialBusy ? 0.6 : 1,
                      }}
                    >
                      {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: isValidPin(photographerPwd) ? '#fff' : C.textSoft, fontSize: 14, fontWeight: '700' }}>Confirmer</Text>}
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          </Modal>

          {/* ─── Sub-modal: Lieu (postalCode + city) ─── */}
          <Modal visible={editingField === 'location'} animationType="slide" onRequestClose={() => setEditingField(null)}>
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={[subModalHeader, { paddingTop: 56 }]}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Lieu</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
                <Text style={sectionHeaderStyle}>CODE POSTAL</Text>
                <View style={sectionCardStyle}>
                  <TextInput
                    value={postalCode}
                    onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); if (v !== postalCode) setCity(''); }}
                    keyboardType="number-pad"
                    maxLength={5}
                    placeholder="75001"
                    placeholderTextColor="#9CA3AF"
                    style={{ paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: C.text }}
                  />
                </View>
                <Text style={sectionHeaderStyle}>VILLE</Text>
                {cityFetchFailed && (
                  <Text style={{ color: C.textSoft, fontSize: 12, marginHorizontal: 32, marginBottom: 6 }}>
                    Recherche de villes indisponible. Saisis ta ville manuellement.
                  </Text>
                )}
                <View style={sectionCardStyle}>
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    placeholder="Paris"
                    placeholderTextColor="#9CA3AF"
                    style={{ paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: C.text }}
                  />
                </View>
                {citySuggestions.length > 0 && !city && (
                  <View style={[sectionCardStyle, { marginTop: 8 }]}>
                    {citySuggestions.slice(0, 6).map((c, idx, arr) => (
                      <React.Fragment key={c}>
                        <TouchableOpacity onPress={() => { setCity(c); setCitySuggestions([]); }} style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
                          <Text style={{ color: C.primary, fontSize: 15 }}>{c}</Text>
                        </TouchableOpacity>
                        {idx < arr.length - 1 && <View style={rowSeparatorStyle} />}
                      </React.Fragment>
                    ))}
                  </View>
                )}
                <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 12, marginHorizontal: 32 }}>
                  Format suggéré : Ville (Département)
                </Text>
              </ScrollView>
              <View style={{ paddingBottom: editKbHeight }}>
                <TouchableOpacity
                  onPress={async () => {
                    if (!city?.trim()) { Alert.alert('Ville requise'); return; }
                    const loc = postalCode ? `${city} (${postalCode})` : city;
                    const ok = await savePartial({ location: loc });
                    if (ok) setEditingField(null);
                  }}
                  disabled={partialBusy}
                  style={[saveBtnStyle, { marginBottom: editKbHeight > 0 ? 12 : 28, opacity: partialBusy ? 0.6 : 1 }]}
                >
                  {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* ─── Sub-modal: Téléphone ─── */}
          <SubModalInputText
            visible={editingField === 'phone'}
            title="Téléphone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="06 12 34 56 78"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              const v = (phone || '').trim();
              if (v) {
                const digits = v.replace(/[\s.\-]/g, '');
                if (!/^(\+33\d{9}|0\d{9}|\+?\d{10,15})$/.test(digits)) {
                  Alert.alert('Téléphone invalide', 'Format attendu : 06 12 34 56 78 ou +33...');
                  return;
                }
              }
              const ok = await savePartial({ phone: v });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Email ─── */}
          <SubModalInputText
            visible={editingField === 'email'}
            title="Email contact"
            value={contact}
            onChangeText={setContact}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="contact@event.com"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              if (!emailOk) { Alert.alert('Email invalide'); return; }
              const ok = await savePartial({ contact: contact.trim() });
              if (ok) setEditingField(null);
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Site web ─── */}
          <SubModalInputText
            visible={editingField === 'website'}
            title="Site web"
            value={website}
            onChangeText={setWebsite}
            keyboardType="url"
            autoCapitalize="none"
            placeholder="traildesviolettes.fr"
            onClose={() => setEditingField(null)}
            onSave={async () => {
              let v = (website || '').trim();
              if (v && !/^https?:\/\//.test(v)) v = `https://${v}`;
              const ok = await savePartial({ website: v });
              if (ok) {
                setWebsite(v);
                setEditingField(null);
              }
            }}
            busy={partialBusy}
          />

          {/* ─── Sub-modal: Distances ─── */}
          <Modal visible={editingField === 'distances'} animationType="slide" onRequestClose={() => setEditingField(null)}>
            <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
              <View style={[subModalHeader, { paddingTop: 56 }]}>
                <View style={{ width: 60 }} />
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Distances</Text>
                <TouchableOpacity onPress={() => setEditingField(null)} hitSlop={12} style={{ width: 60, alignItems: 'flex-end' }}>
                  <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingBottom: 32, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
                {distances.map((d, idx) => (
                  <View key={idx} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                      <TouchableOpacity onPress={() => setDistanceMode(idx, false)} style={modeChipStyleApp(!d.label_only)}>
                        <Text style={modeChipTextStyleApp(!d.label_only)}>Type d'épreuve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setDistanceMode(idx, true)} style={modeChipStyleApp(!!d.label_only)}>
                        <Text style={modeChipTextStyleApp(!!d.label_only)}>Nom personnalisé</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ marginBottom: 8 }}>
                      <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>{d.label_only ? 'NOM' : 'TYPE'}</Text>
                      <TextInput
                        value={d.label}
                        onChangeText={(v) => updateDistance(idx, 'label', v.slice(0, 40))}
                        placeholder={d.label_only ? 'Nom de la course' : (eventType || 'Type')}
                        placeholderTextColor="rgba(123,47,255,0.3)"
                        maxLength={40}
                        style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', paddingHorizontal: 12, color: C.text, fontSize: 14 }}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DISTANCE</Text>
                        <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.km ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.km ? `${d.km} km` : '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉPART</Text>
                        <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.time ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.time || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flex: 1.2 }}>
                        <Text style={{ color: 'rgba(123,47,255,0.3)', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 }}>DÉNIVELÉ</Text>
                        <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={{ height: 38, borderRadius: 8, backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: d.elevation ? C.text : 'rgba(123,47,255,0.3)', fontSize: 14 }}>{d.elevation || '—'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 8 }}>
                      <Text style={{ color: C.error, fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity onPress={addDistance} style={{ paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: '#fff', marginTop: 4 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 15 }}>+ Ajouter une distance</Text>
                </TouchableOpacity>
              </ScrollView>
              <View style={{ paddingBottom: editKbHeight }}>
                <TouchableOpacity
                  onPress={async () => {
                    const cleaned = distances.filter(d => d.km).map(d => ({
                      label: (d.label || '').trim().slice(0, 40),
                      label_only: !!d.label_only,
                      km: parseFloat(d.km) || 0,
                      time: d.time || '',
                      elevation: d.elevation || '',
                    }));
                    if (cleaned.length === 0) { Alert.alert('Au moins une distance requise'); return; }
                    if (!cleaned.every(d => d.km > 0)) { Alert.alert('Distance > 0 requise pour chaque course'); return; }
                    const ok = await savePartial({ distances: cleaned });
                    if (ok) setEditingField(null);
                  }}
                  disabled={partialBusy}
                  style={[saveBtnStyle, { marginBottom: editKbHeight > 0 ? 12 : 28, opacity: partialBusy ? 0.6 : 1 }]}
                >
                  {partialBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Enregistrer</Text>}
                </TouchableOpacity>
              </View>
            </View>
            {/* Pickers Km/Heure/Denivele rendus DANS la sub-modal Distances
                pour qu'ils s'affichent au-dessus d'elle (iOS z-order). */}
            {renderDistancePickers()}
          </Modal>
        </Modal>
      </>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity activeOpacity={1} style={s.modalBackdrop} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={[s.modalSheet, { maxHeight: '90%' }]} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>
            {/* Header : titre + étape */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>{isEdit ? 'Modifier l\'événement' : 'Créer un événement'}</Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginTop: 2 }}>Étape {step} sur {TOTAL_STEPS}</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: C.textSoft, fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Barre de progression */}
            <View style={{ height: 4, backgroundColor: '#e9e4f9', borderRadius: 2, marginBottom: 14 }}>
              <View style={{ height: 4, width: `${(step / TOTAL_STEPS) * 100}%`, backgroundColor: C.primary, borderRadius: 2 }} />
            </View>

            {/* Wizard slide */}
            <View
              style={{ overflow: 'hidden' }}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w && w !== sheetW) {
                  setSheetW(w);
                  slideX.setValue(-(step - 1) * w);
                }
              }}
            >
              <Animated.View style={{ flexDirection: 'row', width: sheetW * TOTAL_STEPS, transform: [{ translateX: slideX }] }}>

                {/* ===== STEP 1 : Identité ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Nom de l'événement *</Text>
                    <TextInput placeholder="Ex : Trail des Violettes" placeholderTextColor={C.textSoft} value={name} onChangeText={setName} style={formSectionStyle.input} />
                    {showErr[1] && !name?.trim() && <Text style={errStyle}>Champ requis</Text>}

                    <Text style={formSectionStyle.heading}>Type d'épreuve *</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {types.map(t => (
                        <TouchableOpacity key={t} onPress={() => setEventType(t)} style={[s.typePill, eventType === t && { backgroundColor: colorForType(t) }]}>
                          <Text style={[s.typePillText, eventType === t && { color: '#fff' }]}>{displayEventType(t)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {showErr[1] && !eventType && <Text style={errStyle}>Sélectionne un type</Text>}

                    <Text style={formSectionStyle.heading}>Date(s) de l'événement *</Text>
                    <TouchableOpacity
                      onPress={() => setShowCalendar(true)}
                      style={[formSectionStyle.input, { justifyContent: 'center' }]}
                    >
                      <Text style={{ color: eventDate ? C.text : C.textSoft, fontSize: 15 }}>
                        {eventDate
                          ? formatDateForForm(
                              eventDate.toISOString().slice(0, 10),
                              eventDateEnd ? eventDateEnd.toISOString().slice(0, 10) : null,
                            )
                          : 'Choisir une date (ou une plage)'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: C.textSoft, fontSize: 11, marginTop: -4, marginBottom: 8, marginLeft: 4 }}>
                      Tape 2 fois la même date pour un événement sur 1 jour.
                    </Text>
                    {showErr[1] && !dateOk && <Text style={errStyle}>Date requise (pas dans le passé)</Text>}
                  </ScrollView>
                </View>

                {/* ===== STEP 2 : Lieu + Courses ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Lieu</Text>
                    <TextInput
                      placeholder="Code postal *"
                      placeholderTextColor={C.textSoft}
                      value={postalCode}
                      onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                      keyboardType="number-pad"
                      maxLength={5}
                      style={formSectionStyle.input}
                    />
                    {showErr[2] && !/^\d{5}$/.test(postalCode) && <Text style={errStyle}>5 chiffres requis</Text>}
                    {cityFetchFailed && !city && (
                      <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 8, marginLeft: 4 }}>
                        Recherche de villes indisponible. Saisis ta ville manuellement.
                      </Text>
                    )}
                    {citySuggestions.length > 0 && !city && (
                      <ScrollView
                        style={{ maxHeight: 140, marginBottom: 8, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                        keyboardShouldPersistTaps="handled"
                      >
                        {citySuggestions.map((c) => (
                          <TouchableOpacity
                            key={c}
                            onPress={() => { setCity(c); setCitySuggestions([]); }}
                            style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9e4f9' }}
                          >
                            <Text style={{ color: C.text, fontSize: 14 }}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                    {city ? (
                      <TouchableOpacity
                        onPress={() => setCity('')}
                        style={[formSectionStyle.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                      >
                        <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                        <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                      </TouchableOpacity>
                    ) : null}
                    {showErr[2] && !city?.trim() && <Text style={errStyle}>Ville requise</Text>}

                    <Text style={formSectionStyle.heading}>Courses</Text>
                    {distances.map((d, idx) => (
                      <View key={idx} style={{ backgroundColor: '#faf9ff', borderRadius: 12, padding: 10, marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                          <TouchableOpacity onPress={() => setDistanceMode(idx, false)} style={modeChipStyleApp(!d.label_only)}>
                            <Text style={modeChipTextStyleApp(!d.label_only)}>Type d'épreuve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setDistanceMode(idx, true)} style={modeChipStyleApp(!!d.label_only)}>
                            <Text style={modeChipTextStyleApp(!!d.label_only)}>Nom personnalisé</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={{ marginBottom: 8 }}>
                          <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>{d.label_only ? 'NOM' : 'TYPE'}</Text>
                          <TextInput
                            value={d.label}
                            onChangeText={(v) => updateDistance(idx, 'label', v.slice(0, 40))}
                            placeholder={d.label_only ? 'Nom de la course' : (eventType || 'Type')}
                            placeholderTextColor={C.textSoft}
                            maxLength={40}
                            style={[formSectionStyle.input, { marginBottom: 0 }]}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DISTANCE</Text>
                            <TouchableOpacity onPress={() => setKmPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.km ? C.text : C.textSoft, fontSize: 15 }}>{d.km ? `${d.km} km` : '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉPART</Text>
                            <TouchableOpacity onPress={() => setTimePickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.time ? C.text : C.textSoft, fontSize: 15 }}>{d.time || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ flex: 1.2 }}>
                            <Text style={{ color: C.textSoft, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4, marginLeft: 4 }}>DÉNIVELÉ</Text>
                            <TouchableOpacity onPress={() => setElevPickerIdx(idx)} style={[formSectionStyle.input, { marginBottom: 0, justifyContent: 'center' }]}>
                              <Text style={{ color: d.elevation ? C.text : C.textSoft, fontSize: 15 }}>{d.elevation || '—'}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <TouchableOpacity onPress={() => removeDistance(idx)} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
                          <Text style={{ color: C.error, fontSize: 12, fontWeight: '600' }}>Supprimer</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      onPress={addDistance}
                      style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 12, backgroundColor: '#f5f3ff', marginBottom: 8 }}
                    >
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>+ Ajouter une course</Text>
                    </TouchableOpacity>
                    {showErr[2] && distances.length > 0 && !distances.every(d => parseFloat(d.km) > 0) && (
                      <Text style={errStyle}>Distance &gt; 0 requise pour chaque course</Text>
                    )}
                  </ScrollView>
                </View>

                {/* ===== STEP 3 : Contact (UI-12 : 2 sections admin/public) ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Contact administratif</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 11, marginTop: -8, marginBottom: 8, marginLeft: 4, lineHeight: 16 }]}>
                      Email interne pour la validation de ton event et les messages d'admin Will. NON affiché publiquement.
                    </Text>
                    <TextInput placeholder="Email administratif *" placeholderTextColor={C.textSoft} value={contactAdmin} onChangeText={setContactAdmin} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    {showErr[3] && !emailAdminFormat && <Text style={errStyle}>Email administratif invalide</Text>}

                    <Text style={[formSectionStyle.heading, { marginTop: 12 }]}>Contact public</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 11, marginTop: -8, marginBottom: 8, marginLeft: 4, lineHeight: 16 }]}>
                      Au moins UNE info parmi email, téléphone et site web. Affichées sur la page publique de ton événement.
                    </Text>
                    <TextInput placeholder="Email de contact public" placeholderTextColor={C.textSoft} value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" style={formSectionStyle.input} />
                    {showErr[3] && contact?.trim() && !emailPublicFormat && <Text style={errStyle}>Email public invalide</Text>}
                    <TextInput placeholder="Téléphone" placeholderTextColor={C.textSoft} value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={formSectionStyle.input} />
                    <TextInput placeholder="Site web" placeholderTextColor={C.textSoft} value={website} onChangeText={setWebsite} autoCapitalize="none" style={formSectionStyle.input} />
                    {showErr[3] && !hasPublicContact && <Text style={errStyle}>Renseigne au moins une info de contact public.</Text>}
                  </ScrollView>
                </View>

                {/* ===== STEP 4 : Code PIN photographe ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Code PIN photographe</Text>
                    <Text style={[formSectionStyle.subheading, { fontSize: 13, marginBottom: 22, marginLeft: 4, lineHeight: 18 }]}>
                      4 chiffres à transmettre à tes photographes le jour J. Ils l'utiliseront pour se connecter à ton event sur l'app Will.
                    </Text>
                    {!isEdit && (
                      <>
                        <PinInputRow
                          value={password}
                          onChange={setPassword}
                          autoFocus={false}
                          focusTrigger={step === 4 ? 1 : 0}
                          error={showErr[4] && !isValidPin(password)}
                        />
                        <TouchableOpacity
                          onPress={() => setPassword(generateRandomPin())}
                          style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 14 }}
                        >
                          <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600' }}>Générer aléatoirement</Text>
                        </TouchableOpacity>
                        {showErr[4] && !isValidPin(password) && (
                          <Text style={[errStyle, { textAlign: 'center', marginTop: 6 }]}>Le code PIN doit être composé de 4 chiffres</Text>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>

                {/* ===== STEP 5 : Cover image (skippable) ===== */}
                <View style={{ width: sheetW }}>
                  <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={true} persistentScrollbar={true}>
                    <Text style={formSectionStyle.heading}>Image de couverture</Text>
                    <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 10, marginLeft: 4, lineHeight: 17 }}>
                      Cette image sera affichée sur la page de ton event et dans l'app coureur. Format paysage 16:9 recommandé.
                    </Text>
                    <TouchableOpacity
                      onPress={pickAndUploadCover}
                      disabled={coverBusy}
                      style={{
                        height: 160, borderRadius: 12, backgroundColor: '#faf9ff', marginBottom: 8,
                        overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
                        borderWidth: (coverImage || pendingCoverLocal) ? 0 : 1, borderStyle: 'dashed', borderColor: '#d9d4ec',
                      }}
                    >
                      {coverBusy ? (
                        <ActivityIndicator color={C.primary} />
                      ) : (coverImage || pendingCoverLocal) ? (
                        <ExpoImage source={{ uri: pendingCoverLocal || coverImage }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                      ) : (
                        <>
                          <Text style={{ color: C.primary, fontSize: 14, fontWeight: '600', marginBottom: 4 }}>+ Choisir une image</Text>
                          <Text style={{ color: C.textSoft, fontSize: 11 }}>Depuis ta galerie</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {(coverImage || pendingCoverLocal) && !coverBusy && (
                      <TouchableOpacity onPress={pickAndUploadCover} style={{ alignSelf: 'flex-end', marginTop: -4, marginBottom: 8 }}>
                        <Text style={{ color: C.primary, fontSize: 12, fontWeight: '600' }}>Changer l'image</Text>
                      </TouchableOpacity>
                    )}
                    {!(coverImage || pendingCoverLocal) && (
                      <Text style={{ color: C.textSoft, fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 17 }}>
                        Pas de visuel sous la main ? Tu peux ajouter l'image plus tard depuis l'édition de ton event.
                      </Text>
                    )}
                  </ScrollView>
                </View>

              </Animated.View>
            </View>

            {/* Bottom nav : Précédent / Suivant ou Soumettre / Ajouter plus tard */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              {step > 1 && (
                <TouchableOpacity
                  onPress={() => goStep(step - 1)}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                >
                  <Text style={{ color: C.primary, fontSize: 15, fontWeight: '700' }}>Précédent</Text>
                </TouchableOpacity>
              )}
              {step < TOTAL_STEPS ? (
                <TouchableOpacity
                  onPress={tryNext}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Suivant</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={trySubmit}
                  disabled={busy}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: C.pinkPill, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      {isEdit
                        ? 'Enregistrer'
                        : (coverImage || pendingCoverLocal) ? 'Soumettre' : 'Ajouter plus tard'}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>

      {/* Calendrier custom (range) — remplace le DateTimePicker natif iOS */}
      <CalendarRangeModal
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
        initialStart={eventDate}
        initialEnd={eventDateEnd}
        minDate={(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()}
        onConfirm={(start, end) => {
          setEventDate(start);
          setEventDateEnd(end);
        }}
      />

      {/* Picker Heure */}
      <Modal visible={timePickerIdx !== null} transparent animationType="slide" onRequestClose={() => setTimePickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setTimePickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Heure de départ</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>HEURES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/^(\d{1,2})h(\d{2})?/);
                    const curH = m ? parseInt(m[1], 10) : -1;
                    const active = curH === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/h(\d{2})/);
                          const min = m2 ? m2[1] : '00';
                          updateDistance(timePickerIdx, 'time', `${h}h${min}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{h}h</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 6 }}>MINUTES</Text>
                <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  {Array.from({ length: 12 }).map((_, i) => {
                    const min = i * 5;
                    const cur = distances[timePickerIdx]?.time || '';
                    const m = cur.match(/h(\d{2})/);
                    const curM = m ? parseInt(m[1], 10) : -1;
                    const active = curM === min;
                    return (
                      <TouchableOpacity
                        key={min}
                        onPress={() => {
                          const cur = distances[timePickerIdx]?.time || '';
                          const m2 = cur.match(/^(\d{1,2})h/);
                          const h = m2 ? m2[1] : '9';
                          updateDistance(timePickerIdx, 'time', `${h}h${String(min).padStart(2, '0')}`);
                        }}
                        style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                      >
                        <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{String(min).padStart(2, '0')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
            <TouchableOpacity onPress={() => setTimePickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Dénivelé */}
      <Modal visible={elevPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setElevPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setElevPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Dénivelé positif</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>Par incréments de 10 m</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 301 }).map((_, i) => {
                const m = i * 10;
                const cur = distances[elevPickerIdx]?.elevation || '';
                const curM = parseInt((cur.match(/(\d+)/) || [])[1], 10);
                const active = curM === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => {
                      updateDistance(elevPickerIdx, 'elevation', `${m}m D+`);
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{m} m</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setElevPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Picker Distance (km) */}
      <Modal visible={kmPickerIdx !== null} transparent animationType="slide" onRequestClose={() => setKmPickerIdx(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKmPickerIdx(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 16, paddingBottom: 36 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>Distance</Text>
            <Text style={{ color: C.textSoft, fontSize: 11, textAlign: 'center', marginBottom: 12 }}>De 1 à 200 km</Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {Array.from({ length: 200 }).map((_, i) => {
                const km = i + 1;
                const cur = distances[kmPickerIdx]?.km || '';
                const curKm = parseFloat(cur);
                const active = curKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    onPress={() => {
                      updateDistance(kmPickerIdx, 'km', String(km));
                    }}
                    style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: active ? C.pinkPill : 'transparent', marginBottom: 2 }}
                  >
                    <Text style={{ color: active ? '#fff' : C.text, fontWeight: '600', fontSize: 16 }}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setKmPickerIdx(null)} style={{ marginTop: 14, marginHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CropImageModal
        visible={!!cropAsset}
        asset={cropAsset}
        onCancel={() => setCropAsset(null)}
        onConfirm={handleCropConfirm}
      />
    </Modal>
  );
}
