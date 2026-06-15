// Modal profile organisateur : edition prenom/nom + changement mot de passe
// + logout + suppression compte. Plus simple que ProfileMenuModal (pas de
// selfie, pas de geo.api ville, pas de delete face data).

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, ActivityIndicator, Alert, Platform, StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { InfoRow } from '../InfoRow';
import { PasswordInput } from '../PasswordInput';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { authStyles, profileCardStyles } from '../../constants/formStyles';

export function OrganizerProfileMenuModal({ visible, onClose, organizerSession, organizerApiFetch, onLogout, onUpdate, onDeleteAccount }) {
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
    if (newPwd.length < 10) { setPwdError('Mot de passe : 10 caractères minimum.'); return; }
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        {/* Backdrop frosted glass (alignement UX modaux auth photographe/orga). */}
        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
        <TouchableOpacity activeOpacity={1} style={[s.modalBackdrop, { backgroundColor: 'transparent' }]} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
            <TouchableOpacity onPress={onClose} hitSlop={20}>
              <View style={s.modalHandle} />
            </TouchableOpacity>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {profile && (
                <Text style={[s.welcome, { color: '#c9beed', marginBottom: 20, marginTop: 4, fontSize: 26 }]}>
                  Hello {profile.firstName}
                </Text>
              )}

              {profile && !editing && (
                <View style={profileCardStyles.card}>
                  <InfoRow label="Prénom" value={profile.firstName} />
                  <InfoRow label="Nom" value={profile.lastName} />
                  <InfoRow label="Email" value={profile.email} last />
                  <TouchableOpacity onPress={() => setEditing(true)} style={{ marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.primary, fontWeight: '600', fontSize: 14 }}>Modifier les infos</Text>
                  </TouchableOpacity>
                </View>
              )}

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
                    placeholder="Ancien mot de passe" placeholderTextColor={C.textSoft}
                    value={oldPwd} onChangeText={setOldPwd}
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
                <TouchableOpacity onPress={() => { onClose(); onLogout?.(); }} style={{ alignItems: 'center', marginTop: 12, paddingVertical: 12 }}>
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
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}
