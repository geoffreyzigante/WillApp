// Etat vide "pas de photos" — mascotte + phrase, comme le site
// (event/index.html .photos-empty-legende). Les cases fantomes du site ne
// sont pas reprises sur l app : elles reprenaient la grille photos, qui est
// deja absente ici.
import React from 'react';
import { View, Text } from 'react-native';
import { C } from '../constants/colors';
import { CtaWill2 } from './CtaWill';
import { lh } from '../constants/typo';

export function EtatVidePhotos({
  // Retour a la ligne explicite, comme EtatVideWill et EtatVideMascotte : les
  // trois etats vides de l app coupent leur titre au meme endroit logique
  // plutot que de laisser la largeur d ecran decider ou il casse.
  texte = 'Pas encore\nde photos capturées',
  sousTexte = "Reviens le jour de l'event",
  illuHeight = 72,
  style = null,
  // Comme le site (event/index.html #empty-prevenir) : le bouton suit l'event ;
  // sans compte, l'appelant ouvre la connexion (requireAuth).
  onPrevenir = null,
  dejaPrevenu = false,
}) {
  // Centre en colonne (user 2026-10-26) : la mascotte au-dessus, le texte
  // dessous, tout aligne sur le meme axe. En rangee, le bloc de texte etait
  // cale a gauche de la mascotte et son titre tenait sur une seule ligne tres
  // longue — les deux autres etats vides de l app ne font ni l un ni l autre.
  return (
    <View style={[{
      paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center',
    }, style]}>
      <Text style={{
        color: C.primary, fontSize: 18, lineHeight: lh(18, 22),
        fontFamily: 'AVEstiana-Bold', letterSpacing: -0.2,
        textAlign: 'center',
      }}>
        {texte}
      </Text>
      {sousTexte ? (
        <Text style={{
          color: C.text, fontSize: 12, fontFamily: 'Montserrat-Medium',
          textAlign: 'center', marginTop: 4, lineHeight: 17,
        }}>
          {sousTexte}
        </Text>
      ) : null}
      {dejaPrevenu ? (
        <Text style={{ color: C.textSoft, fontSize: 12, fontFamily: 'Montserrat-Medium', textAlign: 'center', marginTop: 14, lineHeight: 17 }}>
          Tu seras prévenu dès qu'une photo de toi est reconnue.
        </Text>
      ) : onPrevenir ? (
        <CtaWill2 label="Préviens-moi" onPress={onPrevenir} variante="violet" style={{ alignSelf: 'center', marginTop: 14 }} />
      ) : null}
    </View>
  );
}
