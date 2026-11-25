// CTA de la charte (will.css .cta) : libelle + pastille fleche, qui se
// chevauchent de 2 pt. Variantes : 'pink' (principal sur violet),
// 'v7' (secondaire sur violet), 'violet' (sur clair), 'white'.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const VARIANTES = {
  pink: { bg: '#F4A6FF', fg: '#3B0A96' },
  v7: { bg: '#5E1AD6', fg: '#FFFFFF' },
  violet: { bg: '#7B2FFF', fg: '#FFFFFF' },
  white: { bg: '#FFFFFF', fg: '#5E1AD6' },
};

export function CtaWill({ label, onPress, variante = 'pink', hauteur = 40, icone, style }) {
  const { bg, fg } = VARIANTES[variante] || VARIANTES.pink;
  const r = Math.round(hauteur * 0.35);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[{ flexDirection: 'row', alignSelf: 'flex-start' }, style]}>
      <View style={{ height: hauteur, paddingHorizontal: 17, borderRadius: r, backgroundColor: bg, justifyContent: 'center' }}>
        <Text style={{ color: fg, fontFamily: 'Montserrat-Medium', fontSize: 14 }}>{label}</Text>
      </View>
      <View style={{ width: hauteur, height: hauteur, marginLeft: -2, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {icone ? icone(fg) : (
          <Svg width={17} height={10} viewBox="0 0 22 12" fill="none">
            <Path d="M1 6h19M15.2 1.3L20.5 6l-5.3 4.7" stroke={fg} strokeWidth={1.95} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Epaisseur des traits : tous les pictos des pastilles visent ~1,5 pt a l ecran
// (strokeWidth = 1,5 / echelle du viewBox) ; le repere Itineraire (SVG fourni)
// y est deja (anneau 1,7 sur 16,97 rendu en 15 pt).
// Niveau 2 (CTA secondaire) : libelle sans fond + petite pastille qui porte
// une fleche (par defaut) ou l icone passee en `icone`. Variantes :
// 'violet' (sur clair), 'blanc' (sur image/couleur : pastille blanche translucide).
const VARIANTES_N2 = {
  violet: { fg: '#3B0A96', bg: '#E3D4FF', ic: '#3B0A96' },
  blanc: { fg: '#FFFFFF', bg: 'rgba(255,255,255,0.28)', ic: '#FFFFFF' },
  // Action destructive (Supprimer) : rouge d erreur de la charte.
  erreur: { fg: '#B42318', bg: '#F9E1E5', ic: '#B42318' },
};

export function CtaWill2({ label, onPress, variante = 'violet', icone, taille = 28, style, ...reste }) {
  const { fg, bg, ic } = VARIANTES_N2[variante] || VARIANTES_N2.violet;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} accessibilityRole="button" accessibilityLabel={label} style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }, style]} {...reste}>
      <Text style={{ color: fg, fontFamily: 'Montserrat-Medium', fontSize: 14 }}>{label}</Text>
      <View style={{ width: taille, height: taille, borderRadius: Math.round(taille * 0.36), backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        {icone || (
          <Svg width={15} height={9} viewBox="0 0 22 12" fill="none">
            <Path d="M1 6h19M15.2 1.3L20.5 6l-5.3 4.7" stroke={ic} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        )}
      </View>
    </TouchableOpacity>
  );
}
