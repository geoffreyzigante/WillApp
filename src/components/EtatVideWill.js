// Etats vides de l app : titre, phrase et, au besoin, un bouton. Plus de
// personnage : le texte suffit (retour user 2026-11-20). `variante` et
// `hauteurIllu` restent acceptes pour ne pas toucher les appels existants.

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C } from '../constants/colors';
import { lh } from '../constants/typo';

// Audit coureur 12 -- le composant n avait aucun onPress : c etait le seul
// ecran du parcours coureur ou l on ne pouvait rien faire. actionLabel /
// onAction sont optionnels, les appels existants ne changent pas.
export function EtatVideWill({
  variante = 'photos',
  titre,
  sousTexte,
  hauteurIllu = 200,
  style,
  actionLabel = null,
  onAction = null,
}) {
  return (
    <View style={[{ alignItems: 'center', paddingTop: 30, paddingBottom: 24 }, style]}>
      <Text style={{
        fontFamily: 'AVEstiana', fontStyle: 'normal', fontSize: 29,
        lineHeight: lh(29, 33), color: C.primary, textAlign: 'center',
      }}>
        {titre}
      </Text>
      {sousTexte ? (
        <Text style={{
          fontFamily: 'Montserrat-Medium', fontSize: 13, color: C.text,
          textAlign: 'center', marginTop: 10, paddingHorizontal: 24,
        }}>
          {sousTexte}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.85}
          // Meme bouton que partout ailleurs dans l app (s.btnPrimary) :
          // rayon 16 et corps 15, pas une pilule en 14. Seule la largeur
          // change, un etat vide ne porte pas un bouton pleine largeur.
          style={{
            marginTop: 18, paddingHorizontal: 24, paddingVertical: 14,
            borderRadius: 16, backgroundColor: C.primary,
          }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Montserrat-SemiBold', fontSize: 15 }}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
