// Icone "favori photo" = etoile (Favoris_3.svg). Distingue les favoris de
// PHOTOS (etoile) des favoris d EVENTS (coeur) pour eviter la confusion
// visuelle entre les deux types de favoris (cf memoire utilisateur "WILL
// favoris coeur vs etoile").
//
// viewBox elargi de 2px sur chaque cote pour ne pas rogner le stroke (le
// path Favoris_3.svg colle les bords 0,0 -> 18.42,17.61).

import React from 'react';
import Svg, { Path } from 'react-native-svg';

export function FavStar({ size = 16, fill = '#fff', stroke = '#fff', strokeWidth = 1.6, style }) {
  return (
    <Svg width={size * (22.42 / 21.61)} height={size} viewBox="-2 -2 22.42 21.61" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" style={style}>
      <Path d="M10.09.61l1.91,5.17,5.51.22c.87.03,1.23,1.14.55,1.68l-4.33,3.42,1.5,5.31c.24.84-.7,1.52-1.43,1.04l-4.59-3.06-4.59,3.06c-.73.49-1.66-.2-1.43-1.04l1.5-5.31L.36,7.69c-.69-.54-.33-1.64.55-1.68l5.51-.22,1.91-5.17c.3-.82,1.46-.82,1.76,0Z" />
    </Svg>
  );
}
