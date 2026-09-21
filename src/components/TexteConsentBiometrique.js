// Audit coureur 7 -- le texte de consentement biometrique etait recopie mot
// pour mot dans SelfieModal.js et AuthRunnerModal.js. C est cette copie qui
// a produit la divergence relevee : les deux fichiers situaient « eu-west-1 »
// a Francfort, alors que eu-west-1 est l Irlande. Un seul endroit desormais,
// pour que la prochaine correction n en oublie pas un.
//
// Le code de region a ete retire : il n a rien a faire dans une notice de
// consentement destinee au coureur, et c est justement lui qui a fait croire
// a une ville.

import React from 'react';
import { Text } from 'react-native';

export const URL_CONFIDENTIALITE = 'https://will-app.com/privacy';

export const LIEN_CONFIDENTIALITE_LABEL = 'Lire la Politique de confidentialité';

export const LABEL_CASE_CONSENT =
  "J'accepte le traitement biométrique de mon image (RGPD art. 9) pour la reconnaissance faciale sur les events Will, pendant 12 mois renouvelables.";

// Audit coureur 13 -- decision produit : les photos deja analysees ne sont
// PAS repassees en reconnaissance faciale quand un selfie arrive apres coup.
// Le coureur doit donc le savoir AU MOMENT du selfie, sans etre alarme.
export const PHRASE_SELFIE_AVANT_COURSE =
  "Dépose ton selfie avant ou pendant ta course : Will analyse les photos à leur arrivée, celles déjà envoyées par les photographes ne sont pas réanalysées. Tu peux toujours les retrouver dans la galerie de l'event, ou en cherchant ton dossard.";

// `style` est fourni par l appelant : les deux ecrans n ont pas la meme
// typographie de corps de texte.
export function TexteConsentBiometrique({ style, accentStyle }) {
  return (
    <Text style={style}>
      Pour t'envoyer automatiquement tes photos d'event, Will utilise ton selfie comme référence biométrique. L'image et l'empreinte faciale générée par AWS Rekognition sont chiffrées et stockées sur des serveurs européens, en Irlande.{'\n\n'}
      Ton consentement est valable <Text style={accentStyle || { fontFamily: 'Montserrat-SemiBold' }}>12 mois renouvelables</Text>. Tu recevras un rappel à J-30 et J-7 avant l'échéance. Sans renouvellement, ton selfie est automatiquement supprimé.{'\n\n'}
      Tu peux retirer ton consentement à tout moment depuis ton profil.
    </Text>
  );
}
