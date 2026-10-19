// Bouton « Continuer avec Apple ».
//
// On n utilise plus AppleAuthenticationButton (le bouton natif) : sa police
// est celle du systeme, son logo est colle au texte et sa hauteur lui est
// propre. A cote du bouton Google, les deux ne se ressemblaient pas — deux
// dessins differents pour la meme action.
//
// Apple autorise un bouton maison tant que son dessin respecte ses regles :
// logo officiel, libelle approuve (« Continuer avec Apple »), hauteur d au
// moins 30pt, rayon inferieur a la moitie de la hauteur, et un contraste
// franc. C est ce que fait ce composant — meme gabarit que BoutonGoogle, a
// la couleur pres, parce qu une marque se reconnait a sa couleur.
//
// Le composant ne rend rien tant qu Apple n est pas disponible (Android,
// binaire sans le module natif, appareil sans compte Apple) : mieux vaut pas
// de bouton qu un bouton qui echoue.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { appleDisponible, connexionApple, APPLE_ANNULE } from '../services/apple';

function LogoApple({ taille = 20 }) {
  return (
    <Svg width={taille} height={taille} viewBox="0 0 24 24">
      <Path
        fill="#fff"
        d="M16.365 1.43c0 1.14-.42 2.2-1.24 3.03-.98 1-2.14 1.58-3.4 1.48-.02-.13-.03-.27-.03-.42 0-1.1.47-2.27 1.29-3.1.6-.6 1.4-1.1 2.37-1.39.33-.1.65-.15.94-.17.04.19.07.38.07.57z M20.5 17.3c-.3.7-.66 1.35-1.08 1.95-.57.82-1.04 1.39-1.4 1.71-.56.52-1.16.79-1.8.8-.46 0-1.02-.13-1.67-.4-.65-.27-1.25-.4-1.8-.4-.57 0-1.19.13-1.86.4-.67.27-1.21.41-1.62.43-.62.03-1.23-.25-1.83-.83-.39-.35-.88-.94-1.47-1.77-.63-.89-1.15-1.92-1.56-3.1-.44-1.27-.66-2.5-.66-3.69 0-1.36.29-2.54.88-3.52.46-.79 1.08-1.41 1.85-1.87.77-.46 1.6-.69 2.5-.71.49 0 1.13.15 1.93.45.8.3 1.31.45 1.54.45.17 0 .74-.18 1.7-.53.91-.33 1.68-.46 2.31-.41 1.71.14 3 .81 3.85 2.03-1.53.93-2.29 2.23-2.27 3.9.01 1.3.49 2.38 1.42 3.24.42.4.9.71 1.42.93-.11.33-.23.64-.36.94z"
      />
    </Svg>
  );
}

export function BoutonApple({ onJeton, onErreur, style, separateur = true }) {
  const [dispo, setDispo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivant = true;
    appleDisponible().then((ok) => { if (vivant) setDispo(ok); });
    return () => { vivant = false; };
  }, []);

  if (!dispo) return null;

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
    <View style={[{ width: '100%' }, style]}>
      {separateur && (
        <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 16 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
          <Text style={{ fontFamily: 'Montserrat-Medium', fontSize: 12, color: '#8a8398', marginHorizontal: 12 }}>ou</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: '#e6e0f2' }} />
        </View>
      )}
      <TouchableOpacity
        onPress={appuyer}
        activeOpacity={0.85}
        disabled={busy}
        style={{
          width: '100%', height: 50, borderRadius: 12, backgroundColor: '#000',
          alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
        }}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {/* Le logo est pose a gauche, le libelle reste centre dans le
                bouton : meme construction que BoutonGoogle, donc les deux
                libelles tombent exactement au meme endroit. */}
            <View style={{ position: 'absolute', left: 16 }}>
              <LogoApple />
            </View>
            <Text style={{ fontFamily: 'Montserrat-SemiBold', fontSize: 16, color: '#fff' }}>
              Continuer avec Apple
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}
