// Violet de la marque avec le grain de points de la charte (hero-noise du site,
// tuile de 128 pt) : remplace les degrades violets, comme sur will-app.com.
// Le grain est pose sous le contenu et ne reagit pas au toucher.
//
// Les deux fichiers hero-noise.png / hero-noise@2x.png sont identiques : le
// @2x impose une tuile de 128 pt sur les ecrans Retina, comme background-size
// 128px sur le site.
//
// Android ET iOS : resizeMode="repeat" ne repete pas (l'image est posee une seule
// fois, a sa taille, puis le reste de la surface reste uni : constate sur la
// carte d'accueil, grain coupe a 256 pt). On pave donc a la main avec des
// tuiles de 128 pt mesurees sur la taille reelle du bloc.

import React, { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';

const GRAIN = require('../../assets/hero-noise.png');
const FLEUR_G = require('../../assets/hero-fl-l.webp');
const FLEUR_D = require('../../assets/hero-fl-r.webp');
const TUILE = 128;

function GrainPave({ largeur, hauteur }) {
  if (!largeur || !hauteur) return null;
  const cols = Math.ceil(largeur / TUILE);
  const lignes = Math.ceil(hauteur / TUILE);
  const tuiles = [];
  for (let j = 0; j < lignes; j++) {
    for (let i = 0; i < cols; i++) {
      tuiles.push(
        <Image
          key={`${i}-${j}`}
          source={GRAIN}
          style={{ position: 'absolute', left: i * TUILE, top: j * TUILE, width: TUILE, height: TUILE }}
        />
      );
    }
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>{tuiles}</View>;
}

// fleur : { taille, haut, gauche | droite } -> la fleur de marque en degrade lilas (hero-fl-l
// du site), posee en coin sous le contenu et rognee par le bord de la carte.
export function GrainViolet({ style, children, color = '#7B2FFF', onLayout, fleur, ...reste }) {
  const [taille, setTaille] = useState({ w: 0, h: 0 });
  const surLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setTaille((t) => (Math.abs(t.w - width) < 1 && Math.abs(t.h - height) < 1 ? t : { w: width, h: height }));
    if (onLayout) onLayout(e);
  };
  return (
    <View {...reste} onLayout={surLayout} style={[{ backgroundColor: color, overflow: 'hidden' }, style]}>
      <GrainPave largeur={taille.w} hauteur={taille.h} />
      {fleur ? (
        <Image
          source={fleur.droite != null ? FLEUR_D : FLEUR_G}
          pointerEvents="none"
          style={[
            { position: 'absolute', width: fleur.taille, height: fleur.taille, top: fleur.haut },
            fleur.droite != null ? { right: fleur.droite } : { left: fleur.gauche },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}
