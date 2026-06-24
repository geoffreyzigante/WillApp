// Modal auth coureur : login / register / forgot password.
//
// Flow :
//   - login : email + password
//   - register : prenom + nom + cp/ville (geo.api.gouv.fr) + email + password
//                avec barre de force du password live
//   - forgot : email -> POST /runner/forgot-password (worker anti-enumeration,
//              retourne toujours OK)
//
// Audit B12b : geo.api KO/timeout/sans match -> fallback saisie manuelle.
// Sheet slide-in + drag-to-dismiss via useDismissibleSheet hook.

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Animated, ActivityIndicator, Platform, StyleSheet, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import DateTimePicker from '@react-native-community/datetimepicker';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { formSectionStyle } from '../../constants/formStyles';
import { API_URL } from '../../constants/api';
import { passwordStrength } from '../../utils/passwordStrength';
import { useDismissibleSheet } from '../../hooks/useDismissibleSheet';

// Helpers date naissance : ISO yyyy-mm-dd <-> JJ/MM/AAAA pour l'affichage FR.
const formatDobFr = (iso) => {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const dateToIso = (d) => {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const ageFromIso = (iso) => {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  const dob = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const mm = now.getMonth() - dob.getMonth();
  if (mm < 0 || (mm === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
};

export function AuthRunnerModal({ visible, onClose, onSuccess, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot'
  const [forgotEmailSent, setForgotEmailSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [cguAccepted, setCguAccepted] = useState(false);
  const [biometricsConsent, setBiometricsConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setForgotEmailSent(false);
    AsyncStorage.getItem('@will_last_email_runner').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible, initialMode]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setDateOfBirth(''); setCguAccepted(false); setBiometricsConsent(false);
    setError(''); setBusy(false); setForgotEmailSent(false);
  };

  const pwdStrength = passwordStrength(password);

  const submit = async () => {
    setError('');
    if (mode === 'forgot') {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError('Email invalide');
        return;
      }
      setBusy(true);
      try {
        await fetch(`${API_URL}/runner/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        });
        setForgotEmailSent(true);
      } catch (e) {
        setError('Connexion impossible. Verifie ton reseau.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === 'register') {
      if (!firstName.trim() || !lastName.trim()) { setError('Prénom et nom requis.'); return; }
      if (!dateOfBirth) { setError('Date de naissance requise.'); return; }
      if (ageFromIso(dateOfBirth) < 13) { setError('Tu dois avoir au moins 13 ans.'); return; }
      if (!cguAccepted) { setError("Tu dois accepter les CGU et la politique de confidentialité."); return; }
    }
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, firstName, lastName, dateOfBirth, biometricsConsent };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile, isNewSignup: mode === 'register' });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
          <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
            <Animated.View style={{ transform: [{ translateY: sheetTranslate }] }}>
              <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
                <View {...handlePanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                  <View style={s.modalHandle} />
                </View>
                <Text style={[s.welcome, { color: C.primary, fontSize: 22, marginBottom: mode === 'forgot' ? 4 : 14, marginTop: 4, textAlign: 'center' }]}>
                  {mode === 'login' ? 'Me connecter' : mode === 'forgot' ? 'Mot de passe oublié' : 'Créer mon compte'}
                </Text>
                {mode === 'forgot' && (
                  <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
                    On t'envoie un lien par email pour le réinitialiser.
                  </Text>
                )}

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 0 }}
                  style={{ maxHeight: 460 }}
                >
                  {mode === 'register' && (
                    <>
                      <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} textContentType="givenName" autoComplete="given-name" autoCapitalize="words" style={formSectionStyle.input} />
                      <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} textContentType="familyName" autoComplete="family-name" autoCapitalize="words" style={formSectionStyle.input} />
                      <TouchableOpacity
                        onPress={() => setShowDobPicker(true)}
                        style={[formSectionStyle.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
                      >
                        <Text style={{ color: dateOfBirth ? C.text : C.textSoft, fontSize: 15 }}>
                          {dateOfBirth ? formatDobFr(dateOfBirth) : 'Date de naissance'}
                        </Text>
                        <Text style={{ color: C.textSoft, fontSize: 12 }}>Modifier</Text>
                      </TouchableOpacity>
                      {showDobPicker && (
                        <DateTimePicker
                          value={dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1)}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          maximumDate={new Date()}
                          onChange={(event, selectedDate) => {
                            if (Platform.OS === 'android') setShowDobPicker(false);
                            if (selectedDate) setDateOfBirth(dateToIso(selectedDate));
                          }}
                        />
                      )}
                      {Platform.OS === 'ios' && showDobPicker && (
                        <TouchableOpacity
                          onPress={() => setShowDobPicker(false)}
                          style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, marginBottom: 6 }}
                        >
                          <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>OK</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                  <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" autoComplete="email" style={formSectionStyle.input} />
                  {mode !== 'forgot' && (
                    <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} textContentType={mode === 'register' ? 'newPassword' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} style={formSectionStyle.input} />
                  )}
                  {mode === 'register' && (
                    <>
                      <TouchableOpacity
                        onPress={() => setCguAccepted(!cguAccepted)}
                        activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6, marginBottom: 8 }}
                      >
                        <View style={{
                          width: 20, height: 20, borderRadius: 5, marginTop: 1,
                          borderWidth: 1.5, borderColor: cguAccepted ? C.primary : '#c9beed',
                          backgroundColor: cguAccepted ? C.primary : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {cguAccepted && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
                        </View>
                        <Text style={{ flex: 1, color: C.text, fontSize: 12, lineHeight: 16 }}>
                          J'accepte les{' '}
                          <Text onPress={() => Linking.openURL('https://will-app.com/cgu')} style={{ color: C.primary, fontWeight: '600' }}>CGU</Text>
                          {' '}et la{' '}
                          <Text onPress={() => Linking.openURL('https://will-app.com/confidentialite')} style={{ color: C.primary, fontWeight: '600' }}>politique de confidentialité</Text>.
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setBiometricsConsent(!biometricsConsent)}
                        activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}
                      >
                        <View style={{
                          width: 20, height: 20, borderRadius: 5, marginTop: 1,
                          borderWidth: 1.5, borderColor: biometricsConsent ? C.primary : '#c9beed',
                          backgroundColor: biometricsConsent ? C.primary : 'transparent',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {biometricsConsent && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
                        </View>
                        <Text style={{ flex: 1, color: C.text, fontSize: 12, lineHeight: 16 }}>
                          J'autorise Will à utiliser mon selfie (données biométriques) pour retrouver mes photos automatiquement.{' '}
                          <Text style={{ color: C.textSoft, fontStyle: 'italic', fontSize: 11 }}>Optionnel — tu peux l'activer plus tard.</Text>
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {mode === 'login' && (
                    <TouchableOpacity
                      onPress={() => { setMode('forgot'); setError(''); setForgotEmailSent(false); }}
                      style={{ alignSelf: 'flex-end', paddingVertical: 4, marginTop: -4, marginBottom: 4 }}
                    >
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
                    </TouchableOpacity>
                  )}
                  {mode === 'forgot' && forgotEmailSent && (
                    <Text style={{ color: '#166534', fontSize: 13, marginTop: 8, marginBottom: 4, lineHeight: 18 }}>
                      Si un compte existe avec cet email, un lien de réinitialisation t'a été envoyé. Vérifie ta boîte (et les spams). Le lien est valable 24h.
                    </Text>
                  )}
                  {mode === 'register' && password ? (
                    <View style={{ marginTop: -4, marginBottom: 8, paddingHorizontal: 4 }}>
                      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                        {[1, 2, 3, 4].map((i) => (
                          <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                        ))}
                      </View>
                      <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>{pwdStrength.label}</Text>
                    </View>
                  ) : null}
                  {error ? <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4, marginBottom: 8 }}>{error}</Text> : null}
                </ScrollView>

                <TouchableOpacity onPress={submit} disabled={busy || (mode === 'forgot' && forgotEmailSent)} style={{ backgroundColor: C.primary, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12, opacity: (busy || (mode === 'forgot' && forgotEmailSent)) ? 0.6 : 1 }}>
                  {busy
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                        {mode === 'login' ? 'Me connecter'
                          : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
                          : 'Créer mon compte'}
                      </Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    if (mode === 'forgot') { setMode('login'); }
                    else { setMode(mode === 'login' ? 'register' : 'login'); }
                    setError('');
                    setForgotEmailSent(false);
                  }}
                  style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}
                >
                  <Text style={{ color: C.textSoft, fontSize: 13 }}>
                    {mode === 'forgot' ? '← Retour à la connexion'
                      : mode === 'login' ? "Pas encore de compte ? S'inscrire"
                      : 'Déjà un compte ? Se connecter'}
                  </Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
