// Connexion Apple, cote app.
//
// Apple rend un `identityToken` (JWT signe par Apple). L app ne le lit pas :
// elle le transmet tel quel au worker, qui verifie signature, emetteur,
// audience et expiration (cf. worker/index.js:verifierJetonIdentite). Rien
// n est accorde sur la parole du telephone.
//
// Le prenom et le nom ne sont transmis par Apple qu a la TOUTE PREMIERE
// autorisation. On les joint donc au premier appel : plus tard, ils sont
// perdus pour de bon.
//
// `require` optionnel : le module natif n existe que dans un build qui l a
// embarque. Sur un binaire plus ancien, `appleDisponible()` renvoie false et
// le bouton ne s affiche simplement pas — pas de plantage OTA.

import { Platform } from 'react-native';

let AppleAuth = null;
try { AppleAuth = require('expo-apple-authentication'); } catch {}

export function appleModuleCharge() {
  return Platform.OS === 'ios' && !!AppleAuth?.signInAsync;
}

// Disponibilite reelle : iOS 13+ et compte Apple configure sur l appareil.
export async function appleDisponible() {
  if (!appleModuleCharge()) return false;
  try { return await AppleAuth.isAvailableAsync(); } catch { return false; }
}

export const APPLE_ANNULE = 'APPLE_ANNULE';

// Ouvre la feuille Apple. Leve APPLE_ANNULE si l utilisateur ferme.
export async function connexionApple() {
  const cred = await AppleAuth.signInAsync({
    requestedScopes: [
      AppleAuth.AppleAuthenticationScope.FULL_NAME,
      AppleAuth.AppleAuthenticationScope.EMAIL,
    ],
  }).catch((e) => {
    if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') {
      const err = new Error('Connexion Apple annulée');
      err.code = APPLE_ANNULE;
      throw err;
    }
    throw e;
  });
  if (!cred?.identityToken) throw new Error("Apple n'a pas renvoyé de jeton.");
  return {
    identityToken: cred.identityToken,
    prenom: cred.fullName?.givenName || '',
    nom: cred.fullName?.familyName || '',
  };
}
