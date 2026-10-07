// Modal login organisateur ou photographe.
//
// Photographe : selection event (liste upcoming) + PIN 4 chiffres avec
//   numpad custom + auto-submit a la 4eme touche + shake animation sur
//   erreur + compteur tentatives (3 avant rate-limit).
//
// Organisateur : code event + mot de passe + "Mot de passe oublie"
//   qui ouvre un flow reset (request -> verify avec code email 6 chiffres).
//
// Design : ALIGNE sur AuthRunnerModal (decision user 2026-08-31,
// uniformisation des ecrans de connexion) — fullscreen blanc, croix en
// haut a gauche, titre AVEstiana violet, tout en violet (rose abandonne).

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Alert, Platform, StatusBar,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C, colorForType } from '../../constants/colors';
import { s } from '../../constants/styles';
import { formSectionStyle } from '../../constants/formStyles';
import { API_URL } from '../../constants/api';
import { api } from '../../services/api';
import { formatDateLong, cityLabel, isUpcoming } from '../../utils/format';
import { PinInputRow } from '../PinInputRow';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lh } from '../../constants/typo';

export function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const insets = useSafeAreaInsets();
  // Dans une Modal RN, insets.top peut revenir a 0 (Android) : garde-fou.
  const padHaut = (insets.top || StatusBar.currentHeight || 20) + 12;
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Reset flow (organisateur uniquement) : 'login' -> 'reset-request' -> 'reset-verify'
  const [resetMode, setResetMode] = useState('login');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  // PIN error UI (photographe) : shake + message inline. Plus de compteur
  // tentatives ni de rate limit : le worker accepte les tentatives illimitees
  // depuis 2026-06-27 (cf worker fix(auth) c1942d3).
  const [pinError, setPinError] = useState('');
  const [pinErrorTick, setPinErrorTick] = useState(0);
  // Search : filtre client-side de la liste upcoming par nom/lieu.
  // Cohere avec le search dashboard PhotographerEventList.js.
  const [searchQuery, setSearchQuery] = useState('');
  // Saisie directe d un code event : couvre les events non listes
  // (listed:false) qui ne sortent pas de /public-events. Le worker
  // handleLoginEvent ne filtre pas sur listed, seule active=true est
  // requise. Cohere avec la meme fonctionnalite cote dashboard.
  const [codeInput, setCodeInput] = useState('');
  // Event non liste fetche par /public-events/{code} quand la searchQuery
  // matche un code exact (typiquement `test` permanent). Bypass le filtre
  // isUpcoming : intention explicite = code exact.
  const [searchExtra, setSearchExtra] = useState(null);
  // Chemin "code direct", independant de la liste (modele du site). L'event
  // resolu par code y est stocke a part : il n'a aucune raison de figurer dans
  // upcoming, puisque justement il n'est pas liste.
  const [manualEvent, setManualEvent] = useState(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  useEffect(() => {
    if (visible) {
      setCode(''); setPassword('');
      setResetMode('login'); setResetCode(''); setResetNewPassword('');
      setPinError('');
      setSearchQuery(''); setCodeInput('');
      setSearchExtra(null);
      setManualEvent(null); setCodeLoading(false); setCodeError('');
    }
  }, [visible]);

  // Tri ASC strict (decision user 2026-06-04, toutes les listes d events).
  //
  // Declare AVANT l'effet de fetch ci-dessous, qui le lit et l'a en dependance.
  // useMemo est obligatoire : .filter().sort() renvoie un NOUVEAU tableau a
  // chaque rendu, donc sans memoisation la dependance change systematiquement.
  // L'effet se relancait alors a chaque rendu et, comme il appelle
  // setSearchExtra avec un objet frais, il se re-declenchait lui-meme -> un
  // fetch toutes les 250 ms sans jamais se stabiliser.
  const upcoming = useMemo(
    () => events
      .filter(e => isUpcoming(e.event_date, e.event_date_end))
      .sort((a, b) => {
        const da = a.event_date || '';
        const db = b.event_date || '';
        // Sans date ("Date a venir") : en fin de liste — '' < toute date,
        // le tri lexicographique seul les remonterait en tete.
        if (!da !== !db) return da ? -1 : 1;
        if (!da && !db) return (a.name || '').localeCompare(b.name || '');
        return da.localeCompare(db);
      }),
    [events],
  );

  // Fetch on-demand par code exact pour reach les events non listes.
  // Debounce 250ms + guard cleanup pour eviter setState post-unmount.
  useEffect(() => {
    const raw = searchQuery.trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw || !/^[a-z0-9-]+$/.test(raw)) { setSearchExtra(null); return; }
    if (upcoming.some(e => e.code === raw)) { setSearchExtra(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`${API_URL}/public-events/${encodeURIComponent(raw)}`)
        .then(r => r.ok ? r.json() : null)
        .then(ev => { if (!cancelled) setSearchExtra(ev && ev.code ? ev : null); })
        .catch(() => { if (!cancelled) setSearchExtra(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchQuery, upcoming]);

  // Normalise pour comparaison accent/case-insensitive.
  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const upcomingSearched = searchQuery.trim()
    ? (() => {
        const q = normalize(searchQuery.trim());
        const base = upcoming.filter(e =>
          normalize(e.name).includes(q)
          || normalize(e.location).includes(q)
          || normalize(e.code).includes(q)
        );
        // Injection searchExtra : bypass isUpcoming filter, unshift si match.
        if (searchExtra && searchExtra.code && !base.some(e => e.code === searchExtra.code)) {
          const matches = normalize(searchExtra.name || '').includes(q)
            || normalize(searchExtra.location || '').includes(q)
            || normalize(searchExtra.code).includes(q);
          if (matches) base.unshift(searchExtra);
        }
        return base;
      })()
    : upcoming;

  const doLogin = async (pwdOverride) => {
    const pwd = (pwdOverride ?? password).trim();
    if (!code) return Alert.alert('Événement requis', role === 'photographer' ? 'Choisis un événement.' : 'Entre le code.');
    if (!pwd) {
      if (role === 'photographer') setPinError('Code PIN requis');
      else Alert.alert('Mot de passe requis');
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(code.trim(), pwd, role, 'photographer');
      setBusy(false);
      if (!r?.token) {
        if (role === 'photographer') {
          setPinError('Code PIN incorrect');
          setPinErrorTick(t => t + 1);
          setPassword('');
        } else {
          Alert.alert('Échec', 'Identifiants invalides.');
        }
        return;
      }
      onSuccess(r);
    } catch {
      setBusy(false);
      if (role === 'photographer') {
        setPinError('Hors ligne');
        setPinErrorTick(t => t + 1);
      } else {
        Alert.alert(
          'Hors ligne',
          'Première connexion impossible sans réseau. Connecte-toi en wifi pour activer ton événement — ensuite l\'app fonctionnera offline.',
        );
      }
    }
  };
  const submit = () => doLogin();

  const requestReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!slug) return Alert.alert('Code requis', 'Saisis le code de ton événement avant de demander un reset.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/request-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data.error || 'Impossible d\'envoyer le code.');
        return;
      }
      setResetMode('reset-verify');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  const verifyReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!resetCode.trim()) return Alert.alert('Code requis', 'Saisis le code reçu par email.');
    if (!resetNewPassword || resetNewPassword.length < 4) return Alert.alert('Mot de passe trop court', '4 caractères minimum.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/verify-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug, reset_code: resetCode.trim(), new_password: resetNewPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Échec', data.error || 'Code invalide.');
        return;
      }
      setPassword(resetNewPassword);
      setResetMode('login');
      setResetCode(''); setResetNewPassword('');
      Alert.alert('Mot de passe réinitialisé', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <LinearGradient
          colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 24, paddingTop: padHaut, paddingBottom: 24 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'Montserrat', color: '#4a4458', fontSize: 22, lineHeight: lh(22, 24, 'Montserrat') }}>✕</Text>
            </TouchableOpacity>
            {/* Le logo manquait a l appel sur les ecrans d entree : c est
                pourtant la qu il compte, quand on ne sait pas encore ou on
                est. Centre sur la rangee, la croix restant a gauche. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, alignItems: 'center' }}>
              <Icon.Logo width={64} color="#fff" />
            </View>
          </View>
          <Text style={{
            fontFamily: 'AVEstiana', fontStyle: 'normal',
            fontSize: 30, color: '#fff', textAlign: 'center', marginBottom: 8,
          }}>
            {role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}
          </Text>
          <Text style={{ fontFamily: 'Montserrat', color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center' }}>
            {role === 'photographer' ? 'Sélectionne ton événement et entre ton code PIN' : 'Connecte-toi à ton événement'}
          </Text>
        </LinearGradient>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={{ backgroundColor: '#ffffff' }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 20, paddingBottom: 44 + insets.bottom }}
          >

            {role === 'photographer' ? (
              <>
                <Text style={{ fontSize: 15, fontFamily: 'Montserrat-Medium', color: '#3F3F46', marginBottom: 7 }}>Événement</Text>
                {/* Search : filtre client. Masque quand un code est deja
                    selectionne (la liste se reduit alors a l event actif
                    et le PIN a la main, search inutile). */}
                {!code && (
                  <View style={{
                    borderRadius: 14,
                    backgroundColor: '#F5F3FA',
                    marginBottom: 10,
                    overflow: 'hidden',
                  }}>
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Rechercher un event"
                      placeholderTextColor="#A89CB8"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ fontFamily: 'Montserrat',
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                        fontSize: 14,
                        color: '#221c30',
                      }}
                    />
                    <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.06)' }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput
                        value={codeInput}
                        onChangeText={(v) => { setCodeInput(v); if (codeError) setCodeError(''); }}
                        placeholder="Code event"
                        placeholderTextColor="#A89CB8"
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="go"
                        onSubmitEditing={() => { const raw = codeInput.trim().toLowerCase().replace(/\s+/g, '-');
                          if (!raw || codeLoading) return;
                          setCodeError('');
                          setCodeLoading(true);
                          // Meme endpoint que la page /event/{code} du site :
                          // il ignore `listed`, seul active=true est requis,
                          // donc il atteint les events masques.
                          fetch(`${API_URL}/public-events/${encodeURIComponent(raw)}`)
                            .then(r => (r.ok ? r.json() : null))
                            .then(ev => {
                              if (ev && ev.code) {
                                setManualEvent(ev);
                                setCode(ev.code);
                              } else {
                                setCodeError('Aucun événement actif avec ce code.');
                              }
                            })
                            .catch(() => setCodeError('Connexion impossible. Vérifie ton réseau.'))
                            .finally(() => setCodeLoading(false)); }}
                        style={{ fontFamily: 'Montserrat',
                          flex: 1,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          fontSize: 14,
                          color: '#221c30',
                        }}
                      />
                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={!codeInput.trim() || codeLoading}
                        onPress={() => {
                          const raw = codeInput.trim().toLowerCase().replace(/\s+/g, '-');
                          if (!raw || codeLoading) return;
                          setCodeError('');
                          setCodeLoading(true);
                          // Meme endpoint que la page /event/{code} du site :
                          // il ignore `listed`, seul active=true est requis,
                          // donc il atteint les events masques.
                          fetch(`${API_URL}/public-events/${encodeURIComponent(raw)}`)
                            .then(r => (r.ok ? r.json() : null))
                            .then(ev => {
                              if (ev && ev.code) {
                                setManualEvent(ev);
                                setCode(ev.code);
                              } else {
                                setCodeError('Aucun événement actif avec ce code.');
                              }
                            })
                            .catch(() => setCodeError('Connexion impossible. Vérifie ton réseau.'))
                            .finally(() => setCodeLoading(false));
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 11,
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{
                          color: codeInput.trim() ? C.primary : '#8b83a0',
                          fontSize: 14, fontFamily: 'Montserrat-SemiBold',
                        }}>
                          {codeLoading ? '…' : 'Ouvrir'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {!!codeError && (
                      <Text style={{ fontFamily: 'Montserrat',
                        paddingHorizontal: 14, paddingBottom: 10,
                        fontSize: 12, color: '#D6455B',
                      }}>
                        {codeError}
                      </Text>
                    )}
                  </View>
                )}
                <View style={{ marginBottom: 12 }}>
                  {upcomingSearched.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ fontFamily: 'Montserrat', color: '#8b83a0', fontSize: 13 }}>
                        {upcoming.length === 0
                          ? 'Aucun événement à venir'
                          : 'Aucun résultat pour cette recherche'}
                      </Text>
                    </View>
                  )}
                  {(code
                      ? (upcomingSearched.filter(e => e.code === code).length
                          ? upcomingSearched.filter(e => e.code === code)
                          : (manualEvent && manualEvent.code === code ? [manualEvent] : []))
                      : upcomingSearched
                    ).map(e => {
                    const active = code === e.code;
                    const tint = colorForType(e.event_type);
                    return (
                      <TouchableOpacity
                        key={e.code}
                        onPress={() => setCode(active ? '' : e.code)}
                        activeOpacity={0.9}
                        style={{
                          backgroundColor: tint,
                          borderRadius: 16,
                          paddingHorizontal: 16,
                          paddingVertical: 14,
                          marginBottom: 10,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 11, opacity: 0.9, marginBottom: 4 }}>
                            {formatDateLong(e.event_date, e.event_date_end)}
                          </Text>
                          <Text style={{ color: '#fff', fontSize: 20, fontFamily: 'AVEstiana', fontStyle: 'normal' }} numberOfLines={1}>
                            {e.name}
                          </Text>
                        </View>
                        {active && (
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}>
                            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                              <Path d="M5 12l5 5L20 7" stroke={tint} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                            </Svg>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {/* Saisie directe d un code event. Placee EN BAS de la
                    liste, avant le PIN : le comportement standard reste la
                    liste + search, le code entry est un fallback pour les
                    events non listes (test permanent, code oral orga...).
                    Masque quand un code est deja selectionne. */}
                {code ? (
                  <>
                    <Text style={{ fontSize: 15, fontFamily: 'Montserrat-Medium', color: '#3F3F46', marginBottom: 7 }}>Code PIN photographe</Text>
                    <View style={{ marginTop: 4, marginBottom: 8 }}>
                      <PinInputRow
                        key={pinErrorTick /* force remount sur erreur pour reset focus */}
                        value={password}
                        onChange={(v) => { setPassword(v); if (pinError) setPinError(''); }}
                        autoFocus={false}
                        useNumpad
                        error={!!pinError}
                        onComplete={(full) => {
                          doLogin(full);
                        }}
                      />
                      {pinError ? (
                        <Text style={{ color: C.error, fontSize: 13, textAlign: 'center', marginTop: 12, fontFamily: 'Montserrat-Medium' }}>
                          {pinError}
                        </Text>
                      ) : null}
                      {busy ? (
                        <View style={{ alignItems: 'center', marginTop: 12 }}>
                          <ActivityIndicator color={C.primary} />
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </>
            ) : resetMode !== 'login' ? (
              <>
                <Text style={{ color: C.text, fontSize: 14, fontFamily: 'Montserrat-SemiBold', marginBottom: 6 }}>
                  {resetMode === 'reset-request' ? 'Réinitialiser ton mot de passe' : 'Vérifier le code reçu'}
                </Text>
                <Text style={{ fontFamily: 'Montserrat', color: '#8b83a0', fontSize: 12, marginBottom: 14 }}>
                  {resetMode === 'reset-request'
                    ? `Un code à 6 chiffres sera envoyé à l'email enregistré pour cet événement.`
                    : `Code envoyé à l'email de l'organisateur. Valable 15 minutes.`}
                </Text>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor="#A89CB8"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  editable={resetMode === 'reset-request'}
                  style={[formSectionStyle.input, resetMode !== 'reset-request' && { opacity: 0.6 }]}
                />
                {resetMode === 'reset-verify' && (
                  <>
                    <TextInput
                      placeholder="Code reçu (6 chiffres)"
                      placeholderTextColor="#A89CB8"
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      style={formSectionStyle.input}
                    />
                    <TextInput
                      placeholder="Nouveau mot de passe"
                      placeholderTextColor="#A89CB8"
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                      secureTextEntry
                      style={formSectionStyle.input}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor="#A89CB8"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  style={formSectionStyle.input}
                />
                <TextInput
                  placeholder="Mot de passe"
                  placeholderTextColor="#A89CB8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={formSectionStyle.input}
                />
                <TouchableOpacity
                  onPress={() => setResetMode('reset-request')}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginTop: -4, marginBottom: 4 }}
                >
                  <Text style={{ color: C.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>Mot de passe oublié ?</Text>
                </TouchableOpacity>
              </>
            )}

            {resetMode !== 'login' ? (
              <>
                <TouchableOpacity
                  onPress={resetMode === 'reset-request' ? requestReset : verifyReset}
                  disabled={resetBusy || (resetMode === 'reset-request' ? !code : (!resetCode || !resetNewPassword))}
                  style={{
                    backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14,
                    alignItems: 'center', marginTop: 8,
                    opacity: resetBusy ? 0.7 : 1,
                  }}
                >
                  {resetBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>
                      {resetMode === 'reset-request' ? 'M\'envoyer un code' : 'Réinitialiser le mot de passe'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setResetMode('login'); setResetCode(''); setResetNewPassword(''); }}
                  hitSlop={6}
                  style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}
                >
                  <Text style={{ fontFamily: 'Montserrat', color: '#8b83a0', fontSize: 13 }}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : role === 'photographer' ? null : (
              // Pour le photographe, le PIN auto-submit via onComplete a 4
              // chiffres : le bouton Continuer est redondant. On le garde
              // uniquement pour l organisateur (email + mot de passe).
              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code || !password}
                style={{
                  backgroundColor: (code && password) ? C.primary : '#e9e4f9',
                  paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
                }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: (code && password) ? '#fff' : '#8b83a0', fontSize: 15, fontFamily: 'Montserrat-SemiBold' }}>Continuer</Text>}
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
