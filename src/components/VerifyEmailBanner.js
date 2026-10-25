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

export function VerifyEmailBanner({ runnerApiFetch, isAuthed, isActive = true }) {
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

  // Le retour au premier plan ne suffit pas : si le lien s ouvre dans le
  // navigateur integre du client mail, l app ne passe jamais en arriere-plan
  // et l evenement AppState ne tombe pas. On rafraichit donc aussi a chaque
  // fois que l onglet redevient actif.
  useEffect(() => { if (isActive) fetchStatus(); }, [isActive, fetchStatus]);

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
      // Pas de marge laterale propre : le parent pose deja 20 de padding, et
      // les 14 d avant rentraient le bandeau de 34 quand la barre de filtres
      // juste dessous part a 20. Deux bords gauches dans le meme ecran.
      backgroundColor: C.white, marginBottom: 10, borderRadius: 16,
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
        // Action secondaire en texte (token btnSecondaryText), pas une
        // pilule pleine : un bouton plein dans une carte de rayon 16 avec
        // 14 de padding devrait avoir un rayon de 2 pour s emboiter, ce qui
        // n existe pas dans l echelle. Et il prenait le pas sur le titre.
        style={{ paddingHorizontal: 4, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}
        activeOpacity={0.6}
      >
        {busy ? <ActivityIndicator color={C.primary} size="small" /> : <Text style={{ color: C.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 14 }}>Renvoyer</Text>}
      </TouchableOpacity>
    </View>
  );
}
