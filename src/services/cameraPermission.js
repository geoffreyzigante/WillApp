// Autorisation camera demandee AVANT d ouvrir l ecran selfie.
//
// Constat 2026-11-27 : sur un iPhone 12 (iOS 27.2.1), l app se ferme des qu on
// touche « Prendre mon selfie » sur une installation neuve. L ecran camera
// demandait l autorisation en s ouvrant : la feuille systeme arrive pendant la
// presentation du Modal (lui-meme enfant d un autre Modal a l inscription),
// puis la session camera demarre pendant que iOS referme la feuille. Le delai
// de 600 ms ajoute le 28/08 ne suffit pas a coup sur.
//
// Ici : on demande l autorisation depuis le bouton, hors de tout Modal en
// cours de presentation, on laisse la feuille se refermer, et seulement
// ensuite on ouvre l ecran camera. Jamais bloquant : en cas d erreur ou de
// refus, l ecran s ouvre quand meme et affiche son propre message.

import { Camera } from 'react-native-vision-camera';

const APRES_FEUILLE_MS = 900;

export async function permissionCameraAvantOuverture() {
  try {
    const statut = Camera.getCameraPermissionStatus();
    if (statut !== 'not-determined') return;
    await Camera.requestCameraPermission();
    await new Promise((resolve) => setTimeout(resolve, APRES_FEUILLE_MS));
  } catch (e) {
    // On ne bloque jamais l ouverture de l ecran camera.
  }
}
