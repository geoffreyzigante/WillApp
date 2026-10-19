// Bouton « Continuer avec Google ».
//
// Dessin : celui que Google impose dans ses « Sign in with Google » branding
// guidelines — fond blanc, bordure #747775, le G quadricolore a gauche, le
// libelle centre. Comme pour Apple, on ne le repeint pas en violet : un
// bouton de fournisseur se reconnait a son dessin, c est tout son interet.
// Seul le rayon (12) et la hauteur (50) sont alignes sur le bouton Apple pour
// que la pile des deux soit nette.
//
// Le composant ne rend rien si Google n est pas disponible : binaire sans le
// module natif, ou identifiant client absent de app.json. Mieux vaut pas de
// bouton qu un bouton qui echoue.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { googleDisponible, connexionGoogle, GOOGLE_ANNULE } from '../services/google';

function LogoGoogle({ taille = 18 }) {
  return (
    <Svg width={taille} height={taille} viewBox="0 0 48 48">
      <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.3-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <Path fill="#FBBC05" d="M11.7 28.18A13.5 13.5 0 0 1 11 24c0-1.45.25-2.86.7-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.36-5.7z" />
      <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.36 5.7c1.72-5.2 6.57-9.07 12.3-9.07z" />
    </Svg>
  );
}

export function BoutonGoogle({ onJeton, onErreur, style }) {
  const [busy, setBusy] = useState(false);

  if (!googleDisponible()) return null;

  const appuyer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { identityToken, prenom, nom } = await connexionGoogle();
      await onJeton({ identityToken, prenom, nom });
    } catch (e) {
      // Une annulation n est pas une erreur : l utilisateur a change d avis.
      if (e?.code !== GOOGLE_ANNULE) {
        onErreur?.(e?.message || 'Connexion Google impossible.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={appuyer}
      activeOpacity={0.85}
      disabled={busy}
      style={[{
        width: '100%', height: 50, borderRadius: 12, backgroundColor: '#fff',
        borderWidth: 1, borderColor: '#747775',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
      }, style]}
    >
      {busy ? (
        <ActivityIndicator color="#747775" />
      ) : (
        <>
          <View style={{ position: 'absolute', left: 16 }}>
            <LogoGoogle />
          </View>
          <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 16, color: '#1f1f1f' }}>
            Continuer avec Google
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}
