// La pile des connexions par fournisseur, separateur « ou » compris.
//
// Pourquoi un conteneur plutot que deux boutons poses cote a cote : le
// separateur ne doit apparaitre que s il reste au moins un bouton dessous.
// Apple ne s affiche pas sur Android, Google ne s affiche pas sans
// identifiant client — un separateur orphelin au-dessus du vide etait le
// defaut garanti. Ici, c est le conteneur qui tranche, une seule fois.
//
// Ordre Apple puis Google : sur iOS, Apple exige d etre au moins aussi en
// evidence que les autres fournisseurs.
//
// `onJeton(provider, { identityToken, prenom, nom })` — le provider est
// transmis, c est lui que le worker attend dans /auth/oauth.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { BoutonApple } from './BoutonApple';
import { BoutonGoogle } from './BoutonGoogle';
import { appleDisponible } from '../services/apple';
import { googleDisponible } from '../services/google';

export function BoutonsConnexion({ onJeton, onErreur, style }) {
  const [apple, setApple] = useState(false);
  const google = googleDisponible();

  useEffect(() => {
    let vivant = true;
    appleDisponible().then((ok) => { if (vivant) setApple(ok); });
    return () => { vivant = false; };
  }, []);

  if (!apple && !google) return null;

  return (
    <View style={[{ width: '100%' }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
        <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 12, color: '#8a8398', marginHorizontal: 12 }}>ou</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
      </View>

      {apple && (
        <BoutonApple
          separateur={false}
          onJeton={(j) => onJeton('apple', j)}
          onErreur={onErreur}
        />
      )}

      {google && (
        <BoutonGoogle
          style={apple ? { marginTop: 10 } : null}
          onJeton={(j) => onJeton('google', j)}
          onErreur={onErreur}
        />
      )}
    </View>
  );
}
