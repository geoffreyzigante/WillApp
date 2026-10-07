// Interlignage sur Android : garde-fou.
//
// Le probleme, mesure sur les fichiers de police du projet :
//   AV_Estiana-VF  -> ascent 980 + descent 320 sur 1000 upem = 1,300 x la taille
//   Montserrat-*   -> 968 + 251                              = 1,219 x la taille
// C'est la hauteur de ligne NATURELLE de la police. iOS accepte un interlignage
// plus serre que ca : il se contente de rapprocher les lignes. Android, non :
// quand lineHeight passe sous cette valeur, la derniere ligne sort de la boite
// mesuree et disparait purement et simplement (vu sur "Tes photos avant meme /
// la ligne d'arrivee" : la 2e ligne absente a l'ecran, presente dans le code).
//
// lh() desserre donc l'interlignage jusqu'au minimum naturel, UNIQUEMENT sur
// Android. Sur iOS et sur le web la valeur demandee par la maquette passe
// telle quelle : aucun ecran valide ne bouge.
//
//   lineHeight: lh(26, 30)                -> iOS 30, Android 34
//   lineHeight: lh(16, 18, 'Montserrat')  -> iOS 18, Android 20

import { Platform } from 'react-native';

const RATIO = { AVEstiana: 1.3, Montserrat: 1.219 };

export function lh(fontSize, demande, police = 'AVEstiana') {
  if (Platform.OS !== 'android') return demande;
  const ratio = police.startsWith('Montserrat') ? RATIO.Montserrat : RATIO.AVEstiana;
  return Math.max(demande, Math.ceil(fontSize * ratio));
}
