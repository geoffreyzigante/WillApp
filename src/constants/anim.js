// Tokens d'animation — une seule source pour toute l'app.
//
// Avant ce fichier : 15 durées différentes et 4 familles de courbes, chacune
// écrite au cas par cas. Rien ne semblait cohérent parce que rien ne l'était.
//
// Les valeurs ne sont pas inventées : ce sont celles de BurgerMenuModal et
// ProfileMenuModal, les deux transitions déjà réussies de l'app. On les
// promeut en référence au lieu d'en réinventer une par écran.
//
// La règle qui fait tout, commune aux HIG d'Apple et à Material : ce qui
// ARRIVE décélère, ce qui PART accélère. Une entrée et une sortie n'ont ni la
// même courbe ni la même durée — une sortie doit être plus courte, sinon
// l'interface paraît collante.

import { Easing } from 'react-native';

export const COURBE = {
  // Ce qui arrive : démarre vite, se pose doucement.
  entree: Easing.bezier(0.22, 1, 0.36, 1),
  // Ce qui part : démarre doucement, s'efface vite.
  sortie: Easing.bezier(0.4, 0, 0.6, 1),
  // Un déplacement à l'intérieur d'un écran, sans apparition ni disparition.
  deplacement: Easing.bezier(0.4, 0, 0.2, 1),
};

export const DUREE = {
  // Un élément qu'on retire sans cérémonie (libellé, pastille).
  retrait: 150,
  // Une sortie : panneau qui se referme, étape qu'on quitte.
  sortie: 200,
  // Le contenu d'un panneau qui apparaît.
  contenu: 220,
  // Une entrée : panneau, modale, étape qui arrive.
  entree: 280,
};

// Le contenu entre légèrement après son conteneur : le panneau se place, puis
// ce qu'il contient se révèle. Sans ce décalage, tout arrive en bloc et c'est
// précisément ce qui fait « brusque ».
export const DECALAGE_CONTENU = 80;

// Raccourcis prêts à l'emploi pour Animated.timing.
export const entrant = (duration = DUREE.entree) => ({
  duration, easing: COURBE.entree, useNativeDriver: true,
});
export const sortant = (duration = DUREE.sortie) => ({
  duration, easing: COURBE.sortie, useNativeDriver: true,
});
