// Bouton « Continuer avec Apple », precede d un separateur « ou ».
//
// On utilise le bouton natif d Apple (AppleAuthenticationButton) plutot qu un
// bouton maison : Apple impose son dessin, son libelle et ses proportions dans
// ses regles de revue. Il ne prend donc ni Montserrat ni la charte violette,
// c est voulu.
//
// Le composant ne rend rien tant qu Apple n est pas disponible (Android,
// binaire sans le module natif, appareil sans compte Apple) : mieux vaut pas
// de bouton qu un bouton qui echoue.

import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { appleDisponible, connexionApple, APPLE_ANNULE } from '../services/apple';

let AppleAuth = null;
try { AppleAuth = require('expo-apple-authentication'); } catch {}

export function BoutonApple({ onJeton, onErreur, style, separateur = true }) {
  const [dispo, setDispo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivant = true;
    appleDisponible().then((ok) => { if (vivant) setDispo(ok); });
    return () => { vivant = false; };
  }, []);

  if (!dispo || !AppleAuth?.AppleAuthenticationButton) return null;

  const appuyer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { identityToken, prenom, nom } = await connexionApple();
      await onJeton({ identityToken, prenom, nom });
    } catch (e) {
      // Une annulation n est pas une erreur : l utilisateur a change d avis.
      if (e?.code !== APPLE_ANNULE) {
        onErreur?.(e?.message || 'Connexion Apple impossible.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[{ width: '100%', alignItems: 'center' }, style]}>
      {separateur && (
        <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 16 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
          <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 12, color: '#8a8398', marginHorizontal: 12 }}>ou</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
        </View>
      )}
      {busy ? (
        <View style={{ height: 50, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#221c30" />
        </View>
      ) : (
        <AppleAuth.AppleAuthenticationButton
          buttonType={AppleAuth.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuth.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={{ width: '100%', height: 50 }}
          onPress={appuyer}
        />
      )}
    </View>
  );
}
