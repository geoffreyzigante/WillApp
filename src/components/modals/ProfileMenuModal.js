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
import DateTimePicker from '@react-native-community/datetimepicker';
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

// Ligne d information : libelle a gauche, valeur a droite. Le libelle etait
// en violet pale sur blanc — illisible et bavard ; il passe en gris neutre,
// et c est la valeur qui porte la couleur du texte.
function Ligne({ label, value, dernier }) {
  return (
    <View style={[compte.ligne, !dernier && compte.ligneSeparee]}>
      <Text style={compte.ligneLabel}>{label}</Text>
      <Text style={compte.ligneValeur} numberOfLines={1}>{value || '—'}</Text>
    </View>
  );
}

// Action : meme gabarit que les lignes du menu (libelle a gauche, chevron a
// droite) plutot qu un lien centre. Quatre liens centres de quatre couleurs
// differentes empiles, c est ce qui faisait desordre.
function Action({ label, onPress, ton = 'normal', dernier }) {
  const couleur = ton === 'danger' ? '#C2413B' : ton === 'lien' ? C.primary : '#1a0a3e';
  return (
    <TouchableOpacity
      style={[compte.action, !dernier && compte.ligneSeparee]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[compte.actionLabel, { color: couleur }]}>{label}</Text>
      <Text style={compte.chevron}>›</Text>
    </TouchableOpacity>
  );
}

export function ProfileMenuModal({ visible, onClose, onBack, selfieUri, onView, onRetake, onDelete, runnerSession, runnerApiFetch, onLogout, onUpdateProfile, onDeleteAccount, onDeleteFaceData, uploadState = 'idle', onRetryUpload, heroOffset = 0 }) {
  // Transition "axe partage" : ce qui part recule vers la gauche en
  // s effacant, ce qui arrive vient de la droite — la meme grammaire que les
  // grandes apps iOS. Trois choses jouent ensemble et se recouvrent :
  //   le panneau se substitue en fondu (260 ms),
  //   le contenu entre de 28 px avec une echelle a 0,985 (300 ms, decale de
  //   80 ms pour qu on percoive la profondeur),
  //   les lignes du menu s effacent dessous pendant ce temps.
  // Courbes : sortie douce et longue a l aller (0.22,1,0.36,1), plus seche
  // au retour — un aller-retour symetrique fait mou.
  const ENTREE = Easing.bezier(0.22, 1, 0.36, 1);
  const SORTIE = Easing.bezier(0.4, 0, 0.6, 1);
  const [monte, setMonte] = useState(visible);
  const panelOpacity = useRef(new Animated.Value(0)).current;
  const contentX = useRef(new Animated.Value(28)).current;
  const contentScale = useRef(new Animated.Value(0.985)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) setMonte(true);
    Animated.parallel([
      Animated.timing(panelOpacity, { toValue: visible ? 1 : 0, duration: visible ? 260 : 220, delay: visible ? 0 : 80, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentX, { toValue: visible ? 0 : 28, duration: visible ? 300 : 200, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: visible ? 1 : 0.985, duration: visible ? 300 : 200, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 150, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
    ]).start(() => { if (!visible) setMonte(false); });
  }, [visible, panelOpacity, contentX, contentScale, contentOpacity]);

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
    <Modal visible={monte} transparent animationType="none" onRequestClose={onBack || onClose}>
      {/* Aucun voile : le menu en dessous assombrit deja l ecran. Le voile
          leger qu il y avait ici couvrait AUSSI le tiroir — desormais
          transparent — et grisait le fond de la carte. Il ne reste qu une
          zone tactile invisible pour fermer en tapant a cote. */}
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={onClose}
      />

      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[drawer.panel, { opacity: panelOpacity }]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={drawer.head} pointerEvents="box-none">
            <TouchableOpacity onPress={onBack || onClose} hitSlop={12} style={drawer.back}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={drawer.backText}>Menu</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={drawer.close} accessibilityLabel="Fermer">
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {/* Aucun bandeau ici : celui du menu est juste dessous, au meme
                  endroit, et reste visible a travers ce panneau transparent.
                  Le redessiner ne changeait que son sous-titre — d ou
                  l impression d une entete qui saute d une vue a l autre. */}
              <View style={{ height: heroOffset || 228 }} pointerEvents="none" />
              <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateX: contentX }, { scale: contentScale }] }}>

              {/* Bloc Selfie */}
              {profile && (
                <View style={drawer.section}>
                  <Text style={drawer.secLabel}>Selfie</Text>
                  <View style={compte.selfieLigne}>
                    <Text style={compte.ligneValeur2}>
                      {selfieUri ? 'Enregistré' : 'Pas encore de selfie'}
                    </Text>
                    <View style={{ flex: 1 }} />
                    {!selfieUri ? (
                      <TouchableOpacity onPress={onRetake}>
                        <Text style={compte.lien}>Ajouter</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 18 }}>
                        <TouchableOpacity onPress={onView}>
                          <Text style={compte.lien}>Voir</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onRetake}>
                          <Text style={compte.lien}>Remplacer</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  {selfieUri && uploadState === 'failed' && (
                    <TouchableOpacity onPress={onRetryUpload} style={{ marginTop: 8 }}>
                      <Text style={{ color: '#C2413B', fontWeight: '600', fontSize: 12 }}>
                        Échec envoi · Réessayer
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Bloc Infos */}
              {profile && !editing && (
                <View style={drawer.section}>
                  <Text style={drawer.secLabel}>Mes infos</Text>
                  <Ligne label="Prénom" value={profile.firstName} />
                  <Ligne label="Nom" value={profile.lastName} />
                  <Ligne label="Email" value={profile.email} />
                  <Ligne label="Date de naissance" value={formatDobFr(profile.dateOfBirth)} dernier />
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
                <View style={drawer.section}>
                  <Text style={drawer.secLabel}>Réglages</Text>
                  <Action label="Modifier mes infos" onPress={() => setEditing(true)} />
                  <Action label="Modifier mon mot de passe" onPress={() => setChangingPwd(true)} dernier />
                </View>
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

              {profile && !editing && !changingPwd && (
                <>
                  <View style={drawer.section}>
                    <Action label="Se déconnecter" onPress={() => { onClose(); onLogout?.(); }} dernier />
                  </View>

                  {/* Actions irreversibles, groupees et annoncees comme
                      telles : dispersees dans la page et soulignees, elles
                      criaient plus fort que le reste. */}
                  <View style={[drawer.section, { borderBottomWidth: 0 }]}>
                    <Text style={drawer.secLabel}>Zone sensible</Text>
                    {selfieUri ? (
                      <Action label="Supprimer mon selfie" ton="danger" onPress={onDelete} />
                    ) : null}
                    {onDeleteFaceData ? (
                      <Action label="Supprimer mes données faciales" ton="danger" onPress={onDeleteFaceData} />
                    ) : null}
                    {onDeleteAccount ? (
                      <Action label="Supprimer mon compte" ton="danger" onPress={onDeleteAccount} dernier />
                    ) : null}
                  </View>
                </>
              )}

              </Animated.View>
            </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const drawer = StyleSheet.create({
  // Panneau sans fond ni ombre : il se pose DANS le tiroir du menu, dont il
  // reprend le blanc translucide et le bandeau. Lui redonner un fond
  // empilait deux blancs — d ou l aplat blanc au premier tap.
  panel: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0,
    width: DRAWER_W,
    overflow: 'hidden',
  },
  // Entete posee PAR-DESSUS le bandeau : celui-ci monte jusqu au bord haut
  // du tiroir, comme dans le menu. Avant, la barre retour/fermer poussait le
  // violet 100 px plus bas et laissait une bande blanche en haut.
  head: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 46,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 6 },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  close: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },

  // Bandeau identique a celui du menu : les deux ecrans se lisent comme un
  // seul endroit. Il deborde les marges du contenu.
  hero: {
    paddingTop: 92,
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

const compte = StyleSheet.create({
  ligne: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 11,
  },
  ligneSeparee: { borderBottomWidth: 1, borderBottomColor: 'rgba(26,10,62,0.07)' },
  ligneLabel: { fontSize: 14, color: 'rgba(26,10,62,0.45)' },
  ligneValeur: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '600', color: '#1a0a3e' },
  ligneValeur2: { fontSize: 15, fontWeight: '600', color: '#1a0a3e' },
  selfieLigne: { flexDirection: 'row', alignItems: 'center' },
  lien: { color: C.primary, fontWeight: '600', fontSize: 14 },
  action: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13,
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  chevron: { fontSize: 18, color: 'rgba(26,10,62,0.35)' },
});
