// Etat vide plein ecran de l onglet Photos : titre, phrase, et la mascotte
// plaquee en bas.
//
// Il servait a deux endroits de PhotosScreen — aucun event connu, et event
// connu mais pas encore de photo — copie-colle a l identique. Factorise ici
// pour qu il n existe qu une seule fois (2026-09-01).

import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import { IlluNoPhotos } from './IlluNoPhotos';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';

export function EtatVideMascotte({
  titre = 'Pas encore\nde photos',
  sousTexte,
  headerH = 0,
  margeLaterale = 20,
  // Hauteur deja occupee au-dessus du bloc (barre de filtres, bandeau…),
  // a retrancher pour que la mascotte reste au ras du menu sans deborder.
  reserve = 0,
}) {
  const { width, height } = Dimensions.get('window');
  // Hauteur utile : l ecran moins l entete et la zone du menu du bas. Sert a
  // plaquer la mascotte en bas meme quand le contenu est court.
  const hauteur = height - headerH - 150 - reserve;

  return (
    <View style={{ alignItems: 'center', minHeight: hauteur }}>
      {/* Le texte occupe tout l espace libre entre l entete et la mascotte et
          s y centre : il reste a la meme place quelle que soit la hauteur de
          l ecran. */}
      <View style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{
          fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 29,
          lineHeight: lh(29, 33), color: C.primary, textAlign: 'center',
        }}>
          {titre}
        </Text>
        <Text style={{
          fontFamily: 'Montserrat-Medium', fontSize: 13, color: C.text,
          textAlign: 'center', marginTop: 10,
        }}>
          {sousTexte}
        </Text>
      </View>

      {/* La mascotte est dessinee jusqu au bas de son cadre : marges laterales
          de la page annulees, marge basse du scroll mangee. */}
      <View
        pointerEvents="none"
        style={{
          alignSelf: 'stretch',
          marginHorizontal: -margeLaterale,
          marginBottom: -40,
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <IlluNoPhotos width={width} />
      </View>
    </View>
  );
}
