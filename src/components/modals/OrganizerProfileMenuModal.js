// Modal profil organisateur : edition prenom/nom + changement mot de passe
// + logout + suppression compte.
//
// Presentation en tiroir de droite, identique a "Mon compte" coureur et au
// menu burger : meme bandeau violet, mêmes sections a plat separees par un
// filet. Avant, cette feuille montait du bas avec des cartes #faf9ff — deux
// langages differents pour la meme fonction selon l espace ou l on etait.

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Alert, Platform, StyleSheet,
  Animated, Dimensions, Easing,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '../Icon';
import { InfoRow } from '../InfoRow';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { authStyles } from '../../constants/formStyles';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.88));

export function OrganizerProfileMenuModal({ visible, onClose, onBack, organizerSession, organizerApiFetch, onLogout, onUpdate, onDeleteAccount }) {
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
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) setMonte(true);
    Animated.parallel([
      Animated.timing(panelOpacity, { toValue: visible ? 1 : 0, duration: visible ? 260 : 220, delay: visible ? 0 : 80, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentX, { toValue: visible ? 0 : 28, duration: visible ? 300 : 200, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentScale, { toValue: visible ? 1 : 0.985, duration: visible ? 300 : 200, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 150, delay: visible ? 80 : 0, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: visible ? 1 : 0, duration: visible ? 240 : 200, easing: visible ? ENTREE : SORTIE, useNativeDriver: true }),
    ]).start(() => { if (!visible) setMonte(false); });
  }, [visible, panelOpacity, contentX, contentScale, contentOpacity, backdropOpacity]);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const profile = organizerSession?.profile;

  const submitPwd = async () => {
    setPwdError('');
    if (newPwd !== pwdConfirm) { setPwdError('Les deux mots de passe ne correspondent pas.'); return; }
    if (newPwd.length < 8) { setPwdError('Mot de passe : 8 caractères minimum.'); return; }
    setPwdBusy(true);
    try {
      const r = await organizerApiFetch(`/organizer/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      const data = await r.json();
      if (!r.ok) { setPwdError(data.error || 'Erreur'); return; }
      setOldPwd(''); setNewPwd(''); setPwdConfirm('');
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
    }
  }, [editing, profile]);

  const save = async () => {
    setBusy(true);
    try {
      await onUpdate?.({ firstName, lastName });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={monte} transparent animationType="none" onRequestClose={onBack || onClose}>
      {/* Voile leger seulement : le menu en dessous assombrit deja l ecran,
          deux voiles empiles viraient au noir. */}
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={onClose}>
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(15,7,35,0.18)' }]} />
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents={visible ? 'auto' : 'none'}
        style={[drawer.panel, { opacity: panelOpacity }]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={48} tint="light" style={StyleSheet.absoluteFillObject} />
        ) : null}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={drawer.head} pointerEvents="box-none">
            {onBack ? (
              <TouchableOpacity onPress={onBack} hitSlop={12} style={drawer.back}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M15 18l-6-6 6-6" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={drawer.backText}>Menu</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onClose} hitSlop={12} style={drawer.close} accessibilityLabel="Fermer">
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M6 6l12 12M18 6L6 18" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
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
                <View style={drawer.heroAvatar}>
                  <Icon.User size={26} color="#FFFFFF" />
                </View>
                <Text style={drawer.heroName} numberOfLines={1}>Salut {profile.firstName}</Text>
                <Text style={drawer.heroStatus} numberOfLines={1}>{profile.email}</Text>
              </LinearGradient>
            ) : null}
            <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateX: contentX }, { scale: contentScale }] }}>

            {profile && !editing && (
              <View style={drawer.section}>
                <Text style={drawer.secLabel}>Mes infos</Text>
                <InfoRow label="Prénom" value={profile.firstName} />
                <InfoRow label="Nom" value={profile.lastName} />
                <InfoRow label="Email" value={profile.email} last />
                <TouchableOpacity onPress={() => setEditing(true)} style={{ marginTop: 12 }}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                </TouchableOpacity>
              </View>
            )}

            {profile && editing && (
              <View style={drawer.section}>
                <Text style={drawer.secLabel}>Mes infos</Text>
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
                <Text style={drawer.secLabel}>Sécurité</Text>
                <TouchableOpacity onPress={() => setChangingPwd(true)}>
                  <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier mon mot de passe</Text>
                </TouchableOpacity>
              </View>
            )}

            {profile && changingPwd && (
              <View style={drawer.section}>
                <Text style={drawer.secLabel}>Sécurité</Text>
                <PasswordInput
                  placeholder="Ancien mot de passe" placeholderTextColor={C.textSoft}
                  value={oldPwd} onChangeText={setOldPwd}
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
                    onPress={() => { setChangingPwd(false); setOldPwd(''); setNewPwd(''); setPwdConfirm(''); setPwdError(''); }}
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
              <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 16, paddingVertical: 12 }}>
                <Text style={{ color: C.error, fontWeight: '600', fontSize: 14 }}>Se déconnecter</Text>
              </TouchableOpacity>
            )}

            {profile && onDeleteAccount && (
              <TouchableOpacity onPress={onDeleteAccount} style={{ alignItems: 'center', marginTop: 4, paddingVertical: 10 }}>
                <Text style={{ color: C.textSoft, fontSize: 12, textDecorationLine: 'underline' }}>
                  Supprimer mon compte
                </Text>
              </TouchableOpacity>
            )}
            </Animated.View>
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
    // Meme fond que le menu, au centieme pres : les deux vues se succedent
    // dans le meme tiroir, une nuance de blanc differente se voit.
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.82)' : '#fff',
    shadowColor: 'rgba(15,7,35,0.6)',
    shadowOpacity: 0.45,
    shadowOffset: { width: -8, height: 0 },
    shadowRadius: 32,
    elevation: 32,
    overflow: 'hidden',
  },
  head: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 46,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 6 },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  close: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  hero: {
    paddingTop: 92,
    paddingHorizontal: 20,
    paddingBottom: 22,
    marginBottom: 4,
  },
  heroAvatar: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 12,
  },
  heroName: { fontFamily: 'AVEstiana', fontSize: 24, color: '#FFFFFF', lineHeight: 27 },
  heroStatus: { fontSize: 12.5, color: 'rgba(255,255,255,0.88)', marginTop: 4 },
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
});
