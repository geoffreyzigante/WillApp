// Modal auth organisateur : login / register simple (sans flow forgot,
// le reset password se fait via LoginModal cote login event car le code
// event est requis pour identifier l organisation).
//
// Couleur d accent : pinkPill (vs primary violet pour le coureur) pour
// differencier visuellement les deux espaces.

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput,
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

export function AuthOrganizerModal({ visible, onClose, onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem('@will_last_email_organizer').then(v => {
      if (v) setEmail(prev => prev || v);
    }).catch(() => {});
  }, [visible]);

  const reset = () => {
    setEmail(''); setPassword(''); setFirstName(''); setLastName('');
    setError(''); setBusy(false);
  };

  const pwdStrength = passwordStrength(password);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const url = mode === 'login' ? '/organizer/login' : '/organizer/register';
      const body = mode === 'login' ? { email, password } : { email, password, firstName, lastName };
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
      onSuccess({ token: data.token, profile: data.profile });
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
              <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                {mode === 'login' ? 'Espace organisateur' : 'Créer un compte'}
              </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
              {mode === 'login' ? 'Connecte-toi à ton compte organisateur' : 'Crée ton compte pour gérer tes events'}
            </Text>

            {mode === 'register' && (
              <>
                <TextInput placeholder="Prénom" placeholderTextColor={C.textSoft} value={firstName} onChangeText={setFirstName} style={formSectionStyle.input} />
                <TextInput placeholder="Nom" placeholderTextColor={C.textSoft} value={lastName} onChangeText={setLastName} style={formSectionStyle.input} />
              </>
            )}
            <TextInput placeholder="Email" placeholderTextColor={C.textSoft} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={formSectionStyle.input} />
            <PasswordInput placeholder="Mot de passe" placeholderTextColor={C.textSoft} value={password} onChangeText={setPassword} style={formSectionStyle.input} />

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

            <TouchableOpacity onPress={submit} disabled={busy} style={{ backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{mode === 'login' ? 'Se connecter' : "S'inscrire"}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: C.textSoft, fontSize: 13 }}>
                {mode === 'login' ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
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
