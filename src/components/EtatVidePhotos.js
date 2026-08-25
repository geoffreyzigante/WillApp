// Etat vide "pas de photos" — mirror exact du site (event/index.html
// .photos-empty-stack) : une rangee de cases fantomes en fond, mascotte +
// phrase posees dessus, centrees sur les deux axes.
//
// Le fondu du site est un mask-image (cases pleines aux bords, effacees au
// centre). react-native ne connait pas les masks : on pose a la place un
// degrade de la couleur du fond par-dessus, opaque au centre, transparent
// aux extremites. Meme rendu tant que le fond reste C.bg.
import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IlluPasDePhotos } from './IlluPasDePhotos';
import { C } from '../constants/colors';

export function EtatVidePhotos({
  texte = 'Pas encore de photos capturées',
  sousTexte = null,
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
      <LinearGradient
        colors={[`${C.bg}00`, C.bg, `${C.bg}00`]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}
      >
        <IlluPasDePhotos height={illuHeight} />
        <View style={{ alignItems: 'flex-start', gap: 3, flexShrink: 1 }}>
          <Text style={{
            color: C.text, fontSize: 17, lineHeight: 19,
            fontFamily: 'AVEstiana-Bold', letterSpacing: -0.2,
          }}>
            {texte}
          </Text>
          {sousTexte ? (
            <Text style={{ color: C.primary, fontSize: 12, fontFamily: 'Montserrat-Medium' }}>
              {sousTexte}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
