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
  bg: '#ffffff',
  surface: '#F5F3FA',
  surfaceFocus: '#EDE7FF',
  borderField: 'transparent',
  borderCheckbox: '#d9cef4',
  primary: '#7B2FFF',
  primaryDark: '#6d28d9',
  textStrong: '#221c30',
  textBody: '#5a5468',
  textMuted: '#8b83a0',
  textLabel: '#3F3F46',
  textTab: '#9A93A8',
  rule: '#E7E4EE',
  placeholder: '#A89CB8',
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
  const [passwordConfirm, setPasswordConfirm] = useState('');
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
    setDateOfBirth(''); setDobInput(''); setCguAccepted(false);
    setPasswordConfirm('');
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
      if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
      if (password !== passwordConfirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
      if (!dateOfBirth) { setError('Date de naissance requise.'); return; }
      if (ageFromIso(dateOfBirth) < 13) { setError('Tu dois avoir au moins 13 ans.'); return; }
      if (!cguAccepted) { setError("Tu dois accepter les CGU et la politique de confidentialité."); return; }
    }
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      const body = mode === 'login'
        ? { email, password }
        : { email, password, firstName, lastName, dateOfBirth };
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

  const submitLabel = mode === 'login' ? 'Se connecter'
    : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
    : 'Créer mon compte';

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 20, paddingBottom: 44 }}
          >
            {/* Header : croix seule. Le decompte d etapes et la barre de
                progression disparaissent — le web n en a pas, et l etape 2
                (le selfie) s annonce d elle-meme. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.closeBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#4a4458', fontSize: 22, lineHeight: 24 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Titre centre, AVEstiana violet, comme le modal du site. */}
            <Text style={{
              fontFamily: 'AVEstiana', fontStyle: 'normal',
              fontSize: 30, color: T.primary, textAlign: 'center', marginBottom: 20,
            }}>
              {mode === 'forgot' ? 'Mot de passe oublié' : 'Connexion'}
            </Text>

            {/* Connexion / Inscription : onglets textuels soulignes. */}
            {mode !== 'forgot' && (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 30, borderBottomWidth: 1, borderBottomColor: T.rule, marginBottom: 22 }}>
                {[['login', 'Connexion'], ['register', 'Inscription']].map(([cle, libelle]) => {
                  const actif = mode === cle;
                  return (
                    <TouchableOpacity
                      key={cle}
                      onPress={() => { setMode(cle); setError(''); }}
                      style={{
                        paddingTop: 4, paddingBottom: 12,
                        borderBottomWidth: 3,
                        borderBottomColor: actif ? T.primary : 'transparent',
                        marginBottom: -1,
                      }}
                    >
                      <Text style={{ fontSize: 17, fontWeight: actif ? '700' : '500', color: actif ? '#1A1426' : T.textTab }}>
                        {libelle}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {mode === 'register' && (
              <>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
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
                <FloatingField label="Date de naissance" style={{ marginBottom: 14 }}>
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
              </>
            )}

            {/* Email — commun à tous les modes */}
            <FloatingField label="Email" style={{ marginBottom: 14 }}>
              <TextInput
                placeholder="willy@exemple.fr" placeholderTextColor={T.placeholder}
                value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                textContentType="emailAddress" autoComplete="email"
                style={fieldStyles.input}
              />
            </FloatingField>

            {/* Mot de passe (pas en mode forgot) : container floating + input flex + eye toggle */}
            {mode !== 'forgot' && (
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={fieldStyles.label}>Mot de passe</Text>
                  {mode === 'login' && (
                    <TouchableOpacity onPress={() => { setMode('forgot'); setError(''); setForgotEmailSent(false); }} hitSlop={8}>
                      <Text style={{ color: T.primary, fontSize: 14, fontWeight: '500', marginBottom: 7 }}>Mot de passe oublié ?</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ position: 'relative', justifyContent: 'center' }}>
                  <TextInput
                    placeholder="••••••••" placeholderTextColor={T.placeholder}
                    value={password} onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    textContentType={mode === 'register' ? 'newPassword' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    style={[fieldStyles.input, { paddingRight: 46 }]}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8} style={{ position: 'absolute', right: 12, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <EyeIcon open={showPassword} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Force du mot de passe (register + password saisi) */}
            {mode === 'register' && password ? (
              <View style={{ marginTop: 4, marginBottom: 10, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontWeight: '600' }}>{pwdStrength.label}</Text>
              </View>
            ) : null}

            {/* Confirmation : n apparait qu une fois le mot de passe commence.
                La demander d entree fait deux champs vides pour rien. */}
            {mode === 'register' && password ? (
              <View style={{ marginBottom: 14 }}>
                <Text style={fieldStyles.label}>Confirme ton mot de passe</Text>
                <View style={{ position: 'relative', justifyContent: 'center' }}>
                  <TextInput
                    placeholder="••••••••" placeholderTextColor={T.placeholder}
                    value={passwordConfirm} onChangeText={setPasswordConfirm}
                    secureTextEntry={!showPassword}
                    textContentType="newPassword"
                    autoComplete="new-password"
                    style={[fieldStyles.input, { paddingRight: 46 }]}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={8} style={{ position: 'absolute', right: 12, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                    <EyeIcon open={showPassword} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            {mode === 'register' && password && passwordConfirm ? (
              <Text style={{
                fontSize: 11, fontWeight: '600', marginTop: -6, marginBottom: 10, paddingHorizontal: 4,
                color: passwordConfirm === password ? '#3BA55D' : '#C5475E',
              }}>
                {passwordConfirm === password ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas'}
              </Text>
            ) : null}

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
                  height: 50,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: (busy || (mode === 'forgot' && forgotEmailSent)) ? 0.6 : 1,
                }}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{submitLabel}</Text>}
              </TouchableOpacity>

              {/* Seul le mode "oubli" garde un lien de retour : la bascule
                  connexion / inscription passe par les onglets. */}
              {mode === 'forgot' && (
                <TouchableOpacity
                  onPress={() => { setMode('login'); setError(''); setForgotEmailSent(false); }}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14, color: T.textMuted }}>← Retour à la connexion</Text>
                </TouchableOpacity>
              )}
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

// Champ aligne sur le web : le libelle vit au-dessus, en gris fonce, et
// l input est un aplat plat sans bordure. Plus de carte blanche cerclee.
const fieldStyles = {
  container: {
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: T.textLabel,
    marginBottom: 7,
  },
  input: {
    backgroundColor: T.surface,
    borderRadius: 14,
    height: 50,
    paddingHorizontal: 16,
    paddingVertical: 0,
    margin: 0,
    fontSize: 16,
    color: T.textStrong,
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
