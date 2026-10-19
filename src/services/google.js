// Connexion Google, cote app.
//
// Meme contrat que apple.js : Google rend un `idToken` (JWT signe par Google),
// l app ne le lit pas, elle le transmet tel quel au worker qui verifie
// signature, emetteur, audience et expiration (worker/index.js:
// verifierJetonIdentite). L audience doit figurer dans GOOGLE_CLIENT_IDS cote
// worker, sinon la connexion est refusee sans autre explication.
//
// Deux identifiants, pas un :
//   - iOS   : l identifiant client iOS (type iOS dans Google Cloud). C est lui
//             qui signe le jeton, et son URL scheme inverse doit etre declare
//             dans l Info.plist du build.
//   - Android : l identifiant client WEB, et non l android. Le SDK Google ne
//             rend un idToken sur Android que si on lui donne le webClientId
//             — c est une regle du SDK, pas un choix.
// Les deux viennent de app.json -> expo.extra. Ce sont des identifiants
// publics (le site les expose deja dans son source), pas des secrets.
//
// `require` optionnel et garde de disponibilite : le module natif n existe
// que dans un build qui l a embarque. Sur un binaire plus ancien, ou si
// l identifiant manque, `googleDisponible()` renvoie false et le bouton ne
// s affiche simplement pas — jamais un bouton qui echoue.

import { Platform } from 'react-native';
import Constants from 'expo-constants';

let Google = null;
try { Google = require('@react-native-google-signin/google-signin'); } catch {}

const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
const CLIENT_IOS = String(extra.googleIosClientId || '').trim();
const CLIENT_WEB = String(extra.googleWebClientId || '').trim();

export function googleModuleCharge() {
  return !!Google?.GoogleSignin?.signIn;
}

export function googleDisponible() {
  if (!googleModuleCharge()) return false;
  if (Platform.OS === 'ios') return !!CLIENT_IOS;
  if (Platform.OS === 'android') return !!CLIENT_WEB;
  return false;
}

// `configure` est synchrone et idempotent, mais on ne l appelle qu une fois :
// le SDK garde l etat au niveau du module natif.
let configure = false;
function configurer() {
  if (configure || !googleDisponible()) return;
  Google.GoogleSignin.configure({
    iosClientId: CLIENT_IOS || undefined,
    webClientId: CLIENT_WEB || undefined,
    scopes: ['email', 'profile'],
    offlineAccess: false,
  });
  configure = true;
}

export const GOOGLE_ANNULE = 'GOOGLE_ANNULE';

function annulation() {
  const err = new Error('Connexion Google annulée');
  err.code = GOOGLE_ANNULE;
  return err;
}

// Ouvre la feuille Google. Leve GOOGLE_ANNULE si l utilisateur ferme.
export async function connexionGoogle() {
  if (!googleDisponible()) throw new Error('Connexion Google indisponible.');
  configurer();
  const { GoogleSignin, statusCodes } = Google;

  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  // On deconnecte d abord : sans ca, un compte deja choisi reconnecte en
  // silence et l utilisateur ne peut plus changer de compte. Google montre
  // toujours le selecteur dans ses propres apps.
  try { await GoogleSignin.signOut(); } catch {}

  let res;
  try {
    res = await GoogleSignin.signIn();
  } catch (e) {
    const code = e?.code;
    if (code === statusCodes?.SIGN_IN_CANCELLED || code === '-5' || code === -5) throw annulation();
    throw e;
  }

  // SDK >= 13 : { type: 'success' | 'cancelled', data }. Avant : l objet nu.
  if (res?.type === 'cancelled') throw annulation();
  const data = res?.data || res || {};
  const user = data.user || {};
  const identityToken = data.idToken || user.idToken || '';
  if (!identityToken) throw new Error("Google n'a pas renvoyé de jeton.");

  return {
    identityToken,
    prenom: user.givenName || '',
    nom: user.familyName || '',
  };
}
