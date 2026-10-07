// Etat vide "pas de photos" — mascotte + phrase, comme le site
// (event/index.html .photos-empty-legende). Les cases fantomes du site ne
// sont pas reprises sur l app : elles reprenaient la grille photos, qui est
// deja absente ici.
import React from 'react';
import { View, Text } from 'react-native';
import { IlluPasDePhotos } from './IlluPasDePhotos';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';

export function EtatVidePhotos({
  texte = 'Pas encore de photos capturées',
  sousTexte = "Reviens le jour de l'event",
  illuHeight = 72,
  style = null,
}) {
  return (
    <View style={[{
      paddingVertical: 40,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14,
    }, style]}>
      <IlluPasDePhotos height={illuHeight} />
      <View style={{ alignItems: 'flex-start', gap: 3, flexShrink: 1 }}>
        <Text style={{
          color: '#C9B6FF', fontSize: 18, lineHeight: lh(18, 20),
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
  );
}
