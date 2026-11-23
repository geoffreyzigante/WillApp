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

export function CtaWill({ label, onPress, variante = 'pink', hauteur = 40, style }) {
  const { bg, fg } = VARIANTES[variante] || VARIANTES.pink;
  const r = Math.round(hauteur * 0.35);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[{ flexDirection: 'row', alignSelf: 'flex-start' }, style]}>
      <View style={{ height: hauteur, paddingHorizontal: 17, borderRadius: r, backgroundColor: bg, justifyContent: 'center' }}>
        <Text style={{ color: fg, fontFamily: 'Montserrat-Medium', fontSize: 14 }}>{label}</Text>
      </View>
      <View style={{ width: hauteur, height: hauteur, marginLeft: -2, borderRadius: r, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={17} height={10} viewBox="0 0 22 12" fill="none">
          <Path d="M1 6h19M15.2 1.3L20.5 6l-5.3 4.7" stroke={fg} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </TouchableOpacity>
  );
}
