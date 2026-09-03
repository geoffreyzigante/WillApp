// Modal auth organisateur : login / register simple (sans flow forgot,
// le reset password se fait via LoginModal cote login event car le code
// event est requis pour identifier l organisation).
//
// Design : ALIGNE sur AuthRunnerModal (decision user 2026-08-31,
// uniformisation des ecrans de connexion) — fullscreen blanc, titre
// AVEstiana violet, onglets Connexion/Inscription soulignes, labels
// au-dessus des champs, aplats #F5F3FA, bouton violet plein. L accent
// rose distinctif est abandonne : tout en violet.

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Platform, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle } from 'react-native-svg';
import { API_URL } from '../../constants/api';
import { passwordStrength } from '../../utils/passwordStrength';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BoutonApple } from '../BoutonApple';

const T = {
  bg: '#ffffff',
  surface: '#F5F3FA',
  primary: '#7B2FFF',
  textStrong: '#221c30',
  textBody: '#5a5468',
  textMuted: '#8b83a0',
  textLabel: '#3F3F46',
  textTab: '#9A93A8',
  rule: '#E7E4EE',
  placeholder: '#A89CB8',
  closeBg: '#ece9f4',
  pinkPill: '#f4a6ff',
};

function FloatingField({ label, children, style }) {
  return (
    <View style={style}>
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

export function AuthOrganizerModal({ visible, onClose, onSuccess }) {
  const insets = useSafeAreaInsets();
  // Dans une Modal RN, insets.top peut revenir a 0 (Android) : garde-fou.
  const padHaut = (insets.top || StatusBar.currentHeight || 20) + 12;
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem('@will_last_email_organizer').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible]);

  const reset = () => {
    setEmail(''); setPassword(''); setPasswordConfirm('');
    setFirstName(''); setLastName('');
    setError(''); setBusy(false); setShowPassword(false);
  };

  const pwdStrength = passwordStrength(password);

  const submit = async () => {
    setError('');
    if (mode === 'register') {
      if (!firstName.trim() || !lastName.trim()) { setError('Prénom et nom requis.'); return; }
      if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
      if (password !== passwordConfirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    }
    setBusy(true);
    try {
      // Connexion : route generique + ajout du role. /organizer/login
      // refusait un compte Will qui n avait encore que le role coureur et
      // renvoyait l orga « se connecter cote coureur » — soit exactement
      // l ecran ou il se trouve deja.
      if (mode === 'login') {
        const rl = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const dl = await rl.json().catch(() => ({}));
        if (!rl.ok || !dl.token) {
          setError(dl.error || 'Identifiants incorrects');
          setBusy(false);
          return;
        }
        let jeton = dl.token;
        let profil = dl.account || null;
        const roles = Array.isArray(dl.roles) ? dl.roles : [];
        if (!roles.includes('organizer')) {
          const ra = await fetch(`${API_URL}/auth/add-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}` },
            body: JSON.stringify({ role: 'organizer', additional_data: {} }),
          });
          const da = await ra.json().catch(() => ({}));
          if (!ra.ok) {
            setError(da.error || "Impossible d'ouvrir l'espace organisateur");
            setBusy(false);
            return;
          }
          jeton = da.token || jeton;
          profil = da.organizer_profile || da.profile || profil;
        }
        onSuccess({ token: jeton, profile: profil });
        reset();
        return;
      }
      const r = await fetch(`${API_URL}/organizer/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      const data = await r.json();
      if (!r.ok) {
        // Email deja connu sous un autre role : le serveur fusionne tout seul
        // si le mot de passe est le bon. Ici il ne l est pas — on vide le champ
        // et on explique, plutot que de renvoyer vers l autre espace.
        if (data.code === 'ACCOUNT_EXISTS_OTHER_ROLE' && data.password_mismatch) {
          setPassword('');
          setPasswordConfirm('');
        }
        setError(data.error || 'Erreur');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile });
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  // Meme route que cote coureur, avec role=organizer : le worker cree ou
  // complete le compte et renvoie un jeton organisateur. Aucune date de
  // naissance n est requise pour ce role.
  const connecterAvecApple = async ({ identityToken, prenom, nom }) => {
    setError('');
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'apple',
          id_token: identityToken,
          role: 'organizer',
          first_name: prenom,
          last_name: nom,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Connexion Apple refusée.');
        setBusy(false);
        return;
      }
      onSuccess({ token: data.token, profile: data.profile });
      reset();
    } catch (e) {
      setError('Connexion impossible. Vérifie ton réseau.');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        <LinearGradient
          colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 24, paddingTop: padHaut }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18 }}>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: 'Montserrat', color: '#fff', fontSize: 16, lineHeight: 18 }}>✕</Text>
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
            fontSize: 30, color: '#fff', textAlign: 'center', marginBottom: 20,
          }}>
            Espace organisateur
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 30 }}>
            {[['login', 'Connexion'], ['register', 'Inscription']].map(([cle, libelle]) => {
              const actif = mode === cle;
              return (
                <TouchableOpacity
                  key={cle}
                  onPress={() => { setMode(cle); setError(''); }}
                  style={{
                    paddingTop: 4, paddingBottom: 14,
                    borderBottomWidth: 5,
                    borderBottomColor: actif ? T.pinkPill : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 17, fontFamily: actif ? 'Montserrat-SemiBold' : 'Montserrat-Medium', color: actif ? '#fff' : 'rgba(255,255,255,0.65)' }}>
                    {libelle}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </LinearGradient>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={{ backgroundColor: T.bg }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 20, paddingBottom: 44 + insets.bottom }}
          >

            {mode === 'register' && (
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
            )}

            <FloatingField label="Email" style={{ marginBottom: 14 }}>
              <TextInput
                placeholder="orga@exemple.fr" placeholderTextColor={T.placeholder}
                value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                textContentType="emailAddress" autoComplete="email"
                style={fieldStyles.input}
              />
            </FloatingField>

            <View style={{ marginBottom: 14 }}>
              <Text style={fieldStyles.label}>Mot de passe</Text>
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

            {mode === 'register' && password ? (
              <View style={{ marginTop: 4, marginBottom: 10, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontFamily: 'Montserrat-SemiBold' }}>{pwdStrength.label}</Text>
              </View>
            ) : null}

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
                fontSize: 11, fontFamily: 'Montserrat-SemiBold', marginTop: -6, marginBottom: 10, paddingHorizontal: 4,
                color: passwordConfirm === password ? '#3BA55D' : '#C5475E',
              }}>
                {passwordConfirm === password ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas'}
              </Text>
            ) : null}

            {error ? <Text style={{ fontFamily: 'Montserrat', color: '#ff6b6b', fontSize: 13, marginTop: 12 }}>{error}</Text> : null}

            <View style={{ marginTop: 22, alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                onPress={submit}
                disabled={busy}
                activeOpacity={0.9}
                style={{
                  width: '100%',
                  backgroundColor: T.primary,
                  height: 50,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Montserrat-SemiBold' }}>{mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</Text>}
              </TouchableOpacity>

              {/* Voie Apple, sous le formulaire — meme regle que cote coureur. */}
              <BoutonApple onJeton={connecterAvecApple} onErreur={setError} style={{ marginTop: 2 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const fieldStyles = {
  label: {
    fontSize: 15,
    fontFamily: 'Montserrat-Medium',
    color: T.textLabel,
    marginBottom: 7,
  },
  input: { fontFamily: 'Montserrat',
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
