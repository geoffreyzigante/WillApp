// Banniere de renouvellement consentement biometrique (C8/C8b).
// Affiche un rappel a 30j de l'expiration, escalade en urgent (rouge) a 7j.
// Renouvellement = 1 tap, ne demande PAS un nouveau selfie (juste rallonge
// la duree d'opt-in de 12 mois).
//
// Fetch /selfie/consent-status au mount + a chaque AppState foreground
// pour refleter un eventuel renouvellement fait depuis un autre device.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert, AppState, ActivityIndicator } from 'react-native';

export function ConsentRenewBanner({ runnerApiFetch, isAuthed }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!isAuthed || !runnerApiFetch) return;
    try {
      const r = await runnerApiFetch('/selfie/consent-status');
      if (r?.ok) {
        const data = await r.json();
        setStatus(data);
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

  if (!status || !status.active) return null;
  if (!status.expires_in_30d && !status.expires_in_7d) return null;

  const isUrgent = !!status.expires_in_7d;
  const days = status.days_remaining;
  const daysLabel = days === 1 ? '1 jour' : `${days} jours`;

  const handleRenew = () => {
    Alert.alert(
      'Renouveler ton consentement ?',
      'Ton consentement biometrique sera renouvele pour 12 mois supplementaires. Aucun nouveau selfie n est necessaire.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Renouveler',
          onPress: async () => {
            setBusy(true);
            try {
              const r = await runnerApiFetch('/selfie/renew', { method: 'POST' });
              if (r?.ok) {
                Alert.alert('Renouvele', 'Ton consentement est valable 12 mois de plus.');
                await fetchStatus();
              } else {
                let msg = '';
                try { msg = (await r.json())?.message || ''; } catch {}
                Alert.alert('Erreur', msg || 'Renouvellement impossible. Reessaie.');
              }
            } finally { setBusy(false); }
          },
        },
      ]
    );
  };

  return (
    <View style={{
      backgroundColor: isUrgent ? '#FEE4E2' : '#FFF3D6',
      marginHorizontal: 14, marginBottom: 10, borderRadius: 12,
      padding: 14, borderWidth: 1, borderColor: isUrgent ? '#FDA29B' : '#FED98C',
      flexDirection: 'row', alignItems: 'center', gap: 10,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '800', color: isUrgent ? '#7A1F1F' : '#7A4F00', fontSize: 13 }}>
          {isUrgent ? 'Renouvelle ton consentement' : 'Consentement bientot expire'}
        </Text>
        <Text style={{ color: isUrgent ? '#7A1F1F' : '#7A4F00', fontSize: 12, marginTop: 2, lineHeight: 16 }}>
          {isUrgent
            ? `Plus que ${daysLabel}. Sans renouvellement, ton selfie sera supprime et la reconnaissance s arretera.`
            : `Ton consentement Will expire dans ${daysLabel}. Renouvelle en 1 tap.`}
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleRenew}
        disabled={busy}
        style={{
          backgroundColor: isUrgent ? '#C82424' : '#7B2FFF',
          paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
          opacity: busy ? 0.6 : 1,
        }}
        activeOpacity={0.85}
      >
        {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Renouveler</Text>}
      </TouchableOpacity>
    </View>
  );
}
