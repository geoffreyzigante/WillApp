// Modal profile coureur : edition infos perso (prenom, nom, ville via
// geo.api.gouv.fr), changement mot de passe, vue/retake/suppression selfie,
// suppression donnees faciales (RGPD) et compte.
//
// Audit B12b : geo.api KO/timeout/sans match -> fallback saisie manuelle.

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Alert, Platform, StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../Icon';
import { InfoRow } from '../InfoRow';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { authStyles, profileCardStyles } from '../../constants/formStyles';

export function ProfileMenuModal({ visible, onClose, selfieUri, onView, onRetake, onDelete, runnerSession, runnerApiFetch, onLogout, onUpdateProfile, onDeleteAccount, onDeleteFaceData, uploadState = 'idle', onRetryUpload }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const profile = runnerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await runnerApiFetch(`/runner/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setCurrentPwd(''); setNewPwd(''); setPwdConfirm('');
      setChangingPwd(false);
      Alert.alert('Mot de passe modifié', 'Ton nouveau mot de passe est actif.');
    } catch (e) {
      setPwdError('Erreur réseau');
    } finally {
      setPwdBusy(false);
    }
  };

  // Parse "27400 Louviers" -> postalCode "27400", city "Louviers"
  const parseDept = (str = '') => {
    const m = String(str).match(/^(\d{5})\s+(.+)$/);
    return m ? { postalCode: m[1], city: m[2] } : { postalCode: '', city: str };
  };

  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
      const { postalCode: pc, city: cy } = parseDept(profile.department);
      setPostalCode(pc);
      setCity(cy);
    }
  }, [editing, profile]);

  // Suggestions ville
  useEffect(() => {
    if (!editing) return;
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
      } catch (e) {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (e?.name === 'AbortError' && !ctl.timedOut) return;
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
  }, [postalCode, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdateProfile?.({
        firstName,
        lastName,
        department: `${postalCode} ${city}`.trim(),
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {profile ? (
                <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                  Hello {profile.firstName}
                </Text>
              ) : null}

              {/* Bloc Selfie */}
              {profile && (
                <View style={profileCardStyles.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={onRetake}
                      style={{ width: 56, height: 56 }}
                      hitSlop={6}
                    >
                      {selfieUri ? (
                        <ExpoImage
                          source={{ uri: selfieUri }}
                          style={{ width: 56, height: 56, borderRadius: 999 }}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={{
                          width: 56, height: 56, borderRadius: 999,
                          backgroundColor: C.primaryLight,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon.User size={28} color={C.primary} />
                        </View>
                      )}
                    </TouchableOpacity>
                    <Text style={profileCardStyles.label}>Selfie</Text>
                    <View style={{ flex: 1 }} />
                    {!selfieUri ? (
                      <TouchableOpacity onPress={onRetake}>
                        <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Ajouter</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', gap: 18 }}>
                          <TouchableOpacity onPress={onView}>
                            <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Voir</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={onDelete}>
                            <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Supprimer</Text>
                          </TouchableOpacity>
                        </View>
                        {uploadState === 'failed' && (
                          // Audit B15 fix : Reessayer affiche EN PLUS de Voir/Supprimer
                          // (pas a la place) pour ne pas bloquer le user dans le cycle
                          // failed -> retry failed sans pouvoir reprendre un selfie propre.
                          <TouchableOpacity onPress={onRetryUpload} style={{ marginTop: 6 }}>
                            <Text style={{ color: C.error, fontWeight: '600', fontSize: 12 }}>
                              Échec envoi · Réessayer
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Bloc Infos */}
              {profile && !editing && (
                <View style={profileCardStyles.card}>
                  <InfoRow label="Prénom" value={profile.firstName} />
                  <InfoRow label="Nom" value={profile.lastName} />
                  <InfoRow label="Email" value={profile.email} />
                  <InfoRow label="Ville" value={profile.department} last />
                  <TouchableOpacity
                    onPress={() => setEditing(true)}
                    style={{ marginTop: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Bloc Edition */}
              {profile && editing && (
                <View style={profileCardStyles.card}>
                  <TextInput
                    placeholder="Prénom" placeholderTextColor={C.textSoft}
                    value={firstName} onChangeText={setFirstName}
                    style={authStyles.input}
                  />
                  <TextInput
                    placeholder="Nom" placeholderTextColor={C.textSoft}
                    value={lastName} onChangeText={setLastName}
                    style={authStyles.input}
                  />
                  <TextInput
                    placeholder="Code postal" placeholderTextColor={C.textSoft}
                    value={postalCode}
                    onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                    keyboardType="number-pad" maxLength={5}
                    style={authStyles.input}
                  />
                  {citySuggestions.length > 0 && !city && (
                    <ScrollView
                      style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
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
                  {cityFetchFailed && !city && (
                    <View style={{ marginBottom: 10 }}>
                      <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 4 }}>
                        Recherche de villes indisponible. Saisis ta ville manuellement.
                      </Text>
                      <TextInput
                        placeholder="Ta ville"
                        placeholderTextColor={C.textSoft}
                        value={city}
                        onChangeText={setCity}
                        autoCapitalize="words"
                        style={authStyles.input}
                      />
                    </View>
                  )}
                  {city ? (
                    <TouchableOpacity
                      onPress={() => setCity('')}
                      style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                    >
                      <Text style={{ color: C.text, fontSize: 15 }}>{city}</Text>
                      <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                    </TouchableOpacity>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => setEditing(false)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={save} disabled={busy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: busy ? 0.6 : 1 }}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Enregistrer</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && !editing && !changingPwd && (
                <TouchableOpacity onPress={() => setChangingPwd(true)} style={{ alignItems: 'center', marginTop: 6, paddingVertical: 10 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
                </TouchableOpacity>
              )}

              {profile && changingPwd && (
                <View style={profileCardStyles.card}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                    Changer mon mot de passe
                  </Text>
                  <PasswordInput
                    placeholder="Mot de passe actuel" placeholderTextColor={C.textSoft}
                    value={currentPwd} onChangeText={setCurrentPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Nouveau mot de passe (10 car. min)" placeholderTextColor={C.textSoft}
                    value={newPwd} onChangeText={setNewPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Confirmer le nouveau" placeholderTextColor={C.textSoft}
                    value={pwdConfirm} onChangeText={setPwdConfirm}
                    style={authStyles.input}
                  />
                  {pwdError ? <Text style={{ color: '#ff6b6b', fontSize: 12, marginTop: 4 }}>{pwdError}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => { setChangingPwd(false); setCurrentPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f5f3ff' }}
                    >
                      <Text style={{ color: C.text, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitPwd} disabled={pwdBusy}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: C.primary, opacity: pwdBusy ? 0.6 : 1 }}
                    >
                      {pwdBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Modifier</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {profile && (
                <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
                  <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
                </TouchableOpacity>
              )}

              {profile && onDeleteFaceData && (
                <TouchableOpacity onPress={onDeleteFaceData} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 10 }}>
                  <Text style={{ color: '#7B2FFF', fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }}>
                    Supprimer mes données faciales
                  </Text>
                </TouchableOpacity>
              )}

              {profile && onDeleteAccount && (
                <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                  <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                    Supprimer mon compte
                  </Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}
