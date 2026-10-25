// Banniere de validation d'adresse email (compte coureur email/mot de passe).
// Affichee tant que le profil renvoie email_verified === false. Un tap sur
// "Renvoyer" appelle POST /runner/resend-verification (le worker renvoie le
// lien de validation, valable 24 h). Les comptes anciens / OAuth (Google,
// Apple) n'ont pas le champ -> interpretes verifies -> banniere masquee.
//
// Self-fetch /runner/profile au mount + a chaque retour au premier plan
// (pour disparaitre des que l'utilisateur a clique le lien depuis sa boite).

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, AppState, ActivityIndicator } from 'react-native';
import { C } from '../constants/colors';

export function VerifyEmailBanner({ runnerApiFetch, isAuthed }) {
  const [needsVerify, setNeedsVerify] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!isAuthed || !runnerApiFetch) return;
    try {
      const r = await runnerApiFetch('/runner/profile');
      if (r?.ok) {
        const data = await r.json();
        setNeedsVerify(data?.profile?.email_verified === false);
      }
    } catch {}
  }, [isAuthed, runnerApiFetch]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') fetchStatus();
    });
    return () => sub.remove();
  }, [fetchStatus]);

  if (!needsVerify) return null;

  const handleResend = () => {
    Alert.alert(
      'Renvoyer l email de validation ?',
      'On t enverra un nouveau lien a ton adresse email.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Renvoyer',
          onPress: async () => {
            setBusy(true);
            try {
              const r = await runnerApiFetch('/runner/resend-verification', { method: 'POST' });
              if (r?.ok) {
                Alert.alert('Email envoye', 'Verifie ta boite (et les spams). Le lien est valable 24 h.');
              } else {
                Alert.alert('Erreur', 'Envoi impossible pour le moment. Reessaie plus tard.');
              }
            } catch {
              Alert.alert('Erreur', 'Envoi impossible pour le moment. Reessaie plus tard.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{
      backgroundColor: C.white, marginHorizontal: 14, marginBottom: 10, borderRadius: 16,
      padding: 14, borderWidth: 1, borderColor: C.primaryLight,
      flexDirection: 'row', alignItems: 'center', gap: 14,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 15, color: C.primary }}>
          Confirme ton adresse
        </Text>
        <Text style={{ fontFamily: 'Montserrat', color: C.textSoft, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
          On t'a envoyé un lien de validation. Vérifie ta boîte pour activer ton compte.
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleResend}
        disabled={busy}
        style={{
          backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 10,
          borderRadius: 999, opacity: busy ? 0.6 : 1,
        }}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 13 }}>Renvoyer</Text>}
      </TouchableOpacity>
    </View>
  );
}
