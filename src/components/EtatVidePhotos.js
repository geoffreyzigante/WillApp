// Etat vide "pas de photos" — mirror exact du site (event/index.html
// .photos-empty-stack) : une rangee de cases fantomes en fond, mascotte +
// phrase posees dessus, centrees sur les deux axes.
//
// Contrairement au site, pas de fondu au centre (mask-image la-bas) : sur
// l app les cases restent en aplat plein.
import React from 'react';
import { View, Text } from 'react-native';
import { IlluPasDePhotos } from './IlluPasDePhotos';
import { C } from '../constants/colors';

export function EtatVidePhotos({
  texte = 'Pas encore de photos capturées',
  sousTexte = "Reviens le jour de l'event",
  illuHeight = 72,
  nbCases = 3,
  style = null,
}) {
  return (
    <View style={[{ paddingVertical: 12, position: 'relative' }, style]}>
      <View style={{ flexDirection: 'row', gap: 6 }} pointerEvents="none">
        {Array.from({ length: nbCases }).map((_, i) => (
          <View
            key={i}
            style={{ flex: 1, aspectRatio: 1, borderRadius: 12, backgroundColor: '#EDE7FF' }}
          />
        ))}
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14,
        }}
      >
        <IlluPasDePhotos height={illuHeight} />
        <View style={{ alignItems: 'flex-start', gap: 3, flexShrink: 1 }}>
          <Text style={{
            color: '#C9B6FF', fontSize: 18, lineHeight: 20,
            fontFamily: 'AVEstiana-Bold', letterSpacing: -0.2,
          }}>
            {texte}
          </Text>
          {sousTexte ? (
            <Text style={{ color: C.text, fontSize: 12, fontFamily: 'Montserrat-Medium' }}>
              {sousTexte}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
