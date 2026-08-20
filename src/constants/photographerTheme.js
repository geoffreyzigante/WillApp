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

export const P = {
  // Surfaces
  appBg: '#F6F3FF',            // fond de l ecran
  surface: '#FFFFFF',          // rangees de commande, panneaux
  surfacePressed: '#F0EAFC',   // rangee blanche pressee
  panelPressed: '#F6F3FF',     // rangee de panneau pressee
  framePlaceholder: '#DCCFF7', // fond du cadre avant le flux camera

  // Violets
  brand: '#8B2FE8',            // titre, valeurs, glyphe retour
  ink: '#4A0E96',              // texte des panneaux et de la molette
  soft: '#E7DEFB',             // fond du bouton retour
  softPressed: '#D9CBF8',      // bouton retour presse
  wheelBand: '#F2EDFD',        // bande de selection de la molette
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

// Halo sombre des traits blancs poses sur la video. Sans lui, les reperes
// disparaissent sur un ciel clair — et ce sont eux qui servent a viser.
export const guideShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 0 },
  elevation: 3,
};
