// Bouton retour des ecrans orga (26/11) : cercle 34 pt en gris de champ, sans contour, chevron
// noir. Un seul dessin pour la fiche d event, « Modifier mon event » et les
// photos de l event, au lieu de « ‹ Fermer », d une croix et d un cercle.
import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { lh } from '../constants/typo';
import { T } from '../constants/tokens';

export function BoutonRetour({ onPress, style, libelle = 'Retour' }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      style={[{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.couleur.champFond, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 20, lineHeight: lh(20, 24, 'Montserrat'), color: '#1A1426', marginTop: -2 }}>‹</Text>
    </TouchableOpacity>
  );
}
