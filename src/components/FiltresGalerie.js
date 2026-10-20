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
    taille: 10.5,
    hauteur: 30,
    padH: 12,
    // C.pillBg, la valeur de la charte — et non le #EDE4FF pose en dur dans
    // l ecran : deux violets a deux points d ecart sur la meme ligne.
    fond: C.pillBg,
    texte: C.primary,
    fondActif: C.primary,
    texteActif: '#fff',
  },
  2: {
    police: 'Montserrat-Medium',
    taille: 9,
    hauteur: 26,
    padH: 10,
    // Blanc, et non un gris clair : sur le fond lavande de l app (#F5F3FF),
    // un #F6F4FA ne se distingue pas du fond. La hierarchie reste portee par
    // la taille et la graisse du texte.
    fond: C.bg,
    texte: '#5a5468',
    fondActif: '#1A1426',
    texteActif: '#fff',
  },
};

function Puce({ libelle, compte, actif, niveau, onPress }) {
  const n = NIVEAU[niveau];
  return (
    <TouchableOpacity
      onPress={() => {
        try { Haptics?.selectionAsync?.(); } catch {}
        onPress();
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected: actif }}
      style={{
        height: n.hauteur,
        paddingHorizontal: n.padH,
        borderRadius: n.hauteur / 2,
        backgroundColor: actif ? n.fondActif : n.fond,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 6,
      }}
    >
      <Text style={{ fontFamily: n.police, fontSize: n.taille, color: actif ? n.texteActif : n.texte }}>
        {libelle}
      </Text>
      {compte != null && (
        // Pas d opacite sur le compte : a 55 % le violet tombait a 2,35:1 sur
        // la pastille et le gris a 2,54:1 sur le blanc, tres en dessous des
        // 4,5:1 exiges. C est la graisse et la taille qui le mettent en
        // retrait, pas la transparence.
        <Text
          style={{
            fontFamily: 'Montserrat-Medium',
            fontSize: n.taille - 0.5,
            marginLeft: 4,
            color: actif ? n.texteActif : n.texte,
          }}
        >
          {compte}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function Rangee({ items, actif, niveau, onChange, padH }) {
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
            compte={it.count}
            actif={String(it.key) === String(actif)}
            niveau={niveau}
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
}) {
  // Un seul niveau a afficher : les postes prennent la place des courses,
  // dans le style du niveau 1. Rien a hierarchiser avec une seule rangee.
  const seulementPostes = courses.length <= 1 && postes.length > 1;
  const rangee1 = seulementPostes ? postes : courses;
  const actif1 = seulementPostes ? posteActif : courseActive;
  const change1 = seulementPostes ? onPoste : onCourse;
  const rangee2 = seulementPostes ? [] : postes;

  if (rangee1.length <= 1) return null;

  return (
    <View style={{ backgroundColor: C.fondApp, paddingTop: 8, paddingBottom: 8 }}>
      <Rangee items={rangee1} actif={actif1} niveau={1} onChange={change1} padH={padH} />

      {rangee2.length > 1 && (
        <View style={{ marginTop: 8 }}>
          <Rangee items={rangee2} actif={posteActif} niveau={2} onChange={onPoste} padH={padH} />
        </View>
      )}
    </View>
  );
}
