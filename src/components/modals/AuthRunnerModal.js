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
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView, Keyboard,
  KeyboardAvoidingView, ActivityIndicator, Platform, Linking, Alert, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle } from 'react-native-svg';
import { Image as ExpoImage } from 'expo-image';
import { Icon } from '../Icon';
import { API_URL } from '../../constants/api';
import { passwordStrength } from '../../utils/passwordStrength';
import { Secure, BIOMETRIC_CONSENT_KEY } from '../../services/secureStore';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SelfieCameraModal } from './SelfieCameraModal';
import { LinearGradient } from 'expo-linear-gradient';
import { BoutonApple } from '../BoutonApple';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  pinkPill: '#f4a6ff',
  // Vert de validation, identique a celui de l ecran de revue du selfie.
  vert: '#3FA85E',
  progressEmpty: '#e2ddef',
  hintOptional: '#a49cb6',
};

// ISO -> JJ/MM/AAAA pour l affichage, et Date -> ISO pour le stockage.
const formatDobFr = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const dateToIso = (d) => {
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jour}`;
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


// Illu_Inscription.svg (user, 2026-09-01) : mascotte rose au bandeau,
// inline pour rester net et livrable en OTA.
function IlluInscription({ width = 220 }) {
  const h = width * (228.97 / 288.18);
  return (
    <Svg width={width} height={h} viewBox="0 0 288.18 228.97">
      <Path fill="#f4a6ff" d="M259.61,144.04c.63-.35,1.27-.65,1.88-1.03,23.63-14.29,32.52-42.85,19.86-63.8-10.91-18.04-34.25-24.52-55.61-16.85.2-.69.43-1.36.61-2.06,6.61-26.81-7.3-53.3-31.07-59.16-20.47-5.05-41.55,6.88-51.23,27.41-.35-.63-.65-1.27-1.03-1.88C128.73,3.05,100.16-5.84,79.22,6.82c-18.04,10.91-24.52,34.25-16.85,55.61-.69-.2-1.36-.43-2.06-.61-26.81-6.61-53.3,7.3-59.16,31.07-5.05,20.47,6.88,41.55,27.41,51.23-.63.35-1.27.65-1.88,1.03-23.63,14.29-32.52,42.85-19.86,63.8,9.28,15.35,27.56,22.32,45.96,19.34,3.98-27.66,43.27-49.4,91.31-49.4s86.71,21.41,91.2,48.77c24.12,2.63,46.42-10.82,51.73-32.39,5.05-20.47-6.88-41.55-27.41-51.23ZM144.09,160.07c-20.03,0-37.21-13.43-44.48-32.54h88.95c-7.27,19.11-24.44,32.54-44.48,32.54ZM236.69,113.74H51.49v-18.21h45.59c4.81-23.66,24.03-41.35,47.01-41.35s42.2,17.69,47.01,41.35h45.59v18.21Z" />
    </Svg>
  );
}

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

export function AuthRunnerModal({ visible, onClose, onSuccess, onDismiss, onSelfieSaved, onAskNotifications, onSkipSelfie, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  // ── Inscription en deux etapes SUR CETTE PAGE (decision user
  // 2026-08-31) : le selfie est l element interactif de l app, il vient EN
  // PREMIER (etape 1 : consentement RGPD + capture, sautable), le
  // formulaire ensuite (etape 2). L upload du selfie et la demande de
  // notifications partent a la creation du compte, avec le token recu.
  const [registerStep, setRegisterStep] = useState('selfie'); // 'selfie' | 'form'
  const [selfieUri, setSelfieUri] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(null);
  const [forgotEmailSent, setForgotEmailSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobInput, setDobInput] = useState('');
  const [dobPickerOuvert, setDobPickerOuvert] = useState(false);
  const [cguAccepted, setCguAccepted] = useState(false);
  // Notifications : pre-cochee, c est la promesse meme du produit ("tes photos
  // arrivent toutes seules"). Decochable — l invite systeme iOS/Android n est
  // alors jamais presentee, elle ne se redemande pas deux fois.
  const [notifsAccepted, setNotifsAccepted] = useState(true);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Message neutre (violet, pas rouge) : « pas de compte, cree le tien ».
  const [info, setInfo] = useState('');
  // Session ouverte par Apple mais incomplete : Apple ne donne pas de date de
  // naissance, et la regle des 13 ans l exige. Tant que c est non nul, le
  // formulaire se reduit a ce qui manque (date + CGU) et le bouton final
  // complete le profil au lieu de creer un compte.
  const [sessionApple, setSessionApple] = useState(null);
  // Jeton Apple garde en attente pendant qu on demande « pas encore de
  // compte ? ». Le jeton reste valable quelques minutes, largement de quoi
  // laisser l utilisateur repondre.
  const [appleEnAttente, setAppleEnAttente] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setForgotEmailSent(false);
    setRegisterStep('selfie');
    setSelfieUri(null);
    setSessionApple(null);
    setAppleEnAttente(null);
    setConsentChecked(false);
    Secure.getItem(BIOMETRIC_CONSENT_KEY).then(v => setConsentGiven(!!v)).catch(() => setConsentGiven(false));
    AsyncStorage.getItem('@will_last_email_runner').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible, initialMode]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setDateOfBirth(''); setDobInput(''); setDobPickerOuvert(false); setCguAccepted(false); setNotifsAccepted(true);
    setPasswordConfirm('');
    setError(''); setInfo(''); setBusy(false); setForgotEmailSent(false); setShowPassword(false);
    setSessionApple(null); setAppleEnAttente(null);
  };

  const pwdStrength = passwordStrength(password);

  // Le jeton Apple part tel quel au worker, qui le verifie contre les cles
  // publiques d Apple. Trois issues : compte connu (on entre), compte cree
  // mais incomplet (etape date de naissance), refus.
  const connecterAvecApple = async ({ identityToken, prenom, nom }, creer = false) => {
    setError('');
    setBusy(true);
    // La question « pas encore de compte ? » ne se pose que depuis l onglet
    // Connexion. Depuis Inscription, l intention est deja claire : on cree
    // sans rien demander.
    const venaitDeConnexion = mode === 'login';
    const verifierSeulement = !creer && venaitDeConnexion;
    try {
      const r = await fetch(`${API_URL}/auth/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'apple',
          id_token: identityToken,
          role: 'runner',
          first_name: prenom,
          last_name: nom,
          check_only: verifierSeulement,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Connexion Apple refusée.');
        setBusy(false);
        return;
      }
      if (data.existe === false) {
        setAppleEnAttente({ identityToken, prenom, nom });
        setBusy(false);
        return;
      }
      const session = {
        token: data.token,
        profile: data.profile,
        roles: data.roles || null,
        organizerProfile: data.organizer_profile || null,
      };
      // Apple ne transmet le prenom et le nom qu a la toute premiere
      // autorisation. Un compte cree lors d un essai precedent revient donc
      // sans identite : on la redemande, comme la date de naissance.
      const sansNoms =
        !String(data.profile?.firstName || prenom || '').trim() ||
        !String(data.profile?.lastName || nom || '').trim();
      if (data.date_naissance_requise || sansNoms) {
        setSessionApple(session);
        setFirstName(data.profile?.firstName || prenom || '');
        setLastName(data.profile?.lastName || nom || '');
        setEmail(data.profile?.email || '');
        setPassword('');
        setPasswordConfirm('');
        // Le profil a deja une date de naissance : on la reprend telle quelle
        // pour ne pas la redemander a quelqu un qui l a deja donnee.
        const dobConnue = String(data.profile?.dateOfBirth || '').trim();
        if (!data.date_naissance_requise && /^\d{4}-\d{2}-\d{2}$/.test(dobConnue)) {
          setDateOfBirth(dobConnue);
          setDobInput(formatDobFr(dobConnue));
        }
        // Depuis Connexion, le parcours d inscription n a pas eu lieu : on
        // entre par l etape 1 (selfie). Depuis Inscription, l utilisateur est
        // deja dedans — on ne le renvoie pas en arriere.
        if (venaitDeConnexion) setRegisterStep('selfie');
        setMode('register');
        setBusy(false);
        return;
      }
      onSuccess({
        token: session.token,
        profile: session.profile,
        isNewSignup: false,
        roles: session.roles,
        organizerProfile: session.organizerProfile,
      });
      reset();
      onClose();
    } catch (e) {
      setError('Connexion impossible. Vérifie ton réseau.');
      setBusy(false);
    }
  };

  const submit = async () => {
    setError('');
    // Fin de parcours Apple : le compte existe deja cote serveur, il ne lui
    // manque que la date de naissance. On complete le profil, puis on
    // enchaine exactement comme une inscription classique (selfie, notifs).
    if (sessionApple) {
      if (!firstName.trim() || !lastName.trim()) { setError('Prénom et nom requis.'); return; }
      if (!dateOfBirth) { setError('Date de naissance requise.'); return; }
      if (ageFromIso(dateOfBirth) < 13) { setError('Tu dois avoir au moins 13 ans.'); return; }
      if (!cguAccepted) { setError("Tu dois accepter les CGU et la politique de confidentialité."); return; }
      setBusy(true);
      try {
        const r = await fetch(`${API_URL}/runner/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionApple.token}` },
          body: JSON.stringify({ dateOfBirth, firstName: firstName.trim(), lastName: lastName.trim() }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { setError(data.error || 'Erreur'); setBusy(false); return; }
        const profil = data.profile || sessionApple.profile;
        onSuccess({
          token: sessionApple.token,
          profile: profil,
          isNewSignup: true,
          roles: sessionApple.roles,
          organizerProfile: sessionApple.organizerProfile,
        });
        try {
          if (selfieUri) {
            await AsyncStorage.setItem('@will_selfie', selfieUri);
            await onSelfieSaved?.(selfieUri, { token: sessionApple.token, userId: profil?.userId });
          } else {
            onSkipSelfie?.();
          }
          if (notifsAccepted) await onAskNotifications?.(sessionApple.token);
        } catch (err) {
          console.warn('[apple] etape selfie/notifs :', err?.message || err);
        }
        reset();
        onClose();
      } catch (e) {
        setError('Erreur réseau');
        setBusy(false);
      }
      return;
    }
    if (mode === 'forgot') {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        setError('Email invalide');
        return;
      }
      setBusy(true);
      try {
        // Le statut n etait pas lu : un 500 affichait « lien envoye » et
        // verrouillait le bouton, sans aucun moyen de reessayer.
        const r = await fetch(`${API_URL}/runner/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error || "L'email n'a pas pu être envoyé. Réessaie dans un instant.");
          setBusy(false);
          return;
        }
        setForgotEmailSent(true);
      } catch (e) {
        setError('Connexion impossible. Verifie ton reseau.');
      } finally {
        setBusy(false);
      }
      return;
    }
    const emailPropre = String(email || '').trim().toLowerCase();
    if (mode === 'register') {
      // Meme ordre et memes messages que le site : c est le meme parcours,
      // il ne doit pas repondre differemment selon la surface. L email
      // n etait pas verifie du tout ici — un email vide ou malforme partait
      // au serveur et revenait en « Erreur » brute.
      if (!firstName.trim() || !lastName.trim()) { setError('Tous les champs sont obligatoires.'); return; }
      if (!emailPropre) { setError('Tous les champs sont obligatoires.'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPropre)) { setError('Email invalide.'); return; }
      if (password.length < 8) { setError('Mot de passe : 8 caractères minimum.'); return; }
      if (!dateOfBirth) { setError('Date de naissance invalide.'); return; }
      if (ageFromIso(dateOfBirth) < 13) { setError('Tu dois avoir au moins 13 ans pour créer un compte.'); return; }
      if (password !== passwordConfirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
      if (!cguAccepted) { setError("Tu dois accepter les CGU et la politique de confidentialité."); return; }
    }
    setBusy(true);
    try {
      const url = mode === 'login' ? '/runner/login' : '/runner/register';
      // Email et noms trimes : un email colle avec une espace finale
      // echouait ici et passait sur le site.
      const body = mode === 'login'
        ? { email: emailPropre, password }
        : {
            email: emailPropre,
            password,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            dateOfBirth,
          };
      const r = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok && mode === 'login' && data.code === 'COMPTE_INCONNU') {
        // Pas de compte pour cet email : direction l inscription, email
        // conserve, plutot que « identifiants incorrects » en boucle. Meme
        // geste que sur le site.
        setPassword('');
        setMode('register');
        setRegisterStep(selfieUri ? 'form' : 'selfie');
        setInfo(`Aucun compte pour ${emailPropre}.`);
        setBusy(false);
        return;
      }
      if (!r.ok) {
        // Email deja connu sous un autre role : le serveur fusionne tout seul
        // si le mot de passe est le bon. Ici il ne l est pas — on vide le champ
        // et on explique, plutot que de renvoyer vers l autre espace.
        if (data.code === 'ACCOUNT_EXISTS_OTHER_ROLE' && data.password_mismatch) {
          // Le compte existe : la suite logique est la connexion (et son
          // « mot de passe oublié »), pas un formulaire d inscription qu on
          // ne pourra pas valider. L email est conserve, le reste vide.
          setPassword('');
          setPasswordConfirm('');
          setMode('login');
          setRegisterStep('selfie');
          setError("Tu as déjà un compte Will avec cet email. Connecte-toi : ton profil coureur sera ajouté.");
          setBusy(false);
          return;
        }
        setError(data.error || 'Identifiants incorrects');
        setBusy(false);
        return;
      }
      onSuccess({
        token: data.token,
        profile: data.profile,
        isNewSignup: mode === 'register',
        roles: data.roles || null,
        organizerProfile: data.organizer_profile || null,
      });
      if (mode === 'register') {
        try {
          if (selfieUri) {
            await AsyncStorage.setItem('@will_selfie', selfieUri);
            await onSelfieSaved?.(selfieUri, { token: data.token, userId: data.profile?.userId });
          } else {
            onSkipSelfie?.();
          }
          if (notifsAccepted) await onAskNotifications?.(data.token);
        } catch (err) {
          console.warn('[signup] etape selfie/notifs :', err?.message || err);
        }
        reset();
        onClose();
        return;
      }
      reset();
    } catch (e) {
      setError(e.message || 'Erreur réseau');
      setBusy(false);
    }
  };

  const acceptConsent = async () => {
    if (!consentChecked) return;
    await Secure.setItem(BIOMETRIC_CONSENT_KEY, new Date().toISOString());
    setConsentGiven(true);
  };
  const etapeSelfie = mode === 'register' && registerStep === 'selfie';
  const insets = useSafeAreaInsets();
  // Dans une Modal RN, insets.top peut revenir a 0 (Android) : garde-fou.
  const padHaut = (insets.top || StatusBar.currentHeight || 20) + 12;

  const submitLabel = sessionApple ? 'Terminer mon inscription'
    : mode === 'login' ? 'Se connecter'
    : mode === 'forgot' ? (forgotEmailSent ? 'Email envoyé' : 'Recevoir le lien')
    : 'Créer mon compte';

  return (
    <Modal visible={visible} onRequestClose={onClose} onDismiss={onDismiss} animationType="slide" presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: T.bg }}>
        {/* Entete degrade (identique au header du menu) : croix, titre et
            onglets Connexion/Inscription y vivent desormais — le blanc du
            formulaire ne commence qu en dessous. */}
        <LinearGradient
          colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingHorizontal: 24, paddingTop: padHaut, paddingBottom: mode === 'forgot' ? 26 : 0 }}
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
            fontSize: 30, color: '#fff', textAlign: 'center', marginBottom: mode === 'forgot' ? 0 : 20,
          }}>
            {mode === 'forgot' ? 'Mot de passe oublié' : mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </Text>

          {/* Connexion / Inscription : onglets textuels soulignes, en rose. */}
          {mode !== 'forgot' && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 30 }}>
              {[['login', 'Connexion'], ['register', 'Inscription']].map(([cle, libelle]) => {
                const actif = mode === cle;
                return (
                  <TouchableOpacity
                    key={cle}
                    onPress={() => {
                      setMode(cle);
                      setError('');
                      setInfo('');
                      if (cle === 'register') setRegisterStep(selfieUri ? 'form' : 'selfie');
                    }}
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
          )}
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

            {mode === 'register' && registerStep === 'form' && (
              <>
                <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 14, color: '#1A1426', textAlign: 'center', marginBottom: 16 }}>
                  Étape 2 sur 2
                </Text>
                {selfieUri ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, backgroundColor: T.surface, borderRadius: 14, padding: 10 }}>
                    <View>
                      <ExpoImage source={{ uri: selfieUri }} style={{ width: 44, height: 44, borderRadius: 12 }} contentFit="cover" />
                      {/* La pastille verte reprend le vert de l ecran de revue :
                          c est le meme "c est valide" d un ecran a l autre. */}
                      <View style={{
                        position: 'absolute', right: -4, bottom: -4,
                        width: 18, height: 18, borderRadius: 9,
                        backgroundColor: T.vert, borderWidth: 2, borderColor: T.surface,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                          <Path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      </View>
                    </View>
                    <Text style={{ flex: 1, color: T.vert, fontSize: 14, fontFamily: 'Montserrat-SemiBold' }}>Selfie ok</Text>
                    <TouchableOpacity onPress={() => setRegisterStep('selfie')} hitSlop={8}>
                      <Text style={{ color: T.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold' }}>Modifier</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
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
                  {/* Selecteur natif plutot que saisie masquee : meme geste
                      que dans le menu utilisateur, et plus aucune date
                      impossible a taper. */}
                  <TouchableOpacity
                    onPress={() => { Keyboard.dismiss(); setDobPickerOuvert(true); }}
                    activeOpacity={0.75}
                    style={[fieldStyles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                  >
                    <Text style={{ fontFamily: 'Montserrat', fontSize: 15, color: dateOfBirth ? T.textStrong : T.placeholder }}>
                      {dateOfBirth ? formatDobFr(dateOfBirth) : 'JJ/MM/AAAA'}
                    </Text>
                    <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 13, color: T.primary }}>
                      {dateOfBirth ? 'Modifier' : 'Choisir'}
                    </Text>
                  </TouchableOpacity>
                  {dobPickerOuvert && (
                    <>
                      <DateTimePicker
                        value={dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1)}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        maximumDate={new Date()}
                        locale="fr-FR"
                        onChange={(event, selectedDate) => {
                          if (Platform.OS === 'android') setDobPickerOuvert(false);
                          if (selectedDate) {
                            const iso = dateToIso(selectedDate);
                            setDateOfBirth(iso);
                            setDobInput(formatDobFr(iso));
                          }
                        }}
                      />
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity
                          onPress={() => setDobPickerOuvert(false)}
                          style={{ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 20 }}
                        >
                          <Text style={{ color: T.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 }}>OK</Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </FloatingField>
              </>
            )}

            {/* Email — commun aux modes formulaire. Apple l a deja fourni :
                inutile de le redemander, et il n est pas modifiable. */}
            {!etapeSelfie && !sessionApple && (
            <FloatingField label="Email" style={{ marginBottom: 14 }}>
              <TextInput
                placeholder="willy@exemple.fr" placeholderTextColor={T.placeholder}
                value={email} onChangeText={setEmail}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                textContentType="emailAddress" autoComplete="email"
                style={fieldStyles.input}
              />
            </FloatingField>
            )}

            {/* Mot de passe (pas en forgot / etape selfie / fin Apple) */}
            {mode !== 'forgot' && !etapeSelfie && !sessionApple && (
              <View style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={fieldStyles.label}>Mot de passe</Text>
                  {mode === 'login' && (
                    <TouchableOpacity onPress={() => { setMode('forgot'); setError(''); setForgotEmailSent(false); }} hitSlop={8}>
                      <Text style={{ color: T.primary, fontSize: 14, fontFamily: 'Montserrat-Medium', marginBottom: 7 }}>Mot de passe oublié ?</Text>
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
            {mode === 'register' && registerStep === 'form' && password ? (
              <View style={{ marginTop: 4, marginBottom: 10, paddingHorizontal: 4 }}>
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: 6 }}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= pwdStrength.score ? pwdStrength.color : '#e9e4f9' }} />
                  ))}
                </View>
                <Text style={{ color: pwdStrength.color, fontSize: 11, fontFamily: 'Montserrat-SemiBold' }}>{pwdStrength.label}</Text>
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
                fontSize: 11, fontFamily: 'Montserrat-SemiBold', marginTop: -6, marginBottom: 10, paddingHorizontal: 4,
                color: passwordConfirm === password ? '#3BA55D' : '#C5475E',
              }}>
                {passwordConfirm === password ? 'Les mots de passe correspondent' : 'Les mots de passe ne correspondent pas'}
              </Text>
            ) : null}

            {/* Cases à cocher (register, etape formulaire) */}
            {mode === 'register' && registerStep === 'form' && (
              <View style={{ gap: 12, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => setNotifsAccepted(!notifsAccepted)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
                >
                  <View style={[checkboxStyles.box, notifsAccepted && checkboxStyles.boxOn]}>
                    {notifsAccepted && <CheckIcon />}
                  </View>
                  <Text style={checkboxStyles.text}>
                    Une notification dès que Will te reconnaît sur une photo.
                  </Text>
                </TouchableOpacity>
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
                    <Text onPress={() => Linking.openURL('https://will-app.com/cgu')} style={{ color: T.primary, fontFamily: 'Montserrat-SemiBold' }}>CGU</Text>
                    {' '}et la{' '}
                    <Text onPress={() => Linking.openURL('https://will-app.com/confidentialite')} style={{ color: T.primary, fontFamily: 'Montserrat-SemiBold' }}>politique de confidentialité</Text>.
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Feedback forgot success */}
            {mode === 'forgot' && forgotEmailSent && (
              <Text style={{ fontFamily: 'Montserrat', color: '#166534', fontSize: 13, marginTop: 12, lineHeight: 18 }}>
                Si un compte existe avec cet email, un lien de réinitialisation t'a été envoyé. Vérifie ta boîte (et les spams). Le lien est valable 24h.
              </Text>
            )}

            {/* ── Inscription, etape 1 : le selfie d abord ───────────── */}
            {etapeSelfie && consentGiven === false && (
              <>
                <Text style={{ fontSize: 12, fontFamily: 'Montserrat-SemiBold', letterSpacing: 1.1, textTransform: 'uppercase', color: T.textMuted, marginBottom: 8 }}>
                  Étape 1 sur 2 — Ton selfie
                </Text>
                <Text style={{ fontFamily: 'Montserrat', color: T.textBody, fontSize: 13.5, lineHeight: 19, marginBottom: 14 }}>
                  Pour t'envoyer automatiquement tes photos d'event, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées, stockées sur des serveurs européens (eu-west-1 Francfort).{'\n\n'}
                  Ton consentement est valable <Text style={{ fontFamily: 'Montserrat-SemiBold' }}>12 mois renouvelables</Text>. Tu recevras un rappel à J-30 et J-7 avant l'échéance. Sans renouvellement, ton selfie est automatiquement supprimé.{'\n\n'}
                  Tu peux retirer ton consentement à tout moment depuis ton profil.
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openURL('https://will-app.com/privacy').catch(() => {})}
                  style={{ marginBottom: 16, alignSelf: 'flex-start' }}
                  hitSlop={10}
                >
                  <Text style={{ color: T.primary, fontSize: 13, fontFamily: 'Montserrat-SemiBold', textDecorationLine: 'underline' }}>
                    Lire la Politique de confidentialité
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setConsentChecked(c => !c)}
                  style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 }}
                  activeOpacity={0.7}
                >
                  <View style={[checkboxStyles.box, consentChecked && checkboxStyles.boxOn]}>
                    {consentChecked && <CheckIcon />}
                  </View>
                  <Text style={[checkboxStyles.text, { marginLeft: 12 }]}>
                    J'accepte le traitement biométrique de mon image (RGPD art. 9) pour la reconnaissance faciale sur les events Will, pendant 12 mois renouvelables.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={acceptConsent}
                  disabled={!consentChecked}
                  activeOpacity={0.9}
                  style={{ width: '100%', backgroundColor: T.primary, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: consentChecked ? 1 : 0.4 }}
                >
                  <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Montserrat-SemiBold' }}>Continuer</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRegisterStep('form')} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 6 }}>
                  <Text style={{ color: T.textMuted, fontFamily: 'Montserrat-SemiBold', fontSize: 14 }}>Faire mon selfie plus tard</Text>
                </TouchableOpacity>
              </>
            )}
            {etapeSelfie && consentGiven === true && (
              <>
                {/* Maquette user 2026-09-01. */}
                <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 14, color: '#1A1426', textAlign: 'center', marginBottom: 6 }}>
                  {info ? 'Bienvenue' : 'Étape 1 sur 2'}
                </Text>
                <Text style={{ fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 28, color: T.primary, textAlign: 'center', marginBottom: 12 }}>
                  {info ? 'Créons ton compte' : 'Ton selfie'}
                </Text>
                <Text style={{ color: '#1A1426', fontFamily: 'Montserrat-Medium', fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginBottom: 8, paddingHorizontal: 6 }}>
                  {info
                    ? `${info} Un selfie, quelques infos, et c'est fait.`
                    : "C'est lui qui te retrouvera sur les photos : Will reconnaît ton visage sur les events."}
                </Text>
                <Text style={{ color: T.textMuted, fontFamily: 'Montserrat', fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 22 }}>
                  Image chiffrée, serveurs européens,{'\n'}consentement valable 12 mois.
                </Text>
                <View style={{ alignItems: 'center', marginBottom: 26 }}>
                  {/* Prise de vue en direct uniquement : autoriser la galerie
                      reviendrait a laisser enregistrer le visage d un autre. */}
                  <TouchableOpacity activeOpacity={0.85} onPress={() => setCameraOpen(true)}>
                    {selfieUri ? (
                      <ExpoImage source={{ uri: selfieUri }} style={{ width: 190, height: 190, borderRadius: 24 }} contentFit="cover" />
                    ) : (
                      <IlluInscription width={189} />
                    )}
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => (selfieUri ? setRegisterStep('form') : setCameraOpen(true))}
                  activeOpacity={0.9}
                  style={{ height: 50, borderRadius: 12, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 44 }}
                >
                  <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 16 }}>
                    {selfieUri ? 'Continuer' : 'Prendre mon selfie'}
                  </Text>
                </TouchableOpacity>
                {selfieUri ? (
                  <TouchableOpacity onPress={() => setCameraOpen(true)} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: T.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 13 }}>Reprendre mon selfie</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => setRegisterStep('form')} style={{ paddingVertical: 14, alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: T.primary, fontFamily: 'Montserrat-Medium', fontSize: 13 }}>Ignorer l'étape 1  ›</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* Erreur */}
            {error ? <Text style={{ fontFamily: 'Montserrat', color: '#ff6b6b', fontSize: 13, marginTop: 12 }}>{error}</Text> : null}

            {/* Bouton Continuer + link changement de mode */}
            {!etapeSelfie && (
            <View style={{ marginTop: 22, alignItems: 'center', gap: 16 }}>
              <TouchableOpacity
                onPress={submit}
                disabled={busy || (mode === 'forgot' && forgotEmailSent)}
                activeOpacity={0.9}
                style={{
                  ...(mode === 'register' ? { alignSelf: 'center', paddingHorizontal: 44 } : { width: '100%' }),
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
                  : <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Montserrat-SemiBold' }}>{submitLabel}</Text>}
              </TouchableOpacity>

              {mode === 'register' && (
                <TouchableOpacity onPress={() => setRegisterStep('selfie')} style={{ paddingVertical: 4 }}>
                  <Text style={{ color: T.primary, fontFamily: 'Montserrat-Medium', fontSize: 13 }}>Retour</Text>
                </TouchableOpacity>
              )}

              {/* Voie Apple, sous le formulaire : l email reste l entree
                  principale (decision user 2026-09-02). Le composant ne rend
                  rien si Apple n est pas disponible sur l appareil. */}
              {mode !== 'forgot' && !sessionApple && (
                <BoutonApple onJeton={connecterAvecApple} onErreur={setError} style={{ marginTop: 2 }} />
              )}

              {/* Seul le mode "oubli" garde un lien de retour : la bascule
                  connexion / inscription passe par les onglets. */}
              {mode === 'forgot' && (
                <TouchableOpacity
                  onPress={() => { setMode('login'); setError(''); setForgotEmailSent(false); }}
                  style={{ paddingVertical: 4 }}
                >
                  <Text style={{ fontFamily: 'Montserrat', fontSize: 14, color: T.textMuted }}>← Retour à la connexion</Text>
                </TouchableOpacity>
              )}
            </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Apple a bien identifie la personne, mais aucun compte Will ne lui
            correspond. On demande avant de creer : cote worker, le premier
            appel etait une simple verification (check_only), donc « Annuler »
            ne laisse rien derriere lui. */}
        <Modal visible={!!appleEnAttente} transparent animationType="fade" onRequestClose={() => setAppleEnAttente(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(26,11,46,0.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 18 }}>
              <Text style={{ fontFamily: 'AVEstiana', fontSize: 26, lineHeight: 30, color: T.primary, textAlign: 'center' }}>
                Pas encore de compte ?
              </Text>
              <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 14, lineHeight: 20, color: T.textBody, textAlign: 'center', marginTop: 12 }}>
                Aucun compte Will n'est associé à cet identifiant Apple.
              </Text>
              <TouchableOpacity
                onPress={() => { const jeton = appleEnAttente; setAppleEnAttente(null); connecterAvecApple(jeton, true); }}
                activeOpacity={0.9}
                style={{ marginTop: 22, height: 50, borderRadius: 12, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Montserrat-SemiBold' }}>M'inscrire</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAppleEnAttente(null)} style={{ paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 14, color: T.textMuted }}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>

      {/* Camera selfie : ENFANT de ce Modal — presentee par-dessus sans
          course (meme pattern que dans SelfieModal). */}
      <SelfieCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(capturedUri) => {
          // "Garder" vaut validation de l etape 1 : on enchaine sur le
          // formulaire sans repasser par l ecran d appel, ou la vignette
          // n aurait fait que redemander un "Continuer".
          setSelfieUri(capturedUri);
          setCameraOpen(false);
          setRegisterStep('form');
        }}
      />
    </Modal>
  );
}

const sectionLabelStyle = {
  fontSize: 11,
  fontFamily: 'Montserrat-SemiBold',
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
  text: { fontFamily: 'Montserrat',
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    color: T.textBody,
  },
};
