// StyleSheet partage pour les sections de formulaire (CreateEventModal,
// LoginModal, AuthRunnerModal, ProfileMenuModal). Centralise pour eviter
// les divergences cross-modal et permettre l extraction des composants
// independamment.

import { StyleSheet } from 'react-native';
import { C } from './colors';

export const formSectionStyle = StyleSheet.create({
  // Audit UI : titres de sections en violet charte 100% (retour user create event).
  heading: { fontSize: 13, fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  // Sous-titres explicateurs en violet plus fonce que C.textSoft (rgba 30%
  // = trop pale). #5E1AD6 deja utilise pour le texte "Will recherche...".
  subheading: { fontSize: 12, color: '#5E1AD6', marginBottom: 8, lineHeight: 17 },
  input: { backgroundColor: '#faf9ff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text, marginBottom: 8 },
});
