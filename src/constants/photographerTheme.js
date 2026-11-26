// Tokens de la vue photographe — handoff design 2026-08-20.
//
// Valeurs reprises telles quelles du paquet `design_handoff_vue_photographe`
// (README.md § Design Tokens). Ne pas improviser de nuance ici : si une
// couleur manque, elle manque aussi dans le handoff, et c est au design de
// trancher.
//
// ─── POURQUOI DU BLANC OPAQUE ET PAS DU VERRE DEPOLI ────────────────────
// Le brief initial parlait de givre. Le design final l a ecarte, pour deux
// raisons qui tiennent au terrain et pas au gout :
//
//   1. L ecran est tenu a bout de bras, dehors, parfois en plein soleil
//      rasant. Un panneau translucide pose sur un chemin clair ou sur le
//      ciel fait litteralement disparaitre le texte.
//   2. Le flou coute du GPU, le GPU chauffe, et un telephone qui chauffe
//      ralentit la capture — donc moins de photos par coureur.
//
// D ou la regle : AUCUN flou au-dessus du flux video. Tout ce qui porte du
// texte est un aplat opaque, tout trait blanc pose sur l image porte un
// halo sombre pour garantir son contraste independamment du fond.

import { T } from './tokens';

// Espaces organisateur et photographe au noir de la charte (decision
// Geoffrey, 26/11) : les violets d accent du handoff passent sur
// T.couleur.orga. Les surfaces, filets et libelles restent ceux du handoff.
export const P = {
  // Surfaces
  appBg: '#F6F3FF',            // fond de l ecran
  surface: '#FFFFFF',          // rangees de commande, panneaux
  surfacePressed: T.couleur.orga.accentClair, // rangee blanche pressee, puce inactive (etait #F0EAFC)
  panelPressed: '#F6F3FF',     // rangee de panneau pressee
  framePlaceholder: '#DCCFF7', // fond du cadre avant le flux camera

  // Accents (noir orga depuis le 26/11, violets avant)
  brand: T.couleur.orga.accent, // titre, valeurs, glyphe retour (etait #8B2FE8)
  ink: T.couleur.orga.accent,   // texte des panneaux et de la molette (etait #4A0E96)
  soft: T.couleur.orga.accentClair, // fond du bouton retour (etait #E7DEFB)
  softPressed: '#E4E2E8',      // bouton retour presse (etait #D9CBF8 ; gris un cran sous accentClair)
  wheelBand: T.couleur.orga.accentClair, // bande de selection de la molette (etait #F2EDFD)
  divider: '#F0EAFC',          // filets 1 px

  // Libelles
  label: '#C6B6E8',            // libelles de rangee, chevrons
  labelMuted: '#B7A8D4',       // ligne de compteurs sous le cadre
  labelPanel: '#4F3F75',       // compteurs dans le panneau

  // Accents
  stop: '#FF97A9',
  stopPressed: '#F5859A',
  accent: '#FA8A9C',           // marqueur « Actif »
  danger: '#C4141F',           // deconnexion

  // Voyant de luminosite
  lightGood: '#34C759',
  lightMid: '#FF9F0A',
  lightLow: '#FA3C4C',
};

// ─── Geometrie ────────────────────────────────────────────────────────────
// Le handoff decrit un empilement vertical. On le calcule en dur plutot que
// de le laisser au layout en flux, parce que FramingGuide attend un
// rectangle en coordonnees FENETRE : les deux doivent decrire exactement le
// meme cadre, sinon le guide de cadrage ment au benevole.

export const G = {
  frameMargin: 18,       // marges laterales du cadre camera
  frameRadius: 14,
  framePad: 8,           // marge interieure (panneaux poses dans le cadre)
  rowH: 40,              // rangee de commande
  rowRadius: 14,
  rowGap: 8,
  panelRowH: 50,         // rangee de panneau
  backW: 50,
  backH: 38,
  backRadius: 12,
  panelRadius: 12,
  titlePadTop: 14,
  titlePadBottom: 10,
  gutter: 18,            // marges laterales de l ecran
  rowPadH: 20,
};

// Hauteur de la barre de titre, bordures comprises. Sert au calcul du haut
// du cadre camera — a garder synchronise avec le JSX de la barre.
export const TITLE_BAR_H = G.titlePadTop + G.backH + G.titlePadBottom;

// ─── Ombres ───────────────────────────────────────────────────────────────
// `elevation` est obligatoire en plus des `shadow*` : les proprietes shadow
// d iOS n ont aucun effet sur Android (cf AUDIT_ANDROID_JS.md §3).

export const panelShadow = {
  shadowColor: '#281446',
  shadowOpacity: 0.3,
  shadowRadius: 30,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
};

export const handleShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 3 },
  elevation: 6,
};

// Halo sombre pour un trait blanc pose sur la video. Plus utilise depuis le
// retrait de tout marquage permanent sur le flux (2026-08-20), mais conserve :
// c est la recette a reprendre si un repere doit un jour revenir sur l image.
// Sans lui, un trait blanc disparait purement et simplement sur un ciel clair.
export const guideShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 0 },
  elevation: 3,
};
