// formLignes — la grammaire des formulaires d event (26/11).
// -----------------------------------------------------------------------
// Partagee par « Modifier mon event » (EditEventSheet) et « Lancer mon
// event » (CreateEventModal, App.js), jumelles du web (CSS « Refonte du
// 26/11 » de will-launch-event-modal.js) et du dashboard (evf-*).
//
// Un bloc = des lignes sur fond #F5F3FA separees d 1 px (le fond du bloc,
// #E9E5F3, passe entre elles). Libelle gris a gauche, champ blanc a droite.
//
// Ces briques vivent hors des composants : un composant redefini a chaque
// rendu perdrait le focus du champ a chaque frappe.

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';

// Valeurs de la maquette (evf-* dans dashboard/src/design/styles.css).
export const V = {
  texte: '#1A1426',
  libelle: '#6b6480',
  placeholder: '#a8a2b8',
  ligne: '#F5F3FA',
  filet: '#E9E5F3',
  bord: '#E6E1F2',
  bordManque: '#E8B4BC',
  actif: C.primary,
};

export function Bloc({ children }) {
  const lignes = React.Children.toArray(children).filter(React.isValidElement);
  const n = lignes.length;
  return (
    <View style={{ backgroundColor: V.filet, borderRadius: 14, gap: 1 }}>
      {lignes.map((l, i) => React.cloneElement(l, { coinHaut: i === 0, coinBas: i === n - 1 }))}
    </View>
  );
}

export function coins(coinHaut, coinBas) {
  return {
    borderTopLeftRadius: coinHaut ? 14 : 0, borderTopRightRadius: coinHaut ? 14 : 0,
    borderBottomLeftRadius: coinBas ? 14 : 0, borderBottomRightRadius: coinBas ? 14 : 0,
  };
}

// Texte sous une ligne : aide (gris) ou erreur (rouge), sur toute la largeur.
function SousLigne({ erreur, children }) {
  return (
    <Text style={{ fontFamily: 'Montserrat', fontSize: 12.5, lineHeight: lh(12.5, 17.5, 'Montserrat'), color: erreur ? C.error : V.libelle }}>
      {children}
    </Text>
  );
}

// libelle      : texte gris a gauche (rouge si `manque` ou `erreur`).
// seule        : ligne pleine largeur sans libelle (nom, description).
// libelleDessus: libelle au-dessus du contenu, pleine largeur (puces du type).
// aide, erreur : une ligne de texte sous le contenu, dans la meme ligne.
export function Ligne({ libelle, manque, erreur, aide, libelleDessus, children, coinHaut, coinBas, seule, style }) {
  const rouge = manque || !!erreur;
  const texteLibelle = libelle ? (
    <Text style={[
      { fontFamily: 'Montserrat', fontSize: 14, color: rouge ? C.error : V.libelle },
      libelleDessus ? null : { width: 92 },
    ]}>
      {libelle}
    </Text>
  ) : null;
  const dessous = erreur || aide;
  const empile = libelleDessus || !!dessous;
  const ligneBase = {
    paddingLeft: seule ? 8 : 14, paddingRight: 8,
    backgroundColor: V.ligne,
  };
  if (!empile) {
    return (
      <View style={[ligneBase, {
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54,
        paddingVertical: seule ? 8 : 0,
      }, coins(coinHaut, coinBas), style]}>
        {texteLibelle}
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[ligneBase, { paddingVertical: libelleDessus ? 12 : 8, gap: libelleDessus ? 10 : 6 }, coins(coinHaut, coinBas)]}>
      {libelleDessus ? (
        <>
          {texteLibelle}
          <View style={style}>{children}</View>
        </>
      ) : (
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 38 }, style]}>
          {texteLibelle}
          <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
        </View>
      )}
      {dessous ? (
        <View style={{ paddingLeft: seule ? 6 : 0, paddingRight: 6 }}>
          <SousLigne erreur={!!erreur}>{erreur || aide}</SousLigne>
        </View>
      ) : null}
    </View>
  );
}

export function cadreChamp(actif, manque) {
  const bw = actif ? 2 : 1;
  return {
    height: 38, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: bw, borderColor: actif ? V.actif : (manque ? V.bordManque : V.bord),
    // La bordure s epaissit au focus : on retire d autant le retrait interieur
    // pour que le texte ne bouge pas.
    paddingHorizontal: 10 - (bw - 1),
  };
}

export function Champ({ manque, style, onFocus, onBlur, multiline, ...props }) {
  const [actif, setActif] = useState(false);
  return (
    <TextInput
      {...props}
      multiline={multiline}
      placeholderTextColor={manque ? C.error : V.placeholder}
      onFocus={(e) => { setActif(true); onFocus?.(e); }}
      onBlur={(e) => { setActif(false); onBlur?.(e); }}
      style={[
        cadreChamp(actif, manque),
        { fontFamily: 'Montserrat', fontSize: 15, color: V.texte, paddingVertical: 0 },
        multiline && { height: undefined, minHeight: 84, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' },
        style,
      ]}
    />
  );
}

// Champ qui ouvre un selecteur (type, date, heure) : meme cadre qu un champ.
export function ChampBouton({ valeur, placeholder, manque, onPress, style, centre }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[cadreChamp(false, manque), { justifyContent: 'center', alignItems: centre ? 'center' : 'flex-start' }, style]}
    >
      <Text
        numberOfLines={1}
        style={{ fontFamily: 'Montserrat', fontSize: 15, color: valeur ? V.texte : (manque ? C.error : V.placeholder) }}
      >
        {valeur || placeholder}
      </Text>
    </TouchableOpacity>
  );
}

export function TitreSection({ children, premier }) {
  return (
    <Text style={{ fontFamily: 'AVEstiana', fontSize: 19, color: V.texte, marginTop: premier ? 0 : 26, marginBottom: 10, marginLeft: 4 }}>
      {children}
    </Text>
  );
}

export function Pied({ erreur, children }) {
  return (
    <Text style={{ fontFamily: 'Montserrat', fontSize: 12.5, lineHeight: lh(12.5, 17.5, 'Montserrat'), color: erreur ? C.error : V.libelle, marginTop: 8, marginHorizontal: 4 }}>
      {children}
    </Text>
  );
}

export function AjouterEpreuve({ onPress, coinHaut, coinBas }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[{ minHeight: 54, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: V.ligne }, coins(coinHaut, coinBas)]}
    >
      <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 15, color: C.primary }}>+ Ajouter une épreuve</Text>
    </TouchableOpacity>
  );
}
