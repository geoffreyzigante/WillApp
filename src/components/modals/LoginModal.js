// Modal login organisateur ou photographe.
//
// Photographe : selection event (liste upcoming) + PIN 4 chiffres avec
//   numpad custom + auto-submit a la 4eme touche + shake animation sur
//   erreur + compteur tentatives (3 avant rate-limit).
//
// Organisateur : code event + mot de passe + "Mot de passe oublie"
//   qui ouvre un flow reset (request -> verify avec code email 6 chiffres).
//
// Sheet slide-in + drag-to-dismiss via useDismissibleSheet hook.

import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Animated, ActivityIndicator, Alert, Platform, StyleSheet,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import { C } from '../../constants/colors';
import { s } from '../../constants/styles';
import { formSectionStyle } from '../../constants/formStyles';
import { API_URL } from '../../constants/api';
import { api } from '../../services/api';
import { formatDateLong, cityLabel, isUpcoming } from '../../utils/format';
import { PinInputRow } from '../PinInputRow';
import { useDismissibleSheet } from '../../hooks/useDismissibleSheet';

export function LoginModal({ visible, role, events, onClose, onSuccess }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { sheetTranslate, handlePanHandlers } = useDismissibleSheet(visible, onClose);
  // Reset flow (organisateur uniquement) : 'login' -> 'reset-request' -> 'reset-verify'
  const [resetMode, setResetMode] = useState('login');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  // PIN error UI (photographe) : shake + message inline + compteur tentatives.
  const [pinError, setPinError] = useState('');
  const [pinErrorTick, setPinErrorTick] = useState(0);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode(''); setPassword('');
      setResetMode('login'); setResetCode(''); setResetNewPassword('');
      setPinError(''); setPinAttempts(0); setRateLimited(false);
    }
  }, [visible]);

  // Tri ASC strict (decision user 2026-06-04, toutes les listes d events).
  const upcoming = events
    .filter(e => isUpcoming(e.event_date, e.event_date_end))
    .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));

  const doLogin = async (pwdOverride) => {
    const pwd = (pwdOverride ?? password).trim();
    if (!code) return Alert.alert('Événement requis', role === 'photographer' ? 'Choisis un événement.' : 'Entre le code.');
    if (!pwd) {
      if (role === 'photographer') setPinError('Code PIN requis');
      else Alert.alert('Mot de passe requis');
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(code.trim(), pwd, role, 'photographer');
      setBusy(false);
      if (!r?.token) {
        if (role === 'photographer') {
          const isRate = r?.status === 429 || /5 minutes|rate/i.test(String(r?.error || ''));
          if (isRate) {
            setRateLimited(true);
            setPinError('Trop de tentatives. Patiente 5 min.');
          } else {
            setPinAttempts(n => n + 1);
            setPinError(pinAttempts + 1 >= 3 ? 'Trop de tentatives. Patiente 5 min.' : 'Code PIN incorrect');
          }
          setPinErrorTick(t => t + 1);
          setPassword('');
        } else {
          Alert.alert('Échec', 'Identifiants invalides.');
        }
        return;
      }
      onSuccess(r);
    } catch {
      setBusy(false);
      if (role === 'photographer') {
        setPinError('Hors ligne');
        setPinErrorTick(t => t + 1);
      } else {
        Alert.alert(
          'Hors ligne',
          'Première connexion impossible sans réseau. Connecte-toi en wifi pour activer ton événement — ensuite l\'app fonctionnera offline.',
        );
      }
    }
  };
  const submit = () => doLogin();

  const requestReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!slug) return Alert.alert('Code requis', 'Saisis le code de ton événement avant de demander un reset.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/request-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        Alert.alert('Erreur', data.error || 'Impossible d\'envoyer le code.');
        return;
      }
      setResetMode('reset-verify');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  const verifyReset = async () => {
    const slug = code.trim().toLowerCase();
    if (!resetCode.trim()) return Alert.alert('Code requis', 'Saisis le code reçu par email.');
    if (!resetNewPassword || resetNewPassword.length < 4) return Alert.alert('Mot de passe trop court', '4 caractères minimum.');
    setResetBusy(true);
    try {
      const r = await fetch(`${API_URL}/auth/verify-org-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: slug, reset_code: resetCode.trim(), new_password: resetNewPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Échec', data.error || 'Code invalide.');
        return;
      }
      setPassword(resetNewPassword);
      setResetMode('login');
      setResetCode(''); setResetNewPassword('');
      Alert.alert('Mot de passe réinitialisé', 'Tu peux maintenant te connecter avec ton nouveau mot de passe.');
    } catch (e) {
      Alert.alert('Hors ligne', 'Vérifie ta connexion et réessaie.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1 }}>
          {/* Backdrop : iOS systemThinMaterialDark (givre frostal natif,
              plus leger qu'un Gaussian blur dense). Fade-in herite du
              animationType="fade" du Modal. */}
          <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFillObject} />
          <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'flex-end' }} onPress={onClose}>
            <Animated.View style={{ transform: [{ translateY: sheetTranslate }] }}>
            <TouchableOpacity activeOpacity={1} style={s.modalSheet} onPress={() => {}}>
              <View {...handlePanHandlers} style={{ paddingVertical: 6, alignItems: 'center' }}>
                <View style={s.modalHandle} />
              </View>
              <Text style={[s.welcome, { color: C.pinkPill, fontSize: 22, marginBottom: 4, marginTop: 4, textAlign: 'center' }]}>
                {role === 'organizer' ? 'Espace organisateur' : 'Espace photographe'}
              </Text>
            <Text style={{ color: C.textSoft, fontSize: 13, marginBottom: 18, textAlign: 'center' }}>
              {role === 'photographer' ? 'Sélectionne ton événement et entre ton code PIN' : 'Connecte-toi à ton événement'}
            </Text>

            {role === 'photographer' ? (
              <>
                <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Événement</Text>
                <ScrollView style={{ maxHeight: 260, marginBottom: 12 }}>
                  {upcoming.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: C.textSoft, fontSize: 13 }}>Aucun événement à venir</Text>
                    </View>
                  )}
                  {(code ? upcoming.filter(e => e.code === code) : upcoming).map(e => {
                    const active = code === e.code;
                    return (
                      <TouchableOpacity
                        key={e.code}
                        onPress={() => setCode(active ? '' : e.code)}
                        activeOpacity={0.85}
                        style={{
                          backgroundColor: active ? C.pinkPill : '#faf9ff',
                          borderRadius: 12,
                          padding: 14,
                          marginBottom: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: active ? '#fff' : C.text, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{e.name}</Text>
                          <Text style={{ color: active ? 'rgba(255,255,255,0.85)' : C.textSoft, fontSize: 11, marginTop: 2 }}>
                            {formatDateLong(e.event_date, e.event_date_end)}{e.location ? ` · ${cityLabel(e.location)}` : ''}
                          </Text>
                        </View>
                        {active && (
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                              <Path d="M5 12l5 5L20 7" stroke={C.pinkPill} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                            </Svg>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {code ? (
                  <>
                    <Text style={[formSectionStyle.heading, { marginTop: 0 }]}>Code PIN photographe</Text>
                    <View style={{ marginTop: 4, marginBottom: 8 }}>
                      <PinInputRow
                        key={pinErrorTick /* force remount sur erreur pour reset focus */}
                        value={password}
                        onChange={(v) => { setPassword(v); if (pinError) setPinError(''); }}
                        autoFocus={false}
                        useNumpad
                        error={!!pinError}
                        onComplete={(full) => {
                          if (rateLimited) return;
                          doLogin(full);
                        }}
                      />
                      {pinError ? (
                        <Text style={{ color: C.error, fontSize: 13, textAlign: 'center', marginTop: 12, fontWeight: '500' }}>
                          {pinError}
                        </Text>
                      ) : null}
                      {busy ? (
                        <View style={{ alignItems: 'center', marginTop: 12 }}>
                          <ActivityIndicator color={C.pinkPill} />
                        </View>
                      ) : null}
                    </View>
                  </>
                ) : null}
              </>
            ) : resetMode !== 'login' ? (
              <>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', marginBottom: 6 }}>
                  {resetMode === 'reset-request' ? 'Réinitialiser ton mot de passe' : 'Vérifier le code reçu'}
                </Text>
                <Text style={{ color: C.textSoft, fontSize: 12, marginBottom: 14 }}>
                  {resetMode === 'reset-request'
                    ? `Un code à 6 chiffres sera envoyé à l'email enregistré pour cet événement.`
                    : `Code envoyé à l'email de l'organisateur. Valable 15 minutes.`}
                </Text>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  editable={resetMode === 'reset-request'}
                  style={[formSectionStyle.input, resetMode !== 'reset-request' && { opacity: 0.6 }]}
                />
                {resetMode === 'reset-verify' && (
                  <>
                    <TextInput
                      placeholder="Code reçu (6 chiffres)"
                      placeholderTextColor={C.textSoft}
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      style={formSectionStyle.input}
                    />
                    <TextInput
                      placeholder="Nouveau mot de passe"
                      placeholderTextColor={C.textSoft}
                      value={resetNewPassword}
                      onChangeText={setResetNewPassword}
                      secureTextEntry
                      style={formSectionStyle.input}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <TextInput
                  placeholder="Code de l'événement"
                  placeholderTextColor={C.textSoft}
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  style={formSectionStyle.input}
                />
                <TextInput
                  placeholder="Mot de passe"
                  placeholderTextColor={C.textSoft}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={formSectionStyle.input}
                />
                <TouchableOpacity
                  onPress={() => setResetMode('reset-request')}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginTop: -4, marginBottom: 4 }}
                >
                  <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>Mot de passe oublié ?</Text>
                </TouchableOpacity>
              </>
            )}

            {resetMode !== 'login' ? (
              <>
                <TouchableOpacity
                  onPress={resetMode === 'reset-request' ? requestReset : verifyReset}
                  disabled={resetBusy || (resetMode === 'reset-request' ? !code : (!resetCode || !resetNewPassword))}
                  style={{
                    backgroundColor: C.pinkPill, paddingVertical: 14, borderRadius: 14,
                    alignItems: 'center', marginTop: 8,
                    opacity: resetBusy ? 0.7 : 1,
                  }}
                >
                  {resetBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                      {resetMode === 'reset-request' ? 'M\'envoyer un code' : 'Réinitialiser le mot de passe'}
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setResetMode('login'); setResetCode(''); setResetNewPassword(''); }}
                  hitSlop={6}
                  style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}
                >
                  <Text style={{ color: C.textSoft, fontSize: 13 }}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : role === 'photographer' ? null : (
              // Pour le photographe, le PIN auto-submit via onComplete a 4
              // chiffres : le bouton Continuer est redondant. On le garde
              // uniquement pour l organisateur (email + mot de passe).
              <TouchableOpacity
                onPress={submit}
                disabled={busy || !code || !password}
                style={{
                  backgroundColor: (code && password) ? C.pinkPill : '#e9e4f9',
                  paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
                }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: (code && password) ? '#fff' : C.textSoft, fontSize: 15, fontWeight: '700' }}>Continuer</Text>}
              </TouchableOpacity>
            )}
            </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
