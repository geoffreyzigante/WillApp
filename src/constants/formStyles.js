// StyleSheet partage pour les sections de formulaire (CreateEventModal,
// LoginModal, AuthRunnerModal, ProfileMenuModal). Centralise pour eviter
// les divergences cross-modal et permettre l extraction des composants
// independamment.

import { StyleSheet } from 'react-native';
import { C } from './colors';
import { T } from './tokens';

export const formSectionStyle = StyleSheet.create({
  // Audit UI : titres de sections en violet charte 100% (retour user create event).
  heading: { fontSize: 13, fontFamily: 'Montserrat-SemiBold', color: C.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  // Sous-titres explicateurs en violet plus fonce que C.textSoft (rgba 30%
  // = trop pale). #5E1AD6 deja utilise pour le texte "Will recherche...".
  subheading: { fontFamily: 'Montserrat', fontSize: 12, color: '#5E1AD6', marginBottom: 8, lineHeight: 17 },
  // Les valeurs viennent de la charte partagee (WILL/charte/tokens.json) :
  // les ecrire ici en dur est ce qui faisait diverger l app et le site.
  input: {
    fontFamily: T.typo.texte,
    backgroundColor: T.couleur.champFond,
    borderRadius: T.rayon.champ,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: T.typo.champ.taille,
    color: T.couleur.texte,
    marginBottom: 8,
  },
});

// Styles partages pour les TextInput des Auth* modals et ProfileMenu*.
// Variant plus pale (#f5f3ff) que formSectionStyle.input (#faf9ff).
export const authStyles = StyleSheet.create({
  input: { fontFamily: 'Montserrat',
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    marginBottom: 10,
  },
});

// Cartes section "card" pour les profile menus (Runner + Organizer).
export const profileCardStyles = StyleSheet.create({
  card: { backgroundColor: '#faf9ff', borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { color: C.text, fontSize: 16, fontFamily: 'Montserrat-SemiBold' },
});
