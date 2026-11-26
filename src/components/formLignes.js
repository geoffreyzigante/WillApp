// formLignes — la grammaire des formulaires d event (26/11).
// -----------------------------------------------------------------------
// Partagee par « Modifier mon event » (EditEventSheet) et « Lancer mon
// event » (CreateEventModal, App.js), jumelles du web (CSS « Refonte du
// 26/11 » de will-launch-event-modal.js) et du dashboard (evf-*).
//
// Un bloc = des lignes sur fond #F5F3FA separees d 1 px (le fond du bloc,
// #E9E5F3, passe entre elles). Libelle gris a gauche, valeur a droite, sans
// cadre : c est la maquette validee le 26/11 (maquettes/modifier-event.html).
// Le champ ne prend un fond qu au focus. Une epreuve tient sur UNE ligne :
// son nom, puis trois pastilles blanches (distance, heure, D+).
//
// Ces briques vivent hors des composants : un composant redefini a chaque
// rendu perdrait le focus du champ a chaque frappe.

import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';
import { Icon } from './Icon';

// Valeurs de la maquette (evf-* dans dashboard/src/design/styles.css).
export const V = {
  texte: '#1A1426',
  libelle: '#6b6480',
  placeholder: '#a8a2b8',
  ligne: '#F5F3FA',
  filet: '#E9E5F3',
  bord: '#E6E1F2',
  bordManque: '#E8B4BC',
  actif: C.orga,
  focus: '#FFFFFF', // sur la ligne #F5F3FA, un fond pale ne se verrait pas
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

export function cadreChamp(actif) {
  // Pas de cadre : la ligne grise suffit a dire « modifiable ». Le fond
  // n apparait qu au focus, pour montrer ou l on ecrit.
  return {
    height: 38, borderRadius: 8, paddingHorizontal: 6,
    backgroundColor: actif ? V.focus : 'transparent',
  };
}

// aGauche : nom de l event, description. Par defaut la valeur est a droite.
export function Champ({ manque, style, onFocus, onBlur, multiline, aGauche, ...props }) {
  const [actif, setActif] = useState(false);
  return (
    <TextInput
      {...props}
      multiline={multiline}
      placeholderTextColor={manque ? C.error : V.placeholder}
      onFocus={(e) => { setActif(true); onFocus?.(e); }}
      onBlur={(e) => { setActif(false); onBlur?.(e); }}
      style={[
        cadreChamp(actif),
        { fontFamily: 'Montserrat', fontSize: 15, color: V.texte, paddingVertical: 0, textAlign: aGauche || multiline ? 'left' : 'right' },
        multiline && { height: undefined, minHeight: 84, paddingTop: 10, paddingBottom: 10, textAlignVertical: 'top' },
        style,
      ]}
    />
  );
}

// Champ qui ouvre un selecteur (type, date, heure) : valeur a droite, et
// l icone (noir orga) qui dit ce qui va s ouvrir.
export function ChampBouton({ valeur, placeholder, manque, onPress, style, centre, icone }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[cadreChamp(false), { flexDirection: 'row', alignItems: 'center', justifyContent: centre ? 'center' : 'flex-end', gap: 8 }, style]}
    >
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontFamily: 'Montserrat', fontSize: 15, color: valeur ? V.texte : (manque ? C.error : V.placeholder) }}
      >
        {valeur || placeholder}
      </Text>
      {icone === 'liste' ? (
        <Text style={{ fontFamily: 'Montserrat', fontSize: 15, color: C.orga, marginTop: -6 }}>⌄</Text>
      ) : icone === 'calendrier' ? (
        <Icon.Calendar size={17} color={C.orga} />
      ) : null}
    </TouchableOpacity>
  );
}

// Pastille blanche d une epreuve : un petit champ, ou un bouton (heure).
const pastille = { height: 32, borderRadius: 8, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' };
const textePastille = { fontFamily: 'Montserrat', fontSize: 14, color: V.texte, paddingVertical: 0 };

// Une epreuve = une ligne : nom a gauche, distance · heure · D+ a droite.
// Largeurs fixes : d une ligne a l autre, les pastilles font des colonnes.
export function LigneEpreuve({
  label, km, time, elevation, placeholderNom, kmManque, erreur,
  onLabel, onKm, onElevation, onHeure, onRetirer, onBlur, coinHaut, coinBas,
}) {
  return (
    <Ligne seule erreur={erreur} coinHaut={coinHaut} coinBas={coinBas}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38 }}>
        <Champ
          value={label}
          onChangeText={onLabel}
          onBlur={onBlur}
          aGauche
          placeholder={placeholderNom}
          accessibilityLabel="Nom de l'épreuve"
          autoCapitalize="sentences"
          maxLength={40}
          style={{ flex: 1, fontSize: 14 }}
        />
        <View style={[pastille, { width: 60, gap: 3 }, kmManque && { borderWidth: 1, borderColor: V.bordManque }]}>
          <TextInput
            value={km}
            onChangeText={onKm}
            onBlur={onBlur}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={kmManque ? C.error : V.placeholder}
            accessibilityLabel="Distance en km"
            style={[textePastille, { minWidth: 14, maxWidth: 34, textAlign: 'right' }]}
          />
          <Text style={[textePastille, { color: kmManque ? C.error : V.texte }]}>km</Text>
        </View>
        <TouchableOpacity onPress={onHeure} activeOpacity={0.7} accessibilityLabel="Heure de départ" style={[pastille, { width: 54 }]}>
          <Text style={[textePastille, !time && { color: V.placeholder }]}>{time || 'Heure'}</Text>
        </TouchableOpacity>
        <View style={[pastille, { width: 50, gap: 2 }]}>
          <TextInput
            value={elevation}
            onChangeText={onElevation}
            onBlur={onBlur}
            keyboardType="number-pad"
            placeholder="D+"
            placeholderTextColor={V.placeholder}
            accessibilityLabel="Dénivelé positif en mètres"
            style={[textePastille, { minWidth: 18, maxWidth: 38, textAlign: 'center' }]}
          />
          {elevation ? <Text style={textePastille}>m</Text> : null}
        </View>
        <TouchableOpacity
          onPress={onRetirer}
          hitSlop={8}
          accessibilityLabel="Retirer cette épreuve"
          style={{ width: 20, height: 32, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'Montserrat', fontSize: 13, color: V.placeholder }}>✕</Text>
        </TouchableOpacity>
      </View>
    </Ligne>
  );
}

export function TitreSection({ children, premier }) {
  return (
    // Violet de marque, un cran plus gros (demande du 26/11), comme l espace orga.
    <Text style={{ fontFamily: 'AVEstiana', fontSize: 23, lineHeight: lh(23, 28, 'AVEstiana'), color: C.primary, marginTop: premier ? 0 : 28, marginBottom: 12, marginLeft: 4 }}>
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
      <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 15, color: C.orga }}>+ Ajouter une épreuve</Text>
    </TouchableOpacity>
  );
}
