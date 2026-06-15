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
  KeyboardAvoidingView, Animated, ActivityIndicator, Platform, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { formSectionStyle } from '../../constants/formStyles';
import { API_URL } from '../../constants/api';
import { passwordStrength } from '../../utils/passwordStrength';
import { useDismissibleSheet } from '../../hooks/useDismissibleSheet';

export function AuthRunnerModal({ visible, onClose, onSuccess, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode); // 'login' | 'register' | 'forgot'
  const [forgotEmailSent, setForgotEmailSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [cityFetchFailed, setCityFetchFailed] = useState(false);
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
    setPostalCode(''); setCity(''); setCitySuggestions([]);
    setError(''); setBusy(false); setForgotEmailSent(false);
  };

  const pwdStrength = passwordStrength(password);

  useEffect(() => {
    if (mode !== 'register') return;
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
        if (e?.name === 'AbortError' && !ctl.timedOut) return;
        setCitySuggestions([]);
        setCityFetchFailed(true);
      }
    })();
    return () => { cancelled = true; ctl.abort(); clearTimeout(timeoutId); };
  }, [postalCode, mode]);

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
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, firstName, lastName, department: `${postalCode} ${city}`.trim() };
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
                {mode === 'register' && (
                  <Text style={{ color: C.textSoft, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', marginTop: 0, marginBottom: 4 }}>
                    Étape 1 sur 2
                  </Text>
                )}
                <Text style={[s.welcome, { color: C.primary, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                  {mode === 'login' ? 'Connexion' : mode === 'forgot' ? 'Mot de passe oublié' : 'Inscription'}
                </Text>
                <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
                  {mode === 'login' ? 'Connecte-toi à ton compte'
                    : mode === 'forgot' ? "On t'envoie un lien par email pour le réinitialiser."
                    : 'Crée ton compte coureur'}
                </Text>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 0 }}
                  style={{ maxHeight: 460 }}
                >
                  {mode === 'register' && (
                    <>
                      <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={formSectionStyle.input} />
                      <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={formSectionStyle.input} />
                      <TextInput
                        placeholder="Code postal"
                        placeholderTextColor={C.textSoft}
                        value={postalCode}
                        onChangeText={(v) => { setPostalCode(v.replace(/\D/g, '').slice(0, 5)); setCity(''); }}
                        keyboardType="number-pad"
                        maxLength={5}
                        style={formSectionStyle.input}
                      />
                      {citySuggestions.length > 0 && !city && (
                        <ScrollView
                          style={{ maxHeight: 140, marginBottom: 10, borderRadius: 12, backgroundColor: '#f5f3ff' }}
                          keyboardShouldPersistTaps="handled"
                          nestedScrollEnabled
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
                            style={formSectionStyle.input}
                          />
                        </View>
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
                    </>
                  )}
                  <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={formSectionStyle.input} />
                  {mode !== 'forgot' && (
                    <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={formSectionStyle.input} />
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
                        {mode === 'login' ? 'Se connecter'
                          : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
                          : "S'inscrire"}
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
