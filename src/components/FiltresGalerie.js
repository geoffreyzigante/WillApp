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
// La rangee des postes n existe que si la course choisie en compte plus d un
// — sinon elle ne filtrerait rien. Et quand l event n a qu une seule course,
// les postes remontent au niveau 1 : il n y a rien a hierarchiser.

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { C } from '../constants/colors';
import { FavStar } from './FavStar';

const NIVEAU = {
  1: {
    police: 'Montserrat-SemiBold',
    taille: 10.5,
    hauteur: 30,
    padH: 12,
    fond: '#EFE7FF',
    texte: C.primary,
    fondActif: C.primary,
    texteActif: '#fff',
  },
  2: {
    police: 'Montserrat-Medium',
    taille: 9,
    hauteur: 26,
    padH: 10,
    fond: '#F6F4FA',
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
        <Text
          style={{
            fontFamily: 'Montserrat-Medium',
            fontSize: n.taille - 0.5,
            marginLeft: 4,
            color: actif ? n.texteActif : n.texte,
            opacity: actif ? 0.75 : 0.55,
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: padH, paddingRight: padH + 8 }}
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
  );
}

export function FiltresGalerie({
  courses = [],
  postes = [],
  courseActive = 'all',
  posteActif = 'all',
  onCourse,
  onPoste,
  sortDesc,
  onSort,
  favOnly,
  onFav,
  isAuthed = false,
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
    <View style={{ backgroundColor: C.bg, paddingTop: 4, paddingBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Rangee items={rangee1} actif={actif1} niveau={1} onChange={change1} padH={padH} />
        </View>

        {/* Tri et favoris restent hors du defilement horizontal : ce sont des
            actions, pas des filtres, et elles doivent toujours tomber au
            meme endroit. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: padH, paddingLeft: 2 }}>
          <TouchableOpacity
            onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} onSort(); }}
            hitSlop={10}
            activeOpacity={0.7}
            accessibilityLabel={sortDesc ? 'Trier du plus ancien au plus recent' : 'Trier du plus recent au plus ancien'}
            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#EDE4FF', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M7 4v16M3 16l4 4 4-4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M17 20V4M13 8l4-4 4 4" stroke={C.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          {isAuthed && (
            <TouchableOpacity
              onPress={() => { try { Haptics?.selectionAsync?.(); } catch {} onFav(); }}
              hitSlop={10}
              activeOpacity={0.7}
              accessibilityLabel={favOnly ? 'Afficher toutes les photos' : 'Afficher uniquement les favoris'}
              style={{
                width: 30, height: 30, borderRadius: 15, marginLeft: 6,
                backgroundColor: favOnly ? C.primary : '#EDE4FF',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <FavStar size={14} fill={favOnly ? '#fff' : C.primary} stroke={favOnly ? '#fff' : C.primary} strokeWidth={1.8} halo={false} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {rangee2.length > 1 && (
        <View style={{ marginTop: 5 }}>
          <Rangee items={rangee2} actif={posteActif} niveau={2} onChange={onPoste} padH={padH} />
        </View>
      )}
    </View>
  );
}
