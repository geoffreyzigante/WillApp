// Violet de la marque avec le grain de points de la charte (hero-noise du site,
// tuile de 128 pt) : remplace les degrades violets, comme sur will-app.com.
// Le grain est pose sous le contenu et ne reagit pas au toucher.
//
// Les deux fichiers hero-noise.png / hero-noise@2x.png sont identiques : le
// @2x impose une tuile de 128 pt sur les ecrans Retina, comme background-size
// 128px sur le site.

import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

const GRAIN = require('../../assets/hero-noise.png');

export function GrainViolet({ style, children, color = '#7B2FFF', ...reste }) {
  return (
    <View {...reste} style={[{ backgroundColor: color, overflow: 'hidden' }, style]}>
      <Image
        source={GRAIN}
        resizeMode="repeat"
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </View>
  );
}
