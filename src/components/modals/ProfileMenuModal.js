// Modal profile coureur : edition infos perso (prenom, nom, ville via
// geo.api.gouv.fr), changement mot de passe, vue/retake/suppression selfie,
// suppression donnees faciales (RGPD) et compte.
//
// Audit B12b : geo.api KO/timeout/sans match -> fallback saisie manuelle.

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Alert, Platform, StyleSheet,
  Animated, Dimensions,
  Easing,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Icon } from '../Icon';
import { InfoRow } from '../InfoRow';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { authStyles } from '../../constants/formStyles';

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

// Presentation en tiroir de droite : "Mon compte" s ouvre a la place du
// menu dont il vient, avec un retour vers lui. La feuille qui montait du bas
// donnait l impression d une autre application.
const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.88));

export function ProfileMenuModal({ visible, onClose, onBack, selfieUri, onView, onRetake, onDelete, runnerSession, runnerApiFetch, onLogout, onUpdateProfile, onDeleteAccount, onDeleteFaceData, uploadState = 'idle', onRetryUpload }) {
  const slideX = useRef(new Animated.Value(DRAWER_W)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideX, { toValue: visible ? 0 : DRAWER_W, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: visible ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, slideX, backdropOpacity]);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showDobPicker, setShowDobPicker] = useState(false);
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
    if (newPwd.length < 8) { setPwdError('Mot de passe : 8 caractères minimum.'); return; }
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

  useEffect(() => {
    if (editing && profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
      setDateOfBirth(profile.dateOfBirth || '');
    }
  }, [editing, profile]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdateProfile?.({
        firstName,
        lastName,
        dateOfBirth,
      });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose}>
          {Platform.OS === 'ios' ? (
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15,7,35,0.45)' }]} />
          )}
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[drawer.panel, { transform: [{ translateX: slideX }] }]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={48} tint="light" style={StyleSheet.absoluteFillObject} />
        ) : null}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={drawer.head}>
            <TouchableOpacity onPress={onBack || onClose} hitSlop={12} style={drawer.back}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={drawer.backText}>Menu</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={drawer.close} accessibilityLabel="Fermer">
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke="#7B2FFF" strokeWidth={2.6} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {profile ? (
                <LinearGradient
                  colors={['#7B2FFF', '#9E5BFF', '#D67CF8']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={drawer.hero}
                >
                  <TouchableOpacity onPress={selfieUri ? onView : onRetake} activeOpacity={0.85} style={drawer.heroAvatarWrap}>
                    <View style={drawer.heroAvatar}>
                      {selfieUri ? (
                        <ExpoImage source={{ uri: selfieUri }} style={drawer.heroSelfie} contentFit="cover" cachePolicy="memory-disk" />
                      ) : (
                        <Icon.User size={26} color="#FFFFFF" />
                      )}
                    </View>
                  </TouchableOpacity>
                  <Text style={drawer.heroName} numberOfLines={1}>Salut {profile.firstName}</Text>
                  <Text style={drawer.heroStatus}>{profile.email}</Text>
                </LinearGradient>
              ) : null}

              {/* Bloc Selfie */}
              {profile && (
                <View style={drawer.section}>
                  <Text style={drawer.secLabel}>Selfie</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <Text style={drawer.rowLabel}>
                      {selfieUri ? 'Enregistré' : 'Pas encore de selfie'}
                    </Text>
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
                <View style={drawer.section}>
                  <InfoRow label="Prénom" value={profile.firstName} />
                  <InfoRow label="Nom" value={profile.lastName} />
                  <InfoRow label="Email" value={profile.email} />
                  <InfoRow label="Date de naissance" value={formatDobFr(profile.dateOfBirth)} last />
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
                <View style={drawer.section}>
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
                  <TouchableOpacity
                    onPress={() => setShowDobPicker(true)}
                    style={[authStyles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
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
                      style={{ alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8 }}
                    >
                      <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>OK</Text>
                    </TouchableOpacity>
                  )}

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
                <View style={drawer.section}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 }}>
                    Changer mon mot de passe
                  </Text>
                  <PasswordInput
                    placeholder="Mot de passe actuel" placeholderTextColor={C.textSoft}
                    value={currentPwd} onChangeText={setCurrentPwd}
                    style={authStyles.input}
                  />
                  <PasswordInput
                    placeholder="Nouveau mot de passe (8 car. min)" placeholderTextColor={C.textSoft}
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
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const drawer = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0,
    width: DRAWER_W,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.9)' : '#fff',
    shadowColor: 'rgba(15,7,35,0.6)',
    shadowOpacity: 0.45,
    shadowOffset: { width: -8, height: 0 },
    shadowRadius: 32,
    elevation: 32,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingRight: 8 },
  backText: { color: C.primary, fontSize: 15, fontWeight: '600' },
  close: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#F4EFFF',
    alignItems: 'center', justifyContent: 'center',
  },

  // Bandeau identique a celui du menu : les deux ecrans se lisent comme un
  // seul endroit. Il deborde les marges du contenu.
  hero: {
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 22,
    marginBottom: 4,
  },
  heroAvatarWrap: { width: 58, height: 58, marginBottom: 12 },
  heroAvatar: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  heroSelfie: { width: '100%', height: '100%' },
  heroName: { fontFamily: 'AVEstiana', fontSize: 24, color: '#FFFFFF', lineHeight: 27 },
  heroStatus: { fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 4 },

  // Sections a plat : les cartes #faf9ff empilaient un aplat par groupe sur
  // un fond deja clair, sans rien separer de plus qu un filet.
  section: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26,10,62,0.07)',
  },
  secLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.1,
    textTransform: 'uppercase', color: 'rgba(26,10,62,0.4)',
    marginBottom: 10,
  },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#1a0a3e' },
});
