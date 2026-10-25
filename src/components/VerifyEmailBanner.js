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
      'Renvoyer l\u2019email de validation ?',
      'On t\u2019enverra un nouveau lien \u00e0 ton adresse email.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Renvoyer',
          onPress: async () => {
            setBusy(true);
            try {
              const r = await runnerApiFetch('/runner/resend-verification', { method: 'POST' });
              // La route repond { ok, sent, reason }. On ne lisait que `ok` :
              // quand le serveur repondait sent=false / ALREADY_VERIFIED, l app
              // disait quand meme « verifie ta boite » et laissait l utilisateur
              // attendre un email qui ne partirait jamais — en gardant un
              // bandeau que le serveur considere deja resolu. Ce cas est
              // desormais dit, et il fait disparaitre le bandeau sur-le-champ.
              const corps = r?.ok ? await r.json().catch(() => null) : null;
              if (corps && corps.sent === false && corps.reason === 'ALREADY_VERIFIED') {
                setNeedsVerify(false);
                Alert.alert('Adresse d\u00e9j\u00e0 confirm\u00e9e', 'Ton compte est actif, il n\u2019y a rien \u00e0 renvoyer.');
              } else if (r?.ok) {
                Alert.alert('Email envoy\u00e9', 'V\u00e9rifie ta bo\u00eete (et les spams). Le lien est valable 24\u00a0h.');
              } else {
                Alert.alert('Erreur', 'Envoi impossible pour le moment. R\u00e9essaie plus tard.');
              }
            } catch {
              Alert.alert('Erreur', 'Envoi impossible pour le moment. R\u00e9essaie plus tard.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    // Variante « ligne compacte » (choix user 2026-10-25). Le compte marche
    // deja sans validation : ce bandeau ne merite pas le tiers superieur de
    // l ecran ni le poids d un CTA. Une ligne, un point rose, l action a
    // droite. La phrase explicative tombe — elle vit dans l email.
    //
    // Pas de marge laterale propre : le parent pose deja 20 de padding, et
    // les 14 d avant rentraient le bandeau de 34 quand la barre de filtres
    // juste dessous part a 20. Deux bords gauches dans le meme ecran.
    //
    // Violet sur pillBg mesure 4,75:1 — au-dessus du seuil de 4,5:1 exige
    // pour du texte courant.
    <View style={{
      backgroundColor: C.pillBg, marginBottom: 10, borderRadius: 999,
      paddingLeft: 16, paddingRight: 8, paddingVertical: 11,
      flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: C.pinkPillActive }} />
      <Text style={{ flex: 1, fontFamily: 'Montserrat-SemiBold', fontSize: 13, color: C.primary }}>
        Confirme ton adresse
      </Text>
      <TouchableOpacity
        onPress={handleResend}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Renvoyer l'email de validation"
        // hitSlop : la ligne fait 39 pt de haut, la cible tactile doit en
        // faire 44.
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{ paddingHorizontal: 10, paddingVertical: 2, opacity: busy ? 0.5 : 1 }}
        activeOpacity={0.6}
      >
        {busy
          ? <ActivityIndicator color={C.primary} size="small" />
          : <Text style={{ color: C.primary, fontFamily: 'Montserrat-SemiBold', fontSize: 13 }}>Renvoyer</Text>}
      </TouchableOpacity>
    </View>
  );
}
