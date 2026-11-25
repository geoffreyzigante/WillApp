// Alerte plein ecran non-dismissible-par-hasard destinee au benevole
// photographe. Remplace les Alert.alert critiques (perm camera, session,
// stockage, batterie, thermal, reseau, queue) : texte gros, action unique,
// zero jargon. Un seul kind visible a la fois, la priorite est calculee
// cote parent (PhotographerScreen).
//
// Utilisation :
//   <CriticalAlert
//     kind={effectiveKind}      // ou null
//     onDismiss={() => setDismissedKind(effectiveKind)}
//     onAction={(k) => { if (k === 'session') retryLogin(); }}
//   />
//
// - Les kinds camera/session ne sont PAS dismissable (dismissible: false),
//   le bouton declenche uniquement une action.
// - Les autres (storage, battery, thermal, network, queue) sont dismissables : le clic
//   OK cache l overlay tant que la condition ne se resoud pas puis reapparait.

import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';

export const CRITICAL_KINDS = {
  camera: {
    icon: '📷',
    title: 'Autorise l\'appareil photo',
    subtitle: 'Sans autorisation, aucune photo ne peut être prise.',
    action: { label: 'Ouvrir les réglages', kind: 'openSettings' },
    dismissible: false,
  },
  session: {
    icon: '🔒',
    title: 'Session déconnectée',
    subtitle: 'Reconnecte-toi avec le code de l\'event.',
    action: { label: 'Réessayer', kind: 'onAction' },
    dismissible: false,
  },
  storage: {
    icon: '💾',
    title: 'Téléphone presque plein',
    subtitle: 'Libère de la place (vidéos, apps) pour continuer à enregistrer les photos.',
    action: { label: 'OK', kind: 'dismiss' },
    dismissible: true,
  },
  battery: {
    icon: '🔋',
    title: 'Batterie faible',
    subtitle: 'Branche le téléphone maintenant. Si la capture s\'arrête, touche Go! pour la relancer.',
    action: { label: 'OK', kind: 'dismiss' },
    dismissible: true,
  },
  thermal: {
    icon: '🌡️',
    title: 'Téléphone très chaud',
    subtitle: 'Pose-le 5 min à l\'ombre. La capture reprend seule.',
    action: { label: 'OK', kind: 'dismiss' },
    dismissible: true,
  },
  network: {
    icon: '📶',
    title: 'Pas de réseau',
    subtitle: 'Les photos attendent en local. Rapproche-toi d\'une zone couverte.',
    action: { label: 'OK', kind: 'dismiss' },
    dismissible: true,
  },
  queue: {
    icon: '⏳',
    title: 'Beaucoup de photos à envoyer',
    subtitle: 'Reste 10 min à un endroit avec du réseau pour vider la file.',
    action: { label: 'OK', kind: 'dismiss' },
    dismissible: true,
  },
};

export default function CriticalAlert({ kind, onDismiss, onAction }) {
  if (!kind) return null;
  const cfg = CRITICAL_KINDS[kind];
  if (!cfg) return null;

  const handlePress = () => {
    const a = cfg.action.kind;
    if (a === 'dismiss') { onDismiss?.(kind); return; }
    if (a === 'openSettings') { Linking.openSettings?.(); return; }
    if (a === 'onAction') { onAction?.(kind); return; }
    // 'noop' : rien (kind non-dismissible sans action utile pour le benevole).
  };

  return (
    // Vue superposee, pas une Modal (audit du 25/11) : une Modal presentee
    // pendant qu une autre se ferme (galerie, journal) echoue en silence sur
    // iOS et peut figer l ecran. Rendue en dernier enfant de l ecran
    // photographe, elle couvre tout ce qui n est pas une Modal ; si une
    // feuille est ouverte, l alerte apparait a sa fermeture.
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10000, elevation: 10000 }]}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.88)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}
      >
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 24,
            paddingVertical: 32,
            paddingHorizontal: 28,
            alignItems: 'center',
            maxWidth: 420,
            width: '100%',
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 20,
            // Android n applique pas les shadow* : elevation est son equivalent.
            elevation: 20,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          <Text style={{ fontFamily: 'Montserrat', fontSize: 72, marginBottom: 12 }}>{cfg.icon}</Text>
          <Text
            style={{
              fontSize: 26,
              fontFamily: 'Montserrat-Bold',
              textAlign: 'center',
              marginBottom: 12,
              color: '#111',
              letterSpacing: -0.3,
            }}
          >
            {cfg.title}
          </Text>
          <Text
            style={{ fontFamily: 'Montserrat',
              fontSize: 17,
              color: '#333',
              textAlign: 'center',
              marginBottom: 26,
              lineHeight: 22,
            }}
          >
            {cfg.subtitle}
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handlePress}
            style={{
              backgroundColor: '#111',
              paddingHorizontal: 28,
              paddingVertical: 16,
              borderRadius: 14,
              minWidth: 220,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 17, fontFamily: 'Montserrat-SemiBold' }}>
              {cfg.action.label}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
