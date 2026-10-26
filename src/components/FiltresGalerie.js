// Les filtres de la galerie d un event : la course, puis le poste.
//
// Avant, deux menus deroulants cote a cote (RaceDropdown). Choisir une
// course demandait trois gestes — ouvrir, lire, choisir — et le second menu
// n avait pas d autre role que de repeter l operation pour le poste. En
// puces, c est un seul tap, et toutes les options sont lisibles sans rien
// ouvrir : c est ce que font Google Photos et Instagram.
//
// Deux niveaux, deux styles (choix user 2026-10-20, variante typographique) :
//   - niveau 1, la COURSE  : 10.5 px SemiBold, violet. Le filtre principal.
//   - niveau 2, le POSTE   : 9 px Medium, gris. Visiblement subordonne, sans
//     ajouter ni bande de couleur ni icone ni indentation — rien n est pose
//     en plus a l ecran, c est la graisse qui classe.
// Le compte de photos est colle a chaque puce : un poste a 3 photos ne
// merite pas un tap, et ca se voit avant de taper.
//
// Le tri et les favoris ne sont plus ici : ce sont des actions, pas des
// filtres, et ils ont rejoint la recherche de dossard en bas d ecran (user
// 2026-10-20). La barre ne porte plus que ce qui filtre.
//
// La rangee des postes n existe que si la course choisie en compte plus d un
// — sinon elle ne filtrerait rien. Et quand l event n a qu une seule course,
// les postes remontent au niveau 1 : il n y a rien a hierarchiser.

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C } from '../constants/colors';

const NIVEAU = {
  1: {
    police: 'Montserrat-SemiBold',
    // 13, et 11,5 pour la seconde ligne (taille - 1,5). Apple fixe le plancher
    // de lisibilite a 11 pt : a 12, la seconde ligne tombait a 10,5, et elle
    // porte les horaires de depart et les comptes de photos — de l information
    // qu on doit lire, pas un libelle qu on reconnait. L ecart de 1,5 pt entre
    // les deux niveaux est conserve, donc la hierarchie ne bouge pas.
    taille: 13,
    hauteur: 34,
    // Valeur explicite plutot que hauteur / 2 : 17, dans l echelle, et qui ne
    // derive plus si la hauteur change.
    rayon: 17,
    padH: 14,
    // C.pillBg, la valeur de la charte — et non le #EDE4FF pose en dur dans
    // l ecran : deux violets a deux points d ecart sur la meme ligne.
    fond: C.pillBg,
    texte: C.primary,
    fondActif: C.primary,
    texteActif: '#fff',
    // Le compte est une quantite, pas un nom : il prend le gris de texte
    // courant (C.textSoft, 6,04:1 sur la pastille) pour qu on lise d abord
    // la course. Actif, tout passe en clair : C.pillBg donne 4,75:1 sur le
    // violet plein, juste au-dessus du seuil.
    compte: C.textSoft,
    compteActif: C.pillBg,
  },
  2: {
    police: 'Montserrat-Medium',
    // 11,5, et 11 pour le compte (taille - 0,5) : meme plancher. C est la
    // graisse, la couleur et la taille relative qui subordonnent ce niveau au
    // premier, pas le fait de passer sous le seuil de lisibilite.
    taille: 11.5,
    hauteur: 28,
    rayon: 14,
    padH: 10,
    // Blanc, et non un gris clair : sur le fond lavande de l app (#F5F3FF),
    // un #F6F4FA ne se distingue pas du fond. La hierarchie reste portee par
    // la taille et la graisse du texte.
    fond: C.bg,
    // Le libelle du poste passe a l encre : son compte prenant le gris, les
    // deux seraient devenus identiques si le libelle restait gris lui aussi.
    // L encre sur blanc reste en retrait du violet sur pastille, qui porte
    // le niveau 1.
    texte: '#1A1426',
    fondActif: '#1A1426',
    texteActif: '#fff',
    compte: C.textSoft,
    compteActif: C.pillBg,
  },
};

function Puce({ libelle, sous, compte, actif, niveau, inerte = false, onPress }) {
  const n = NIVEAU[niveau];
  // Deux lignes des qu une seconde ligne est fournie : le nom de course au
  // premier rang, et dessous ce qui sert au moment ou l on regarde — l heure
  // de depart et le denivele avant l event, le nombre de photos apres.
  const deuxLignes = !!sous;
  // RAYON. Une pilule prend la moitie de sa hauteur : 17 sur une puce de 34,
  // soit un point de l echelle. Sur deux lignes la puce monte a 46, donc 23 —
  // cinq points au-dela de 18, la plus grande valeur de l echelle. Le 999
  // cesse d etre conforme des que la puce grandit, sans que rien le signale.
  // On pose donc des valeurs explicites : 18 sur deux lignes, et la moitie de
  // la hauteur fixe sur une ligne, qui reste dans l echelle.
  const rayon = deuxLignes ? 18 : n.rayon;
  const Enveloppe = inerte ? View : TouchableOpacity;
  const propsTactiles = inerte ? {} : {
    onPress: () => {
      try { Haptics?.selectionAsync?.(); } catch {}
      onPress();
    },
    activeOpacity: 0.75,
    accessibilityRole: 'button',
    accessibilityState: { selected: actif },
  };
  return (
    <Enveloppe
      {...propsTactiles}
      style={{
        height: deuxLignes ? undefined : n.hauteur,
        paddingHorizontal: n.padH,
        // 10 et non 8 : sur deux lignes, 8 serrait le texte contre le bord
        // haut et bas de la pastille (user 2026-10-26). La puce passe de 46 a
        // 50 pt ; le rayon 18 reste dans l echelle, une pilule demanderait 25.
        paddingVertical: deuxLignes ? 10 : 0,
        borderRadius: rayon,
        backgroundColor: actif ? n.fondActif : n.fond,
        flexDirection: deuxLignes ? 'column' : 'row',
        alignItems: deuxLignes ? 'flex-start' : 'center',
        justifyContent: 'center',
        marginRight: 6,
      }}
    >
      <Text style={{ fontFamily: n.police, fontSize: n.taille, color: actif ? n.texteActif : n.texte }}>
        {libelle}
      </Text>
      {deuxLignes ? (
        <Text
          style={{
            fontFamily: 'Montserrat-Medium',
            fontSize: n.taille - 1.5,
            marginTop: 1,
            color: actif ? n.compteActif : n.compte,
          }}
        >
          {sous}
        </Text>
      ) : null}
      {!deuxLignes && compte != null && (
        // Pas d opacite sur le compte : a 55 % le violet tombait a 2,35:1 sur
        // la pastille et le gris a 2,54:1 sur le blanc, tres en dessous des
        // 4,5:1 exiges. C est la graisse et la taille qui le mettent en
        // retrait, pas la transparence.
        <Text
          style={{
            fontFamily: 'Montserrat-Medium',
            fontSize: n.taille - 0.5,
            marginLeft: 5,
            color: actif ? n.compteActif : n.compte,
          }}
        >
          {compte}
        </Text>
      )}
    </Enveloppe>
  );
}

function Rangee({ items, actif, niveau, onChange, padH, inerte = false }) {
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: padH, paddingRight: padH + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {items.map(it => (
          <Puce
            key={String(it.key)}
            libelle={it.label}
            sous={it.sous}
            compte={it.count}
            actif={!inerte && String(it.key) === String(actif)}
            niveau={niveau}
            inerte={inerte}
            onPress={() => onChange(it.key)}
          />
        ))}
      </ScrollView>
      {/* Une puce coupee net au bord droit se lit comme un defaut d affichage,
          pas comme une invitation a faire defiler. Le degrade vers le fond
          dit qu il y a une suite. Pose en overlay : il ne doit pas intercepter
          le geste de defilement. */}
      <LinearGradient
        pointerEvents="none"
        colors={[`${C.fondApp}00`, C.fondApp]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28 }}
      />
    </View>
  );
}

export function FiltresGalerie({
  courses = [],
  postes = [],
  courseActive = 'all',
  posteActif = 'all',
  onCourse,
  onPoste,
  padH = 20,
  // Avant l event il n y a aucune photo, donc rien a filtrer : la meme rangee
  // sert alors de fiche des courses. Elle n est pas cliquable, ne porte pas de
  // « Toutes » et n affiche aucun actif (fusion user 2026-10-26).
  inerte = false,
}) {
  // Un seul niveau a afficher : les postes prennent la place des courses,
  // dans le style du niveau 1. Rien a hierarchiser avec une seule rangee.
  const seulementPostes = courses.length <= 1 && postes.length > 1;
  const rangee1 = seulementPostes ? postes : courses;
  const actif1 = seulementPostes ? posteActif : courseActive;
  const change1 = seulementPostes ? onPoste : onCourse;
  const rangee2 = seulementPostes ? [] : postes;

  // SEUIL, derive de la regle commune de la page event : un niveau de CHOIX
  // n existe qu a partir de deux options, sinon il ne filtre rien ; un
  // PROGRAMME n est pas un choix, et une course unique reste a annoncer.
  // Ce n est donc pas deux cas mais une seule regle, lue des deux cotes.
  if (rangee1.length < (inerte ? 1 : 2)) return null;

  return (
    <View style={{ backgroundColor: C.fondApp, paddingTop: 8, paddingBottom: 8 }}>
      <Rangee items={rangee1} actif={actif1} niveau={1} onChange={change1} padH={padH} inerte={inerte} />

      {rangee2.length > 1 && (
        <View style={{ marginTop: 8 }}>
          <Rangee items={rangee2} actif={posteActif} niveau={2} onChange={onPoste} padH={padH} />
        </View>
      )}
    </View>
  );
}
