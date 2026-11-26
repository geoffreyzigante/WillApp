/* Genere par charte/generer.mjs depuis charte/tokens.json.
   Ne pas editer a la main. */

export const T = {
  _lisezmoi: "Source unique de la charte Will. Toute valeur qui doit etre identique entre l app et le site vit ici, et nulle part ailleurs. Les deux facades la lisent : le site par charte/tokens.css, l app par WillApp/src/constants/tokens.js. Modifier une valeur ici la change des deux cotes ; l ecrire en dur ailleurs est ce qui a fait diverger les deux formulaires.",
  couleur: {
    primaire: "#7B2FFF",
    primaireSurvol: "#6B25E5",
    primaireClair: "#E8DEFF",
    rose: "#f4a6ff",
    degrade: [
      "#7B2FFF",
      "#9E5BFF",
      "#D67CF8"
    ],
    texte: "#1A1426",
    texteDoux: "#6b6480",
    texteChamp: "#4a4458",
    champFond: "#F5F3FA",
    champFondActif: "#F0ECFA",
    champTexteFantome: "#a8a2b8",
    filet: "#efeaf8",
    encart: "#FAF8FF",
    erreur: "#B42318",
    attente: {
      fond: "#FEF3C7",
      texte: "#b45309"
    },
    orga: {
      _note: "Accent des espaces organisateur et photographe (decision Geoffrey, 26/11). Le violet reste la couleur du coureur ; les teintes d event ne changent pas.",
      accent: "#1A1426",
      accentSurvol: "#000000",
      accentClair: "#F2F1F4"
    }
  },
  rayon: {
    champ: 12,
    bloc: 14,
    carte: 18,
    pastille: 999
  },
  hauteur: {
    champ: 50,
    bouton: 52,
    pastille: 38
  },
  typo: {
    titre: "AVEstiana",
    texte: "Montserrat",
    libelle: {
      taille: 11,
      graisse: 600,
      interlettre: 0.8,
      capitales: true
    },
    champ: {
      taille: 15
    },
    aide: {
      taille: 12
    }
  },
  onglets: {
    epaisseurSoulignage: 5,
    couleurSoulignage: "#f4a6ff"
  }
};

export const DEGRADE = T.couleur.degrade;
