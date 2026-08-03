// Modal auth coureur fullscreen : login / register / forgot password.
//
// Design : suit le handoff design_handoff_signup_will/README.md
// - Fullscreen fond #f6f5fa
// - Floating labels (mini-label 11px au-dessus + input 15px)
// - Barre de progression 2 étapes en register (étape 1 = ce form)
// - Primary #7c3aed, borders champs #eae5f5
//
// Modes :
//   - login : email + password
//   - register : prenom + nom + date + email + password + CGU + biométrique
//   - forgot : email -> POST /runner/forgot-password

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView, SafeAreaView,
  KeyboardAvoidingView, ActivityIndicator, Platform, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle } from 'react-native-svg';
import { API_URL } from '../../constants/api';
import { passwordStrength } from '../../utils/passwordStrength';

const T = {
  bg: '#f6f5fa',
  surface: '#ffffff',
  borderField: '#eae5f5',
  borderCheckbox: '#d9cef4',
  primary: '#7c3aed',
  primaryDark: '#6d28d9',
  textStrong: '#221c30',
  textBody: '#5a5468',
  textMuted: '#8b83a0',
  textLabel: '#a89fbd',
  placeholder: '#a29bb2',
  closeBg: '#ece9f4',
  progressEmpty: '#e2ddef',
  hintOptional: '#a49cb6',
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

// Masque progressif JJ/MM/AAAA sur la frappe : ajoute les slashes automatiquement.
const formatDobInput = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

// Parse "JJ/MM/AAAA" -> ISO "AAAA-MM-JJ" si valide, sinon ''.
const parseDobInput = (formatted) => {
  const m = String(formatted || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12) return '';
  if (day < 1 || day > 31) return '';
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
};

function FloatingField({ label, children, style }) {
  return (
    <View style={[fieldStyles.container, style]}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
    </View>
  );
}

function EyeIcon({ open, color = '#9a92ad' }) {
  if (open) {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <Circle cx={12} cy={12} r={3} />
      </Svg>
    );
  }
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 3l18 18" />
      <Path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.3 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.6-.7" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 12.5l5 5L20 6" />
    </Svg>
  );
}

export function AuthRunnerModal({ visible, onClose, onSuccess, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [forgotEmailSent, setForgotEmailSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobInput, setDobInput] = useState('');
  const [cguAccepted, setCguAccepted] = useState(false);
  const [biometricsConsent, setBiometricsConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    setDateOfBirth(''); setDobInput(''); setCguAccepted(false); setBiometricsConsent(false);
    setError(''); setBusy(false); setForgotEmailSent(false); setShowPassword(false);
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

  const title = mode === 'login' ? 'Me reconnecter'
    : mode === 'forgot' ? 'Mot de passe oublié'
    : 'Crée ton compte';
  const subtitle = mode === 'login' ? 'Content de te revoir.'
    : mode === 'forgot' ? "On t'envoie un lien par email pour le réinitialiser."
    : "On commence par l'essentiel.";
  const submitLabel = mode === 'login' ? 'Se connecter'
    : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
    : 'Continuer';
  const switchLabel = mode === 'forgot' ? '← Retour à la connexion'
    : mode === 'login' ? 'S\'inscrire'
    : 'Se connecter';
  const switchLead = mode === 'forgot' ? ''
    : mode === 'login' ? "Pas encore de compte ? "
    : 'Déjà un compte ? ';

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 20, paddingBottom: 44 }}
          >
            {/* Header : close X + step label */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.closeBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#4a4458', fontSize: 22, lineHeight: 24 }}>✕</Text>
              </TouchableOpacity>
              {mode === 'register' && (
                <Text style={{ fontSize: 13, fontWeight: '600', color: T.textMuted }}>Étape 1 sur 2</Text>
              )}
            </View>

            {/* Progress bar (register uniquement) */}
            {mode === 'register' && (
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 22 }}>
                <View style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: T.primary }} />
                <View style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: T.progressEmpty }} />
              </View>
            )}

            {/* Titre + sous-titre */}
            <View style={{ marginBottom: 22 }}>
              <Text style={{ fontSize: 27, fontWeight: '700', color: T.textStrong, letterSpacing: -0.5 }}>{title}</Text>
              <Text style={{ fontSize: 14, color: T.textMuted, marginTop: 4 }}>{subtitle}</Text>
            </View>

            {mode === 'register' && (
              <>
                {/* Section : Ton identité */}
                <Text style={sectionLabelStyle}>Ton identité</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  <FloatingField label="Prénom" style={{ flex: 1 }}>
                    <TextInput
                      placeholder="Léa" placeholderTextColor={T.placeholder}
                      value={firstName} onChangeText={setFirstName}
                      textContentType="givenName" autoComplete="given-name" autoCapitalize="words"
                      style={fieldStyles.input}
                    />
                  </FloatingField>
                  <FloatingField label="Nom" style={{ flex: 1 }}>
                    <TextInput
                      placeholder="Martin" placeholderTextColor={T.placeholder}
                      value={lastName} onChangeText={setLastName}
                      textContentType="familyName" autoComplete="family-name" autoCapitalize="words"
                      style={fieldStyles.input}
                    />
                  </FloatingField>
                </View>
                {/* Date de naissance : saisie clavier JJ/MM/AAAA avec masque progressif. */}
                <FloatingField label="Date de naissance" style={{ marginBottom: 22 }}>
                  <TextInput
                    placeholder="JJ/MM/AAAA" placeholderTextColor={T.placeholder}
                    value={dobInput}
                    onChangeText={(raw) => {
                      const formatted = formatDobInput(raw);
                      setDobInput(formatted);
                      setDateOfBirth(parseDobInput(formatted));
                    }}
                    keyboardType="number-pad"
                    maxLength={10}
                    style={fieldStyles.input}
                  />
                </FloatingField>

                {/* Section : Tes accès */}
                <Text style={sectionLabelStyle}>Tes accès</Text>
              </>
            )}

            {/* Email — commun à tous les modes */}
            <FloatingField label="Email" style={{ marginBottom: 12 }}>
              <TextInput
                placeholder="lea.martin@email.com" placeholderTextColor={T.placeholder}
                value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                textContentType="emailAddress" autoComplete="email"
                style={fieldStyles.input}
              />
            </FloatingField>

            {/* Mot de passe (pas en mode forgot) : container floating + input flex + eye toggle */}
            {mode !== 'forgot' && (
              <View style={[fieldStyles.container, { marginBottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={fieldStyles.label}>Mot de passe</Text>
                  <TextInput
                    placeholder="••••••••" placeholderTextColor={T.placeholder}
                    value={password} onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    textContentType={mode === 'register' ? 'newPassword' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    style={fieldStyles.input}
                  />
                </View>
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                  <EyeIcon open={showPassword} />
                </TouchableOpacity>
              </View>
            )}

            {/* Force du mot de passe (register + password saisi) */}
            {mode === 'register' && password ? (
              <View style={{ marginTop: 4, marginBottom: 10, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3, 4].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>{pwdStrength.label}</Text>
              </View>
            ) : null}

            {/* Mot de passe oublié ? (login) */}
            {mode === 'login' && (
              <TouchableOpacity
                onPress={() => { setMode('forgot'); setError(''); setForgotEmailSent(false); }}
                style={{ alignSelf: 'flex-end', paddingVertical: 6, marginTop: 4, marginBottom: 8 }}
              >
                <Text style={{ color: T.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
              </TouchableOpacity>
            )}

            {/* Cases à cocher (register uniquement) */}
            {mode === 'register' && (
              <View style={{ gap: 12, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => setCguAccepted(!cguAccepted)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
                >
                  <View style={[checkboxStyles.box, cguAccepted && checkboxStyles.boxOn]}>
                    {cguAccepted && <CheckIcon />}
                  </View>
                  <Text style={checkboxStyles.text}>
                    J'accepte les{' '}
                    <Text onPress={() => Linking.openURL('https://will-app.com/cgu')} style={{ color: T.primary, fontWeight: '600' }}>CGU</Text>
                    {' '}et la{' '}
                    <Text onPress={() => Linking.openURL('https://will-app.com/confidentialite')} style={{ color: T.primary, fontWeight: '600' }}>politique de confidentialité</Text>.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setBiometricsConsent(!biometricsConsent)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
                >
                  <View style={[checkboxStyles.box, biometricsConsent && checkboxStyles.boxOn]}>
                    {biometricsConsent && <CheckIcon />}
                  </View>
                  <Text style={checkboxStyles.text}>
                    J'autorise Will à utiliser mon selfie pour retrouver mes photos.{' '}
                    <Text style={{ color: T.hintOptional }}>Optionnel.</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Feedback forgot success */}
            {mode === 'forgot' && forgotEmailSent && (
              <Text style={{ color: '#166534', fontSize: 13, marginTop: 12, lineHeight: 18 }}>
                Si un compte existe avec cet email, un lien de réinitialisation t'a été envoyé. Vérifie ta boîte (et les spams). Le lien est valable 24h.
              </Text>
            )}

            {/* Erreur */}
            {error ? <Text style={{ color: '#ff6b6b', fontSize: 13, marginTop: 12 }}>{error}</Text> : null}

            {/* Bouton Continuer + link changement de mode */}
            <View style={{ marginTop: 22, alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                onPress={submit}
                disabled={busy || (mode === 'forgot' && forgotEmailSent)}
                activeOpacity={0.9}
                style={{
                  width: '100%',
                  backgroundColor: T.primary,
                  paddingVertical: 17,
                  borderRadius: 14,
                  alignItems: 'center',
                  opacity: (busy || (mode === 'forgot' && forgotEmailSent)) ? 0.6 : 1,
                  shadowColor: T.primary,
                  shadowOffset: { width: 0, height: 14 },
                  shadowOpacity: 0.35,
                  shadowRadius: 30,
                  elevation: 6,
                }}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{submitLabel}</Text>}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (mode === 'forgot') { setMode('login'); }
                  else { setMode(mode === 'login' ? 'register' : 'login'); }
                  setError('');
                  setForgotEmailSent(false);
                }}
                style={{ paddingVertical: 4 }}
              >
                {mode === 'forgot' ? (
                  <Text style={{ fontSize: 14, color: T.textMuted }}>{switchLabel}</Text>
                ) : (
                  <Text style={{ fontSize: 14, color: T.textMuted }}>
                    {switchLead}<Text style={{ color: T.primary, fontWeight: '600' }}>{switchLabel}</Text>
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.5,
  color: T.textLabel,
  textTransform: 'uppercase',
  marginBottom: 10,
};

const fieldStyles = {
  container: {
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.borderField,
    borderRadius: 14,
    paddingTop: 9,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: T.textLabel,
  },
  input: {
    fontSize: 15,
    color: T.textStrong,
    paddingTop: 2,
    paddingBottom: 0,
    paddingHorizontal: 0,
    margin: 0,
    // Height mini pour éviter clip du curseur iOS.
    minHeight: 20,
  },
};

const checkboxStyles = {
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: T.borderCheckbox,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: {
    backgroundColor: T.primary,
    borderColor: T.primary,
  },
  text: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: T.textBody,
  },
};
